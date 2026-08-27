import type { ReactNode } from "react";

interface EmptyPanelProps {
  /** 品牌色图标（放在圆角方块内） */
  icon: ReactNode;
  title: string;
  description?: string;
  /** 操作卡片（GhostCard 等）；1 个居中、2 个并排 */
  actions?: ReactNode[];
}

/**
 * 各 Tab 页统一的空状态面板（Packs / Hub / 创作 / 技能库共用）。
 * 样式口径：品牌色圆角方块图标 + 标题 + 描述 + （可选）虚线操作卡。
 */
export function EmptyPanel({ icon, title, description, actions }: EmptyPanelProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-[16px] border border-stroke bg-glass-2 text-brand">
          {icon}
        </span>
        <h3 className="font-display text-[17px] font-semibold text-text-primary">
          {title}
        </h3>
        {description && (
          <p className="max-w-xs text-[13px] leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {actions && actions.length > 0 && (
        <div
          className={`grid w-full gap-5 ${
            actions.length > 1
              ? "max-w-[560px] grid-cols-1 sm:grid-cols-2"
              : "max-w-[280px] grid-cols-1"
          }`}
        >
          {actions}
        </div>
      )}
    </div>
  );
}