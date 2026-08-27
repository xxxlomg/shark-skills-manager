import { memo, useMemo } from "react";
import { renderMd } from "@/lib/markdown";

interface MarkdownRendererProps {
  content: string;
}

/**
 * Markdown 渲染：useMemo 缓存解析结果（content 不变则零成本），
 * memo 隔离重渲染 —— 流式翻译时仅在 content 变化帧重新解析，
 * 避免此前「每帧全文重解析 + 整块 DOM 重建」。
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: MarkdownRendererProps) {
  const html = useMemo(() => renderMd(content), [content]);
  return (
    <div
      className="md-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
