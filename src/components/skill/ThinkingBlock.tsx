import { memo, useEffect, useRef, useState } from "react";

interface ThinkingBlockProps {
  /** 思考过程全文（流式期间实时更新，完成后随消息保留） */
  thinking: string;
  /** 是否仍在思考（true=流式滚出） */
  active: boolean;
}

/**
 * AI 思考过程展示块：
 * - active 时实时滚动跟随输出；
 * - 思考结束后自动收起，历史消息仍可手动展开回看；
 * - 使用无边框的「> thinking」行，避免把思考过程误认为正文面板。
 */
export const ThinkingBlock = memo(function ThinkingBlock({ thinking, active }: ThinkingBlockProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const prevActiveRef = useRef<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) {
      setManualOpen(true);
      prevActiveRef.current = true;
    } else if (prevActiveRef.current && !active) {
      // 思考结束：自动收起（用户已手动展开过的本轮不再强制收起）
      setManualOpen(false);
      prevActiveRef.current = false;
    }
  }, [active]);

  useEffect(() => {
    if (active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [thinking, active]);

  if (!thinking) return null;
  const open = active || manualOpen;

  return (
    <div className="w-full min-w-0 max-w-full shrink-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setManualOpen((v) => !v)}
        className="flex min-w-0 max-w-full items-center gap-1.5 py-1 text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
        aria-expanded={open}
      >
        <span className="font-mono text-primary">{open ? "v" : ">"}</span>
        <span className="font-mono font-medium">thinking</span>
        <span className="font-mono text-[10px] text-text-tertiary/80">
          {active ? "推理中…" : `${thinking.length} 字`}
        </span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="w-full min-w-0 max-w-full max-h-36 overflow-x-hidden overflow-y-auto break-words border-l border-border/50 pl-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-tertiary [overflow-wrap:anywhere]"
        >
          {thinking}
          {active && <span className="animate-pulse">▍</span>}
        </div>
      )}
    </div>
  );
});
