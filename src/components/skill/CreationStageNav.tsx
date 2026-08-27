import { Check, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CREATION_STAGE_LABELS,
  CREATION_STAGE_ORDER,
  type CreationProgress,
  type CreationStage,
} from "@/lib/creation-state";

interface CreationStageNavProps {
  progress: CreationProgress;
  activeStage: CreationStage;
  onChange: (stage: CreationStage) => void;
}

/** Compact, non-blocking navigation for the seven-stage Creator workflow. */
export function CreationStageNav({
  progress,
  activeStage,
  onChange,
}: CreationStageNavProps) {
  return (
    <nav
      aria-label="Skill 创作阶段"
      className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto rounded-md border border-border/40 bg-glass-1 px-2 py-1"
    >
      {CREATION_STAGE_ORDER.map((stage, index) => {
        const item = progress.stages[stage];
        const active = stage === activeStage;
        return (
          <div key={stage} className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={active ? "secondary" : "ghost"}
              className="h-7 gap-1.5 px-2 text-[11px]"
              aria-current={active ? "step" : undefined}
              onClick={() => onChange(stage)}
              title={`${CREATION_STAGE_LABELS[stage]}：${item.completed}/${item.total}`}
            >
              {item.complete ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Circle className="h-3 w-3 text-text-tertiary" />
              )}
              <span>{CREATION_STAGE_LABELS[stage]}</span>
              <span className="font-mono text-[10px] text-text-tertiary">
                {item.completed}/{item.total}
              </span>
            </Button>
            {index < CREATION_STAGE_ORDER.length - 1 && (
              <span className="text-[10px] text-text-tertiary">/</span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
