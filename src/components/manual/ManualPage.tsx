import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import {
  MANUAL_CHAPTERS,
  buildToc,
  splitSections,
} from "@/lib/manual-content";
import { APP_VERSION } from "@/lib/version";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import { Tip } from "@/components/common/Tip";

interface ManualPageProps {
  onClose: () => void;
}

/**
 * 使用手册白皮书面（P1，形态 A：应用内全屏页）：
 * 顶栏返回 + 左侧章节目录（TOC，滚动高亮 / 点击跳转）+ 右侧正文。
 * 内容由 src/assets/manual/*.md 装配，章节以 ## 切块挂锚点。
 */
export function ManualPage({ onClose }: ManualPageProps) {
  const toc = useMemo(() => buildToc(MANUAL_CHAPTERS), []);
  const [activeId, setActiveId] = useState<string>(toc[0]?.id ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);
  // 点击 TOC 后的短暂窗口内不让滚动监听抢走高亮（防跳动）
  const suppressSpyUntil = useRef(0);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 滚动高亮：正文容器滚动时找「视口上沿之下最近的一个锚点」
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      if (Date.now() < suppressSpyUntil.current) return;
      const threshold = root.getBoundingClientRect().top + 96;
      let current = toc[0]?.id ?? "";
      for (const entry of toc) {
        const el = document.getElementById(`manual-${entry.id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) current = entry.id;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [toc]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`manual-${id}`);
    if (!el) return;
    suppressSpyUntil.current = Date.now() + 700;
    setActiveId(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <Tip label="返回应用（Esc）">
          <button
            className="iconbtn"
            aria-label="返回应用"
            onClick={onClose}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Tip>
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <BookOpen className="h-4 w-4 text-brand" />
          shark skills 使用手册
        </div>
        <span className="ml-auto rounded-md border border-border bg-glass px-2 py-0.5 font-mono text-[11px] text-text-secondary">
          v{APP_VERSION}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧目录 */}
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-border py-5">
          <nav className="flex flex-col gap-0.5 px-3">
            {toc.map((entry) => {
              const active = entry.id === activeId;
              return (
                <button
                  key={entry.id}
                  onClick={() => jumpTo(entry.id)}
                  className={
                    entry.level === 1
                      ? `rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                          active
                            ? "bg-glass-2 text-brand"
                            : "text-text-primary hover:bg-glass"
                        }`
                      : `rounded-md py-1 pl-6 pr-2.5 text-left text-xs transition-colors ${
                          active
                            ? "bg-glass-2 text-brand"
                            : "text-text-secondary hover:bg-glass hover:text-text-primary"
                        }`
                  }
                >
                  {entry.title}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 正文 */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-8 py-10">
            {MANUAL_CHAPTERS.map((ch) => {
              const blocks = splitSections(ch.body);
              return (
                <div key={ch.id} id={`manual-${ch.id}`} className="scroll-mt-6">
                  {blocks.map((block, i) => (
                    <div
                      key={i}
                      // 第 0 块是章节引子（含 h1），之后每块对应一个 ## 小节
                      id={i === 0 ? undefined : `manual-${ch.id}-s${i - 1}`}
                      className="scroll-mt-6"
                    >
                      <MarkdownRenderer content={block} />
                    </div>
                  ))}
                  <div className="my-10 border-t border-border" />
                </div>
              );
            })}
            <p className="pb-16 text-center text-xs text-text-tertiary">
              shark skills v{APP_VERSION} 本地优先，技能由你掌控
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
