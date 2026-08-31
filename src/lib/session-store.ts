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

export type SessionEventKind =
  | "session_created"
  | "user_msg"
  | "assistant_msg"
  | "tool_read"
  | "generation_result"
  | "attachment_result"
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
// 会话 id ↔ 归属主体（draft/skill id）映射：localStorage 键的唯一维护点，
// 收敛此前散落在工作台的硬编码 `sm-session:` 键。
// ---------------------------------------------------------------------------

const sessionMapKey = (ownerId: string) => `sm-session:${ownerId}`;

/** 记录归属主体的会话 id（新建草稿 / 保存后重绑技能） */
export function rememberSessionId(ownerId: string, sessionId: string): void {
  try {
    localStorage.setItem(sessionMapKey(ownerId), sessionId);
  } catch {
    /* ignore */
  }
}

/** 读取归属主体的会话 id（无则返回 null） */
export function recallSessionId(ownerId: string): string | null {
  try {
    return localStorage.getItem(sessionMapKey(ownerId));
  } catch {
    return null;
  }
}

/** 移除归属映射（草稿键迁移到技能键时调用） */
export function forgetSessionId(ownerId: string): void {
  try {
    localStorage.removeItem(sessionMapKey(ownerId));
  } catch {
    /* ignore */
  }
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
 * 事件重放 → LLM 消息数组（T4 组装源）。
 * 用户/AI 对话消息原样映射；产物类事件以 assistant 形式保留上下文链；
 * tool_read（规范回注）与系统事件不进入 messages（由上层并入 system）。
 */
export function eventsToMessages(events: SessionEvent[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const ev of events) {
    switch (ev.kind) {
      case "user_msg":
        out.push({ role: "user", content: ev.content });
        break;
      case "assistant_msg":
      case "generation_result":
      case "attachment_result":
        out.push({ role: "assistant", content: ev.content });
        break;
      default:
        break;
    }
  }
  return out;
}