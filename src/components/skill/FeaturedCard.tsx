import { memo, type CSSProperties } from "react";
import { Folder } from "lucide-react";
import { skillStatus, type Skill, type SkillGroup } from "@/hooks/useSkills";

interface FeaturedCardProps {
  group: SkillGroup;
  index: number;
  onSkillClick: (skill: Skill) => void;
  onOpenFolder: () => void;
}

/**
 * 精选合集宽卡（跨两列）：左列为合集信息，右列为前 6 个技能 chip。
 * chip 点击直达对应技能详情；卡片其余区域点击进入合集。
 */
export const FeaturedCard = memo(function FeaturedCard({
  group,
  index,
  onSkillClick,
  onOpenFolder,
}: FeaturedCardProps) {
  const total = group.skills.length;
  const ok = group.skills.filter((s) => s.has_translation).length;
  const chips = group.skills.slice(0, 6);
  const more = total - chips.length;

  return (
    <div
      className="card-wrap sm:col-span-2"
      style={{ "--i": index } as CSSProperties}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenFolder}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenFolder();
          }
        }}
        className="glass-card glass-card-hover card-deco card-glow relative grid cursor-pointer grid-cols-1 items-center gap-[22px] overflow-hidden p-6 text-left outline-none sm:grid-cols-[1fr_1.15fr]"
      >
        <div className="relative z-[1] min-w-0">
          <div className="flex items-start justify-between">
            <span className="grid h-[46px] w-[46px] place-items-center rounded-[13px] border border-stroke bg-glass-2 text-brand">
              <Folder className="h-[22px] w-[22px]" />
            </span>
            <span className="rounded-md border border-stroke bg-glass-2 px-[10px] py-[3px] font-mono text-[12px] text-text-secondary">
              {total}
            </span>
          </div>
          <h3 className="mt-4 font-display text-[21px] font-semibold text-text-primary">
            {group.label}
          </h3>
          <p className="mt-[3px] text-[12.5px] text-text-secondary">
            {total} 个技能 · {ok} 已翻译
          </p>
        </div>

        <div className="relative z-[1] flex flex-wrap content-center gap-2">
          {chips.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSkillClick(s);
              }}
              className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[11px] border border-stroke bg-glass-2 px-[11px] py-[7px] text-[12.5px] text-text-secondary transition-all duration-200 hover:border-stroke-hi hover:text-text-primary"
            >
              <span className={`sd sd-${skillStatus(s)}`} />
              {s.title_zh || s.name}
            </button>
          ))}
          {more > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFolder();
              }}
              className="inline-flex items-center whitespace-nowrap rounded-[11px] border border-stroke bg-glass-2 px-[11px] py-[7px] text-[12.5px] text-brand transition-all duration-200 hover:border-stroke-hi"
            >
              +{more} 查看全部
            </button>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.group === next.group &&
  prev.index === next.index
);
