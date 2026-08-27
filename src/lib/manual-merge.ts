/**
 * PLAN-13 手动合并引擎（行级/Hunk 级）。
 *
 * 与「智能合并」（merge.ts 的段落级拼接）互补：本模块把 A/B 两份正文按行 LCS
 * 切成若干「变更块」（hunk），每块提供 取A/取B/都保留 三种选择，未变更的上下文
 * 行始终保留，按序拼出合并正文。纯前端不落盘。
 *
 * PLAN-15 D2/§3.4：ManualMergePanel 已废弃，本模块降级为「无标题/超长文档的
 * 三向合并退化兜底」的行级细化实现（逐 hunk 取左/取右）；当前未被引用，保留待用。
 *
 * 复用 LineDiff 的 computeLineDiff（已处理 BOM/CRLF 归一化），避免重复实现 LCS。
 */
import { computeLineDiff } from "@/components/common/LineDiff";

export type ManualChoice = "left" | "right" | "both";

export interface ManualHunk {
  id: string;
  /** 变更块前的上下文行（两侧相同，始终保留） */
  ctxBefore: string[];
  /** A 侧独有行（删除侧） */
  leftLines: string[];
  /** B 侧独有行（新增侧） */
  rightLines: string[];
  choice: ManualChoice;
}

export interface ManualMergePlan {
  hunks: ManualHunk[];
  /** 最后一个变更块之后的上下文行（两侧相同） */
  tail: string[];
  /** 行数超阈值退化（整篇全删+全增）时的标记，UI 提示「简化对照」 */
  fallback: boolean;
}

/**
 * 把 A/B 两份正文切成可交互的变更块。
 * rows 中的 ctx 行累积为「前导上下文」，连续 del/add 行归入同一个 hunk 的
 * leftLines/rightLines；hunk 结束时前导上下文并入该 hunk 的 ctxBefore。
 */
export function buildManualMergePlan(leftText: string, rightText: string): ManualMergePlan {
  const { rows, fallback } = computeLineDiff(leftText, rightText);

  const hunks: ManualHunk[] = [];
  let ctx: string[] = [];
  let cur: { left: string[]; right: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    hunks.push({
      id: `h${hunks.length}`,
      ctxBefore: ctx,
      leftLines: cur.left,
      rightLines: cur.right,
      choice: "left",
    });
    ctx = [];
    cur = null;
  };

  for (const r of rows) {
    if (r.kind === "ctx") {
      if (cur) flush();
      ctx.push(r.text);
    } else if (r.kind === "del") {
      if (!cur) cur = { left: [], right: [] };
      cur.left.push(r.text);
    } else {
      if (!cur) cur = { left: [], right: [] };
      cur.right.push(r.text);
    }
  }
  flush();

  return { hunks, tail: ctx, fallback };
}

/** 按当前选择序列化合并正文（LF 行尾）。 */
export function renderManualMerge(hunks: ManualHunk[], tail: string[]): string {
  const parts: string[] = [];
  for (const h of hunks) {
    parts.push(...h.ctxBefore);
    if (h.choice === "left") {
      parts.push(...h.leftLines);
    } else if (h.choice === "right") {
      parts.push(...h.rightLines);
    } else {
      parts.push(...h.leftLines);
      parts.push(...h.rightLines);
    }
  }
  parts.push(...tail);
  return parts.join("\n");
}
