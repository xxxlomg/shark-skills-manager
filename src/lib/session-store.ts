/**
 * Agent 会话事件溯源存储（前端侧）。
 *
 * 设计对齐 pi / deepseek-harness 实践：
 * - 唯一 session id（UUID），事件按 JSONL 只追加落盘（Rust `session_append`）；
 * - 读取时全量重放（Rust `session_load`），由上层组装为 system + messages；
 * - 历史前缀不裁剪、不重排（DeepSeek KV Cache 命中依赖前缀稳定）。
 */
import { invoke } from "@tauri-apps/api/core";
import { isMockMode } from "@/mock";
import {
  normalizeAuthoringResultMeta,
  type AuthoringResultAction,
  type AuthoringMessageKind,
  type AuthoringResultStatus,
  type InterviewMessage,
} from "@/lib/creation-state";

export type SessionEventKind =
  | "session_created"
  | "user_msg"
  | "assistant_msg"
  | "tool_read"
  | "generation_result"
  | "attachment_result"
  | "result_applied"
  | "result_dismissed"
  | "review_result";

export interface SessionEvent {
  kind: SessionEventKind;
  /** 事件正文（用户输入 / AI 输出 / 回注规范全文 / 产物内容） */
  content: string;
  /** 附加元数据（如 attachment 的文件路径） */
  extra?: Record<string, string>;
  at?: number;
}

/** mock 模式的内存仓库（进程内） */
const mockStore = new Map<string, SessionEvent[]>();

export function newSessionId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `s-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------------------
// 会话 id ↔ 归属主体（draft/skill id）映射：生产环境由 Rust 持久化到
// <data_dir>/sessions/index.json；localStorage 仅作为旧版本一次性迁移兜底。
// ---------------------------------------------------------------------------

const sessionMapKey = (ownerId: string) => `sm-session:${ownerId}`;

function readLegacySessionId(ownerId: string): string | null {
  try {
    return localStorage.getItem(sessionMapKey(ownerId));
  } catch {
    return null;
  }
}

function clearLegacySessionId(ownerId: string): void {
  try {
    localStorage.removeItem(sessionMapKey(ownerId));
  } catch {
    /* ignore */
  }
}

/** 记录归属主体的 session id（新建草稿 / 保存后重绑技能）。 */
export async function rememberSessionId(ownerId: string, sessionId: string): Promise<void> {
  if (isMockMode()) {
    try {
      localStorage.setItem(sessionMapKey(ownerId), sessionId);
    } catch {
      /* ignore */
    }
    return;
  }
  // 生产环境不回写 localStorage，避免后端异常时再次产生错误目录。
  await invoke("session_bind", { ownerId, sessionId });
  clearLegacySessionId(ownerId);
}

/** 读取归属主体的 session id，并将旧 localStorage 映射迁移到 Rust 数据目录。 */
export async function recallSessionId(ownerId: string): Promise<string | null> {
  if (isMockMode()) return readLegacySessionId(ownerId);
  try {
    const sid = await invoke<string | null>("session_lookup", { ownerId });
    if (sid) {
      clearLegacySessionId(ownerId);
      return sid;
    }
    const legacySid = readLegacySessionId(ownerId);
    if (!legacySid) return null;
    await invoke("session_bind", { ownerId, sessionId: legacySid });
    clearLegacySessionId(ownerId);
    return legacySid;
  } catch {
    // 后端不可用时继续读取旧映射，避免开发模式或升级中丢失会话入口。
    return readLegacySessionId(ownerId);
  }
}

/** 移除归属映射（草稿键迁移到技能键时调用）。 */
export async function forgetSessionId(ownerId: string): Promise<void> {
  if (!isMockMode()) {
    try {
      await invoke("session_unbind", { ownerId });
    } catch {
      /* 后端不可用时仍清理旧映射 */
    }
  }
  clearLegacySessionId(ownerId);
}

export async function sessionAppend(sessionId: string, ev: SessionEvent): Promise<void> {
  if (isMockMode()) {
    const list = mockStore.get(sessionId) ?? [];
    list.push(ev);
    mockStore.set(sessionId, list);
    return;
  }
  await invoke("session_append", { sessionId, event: { ...ev, at: ev.at ?? Date.now() } });
}

export async function sessionLoad(sessionId: string): Promise<SessionEvent[]> {
  if (isMockMode()) {
    return mockStore.get(sessionId) ?? [];
  }
  try {
    return await invoke<SessionEvent[]>("session_load", { sessionId });
  } catch {
    return []; // SESSION_NOT_FOUND → 空会话（首次进入）
  }
}

/** 删除会话事件日志（主动放弃创作时调用；幂等） */
export async function sessionDelete(sessionId: string): Promise<void> {
  if (isMockMode()) {
    mockStore.delete(sessionId);
    return;
  }
  try {
    await invoke("session_delete", { sessionId });
  } catch {
    /* 文件已不存在等场景忽略 */
  }
}

export type ChatMsg = { role: "user" | "assistant"; content: string };

/**
 * Chat history message consumed by the creator UI.
 *
 * Unlike ChatMsg, this shape retains file-result metadata. A result-bearing
 * assistant message is a file card candidate; a message without result is a
 * normal chat bubble. It intentionally does not expose system/session events.
 */
export type SessionHistoryMessage = Pick<
  InterviewMessage,
  "id" | "role" | "content" | "reasoning" | "result"
> & { role: "user" | "assistant"; messageKind: AuthoringMessageKind };

const AUTHORING_RESULT_ACTIONS: readonly AuthoringResultAction[] = [
  "append",
  "replace",
  "use",
  "write",
];

function parseAuthoringResultAction(value: string | undefined): AuthoringResultAction | undefined {
  return AUTHORING_RESULT_ACTIONS.includes(value as AuthoringResultAction)
    ? (value as AuthoringResultAction)
    : undefined;
}

const AUTHORING_RESULT_STATUSES: readonly AuthoringResultStatus[] = [
  "pending",
  "applied",
  "dismissed",
];

function parseAuthoringResultStatus(value: string | undefined): AuthoringResultStatus | undefined {
  return AUTHORING_RESULT_STATUSES.includes(value as AuthoringResultStatus)
    ? (value as AuthoringResultStatus)
    : undefined;
}

type HistoricalResultState = {
  action?: AuthoringResultAction;
  status?: AuthoringResultStatus;
};

function historicalResultStates(events: readonly SessionEvent[]): Map<string, HistoricalResultState> {
  const states = new Map<string, HistoricalResultState>();
  for (const event of events) {
    const messageId = event.extra?.messageId;
    if (!messageId) continue;

    if (event.kind === "result_applied") {
      const action = parseAuthoringResultAction(event.extra?.action);
      const previous = states.get(messageId);
      states.set(messageId, {
        ...previous,
        ...(action ? { action } : {}),
        status: "applied",
      });
    } else if (event.kind === "result_dismissed") {
      states.set(messageId, { status: "dismissed" });
    }
  }
  return states;
}

function historicalMessageId(
  event: SessionEvent,
  index: number,
  suffix: "u" | "a" | "g" | "f",
): string {
  return event.extra?.messageId || `hist-${index}-${suffix}`;
}

/**
 * Event replay for the creator chat UI.
 *
 * Result events remain assistant messages, but carry normalized file metadata
 * so a caller can render a file card instead of the full artifact body. Old
 * body generation events without `fileRel` resolve to `SKILL.md`.
 * Dismissed results stay hidden, matching the existing UI behavior.
 */
export function eventsToHistoryMessages(
  events: readonly SessionEvent[],
): SessionHistoryMessage[] {
  const out: SessionHistoryMessage[] = [];
  const states = historicalResultStates(events);

  for (const event of events) {
    const messageId = event.extra?.messageId;
    if (event.kind === "user_msg") {
      out.push({
        id: historicalMessageId(event, out.length, "u"),
        role: "user",
        content: event.content,
        messageKind: "chat",
      });
      continue;
    }

    if (event.kind === "assistant_msg") {
      out.push({
        id: historicalMessageId(event, out.length, "a"),
        role: "assistant",
        content: event.content,
        messageKind: "chat",
        ...(event.extra?.reasoning ? { reasoning: event.extra.reasoning } : {}),
      });
      continue;
    }

    if (event.kind !== "generation_result" && event.kind !== "attachment_result") {
      continue;
    }

    const state = messageId ? states.get(messageId) : undefined;
    const action = state?.action ?? parseAuthoringResultAction(event.extra?.applied);
    const explicitStatus =
      state?.status ??
      parseAuthoringResultStatus(event.extra?.resultStatus ?? event.extra?.status);
    const result = normalizeAuthoringResultMeta(
      {
        kind: event.kind === "generation_result" ? "body" : "attachment",
        fileRel:
          event.kind === "attachment_result"
            ? event.extra?.fileRel ?? event.extra?.file
            : event.extra?.fileRel,
        ...(event.kind === "generation_result"
          ? { bodyEmpty: event.extra?.bodyEmpty === "true" }
          : {}),
        ...(action ? { applied: action } : {}),
      },
      explicitStatus ?? (action ? "applied" : undefined),
    );

    if (!result || result.status === "dismissed") continue;
    out.push({
      id: historicalMessageId(
        event,
        out.length,
        event.kind === "generation_result" ? "g" : "f",
      ),
      role: "assistant",
      content: event.content,
      messageKind:
        event.kind === "generation_result"
          ? "body_candidate"
          : "attachment_candidate",
      ...(event.extra?.reasoning ? { reasoning: event.extra.reasoning } : {}),
      result,
    });
  }

  return out;
}

/**
 * 事件重放 → LLM 消息数组（T4 组装源）。
 * 仅用户/AI 对话消息原样映射；产物类事件不进入 messages，避免把候选
 * 文件正文误当成聊天上下文；tool_read（规范回注）与系统事件也不进入
 * messages（由上层并入 system）。
 */
export function eventsToMessages(events: readonly SessionEvent[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const ev of events) {
    switch (ev.kind) {
      case "user_msg":
        out.push({ role: "user", content: ev.content });
        break;
      case "assistant_msg":
        out.push({ role: "assistant", content: ev.content });
        break;
      default:
        break;
    }
  }
  return out;
}
