import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  Code2,
  Columns2,
  Copy,
  Eye,
  FolderTree,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeft,
  Save,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  StopCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/common/Tip";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import { FileTree } from "./FileTree";
import { SkillReviewPanel, type ReviewReportMeta } from "./SkillReviewPanel";
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
import { continueBodyStream, fixSkillStream, reviewSkillStream, type SkillReviewResult } from "@/lib/authoring-api";
import { loadLLMConfig } from "@/lib/llm-config";
import { isMockMode, MOCK_TOOLS } from "@/mock";
import {
  EMPTY_DRAFT,
  NAME_RE,
  clearDraft,
  fmtSavedAt,
  loadDraft,
  storeDraft,
  type StoredDraft,
  type WbDraft,
} from "@/lib/wb-draft";
import {
  createDefaultCreationState,
  CreationStage,
  migrateWbDraftToCreationState,
  mergeWbDraftIntoCreationState,
  type SkillCreationState,
  type ValidationSummary,
} from "@/lib/creation-state";
import { CreationGuidePanel } from "./CreationGuidePanel";
import { InterviewGuide } from "./InterviewGuide";

/**
 * 创作工作台（PLAN-08 精修第三轮）。
 * R3-1 「我的描述」改为左侧推拉抽屉（shadcn Sheet，非模态）；
 *      PLAN-11 阶段 0：删「何时用」，抽屉只留「我的描述」单输入（description 即 purpose）；
 * R3-2 整页不滚：h-dvh 列布局，编辑器/参考/流式 pane 全部内部滚动；
 * R3-3 内容参考 & AI 流式改为右侧并列辅助 pane（不再替换编辑器、不挤压左工作区）。
 * 继承：X1 沉浸顶；X4 AI 创作 Dialog + 流式 + 回显；X5 emoji 全链路。
 */
interface AuthoringWorkbenchProps {
  skill: Skill | null; // null = 新建态
  skills: Skill[]; // 内容参考候选（全局扫描结果，按 scan_label 分组）
  /** 新建态落点预选（从技能库「在当前目录下创作」进入时带上工具名/ID） */
  initialLocation?: string | null;
  refresh: () => void;
  onOpenSettings: () => void;
  onExit: () => void;
}

type PreviewMode = "edit" | "split" | "preview";

function splitFrontmatter(md: string): { fm: string; body: string } | null {
  if (!md.startsWith("---")) return null;
  const rest = md.slice(3);
  const idx = rest.indexOf("\n---");
  if (idx < 0) return null;
  return {
    fm: rest.slice(0, idx).replace(/^\n/, ""),
    body: rest.slice(idx + 4).replace(/^\n/, ""),
  };
}

/**
 * 「我的描述」→ description。
 * PLAN-11 阶段 0：面板单输入，description 即「我的描述」(purpose)，不再拼「何时用」。
 */
function buildDesc(d: WbDraft): string {
  return d.purpose.trim();
}

/** YAML 标量安全引号（emoji 直拼 frontmatter 用；含特殊字符/空 → JSON 引号）。 */
function yq(s: string): string {
  if (s === "" || /[:#]|["'\\]|^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

function appendPlatformMetadata(frontmatter: string, keywords: string[]): string {
  const clean = keywords.map((item) => item.trim()).filter(Boolean);
  const lines = frontmatter.replace(/\s+$/, "").split("\n");
  const metadataAt = lines.findIndex((line) => line.trim() === "metadata:");
  if (metadataAt < 0) {
    return clean.length === 0
      ? frontmatter
      : [
          ...lines,
          "metadata:",
          "  skills-shark:",
          "    trigger_keywords:",
          ...clean.map((keyword) => `      - ${yq(keyword)}`),
        ].join("\n");
  }

  let metadataEnd = metadataAt + 1;
  while (metadataEnd < lines.length && !/^[^\s]/.test(lines[metadataEnd])) {
    metadataEnd++;
  }
  const metadataLines = lines.slice(metadataAt + 1, metadataEnd);
  const withoutPlatform: string[] = [];
  for (let i = 0; i < metadataLines.length; i++) {
    if (metadataLines[i].trim() === "skills-shark:") {
      i++;
      while (i < metadataLines.length && /^\s{4}/.test(metadataLines[i])) i++;
      i--;
      continue;
    }
    withoutPlatform.push(metadataLines[i]);
  }
  if (clean.length === 0) {
    return [
      ...lines.slice(0, metadataAt + 1),
      ...withoutPlatform,
      ...lines.slice(metadataEnd),
    ].join("\n");
  }
  const platformLines = [
    "  skills-shark:",
    "    trigger_keywords:",
    ...clean.map((keyword) => `      - ${yq(keyword)}`),
  ];
  return [
    ...lines.slice(0, metadataAt + 1),
    ...withoutPlatform,
    ...platformLines,
    ...lines.slice(metadataEnd),
  ].join("\n");
}

function toValidationSummary(report: ValidationReport): ValidationSummary {
  const errorCount = report.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = report.issues.filter((issue) => issue.severity === "warn").length;
  const infoCount = report.issues.filter((issue) => issue.severity === "info").length;
  return {
    mode: report.mode,
    verdict: errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass",
    errorCount,
    warningCount,
    infoCount,
    issueCount: report.issues.length,
    checkedAt: new Date().toISOString(),
  };
}

/** emoji 快选网格（X5），可再自定义输入。 */
const COMMON_EMOJI = [
  "✍️",
  "🧩",
  "🛠️",
  "🧪",
  "📦",
  "🔍",
  "🌐",
  "📊",
  "🤖",
  "📝",
  "⚡",
  "🔧",
  "🧠",
  "🚀",
  "🗂️",
  "🔔",
  "🎯",
  "📚",
  "🧮",
  "💾",
];

/** 根据描述自动生成 hyphen-case 技能名称（不重复） */
function generateSkillName(description: string, existingName?: string): string {
  // 如果用户已填写了合法名称，直接使用
  if (existingName && NAME_RE.test(existingName)) return existingName;
  // 从描述中提取英文单词
  const words = description
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && /^[a-zA-Z]/.test(w))
    .slice(0, 3)
    .map((w) => w.toLowerCase());
  if (words.length > 0) {
    return words.join("-").slice(0, 40);
  }
  // 中文描述：用时间戳生成唯一名称
  const ts = Date.now().toString(36).slice(-6);
  return `skill-${ts}`;
}

/**
 * 按 shark-skill-creator 规范构建标准附件清单（references/scripts/assets 三目录）。
 * 与旧 buildMissingFiles 的区别：不再依赖审查问题条件触发，而是始终产出
 * 规范要求的完整附件骨架，确保 SKILL.md 与附件同时生成。
 */
function buildAttachmentFiles(
  skillName: string,
  description: string,
): Array<{ path: string; content: string }> {
  return [
    {
      path: "references/domain-knowledge.md",
      content: `# ${skillName} 领域知识\n\n> 本文档存放技能执行所需的深层领域知识，供 SKILL.md 正文按需引用（渐进披露）。\n\n## 核心概念\n\n- ${description.slice(0, 80) || skillName}\n\n## 规则与约束\n\n- 待补充：根据实际使用场景添加领域规则。\n\n## 常见错误与处理\n\n- 待补充：记录常见失败场景及应对策略。\n`,
    },
    {
      path: "references/guardrails.md",
      content: `# ${skillName} 护栏规则\n\n> 本文档定义技能执行时必须遵守的规则和禁止行为。\n\n## 必须遵守（Must）\n\n- 输出前验证结果完整性\n- 信息不足时主动追问，不做假设\n\n## 禁止行为（Must Not）\n\n- 编造不存在的信息或数据\n- 超出技能范围处理不相关请求\n\n## 不确定时策略（Uncertainty Policy）\n\n- 如实说明不确定性\n- 提供可能的方向而非武断结论\n- 建议用户补充信息后重试\n`,
    },
    {
      path: "scripts/validate_input.py",
      content: `#!/usr/bin/env python3\n"""${skillName} 输入校验脚本。\n\n确定性操作：校验用户输入是否符合技能要求，不应交给 LLM 猜测。\n"""\nimport sys\n\n\ndef validate(input_text: str) -> tuple[bool, str]:\n    """校验输入是否有效。返回 (是否通过, 消息)。"""\n    if not input_text or not input_text.strip():\n        return False, "输入不能为空"\n    if len(input_text.strip()) < 5:\n        return False, "输入过短，请提供更完整的信息"\n    return True, "输入有效"\n\n\ndef main() -> int:\n    if len(sys.argv) < 2:\n        print("用法: python validate_input.py <input_text>")\n        return 1\n    ok, msg = validate(sys.argv[1])\n    print(msg)\n    return 0 if ok else 1\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n`,
    },
    {
      path: "assets/example-template.md",
      content: `# ${skillName} 输出模板\n\n> 本模板定义技能输出的标准格式，确保结果一致性。\n\n## 输出结构\n\n\`\`\`markdown\n# [主题]\n\n## 摘要\n[一句话概括]\n\n## 详细分析\n[分点展开]\n\n## 建议\n[可操作的下一步]\n\`\`\`\n\n## 使用示例\n\n**输入**：示例输入内容\n**输出**：按上述模板格式化的结果\n`,
    },
  ];
}

/** 写作准则（X6 问号悬浮内容）。 */
const GUIDELINES = (
  <div className="flex flex-col gap-1">
    <span>
      · description 一句话说清「做什么 + 何时用」——模型只凭它决定是否使用
    </span>
    <span>· 正文祈使句书写，不用第二人称</span>
    <span>· 长资料拆到 references/，正文保持精简</span>
    <span>· name 用 hyphen-case，与目录名一致</span>
  </div>
);

export function AuthoringWorkbench({
  skill,
  skills,
  initialLocation,
  refresh,
  onOpenSettings,
  onExit,
}: AuthoringWorkbenchProps) {
  const [current, setCurrent] = useState<Skill | null>(skill);
  const draftId = current?.id ?? "new";

  const [draft, setDraft] = useState<WbDraft>({ ...EMPTY_DRAFT });
  const [creationState, setCreationState] = useState<SkillCreationState>(() =>
    createDefaultCreationState({ id: skill?.id ?? null }),
  );
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [origFm, setOrigFm] = useState("");
  const [dirty, setDirty] = useState(false);
  const [stored, setStored] = useState<StoredDraft | null>(null);
  const [location, setLocation] = useState("authored");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [preview, setPreview] = useState<PreviewMode>("split");
  const [rightTab, setRightTab] = useState<"body" | "files" | "evaluate">(
    "body",
  );
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [refSkillId, setRefSkillId] = useState("");
  const [refContent, setRefContent] = useState("");
  // 参考 pane：渲染/源码 视图切换 + 全屏预览（用户可全屏看、可复制 md 原文）
  const [refView, setRefView] = useState<"render" | "raw">("render");
  const [refFull, setRefFull] = useState(false);
  // 中间编辑区可收起：收起后仅留左「我的描述」+ 右参考 pane
  const [editorOpen, setEditorOpen] = useState(true);
  // 编辑区全屏：覆盖层顶部保留完整工具栏（正文/附带资源 + 编辑/分栏/预览 + 还原）
  const [editorFull, setEditorFull] = useState(false);
  // 参考全屏视图：渲染 / 源码 / 分栏（渲染+源码左右并列）
  const [refFullView, setRefFullView] = useState<"render" | "raw" | "split">(
    "render",
  );
  // X4：AI 创作（顶栏按钮 + Dialog + 右侧流式预览）
  const [stream, setStream] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 右侧 pane 流式用途——create=一句话全文 / continue=续写正文（追加）
  // 用户「停止生成」的中止控制器：挂到 ref，供按钮 + 卸载时调用
  const aiAbortRef = useRef<AbortController | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const [llmReady, setLlmReady] = useState(true);
  // 引导式访谈状态（shark-skill-creator 对话式创建协议，动态 AI 驱动）
  const [interviewActive, setInterviewActive] = useState(false);
  const [interviewContext, setInterviewContext] = useState("");
  // 智能审查状态（shark-skill-creator 规则，全自动化）
  const [reviewResult, setReviewResult] = useState<SkillReviewResult | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  // 审查报告持久化元数据（一技能一报告）
  const [reportMeta, setReportMeta] = useState<ReviewReportMeta | null>(null);
  // 一键修复状态
  const [fixing, setFixing] = useState(false);
  const fixAbortRef = useRef<AbortController | null>(null);
  // 60s 未保存淡入「没灵感？试试 AI 创作」；保存成功重置
  // X5 emoji 快选 Popover
  const [emojiOpen, setEmojiOpen] = useState(false);
  // R3-1 左侧「我的描述」推拉抽屉（默认展开，可收起以最大化编辑区）
  const [descOpen, setDescOpen] = useState(true);
  // R4：主行 DOM 节点——抽屉 Portal 锚定进主行（absolute），与 Markdown 区水平对齐
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  // R6：#2 右侧 AI 流式预览滚动容器——流式期间追随输出到底部（同翻译功能）
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const dirtyRef = useRef(false);
  const setDirtyAll = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);

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

  // 初始加载：磁盘内容 + 存量草稿检测 + LLM 配置探测
  useEffect(() => {
    setStored(loadDraft(draftId));
    if (!isMockMode()) {
      loadLLMConfig()
        .then((c) => setLlmReady(!!c.hasKey))
        .catch(() => setLlmReady(false));
    }
    if (current) {
      // PLAN-11 阶段 0：存量 description 直接回显「我的描述」单输入，抽屉不空白
      setDraft((d) => ({
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
            setDraft((d) => ({ ...d, body: parts.body }));
          } else {
            setDraft((d) => ({ ...d, body: md }));
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

  // 内容参考分组（全局 skills 按 scan_label）
  const refGroups = useMemo(() => {
    const m = new Map<string, Skill[]>();
    for (const s of skills) {
      const k = s.scan_label || "未分类";
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [skills]);

  // 选中参考 → 只读加载 SKILL.md（右侧渲染）
  useEffect(() => {
    if (!refSkillId) {
      setRefContent("");
      return;
    }
    const s = skills.find((x) => x.id === refSkillId);
    if (!s) return;
    readSkillFile(s.source_path)
      .then(setRefContent)
      .catch(() => setRefContent("（读取失败）"));
  }, [refSkillId, skills]);

  const refName = useMemo(
    () => skills.find((s) => s.id === refSkillId)?.name ?? "",
    [skills, refSkillId],
  );

  // 虚拟附件预览（未保存即可见）：AI 生成正文后，立即在 FileTree 渲染
  // SKILL.md + 标准附件（references/scripts/assets）的结构与内容，保存仅为最终落盘。
  const virtualFiles = useMemo(() => {
    const desc = buildDesc(draft) || draft.desc;
    if (!draft.body.trim()) return [];
    const name = current?.name || draft.name.trim() || generateSkillName(desc);
    const fm = `name: ${name}\ndescription: ${desc || "TODO"}\nemoji: ${draft.emoji || "🧩"}`;
    return [
      { path: "SKILL.md", content: `---\n${fm}\n---\n${draft.body}` },
      ...buildAttachmentFiles(name, desc),
    ];
  }, [draft.body, draft.name, draft.desc, draft.purpose, draft.emoji, current?.name]);


  // R6：#2 流式跟随滚动——每次内容落地把预览容器钉到底部（同翻译功能）；
  // 流式结束后不再干预用户滚动。
  useEffect(() => {
    if (!streaming) return;
    const el = previewScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream, streaming]);

  // 点击「停止生成」
  const handleStopAI = useCallback(() => {
    aiAbortRef.current?.abort();
  }, []);

  // 关闭右侧 AI 输出面板：彻底终止生成进程 + 清除流式状态
  const handleCloseStreamPanel = useCallback(() => {
    // 若正在流式生成，先中止请求（防止后台继续消耗资源）
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setStreaming(false);
    setStream("");
    setStreamDone(false);
  }, []);

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
    const controller = new AbortController();
    reviewAbortRef.current = controller;
    try {
      const { text } = await reviewSkillStream(
        skillName,
        fullContent,
        validationSummary,
        () => {}, // 审查结果不需要流式显示，等待完整 JSON
        controller.signal,
      );
      // 解析 JSON 结果
      const parsed = JSON.parse(text) as SkillReviewResult;
      if (typeof parsed.overall_score !== "number" || !Array.isArray(parsed.dimensions)) {
        throw new Error("审查结果格式异常");
      }
      setReviewResult(parsed);
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
  }, [reviewLoading, current?.name, draft.name, draft.desc, draft.purpose, draft.body, validation]);

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

  // 组件卸载时中止未完成的 AI 生成，避免请求泄漏
  useEffect(
    () => () => {
      aiAbortRef.current?.abort();
      reviewAbortRef.current?.abort();
      fixAbortRef.current?.abort();
    },
    []
  );

  // PLAN-11 能力 2：续写正文——复用右侧 pane 流式预览；A 无正文生成全文 / B 有正文续写不覆盖
  // 增强：shark-skill-creator 对话式访谈协议——新建技能（无正文）时强制启动动态访谈引导，
  // AI 根据用户回答动态决定下一步问题，收集结构化信息后注入 AI Prompt。
  const runContinue = async (skipInterview = false) => {
    if (streaming) return;
    const desc = buildDesc(draft) || draft.desc;
    if (!desc.trim()) {
      toast.warning("先填写「我的描述」再续写正文");
      return;
    }
    // 对话式访谈：新建技能（无正文）时强制触发动态访谈引擎
    if (!draft.body.trim() && !skipInterview) {
      setInterviewActive(true);
      return; // 等待访谈完成后再继续
    }
    await executeGeneration(desc);
  };

  // 访谈完成回调：接收结构化上下文 + 自动生成 name/emoji，然后执行生成
  const handleInterviewComplete = (structuredContext: string) => {
    setInterviewContext(structuredContext);
    setInterviewActive(false);
    // 自动生成 Skill 名称 + 随机 Emoji（无需用户手动填写）
    const desc = buildDesc(draft) || draft.desc;
    if (!current && !draft.name.trim()) {
      const autoName = generateSkillName(desc);
      const autoEmoji = COMMON_EMOJI[Math.floor(Math.random() * COMMON_EMOJI.length)];
      patch({ name: autoName, emoji: autoEmoji });
    }
    void executeGeneration(desc);
  };

  // 访谈跳过回调：自动生成 name/emoji 后直接进入生成
  const handleInterviewSkip = () => {
    setInterviewActive(false);
    setInterviewContext("");
    const desc = buildDesc(draft) || draft.desc;
    if (!current && !draft.name.trim()) {
      const autoName = generateSkillName(desc);
      const autoEmoji = COMMON_EMOJI[Math.floor(Math.random() * COMMON_EMOJI.length)];
      patch({ name: autoName, emoji: autoEmoji });
    }
    void executeGeneration(desc);
  };

  // 实际执行 AI 生成（从 runContinue 拆出，供访谈完成后调用）
  const executeGeneration = async (desc: string) => {
    setRefSkillId(""); // 关参考，右栏让位给流式
    setStreaming(true);
    setStreamDone(false);
    setStream("");
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const { finishReason, text } = await continueBodyStream(
        desc,
        draft.body,
        (d) => setStream((s) => s + d),
        controller.signal,
        interviewContext || undefined,
      );
      if (finishReason === "length") {
        toast.warning("模型输出被截断——可应用后再续写");
      } else if (!draft.body.trim() && text.trim()) {
        // 初稿是主路径：正文为空时，正常完成的结果直接落地到编辑器。
        // 中止或截断仍保留在辅助预览中，避免半成品静默覆盖草稿。
        patch({ body: text });
        setStream("");
        setStreamDone(false);
        setRightTab("body");
        setPreview("split");
        toast.success("初稿已生成，可以继续修改");
      } else {
        setStreamDone(true);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("已停止续写——已生成部分保留在预览中");
        setStreamDone(true);
      } else {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
      aiAbortRef.current = null;
    }
  };

  // PLAN-11 能力 2：应用续写——情况 A 填入 / 情况 B 追加（绝不覆盖原正文）
  const applyContinue = () => {
    const add = stream.trim();
    if (!add) {
      toast.error("续写结果为空——请重试");
      return;
    }
    if (draft.body.trim()) {
      patch({ body: `${draft.body.replace(/\s+$/, "")}\n\n${add}` });
      toast.success("已追加续写内容（原正文保留）");
    } else {
      patch({ body: add });
      toast.success("已填入正文");
    }
    setStream("");
    setStreamDone(false);
  };

  // 草稿兜底：dirty 变更同步写 localStorage
  const patch = useCallback(
    (p: Partial<WbDraft>) => {
      setDraft((d) => {
        const next = { ...d, ...p };
        storeDraft(
          draftId,
          next,
          mergeWbDraftIntoCreationState(creationState, next, {
            id: current?.id ?? null,
            targetLocation: location,
          }),
        );
        return next;
      });
      setValidation(null);
      setCreationState((state) => ({ ...state, validation: null }));
      setDirtyAll(true);
    },
    [creationState, current?.id, draftId, location, setDirtyAll],
  );

  // 一键修复：调用 AI 按审查问题自动修正正文 + 自动创建缺失附件（必须在 patch 声明之后，避免 TDZ）
  // 闭环：未保存时自动保存（生成名称+随机emoji）→ 修复正文 → 创建缺失文件 → 展示文件清单
  const runSkillFix = useCallback(async () => {
    if (fixing || !reviewResult || reviewResult.issues.length === 0) return;
    const desc = buildDesc(draft) || draft.desc;
    const createdFiles: string[] = [];

    setFixing(true);
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
        () => {}, // 修复结果等待完整输出
        controller.signal,
      );
      if (text.trim()) {
        patch({ body: text.trim() });
        // 写入修复后的 SKILL.md
        if (skillDir) {
          const fm = `name: ${skillName}\ndescription: ${desc || "TODO"}\nemoji: ${draft.emoji || "🧩"}`;
          await skillWriteFile(skillDir, "SKILL.md", `---\n${fm}\n---\n${text.trim()}`);
          createdFiles.push("SKILL.md（已修复）");
        }
      }

      // ③ 按 shark-skill-creator 规范自动创建标准附件（references/scripts/assets）
      if (skillDir) {
        const filesToCreate = buildAttachmentFiles(skillName, desc);
        for (const f of filesToCreate) {
          try {
            await skillWriteFile(skillDir, f.path, f.content);
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

      // ⑤ 展示修复结果文件清单
      if (createdFiles.length > 0) {
        toast.success(`修复完成，共处理 ${createdFiles.length} 个文件：${createdFiles.join("、")}`);
      } else {
        toast.success("已按 shark-skill-creator 规范自动修复正文");
      }
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
  }, [fixing, reviewResult, current, draft.name, draft.desc, draft.purpose, draft.body, draft.emoji, draft.scaffold, reportMeta, patch, location, refresh]);

  // PLAN-11 3.6：FileTree「插入引用」回调——引用行追加到正文末尾，切回正文 tab 便于查看
  const insertRefLine = useCallback(
    (line: string) => {
      const b = draft.body.replace(/\s+$/, "");
      patch({ body: b ? `${b}\n\n${line}\n` : `${line}\n` });
      setRightTab("body");
      setPreview((p) => (p === "edit" ? "split" : p));
      toast.success("已插入引用到正文");
    },
    [draft.body, patch],
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
    // PLAN-11 阶段 0：description 即「我的描述」(purpose)，兜底存量 desc
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
        // 按 shark-skill-creator 规范同步创建标准附件（references/scripts/assets）
        for (const f of buildAttachmentFiles(name, desc)) {
          await skillWriteFile(dir, f.path, f.content).catch(() => {});
        }
        await refreshValidation(dir);
        clearDraft("new");
        setDirtyAll(false);
        toast.success(`技能 ${name} 已创建（${location}）`);
        refresh();
        const all = await scanSkills();
        const found =
          all.find((s) => s.skill_dir === dir) ??
          all.find((s) => s.name === name);
        if (found) {
          setCurrent(found);
          setStored(null);
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
        clearDraft(current.id);
        setDirtyAll(false);
        toast.success("已保存（Ctrl+S 等效）");
        refresh();
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      toast.error(raw === "EXISTS" ? "同名技能已存在，请换一个 name" : raw);
    } finally {
      setBusy(false);
    }
  }, [busy, current, draft, location, origFm, refresh, refreshValidation, setDirtyAll]);

  useEffect(() => {
    saveRef.current = () => void save();
  }, [save]);

  const handleBack = () => {
    if (dirtyRef.current) setConfirmExit(true);
    else onExit();
  };

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
                先写下左侧的想法，再点击“生成初稿”。生成后内容仍然可以直接编辑。
              </p>
            </div>
          </div>
        )}
      </div>
    ),
    [draft.body],
  );

  // Keep evaluation/interview/state changes recoverable even when no legacy
  // editor field changed in the same turn.
  useEffect(() => {
    if (!dirtyRef.current) return;
    storeDraft(draftId, draft, creationState);
  }, [creationState, draft, draftId]);

  const handleStageChange = useCallback(
    (stage: CreationStage) => {
      setCreationState((state) => {
        const next = { ...state, stage };
        storeDraft(draftId, draft, next);
        return next;
      });
      setDirtyAll(true);
      if (stage === CreationStage.Evaluate) {
        setRightTab("evaluate");
        // 进入评估阶段：优先加载已持久化报告，无报告时自动触发审查
        void loadPersistedReport().then(() => {
          // loadPersistedReport 内部会设置 reviewResult，若仍为 null 则触发新审查
          setReviewResult((prev) => {
            if (!prev) void runSkillReview();
            return prev;
          });
        });
      }
      if (stage === CreationStage.Generate || stage === CreationStage.Package) {
        setRightTab("body");
      }
    },
    [draft, draftId, setDirtyAll, runSkillReview, loadPersistedReport],
  );

  // 编辑区工具条（normal / fullscreen 共用；full 时把「全屏」换成「还原」）
  const renderToolbar = (full: boolean) => (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border/50 pb-2">
      <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-glass-1 p-0.5">
        <Button
          variant={rightTab === "body" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setRightTab("body")}
        >
          正文
        </Button>
        <Button
          variant={rightTab === "files" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setRightTab("files")}
        >
          <FolderTree className="h-3 w-3" />
          附带资源
        </Button>
      </div>
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

  // 编辑区内容（正文/附带资源），与工具条解耦，供普通态与全屏复用
  const editorBody =
    rightTab === "evaluate" ? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 智能审查（shark-skill-creator 规范，全自动化，无人工评估） */}
        <section className="rounded-md border border-border/40 bg-glass-1 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              智能审查
            </h3>
            <div className="flex items-center gap-1.5">
              {reviewLoading && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] !border-red-400/60 !text-red-500 hover:!bg-red-500/10"
                  onClick={cancelReview}
                >
                  <StopCircle className="h-3 w-3" />
                  取消
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={reviewLoading}
                onClick={() => void runSkillReview()}
                className="h-6 px-2 text-[11px]"
              >
                {reviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {reviewResult ? "重新审查" : "开始审查"}
              </Button>
            </div>
          </div>
          <SkillReviewPanel
            review={reviewResult}
            loading={reviewLoading}
            error={reviewError}
            reportMeta={reportMeta}
            onRetry={() => void runSkillReview()}
            onCancel={cancelReview}
            onFix={() => void runSkillFix()}
            fixing={fixing}
          />
        </section>
      </div>
    ) : rightTab === "files" ? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree skill={current} onInsertReference={insertRefLine} virtualFiles={virtualFiles} />
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
      <div className="sticky top-0 z-40 grid shrink-0 gap-3 rounded-lg border border-border/50 bg-[var(--bg-0)]/95 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-3 lg:flex-nowrap">
          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={handleBack} aria-label="返回创作列表">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="选择技能图标"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-input bg-transparent text-lg leading-none hover:bg-glass-2"
              >
                {draft.emoji || "🧩"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60">
              <div className="grid grid-cols-8 gap-1">
                {COMMON_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded text-base hover:bg-glass-2"
                    onClick={() => {
                      patch({ emoji: e });
                      setEmojiOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <Input
                value={draft.emoji}
                onChange={(e) => patch({ emoji: e.target.value })}
                className="mt-2 h-7 text-center text-sm"
                maxLength={10}
                placeholder="或输入图标"
              />
            </PopoverContent>
          </Popover>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 lg:flex-nowrap">
            {current ? (
              <Tip label="编辑态名称只读，返回创作列表后可改名">
                <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-text-primary">
                  {current.name}
                </h1>
              </Tip>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="给这个 skill 起个名称"
                  className="h-9 w-52 max-w-full font-mono text-[13px]"
                />
                {nameInvalid && <span className="text-[11px] text-red-400">需使用小写字母、数字和连字符</span>}
              </div>
            )}
            {!current && (
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger size="sm" className="h-8 w-fit min-w-36 border-0 px-0 text-[11px] text-text-tertiary shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="authored">保存到创作库</SelectItem>
                  {tools.map((t) => <SelectItem key={t.id} value={t.id}>保存到 {t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-1.5 lg:flex-nowrap lg:justify-end lg:whitespace-nowrap">
          {dirty && (
            <Tip label="有未保存改动，草稿已自动保存">
              <span className="mr-1 h-2 w-2 rounded-full bg-amber-400" />
            </Tip>
          )}
          <Button size="sm" variant={descOpen ? "secondary" : "ghost"} aria-pressed={descOpen} onClick={() => setDescOpen((o) => !o)}>
            <PanelLeft className="h-3.5 w-3.5" />
            <span>创作引导</span>
          </Button>
          <Button size="sm" variant={editorOpen ? "secondary" : "ghost"} aria-pressed={editorOpen} onClick={() => setEditorOpen((o) => !o)}>
            <Columns2 className="h-3.5 w-3.5" />
            <span>编辑区</span>
          </Button>
          {llmReady ? (
            <Button size="sm" disabled={streaming || !draft.purpose.trim()} onClick={() => void runContinue()}>
              <Sparkles className="h-3.5 w-3.5" />
              {draft.body.trim() ? "继续完善" : "生成初稿"}
            </Button>
          ) : (
            <Tip side="bottom" label="未配置 LLM，请先打开设置填写 API Key">
              <Button size="sm" disabled><Sparkles className="h-3.5 w-3.5" />生成初稿</Button>
            </Tip>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="设置" onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" disabled={busy || nameInvalid} onClick={() => void save()}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            <Save className="h-3 w-3" />保存
          </Button>
        </div>
      </div>

      {/* 草稿恢复横幅（三态） */}
      {stored && (
        <div className="flex items-center gap-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-text-secondary">
          <span>检测到未保存草稿（{fmtSavedAt(stored.savedAt)} 保存）</span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(stored.draft);
              const restoredState =
                stored.creationState ??
                migrateWbDraftToCreationState(stored.draft, {
                  id: current?.id ?? null,
                  targetLocation: location,
                });
              setCreationState(restoredState);
              setDirtyAll(true);
              setStored(null);
            }}
          >
            恢复草稿
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStored(null)}>
            用磁盘内容
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400"
            onClick={() => {
              clearDraft(draftId);
              setStored(null);
            }}
          >
            丢弃草稿
          </Button>
        </div>
      )}

      {/* 主体 R3：编辑列常显；左「我的描述」进 Sheet 抽屉（R3-1）；
          参考 / AI 流式进右侧辅助 pane（R3-3，不挤压编辑器）；全内部滚动（R3-2）。
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

        {/* 右侧辅助 pane（R3-3 并列不挤压；R3-2 内部滚动，页面不滚） */}
        {(refSkillId || streaming || streamDone) && (
          <aside
            className={cn(
              "flex h-[min(320px,42vh)] min-h-0 shrink-0 flex-col gap-3 xl:h-full",
              editorOpen ? "w-full xl:w-[36%] xl:max-w-[520px]" : "min-w-0 flex-1",
            )}
          >
            {refSkillId ? (
              // 参考头部：窄栏空间有限 → 动作全部收成纯图标按钮（悬停提示），
              // 单行排布不换行，「关闭」不再被挤到第二行。
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-glass-1 px-2 py-1.5 text-xs text-text-secondary">
                <ScrollText className="h-3.5 w-3.5 shrink-0 text-primary" />
                {/* 参考说明：圆圈问号悬停展示 tag */}
                <Tip
                  side="bottom"
                  label={`内容参考 · ${refName} · 只读，不进草稿`}
                >
                  <button
                    type="button"
                    aria-label="参考说明"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors hover:bg-glass-2 hover:text-text-primary"
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </button>
                </Tip>
                <div className="min-w-0 flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  title="全屏预览参考"
                  aria-label="全屏预览参考"
                  onClick={() => setRefFull(true)}
                >
                  <Maximize2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  title={refView === "render" ? "查看 md 源码" : "查看渲染"}
                  aria-label={refView === "render" ? "查看源码" : "查看渲染"}
                  onClick={() =>
                    setRefView((v) => (v === "render" ? "raw" : "render"))
                  }
                >
                  {refView === "render" ? (
                    <Code2 className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  title="复制 md 原文（方便抄表格等写法）"
                  aria-label="复制参考源码"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(refContent)
                      .then(() => toast.success("已复制参考源码"));
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 hover:text-destructive"
                  title="关闭参考"
                  aria-label="关闭参考"
                  onClick={() => setRefSkillId("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 flex-wrap items-center gap-2 gap-y-1 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-text-secondary">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>{streaming ? "正在完善正文，生成内容会先显示在这里" : "补充内容已生成，可追加到正文"}</span>
                <div className="flex-1" />
                {streaming && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px] !text-red-500 !border-red-400/60 hover:!bg-red-500/10"
                    onClick={handleStopAI}
                    title="停止生成（已生成部分保留在预览中）"
                  >
                    <StopCircle className="h-3 w-3" />
                    停止
                  </Button>
                )}
                {streamDone && (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={applyContinue}
                    title="追加到原正文之后（不覆盖）"
                  >
                    追加到正文
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 hover:text-destructive"
                  title={streaming ? "关闭面板并停止生成" : "关闭面板"}
                  aria-label="关闭 AI 输出面板"
                  onClick={handleCloseStreamPanel}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div
              // R6：#2 流式预览滚动容器（streaming 期间自动追随底部）
              ref={previewScrollRef}
              className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4"
            >
              {refSkillId && refView === "raw" ? (
                <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.7] text-text-secondary">
                  {refContent || "（读取中…）"}
                </pre>
              ) : (
                <MarkdownPreview
                  content={
                    refSkillId
                      ? refContent || "（读取中…）"
                      : stream + (streaming ? "\n▍" : "")
                  }
                />
              )}
            </div>
          </aside>
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
            <SheetHeader className="flex-row items-center justify-between px-5 pb-1 pt-4">
              <SheetTitle className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                创作引导
              </SheetTitle>
              <Tip side="bottom" hoverOnly label={GUIDELINES}>
                <button
                  type="button"
                  aria-label="写作准则"
                  className="grid h-6 w-6 place-items-center rounded text-text-tertiary hover:bg-glass-2 hover:text-text-primary"
                >
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              </Tip>
            </SheetHeader>
            {interviewActive ? (
              <InterviewGuide
                description={draft.purpose}
                onComplete={handleInterviewComplete}
                onSkip={handleInterviewSkip}
                busy={streaming}
              />
            ) : (
              <CreationGuidePanel
                description={draft.purpose}
                bodyEmpty={!draft.body.trim()}
                busy={streaming}
                onDescriptionChange={(value) => patch({ purpose: value })}
                onGenerateBody={() => void runContinue()}
              />
            )}
            <div className="shrink-0 border-t border-border/40 px-5 py-3">
                <div className="flex items-center gap-2">
                  <ScrollText className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold text-text-primary">内容参考</h4>
                </div>
                <div className="mt-2">
                  <Select
                    value={refSkillId}
                    onValueChange={(v) => {
                      setRefSkillId(v);
                      setStream("");
                      setStreamDone(false);
                    }}
                    disabled={streaming}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue placeholder="选一个技能查看其 SKILL.md（右侧辅助 pane）" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {refGroups.map(([label, arr]) => (
                        <SelectGroup key={label}>
                          <SelectLabel>{label}</SelectLabel>
                          {arr.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.emoji || "🧩"} {s.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
            </div>
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

      {/* 参考全屏预览：fixed 覆盖层，独立于主行布局——可全屏看、可切源码、可复制 */}
      {refFull && refSkillId && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-0)] p-4">
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 gap-y-1 rounded-md border border-border/40 bg-glass-1 px-3 py-2 text-xs text-text-secondary">
            <ScrollText className="h-3.5 w-3.5 text-primary" />
            <Tip side="bottom" label={`内容参考 · ${refName} · 全屏预览`}>
              <button
                type="button"
                aria-label="参考说明"
                className="grid h-5 w-5 place-items-center rounded-full text-text-tertiary hover:bg-glass-2 hover:text-text-primary"
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </button>
            </Tip>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setRefFull(false)}
            >
              <Minimize2 className="h-3 w-3" />
              还原
            </Button>
            <Button
              variant={refFullView === "raw" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setRefFullView("raw")}
            >
              <Code2 className="h-3 w-3" />
              源码
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(refContent)
                  .then(() => toast.success("已复制参考源码"));
              }}
            >
              <Copy className="h-3 w-3" />
              复制
            </Button>
            <Button
              variant={refFullView === "split" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setRefFullView("split")}
            >
              <Columns2 className="h-3 w-3" />
              分栏
            </Button>
            <Button
              variant={refFullView === "render" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setRefFullView("render")}
            >
              <Eye className="h-3 w-3" />
              预览
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setRefFull(false);
                setRefSkillId("");
              }}
            >
              <X className="h-3 w-3" />
              关闭参考
            </Button>
          </div>
          {refFullView === "split" ? (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
              <div className="min-h-0 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-6">
                <MarkdownPreview content={refContent || "（读取中…）"} />
              </div>
              <pre className="min-h-0 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/40 bg-glass-1 p-6 font-mono text-[13px] leading-[1.7] text-text-secondary">
                {refContent || "（读取中…）"}
              </pre>
            </div>
          ) : refFullView === "raw" ? (
            <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/40 bg-glass-1 p-6 font-mono text-[13px] leading-[1.7] text-text-secondary">
              {refContent || "（读取中…）"}
            </pre>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-6">
              <MarkdownPreview content={refContent || "（读取中…）"} />
            </div>
          )}
        </div>
      )}

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
            <Button variant="ghost" size="sm" onClick={onExit}>
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
