/**
 * 设置 → 外观分区（从 SettingsDialog 拆出）。
 * 主题色选择（点击立即生效并自动保存）+ 导航布局切换（顶栏 / 侧栏）。
 */
import { Check, PanelLeft, PanelTop } from "lucide-react";
import { ACCENTS, type AccentId } from "@/lib/accent";

interface AppearanceSectionProps {
  accent: AccentId;
  onAccentChange: (accent: AccentId) => void;
  navMode: "top" | "sidebar" | undefined;
  onNavModeChange?: (mode: "top" | "sidebar") => void;
}

const NAV_OPTIONS = [
  { id: "top", label: "顶栏", icon: PanelTop },
  { id: "sidebar", label: "侧栏", icon: PanelLeft },
] as const;

export function AppearanceSection({
  accent,
  onAccentChange,
  navMode,
  onNavModeChange,
}: AppearanceSectionProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        界面主题色，点击立即生效并自动保存。
      </p>
      <div className="grid grid-cols-2 gap-2">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onAccentChange(a.id)}
            className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors ${
              accent === a.id
                ? "border-stroke-hi bg-glass-2"
                : "border-border hover:border-stroke-hi"
            }`}
          >
            <span className="flex shrink-0 -space-x-1.5">
              <span
                className="h-4 w-4 rounded-full ring-1 ring-black/20"
                style={{ background: a.dark }}
              />
              <span
                className="h-4 w-4 rounded-full ring-1 ring-white/40"
                style={{ background: a.light }}
              />
            </span>
            <span className="text-sm text-foreground">{a.name}</span>
            {accent === a.id && (
              <Check className="ml-auto h-4 w-4 text-[var(--accent)]" />
            )}
          </button>
        ))}
      </div>

      {/* PLAN-10 P2：全局布局切换（立即生效并自动保存） */}
      <div className="space-y-1.5 border-t border-stroke pt-3">
        <p className="text-sm font-medium text-foreground">导航布局</p>
        <p className="text-[11px] text-text-tertiary">
          侧栏模式在左侧常驻主视图菜单与技能库目录树，深层级技能查看时可直达任意层级。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {NAV_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = (navMode ?? "top") === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onNavModeChange?.(opt.id)}
                className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
                  active
                    ? "border-stroke-hi bg-glass-2 text-foreground"
                    : "border-border text-text-secondary hover:border-stroke-hi hover:text-text-primary"
                }`}
              >
                <Icon className="h-4 w-4" />
                {opt.label}
                {active && <Check className="ml-auto h-4 w-4 text-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}