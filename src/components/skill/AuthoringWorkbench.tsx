import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleHelp,
  Columns2,
  Eye,
  FolderTree,
  Loader2,
  Maximize2,
  Minimize2,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import { FileTree } from "./FileTree";
import { FileArtifactPreview } from "./FileArtifactPreview";
import { SkillReviewPanel, type ReviewReportMeta } from "./SkillReviewPanel";
import { SkillReviewBrief } from "./SkillReviewBrief";
import {
  hubListTools,
  readSkillFile,
  scanSkills,
  skillCommitDraft,
  skillEditFrontmatter,
  skillNew,
  skillValidate,
  skillWriteFile,
  type Skill,
  type ToolInfo,
  type ValidationReport,
} from "@/lib/api";
import { chatAuthoringStream, continueBodyStream, fixSkillStream, generateAttachmentDraftStream, generateFileAssistStream, extractAttachmentRefs, reviewSkillStream, sanitizeGeneratedText, summarizeSkillTitle, type SkillReviewResult } from "@/lib/authoring-api";
import { sessionAppend, sessionLoad, sessionDelete, newSessionId, rememberSessionId, recallSessionId, forgetSessionId, eventsToMessages, eventsToHistoryMessages, type SessionEvent } from "@/lib/session-store";
import { loadLLMConfig } from "@/lib/llm-config";
import { isMockMode, MOCK_TOOLS } from "@/mock";
import { NAME_RE, fmtSavedAt, type WbDraft } from "@/lib/wb-draft";
import { useWorkbenchDraft } from "@/hooks/useWorkbenchDraft";
import {
  createDefaultCreationState,
  CreationStage,
  getAuthoringMessageKind,
  normalizeAuthoringResultMeta,
  migrateWbDraftToCreationState,
  mergeWbDraftIntoCreationState,
  type AuthoringResultAction,
  type AuthoringResultMeta,
  type InterviewMessage,
  type SkillCreationState,
} from "@/lib/creation-state";
import { detectAuthoringIntent } from "@/lib/authoring-intent";
import { CreationGuidePanel } from "./CreationGuidePanel";
import { InterviewGuide } from "./InterviewGuide";
import { AuthoringHeader } from "./AuthoringHeader";
import { DraftRestoreBanner } from "./DraftRestoreBanner";
import { AttachProposalDialog } from "./AttachProposalDialog";
import {
  appendPlatformMetadata,
  buildAttachmentFiles,
  buildDesc,
  COMMON_EMOJI,
  generateSkillName,
  splitFrontmatter,
  toValidationSummary,
  yq,
  type PreviewMode,
} from "@/lib/authoring-utils";

/**
 * 创作工作台（精修第三轮）。
 * R3-1 「我的描述」改为左侧推拉抽屉（shadcn Sheet，非模态）；
 *      阶段 0：删「何时用」，抽屉只留「我的描述」单输入（description 即 purpose）；
 * R3-2 整页不滚：h-dvh 列布局，编辑器/参考/流式 pane 全部内部滚动；
 * R3-3 内容参考保持编辑列内；AI 流式结果回到创作引导对话中，确认后再写入正文。
 * 继承：X1 沉浸顶；X4 AI 创作 Dialog + 流式 + 回显；X5 emoji 全链路。
 */
interface AuthoringWorkbenchProps {
  skill: Skill | null; // null = 新建态
  /** 新建态落点预选（从技能库「在当前目录下创作」进入时带上工具名/ID） */
  initialLocation?: string | null;
  refresh: () => void;
  onOpenSettings: () => void;
  onExit: () => void;
}

export function AuthoringWorkbench({
  skill,
  initialLocation,
  refresh,
  onOpenSettings,
  onExit,
}: AuthoringWorkbenchProps) {
  const [current, setCurrent] = useState<Skill | null>(skill);
  const draftId = current?.id ?? "new";

  // B3：附件提案——初稿落地后引导生成 references/scripts 真实内容（占位模板升级）
  const [attOpen, setAttOpen] = useState(false);
  const [attCandidates, setAttCandidates] = useState<string[]>([]);
  const [attSelected, setAttSelected] = useState<Set<string>>(new Set());
  const [attBusy, setAttBusy] = useState<string | null>(null);
  const [attProgress, setAttProgress] = useState<{ i: number; total: number } | null>(null);
  const [attVersion, setAttVersion] = useState(0);
  const attContentsRef = useRef<Record<string, string>>({});
  const attAbortRef = useRef<AbortController | null>(null);
  /** 用户在 FileTree 内手工编辑过的文件内容（保存时统一落盘，无局部保存按钮） */
  const editedFilesRef = useRef<Record<string, string>>({});
  // T3：Agent 会话（事件溯源日志）——唯一 session id + 产品数据目录内的 id↔draft 映射
  const sessionIdRef = useRef<string | null>(null);
  const sessionEventsRef = useRef<SessionEvent[]>([]);
  const sessionInitRef = useRef<Promise<string> | null>(null);
  const sessionWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ensureSession = useCallback((): Promise<string> => {
    if (sessionIdRef.current) return Promise.resolve(sessionIdRef.current);
    if (sessionInitRef.current) return sessionInitRef.current;

    const init = (async () => {
      let sid = await recallSessionId(draftId);
      if (!sid) sid = newSessionId();
      sessionEventsRef.current = await sessionLoad(sid);
      if (sessionEventsRef.current.length === 0) {
        const created: SessionEvent = { kind: "session_created", content: draftId };
        sessionEventsRef.current.push(created);
        await sessionAppend(sid, created);
      }
      await rememberSessionId(draftId, sid);
      sessionIdRef.current = sid;
      return sid;
    })();
    sessionInitRef.current = init;
    return init;
  }, [draftId]);
  const recordSession = useCallback(
    (ev: SessionEvent): Promise<void> => {
      const write = sessionWriteQueueRef.current.then(async () => {
        const sid = await ensureSession();
        sessionEventsRef.current.push(ev);
        await sessionAppend(sid, ev);
      });
      // A failed write must not permanently block later user messages.
      sessionWriteQueueRef.current = write.catch(() => undefined);
      return write;
    },
    [ensureSession],
  );

  // C6：#1 历史对话加载——再次打开已创建 Skill 时，重放会话事件为聊天消息
  // （含 AI 思考过程 reasoning，保证可回溯整个创作思路）
  useEffect(() => {
    let cancelled = false;
    void ensureSession().then(() => {
      if (cancelled) return;
      const mapped = eventsToHistoryMessages(sessionEventsRef.current);
      if (mapped.length > 0) {
        guideMsgSeq.current = Math.max(guideMsgSeq.current, mapped.length);
        setGuideMessages((current) => {
          const currentIds = new Set(current.map((message) => message.id));
          return [...mapped, ...current.filter((message) => !currentIds.has(message.id))];
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);
  const [creationState, setCreationState] = useState<SkillCreationState>(() =>
    createDefaultCreationState({ id: skill?.id ?? null }),
  );
  const creationStateRef = useRef(creationState);
  useEffect(() => {
    creationStateRef.current = creationState;
  }, [creationState]);
  // 草稿统一工具：dirty 判定 / 自动落盘 / 恢复 / 清理全部收敛到 Hook（不再散落判断）
  const draftApi = useWorkbenchDraft(draftId, () => creationStateRef.current);
  const { draft, dirty, stored } = draftApi;
  const setDraftSilently = draftApi.setDraftSilently;
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [origFm, setOrigFm] = useState("");
  const [location, setLocation] = useState("authored");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [preview, setPreview] = useState<PreviewMode>("split");
  const [rightTab, setRightTab] = useState<"body" | "files" | "evaluate" | "result">(
    "body",
  );
  const [resultPreview, setResultPreview] = useState<{
    messageId: string;
    fileName: string;
    kind: "body" | "attachment";
    content: string;
    pending: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  // 创作引导聊天消息（用户想法 + AI 状态回执）：状态上移，切换到访谈视图再切回也不丢失
  const [guideMessages, setGuideMessages] = useState<InterviewMessage[]>([]);
  const guideMsgSeq = useRef(0);
  const pushGuideMessage = useCallback(
    (
      role: InterviewMessage["role"],
      content: string,
    options?: { id?: string; reasoning?: string; result?: AuthoringResultMeta },
  ): string => {
      const id = options?.id ?? `gm-${++guideMsgSeq.current}`;
      const result = normalizeAuthoringResultMeta(options?.result);
      setGuideMessages((list) => [
        ...list,
        {
          id,
          role,
          content,
          messageKind: getAuthoringMessageKind({ messageKind: undefined, result }),
          reasoning: options?.reasoning,
          result,
        },
      ]);
      return id;
    },
    [],
  );
  const [editorOpen, setEditorOpen] = useState(true);
  // 编辑区全屏：覆盖层顶部保留完整工具栏（正文/附带资源 + 编辑/分栏/预览 + 还原）
  const [editorFull, setEditorFull] = useState(false);
  // AI 创作：流式正文和确认操作直接显示在左侧创作对话中
  const [stream, setStream] = useState("");
  const [streamKind, setStreamKind] = useState<"body" | "attachment" | "chat">("body");
  const [streamFile, setStreamFile] = useState<string | null>(null);
  const [thinkStream, setThinkStream] = useState("");
  const thinkStreamRef = useRef("");
  const [streaming, setStreaming] = useState(false);
  // 用户「停止生成」的中止控制器：挂到 ref，供按钮 + 卸载时调用
  const aiAbortRef = useRef<AbortController | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const [streamApplied, setStreamApplied] = useState<AuthoringResultAction | null>(null);
  // 引导式访谈状态（shark-skill-creator 对话式创建协议，动态 AI 驱动）
  const [interviewActive, setInterviewActive] = useState(false);
  const [interviewContext, setInterviewContext] = useState("");
  // 智能审查状态（shark-skill-creator 规则，全自动化）
  const [reviewResult, setReviewResult] = useState<SkillReviewResult | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // 审查流式：LLM 逐行输出实时展示在附带资源页（用户可感知“正在检索什么”）
  const [reviewStream, setReviewStream] = useState("");
  // 修复流式：一键修复过程逐行展示当前正在修改的内容
  const [fixStream, setFixStream] = useState("");
  const reviewAbortRef = useRef<AbortController | null>(null);
  // 审查报告持久化元数据（一技能一报告）
  const [reportMeta, setReportMeta] = useState<ReviewReportMeta | null>(null);
  // 一键修复状态
  const [fixing, setFixing] = useState(false);
  const fixAbortRef = useRef<AbortController | null>(null);
  // 60s 未保存淡入「没灵感？试试 AI 创作」；保存成功重置
  // R3-1 左侧「我的描述」推拉抽屉（默认展开，可收起以最大化编辑区）
  const [descOpen, setDescOpen] = useState(true);
  // R4：主行 DOM 节点——抽屉 Portal 锚定进主行（absolute），与 Markdown 区水平对齐
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  // Existing editor fields remain editable while the Creator state grows around
  // them. This preserves AI/interview/evaluation data across ordinary edits.
  useEffect(() => {
    setCreationState((state) =>
      mergeWbDraftIntoCreationState(state, draft, {
        id: current?.id ?? null,
        targetLocation: location,
      }),
    );
  }, [current?.id, draft, location]);

  // 初始加载：磁盘内容回显（不标脏、不落盘）+ 预热全局 LLM 配置缓存
  // （审查/访谈/生成共用 requireLLMConfig；不预热则缓存空 → 误报「未配置 LLM」）
  useEffect(() => {
    if (!isMockMode()) {
      void loadLLMConfig().catch(() => undefined);
    }
    if (current) {
      // 阶段 0：存量 description 直接回显「我的描述」单输入，抽屉不空白
      setDraftSilently((d) => ({
        ...d,
        name: current.name,
        desc: current.description,
        emoji: current.emoji ?? "🧩",
        purpose: current.description,
      }));
      readSkillFile(current.source_path)
        .then((md) => {
          const parts = splitFrontmatter(md);
          if (parts) {
            setOrigFm(parts.fm);
            setDraftSilently((d) => ({ ...d, body: parts.body }));
          } else {
            setDraftSilently((d) => ({ ...d, body: md }));
          }
        })
        .catch(() => toast.error("读取 SKILL.md 失败"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 落点候选（新建态）
  useEffect(() => {
    if (current) return;
    if (isMockMode()) {
      setTools(MOCK_TOOLS.filter((t) => !t.app_owned && t.enabled));
      return;
    }
    hubListTools()
      .then((ts) => setTools(ts.filter((t) => !t.app_owned && t.enabled)))
      .catch(() => setTools([]));
  }, [current]);

  // 落点预选：从技能库「在当前目录下创作」进入时，把 location 预选为对应工具。
  // scan_label / tool_id 与 ToolInfo 的 id/name 可能不一致（如 claude ↔ claude-code），
  // 故先精确匹配，再退化为归一化前缀匹配。
  useEffect(() => {
    if (current || !initialLocation) return;
    const norm = (s: string) => s.toLowerCase().replace(/[\s_\-/\\]/g, "");
    const n = norm(initialLocation);
    if (!n) return;
    const t =
      tools.find((x) => x.id === initialLocation || x.name === initialLocation) ??
      tools.find((x) => {
        const a = norm(x.id);
        const b = norm(x.name);
        return a === n || b === n || a.startsWith(n) || b.startsWith(n);
      });
    if (t) setLocation(t.id);
  }, [tools, initialLocation, current]);

  // 虚拟附件预览（未保存即可见）：AI 生成正文后，立即在 FileTree 渲染
  // SKILL.md + 标准附件（references/scripts/assets）的结构与内容，保存仅为最终落盘。
  // B3 修复：attContentsRef 中非标准清单的文件（AI 从正文解析出的自定义引用）
  // 也要进入虚拟树，否则节点不存在 → 无法聚焦流式、保存时落盘循环也访问不到。
  // C5：标准附件不再携带模板占位内容——节点仅显示文件名，实际内容开始时才流式出现。
  const virtualFiles = useMemo(() => {
    const desc = buildDesc(draft) || draft.desc;
    if (!draft.body.trim() && Object.keys(attContentsRef.current).length === 0) return [];
    const name = current?.name || draft.name.trim() || generateSkillName(desc);
    const fm = `name: ${name}\ndescription: ${desc || "TODO"}\nemoji: ${draft.emoji || "🧩"}`;
    const stdPaths = new Set<string>();
    const std = buildAttachmentFiles(name, desc).map((f) => {
      stdPaths.add(f.path);
      return { path: f.path, content: attContentsRef.current[f.path] ?? "" };
    });
    const extra = Object.entries(attContentsRef.current)
      .filter(([p]) => !stdPaths.has(p))
      .map(([p, content]) => ({ path: p, content }));
    return [
      { path: "SKILL.md", content: `---\n${fm}\n---\n${draft.body}` },
      ...std,
      ...extra,
    ];
  }, [draft.body, draft.name, draft.desc, draft.purpose, draft.emoji, current?.name, attVersion]);

  /** Build the complete SKILL.md document for a generated body preview. */
  const buildSkillDocument = useCallback(
    (content: string): string => {
      const clean = sanitizeGeneratedText(content);
      if (splitFrontmatter(clean)) return clean;
      const desc = buildDesc(draft) || draft.desc || "TODO";
      const name = current?.name || draft.name.trim() || generateSkillName(desc);
      const fm = origFm.trim() || `name: ${name}\ndescription: ${desc}\nemoji: ${draft.emoji || "🧩"}`;
      return `---\n${fm}\n---\n${clean}`;
    },
    [current?.name, draft, origFm],
  );

  const selectRightTab = useCallback((tab: "body" | "files" | "evaluate" | "result") => {
    setRightTab(tab);
    if (tab !== "result") setResultPreview(null);
  }, []);

  const openResult = useCallback(
    (messageId: string) => {
      const message = guideMessages.find((item) => item.id === messageId);
      const result = message?.result;
      if (!message || !result) return;
      const fileName = result.kind === "body" ? "SKILL.md" : result.fileRel || "附件文件";
      setResultPreview({
        messageId,
        fileName,
        kind: result.kind,
        content: result.kind === "body" ? buildSkillDocument(message.content) : sanitizeGeneratedText(message.content),
        pending: result.status !== "applied" && !result.applied,
      });
      setRightTab("result");
    },
    [buildSkillDocument, guideMessages],
  );


  // 点击「停止生成」
  const handleStopAI = useCallback(() => {
    aiAbortRef.current?.abort();
  }, []);

  // 流式渲染节流（rAF）：delta 累积到 buffer，每帧最多提交一次 setStream。
  // 长正文流式时 react-markdown 每 delta 全量解析是真实卡顿源；
  // 附件流已有 50ms 节流（runAttachmentGeneration），这里覆盖正文流。
  const streamBufRef = useRef("");
  const streamTextRef = useRef("");
  const streamRafRef = useRef<number | null>(null);
  const flushStreamRaf = useCallback(() => {
    streamRafRef.current = null;
    if (streamBufRef.current) {
      streamTextRef.current += streamBufRef.current;
      setStream(streamTextRef.current);
      streamBufRef.current = "";
    }
  }, []);
  const pushStreamDelta = useCallback(
    (d: string) => {
      streamBufRef.current += d;
      if (streamRafRef.current === null) {
        streamRafRef.current = requestAnimationFrame(flushStreamRaf);
      }
    },
    [flushStreamRaf],
  );
  /** 流结束后同步 flush 残余 buffer（防末尾 delta 滞留在 rAF 队列导致内容丢失） */
  const flushStreamNow = useCallback(() => {
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    if (streamBufRef.current) {
      streamTextRef.current += streamBufRef.current;
      setStream(streamTextRef.current);
      streamBufRef.current = "";
    }
  }, []);
  /** 流开始前重置节流 buffer */
  const resetStreamThrottle = useCallback(() => {
    streamBufRef.current = "";
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
  }, []);

  // 放弃当前生成结果：流式时中止请求，完成后移除待确认草稿
  const handleDismissGeneration = useCallback(() => {
    // 若正在流式生成，先中止请求（防止后台继续消耗资源）
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    resetStreamThrottle();
    streamTextRef.current = "";
    setStreaming(false);
    setStream("");
    setStreamKind("body");
    setStreamFile(null);
    setStreamDone(false);
    setStreamApplied(null);
    thinkStreamRef.current = "";
    setThinkStream("");
  }, [resetStreamThrottle]);

  // 智能审查：基于 shark-skill-creator 规范对当前技能进行全自动 AI 分析
  const runSkillReview = useCallback(async () => {
    if (reviewLoading) return;
    const skillName = current?.name ?? draft.name ?? "未命名技能";
    // 组装当前 SKILL.md 内容（frontmatter + body）
    const desc = buildDesc(draft) || draft.desc;
    const fm = `name: ${skillName}\ndescription: ${desc || "TODO"}`;
    const fullContent = `---\n${fm}\n---\n${draft.body}`;
    // 结构校验报告摘要（已有的 validation 结果）
    const validationSummary = validation
      ? validation.issues.map((i) => `[${i.rule_id}] ${i.message}`).join("\n")
      : "";

    setReviewLoading(true);
    setReviewError(null);
    setReviewResult(null);
    setReviewStream("");
    // 审查可视化：切到附带资源页，打开并高亮 SKILL.md，流式内容实时展示
    selectRightTab("files");
    const controller = new AbortController();
    reviewAbortRef.current = controller;
    try {
      const { text } = await reviewSkillStream(
        skillName,
        fullContent,
        validationSummary,
        (d) => setReviewStream((s) => s + d), // 流式逐行追加（节流无需：渲染量小）
        controller.signal,
      );
      // 解析 JSON 结果
      const parsed = JSON.parse(text) as SkillReviewResult;
      if (typeof parsed.overall_score !== "number" || !Array.isArray(parsed.dimensions)) {
        throw new Error("审查结果格式异常");
      }
      setReviewResult(parsed);
      // 审查完成：切回评估页展示报告
      selectRightTab("evaluate");
      // 持久化报告（一技能一报告）
      const meta: ReviewReportMeta = {
        skillName,
        reviewedAt: new Date().toISOString(),
        issueCount: parsed.issues.length,
      };
      setReportMeta(meta);
      persistReviewReport(meta, parsed);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setReviewError("审查已取消");
      } else {
        setReviewError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setReviewLoading(false);
      reviewAbortRef.current = null;
    }
  }, [reviewLoading, current?.name, draft.name, draft.desc, draft.purpose, draft.body, validation, selectRightTab]);

  // 取消审查：立即终止 AI 请求
  const cancelReview = useCallback(() => {
    reviewAbortRef.current?.abort();
    reviewAbortRef.current = null;
  }, []);

  // 报告持久化：写入技能目录 .review-report.json
  const persistReviewReport = (meta: ReviewReportMeta, result: SkillReviewResult) => {
    const skillDir = current?.skill_dir;
    if (!skillDir) return;
    const reportPayload = JSON.stringify({ meta, result }, null, 2);
    skillWriteFile(skillDir, ".review-report.json", reportPayload).catch(() => {
      // 持久化失败不阻断主流程
    });
  };

  // 加载已持久化的审查报告（进入评估页时调用）
  const loadPersistedReport = useCallback(async () => {
    const skillDir = current?.skill_dir;
    if (!skillDir) return;
    try {
      const raw = await readSkillFile(`${skillDir}/.review-report.json`);
      if (!raw || raw.trim() === "") return;
      const data = JSON.parse(raw) as { meta: ReviewReportMeta; result: SkillReviewResult };
      if (data?.meta && data?.result?.overall_score !== undefined) {
        setReportMeta(data.meta);
        setReviewResult(data.result);
      }
    } catch {
      // 文件不存在或解析失败——忽略
    }
  }, [current?.skill_dir]);

  const getKnownAttachmentPaths = (description: string): string[] => [
    ...buildAttachmentFiles(
      current?.name || draft.name.trim() || generateSkillName(description),
      buildDesc(draft) || draft.desc || description,
    ).map((file) => file.path),
    ...attCandidates,
    ...Object.keys(attContentsRef.current),
  ];

  /**
   * 普通追问只属于聊天：它可以带 thinking，但绝不能被当作 SKILL.md
   * 或附件候选，也不能改变编辑区内容。完成后把 thinking 一起固化到
   * assistant_msg，下一轮开始时只清空临时流，不会影响历史消息。
   */
  const executeChatGeneration = async (input: string) => {
    resetStreamThrottle();
    streamTextRef.current = "";
    setStreaming(true);
    setStreamKind("chat");
    setStreamFile(null);
    setStreamDone(false);
    setStreamApplied(null);
    setStream("");
    thinkStreamRef.current = "";
    setThinkStream("");

    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const history = eventsToMessages(sessionEventsRef.current);
      const messages =
        history.at(-1)?.role === "user" && history.at(-1)?.content === input
          ? history
          : [...history, { role: "user" as const, content: input }];
      const { text } = await chatAuthoringStream({
        messages,
        context: {
          skillName: current?.name || draft.name.trim() || undefined,
          skillDescription: buildDesc(draft) || draft.desc || undefined,
          availableFiles: getKnownAttachmentPaths(input),
        },
        onDelta: pushStreamDelta,
        onThinking: (delta) => {
          thinkStreamRef.current += delta;
          setThinkStream(thinkStreamRef.current);
        },
        abortSignal: controller.signal,
      });

      const reply = text.trim();
      flushStreamNow();
      if (reply) {
        const reasoning = thinkStreamRef.current || undefined;
        const replyId = pushGuideMessage("assistant", reply, {
          reasoning,
        });
        // 历史消息已经接管展示，先清空临时流，再等待 session 落盘，
        // 避免持久化等待期间同一份回答/thinking 出现两次。
        setStream("");
        setStreamDone(false);
        setThinkStream("");
        thinkStreamRef.current = "";
        await recordSession({
          kind: "assistant_msg",
          content: reply,
          extra: {
            messageId: replyId,
            ...(reasoning ? { reasoning } : {}),
          },
        }).catch(() => undefined);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        const partial = `${streamTextRef.current}${streamBufRef.current}`.trim();
        if (partial) {
          const reasoning = thinkStreamRef.current || undefined;
          const replyId = pushGuideMessage("assistant", partial, {
            reasoning,
          });
          setStream("");
          setStreamDone(false);
          setThinkStream("");
          thinkStreamRef.current = "";
          await recordSession({
            kind: "assistant_msg",
            content: partial,
            extra: {
              messageId: replyId,
              ...(reasoning ? { reasoning } : {}),
            },
          }).catch(() => undefined);
        }
        toast.info("已停止聊天生成，已保留已输出内容");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
        const errorId = pushGuideMessage("system", `聊天失败：${msg}`);
        await recordSession({
          kind: "assistant_msg",
          content: `聊天失败：${msg}`,
          extra: { messageId: errorId },
        }).catch(() => undefined);
      }
      setStream("");
      setStreamDone(false);
    } finally {
      flushStreamNow();
      setStreaming(false);
      setStreamKind("body");
      setStreamFile(null);
      setThinkStream("");
      thinkStreamRef.current = "";
      if (aiAbortRef.current === controller) aiAbortRef.current = null;
    }
  };

  // 组件卸载时中止未完成的 AI 生成，避免请求泄漏
  useEffect(
    () => () => {
      aiAbortRef.current?.abort();
      reviewAbortRef.current?.abort();
      fixAbortRef.current?.abort();
    },
    []
  );

  // 能力 2：正文生成——结果先回到创作对话，用户确认后再写入编辑区。
  // 增强：shark-skill-creator 对话式访谈协议——新建技能（无正文）时强制启动动态访谈引导，
  // AI 根据用户回答动态决定下一步问题，收集结构化信息后注入 AI Prompt。
  // overrideDesc：聊天发送时直接携带输入文本，避免与同批 patch(purpose) 的更新时序竞争。
  const runContinue = async (
    skipInterview = false,
    overrideDesc?: string,
    userMessageId?: string,
  ) => {
    if (streaming) return;
    const input = overrideDesc?.trim() || buildDesc(draft) || draft.desc;
    if (!input.trim()) {
      toast.warning("先在创作引导输入框写下想法，再生成正文");
      return;
    }
    const desc = input;
    const knownAttachmentPaths = getKnownAttachmentPaths(desc);
    const intent = detectAuthoringIntent(input, knownAttachmentPaths);
    // 会话回写：用户意图事件（创作引导聊天发送的消息在这里落盘）
    const messageId = userMessageId || pushGuideMessage("user", input);
    await recordSession({
      kind: "user_msg",
      content: input,
      extra: { messageId },
    }).catch(() => undefined);

    if (intent.kind === "attachment") {
      await executeAttachmentGeneration(input, intent.fileRel);
      return;
    }
    if (intent.kind === "attachment_needs_target") {
      const suggestion = knownAttachmentPaths.slice(0, 5).join("、");
      const content = suggestion
        ? `请指定要修改的附件文件路径，例如 ${suggestion}。生成结果会先显示在对话中，确认后才写入文件。`
        : "请指定要修改的附件文件路径，例如 assets/example-template.md。生成结果会先显示在对话中，确认后才写入文件。";
      const replyId = pushGuideMessage("assistant", content);
      await recordSession({
        kind: "assistant_msg",
        content,
        extra: { messageId: replyId },
      }).catch(() => undefined);
      return;
    }
    if (intent.kind === "chat") {
      // 新建技能的第一句话仍然进入访谈；已有技能的普通追问只走聊天。
      if (!draft.body.trim() && !current && !skipInterview) {
        setInterviewActive(true);
        return;
      }
      await executeChatGeneration(input);
      return;
    }
    // 对话式访谈：新建技能（无正文）时强制触发动态访谈引擎
    if (!draft.body.trim() && !skipInterview) {
      setInterviewActive(true);
      return; // 等待访谈完成后再继续
    }
    await executeGeneration(desc);
  };

  const restoreGuideMessagesFromSession = async () => {
    // InterviewGuide writes its last answer/question through the same queue.
    // Wait for that tail before switching back so the current view does not
    // lose the interview transcript until the next session reload.
    await sessionWriteQueueRef.current.catch(() => undefined);
    const mapped = eventsToHistoryMessages(sessionEventsRef.current);
    if (mapped.length === 0) return;
    setGuideMessages((current) => {
      const currentIds = new Set(current.map((message) => message.id));
      return [...mapped, ...current.filter((message) => !currentIds.has(message.id))];
    });
  };

  // 访谈完成回调：接收结构化上下文 + 自动生成 name/emoji，然后执行生成
  const handleInterviewComplete = (structuredContext: string) => {
    setInterviewContext(structuredContext);
    setInterviewActive(false);
    setStreaming(true);
    // 自动生成 Skill 名称 + 随机 Emoji（无需用户手动填写）
    const desc = buildDesc(draft) || draft.desc;
    if (!current && !draft.name.trim()) {
      const autoName = generateSkillName(desc);
      const autoEmoji = COMMON_EMOJI[Math.floor(Math.random() * COMMON_EMOJI.length)];
      patch({ name: autoName, emoji: autoEmoji });
    }
    void restoreGuideMessagesFromSession().then(() => {
      void executeGeneration(desc, structuredContext);
    });
  };

  // 访谈跳过回调：自动生成 name/emoji 后直接进入生成
  const handleInterviewSkip = () => {
    setInterviewActive(false);
    setInterviewContext("");
    setStreaming(true);
    const desc = buildDesc(draft) || draft.desc;
    if (!current && !draft.name.trim()) {
      const autoName = generateSkillName(desc);
      const autoEmoji = COMMON_EMOJI[Math.floor(Math.random() * COMMON_EMOJI.length)];
      patch({ name: autoName, emoji: autoEmoji });
    }
    void restoreGuideMessagesFromSession().then(() => {
      void executeGeneration(desc);
    });
  };

  // B3：打开附件提案（初稿落地后）——合并正文引用与标准结构附件清单
  const openAttachmentProposal = (body: string, desc: string) => {
    const name = current?.name || draft.name.trim() || generateSkillName(desc);
    const merged = [
      ...new Set([
        ...extractAttachmentRefs(body),
        ...buildAttachmentFiles(name, desc).map((f) => f.path),
      ]),
    ];
    setAttCandidates(merged);
    setAttSelected(new Set(merged));
    setAttOpen(true);
  };

  // B3：逐个流式生成已选附件内容。
  // 生成结果先作为聊天中的 attachment_candidate，用户点击「写入文件」后
  // 才进入编辑状态；生成过程中不切换右侧文件区，也不提前修改虚拟文件树。
  const runAttachmentGeneration = async () => {
    const desc = buildDesc(draft) || draft.desc;
    const name = current?.name || draft.name.trim() || generateSkillName(desc);
    const list = attCandidates.filter((p) => attSelected.has(p));
    if (list.length === 0) return;

    // 关闭提案对话框，但保留创作引导，让每个候选都回到当前聊天流。
    setAttOpen(false);
    const controller = new AbortController();
    attAbortRef.current = controller;
    aiAbortRef.current = controller;
    let done = 0;
    for (const path of list) {
      resetStreamThrottle();
      streamTextRef.current = "";
      setStream("");
      setStreamKind("attachment");
      setStreamFile(path);
      setStreamDone(false);
      setStreamApplied(null);
      thinkStreamRef.current = "";
      setThinkStream("");
      setStreaming(true);
      setAttBusy(path);
      setAttProgress({ i: done, total: list.length });
      try {
        const r = await generateAttachmentDraftStream(
          {
            fileRel: path,
            skillName: name,
            skillDescription: desc,
            skillBody: draft.body,
            sessionMessages: eventsToMessages(sessionEventsRef.current),
          },
          pushStreamDelta,
          controller.signal,
        );
        const cleanText = sanitizeGeneratedText(r.text);
        flushStreamNow();
        setStream(cleanText);
        setStreamDone(Boolean(cleanText.trim()));
        if (cleanText.trim()) {
          const reasoning = thinkStreamRef.current || undefined;
          const resultId = pushGuideMessage("assistant", cleanText, {
            reasoning,
            result: { kind: "attachment", fileRel: path },
          });
          const extra: Record<string, string> = {
            messageId: resultId,
            file: path,
          };
          if (reasoning) extra.reasoning = reasoning;
          // 历史文件卡片已经接管展示，先清空临时流，再等待 session 落盘。
          setStream("");
          setStreamDone(false);
          setThinkStream("");
          thinkStreamRef.current = "";
          setStreamFile(null);
          setStreamApplied(null);
          await recordSession({
            kind: "attachment_result",
            content: cleanText,
            extra,
          }).catch(() => undefined);
        } else {
          // 没有可归档的回答时，也不能把孤立的 thinking 留作下一轮临时流。
          setStream("");
          setStreamDone(false);
          setThinkStream("");
          thinkStreamRef.current = "";
          setStreamFile(null);
          setStreamApplied(null);
        }
        done += 1;
        setAttProgress({ i: done, total: list.length });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          flushStreamNow();
          const partial = sanitizeGeneratedText(`${streamTextRef.current}${streamBufRef.current}`);
          if (partial.trim()) {
            const resultId = pushGuideMessage("assistant", partial, {
              reasoning: thinkStreamRef.current || undefined,
              result: { kind: "attachment", fileRel: path },
            });
            await recordSession({
              kind: "attachment_result",
              content: partial,
              extra: {
                messageId: resultId,
                file: path,
                ...(thinkStreamRef.current ? { reasoning: thinkStreamRef.current } : {}),
              },
            }).catch(() => undefined);
          }
          toast.info("已停止附件生成，已生成内容保留在聊天中");
          break;
        }
        toast.error(`附件 ${path} 生成失败，已跳过`);
        done += 1;
      }
    }
    resetStreamThrottle();
    setStream("");
    setStreamDone(false);
    setStreamKind("body");
    setStreamFile(null);
    setThinkStream("");
    thinkStreamRef.current = "";
    setStreaming(false);
    attAbortRef.current = null;
    if (aiAbortRef.current === controller) aiAbortRef.current = null;
    setAttBusy(null);
    setAttProgress(null);
    if (done > 0) {
      toast.success(`已生成 ${done} 个附件内容，保存技能时一并落盘`);
    }
  };

  /** C3：停止附件生成（用户可随时打断） */
  const stopAttachmentGeneration = () => {
    attAbortRef.current?.abort();
  };

  // 实际执行 AI 生成（从 runContinue 拆出，供访谈完成后调用）
  const executeGeneration = async (desc: string, contextOverride?: string) => {
    resetStreamThrottle();
    streamTextRef.current = "";
    setStreaming(true);
    setStreamKind("body");
    setStreamFile(null);
    setStreamDone(false);
    setStreamApplied(null);
    setStream("");
    thinkStreamRef.current = "";
    setThinkStream("");
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const { finishReason, text } = await continueBodyStream(
        desc,
        draft.body,
        pushStreamDelta,
        controller.signal,
        (contextOverride ?? interviewContext) || undefined,
        (d) => {
          thinkStreamRef.current += d;
          setThinkStream(thinkStreamRef.current);
        },
        eventsToMessages(sessionEventsRef.current),
      );
      const cleanText = sanitizeGeneratedText(text);
      if (finishReason === "length") {
        toast.warning("模型输出被截断——可应用后再续写");
      } else {
        toast.success("生成完成，请在对话中确认如何处理");
      }
      resetStreamThrottle();
      setStream(cleanText);
      setStreamDone(Boolean(cleanText.trim()));
      if (cleanText.trim()) {
        const bodyEmptyAtStart = !draft.body.trim();
        const reasoning = thinkStreamRef.current || undefined;
        const resultId = pushGuideMessage("assistant", cleanText, {
          reasoning,
          result: { kind: "body", bodyEmpty: bodyEmptyAtStart },
        });
        const extra: Record<string, string> = {
          messageId: resultId,
          bodyEmpty: String(bodyEmptyAtStart),
        };
        if (reasoning) extra.reasoning = reasoning;
        // 历史文件卡片已经接管展示，先清空临时流，再等待 session 落盘。
        setStream("");
        setStreamDone(false);
        setThinkStream("");
        thinkStreamRef.current = "";
        setStreamFile(null);
        setStreamApplied(null);
          await recordSession({
            kind: "generation_result",
            content: cleanText,
            extra,
          }).catch(() => undefined);
        // C6：AI 标题总结——新建态仍可预先生成技能名，但不会自动写正文。
        if (!current) {
          void (async () => {
            const aiName = await summarizeSkillTitle(desc, cleanText).catch(() => "");
            if (aiName && NAME_RE.test(aiName)) {
              patch({ name: aiName });
            } else if (!draft.name.trim() || !NAME_RE.test(draft.name)) {
              patch({ name: generateSkillName(desc) });
            }
          })();
        }
      } else {
        // 没有可归档的回答时，也不能把孤立的 thinking 留作下一轮临时流。
        setStream("");
        setStreamDone(false);
        setThinkStream("");
        thinkStreamRef.current = "";
        setStreamFile(null);
        setStreamApplied(null);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("已停止生成——已生成部分保留在对话中");
        setStreamDone(true);
        pushGuideMessage("system", "已停止生成，已生成部分保留在对话中，可确认后写入正文。");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
        pushGuideMessage("system", `生成失败：${msg}`);
      }
    } finally {
      // 同步 flush 残余 buffer：末尾 delta 不滞留在 rAF 队列
      flushStreamNow();
      setStreaming(false);
      aiAbortRef.current = null;
    }
  };

  /** 从现有编辑快照、虚拟附件或磁盘读取目标文件，供附件改写使用。 */
  const readAttachmentDraft = async (fileRel: string): Promise<string> => {
    if (Object.prototype.hasOwnProperty.call(editedFilesRef.current, fileRel)) {
      return editedFilesRef.current[fileRel];
    }
    if (Object.prototype.hasOwnProperty.call(attContentsRef.current, fileRel) && attContentsRef.current[fileRel].trim()) {
      return attContentsRef.current[fileRel];
    }
    if (current) {
      try {
        return await readSkillFile(`${current.skill_dir}/${fileRel}`);
      } catch {
        // A new resource may not exist on disk yet.
      }
    }
    return attContentsRef.current[fileRel] ?? "";
  };

  /** 左侧对话中的附件生成：生成结果先进入会话，确认后才更新附件编辑内容。 */
  const executeAttachmentGeneration = async (idea: string, fileRel: string) => {
    const desc = buildDesc(draft) || draft.desc || idea;
    const name = current?.name || draft.name.trim() || generateSkillName(desc);
    resetStreamThrottle();
    streamTextRef.current = "";
    setStreaming(true);
    setStreamKind("attachment");
    setStreamFile(fileRel);
    setStreamDone(false);
    setStreamApplied(null);
    setStream("");
    thinkStreamRef.current = "";
    setThinkStream("");
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const currentFileContent = await readAttachmentDraft(fileRel);
      const { finishReason, text } = await generateFileAssistStream(
        {
          idea,
          fileRel,
          skillName: name,
          skillDescription: desc,
          skillBody: draft.body,
          currentFileContent,
          sessionMessages: eventsToMessages(sessionEventsRef.current),
          onThinking: (delta) => {
            thinkStreamRef.current += delta;
            setThinkStream(thinkStreamRef.current);
          },
        },
        pushStreamDelta,
        controller.signal,
      );
      const cleanText = sanitizeGeneratedText(text);
      if (finishReason === "length") toast.warning("附件输出被截断——可确认部分内容后继续修改");
      else toast.success("附件生成完成，请在对话中确认是否写入");
      resetStreamThrottle();
      setStream(cleanText);
      setStreamDone(Boolean(cleanText.trim()));
      if (cleanText.trim()) {
        const reasoning = thinkStreamRef.current || undefined;
        const resultId = pushGuideMessage("assistant", cleanText, {
          reasoning,
          result: { kind: "attachment", fileRel },
        });
        const extra: Record<string, string> = { messageId: resultId, file: fileRel };
        if (reasoning) extra.reasoning = reasoning;
        // 历史文件卡片已经接管展示，先清空临时流，再等待 session 落盘。
        setStream("");
        setStreamDone(false);
        setThinkStream("");
        thinkStreamRef.current = "";
        setStreamFile(null);
        setStreamApplied(null);
        await recordSession({
          kind: "attachment_result",
          content: cleanText,
          extra,
        }).catch(() => undefined);
      } else {
        // 没有可归档的回答时，也不能把孤立的 thinking 留作下一轮临时流。
        setStream("");
        setStreamDone(false);
        setThinkStream("");
        thinkStreamRef.current = "";
        setStreamFile(null);
        setStreamApplied(null);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("已停止附件生成——已生成部分保留在对话中");
        setStreamDone(true);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
        pushGuideMessage("system", `附件生成失败：${msg}`);
      }
    } finally {
      flushStreamNow();
      setStreaming(false);
      aiAbortRef.current = null;
    }
  };

  // 应用对话中的待确认结果：追加或重写由用户明确选择，默认不覆盖原正文。
  const applyContinue = (mode: "append" | "replace") => {
    const add = sanitizeGeneratedText(stream);
    if (!add) {
      toast.error("续写结果为空——请重试");
      return;
    }
    const bodyWasEmpty = !draft.body.trim();
    const resultId = pushGuideMessage("assistant", add, {
      result: { kind: "body", bodyEmpty: bodyWasEmpty },
    });
    void recordSession({
      kind: "generation_result",
      content: add,
      extra: { messageId: resultId, bodyEmpty: String(bodyWasEmpty) },
    });
    applyBodyResult(resultId, add, mode, bodyWasEmpty);
    setStream("");
    setStreamDone(false);
    setStreamApplied(bodyWasEmpty ? "use" : mode);
  };

  // 真实修改统一入口：经草稿 Hook 标脏 + 落盘；附业务副作用（校验失效）
  const patch = useCallback(
    (p: Partial<WbDraft>) => {
      draftApi.patch(p);
      setValidation(null);
      setCreationState((state) => ({ ...state, validation: null }));
    },
    [draftApi],
  );

  const setGuideResultAction = (messageId: string, action: AuthoringResultAction) => {
    setGuideMessages((list) =>
      list.map((message) =>
        message.id === messageId && message.result
          ? {
              ...message,
              result: { ...message.result, applied: action, status: "applied" },
            }
          : message,
      ),
    );
    setResultPreview((preview) =>
      preview?.messageId === messageId ? { ...preview, pending: false } : preview,
    );
  };

  const recordGuideResultAction = (messageId: string, action: AuthoringResultAction) => {
    void recordSession({
      kind: "result_applied",
      content: "",
      extra: { messageId, action },
    });
  };

  const applyBodyResult = (
    messageId: string,
    content: string,
    mode: "append" | "replace",
    bodyEmptyAtGeneration?: boolean,
  ) => {
    const add = sanitizeGeneratedText(content);
    if (!add) {
      toast.error("生成结果为空——请重试");
      return;
    }
    const bodyWasEmptyAtStart = bodyEmptyAtGeneration ?? !draft.body.trim();
    const bodyIsEmptyNow = !draft.body.trim();
    if (mode === "append" && !bodyIsEmptyNow) {
      patch({ body: `${draft.body.replace(/\s+$/, "")}\n\n${add}` });
      toast.success("已追加续写内容（原正文保留）");
    } else {
      patch({ body: add });
      toast.success(bodyIsEmptyNow ? "已填入正文" : "已重写正文");
    }
    setGuideResultAction(messageId, bodyIsEmptyNow ? "use" : mode);
    if (messageId !== "stream") {
      recordGuideResultAction(messageId, bodyIsEmptyNow ? "use" : mode);
    }
    // 初稿只有在用户确认写入后才生成附件提案，避免未确认的结果触发资源流程。
    if (bodyWasEmptyAtStart) openAttachmentProposal(add, buildDesc(draft) || draft.desc);
  };

  const writeAttachmentResult = (messageId: string) => {
    const message = guideMessages.find((item) => item.id === messageId);
    const fileRel = message?.result?.kind === "attachment" ? message.result.fileRel : undefined;
    const content = message ? sanitizeGeneratedText(message.content) : "";
    if (!fileRel || !content) {
      toast.error("附件结果为空，无法写入");
      return;
    }
    attContentsRef.current[fileRel] = content;
    if (current) editedFilesRef.current[fileRel] = content;
    setAttVersion((version) => version + 1);
    setGuideResultAction(messageId, "write");
    recordGuideResultAction(messageId, "write");
    selectRightTab("files");
    toast.success(`已写入 ${fileRel} 的编辑内容，点击右上角保存落盘`);
  };

  const dismissGuideResult = (messageId: string) => {
    setGuideMessages((list) => list.filter((message) => message.id !== messageId));
    setResultPreview(null);
    selectRightTab("body");
    void recordSession({
      kind: "result_dismissed",
      content: "",
      extra: { messageId },
    });
  };

  // 一键修复：调用 AI 按审查问题自动修正正文 + 自动创建缺失附件（必须在 patch 声明之后，避免 TDZ）
  // 闭环：未保存时自动保存（生成名称+随机emoji）→ 修复正文 → 创建缺失文件 → 展示文件清单
  const runSkillFix = useCallback(async () => {
    if (fixing || !reviewResult || reviewResult.issues.length === 0) return;
    const desc = buildDesc(draft) || draft.desc;
    const createdFiles: string[] = [];

    setFixing(true);
    setFixStream("");
    // 修复可视化：切到附带资源页，打开并高亮 SKILL.md，流式内容实时展示
    selectRightTab("files");
    const controller = new AbortController();
    fixAbortRef.current = controller;
    try {
      // ① 未保存时自动保存：根据描述生成名称 + 随机 emoji
      let skillDir = current?.skill_dir;
      let skillName = current?.name ?? "";
      if (!current && !skillDir) {
        // 自动生成 hyphen-case 名称（取描述前几个英文单词或拼音首字母）
        const autoName = generateSkillName(desc, draft.name);
        const autoEmoji = COMMON_EMOJI[Math.floor(Math.random() * COMMON_EMOJI.length)];
        patch({ name: autoName, emoji: autoEmoji });
        skillName = autoName;
        // 执行保存
        const bodyText = draft.body.trim() ? draft.body : `# ${autoName}\n\nTODO: 待修复后补全。\n`;
        const newFm = `name: ${autoName}\ndescription: ${desc || "TODO"}\nemoji: ${autoEmoji}`;
        if (location === "authored") {
          const r = await skillNew({ name: autoName, description: desc, emoji: autoEmoji, scaffoldResources: draft.scaffold });
          skillDir = r.skill_dir;
        } else {
          const r = await skillCommitDraft(location, { name: autoName, description: desc, emoji: autoEmoji, body: bodyText, scaffold_resources: draft.scaffold });
          skillDir = r.skill_dir;
        }
        await skillWriteFile(skillDir, "SKILL.md", `---\n${newFm}\n---\n${bodyText}`);
        createdFiles.push("SKILL.md（自动创建）");
        toast.success(`已自动保存为「${autoName}」`);
        refresh();
        const all = await scanSkills();
        const found = all.find((s) => s.skill_dir === skillDir) ?? all.find((s) => s.name === autoName);
        if (found) setCurrent(found);
      } else {
        skillName = current?.name ?? draft.name ?? "未命名技能";
      }

      // ② 调用 AI 修复正文
      const { text } = await fixSkillStream(
        skillName,
        desc,
        draft.body,
        reviewResult.issues,
        (d) => setFixStream((s) => s + d), // 修复过程流式展示（当前正在修改什么）
        controller.signal,
      );
      if (!text.trim()) {
        // 关键 Bug 修复：AI 未产出内容时明确失败提示，不再“静默成功”误导用户
        toast.error("AI 未产出修复内容——令牌已消耗，请查看原因或重试");
      } else {
        patch({ body: text.trim() });
        // 写入修复后的 SKILL.md
        if (skillDir) {
          const fm = `name: ${skillName}\ndescription: ${desc || "TODO"}\nemoji: ${draft.emoji || "🧩"}`;
          await skillWriteFile(skillDir, "SKILL.md", `---\n${fm}\n---\n${text.trim()}`);
          createdFiles.push("SKILL.md（已修复）");
        }
      }

      // ③ 按 shark-skill-creator 规范自动创建标准附件（references/scripts/assets）：
      // AI 提案生成内容优先（attContentsRef），占位模板仅兜底；与保存管线保持一致
      if (skillDir) {
        const filesToCreate = buildAttachmentFiles(skillName, desc);
        for (const f of filesToCreate) {
          try {
            await skillWriteFile(skillDir, f.path, attContentsRef.current[f.path] ?? f.content);
            createdFiles.push(f.path);
          } catch { /* 单个文件失败不阻断 */ }
        }
      }

      // ④ 更新报告元数据 + 持久化
      const updatedMeta: ReviewReportMeta = {
        ...(reportMeta ?? {
          skillName,
          reviewedAt: new Date().toISOString(),
          issueCount: reviewResult.issues.length,
        }),
        fixedAt: new Date().toISOString(),
      };
      setReportMeta(updatedMeta);
      if (skillDir && reviewResult) {
        const reportPayload = JSON.stringify({ meta: updatedMeta, result: reviewResult }, null, 2);
        await skillWriteFile(skillDir, ".review-report.json", reportPayload).catch(() => {});
        createdFiles.push(".review-report.json（已更新）");
      }

      // ⑤ 展示修复结果文件清单 + 校验刷新（修复结果持久化验证）
      if (skillDir) {
        await refreshValidation(skillDir).catch(() => undefined);
        refresh();
      }
      if (createdFiles.length > 0) {
        toast.success(`修复完成，共处理 ${createdFiles.length} 个文件：${createdFiles.join("、")}`);
      } else {
        toast.success("已按 shark-skill-creator 规范自动修复正文");
      }
      setFixStream("");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("修复已取消");
      } else {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setFixing(false);
      fixAbortRef.current = null;
    }
  }, [fixing, reviewResult, current, draft.name, draft.desc, draft.purpose, draft.body, draft.emoji, draft.scaffold, reportMeta, patch, location, refresh, selectRightTab]);

  // 3.6：FileTree「插入引用」回调——引用行追加到正文末尾，切回正文 tab 便于查看
  const insertRefLine = useCallback(
    (line: string) => {
      const b = draft.body.replace(/\s+$/, "");
      patch({ body: b ? `${b}\n\n${line}\n` : `${line}\n` });
      selectRightTab("body");
      setPreview((p) => (p === "edit" ? "split" : p));
      toast.success("已插入引用到正文");
    },
    [draft.body, patch, selectRightTab],
  );

  // Ctrl+S（仅 mount 期间）
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nameInvalid = !current && !!draft.name && !NAME_RE.test(draft.name);

  const refreshValidation = useCallback(async (skillDir: string) => {
    const report = await skillValidate(skillDir, "diagnostic");
    setValidation(report);
    setCreationState((state) => ({
      ...state,
      validation: toValidationSummary(report),
    }));
    return report;
  }, []);

  useEffect(() => {
    if (!current) return;
    void refreshValidation(current.skill_dir).catch(() => {
      setValidation(null);
    });
  }, [current, refreshValidation]);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // 阶段 0：description 即「我的描述」(purpose)，兜底存量 desc
    const desc = buildDesc(draft) || draft.desc;
    try {
      if (!current) {
        // 首存 = 创建
        const name = draft.name.trim();
        if (!NAME_RE.test(name)) {
          toast.error("name 必须 hyphen-case（小写字母数字 + 连字符）");
          return;
        }
        let dir: string;
        const bodyText = draft.body.trim()
          ? draft.body
          : `# ${name}\n\nTODO: 在此补全正文。\n`;
        const newFrontmatter = appendPlatformMetadata(
          `name: ${name}\ndescription: ${
            desc || "TODO: describe what this skill does and when to use it"
          }\nemoji: ${yq(draft.emoji || "🧩")}`,
          draft.triggerKeywords,
        );
        if (location === "authored") {
          const r = await skillNew({
            name,
            description: desc,
            emoji: draft.emoji,
            scaffoldResources: draft.scaffold,
          });
          dir = r.skill_dir;
        } else {
          const r = await skillCommitDraft(location, {
            name,
            description: desc,
            emoji: draft.emoji,
            body: draft.body,
            scaffold_resources: draft.scaffold,
          });
          dir = r.skill_dir;
        }
        // Both creation paths receive the same final artifact. In particular,
        // tool-target creation no longer loses emoji/platform metadata.
        await skillWriteFile(dir, "SKILL.md", `---\n${newFrontmatter}\n---\n${bodyText}`);
        // per shark-skill-creator 规范同步创建标准附件（references/scripts/assets）；
        // 已通过 B3 附件提案生成的内容优先（占位模板仅兜底）。
        // B3 修复：除标准清单外，AI 从正文解析出的自定义附件也要一并落盘
        // （此前只在标准 4 文件循环里写盘 → 自定义文件流式生成后保存丢失，致命 bug）。
        const writtenFiles = new Set<string>();
        for (const f of buildAttachmentFiles(name, desc)) {
          await skillWriteFile(
            dir,
            f.path,
            attContentsRef.current[f.path] ?? f.content,
          ).catch(() => {});
          writtenFiles.add(f.path);
        }
        for (const [rel, content] of Object.entries(attContentsRef.current)) {
          if (writtenFiles.has(rel) || !content.trim()) continue;
          await skillWriteFile(dir, rel, content).catch(() => {});
        }
        // 用户手工编辑过的文件（FileTree 编辑器，无局部保存按钮）统一落盘
        for (const [rel, content] of Object.entries(editedFilesRef.current)) {
          await skillWriteFile(dir, rel, content).catch(() => {});
        }
        await refreshValidation(dir);
        draftApi.markClean("new");
        toast.success(`技能 ${name} 已创建（${location}）`);
        refresh();
        const all = await scanSkills();
        const found =
          all.find((s) => s.skill_dir === dir) ??
          all.find((s) => s.name === name);
        if (found) {
          setCurrent(found);
          draftApi.dismissStored();
          // T3：会话归属迁移——草稿键（new）→ 技能 id 键，下次编辑同技能恢复同一会话
          if (sessionIdRef.current) {
            await rememberSessionId(found.id, sessionIdRef.current);
            await forgetSessionId("new");
          }
          setOrigFm(
            `name: ${found.name}\ndescription: ${found.description}\nemoji: ${found.emoji ?? "🧩"}`,
          );
        }
      } else {
        // 编辑态保存
        const fm = appendPlatformMetadata(
          origFm || `name: ${current.name}\ndescription: ${desc}`,
          draft.triggerKeywords,
        );
        await skillWriteFile(
          current.skill_dir,
          "SKILL.md",
          `---\n${fm}\n---\n${draft.body}`,
        );
        // B3 修复：编辑态保存同样落盘全部 AI 生成附件（incl. 自定义引用文件）
        for (const [rel, content] of Object.entries(attContentsRef.current)) {
          if (!content.trim()) continue;
          await skillWriteFile(current.skill_dir, rel, content).catch(() => {});
        }
        // 用户手工编辑过的文件（FileTree 编辑器，无局部保存按钮）统一落盘
        for (const [rel, content] of Object.entries(editedFilesRef.current)) {
          await skillWriteFile(current.skill_dir, rel, content).catch(() => {});
        }
        if (desc !== current.description) {
          await skillEditFrontmatter(current.skill_dir, [
            { key: "description", op: "set", value: desc },
          ]);
        }
        if (draft.emoji !== (current.emoji ?? "🧩")) {
          await skillEditFrontmatter(current.skill_dir, [
            { key: "emoji", op: "set", value: draft.emoji || "🧩" },
          ]);
        }
        await refreshValidation(current.skill_dir);
        draftApi.markClean(current.id);
        toast.success("已保存（Ctrl+S 等效）");
        refresh();
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      toast.error(raw === "EXISTS" ? "同名技能已存在，请换一个 name" : raw);
    } finally {
      setBusy(false);
    }
  }, [busy, current, draft, location, origFm, refresh, refreshValidation, draftApi]);

  useEffect(() => {
    saveRef.current = () => void save();
  }, [save]);

  const handleBack = async () => {
    // 真实修改 或 新建态已发生对话/生成 → 弹确认框（保存 or 主动放弃）
    const hasSessionActivity = sessionEventsRef.current.some(
      (e) => e.kind !== "session_created",
    );
    if (draftApi.dirty || (!current && hasSessionActivity)) {
      setConfirmExit(true);
      return;
    }
    // 新建且全无实际内容：静默退出，同时清理自动创建的会话残留（下次新建干净空态）
    const sid = sessionIdRef.current ?? (await recallSessionId(draftId));
    if (!current) {
      draftApi.clearAll();
      if (sid) {
        await forgetSessionId(draftId);
        void sessionDelete(sid);
      }
    }
    onExit();
  };

  /**
   * 主动放弃创作（「直接返回」）：立即清除草稿快照与会话事件日志，
   * 下次新建呈现干净空态。磁盘技能文件（若已保存）不受影响；
   * 新建立即放弃则彻底清空一切。兜底恢复仅保留给非正常结束（崩溃/强关）。
   */
  const exitWithoutSaving = useCallback(async () => {
    const sid = sessionIdRef.current ?? (await recallSessionId(draftId));
    draftApi.clearAll();
    if (sid) {
      await forgetSessionId(draftId);
      void sessionDelete(sid);
    }
    setConfirmExit(false);
    onExit();
  }, [draftId, draftApi, onExit]);

  // R3-2：预览 pane 内部滚动（min-h-0 破除 flex/grid 子项 min-height:auto 撑高）
  const previewPane = useMemo(
    () => (
      <div className="h-full min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4">
        {draft.body.trim() ? (
          <MarkdownPreview content={draft.body} />
        ) : (
          <div className="grid h-full min-h-64 place-items-center px-6 text-center">
            <div className="max-w-xs">
              <ScrollText className="mx-auto h-8 w-8 text-text-tertiary/70" />
              <p className="mt-3 text-sm font-medium text-text-secondary">正文会在这里出现</p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
                在左侧「创作引导」里描述你的想法并发送，AI 会通过对话访谈带你逐步完成正文。
              </p>
            </div>
          </div>
        )}
      </div>
    ),
    [draft.body],
  );

  // 阶段 / 访谈等状态变化由草稿 Hook 在有脏时统一落盘（查看阶段零写盘）
  const handleStageChange = useCallback(
    (stage: CreationStage) => {
      setCreationState((state) => {
        const next = { ...state, stage };
        // 草稿落盘仅跟随真实修改：查看阶段（无 dirty）不写 localStorage，
        // 否则「打开 → 检查 Skill → 返回 → 再次进入」会误报恢复横幅。
        draftApi.persistIfDirty(next);
        return next;
      });
      // 脏状态修复：阶段切换（含进入「检查 Skill」只读查看）是导航 + 状态机推进，
      // 不是内容修改——不标脏，避免无任何编辑却提示「有未保存的内容」。
      if (stage === CreationStage.Evaluate) {
        selectRightTab("evaluate");
        // 只加载已持久化报告；审查由用户点「开始审查」主动触发（不再自动触发）
        void loadPersistedReport();
      }
      if (stage === CreationStage.Generate || stage === CreationStage.Package) {
        selectRightTab("body");
      }
    },
    [draftApi, loadPersistedReport, selectRightTab],
  );

  // 编辑区工具条（normal / fullscreen 共用；full 时把「全屏」换成「还原」）
  const renderToolbar = (full: boolean) => (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border/50 pb-2">
      <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-glass-1 p-0.5">
        <Button
          variant={rightTab === "body" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => selectRightTab("body")}
        >
          正文
        </Button>
        <Button
          variant={rightTab === "files" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => selectRightTab("files")}
        >
          <FolderTree className="h-3 w-3" />
          附带资源
        </Button>
      </div>
      {rightTab === "result" && resultPreview && (
        <span className="min-w-0 truncate px-1 text-[11px] text-text-tertiary">
          文件预览 · {resultPreview.fileName}
        </span>
      )}
      {rightTab === "body" && (
        <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-glass-1 p-0.5">
          <Button
            variant={preview === "edit" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setPreview("edit")}
          >
            编辑
          </Button>
          <Button
            variant={preview === "split" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setPreview("split")}
          >
            <Columns2 className="h-3 w-3" />
            分栏
          </Button>
          <Button
            variant={preview === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setPreview("preview")}
          >
            <Eye className="h-3 w-3" />
            预览
          </Button>
        </div>
      )}
      <Button
        variant={rightTab === "evaluate" ? "secondary" : "outline"}
        size="sm"
        className="h-7 px-2.5 text-xs"
        onClick={() => handleStageChange(CreationStage.Evaluate)}
      >
        <CircleHelp className="h-3 w-3" />
        检查 Skill
      </Button>
      <div className="flex min-w-2 flex-1" />
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2.5 text-xs"
        title={full ? "还原编辑区" : "全屏编辑区"}
        onClick={() => setEditorFull((o) => !o)}
      >
        {full ? (
          <Minimize2 className="h-3 w-3" />
        ) : (
          <Maximize2 className="h-3 w-3" />
        )}
        <span className="hidden sm:inline">{full ? "还原" : "全屏"}</span>
      </Button>
    </div>
  );

  // 审查须知卡：无报告且无错误时占位（含进行中——原地变进度，不跳版）；错误优先展示重试入口
  const showReviewBrief = !reviewResult && !reviewError;

  // 审查/修复进行中流式展示（附带资源页）：AI 逐行输出可见，无“无尽等待”
  const inspectStreamRef = useRef<HTMLPreElement>(null);
  const inspectStreamText = fixing ? fixStream : reviewStream;
  const inspectActive = reviewLoading || fixing;
  useEffect(() => {
    if (inspectActive && inspectStreamRef.current) {
      inspectStreamRef.current.scrollTop = inspectStreamRef.current.scrollHeight;
    }
  }, [inspectStreamText, inspectActive]);

  // 编辑区内容（正文/附带资源），与工具条解耦，供普通态与全屏复用
  const editorBody =
    rightTab === "result" && resultPreview ? (
      <FileArtifactPreview
        fileName={resultPreview.fileName}
        kind={resultPreview.kind}
        content={resultPreview.content}
        pending={resultPreview.pending}
        onClose={() => selectRightTab("body")}
      />
    ) : rightTab === "evaluate" ? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {showReviewBrief ? (
          /* 无报告：审查须知卡（图形化说明 + 唯一 CTA，绝不自动触发） */
          <SkillReviewBrief
            bodyEmpty={!draft.body.trim()}
            running={reviewLoading}
            onRun={() => void runSkillReview()}
            onCancel={cancelReview}
          />
        ) : (
          /* 有报告 / 出错：结果面板 + 顶部操作条 */
          <section className="rounded-md border border-border/40 bg-glass p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                智能审查
              </h3>
              {/* 加载态由须知卡接管（进度 + 取消都在卡内），此处只留「重新审查」 */}
              {reviewResult && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-6 shrink-0 gap-1 px-2 text-[11px] transition-colors hover:bg-primary/10 hover:text-text-primary"
                  onClick={() => void runSkillReview()}
                >
                  <Sparkles className="h-3 w-3" />
                  重新审查
                </Button>
              )}
            </div>
            <SkillReviewPanel
              review={reviewResult}
              error={reviewError}
              reportMeta={reportMeta}
              onRetry={() => void runSkillReview()}
              onFix={() => void runSkillFix()}
              fixing={fixing}
            />
          </section>
        )}
      </div>
    ) : rightTab === "files" ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {inspectActive && (
          <div className="mb-2 flex shrink-0 flex-col gap-1 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>
                {fixing
                  ? "正在修复 正文："
                  : "正在审查 正文："}
                <span className="font-mono text-text-primary">SKILL.md</span>
              </span>
              <span className="flex-1" />
              <span className="font-mono text-[10px] text-text-tertiary">AI 输出实时展示在下方</span>
              {reviewLoading && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px] !text-red-500 !border-red-400/60 hover:!bg-red-500/10"
                  onClick={cancelReview}
                >
                  取消
                </Button>
              )}
            </div>
            {inspectStreamText && (
              <pre
                ref={inspectStreamRef}
                className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md bg-glass-1/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-secondary"
              >
                {inspectStreamText}
              </pre>
            )}
          </div>
        )}
        {attProgress && attBusy && (
          <div className="mb-2 flex shrink-0 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>
              正在生成附件 {attProgress.i + 1}/{attProgress.total}：
              <span className="font-mono text-text-primary">{attBusy}</span>
            </span>
            <span className="flex-1" />
            <span className="font-mono text-[10px] text-text-tertiary">生成结果会回到左侧对话，确认后再写入</span>
            {/* C3：用户可随时打断附件生成 */}
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] !text-red-500 !border-red-400/60 hover:!bg-red-500/10"
              onClick={stopAttachmentGeneration}
              title="停止附件生成（已生成的文件保留）"
            >
              <Square className="h-3 w-3" />
              停止
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FileTree
            skill={current}
            onInsertReference={insertRefLine}
            virtualFiles={virtualFiles}
            autoOpenPath={inspectActive ? "SKILL.md" : null}
            highlightPath={inspectActive ? "SKILL.md" : null}
            onFileContentChange={(rel, content) => {
              // 无局部保存按钮：编辑内容统一由右上角「保存」落盘
              if (current) {
                editedFilesRef.current[rel] = content;
              } else {
                attContentsRef.current[rel] = content;
              }
            }}
          />
        </div>
      </div>
    ) : (
      <div
        className={
          preview === "split"
            ? "grid min-h-0 flex-1 grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        {preview !== "preview" && (
          <textarea
            value={draft.body}
            onChange={(e) => patch({ body: e.target.value })}
            className="h-full min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-md border border-input bg-transparent p-3.5 font-mono text-sm leading-[1.7]"
          />
        )}
        {preview !== "edit" && previewPane}
      </div>
    );

  return (
    // R3-2：整页 h-dvh 列布局，页面不滚；pt-4(16)+顶栏 h-12(48)=64 → 抽屉 top-16 对齐
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-3">
      {/* X1 顶栏：整页不滚后恒可见（保留 sticky 无害） */}
      <AuthoringHeader
        editingName={current?.name}
        emoji={draft.emoji}
        name={draft.name}
        nameInvalid={nameInvalid}
        onPatch={patch}
        location={location}
        onLocationChange={setLocation}
        tools={tools}
        dirty={dirty}
        descOpen={descOpen}
        onToggleDesc={() => setDescOpen((o) => !o)}
        editorOpen={editorOpen}
        onToggleEditor={() => setEditorOpen((o) => !o)}
        onBack={handleBack}
        onOpenSettings={onOpenSettings}
        busy={busy}
        onSave={() => void save()}
      />

      {/* 草稿恢复横幅（三态） */}
      {stored && (
        <DraftRestoreBanner
          savedAt={fmtSavedAt(stored.savedAt)}
          onRestore={() => {
            const snapshot = stored;
            const restoredState =
              snapshot.creationState ??
              migrateWbDraftToCreationState(snapshot.draft, {
                id: current?.id ?? null,
                targetLocation: location,
              });
            draftApi.restoreStored();
            setCreationState(restoredState);
          }}
          onDismiss={draftApi.dismissStored}
          onDiscard={draftApi.discardStored}
        />
      )}

      {/* 主体 R3：编辑列常显；左「创作引导」（聊天态 / 访谈态）进 Sheet 抽屉（R3-1）；
          AI 流式结果回到对话消息（R3-3），确认后再更新编辑器；全内部滚动（R3-2）。
          抽屉展开时主行 padding-left 推让 400px + 16px 间隙。 */}
      <div
        ref={(n) => {
          setRowEl(n);
        }}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col gap-4 transition-[padding-left] duration-300 ease-out xl:flex-row",
          descOpen && "xl:pl-[376px]",
        )}
      >
        {/* 编辑列（不再被参考/流式替换；可整体收起） */}
        {editorOpen && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {renderToolbar(false)}
          {editorBody}
        </div>
        )}

      </div>

      {/* R5 左侧推拉抽屉：Portal 锚定主行内 absolute——四角圆；
          top-0 与工具条行齐平、left-0 与顶部吸附栏左缘同线、bottom-0 与编辑区底齐平；
          警告行在主行之上，永不被遮 */}
      {rowEl && (
        <Sheet open={descOpen} onOpenChange={setDescOpen} modal={false}>
          <SheetContent
            side="left"
            portalContainer={rowEl}
            overlayClassName="hidden"
            showCloseButton={false}
            // 推拉抽屉：点编辑区等外部不收起（复制正文不误触），仅顶栏按钮 / Esc 收起
            onInteractOutside={(e) => e.preventDefault()}
            className="absolute bottom-0 left-0 top-0 flex w-[min(360px,88vw)] flex-col rounded-lg border p-0 sm:max-w-[360px]"
          >
            <SheetHeader className="gap-0 px-5 pb-3 pt-4">
              <SheetTitle className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                创作引导
              </SheetTitle>
            </SheetHeader>
            {interviewActive ? (
              <InterviewGuide
                description={draft.purpose}
                onComplete={handleInterviewComplete}
                onSkip={handleInterviewSkip}
                busy={streaming}
                onRecord={recordSession}
                // 访谈只重放聊天消息；正文/附件候选是文件产物，不能反向
                // 注入访谈上下文，否则下一次生成会把候选正文当用户需求。
                initialMessages={guideMessages.filter(
                  (message) => message.messageKind === "chat" && !message.result,
                )}
              />
            ) : (
              <CreationGuidePanel
                description={draft.purpose}
                bodyEmpty={!draft.body.trim()}
                busy={streaming}
                messages={guideMessages}
                stream={stream}
                streamKind={streamKind}
                streamFile={streamFile}
                thinkStream={thinkStream}
                streamDone={streamDone}
                streamApplied={streamApplied}
                onStop={handleStopAI}
                onApply={applyContinue}
                onWriteAttachment={() => {
                  const content = sanitizeGeneratedText(stream);
                  if (!streamFile || !content) {
                    toast.error("附件结果为空，无法写入");
                    return;
                  }
                  attContentsRef.current[streamFile] = content;
                  if (current) editedFilesRef.current[streamFile] = content;
                  setAttVersion((version) => version + 1);
                  setStream("");
                  setStreamDone(false);
                  setStreamFile(null);
                  toast.success(`已写入 ${streamFile} 的编辑内容，点击右上角保存落盘`);
                }}
                onDismiss={handleDismissGeneration}
                onApplyResult={(messageId, mode) => {
                  const result = guideMessages.find((message) => message.id === messageId)?.result;
                  applyBodyResult(messageId, guideMessages.find((message) => message.id === messageId)?.content ?? "", mode, result?.bodyEmpty);
                }}
                onWriteResult={writeAttachmentResult}
                onDismissResult={dismissGuideResult}
                onOpenResult={openResult}
                onSend={(text) => {
                  const knownPaths = getKnownAttachmentPaths(text);
                  const intent = detectAuthoringIntent(text, knownPaths);
                  // 新建技能首条描述作为 purpose 保存；后续聊天内容不能污染正文或描述。
                  if (!current && !draft.body.trim() && !draft.purpose.trim()) {
                    patch({ purpose: text });
                  } else if (intent.kind === "body" && !draft.body.trim()) {
                    patch({ purpose: text });
                  }
                  const messageId = pushGuideMessage("user", text);
                  void runContinue(false, text, messageId);
                }}
              />
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* 编辑区全屏：覆盖层顶部保留完整工具栏（正文/附带资源 + 编辑/分栏/预览 + 还原） */}
      {editorFull && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-0)] p-4">
          <div className="mb-3 shrink-0 rounded-md border border-border/40 bg-glass-1 px-2 py-1.5">
            {renderToolbar(true)}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{editorBody}</div>
        </div>
      )}

      {/* B3 附件提案：初稿落地后按需生成 references/scripts 内容 */}
      <AttachProposalDialog
        open={attOpen}
        onOpenChange={(o) => {
          if (!attBusy) setAttOpen(o);
        }}
        candidates={attCandidates}
        selected={attSelected}
        onToggle={(p) => {
          const next = new Set(attSelected);
          if (next.has(p)) next.delete(p);
          else next.add(p);
          setAttSelected(next);
        }}
        busy={attBusy}
        onGenerate={() => void runAttachmentGeneration()}
      />

      {/* 返回保护 */}
      <Dialog
        open={confirmExit}
        onOpenChange={(o) => !o && setConfirmExit(false)}
      >
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>有未保存改动</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-xs leading-relaxed text-muted-foreground">
            草稿已自动兜底到本地——直接返回后，下次进入可恢复。
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmExit(false)}
            >
              取消
            </Button>
            <Button variant="ghost" size="sm" onClick={exitWithoutSaving}>
              直接返回
            </Button>
            <Button
              size="sm"
              disabled={busy || nameInvalid}
              onClick={() => {
                void save().then(() => onExit());
              }}
            >
              保存并返回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
