/**
 * PLAN-13 工作流 M：零依赖按行 diff（LCS 实现），与 CodeEditor 同思路不引第三方库。
 *
 * 两种视图（LineDiff 头部可切换，localStorage 记忆）：
 * - unified（默认）：git 式单列，红删绿增；
 * - split 分栏：A/B 左右对齐，改动行配对（mod），并对配对行做行内词级 diff
 *   高亮——精确到「哪几个字变了」（Boss 反馈：差异不好看清楚）。
 * 行数超阈值退化为整块对照（避免 DP 表爆内存）。
 */
import { useMemo, useState } from "react";

export type DiffRow =
  | { kind: "ctx"; text: string; lnL: number; lnR: number }
  | { kind: "del"; text: string; lnL: number }
  | { kind: "add"; text: string; lnR: number };

type SplitCell = {
  ln: number | null;
  text: string | null;
  kind: "ctx" | "del" | "add" | "mod" | "empty";
};
export type SplitRow = { left: SplitCell; right: SplitCell };

/** LCS 行数上限：超出则退化为「全删 + 全增」（避免 DP 表爆内存） */
const MAX_DIFF_LINES = 1500;

/**
 * 行分割 + 归一化：去 BOM、按 \r\n|\r|\n 切行。
 * 修复（Boss 实测）：导入 zip（LF）与本地工具目录（CRLF）是同一份技能，
 * 旧版 split("\n") 让每行残留 \r → LCS 全失配 → 整篇 −N/+N 全红。
 */
function splitLines(text: string): string[] {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.split(/\r\n|\r|\n/);
}

const VIEW_KEY = "skills-shark.diff-view";
type ViewMode = "unified" | "split";

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "unified" || v === "split" ? v : "split";
  } catch {
    return "split";
  }
}

export function computeLineDiff(
  leftText: string,
  rightText: string
): { rows: DiffRow[]; fallback: boolean } {
  const a = splitLines(leftText);
  const b = splitLines(rightText);

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const rows: DiffRow[] = [];
    a.forEach((t, i) => rows.push({ kind: "del", text: t, lnL: i + 1 }));
    b.forEach((t, i) => rows.push({ kind: "add", text: t, lnR: i + 1 }));
    return { rows, fallback: true };
  }

  const m = a.length;
  const n = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度（后缀形式，便于回溯）
  const dp: Int32Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    const ai = a[i];
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        ai === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ kind: "ctx", text: a[i], lnL: i + 1, lnR: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", text: a[i], lnL: i + 1 });
      i++;
    } else {
      rows.push({ kind: "add", text: b[j], lnR: j + 1 });
      j++;
    }
  }
  while (i < m) {
    rows.push({ kind: "del", text: a[i], lnL: i + 1 });
    i++;
  }
  while (j < n) {
    rows.push({ kind: "add", text: b[j], lnR: j + 1 });
    j++;
  }
  return { rows, fallback: false };
}

/** unified 行序列 → 分栏对齐行：连续变更块内 del/add 按序配对成 mod 行 */
export function buildSplitRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === "ctx") {
      out.push({
        left: { ln: r.lnL, text: r.text, kind: "ctx" },
        right: { ln: r.lnR, text: r.text, kind: "ctx" },
      });
      i++;
      continue;
    }
    // 收集一个变更块（del/add 可能交错，按类型归位后拉链配对）
    const dels: Extract<DiffRow, { kind: "del" }>[] = [];
    const adds: Extract<DiffRow, { kind: "add" }>[] = [];
    while (i < rows.length && rows[i].kind !== "ctx") {
      const c = rows[i];
      if (c.kind === "del") dels.push(c);
      else if (c.kind === "add") adds.push(c);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = adds[k];
      out.push({
        left: d
          ? { ln: d.lnL, text: d.text, kind: a ? "mod" : "del" }
          : { ln: null, text: null, kind: "empty" },
        right: a
          ? { ln: a.lnR, text: a.text, kind: d ? "mod" : "add" }
          : { ln: null, text: null, kind: "empty" },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 行内词级 diff（仅用于分栏 mod 配对行，精确到「哪几个字变了」）
// ---------------------------------------------------------------------------

type TokenSeg = { text: string; diff: boolean };

/** 分词：连续空白 / 连续字母数字 / 其他符号逐段（CJK 逐字段） */
function tokenizeLine(text: string): string[] {
  return text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? [];
}

const MAX_WORD_TOKENS = 300;

/** 词级 LCS：返回两侧带 diff 标记的段；超 token 上限则整行标 diff */
export function diffWords(
  a: string,
  b: string
): { aSegs: TokenSeg[]; bSegs: TokenSeg[] } {
  const ta = tokenizeLine(a);
  const tb = tokenizeLine(b);
  if (ta.length > MAX_WORD_TOKENS || tb.length > MAX_WORD_TOKENS) {
    return {
      aSegs: [{ text: a, diff: true }],
      bSegs: [{ text: b, diff: true }],
    };
  }
  const m = ta.length;
  const n = tb.length;
  const dp: Int32Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        ta[i] === tb[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMark: boolean[] = new Array(m).fill(true);
  const bMark: boolean[] = new Array(n).fill(true);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (ta[i] === tb[j]) {
      aMark[i] = false;
      bMark[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  // 相邻同状态 token 合并成段
  const pack = (tokens: string[], mark: boolean[]): TokenSeg[] => {
    const segs: TokenSeg[] = [];
    for (let k = 0; k < tokens.length; k++) {
      const last = segs[segs.length - 1];
      if (last && last.diff === mark[k]) last.text += tokens[k];
      else segs.push({ text: tokens[k], diff: mark[k] });
    }
    return segs;
  };
  return { aSegs: pack(ta, aMark), bSegs: pack(tb, bMark) };
}

function WordSegs({
  segs,
  side,
}: {
  segs: TokenSeg[];
  side: "left" | "right";
}) {
  return (
    <>
      {segs.map((s, i) =>
        s.diff ? (
          <mark
            key={i}
            className={`rounded-[2px] px-px ${
              side === "left"
                ? "bg-red-500/30 text-red-800 dark:text-red-200"
                : "bg-emerald-500/30 text-emerald-800 dark:text-emerald-200"
            }`}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

interface LineDiffProps {
  left: string;
  right: string;
  leftLabel?: string;
  rightLabel?: string;
  /** 最大高度（px），超出内部滚动 */
  maxHeight?: number;
}

export function LineDiff({ left, right, leftLabel, rightLabel, maxHeight }: LineDiffProps) {
  const [mode, setMode] = useState<ViewMode>(loadViewMode);

  const switchMode = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* 隐私模式下忽略 */
    }
  };

  const { rows, fallback } = useMemo(
    () => computeLineDiff(left, right),
    [left, right]
  );
  const splitRows = useMemo(() => buildSplitRows(rows), [rows]);
  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const r of rows) {
      if (r.kind === "add") add++;
      else if (r.kind === "del") del++;
    }
    return { add, del };
  }, [rows]);
  // mod 配对行的词级 diff 缓存（按行对索引）
  const wordCache = useMemo(() => new Map<number, { aSegs: TokenSeg[]; bSegs: TokenSeg[] }>(), [rows]);

  /* 分栏配色：del/左mod = 红，add/右mod = 绿（旧版 mod 两侧同红，右侧改动看不清） */
  const cellBg = (kind: SplitCell["kind"], side: "left" | "right") => {
    if (kind === "empty") return "bg-glass-2/40";
    if (kind === "del" || (kind === "mod" && side === "left")) return "bg-red-500/[.08]";
    if (kind === "add" || (kind === "mod" && side === "right")) return "bg-emerald-500/[.08]";
    return "";
  };
  const cellText = (kind: SplitCell["kind"], side: "left" | "right") => {
    if (kind === "del" || (kind === "mod" && side === "left"))
      return "text-red-700/90 dark:text-red-300/90";
    if (kind === "add" || (kind === "mod" && side === "right"))
      return "text-emerald-700/90 dark:text-emerald-300/90";
    if (kind === "empty") return "";
    return "text-text-secondary";
  };

  return (
    <div className="overflow-hidden rounded-[10px] border border-stroke bg-glass">
      {/* 头部：左右标签 + 视图切换 + 增删统计 */}
      <div className="flex items-center justify-between gap-2 border-b border-stroke/70 bg-glass-2/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-red-400/80" />
            <span className="truncate">{leftLabel ?? "A"}</span>
          </span>
          <span className="text-text-tertiary">vs</span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-emerald-400/80" />
            <span className="truncate">{rightLabel ?? "B"}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fallback && (
            <span className="font-mono text-[11px] text-amber-500">超长文本 · 简化对照</span>
          )}
          {/* 视图切换：统一 / 分栏 */}
          <div className="flex overflow-hidden rounded-md border border-stroke/80 font-mono text-[10.5px]">
            <button
              type="button"
              onClick={() => switchMode("unified")}
              className={`px-2 py-0.5 transition-colors ${
                mode === "unified"
                  ? "bg-brand/15 text-brand"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              统一
            </button>
            <button
              type="button"
              onClick={() => switchMode("split")}
              className={`border-l border-stroke/80 px-2 py-0.5 transition-colors ${
                mode === "split"
                  ? "bg-brand/15 text-brand"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              分栏
            </button>
          </div>
          <span className="font-mono text-[11px] text-red-500/90">−{stats.del}</span>
          <span className="font-mono text-[11px] text-emerald-600/90">+{stats.add}</span>
        </div>
      </div>

      {/* diff 主体：diff-scroll 让滚动条始终可视（Boss：找不到滚动条在哪） */}
      <div
        className="diff-scroll overflow-auto font-mono text-[12px] leading-[1.55]"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
            两侧均为空
          </div>
        ) : mode === "unified" ? (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={idx}
                  className={
                    r.kind === "del"
                      ? "bg-red-500/[.08]"
                      : r.kind === "add"
                        ? "bg-emerald-500/[.08]"
                        : ""
                  }
                >
                  <td className="w-[42px] select-none border-r border-stroke/40 px-1.5 text-right align-top text-[10.5px] text-text-tertiary">
                    {r.kind === "add" ? "" : r.lnL}
                  </td>
                  <td className="w-[42px] select-none border-r border-stroke/40 px-1.5 text-right align-top text-[10.5px] text-text-tertiary">
                    {r.kind === "del" ? "" : r.lnR}
                  </td>
                  <td
                    className={`w-[20px] select-none px-1 text-center align-top font-semibold ${
                      r.kind === "del"
                        ? "text-red-500"
                        : r.kind === "add"
                          ? "text-emerald-600"
                          : "text-text-tertiary/50"
                    }`}
                  >
                    {r.kind === "del" ? "−" : r.kind === "add" ? "+" : ""}
                  </td>
                  <td
                    className={`whitespace-pre-wrap break-all px-2 align-top ${
                      r.kind === "del"
                        ? "text-red-700/90 dark:text-red-300/90"
                        : r.kind === "add"
                          ? "text-emerald-700/90 dark:text-emerald-300/90"
                          : "text-text-secondary"
                    }`}
                  >
                    {r.text || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* ===== 分栏视图：A/B 左右对齐，mod 行配对 + 词级高亮 ===== */
          <table className="w-full table-fixed border-collapse">
            <tbody>
              {splitRows.map((row, idx) => {
                let wordDiff: { aSegs: TokenSeg[]; bSegs: TokenSeg[] } | null = null;
                const paired =
                  row.left.kind === "mod" &&
                  row.right.kind === "mod" &&
                  row.left.text !== null &&
                  row.right.text !== null;
                if (paired) {
                  wordDiff = wordCache.get(idx) ?? null;
                  if (!wordDiff) {
                    wordDiff = diffWords(row.left.text!, row.right.text!);
                    wordCache.set(idx, wordDiff);
                  }
                }
                const renderCell = (cell: SplitCell, side: "left" | "right") => (
                  <>
                    <td
                      className={`w-[38px] select-none border-r px-1.5 text-right align-top text-[10.5px] text-text-tertiary ${
                        side === "left" ? "border-stroke/40" : "border-stroke/70"
                      } ${cellBg(cell.kind, side)}`}
                    >
                      {cell.ln ?? ""}
                    </td>
                    <td
                      className={`whitespace-pre-wrap break-all px-2 align-top ${cellBg(cell.kind, side)} ${cellText(cell.kind, side)}`}
                    >
                      {cell.text === null ? (
                        <span className="select-none text-text-tertiary/30">·</span>
                      ) : cell.kind === "mod" && wordDiff ? (
                        <WordSegs
                          segs={side === "left" ? wordDiff.aSegs : wordDiff.bSegs}
                          side={side}
                        />
                      ) : (
                        cell.text || " "
                      )}
                    </td>
                  </>
                );
                return (
                  <tr key={idx}>
                    {renderCell(row.left, "left")}
                    {renderCell(row.right, "right")}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
