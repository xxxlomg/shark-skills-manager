/**
 * AI 流式输出侧栏（从 AuthoringWorkbench 拆出）。
 * R3-3 并列辅助 pane：承载续写/生成流式 Markdown + 思考过程可视化（ThinkingBlock），
 * 流式期间自动追随底部；停止 / 追加到正文 / 关闭 三操作。
 */
import { Sparkles, StopCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import { ThinkingBlock } from "./ThinkingBlock";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface StreamPaneProps {
  streaming: boolean;
  streamDone: boolean;
  stream: string;
  thinkStream: string;
  /** 与编辑列并排时是否占固定宽度（编辑器收起时占满） */
  editorOpen: boolean;
  onStop: () => void;
  onApply: () => void;
  onClose: () => void;
}

export function StreamPane({
  streaming,
  streamDone,
  stream,
  thinkStream,
  editorOpen,
  onStop,
  onApply,
  onClose,
}: StreamPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream, streaming]);

  return (
    <aside
      className={cn(
        "flex h-[min(320px,42vh)] min-h-0 shrink-0 flex-col gap-3 xl:h-full",
        editorOpen ? "w-full xl:w-[36%] xl:max-w-[520px]" : "min-w-0 flex-1",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 gap-y-1 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-text-secondary">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span>
          {streaming
            ? "正在完善正文，生成内容会先显示在这里"
            : "补充内容已生成，可追加到正文"}
        </span>
        <div className="flex-1" />
        {streaming && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px] !text-red-500 !border-red-400/60 hover:!bg-red-500/10"
            onClick={onStop}
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
            onClick={onApply}
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
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <ThinkingBlock thinking={thinkStream} active={streaming && !stream.trim()} />
      <div
        ref={scrollRef}
        // R6：#2 流式预览滚动容器（streaming 期间自动追随底部）
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4"
      >
        <MarkdownPreview content={stream + (streaming ? "\n▍" : "")} />
      </div>
    </aside>
  );
}