import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { ValidationReport } from "@/lib/api";
import {
  CREATION_STAGE_LABELS,
  type CreationProgress,
  type SkillCreationState,
} from "@/lib/creation-state";

interface SkillStateSummaryProps {
  state: SkillCreationState;
  progress: CreationProgress;
  validation: ValidationReport | null;
}

function StatusIcon({ complete, warning }: { complete: boolean; warning?: boolean }) {
  if (warning) return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (complete) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  return <CircleDashed className="h-3.5 w-3.5 text-text-tertiary" />;
}

/** Read-only artifact health summary; it never blocks the free-form editor. */
export function SkillStateSummary({
  state,
  progress,
  validation,
}: SkillStateSummaryProps) {
  const validationErrors = validation?.issues.filter((i) => i.severity === "error").length ?? 0;
  const validationWarnings = validation?.issues.filter((i) => i.severity === "warn").length ?? 0;
  const evalReady = state.evaluation.cases.length > 0 && state.evaluation.completed;
  const artifactReady = state.identity.name.trim().length > 0 &&
    state.identity.description.trim().length > 0 &&
    state.artifact.body.trim().length > 0;

  return (
    <section className="shrink-0 rounded-md border border-border/40 bg-glass-1 px-3 py-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-semibold text-text-primary">Skill 状态</span>
        <span className="font-mono text-text-tertiary">
          {progress.completed}/{progress.total} 阶段完成
        </span>
        <span className="ml-auto text-text-tertiary">
          {Math.round(progress.ratio * 100)}%
        </span>
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["discover", "需求", progress.stages.discover.complete, false],
          ["scope", "边界", progress.stages.scope.complete, false],
          ["model", "模型", progress.stages.model.complete, false],
          ["design", "设计", progress.stages.design.complete, false],
          ["generate", "产物", progress.stages.generate.complete, !artifactReady],
          ["evaluate", "评测", evalReady, state.evaluation.cases.length > 0 && !evalReady],
          ["package", "发布", progress.stages.package.complete, false],
        ] as const).map(([stage, label, complete, warning]) => (
          <div key={stage} className="flex min-w-0 items-center gap-1.5 text-text-secondary">
            <StatusIcon complete={complete} warning={warning} />
            <span>{label}</span>
            <span className="truncate text-text-tertiary">
              {CREATION_STAGE_LABELS[stage as keyof typeof CREATION_STAGE_LABELS]}
            </span>
          </div>
        ))}
      </div>
      {validation && (
        <div className="mt-2 border-t border-border/30 pt-1.5 text-[10.5px] text-text-tertiary">
          规范诊断：{validationErrors ? `${validationErrors} 个错误` : "无错误"}
          {validationWarnings ? `，${validationWarnings} 个提醒` : ""}
          {validationErrors === 0 && validationWarnings === 0 ? "，当前通过" : ""}
        </div>
      )}
    </section>
  );
}
