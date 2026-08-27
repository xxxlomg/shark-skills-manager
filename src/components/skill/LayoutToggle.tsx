import { LayoutGrid, List } from "lucide-react";
import type { LayoutMode } from "@/hooks/useSkills";

interface LayoutToggleProps {
  value: LayoutMode;
  onChange: (mode: LayoutMode) => void;
}

/** 玻璃分段控件：网格 / 列表 切换 */
export function LayoutToggle({ value, onChange }: LayoutToggleProps) {
  const btn = (mode: LayoutMode, Icon: typeof LayoutGrid, label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-label={label}
      aria-pressed={value === mode}
      className={`grid h-[30px] w-8 place-items-center rounded-lg transition-colors duration-200 ${
        value === mode
          ? "border border-stroke-hi bg-glass-2 text-text-primary"
          : "border border-transparent text-text-tertiary hover:text-text-secondary"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div
      className="inline-flex items-center gap-[2px] rounded-[10px] border border-stroke bg-glass p-[3px]"
      style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
    >
      {btn("grid", LayoutGrid, "网格视图")}
      {btn("list", List, "列表视图")}
    </div>
  );
}
