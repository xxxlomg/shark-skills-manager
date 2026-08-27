import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown 实时渲染预览（UI 反馈 2026-08-05 条目 6）。
 * 轻量样式映射，不开 typography 插件；用于创作页正文分栏/全屏预览。
 * 2026-08-25：引入 remark-gfm 支持 GFM 表格/删除线/任务列表；
 * 表格组件添加 Tailwind 样式 + 响应式滚动包裹。
 */
export function MarkdownPreview({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className ?? ""}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => (
            <h1 className="mb-2 mt-4 text-lg font-bold text-text-primary first:mt-0">
              {p.children}
            </h1>
          ),
          h2: (p) => (
            <h2 className="mb-2 mt-3 text-base font-semibold text-text-primary first:mt-0">
              {p.children}
            </h2>
          ),
          h3: (p) => (
            <h3 className="mb-1.5 mt-2 text-sm font-semibold text-text-primary first:mt-0">
              {p.children}
            </h3>
          ),
          p: (p) => (
            <p className="my-1.5 text-[14px] leading-[1.75] text-text-secondary">
              {p.children}
            </p>
          ),
          ul: (p) => (
            <ul className="my-1.5 list-disc pl-5 text-[13px] text-text-secondary">
              {p.children}
            </ul>
          ),
          ol: (p) => (
            <ol className="my-1.5 list-decimal pl-5 text-[13px] text-text-secondary">
              {p.children}
            </ol>
          ),
          li: (p) => <li className="my-0.5">{p.children}</li>,
          pre: (p) => (
            <pre className="my-2 overflow-x-auto rounded-md border border-border/40 bg-glass-1 p-2 font-mono text-[12px] text-text-secondary">
              {p.children}
            </pre>
          ),
          code: (p) => (
            <code className="rounded bg-glass-2 px-1 py-0.5 font-mono text-[12px]">
              {p.children}
            </code>
          ),
          blockquote: (p) => (
            <blockquote className="my-2 border-l-2 border-primary/50 pl-3 text-text-secondary">
              {p.children}
            </blockquote>
          ),
          a: (p) => (
            <a className="text-primary underline" href={p.href} target="_blank" rel="noreferrer">
              {p.children}
            </a>
          ),
          hr: () => <hr className="my-3 border-border/40" />,
          strong: (p) => (
            <strong className="font-semibold text-text-primary">{p.children}</strong>
          ),
          // GFM 表格：响应式滚动包裹 + 边框样式
          table: (p) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border/50">
              <table className="w-full border-collapse text-[12.5px]">
                {p.children}
              </table>
            </div>
          ),
          thead: (p) => (
            <thead className="bg-glass-2">{p.children}</thead>
          ),
          tbody: (p) => <tbody>{p.children}</tbody>,
          tr: (p) => (
            <tr className="border-b border-border/40 last:border-b-0">
              {p.children}
            </tr>
          ),
          th: (p) => (
            <th className="whitespace-nowrap border-r border-border/40 px-3 py-2 text-left font-semibold text-text-primary last:border-r-0">
              {p.children}
            </th>
          ),
          td: (p) => (
            <td className="border-r border-border/40 px-3 py-2 text-text-secondary last:border-r-0">
              {p.children}
            </td>
          ),
          // GFM 删除线
          del: (p) => (
            <del className="text-text-tertiary line-through">{p.children}</del>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
