import { useLayoutEffect, useRef, useState } from "react";
import { VIEW_REGISTRY, type ViewId } from "@/lib/view-registry";

interface TabNavProps {
  activeTab: ViewId;
  onChange: (tab: ViewId) => void;
}

/**
 * 主导航（紧凑下划线式 tabs）。
 *
 * 去掉了原 pill 容器（rounded + bg-glass + 26px 上边距），改为贴内容顶部的
 * 细下划线 tabs：发丝线底边 + 2px 品牌色下划线滑块指示当前 tab，垂直占用更小。
 * 仍数据驱动，只消费 VIEW_REGISTRY；滑块位置经 ref 测量，resize 时重算。
 */
export function TabNav({ activeTab, onChange }: TabNavProps) {
  const btnRefs = useRef<Map<ViewId, HTMLButtonElement | null>>(new Map());
  const [indicator, setIndicator] = useState({ x: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current.get(activeTab);
      if (!btn) return;
      setIndicator({ x: btn.offsetLeft, width: btn.offsetWidth, ready: true });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeTab]);

  return (
    <nav
      className="relative mt-2 flex items-center gap-1 border-b border-stroke"
      aria-label="主导航"
    >
      {/* 下划线滑块指示器 */}
      <span
        aria-hidden
        className="absolute bottom-[-1px] left-0 z-[1] h-[2px] rounded-full bg-brand"
        style={{
          transform: `translateX(${indicator.x}px)`,
          width: indicator.width,
          transition:
            "transform 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1)",
          opacity: indicator.ready ? 1 : 0,
        }}
      />

      {VIEW_REGISTRY.map((view) => {
        const active = activeTab === view.id;
        const Icon = view.icon;
        return (
          <button
            key={view.id}
            type="button"
            ref={(el) => {
              btnRefs.current.set(view.id, el);
            }}
            onClick={() => onChange(view.id)}
            aria-pressed={active}
            className={`relative z-[2] flex items-center gap-[7px] border-0 bg-transparent px-3 py-2 font-body text-[13px] font-medium transition-colors ${
              active ? "text-brand" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon className="h-[15px] w-[15px]" />
            {view.label}
          </button>
        );
      })}
    </nav>
  );
}
