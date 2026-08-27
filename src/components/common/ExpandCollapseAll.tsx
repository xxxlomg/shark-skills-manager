import { ListCollapse, ListTree } from "lucide-react";

interface Props {
  onExpandAll: () => void;
  onCollapseAll: () => void;
  className?: string;
}

/**
 * 树结构「一键展开 / 收起全部」紧凑分组控件。
 * 侧栏技能树 / Pack 打包树 / Hub 建链树 通用，保持视觉一致。
 * 设计：小圆角胶囊容器 + 两枚 24px 幽灵图标按钮 + 细分隔线，
 * 避免大盒子按钮换行造成的凌乱感。
 */
export function ExpandCollapseAll({
  onExpandAll,
  onCollapseAll,
  className = "",
}: Props) {
  const btn =
    "grid h-6 w-6 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-glass-2 hover:text-text-primary";
  return (
    <div
      className={`flex shrink-0 items-center rounded-lg border border-border/50 bg-glass-1 p-0.5 ${className}`}
    >
      <button
        type="button"
        onClick={onExpandAll}
        title="展开全部"
        aria-label="展开全部"
        className={btn}
      >
        <ListTree className="h-3.5 w-3.5" />
      </button>
      <div className="mx-0.5 h-3 w-px bg-border/60" />
      <button
        type="button"
        onClick={onCollapseAll}
        title="收起全部"
        aria-label="收起全部"
        className={btn}
      >
        <ListCollapse className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
