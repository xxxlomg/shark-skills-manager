import { skillStatus, STATUS_TEXT, type Skill } from "@/hooks/useSkills";

/** 翻译状态徽章：光点 + 文案（已翻译 / 译文过期 / 待翻译） */
export function StatusBadge({ skill }: { skill: Skill }) {
  const st = skillStatus(skill);
  return (
    <span className="inline-flex items-center gap-[6px] rounded-md border border-stroke bg-glass-2 px-[10px] py-[3px] text-[11px] text-text-secondary">
      <span className={`sd sd-${st}`} />
      {STATUS_TEXT[st]}
    </span>
  );
}
