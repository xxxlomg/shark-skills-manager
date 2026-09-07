/**
 * 阶段 2-4：统一合并工作台（总览着陆 + 变体流水线 + SaveDialog）。
 *
 * 心智（D4）：选基底 + 折入其余 —— variants = buildVariants(group)，
 * V==1 无流水线（直接处置副本）、V==2 一步三向、V>2 流水线，同一组件吃 variants。
 * 小白：进入 → 「全部采纳默认」→ 保存；专家：逐条决策 / 切基准 / 展开三向详情。
 *
 * 关键修复（P4/P5/P7）：
 *  - P4：决策计数 = confirmed 真实计数（附件确认后减少）；
 *  - P5：附件 chip 单实例（按 rel 去重、唯一 key），冲突数徽标「K 版本不同」；
 *  - P7：字母体系 = variants 字母，全链路一贯（基准恒为 A，其余按流水线序 B…）。
 *
 * 基准切换（D3）：确认弹窗 → 全量重置（不迁移）；上游选择变更 → 下游截断重算。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  dupResolveMany,
  readSkillFile,
  readFileBase64,
  skillListFiles,
  smartMergeApply,
  type CopyOp,
  type DupGroup,
  type FileNode,
} from "@/lib/api";
import { isImageRel } from "@/lib/utils";
import {
  buildThreeWayView,
  parseFm,
  renderThreeWayText,
  resolveConflictText,
  type BlockChoice,
  type MergeConflict,
  type ThreeWayView,
} from "@/lib/merge";
import { buildVariants, pathTail, recommendReason, toolDot, type Variant } from "@/lib/variants";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { callLLMStream, prompts } from "@/lib/ai";
import { loadLLMConfig } from "@/lib/llm-config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MultiMergeWorkbenchProps {
  group: DupGroup;
  /** 进入时选定的基准成员 skill_id（推荐基准） */
  baseId: string;
  onBack: () => void;
  onResolved: () => void;
}

/** 一步流水线：把某变体三向合入「累积结果」 */
interface StepState {
  variant: Variant;
  view: ThreeWayView;
  conflicts: MergeConflict[];
  confirmed: Set<string>;
}

/** 累积附件（rel → 首个引入它的变体代表） */
interface AccFile {
  rel: string;
  fromId: string;
  content: string | null;
}

/** 附件冲突：同名不同内容（累积版 vs 某变体版），同一 rel 可多条 */
interface FileConflict {
  id: string;
  rel: string;
  fromId: string;
  fromName: string;
  baseContent: string | null;
  otherContent: string | null;
  chosen: "base" | "other" | "both";
}

/** 同名图片附件：不判冲突，渲染预览 + 基底优先（默认保留累积版，用户可换版本） */
interface ImageTweak {
  id: string;
  rel: string;
  fromId: string;
  fromName: string;
  baseData: string | null;
  otherData: string | null;
  chosen: "base" | "other" | "both";
}

function stripFm(md: string): string {
  return md.replace(/(^---\r?\n[\s\S]*?\r?\n---\r?\n?)/, "");
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx > 0 ? p.slice(0, idx) : p;
}

function fmtPath(p: string): string {
  const IS_WIN = typeof navigator !== "undefined" && /win/i.test(navigator.platform || "");
  return p.replace(/[\\/]+/g, IS_WIN ? "\\" : "/");
}

function fmLine(key: string, val: string): string {
  const one = val.replace(/\s+/g, " ").trim();
  return `${key}: ${one}`;
}

function flattenFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.is_dir) flattenFiles(n.children, out);
    else out.push(n.rel.replace(/\\/g, "/"));
  }
  return out;
}

function fromBName(rel: string, letter: string): string {
  const dot = rel.lastIndexOf(".");
  const stem = dot > 0 ? rel.slice(0, dot) : rel;
  const ext = dot > 0 ? rel.slice(dot) : "";
  return `${stem}.from-${letter.toLowerCase()}${ext}`;
}

function displayLetter(idx: number): string {
  return String.fromCharCode(65 + idx);
}

/** 冲突行内展开的三向详情（A 累积｜结果｜B 变体） */
function ConflictDetail({ c }: { c: MergeConflict }) {
  const cell = (label: string, text: string, tone: "a" | "result" | "b") => (
    <div className="min-w-0">
      <span
        className={`mb-1 block font-mono text-[10px] ${
          tone === "a" ? "text-red-400/90" : tone === "b" ? "text-emerald-500/90" : "text-brand"
        }`}
      >
        {label}
      </span>
      <pre
        className={`max-h-56 overflow-auto whitespace-pre-wrap break-words border-l-2 p-2 text-[11px] leading-relaxed text-text-secondary ${
          tone === "a"
            ? "border-red-400/60 bg-card/40"
            : tone === "b"
              ? "border-emerald-400/60 bg-card/40"
              : "border-brand/60 bg-brand/[.03]"
        }`}
      >
        {text || "（空）"}
      </pre>
    </div>
  );
  return (
    <div className="grid gap-2 pt-2 text-[11px] sm:grid-cols-[1fr_1.15fr_1fr]">
      {cell("A · 累积", c.aContent, "a")}
      {cell("结果", resolveConflictText(c), "result")}
      {cell("B · 变体", c.bContent, "b")}
    </div>
  );
}

export function MultiMergeWorkbench({ group, baseId, onBack, onResolved }: MultiMergeWorkbenchProps) {
  // ---- 变体与基准（身份语言单一来源）----
  const variants = useMemo(() => buildVariants(group), [group]);
  const initialLetter = useMemo(() => {
    const v = variants.find((x) => x.members.some((m) => m.skill_id === baseId));
    return v?.letter ?? variants[0]?.letter ?? "A";
  }, [variants, baseId]);
  const [baseLetter, setBaseLetter] = useState(initialLetter);

  /** 基准在前，其余按推荐序；字母 = 流水线序（基准恒为 A） */
  const ordered = useMemo(() => {
    const base = variants.find((v) => v.letter === baseLetter) ?? variants[0];
    return [base, ...variants.filter((v) => v.letter !== baseLetter)];
  }, [variants, baseLetter]);

  const V = variants.length;
  const N = group.members.length;
  const recommendedId = variants[0]?.rep.skill_id ?? "";
  const baseVariant = ordered[0];

  // V1 全等处置：保留项为「成员级」——用户可任选一份副本保留，而非只能保留推荐基准
  const [keepId, setKeepId] = useState<string>(
    () => variants[0]?.rep.skill_id ?? group.members[0]?.skill_id ?? "",
  );
  const keepMember = useMemo(
    () =>
      group.members.find((m) => m.skill_id === keepId) ??
      variants[0]?.rep ??
      group.members[0],
    [group.members, keepId, variants],
  );

  const displayLetterOf = useCallback(
    (id: string): string => {
      const idx = ordered.findIndex((v) => v.rep.skill_id === id);
      return idx >= 0 ? displayLetter(idx) : "x";
    },
    [ordered]
  );

  // ---- 加载变体代表正文 + 附件 ----
  const [bodies, setBodies] = useState<Record<string, string> | null>(null);
  const [files, setFiles] = useState<Record<string, string[]> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [steps, setSteps] = useState<StepState[]>([]);

  // ---- 附件 ----
  const [accFiles, setAccFiles] = useState<AccFile[] | null>(null);
  const [fileConflicts, setFileConflicts] = useState<FileConflict[]>([]);
  // 同名图片（不占冲突决策位，基底优先，可切换版本）
  const [imgTweaks, setImgTweaks] = useState<ImageTweak[]>([]);
  const [confirmedFiles, setConfirmedFiles] = useState<Set<string>>(new Set());

  // ---- UI 状态 ----
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  /** 预览面板：closed 收起 / open 展开（半屏，分隔栏可拖拽） */
  const [previewMode, setPreviewMode] = useState<"closed" | "open">("closed");
  const [previewWidth, setPreviewWidth] = useState(440);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmBase, setConfirmBase] = useState<{ letter: string; decided: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false); // V==1 处置确认
  const [busy, setBusy] = useState(false);

  // ---- 基本信息（SaveDialog 与右栏折叠区共用）----
  const [name, setName] = useState(group.members[0]?.name ?? "");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("");
  const [triggers, setTriggers] = useState("");

  // ---- AI 润色（阶段 5：统一进右栏，各 V 分支一致）----
  const [hasKey, setHasKey] = useState(false);
  const [polishBusy, setPolishBusy] = useState(false);
  const [polishText, setPolishText] = useState("");
  const [polishedBody, setPolishedBody] = useState<string | null>(null);
  const [polishPane, setPolishPane] = useState(false);
  /** 手动编辑/已应用润色的正文（null = 跟随流水线投影） */
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toggleExpanded = (k: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  // ---- 加载（只读变体代表，不读 N 份）----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bodyMap: Record<string, string> = {};
        const fileMap: Record<string, string[]> = {};
        await Promise.all(
          variants.map(async (v) => {
            bodyMap[v.rep.skill_id] = await readSkillFile(v.rep.source_path);
            const nodes = await skillListFiles(v.rep.skill_dir);
            fileMap[v.rep.skill_id] = flattenFiles(nodes).filter((r) => r.toLowerCase() !== "skill.md");
          })
        );
        if (alive) {
          setBodies(bodyMap);
          setFiles(fileMap);
        }
      } catch (e) {
        if (alive) setLoadErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [variants]);

  // ---- LLM key ----
  useEffect(() => {
    let alive = true;
    loadLLMConfig()
      .then((c) => {
        if (alive) setHasKey(!!c.apiKey);
      })
      .catch(() => {
        if (alive) setHasKey(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // ---- 流水线重建（纯函数）：keepThrough 之前的步保留，之后按当前选择重算 ----
  const rebuild = useCallback(
    (ord: Variant[], bodyMap: Record<string, string>, prev: StepState[], keepThrough: number): StepState[] => {
      const kept = prev.slice(0, keepThrough + 1);
      const out = [...kept];
      let left =
        keepThrough >= 0
          ? renderThreeWayText(kept[keepThrough].view.rows, kept[keepThrough].conflicts)
          : stripFm(bodyMap[ord[0].rep.skill_id] ?? "");
      for (let i = keepThrough + 1; i < ord.length - 1; i++) {
        const v = ord[i + 1];
        const view = buildThreeWayView(left, stripFm(bodyMap[v.rep.skill_id] ?? ""));
        out.push({ variant: v, view, conflicts: view.conflicts.map((c) => ({ ...c })), confirmed: new Set<string>() });
        left = renderThreeWayText(view.rows, out[i].conflicts);
      }
      return out;
    },
    []
  );

  // ---- 初始化 / 基准切换后：全量重建 + frontmatter 跟随基准 ----
  useEffect(() => {
    if (!bodies || !files) return;
    const baseMd = bodies[ordered[0].rep.skill_id] ?? "";
    const fm = parseFm(baseMd);
    setName(fm.name || group.members[0]?.name || "");
    setDescription(fm.description || "");
    setEmoji(fm.emoji || "");
    setTriggers(fm.trigger_keywords || "");
    setSteps(rebuild(ordered, bodies, [], -1));
    setSelectedFile(null);
    setPreviewMode("closed");
    setExpanded(new Set());
    setEditedBody(null);
    setPolishedBody(null);
    setPolishPane(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, files, ordered]);

  // ---- 附件累积（按流水线序 = 基准在前；去重到 rel；同 rel 异内容 → 冲突）----
  // 与正文流水线一致：累积版 = 首个引入者（基准优先）；基准切换（ordered 变化）→ 全量重算。
  useEffect(() => {
    if (!files) return;
    let alive = true;
    (async () => {
      const read = async (dir: string, rel: string): Promise<string | null> => {
        try {
          // 图片走二进制 data URL（文本读二进制会失败且被误判冲突）；其余走文本
          return isImageRel(rel)
            ? await readFileBase64(`${dir}/${rel}`)
            : await readSkillFile(`${dir}/${rel}`);
        } catch {
          return null;
        }
      };
      const accMap = new Map<string, AccFile>();
      const fconf: FileConflict[] = [];
      const imgs: ImageTweak[] = [];
      for (const v of ordered) {
        for (const rel of files[v.rep.skill_id] ?? []) {
          const content = await read(v.rep.skill_dir, rel);
          const have = accMap.get(rel);
          if (!have) {
            accMap.set(rel, { rel, fromId: v.rep.skill_id, content });
          } else if (have.content !== content) {
            if (isImageRel(rel)) {
              // 同名图片：不标冲突，渲染预览 + 基底优先（默认保留累积版）
              imgs.push({
                id: `${rel}@${v.rep.skill_id}`,
                rel,
                fromId: v.rep.skill_id,
                fromName: v.rep.scan_label,
                baseData: have.content,
                otherData: content,
                chosen: "base",
              });
            } else {
              fconf.push({
                id: `${rel}@${v.rep.skill_id}`,
                rel,
                fromId: v.rep.skill_id,
                fromName: v.rep.scan_label,
                baseContent: have.content,
                otherContent: content,
                chosen: "base",
              });
            }
          }
        }
      }
      if (alive) {
        setAccFiles([...accMap.values()]);
        setFileConflicts(fconf);
        setImgTweaks(imgs);
        setConfirmedFiles(new Set());
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, ordered]);

  // ---- 冲突选择：更新该步 + 下游截断重算 ----
  const chooseConflict = (stepIdx: number, id: string, ch: BlockChoice) => {
    setSteps((prev) => {
      const updated = prev.map((s, i) =>
        i === stepIdx
          ? {
              ...s,
              conflicts: s.conflicts.map((c) => (c.id === id ? { ...c, chosen: ch } : c)),
              confirmed: new Set(s.confirmed).add(id),
            }
          : s
      );
      return rebuild(ordered, bodies!, updated, stepIdx);
    });
  };

  const chooseFile = (id: string, ch: "base" | "other" | "both") => {
    setFileConflicts((cs) => cs.map((c) => (c.id === id ? { ...c, chosen: ch } : c)));
    setConfirmedFiles((s) => new Set(s).add(id));
  };

  /** 同名图片切换版本（基底优先，不占冲突决策位） */
  const chooseImageTweak = (id: string, ch: "base" | "other" | "both") => {
    setImgTweaks((ts) => ts.map((t) => (t.id === id ? { ...t, chosen: ch } : t)));
  };

  /** 全部采纳默认：默认选择已预填，仅把未确认项登记为已确认（手动选过的保留） */
  const acceptAllDefaults = () => {
    setSteps((prev) => prev.map((s) => ({ ...s, confirmed: new Set(s.conflicts.map((c) => c.id)) })));
    setConfirmedFiles(new Set(fileConflicts.map((c) => c.id)));
  };

  // ---- AI 润色（右栏）----
  const doPolish = async () => {
    setPolishBusy(true);
    setPolishText("");
    setPolishedBody(null);
    setPolishPane(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      const cfg = await loadLLMConfig();
      if (!cfg.apiKey) {
        toast.error("请先在「设置 → LLM 配置」中填写 API Key");
        setPolishPane(false);
        return;
      }
      const prompt = prompts.buildMergePolishPrompt(buildMd(finalBody));
      const result = await callLLMStream(
        prompt,
        cfg.apiKey,
        cfg.baseUrl,
        cfg.model,
        (delta) => {
          acc += delta;
          setPolishText(acc);
        },
        controller.signal
      );
      if (result.text.trim()) setPolishedBody(result.text.trim());
      else toast.info("模型未返回润色内容，可重试或直接使用当前草稿");
    } catch (e) {
      if (controller.signal.aborted) {
        if (acc.trim()) setPolishedBody(acc.trim());
        toast.info("已停止润色，保留当前部分内容");
      } else {
        toast.error(`润色失败：${String(e instanceof Error ? e.message : e)}`);
      }
    } finally {
      abortRef.current = null;
      setPolishBusy(false);
    }
  };

  const stopPolish = () => abortRef.current?.abort();

  const applyPolish = () => {
    if (polishedBody) {
      setEditedBody(polishedBody);
      setPolishedBody(null);
      setPolishPane(false);
      toast.success("已应用润色（可点「还原自动合并」回到流水线投影）");
    }
  };

  const resetManual = () => {
    setEditedBody(null);
    setPolishedBody(null);
    setPolishPane(false);
    toast.info("已还原为流水线自动合并正文（冲突选择立即生效）");
  };

  // ---- 预览面板：开合 / 三态 / 分隔栏拖拽 ----
  const togglePreview = () => {
    if (previewMode === "closed") {
      const container = mainRef.current?.clientWidth ?? 1200;
      setPreviewWidth(Math.max(320, Math.round((container - 236) / 2)));
      setPreviewMode("open");
    } else {
      setPreviewMode("closed");
    }
  };
  const onDragStart = (e: RPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startWidth: previewWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const container = mainRef.current?.clientWidth ?? 1200;
    const dx = dragRef.current.startX - e.clientX;
    setPreviewWidth(Math.max(260, Math.min(container - 320, dragRef.current.startWidth + dx)));
  };
  const onDragEnd = () => {
    dragRef.current = null;
  };

  // ---- 基准切换（有已确认决策才需确认；否则直接切，避免 V1 全等时弹无意义确认）----
  const requestBaseSwitch = (letter: string) => {
    if (letter === baseLetter) return;
    const decided =
      steps.reduce((n, s) => n + s.confirmed.size, 0) + confirmedFiles.size;
    if (decided === 0) {
      setBaseLetter(letter);
      return;
    }
    setConfirmBase({ letter, decided });
  };
  const confirmBaseSwitch = () => {
    if (!confirmBase) return;
    setBaseLetter(confirmBase.letter);
    setConfirmedFiles(new Set());
    setConfirmBase(null);
    toast.info(`已切换基准：已确认的 ${confirmBase.decided} 项选择已重置（默认策略重新预填）`);
  };

  // ---- 派生：最终正文（手动编辑 > 流水线投影）/ 进度 ----
  const pipelineBody = useMemo(() => {
    if (steps.length === 0) return stripFm(bodies?.[baseVariant.rep.skill_id] ?? "");
    const last = steps[steps.length - 1];
    return renderThreeWayText(last.view.rows, last.conflicts);
  }, [steps, bodies, baseVariant]);
  const finalBody = editedBody ?? pipelineBody;

  const buildMd = useCallback(
    (body: string) => {
      const head = [
        "---",
        fmLine("name", name.trim() || baseVariant.rep.name),
        fmLine("description", description.trim() || "…"),
        ...(emoji.trim() ? [`emoji: ${emoji.trim()}`] : []),
        ...(triggers.trim() ? [`trigger_keywords: ${triggers.trim()}`] : []),
        "---",
        "",
      ].join("\n");
      return `${head}${body}`;
    },
    [name, description, emoji, triggers, baseVariant]
  );

  const decisionsTotal = useMemo(
    () => steps.reduce((n, s) => n + s.conflicts.length, 0) + fileConflicts.length,
    [steps, fileConflicts]
  );
  const confirmedCount = useMemo(
    () => steps.reduce((n, s) => n + s.confirmed.size, 0) + confirmedFiles.size,
    [steps, confirmedFiles]
  );
  const pendingCount = decisionsTotal - confirmedCount;

  // ---- 落点（SaveDialog 内）----
  const [customRoot, setCustomRoot] = useState<string | null>(null);

  const copyOps = useMemo<CopyOp[]>(() => {
    const dirOf = (id: string) => group.members.find((m) => m.skill_id === id)?.skill_dir ?? "";
    const normEq = (p: string, q: string) =>
      p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() ===
      q.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const replaceBase = customRoot === null;
    const destDir = replaceBase
      ? baseVariant.rep.skill_dir
      : `${customRoot}/${name.trim() || baseVariant.rep.name}`;
    const ops: CopyOp[] = [];
    const push = (fromId: string, srcRel: string, dstRel: string) => {
      const src = dirOf(fromId);
      if (!src) return;
      // 原地合并时跳过「自己拷到自己」的冗余指令：
      // src==dst 会让后端 fs::copy 在 Windows 上报错，导致整个合并写入失败。
      // 原地场景下基准自身附件本就保留在原位，跳过语义正确。
      if (normEq(src, destDir)) return;
      ops.push({ from: src, src_rel: srcRel, dst_rel: dstRel });
    };
    for (const f of accFiles ?? []) {
      push(f.fromId, f.rel, f.rel);
    }
    for (const fc of fileConflicts) {
      if (fc.chosen === "other") {
        push(fc.fromId, fc.rel, fc.rel); // 覆盖累积版（同 rel 多条 other：后者胜）
      } else if (fc.chosen === "both") {
        push(fc.fromId, fc.rel, fromBName(fc.rel, displayLetterOf(fc.fromId)));
      }
    }
    // 同名图片：基底版已由 accFiles 自动带入；「此版」覆盖 / 「都保留」改名
    for (const it of imgTweaks) {
      if (it.chosen === "other") {
        push(it.fromId, it.rel, it.rel);
      } else if (it.chosen === "both") {
        push(it.fromId, it.rel, fromBName(it.rel, displayLetterOf(it.fromId)));
      }
    }
    return ops;
  }, [accFiles, fileConflicts, imgTweaks, group.members, displayLetterOf, customRoot, name, baseVariant]);

  // ---- 保存 ----
  const doApply = async () => {
    setBusy(true);
    try {
      const others = group.members.filter((m) => m.skill_id !== baseVariant.rep.skill_id);
      const lastVariant = ordered[ordered.length - 1];
      const replaceBase = customRoot === null;
      await smartMergeApply({
        a_id: baseVariant.rep.skill_id,
        b_id: lastVariant.rep.skill_id,
        target_root: customRoot ?? parentDir(baseVariant.rep.skill_dir),
        name: name.trim() || baseVariant.rep.name,
        skill_md: buildMd(finalBody),
        copy_ops: copyOps,
        disposal: replaceBase ? "delete_weaker" : "keep_both",
        weaker_id: replaceBase ? lastVariant.rep.skill_id : null,
      });
      if (replaceBase) {
        const rest = others.filter((m) => m.skill_id !== lastVariant.rep.skill_id);
        if (rest.length > 0) {
          try {
            await dupResolveMany(baseVariant.rep.skill_id, rest.map((m) => m.skill_id));
          } catch (e) {
            toast.warning(`合并已保存，但部分副本处置失败：${String(e instanceof Error ? e.message : e)}`);
          }
        }
      }
      toast.success(
        replaceBase
          ? `已合并 ${N} 份「${baseVariant.rep.name}」为一份（其余已备份处置，可撤销）`
          : `已合并 ${N} 份「${baseVariant.rep.name}」为新目录（原件全部保留）`
      );
      onResolved();
    } catch (e) {
      toast.error(`合并失败：${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
      setSaveOpen(false);
    }
  };

  /** V==1：不合并，仅处置其余副本 */
  const doDispose = async () => {
    setBusy(true);
    try {
      const others = group.members.filter((m) => m.skill_id !== keepMember.skill_id);
      const backups = await dupResolveMany(keepMember.skill_id, others.map((m) => m.skill_id));
      toast.success(`已保留「${keepMember.scan_label} · ${keepMember.name}」，处置 ${others.length} 个（备份 ${backups.length} 份，可恢复）`);
      onResolved();
    } catch (e) {
      toast.error(`处置失败：${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
      setDisposeOpen(false);
    }
  };

  const loading = bodies === null || files === null || accFiles === null;
  const V1 = V === 1;
  /** 头部/文案展示的代表成员：全等处置用所选保留项，合并用基准代表 */
  const headlineMember = V1 ? keepMember : baseVariant.rep;

  // ---- 附件导航（P5：按 rel 单实例 + 唯一 key + 冲突数徽标）----
  const attachNav = useMemo(() => {
    const conflictCount = new Map<string, number>();
    for (const c of fileConflicts) conflictCount.set(c.rel, (conflictCount.get(c.rel) ?? 0) + 1);
    const autos = (accFiles ?? []).filter((f) => !conflictCount.has(f.rel));
    return {
      conflicts: [...conflictCount.entries()],
      autos,
    };
  }, [fileConflicts, accFiles]);

  const selectedConflict = selectedFile
    ? fileConflicts.filter((c) => c.rel === selectedFile)
    : [];
  const selectedImgTweaks = selectedFile ? imgTweaks.filter((t) => t.rel === selectedFile) : [];
  const selectedAuto = selectedFile ? (accFiles ?? []).find((f) => f.rel === selectedFile) ?? null : null;

  // ---- 预览跟随选中文件：SKILL.md → 合并 markdown；附件 → 该文件解析结果 ----
  const previewInfo = useMemo(() => {
    if (selectedFile === null) {
      return { title: "合并结果 · SKILL.md", markdown: true, content: buildMd(finalBody) };
    }
    // 图片附件的预览栏不落 base64 文本，提示去中栏看对比
    if (isImageRel(selectedFile)) {
      return { title: selectedFile, markdown: false, content: "（图片附件：请在中栏查看基底/变体对比与选择）" };
    }
    const auto = (accFiles ?? []).find((f) => f.rel === selectedFile);
    const conflicts = fileConflicts.filter((c) => c.rel === selectedFile);
    if (conflicts.length === 0) {
      return { title: selectedFile, markdown: false, content: auto?.content ?? "（空文件）" };
    }
    let result = auto?.content ?? "";
    const renames: string[] = [];
    for (const c of conflicts) {
      if (c.chosen === "other") result = c.otherContent ?? "";
      else if (c.chosen === "both") renames.push(fromBName(c.rel, displayLetterOf(c.fromId)));
    }
    const content = renames.length > 0
      ? `（累积版）\n${result}\n\n（都保留 · 改名并入）\n${renames.join("\n")}`
      : result;
    return { title: selectedFile, markdown: false, content: content || "（空文件）" };
  }, [selectedFile, accFiles, fileConflicts, finalBody, buildMd, displayLetterOf]);

  const bodyConflictKey = (stepIdx: number, id: string) => `b:${stepIdx}:${id}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ===== header：返回 / 名称 / 基准 / 决策进度 ===== */}
      <header className="shrink-0 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={onBack} className="mbtn" aria-label="返回查重">
            <ArrowLeft className="h-3.5 w-3.5" />
            查重
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-text-primary">
              {headlineMember.emoji ?? "🧩"} {headlineMember.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] font-normal text-text-tertiary">{headlineMember.scan_label}</span>
            <span className="shrink-0 font-mono text-[11px] text-text-tertiary">×{N}</span>
          </div>
          <span className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1.5 py-px text-[10.5px] font-medium text-brand">
            {V1 ? "全等处置" : "N 路合并"}
          </span>
          {/* 基准/保留方：始终可见；用 DropdownMenu 避免长选项溢出；V1 按「成员」列出全部副本 */}
          <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="shrink-0">{V1 ? "保留" : "基准"}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex max-w-[300px] items-center gap-1.5 rounded-md border border-stroke bg-glass-2 px-2 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:border-stroke-hi hover:text-text-primary"
                >
                  <span className="min-w-0 truncate">
                    {headlineMember.scan_label} · {headlineMember.name}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-text-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70vh] max-w-[440px] overflow-y-auto">
                {V1
                  ? group.members.map((m) => {
                      const on = m.skill_id === keepId;
                      return (
                        <DropdownMenuItem key={m.skill_id} onSelect={() => setKeepId(m.skill_id)}>
                          <Check className={`h-3.5 w-3.5 ${on ? "text-brand" : "text-transparent"}`} />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-text-primary">{m.scan_label} · {m.name}</span>
                            <span className="ml-1.5 font-mono text-[10px] text-text-tertiary">{pathTail(m.skill_dir)}</span>
                            {m.skill_id === recommendedId && (
                              <span className="ml-1 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[9px] text-brand">推荐</span>
                            )}
                          </span>
                        </DropdownMenuItem>
                      );
                    })
                  : ordered.map((v, i) => {
                      const on = i === 0;
                      return (
                        <DropdownMenuItem key={v.rep.skill_id} onSelect={() => requestBaseSwitch(v.letter)} disabled={on}>
                          <Check className={`h-3.5 w-3.5 ${on ? "text-brand" : "text-transparent"}`} />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-text-primary">{displayLetter(i)} · {v.rep.scan_label} · {v.rep.name}</span>
                            {v.rep.skill_id === recommendedId && (
                              <span className="ml-1 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[9px] text-brand">推荐</span>
                            )}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!V1 && (
            <span className="hidden text-[11px] text-text-tertiary md:block">
              推荐：{recommendReason(variants[0], variants)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {!V1 && (
              <span className={`rounded-sm border px-1.5 py-px font-mono text-[10.5px] ${
                pendingCount > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
              }`}>
                决策 {confirmedCount}/{decisionsTotal}
              </span>
            )}
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-md border border-stroke/60 text-text-tertiary transition-colors hover:border-brand/50 hover:text-brand"
              title={previewMode === "closed" ? "展开预览（半屏，分隔栏可拖拽调宽）" : "收起预览"}
              aria-label={previewMode === "closed" ? "展开预览" : "收起预览"}
              onClick={togglePreview}
            >
              {previewMode === "closed" ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
            </button>
          </span>
        </div>
      </header>

      {/* ===== main：三栏（左 rail 236px / 中冲突清单 / 右预览默认折叠）===== */}
      <main ref={mainRef} className="flex min-h-0 flex-1 overflow-hidden pt-3">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取 {V} 个变体…
          </div>
        ) : loadErr ? (
          <div className="flex flex-1 flex-col items-center gap-3 p-10 text-[13px] text-text-secondary">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            加载失败：{loadErr}
            <button type="button" className="mbtn" onClick={onBack}>返回</button>
          </div>
        ) : (
          <>
            {/* ===== 左栏：变体流水线 rail + 文件列表 ===== */}
            <aside className="flex w-[236px] shrink-0 flex-col border-r border-stroke/60 pr-2">
              <div className="shrink-0 pb-1 font-mono text-[10px] text-text-tertiary">变体流水线</div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {!V1 ? (
                  ordered.map((v, i) => {
                    const stepIdx = i - 1;
                    const step = stepIdx >= 0 ? steps[stepIdx] : null;
                    const pending =
                      step && i > 0
                        ? step.conflicts.length - step.confirmed.size
                        : 0;
                    const isBase = i === 0;
                    const isRec = v.rep.skill_id === recommendedId;
                    return (
                      <button
                        key={v.rep.skill_id}
                        type="button"
                        disabled={isBase}
                        onClick={() => requestBaseSwitch(v.letter)}
                        title={isBase ? "当前基准" : `切换基准到 ${v.rep.scan_label}（${v.rep.name}）`}
                        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left transition-colors ${
                          isBase ? "cursor-default" : "hover:bg-glass-2/60"
                        }`}
                      >
                        <span
                          className={`grid h-4.5 w-4.5 h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[10px] ${
                            isBase ? "border-brand/60 bg-brand/10 font-semibold text-brand" : "border-stroke font-mono text-text-tertiary"
                          }`}
                        >
                          {displayLetter(i)}
                        </span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${toolDot(v.rep.tool_id)}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-text-secondary">
                          {v.rep.scan_label}
                        </span>
                        {isRec && (
                          <span className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[9px] text-brand">推荐</span>
                        )}
                        {!isBase &&
                          (step && step.conflicts.length === 0 ? (
                            <span className="shrink-0 font-mono text-[9.5px] text-text-tertiary">自动·0</span>
                          ) : pending > 0 ? (
                            <span className="shrink-0 rounded-sm bg-amber-500/90 px-1 font-mono text-[9.5px] text-white">{pending}</span>
                          ) : (
                            <span className="shrink-0 font-mono text-[9.5px] text-emerald-600">{step ? step.conflicts.length : 0}✓</span>
                          ))}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-1.5 py-1.5 text-[11px] text-text-tertiary">全部内容全等</div>
                )}

                {/* 文件列表 */}
                <div className="mt-3 border-t border-stroke/50 pt-2">
                  <div className="pb-1 font-mono text-[10px] text-text-tertiary">文件</div>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors ${
                      selectedFile === null ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-glass-2/60"
                    }`}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">SKILL.md</span>
                    {steps.reduce((n, s) => n + s.conflicts.length, 0) > 0 && (
                      <span className="shrink-0 rounded-sm bg-amber-500/90 px-1 font-mono text-[9.5px] text-white">
                        {steps.reduce((n, s) => n + s.conflicts.length, 0)}
                      </span>
                    )}
                  </button>
                  {attachNav.conflicts.map(([rel, k]) => (
                    <button
                      key={rel}
                      type="button"
                      onClick={() => setSelectedFile(rel)}
                      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors ${
                        selectedFile === rel ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-glass-2/60"
                      }`}
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{rel}</span>
                      <span className="shrink-0 rounded-sm bg-amber-500/90 px-1 font-mono text-[9.5px] text-white">{k}</span>
                    </button>
                  ))}
                  {attachNav.autos.map((f) => (
                    <button
                      key={f.rel}
                      type="button"
                      onClick={() => setSelectedFile(f.rel)}
                      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors ${
                        selectedFile === f.rel ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-glass-2/60"
                      }`}
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.rel}</span>
                      <span className="shrink-0 font-mono text-[9.5px] text-emerald-600">自动</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            {/* ===== 中栏：冲突清单（CTA + 分组）===== */}
            <div className="flex min-w-0 flex-1 flex-col px-3">
              {/* CTA */}
              <div className="shrink-0 border-b border-stroke/60 pb-2">
                {V1 ? (
                  <p className="text-[12px] text-text-secondary">
                    全部 {N} 份内容完全一致。请在上方「保留」选择要留下的一份，其余 {N - 1} 份将备份后处置（可撤销）。
                  </p>
                ) : pendingCount > 0 ? (
                  <p className="text-[12px] text-text-secondary">
                    下面 <span className="font-mono text-amber-600">{pendingCount}</span> 处冲突需要你决定（或点 footer「全部采纳默认」一键完成）。
                  </p>
                ) : decisionsTotal > 0 ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> 全部已确认，可保存。
                  </p>
                ) : (
                  <p className="text-[12px] text-text-secondary">正文无差异，已自动合并。</p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-2">
                {V1 ? (
                  <div className="border-l-[3px] border-emerald-500/70 bg-emerald-500/[.03] px-3 py-2.5 text-[12px] text-text-secondary">
                    {N} 份内容完全一致（body_hash 相同）。保存后将只保留「{keepMember.scan_label} · {keepMember.name}」这一份，其余 {N - 1} 份先完整备份到 merge-backups，再移入回收站（可恢复）。
                  </div>
                ) : selectedFile === null ? (
                  /* 正文冲突：按流水线步分组，每步按文档序 */
                  steps.length === 0 ? (
                    <p className="text-[12px] text-text-tertiary">正在准备流水线…</p>
                  ) : (
                    steps.map((st, si) => {
                      const vLetter = displayLetter(si + 1);
                      return (
                        <section key={si} className="mb-3">
                          <div className="mb-1.5 flex items-center gap-2 border-b border-stroke/50 pb-1.5">
                            <span className="grid h-[18px] w-[18px] place-items-center rounded border border-stroke font-mono text-[10px] text-text-tertiary">
                              {vLetter}
                            </span>
                            <span className="font-mono text-[10px] text-text-tertiary">
                              合入 {st.variant.rep.scan_label}
                            </span>
                            <span className="font-mono text-[10px] text-text-tertiary">
                              {st.conflicts.length === 0 ? "自动合入 · 0 决策" : `${st.conflicts.length} 处冲突`}
                            </span>
                          </div>
                          {st.conflicts.length === 0 ? (
                            <p className="px-1 text-[11px] text-text-tertiary">该变体与累积结果无冲突，已自动并入。</p>
                          ) : (
                            st.conflicts.map((c) => {
                              const key = bodyConflictKey(si, c.id);
                              const exp = expanded.has(key);
                              const decided = st.confirmed.has(c.id);
                              return (
                                <div key={c.id} className="border-l-[3px] border-amber-500/70 bg-amber-500/[.03] px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-text-primary">
                                      {c.heading || "（开头段落）"}
                                    </span>
                                    <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                                      累积 vs {vLetter}
                                    </span>
                                    <div className="flex shrink-0 overflow-hidden rounded border border-stroke font-mono text-[10px]">
                                      {(["a", "b", "both"] as const).map((ch) => (
                                        <button
                                          key={ch}
                                          type="button"
                                          onClick={() => chooseConflict(si, c.id, ch)}
                                          className={`px-2 py-1 transition-colors ${
                                            c.chosen === ch && decided
                                              ? "bg-brand text-white"
                                              : c.chosen === ch
                                                ? "bg-glass-2/60 text-text-secondary"
                                                : "bg-glass-2/60 text-text-tertiary hover:text-text-secondary"
                                          }`}
                                        >
                                          {ch === "a" ? "取A" : ch === "b" ? "取B" : "都保留"}
                                        </button>
                                      ))}
                                    </div>
                                    <span
                                      className={`shrink-0 font-mono text-[10px] ${
                                        !decided ? "text-amber-600" : c.chosen === "a" ? "text-red-500" : c.chosen === "b" ? "text-emerald-600" : "text-brand"
                                      }`}
                                    >
                                      {!decided ? "待确认" : c.chosen === "a" ? "已采纳 A" : c.chosen === "b" ? "已采纳 B" : "都保留"}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(key)}
                                      className="shrink-0 rounded border border-stroke/70 px-1.5 py-px font-mono text-[10px] text-text-tertiary transition-colors hover:border-brand/50 hover:text-brand"
                                    >
                                      {exp ? "收起" : "三向详情"}
                                    </button>
                                  </div>
                                  {exp && <ConflictDetail c={c} />}
                                </div>
                              );
                            })
                          )}
                        </section>
                      );
                    })
                  )
                ) : selectedImgTweaks.length > 0 ? (
                  /* 同名图片：不判冲突，渲染对比 + 基底优先选择 */
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 border-b border-stroke/50 pb-1.5">
                      <FileText className="h-3.5 w-3.5 text-text-tertiary" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">{selectedFile}</span>
                      <span className="font-mono text-[10px] text-emerald-600">同名图片 · 基底优先</span>
                    </div>
                    {selectedImgTweaks.map((it) => {
                      const key = `img:${it.id}`;
                      const exp = expanded.has(key);
                      return (
                        <div key={it.id} className="border-l-[3px] border-emerald-500/70 bg-emerald-500/[.04] px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">
                              基底 vs {displayLetterOf(it.fromId)} · {it.fromName}
                            </span>
                            <div className="flex shrink-0 overflow-hidden rounded border border-stroke font-mono text-[10px]">
                              {(["base", "other", "both"] as const).map((ch) => (
                                <button
                                  key={ch}
                                  type="button"
                                  onClick={() => chooseImageTweak(it.id, ch)}
                                  className={`px-2 py-1 transition-colors ${
                                    it.chosen === ch
                                      ? "bg-brand text-white"
                                      : "bg-glass-2/60 text-text-tertiary hover:text-text-secondary"
                                  }`}
                                >
                                  {ch === "base" ? "保留基底" : ch === "other" ? "保留此版" : "都保留"}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleExpanded(key)}
                              className="shrink-0 rounded border border-stroke/70 px-1.5 py-px font-mono text-[10px] text-text-tertiary transition-colors hover:border-brand/50 hover:text-brand"
                            >
                              {exp ? "收起" : "图片对比"}
                            </button>
                          </div>
                          {exp && (
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className="font-mono text-[10px] text-text-tertiary">基底版本</span>
                                {it.baseData ? (
                                  <img src={it.baseData} alt="基底版本" className="max-h-56 max-w-full rounded-lg border border-stroke bg-card/40 object-contain" />
                                ) : (
                                  <span className="text-[11px] text-text-tertiary">（读取失败）</span>
                                )}
                              </div>
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className="font-mono text-[10px] text-emerald-600/80">变体 {displayLetterOf(it.fromId)} · {it.fromName}</span>
                                {it.otherData ? (
                                  <img src={it.otherData} alt="变体版本" className="max-h-56 max-w-full rounded-lg border border-stroke bg-card/40 object-contain" />
                                ) : (
                                  <span className="text-[11px] text-text-tertiary">（读取失败）</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : selectedConflict.length > 0 ? (
                  /* 附件冲突（同 rel 多条，逐条卡片） */
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 border-b border-stroke/50 pb-1.5">
                      <FileText className="h-3.5 w-3.5 text-text-tertiary" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">{selectedFile}</span>
                      <span className="font-mono text-[10px] text-amber-600">{selectedConflict.length} 版本不同</span>
                    </div>
                    {selectedConflict.map((fc) => {
                      const key = `f:${fc.id}`;
                      const exp = expanded.has(key);
                      const decided = confirmedFiles.has(fc.id);
                      return (
                        <div key={fc.id} className="border-l-[3px] border-amber-500/70 bg-amber-500/[.03] px-3 py-2">
                          {/* 工具栏右贴：左侧来源占 flex-1，与 SKILL.md 冲突行同一范式 */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">
                              累积 vs {displayLetterOf(fc.fromId)} · {fc.fromName}
                            </span>
                            <div className="flex shrink-0 overflow-hidden rounded border border-stroke font-mono text-[10px]">
                              {(["base", "other", "both"] as const).map((ch) => (
                                <button
                                  key={ch}
                                  type="button"
                                  onClick={() => chooseFile(fc.id, ch)}
                                  className={`px-2 py-1 transition-colors ${
                                    fc.chosen === ch && decided
                                      ? "bg-brand text-white"
                                      : fc.chosen === ch
                                        ? "bg-glass-2/60 text-text-secondary"
                                        : "bg-glass-2/60 text-text-tertiary hover:text-text-secondary"
                                  }`}
                                >
                                  {ch === "base" ? "取累积" : ch === "other" ? "取此版" : "都保留"}
                                </button>
                              ))}
                            </div>
                            <span className={`shrink-0 font-mono text-[10px] ${!decided ? "text-amber-600" : fc.chosen === "base" ? "text-red-500" : fc.chosen === "other" ? "text-emerald-600" : "text-brand"}`}>
                              {!decided ? "待确认" : fc.chosen === "base" ? "已采纳累积" : fc.chosen === "other" ? "已采纳此版" : "都保留"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleExpanded(key)}
                              className="shrink-0 rounded border border-stroke/70 px-1.5 py-px font-mono text-[10px] text-text-tertiary transition-colors hover:border-brand/50 hover:text-brand"
                            >
                              {exp ? "收起" : "三向详情"}
                            </button>
                          </div>
                          {exp && (
                            <div className="grid gap-2 pt-2 text-[11px] sm:grid-cols-[1fr_1.15fr_1fr]">
                              <div className="min-w-0">
                                <span className="mb-1 block font-mono text-[10px] text-text-tertiary">A · 累积版</span>
                                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-l-2 border-stroke/60 bg-card/40 p-2 leading-relaxed text-text-secondary">
                                  {fc.baseContent ?? "（读取失败）"}
                                </pre>
                              </div>
                              <div className="min-w-0">
                                <span className="mb-1 block font-mono text-[10px] text-brand">结果</span>
                                {fc.chosen === "both" ? (
                                  <div className="border-l-2 border-amber-500/70 bg-amber-500/[.03] p-2 text-[10.5px] leading-relaxed text-text-secondary">
                                    将保留两份：<span className="font-mono">{fc.rel}</span>（累积版）与
                                    <span className="font-mono"> {fromBName(fc.rel, displayLetterOf(fc.fromId))}</span>
                                    （{displayLetterOf(fc.fromId)} 版改名）。
                                  </div>
                                ) : (
                                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-l-2 border-brand/60 bg-brand/[.03] p-2 leading-relaxed text-text-secondary">
                                    {fc.chosen === "other" ? (fc.otherContent ?? "（读取失败）") : (fc.baseContent ?? "（读取失败）")}
                                  </pre>
                                )}
                              </div>
                              <div className="min-w-0">
                                <span className="mb-1 block font-mono text-[10px] text-emerald-500/90">
                                  B · 变体 {displayLetterOf(fc.fromId)} · {fc.fromName}
                                </span>
                                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-l-2 border-emerald-400/60 bg-card/40 p-2 leading-relaxed text-text-secondary">
                                  {fc.otherContent ?? "（读取失败）"}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : selectedAuto ? (
                  <div className="border-l-[3px] border-emerald-500/70 bg-emerald-500/[.03] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-text-tertiary" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">{selectedAuto.rel}</span>
                      <span className="font-mono text-[10px] text-emerald-600">自动并入 · 无冲突</span>
                    </div>
                    {selectedAuto.rel && isImageRel(selectedAuto.rel) ? (
                      selectedAuto.content ? (
                        <img src={selectedAuto.content} alt={selectedAuto.rel} className="mt-2 max-h-56 max-w-full rounded-lg border border-stroke bg-card/40 object-contain" />
                      ) : (
                        <p className="mt-2 text-[11px] text-text-tertiary">（图片读取失败）</p>
                      )
                    ) : (
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words border border-stroke/50 bg-card/40 p-2 text-[11px] leading-relaxed text-text-secondary">
                        {selectedAuto.content ?? "（读取失败）"}
                      </pre>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-text-tertiary">正在读取附件…</p>
                )}
              </div>
            </div>

            {/* ===== 右栏：实时预览（跟随选中文件；分隔栏可拖拽）===== */}
            {previewMode !== "closed" && (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖动调整预览宽度"
                  title="拖动调整预览宽度"
                  onPointerDown={onDragStart}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  className="w-1 shrink-0 cursor-col-resize border-x border-stroke/40 bg-glass-2/40 transition-colors hover:bg-brand/30 active:bg-brand/40"
                />
                <aside
                  className="flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-stroke/60 pl-2"
                  style={{ width: previewWidth }}
                >
                  <div className="shrink-0 pb-1 font-mono text-[10px] text-text-tertiary">{previewInfo.title}</div>
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {previewInfo.markdown ? (
                      <div className="overflow-y-auto border border-stroke/60 p-3">
                        <MarkdownPreview content={previewInfo.content} />
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap break-words border border-stroke/60 bg-card/40 p-3 text-[11px] leading-relaxed text-text-secondary">{previewInfo.content}</pre>
                    )}

                    {/* AI 润色（仅正文 SKILL.md 时可用） */}
                    {selectedFile === null && (
                      <div className="mt-3 border-t border-stroke/50 pt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="mbtn"
                            disabled={polishBusy || !hasKey}
                            title={hasKey ? "AI 润色当前合并稿（两步流：生成 → 应用）" : "请到 设置 → LLM 配置 填写 API Key"}
                            onClick={doPolish}
                          >
                            {polishBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            {hasKey ? "AI 润色" : "配 Key"}
                          </button>
                          {polishBusy && (
                            <button type="button" className="mbtn" onClick={stopPolish}>
                              <X className="h-3 w-3" />
                              停止
                            </button>
                          )}
                          {polishedBody && (
                            <button type="button" className="mbtn primary" onClick={applyPolish}>
                              <Check className="h-3 w-3" />
                              应用润色
                            </button>
                          )}
                          {editedBody !== null && (
                            <button type="button" className="text-[10.5px] text-text-tertiary transition-colors hover:text-brand" onClick={resetManual}>
                              还原自动合并
                            </button>
                          )}
                        </div>
                        {polishPane && (
                          <div className="mt-2 border-l-[3px] border-brand/60 bg-card/40 p-2">
                            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-brand">
                              {polishBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                              {polishBusy
                                ? "AI 正在润色…（可随时停止）"
                                : polishedBody
                                  ? "润色完成 —— 点「应用润色」才会覆盖正文"
                                  : "（等待模型输出…）"}
                            </div>
                            <div className="max-h-44 overflow-y-auto">
                              <MarkdownRenderer content={(polishedBody ?? polishText) || "（等待模型输出…）"} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </aside>
              </>
            )}
          </>
        )}
      </main>

      {/* ===== footer ===== */}
      <footer className="shrink-0 border-t border-stroke/70 py-3">
        <div className="flex items-center gap-2">
          <span className="mr-auto text-[11.5px] text-text-tertiary">
            {V1
              ? `${N} 份内容全等 · 可撤销`
              : `决策 ${confirmedCount}/${decisionsTotal} · 变体 ${V} · 副本 ${N} · ${copyOps.length} 附件 · 可撤销`}
          </span>
          {!V1 && pendingCount > 0 && (
            <button type="button" className="mbtn" onClick={acceptAllDefaults}>
              全部采纳默认
            </button>
          )}
          {V1 ? (
            <button type="button" className="mbtn primary" disabled={busy} onClick={() => setDisposeOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              保留「{keepMember.scan_label}」，处置其余 {N - 1} 份
            </button>
          ) : (
            <button
              type="button"
              className="mbtn primary"
              disabled={busy || pendingCount > 0}
              title={pendingCount > 0 ? `还有 ${pendingCount} 项冲突未确认（或点「全部采纳默认」）` : undefined}
              onClick={() => setSaveOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              保存合并结果…
            </button>
          )}
        </div>
      </footer>

      {/* ===== 基准切换确认 ===== */}
      <ConfirmDialog
        open={confirmBase !== null}
        onOpenChange={(o) => !o && setConfirmBase(null)}
        title="切换基准？"
        description={
          confirmBase
            ? `切换基准将清空已确认的 ${confirmBase.decided} 项选择（全部回到默认策略），是否继续？`
            : ""
        }
        confirmText="切换并重置"
        loading={false}
        onConfirm={confirmBaseSwitch}
      />

      {/* ===== V==1 处置确认 ===== */}
      <ConfirmDialog
        open={disposeOpen}
        onOpenChange={(o) => !o && !busy && setDisposeOpen(false)}
        title={`保留「${keepMember.scan_label} · ${keepMember.name}」，处置其余 ${N - 1} 份？`}
        description={`内容全等，处置不会丢失内容。其余 ${N - 1} 份将先完整备份到 merge-backups，再移入回收站（可恢复）。`}
        confirmText={busy ? "处置中…" : "备份并处置"}
        variant="destructive"
        loading={busy}
        onConfirm={doDispose}
      />

      {/* ===== SaveDialog（三段：基本信息 / 落点 / 处置摘要）===== */}
      <Dialog open={saveOpen} onOpenChange={(o) => !o && !busy && setSaveOpen(false)}>
        <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>保存合并结果</DialogTitle>
            <DialogDescription>
              合并 {N} 份「{baseVariant.rep.name}」为一份 · 全程备份可撤销
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {/* 01 基本信息 */}
            <section className="border-b border-stroke/50 pb-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-text-tertiary">01</span>
                <span className="text-[13px] font-semibold text-text-primary">基本信息</span>
              </div>
              <label className="block">
                <span className="mb-1 flex items-baseline gap-1 text-[11px] text-text-secondary">
                  技能名称 <code className="font-mono text-[10px] text-text-tertiary">name</code>
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如 code-review"
                  className="h-[32px] w-full rounded-md border border-stroke bg-card px-2 font-mono text-[12px] outline-none focus:border-brand/60"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 flex items-baseline gap-1 text-[11px] text-text-secondary">
                  技能描述 <code className="font-mono text-[10px] text-text-tertiary">description</code>
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-md border border-stroke bg-card px-2 py-1 text-[12px] leading-relaxed outline-none focus:border-brand/60"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 flex items-baseline gap-1 text-[11px] text-text-secondary">
                  触发关键词 <code className="font-mono text-[10px] text-text-tertiary">trigger_keywords</code>
                </span>
                <input
                  value={triggers}
                  onChange={(e) => setTriggers(e.target.value)}
                  className="h-[32px] w-full rounded-md border border-stroke bg-card px-2 font-mono text-[12px] outline-none focus:border-brand/60"
                />
              </label>
              <pre className="mt-3 overflow-auto border-l-2 border-stroke/70 bg-card/40 p-2.5 font-mono text-[10.5px] leading-[1.8] text-text-secondary">
                {["---", fmLine("name", name.trim() || "…"), fmLine("description", description.trim() || "…"), "---"].join("\n")}
              </pre>
            </section>

            {/* 02 落点 */}
            <section className="border-b border-stroke/50 py-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-text-tertiary">02</span>
                <span className="text-[13px] font-semibold text-text-primary">合并结果保存到哪里</span>
              </div>
              <button
                type="button"
                onClick={() => setCustomRoot(null)}
                className={`block w-full border-l-[3px] px-3 py-2 text-left transition-colors ${
                  customRoot === null ? "border-l-brand bg-brand/[.05]" : "border-l-transparent hover:bg-glass-2/60"
                }`}
              >
                <span className="text-[12px] font-medium text-text-primary">替换基准（推荐）</span>
                <span className="mt-0.5 block font-mono text-[10.5px] text-text-tertiary">{fmtPath(baseVariant.rep.skill_dir)}</span>
                <span className="block text-[10.5px] text-text-tertiary">原地覆盖基准，其余 {N - 1} 份备份后进回收站（可撤销）</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { open: openDlg } = await import("@tauri-apps/plugin-dialog");
                    const dir = await openDlg({ directory: true, multiple: false });
                    if (typeof dir === "string" && dir) setCustomRoot(dir);
                  } catch {
                    toast.info("mock 模式：落点固定为替换基准");
                  }
                }}
                className={`block w-full border-l-[3px] px-3 py-2 text-left transition-colors ${
                  customRoot !== null ? "border-l-brand bg-brand/[.05]" : "border-l-transparent hover:bg-glass-2/60"
                }`}
              >
                <span className="text-[12px] font-medium text-text-primary">选择其他文件夹…</span>
                {customRoot && <span className="mt-0.5 block font-mono text-[10.5px] text-text-tertiary">{fmtPath(customRoot)}</span>}
                <span className="block text-[10.5px] text-text-tertiary">新增合并产物，原来的 {N} 份全部保留</span>
              </button>
            </section>

            {/* 03 处置摘要 */}
            <section className="py-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-text-tertiary">03</span>
                <span className="text-[13px] font-semibold text-text-primary">处置摘要</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-text-secondary">
                {customRoot === null
                  ? `替换基准：其余 ${N - 1} 份（含 ${N - V} 份相同副本）备份后进回收站，可撤销。`
                  : "新目录：原件全部保留。"}
                <br />
                决策 {confirmedCount}/{decisionsTotal} · {copyOps.length} 个附件将带入 · 全程可撤销（merge-history）。
              </p>
            </section>
          </div>
          <DialogFooter className="shrink-0">
            <button type="button" className="mbtn" disabled={busy} onClick={() => setSaveOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="mbtn primary"
              disabled={busy || !name.trim()}
              title={!name.trim() ? "请先填写技能名称" : undefined}
              onClick={doApply}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {busy ? "合并中…" : "备份并合并"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
