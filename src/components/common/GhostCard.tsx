import type { CSSProperties, ReactNode } from "react";

interface GhostCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  index: number;
  layout?: "grid" | "list";
  onClick: () => void;
}

/**
 * 虚线动作卡（从 Git 导入 / 创建 Pack / 导入 .skillpack）。
 * 透明背景、无阴影、无顶部装饰条；hover 时边框转品牌色并轻微上浮。
 */
export function GhostCard({
  icon,
  title,
  subtitle,
  index,
  layout = "grid",
  onClick,
}: GhostCardProps) {
  const isList = layout === "list";

  return (
    <div className="card-wrap" style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        onClick={onClick}
        className={`group flex w-full items-center border border-dashed border-stroke-hi bg-transparent text-left text-text-secondary transition-all duration-300 hover:border-brand hover:bg-glass hover:text-text-primary ${
          isList
            ? "min-h-0 flex-row gap-3 rounded-[14px] px-[18px] py-[14px]"
            : "min-h-[150px] flex-col justify-center gap-[10px] rounded-[18px] p-5 text-center"
        }`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-text-tertiary transition-all duration-300 group-hover:border-brand group-hover:text-brand ${
            isList ? "h-[38px] w-[38px]" : "h-[46px] w-[46px]"
          }`}
        >
          {icon}
        </span>
        <span className={`flex min-w-0 flex-col ${isList ? "" : "items-center"}`}>
          <span className="truncate text-[13.5px] font-medium text-text-primary">
            {title}
          </span>
          <span className="truncate text-[11.5px] text-text-tertiary">{subtitle}</span>
        </span>
      </button>
    </div>
  );
}
