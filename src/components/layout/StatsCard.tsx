import { Layers, CheckCircle2, Package, FileWarning, Link2Off } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** 单个工具的统计（技能数 / 已翻译 / 译文丢失） */
export interface ToolStat {
  label: string;
  total: number;
  translated: number;
  lost: number;
}

export interface StatsData {
  total: number;
  translated: number;
  lost: number;
  packCount: number;
  tools: ToolStat[];
  /** 异常引用数（落点缺失 / 孤儿），0 时不显示 */
  abnormalLinks?: number;
}

interface AggItem {
  icon: LucideIcon;
  color: string;
  key: "total" | "translated" | "lost" | "packCount" | "abnormalLinks";
  label: string;
}

const AGG: AggItem[] = [
  { icon: Layers, color: "var(--cyan)", key: "total", label: "技能" },
  { icon: CheckCircle2, color: "var(--green)", key: "translated", label: "已翻译" },
  { icon: FileWarning, color: "var(--amber)", key: "lost", label: "译文丢失" },
  { icon: Package, color: "var(--rose)", key: "packCount", label: "Packs" },
  { icon: Link2Off, color: "var(--red)", key: "abnormalLinks", label: "异常引用" },
];

/**
 * 统计卡片（瑞士风）：聚合四项 + 翻译进度 + 按工具分布。
 * 复用两处：顶栏悬停卡、侧栏底部菜单项。
 */
export function StatsCard({ total, translated, lost, packCount, tools, abnormalLinks = 0 }: StatsData) {
  const pct = total > 0 ? Math.round((translated / total) * 100) : 0;
  const values: Record<AggItem["key"], number> = { total, translated, lost, packCount, abnormalLinks };

  // 异常引用为 0 时不显示该项
  const visibleAgg = AGG.filter((item) => item.key !== "abnormalLinks" || abnormalLinks > 0);

  return (
    <div className="flex flex-col gap-3.5">
      {/* 聚合项（异常引用为 0 时隐藏） */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {visibleAgg.map((item) => (
          <div key={item.key} className="flex items-center gap-2.5">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-stroke bg-glass-2"
              style={{ color: item.color }}
              aria-hidden
            >
              <item.icon className="h-[14px] w-[14px]" />
            </span>
            <span className="flex min-w-0 items-baseline gap-1">
              <b className="font-display text-[16px] font-semibold tabular-nums text-text-primary">
                {values[item.key]}
              </b>
              <span className="truncate text-[11.5px] text-text-secondary">{item.label}</span>
            </span>
          </div>
        ))}
      </div>

      {/* 翻译进度 */}
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap text-[11.5px] text-text-secondary">翻译进度 {pct}%</span>
        <div className="relative h-[6px] min-w-[80px] flex-1 overflow-hidden rounded-full bg-glass-2">
          <div className="prog-fill h-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 按工具分布 */}
      {tools.length > 0 && (
        <div className="border-t border-stroke/60 pt-2.5">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
            按工具分布
          </p>
          <div className="space-y-1">
            {tools.map((t) => (
              <div key={t.label} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{t.label}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
                  {t.total} 技能
                </span>
                {t.translated > 0 && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-green">{t.translated} 译</span>
                )}
                {t.lost > 0 && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber">{t.lost} 失</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
