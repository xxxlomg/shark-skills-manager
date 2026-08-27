import { memo, type CSSProperties, type KeyboardEvent } from "react";
import { FolderSymlink } from "lucide-react";
import type { Skill } from "@/hooks/useSkills";
import { toolDisplayName } from "@/hooks/useSkills";
import { StatusBadge } from "./StatusBadge";

interface SkillCardProps {
  skill: Skill;
  index: number;
  layout: "grid" | "list";
  onClick: () => void;
  /** 提供时进入多选模式：显示勾选框，选中态卡片高亮 */
  select?: { selected: boolean; onToggle: () => void };
}

/**
 * 技能卡片：网格态为竖排玻璃卡（顶部装饰条），列表态为横排玻璃行（左侧竖条）。
 * select 模式（多选）：外层为 div 壳（避免 input 嵌 button 的非法嵌套），
 * 勾选框点击 stopPropagation，不触发卡片点击。
 */
export const SkillCard = memo(function SkillCard({ skill, index, layout, onClick, select }: SkillCardProps) {
  const displayName = skill.title_zh || skill.name;
  const wrapStyle = { "--i": index } as CSSProperties;
  const selectedCls = select?.selected ? "card-selected" : "";

  const checkbox = select ? (
    <input
      type="checkbox"
      checked={select.selected}
      onChange={select.onToggle}
      onClick={(e) => e.stopPropagation()}
      className="relative z-[2] h-4 w-4 shrink-0 cursor-pointer accent-brand"
      aria-label={`选择 ${displayName}`}
    />
  ) : null;

  /** 点击外壳（div 壳模式下承担卡片点击） */
  const shellHandlers = {
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  };

  /** authored + 安装徽标（两种布局共用） */
  const metaBadges = (extraCls: string) => (
    <>
      {skill.tool_id === "authored" && (
        <span className={`${extraCls} inline-flex items-center gap-1 rounded border border-brand/40 bg-brand/10 px-1.5 py-px text-[10px] text-brand`}>
          ✍️ authored
        </span>
      )}
      {/* 安装徽标：显示该技能还被哪些工具持有（B4 聚合） */}
      {skill.other_sources.length > 0 && (
        <span className={`${extraCls} flex flex-wrap items-center gap-1`}>
          {skill.other_sources.slice(0, 3).map((t) => (
            <span key={t} className="rounded border border-stroke/60 bg-glass px-1.5 py-px text-[10px] text-text-tertiary">
              {toolDisplayName(t)} ✓
            </span>
          ))}
          {skill.other_sources.length > 3 && (
            <span className="text-[10px] text-text-tertiary">+{skill.other_sources.length - 3}</span>
          )}
        </span>
      )}
    </>
  );

  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrapStyle}>
        <div
          role="button"
          tabIndex={0}
          {...shellHandlers}
          className={`glass-card glass-card-hover card-glow relative flex w-full cursor-pointer items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left ${selectedCls}`}
        >
          {checkbox}
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-[20px]">
            {skill.emoji || "🧩"}
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 truncate font-display text-[15.5px] font-semibold text-text-primary">
              <span className="truncate">{displayName}</span>
              {skill.hub_linked && (
                <FolderSymlink
                  aria-label="Hub 链接落点"
                  className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                />
              )}
            </h3>
            <p className="truncate font-mono text-[11px] text-text-tertiary">
              {skill.name} · {skill.scan_label}
            </p>
            {metaBadges("mt-1")}
          </div>
          <div className="relative z-[1] shrink-0">
            <StatusBadge skill={skill} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-wrap" style={wrapStyle}>
      <div
        role="button"
        tabIndex={0}
        {...shellHandlers}
        className={`glass-card glass-card-hover card-deco card-glow relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-5 text-left ${selectedCls}`}
      >
        <div className="relative z-[1] flex items-start justify-between gap-2">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-[22px]">
            {skill.emoji || "🧩"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {checkbox}
            <StatusBadge skill={skill} />
          </div>
        </div>
        <h3 className="relative z-[1] mt-4 flex items-start gap-1.5 font-display text-[19px] font-semibold leading-snug text-text-primary">
          <span className="min-w-0">{displayName}</span>
          {skill.hub_linked && (
            <FolderSymlink
              aria-label="Hub 链接落点"
              className="mt-[5px] h-4 w-4 shrink-0 text-text-tertiary"
            />
          )}
        </h3>
        <p className="relative z-[1] mt-[3px] font-mono text-[12px] text-text-tertiary">
          {skill.name} · {skill.scan_label}
        </p>
        {metaBadges("mt-1.5 relative z-[1]")}
        <p className="relative z-[1] mt-[10px] line-clamp-2 text-[12.5px] leading-relaxed text-text-secondary">
          {skill.description_zh || skill.description || "暂无描述"}
        </p>
      </div>
    </div>
  );
}, (prev, next) =>
  // 忽略 onClick/select.onToggle：闭包仅捕获稳定 skill + 父级稳定回调，同 skill 下行为等价
  prev.skill === next.skill &&
  prev.index === next.index &&
  prev.layout === next.layout &&
  prev.select?.selected === next.select?.selected
);
