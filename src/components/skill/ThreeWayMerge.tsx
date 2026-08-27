/**
 * PLAN-15 D2/D3 三向合并视图：左 A 来源｜中立合并结果（主角）｜右 B 来源。
 *
 * 纯展示组件：不持有业务状态。rows 由 merge.ts buildThreeWayView 产出，
 * 冲突选择（conflicts.chosen）与正文编辑（editedBody）由父组件（统一合并工作台）持有。
 *
 * - 三列各自独立滚动（§3.2）；相同/仅一侧行灰显零交互；冲突行取A/取B/都保留。
 * - 结果列 [块视图 | 编辑] 切换：编辑态写 editedBody，脱离 choice 投影（D3）。
 * - 窄屏（<lg）三列纵向堆叠；桌面 ≥lg 三列并排（1fr / 1.15fr / 1fr）。
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Columns2, Pencil } from "lucide-react";
import {
  resolveConflictText,
  type BlockChoice,
  type MergeConflict,
  type ThreeWayRow,
} from "@/lib/merge";

interface ThreeWayMergeProps {
  aName: string;
  bName: string;
  rows: ThreeWayRow[];
  conflicts: MergeConflict[];
  /** null = 跟随冲突选择投影；非 null = 用户已手动编辑 */
  editedBody: string | null;
  onEditBody: (text: string) => void;
  onChoose: (conflictId: string, choice: BlockChoice) => void;
}

/** 正文块：mono pre，左侧 3px 色条（A 红 / B 绿 / 结果中性 / 自动灰），限高内滚。 */
function BlockPre({
  text,
  tone,
  className = "",
}: {
  text: string;
  tone: "a" | "b" | "result" | "muted" | "onlyA" | "onlyB";
  className?: string;
}) {
  const bar =
    tone === "a"
      ? "border-red-400/60"
      : tone === "b"
        ? "border-emerald-400/60"
        : tone === "onlyA"
          ? "border-sky-400/50"
          : tone === "onlyB"
            ? "border-violet-400/50"
            : "border-stroke/60";
  const textTone = tone === "muted" ? "text-text-tertiary" : "text-text-secondary";
  // 三列各自 overflow-y-auto（§2.3），块渲染自然高度、不设内部滚动上限——
  // 避免「每块 288px 内滚 + 列再滚」的双重滚动，也天然满足「展开看全文」。
  return (
    <pre
      className={`whitespace-pre-wrap break-words border-l-2 ${bar} bg-card/30 p-2 text-[11px] leading-relaxed ${textTone} ${className}`}
    >
      {text}
    </pre>
  );
}

/** 空单元格占位（对侧无此块） */
function EmptyCell({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center border-l-2 border-stroke/30 py-3 text-[10px] text-text-tertiary/70">
      {label}
    </div>
  );
}

/** 取A/取B/都保留 segmented（正文冲突行与附件冲突共用的唯一样式来源）。
 *  按钮恒 shrink-0 + whitespace-nowrap：任何宽度下都不允许换行/压缩，
 *  空间不足时由标题侧 truncate 让位，保证每个冲突块的决策按钮样式始终一致。 */
function ChoiceSegment({
  chosen,
  onChoose,
}: {
  /** MergeConflict.chosen 含 only 类的 keep/drop；三向行只会是 BlockChoice */
  chosen: BlockChoice | "keep" | "drop";
  onChoose: (ch: BlockChoice) => void;
}) {
  const opts: { v: BlockChoice; label: string }[] = [
    { v: "a", label: "取 A" },
    { v: "b", label: "取 B" },
    { v: "both", label: "都保留" },
  ];
  return (
    <div className="flex shrink-0 overflow-hidden rounded border border-stroke font-mono text-[10px]">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChoose(o.v)}
          className={`shrink-0 whitespace-nowrap px-2 py-1 transition-colors ${
            chosen === o.v
              ? "bg-brand text-white"
              : "bg-glass-2/60 text-text-tertiary hover:text-text-secondary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ThreeWayMerge({
  aName,
  bName,
  rows,
  conflicts,
  editedBody,
  onEditBody,
  onChoose,
}: ThreeWayMergeProps) {
  // 结果列视图模式：块视图（choice 投影）↔ 编辑（textarea 全文，写入 editedBody）
  const [resultMode, setResultMode] = useState<"blocks" | "edit">("blocks");

  const byId = useMemo(() => new Map(conflicts.map((c) => [c.id, c])), [conflicts]);

  // 块视图下结果列的中立结果正文（供编辑态初始值，避免 textarea 空）
  const projectedText = useMemo(
    () =>
      rows
        .map((r) => {
          if (r.kind === "same") return r.aText ?? "";
          if (r.kind === "onlyA") return r.aText ?? "";
          if (r.kind === "onlyB") return r.bText ?? "";
          const c = r.conflictId ? byId.get(r.conflictId) : undefined;
          return c ? resolveConflictText(c) : "";
        })
        .filter((s) => s.trim().length > 0)
        .join("\n\n"),
    [rows, byId]
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden border border-stroke/60 lg:grid-cols-[1fr_1.15fr_1fr]">
      {/* ===== 左：A 来源 ===== */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card/20">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-stroke/60 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-sm bg-red-400" aria-hidden />
          <span className="min-w-0 truncate text-[11px] font-semibold text-text-primary">A · {aName}</span>
          <span className="ml-auto font-mono text-[9.5px] text-text-tertiary">来源</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-1.5">
            {rows.map((r) =>
              r.aText === null ? (
                <EmptyCell key={r.id} label="—" />
              ) : (
                <div key={r.id} className={r.kind === "same" ? "opacity-60" : ""}>
                  <BlockPre text={r.aText} tone={r.kind === "conflict" ? "a" : r.kind === "onlyA" ? "onlyA" : "muted"} />
                  {r.kind === "conflict" && (
                    <button
                      type="button"
                      onClick={() => onChoose(r.conflictId!, "a")}
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-stroke/70 py-1 text-[10.5px] text-text-secondary transition-colors hover:border-red-400/60 hover:text-red-500"
                    >
                      取 A
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ===== 中：中立合并结果（主角）===== */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card/40">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-stroke/60 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand" aria-hidden />
          <span className="text-[11px] font-semibold text-text-primary">合并结果</span>
          <div className="ml-auto flex overflow-hidden rounded border border-stroke font-mono text-[10px]">
            {(["blocks", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setResultMode(m)}
                className={`flex items-center gap-1 px-1.5 py-0.5 transition-colors ${
                  resultMode === m ? "bg-brand text-white" : "bg-glass-2/60 text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {m === "blocks" ? <Columns2 className="h-2.5 w-2.5" /> : <Pencil className="h-2.5 w-2.5" />}
                {m === "blocks" ? "块视图" : "编辑"}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {resultMode === "edit" ? (
            <textarea
              value={editedBody ?? projectedText}
              onChange={(e) => onEditBody(e.target.value)}
              placeholder="合并正文…"
              spellCheck={false}
              className="h-full min-h-[320px] w-full resize-none rounded border border-stroke bg-card/60 p-2.5 font-mono text-[12px] leading-[1.7] text-text-secondary outline-none focus:border-brand/60"
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {rows.map((r) => {
                if (r.kind === "conflict") {
                  const c = r.conflictId ? byId.get(r.conflictId) : undefined;
                  if (!c) return null;
                  return (
                    <div key={r.id} className="border-l-2 border-amber-500/70 bg-amber-500/[.03]">
                      <div className="flex items-center gap-2 px-2 pt-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-tertiary">
                          {r.heading || "（开头段落）"}
                        </span>
                        <div className="ml-auto shrink-0">
                          <ChoiceSegment chosen={c.chosen} onChoose={(ch) => onChoose(c.id, ch)} />
                        </div>
                      </div>
                      <div className="p-1.5 pt-1">
                        <BlockPre text={resolveConflictText(c)} tone="result" />
                      </div>
                    </div>
                  );
                }
                const text = r.kind === "onlyB" ? r.bText : r.aText;
                const badge = r.kind === "onlyA" ? "来自 A · 并入" : r.kind === "onlyB" ? "来自 B · 并入" : "两侧相同";
                return (
                  <div key={r.id} className={r.kind === "same" ? "opacity-60" : ""}>
                    <div className="flex items-center gap-2 px-1">
                      <span className="min-w-0 truncate font-mono text-[10px] text-text-tertiary">
                        {r.heading || "（开头段落）"}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[9.5px] text-text-tertiary/80">{badge}</span>
                    </div>
                    <BlockPre text={text ?? ""} tone={r.kind === "onlyA" ? "onlyA" : r.kind === "onlyB" ? "onlyB" : "muted"} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ===== 右：B 来源 ===== */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card/20">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-stroke/60 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-400" aria-hidden />
          <span className="min-w-0 truncate text-[11px] font-semibold text-text-primary">B · {bName}</span>
          <span className="ml-auto font-mono text-[9.5px] text-text-tertiary">来源</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-1.5">
            {rows.map((r) =>
              r.bText === null ? (
                <EmptyCell key={r.id} label="—" />
              ) : (
                <div key={r.id} className={r.kind === "same" ? "opacity-60" : ""}>
                  <BlockPre text={r.bText} tone={r.kind === "conflict" ? "b" : r.kind === "onlyB" ? "onlyB" : "muted"} />
                  {r.kind === "conflict" && (
                    <button
                      type="button"
                      onClick={() => onChoose(r.conflictId!, "b")}
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-stroke/70 py-1 text-[10.5px] text-text-secondary transition-colors hover:border-emerald-400/60 hover:text-emerald-600"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      取 B
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 附件单文件三向视图（PLAN-15 反馈：正文与附件共享同一渲染区，不做底部展开）
// ---------------------------------------------------------------------------

export type FileChoice = "a" | "b" | "both";

export interface FileThreeWayProps {
  aName: string;
  bName: string;
  rel: string;
  kind: "conflict" | "same" | "onlyA" | "onlyB";
  aContent: string | null;
  bContent: string | null;
  chosen: FileChoice;
  onChoose: (ch: FileChoice) => void;
}

/** 附件冲突「都保留」时 B 的改名落点名（与 copyOps 的 .from-b 规则一致）。 */
function fromBName(rel: string): string {
  const dot = rel.lastIndexOf(".");
  const stem = dot > 0 ? rel.slice(0, dot) : rel;
  const ext = dot > 0 ? rel.slice(dot) : "";
  return `${stem}.from-b${ext}`;
}

/**
 * 单个附件文件的三向视图：A 内容｜中立结果｜B 内容。
 * 与正文三向共用同一视觉范式（三列各自滚动、左色条、结果列决策），
 * 替代旧「底部附件横带 + 展开渲染」的割裂布局。
 */
export function FileThreeWay({ aName, bName, rel, kind, aContent, bContent, chosen, onChoose }: FileThreeWayProps) {
  const badge =
    kind === "conflict" ? "同名不同内容" : kind === "same" ? "同名同内容" : kind === "onlyA" ? "仅 A 有" : "仅 B 有";

  // 结果列内容：conflict 按 chosen 取 A/B；「都保留」无单一合并正文，展示说明
  const resultText =
    kind === "conflict"
      ? chosen === "a"
        ? aContent ?? ""
        : chosen === "b"
          ? bContent ?? ""
          : ""
      : kind === "onlyB"
        ? bContent ?? ""
        : aContent ?? "";

  const keepBoth = kind === "conflict" && chosen === "both";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden border border-stroke/60 lg:grid-cols-[1fr_1.15fr_1fr]">
      {/* A */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card/20">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-stroke/60 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-sm bg-red-400" aria-hidden />
          <span className="min-w-0 truncate text-[11px] font-semibold text-text-primary">A · {aName}</span>
          <span className="ml-auto font-mono text-[9.5px] text-text-tertiary">来源</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {aContent === null ? (
            <div className="p-3 text-[11px] text-text-tertiary">（仅 B 有，A 无此文件）</div>
          ) : (
            <BlockPre text={aContent} tone={kind === "conflict" ? "a" : kind === "onlyA" ? "onlyA" : "muted"} />
          )}
        </div>
      </div>

      {/* 结果 */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card/40">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-stroke/60 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand" aria-hidden />
          <span className="min-w-0 truncate text-[11px] font-semibold text-text-primary">合并结果 · {rel}</span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-text-tertiary">{badge}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {kind === "conflict" && (
            <div className="mb-1.5">
              <ChoiceSegment chosen={chosen} onChoose={onChoose} />
            </div>
          )}
          {keepBoth ? (
            <div className="border-l-2 border-amber-500/70 bg-amber-500/[.03] p-3 text-[11.5px] leading-relaxed text-text-secondary">
              将保留两份文件：<span className="font-mono text-[11px]">{rel}</span>（A）与
              <span className="font-mono text-[11px]"> {fromBName(rel)}</span>（B 改名后并入）。
            </div>
          ) : (
            <BlockPre
              text={resultText || "（空文件）"}
              tone={kind === "conflict" ? "result" : kind === "onlyA" ? "onlyA" : kind === "onlyB" ? "onlyB" : "muted"}
            />
          )}
        </div>
      </div>

      {/* B */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card/20">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-stroke/60 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-400" aria-hidden />
          <span className="min-w-0 truncate text-[11px] font-semibold text-text-primary">B · {bName}</span>
          <span className="ml-auto font-mono text-[9.5px] text-text-tertiary">来源</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {bContent === null ? (
            <div className="p-3 text-[11px] text-text-tertiary">（仅 A 有，B 无此文件）</div>
          ) : (
            <BlockPre text={bContent} tone={kind === "conflict" ? "b" : kind === "onlyB" ? "onlyB" : "muted"} />
          )}
        </div>
      </div>
    </div>
  );
}
