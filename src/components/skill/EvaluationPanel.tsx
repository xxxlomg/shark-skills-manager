import {
  CheckCircle2,
  CircleDot,
  Clock3,
  Plus,
  SkipForward,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  EvaluationCase,
  EvaluationResult,
  SkillEvaluation,
} from "@/lib/creation-state";

export interface EvaluationPanelProps {
  /** Controlled evaluation state from SkillCreationState.evaluation. */
  evaluation: SkillEvaluation;
  /** Receives the complete evaluation value after every user edit. */
  onChange: (evaluation: SkillEvaluation) => void;
  className?: string;
}

const RESULT_OPTIONS: Array<{
  value: EvaluationResult;
  label: string;
  icon: typeof Clock3;
}> = [
  { value: "pending", label: "待评估", icon: Clock3 },
  { value: "pass", label: "通过", icon: CheckCircle2 },
  { value: "fail", label: "失败", icon: XCircle },
  { value: "skipped", label: "跳过", icon: SkipForward },
];

const RESULT_META: Record<
  EvaluationResult,
  { label: string; className: string }
> = {
  pending: { label: "待评估", className: "border-amber-500/40 text-amber-600" },
  pass: { label: "通过", className: "border-emerald-500/40 text-emerald-600" },
  fail: { label: "失败", className: "border-red-500/40 text-red-600" },
  skipped: { label: "跳过", className: "border-slate-400/40 text-slate-500" },
};

let fallbackId = 0;

function createCaseId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return randomUuid.call(globalThis.crypto);
  fallbackId += 1;
  return `evaluation-${Date.now()}-${fallbackId}`;
}

function createCase(): EvaluationCase {
  return {
    id: createCaseId(),
    name: "新评估案例",
    kind: "custom",
    input: "",
    expectedBehavior: "",
    actualOutput: "",
    result: "pending",
    notes: "",
  };
}

function summarize(cases: EvaluationCase[]) {
  const total = cases.length;
  const resolved = cases.filter((item) => item.result !== "pending").length;
  const passed = cases.filter((item) => item.result === "pass").length;
  return {
    total,
    resolved,
    passed,
    percentage: total === 0 ? 0 : Math.round((resolved / total) * 100),
    completed: total > 0 && resolved === total,
    score: resolved === 0 ? null : passed / resolved,
  };
}

function updateEvaluation(
  evaluation: SkillEvaluation,
  cases: EvaluationCase[],
): SkillEvaluation {
  const summary = summarize(cases);
  return {
    ...evaluation,
    cases,
    completed: summary.completed,
    score: summary.score,
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-secondary">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-2 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
      />
    </label>
  );
}

export function EvaluationPanel({
  evaluation,
  onChange,
  className,
}: EvaluationPanelProps) {
  const summary = summarize(evaluation.cases);

  const addCase = () => {
    onChange(updateEvaluation(evaluation, [...evaluation.cases, createCase()]));
  };

  const updateCase = (id: string, patch: Partial<EvaluationCase>) => {
    const cases = evaluation.cases.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    onChange(updateEvaluation(evaluation, cases));
  };

  const removeCase = (id: string) => {
    onChange(updateEvaluation(evaluation, evaluation.cases.filter((item) => item.id !== id)));
  };

  return (
    <section
      className={cn("flex min-h-0 flex-col gap-3", className)}
      aria-label="人工评估"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-text-primary">人工评估</h2>
          <Badge variant="outline" className="font-mono text-[10px]">
            {summary.resolved}/{summary.total} 已完成
          </Badge>
        </div>
        <div className="flex-1" />
        <Button type="button" size="sm" variant="secondary" onClick={addCase}>
          <Plus className="h-3.5 w-3.5" />
          新增案例
        </Button>
      </header>

      <div className="flex shrink-0 items-center gap-3 rounded-md border border-border/40 bg-glass-1 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
            <span>评估完成度</span>
            <span className="font-mono text-text-primary">
              {summary.percentage}%
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-glass-2"
            role="progressbar"
            aria-label="评估完成度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percentage}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${summary.percentage}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-text-tertiary">
          {summary.passed} 个通过
        </span>
      </div>

      {evaluation.cases.length === 0 ? (
        <div className="grid min-h-36 place-items-center rounded-md border border-dashed border-border/50 px-4 text-center text-xs text-text-tertiary">
          还没有评估案例。添加一个案例后，手动记录预期与实际结果。
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {evaluation.cases.map((item, index) => {
            const resultMeta = RESULT_META[item.result];
            return (
              <article
                key={item.id}
                className="flex shrink-0 flex-col gap-3 rounded-md border border-border/50 bg-glass-1 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-text-tertiary">
                    CASE {String(index + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={item.name}
                    onChange={(event) => updateCase(item.id, { name: event.target.value })}
                    aria-label={`案例 ${index + 1} 名称`}
                    className="h-8 min-w-40 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm font-medium text-text-primary outline-none placeholder:text-text-tertiary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                    placeholder="案例名称"
                  />
                  <Badge variant="outline" className={cn("text-[10px]", resultMeta.className)}>
                    {resultMeta.label}
                  </Badge>
                  <Select
                    value={item.result}
                    onValueChange={(value) =>
                      updateCase(item.id, { result: value as EvaluationResult })
                    }
                  >
                    <SelectTrigger size="sm" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESULT_OPTIONS.map(({ value, label, icon: Icon }) => (
                        <SelectItem key={value} value={value}>
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 p-0 text-text-tertiary hover:text-destructive"
                    aria-label={`删除案例 ${index + 1}`}
                    title="删除案例"
                    onClick={() => removeCase(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="输入"
                    value={item.input}
                    onChange={(value) => updateCase(item.id, { input: value })}
                    placeholder="输入一个代表性用户请求或场景"
                  />
                  <Field
                    label="预期行为"
                    value={item.expectedBehavior}
                    onChange={(value) => updateCase(item.id, { expectedBehavior: value })}
                    placeholder="描述 Skill 应该如何响应"
                  />
                  <Field
                    label="实际输出"
                    value={item.actualOutput}
                    onChange={(value) => updateCase(item.id, { actualOutput: value })}
                    placeholder="人工运行或模拟后粘贴实际结果"
                  />
                  <Field
                    label="备注"
                    value={item.notes}
                    onChange={(value) => updateCase(item.id, { notes: value })}
                    placeholder="记录差异、缺口或后续修改建议"
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
