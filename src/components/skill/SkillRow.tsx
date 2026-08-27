import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Languages, AlertTriangle, Folder } from "lucide-react";
import type { Skill } from "@/hooks/useSkills";
import { collectionDisplayName } from "@/hooks/useSkills";

interface SkillRowProps {
  skill: Skill;
  onClick: () => void;
}

export function SkillRow({ skill, onClick }: SkillRowProps) {
  const displayName = skill.title_zh || skill.name;
  const isDeleted = skill.source_deleted;

  const nameRef = useRef<HTMLSpanElement | null>(null);
  const [tipOpen, setTipOpen] = useState(false);

  const handleEnter = () => {
    const el = nameRef.current;
    if (el && el.scrollWidth > el.clientWidth) setTipOpen(true);
  };

  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/30 ${
        isDeleted ? "opacity-60" : ""
      }`}
    >
      <span className="shrink-0 text-xl">{skill.emoji || "🧩"}</span>

      <Tooltip open={tipOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <span
            ref={nameRef}
            onMouseEnter={handleEnter}
            className="min-w-0 max-w-[180px] shrink-0 truncate text-sm font-semibold text-foreground"
          >
            {displayName}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal break-words">
          {displayName}
        </TooltipContent>
      </Tooltip>

      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {skill.description_zh || skill.description || "无描述"}
      </span>

      {skill.scan_label && (
        <Badge variant="secondary" className="tag-purple shrink-0">
          {skill.scan_label}
        </Badge>
      )}

      {skill.parent_collection && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className="gap-1 border-transparent bg-muted text-muted-foreground shrink-0"
            >
              <Folder className="h-3 w-3" />
              {collectionDisplayName(skill.parent_collection)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs break-all">
            合集：{skill.parent_collection}
          </TooltipContent>
        </Tooltip>
      )}

      {skill.has_translation && !isDeleted && (
        <Languages aria-label="已翻译" className="h-3.5 w-3.5 shrink-0 text-green-500" />
      )}

      {isDeleted && (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
    </button>
  );
}
