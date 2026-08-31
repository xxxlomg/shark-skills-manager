import { memo, useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

interface ThinkingBlockProps {
  /** 思考过程全文（流式累积，仅内存） */
  thinking: string;
  /** 是否仍在思考（true=流式滚出） */
  active: boolean;
}

/**
 * AI 思考过程展示块（仅可视化，不持久化）：
 * - active 时实时滚动跟随输出；
 * - 思考结束（首个正文增量到达）由父组件把 active 置 false，本组件自动收起；
 * - 用户可手动展开回看；再次 active 会重新打开。
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
    <div className="shrink-0 overflow-hidden rounded-md border border-primary/25 bg-primary/[0.04]">
      <button
        type="button"
        onClick={() => setManualOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-primary/[0.06]"
      >
        <Brain className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">思考过程</span>
        {active ? (
          <span className="font-mono text-[10px] text-text-tertiary">推理中…</span>
        ) : (
          <span className="font-mono text-[10px] text-text-tertiary">{thinking.length} 字</span>
        )}
        <span className="flex-1" />
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="max-h-44 overflow-y-auto border-t border-primary/15 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-tertiary"
        >
          {thinking}
          {active && <span className="animate-pulse">▍</span>}
        </div>
      )}
    </div>
  );
});