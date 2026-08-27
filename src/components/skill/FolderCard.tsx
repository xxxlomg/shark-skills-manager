import { memo, type CSSProperties } from "react";
import { Folder } from "lucide-react";
import { Tip } from "@/components/common/Tip";
import { skillStatus, toolDisplayName, type Skill, type SkillGroup } from "@/hooks/useSkills";

interface FolderCardProps {
  group: SkillGroup;
  index: number;
  layout: "grid" | "list";
  onClick: () => void;
  onSkillClick?: (skill: Skill) => void;
}

/** 网格态右侧技能小 tag 上限，超出截断为 +N */
const MAX_CHIPS = 6;

/** 合集（分类）卡片：与 SkillCard 同形的标准玻璃卡；列表态横排。 */
export const FolderCard = memo(function FolderCard({
  group,
  index,
  layout,
  onClick,
  onSkillClick,
}: FolderCardProps) {
  const total = group.skills.length;
  const ok = group.skills.filter((s) => s.has_translation).length;
  const preview = group.skills.slice(0, 4);
  const moreList = total - preview.length;
  const wrapStyle = { "--i": index } as CSSProperties;

  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrapStyle}>
        <button
          type="button"
          onClick={onClick}
          className="glass-card glass-card-hover card-glow relative flex w-full items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left"
        >
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-brand">
            <Folder className="h-5 w-5" />
          </span>
          <div className="relative z-[1] min-w-0">
            <h3 className="truncate font-display text-[15.5px] font-semibold text-text-primary">
              {toolDisplayName(group.label)}
            </h3>
            <p className="font-mono text-[11px] text-text-tertiary">
              {ok}/{total} 已翻译
            </p>
          </div>
          <div className="relative z-[1] ml-auto flex items-center gap-[6px]">
            {preview.map((s) => (
              <Tip key={s.id} label={s.title_zh || s.name}>
                <span className="grid h-[28px] w-[28px] place-items-center rounded-[8px] border border-stroke bg-glass-2 text-[14px]">
                  {s.emoji || "🧩"}
                </span>
              </Tip>
            ))}
            {moreList > 0 && (
              <span className="font-mono text-[11px] text-text-tertiary">+{moreList}</span>
            )}
          </div>
        </button>
      </div>
    );
  }

  const chips = group.skills.slice(0, MAX_CHIPS);
  const more = total - chips.length;

  return (
    <div className="card-wrap" style={wrapStyle}>
      {/* 外层用 div[role=button]：内部 chip 是 button，避免交互元素嵌套 */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="glass-card glass-card-hover card-deco card-glow relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-5 text-left outline-none"
      >
        <div className="relative z-[1] flex items-start justify-between gap-2">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-brand">
            <Folder className="h-[22px] w-[22px]" />
          </span>
          <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-[10px] py-[3px] font-mono text-[12px] text-text-secondary">
            {total}
          </span>
        </div>
        <h3 className="relative z-[1] mt-4 truncate font-display text-[19px] font-semibold leading-snug text-text-primary">
          {toolDisplayName(group.label)}
        </h3>
        <p className="relative z-[1] mt-[3px] font-mono text-[12px] text-text-tertiary">
          {ok}/{total} 已翻译
        </p>
        <div className="relative z-[1] mt-[12px] flex flex-1 flex-wrap content-start gap-[6px]">
          {chips.map((s) => (
            <Tip key={s.id} label={s.title_zh || s.name}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSkillClick?.(s);
                }}
                className="inline-flex max-w-[130px] items-center gap-[6px] rounded-[8px] border border-stroke bg-glass-2 px-[8px] py-[4px] text-[11px] text-text-secondary transition-colors hover:border-stroke-hi hover:text-text-primary"
              >
                <span className={`sd sd-${skillStatus(s)}`} />
                <span className="truncate">{s.title_zh || s.name}</span>
              </button>
            </Tip>
          ))}
          {more > 0 && (
            <span className="inline-flex items-center rounded-[8px] border border-stroke bg-glass-2 px-[8px] py-[4px] font-mono text-[11px] text-text-tertiary">
              +{more}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.group === next.group &&
  prev.index === next.index &&
  prev.layout === next.layout
);
