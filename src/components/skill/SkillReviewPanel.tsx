import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Info,
  Lightbulb,
  Loader2,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SkillReviewResult, ReviewIssue } from "@/lib/authoring-api";

/**
 * 智能审查结果面板（shark-skill-creator 规范，全自动化）。
 * 只负责「有结果 / 出错」两种态：总分、各维度评分、问题列表（含改进建议）、优点、总结，
 * 以及一键修复入口。空态与进行中由 SkillReviewBrief（须知卡）统一承载，不在此重复。
 */

export interface ReviewReportMeta {
  skillName: string;
  reviewedAt: string;
  issueCount: number;
  fixedAt?: string;
}

interface SkillReviewPanelProps {
  review: SkillReviewResult | null;
  error?: string | null;
  /** 报告元数据（持久化后回显） */
  reportMeta?: ReviewReportMeta | null;
  onRetry?: () => void;
  onFix?: () => void;
  fixing?: boolean;
}

const DIMENSION_LABELS: Record<string, string> = {
  trigger_accuracy: "触发精准度",
  scope_clarity: "范围清晰度",
  workflow_compliance: "流程符合度",
  knowledge_coverage: "知识覆盖率",
  structure_quality: "结构质量",
  guardrails: "护栏规则",
  examples: "使用示例",
  evaluation_readiness: "可评测性",
};

const SEVERITY_META: Record<
  ReviewIssue["severity"],
  { label: string; icon: typeof XCircle; className: string }
> = {
  error: { label: "严重", icon: XCircle, className: "text-red-500 border-red-500/40 bg-red-500/5" },
  warn: { label: "建议", icon: AlertTriangle, className: "text-amber-500 border-amber-500/40 bg-amber-500/5" },
  info: { label: "提示", icon: Info, className: "text-blue-500 border-blue-500/40 bg-blue-500/5" },
};

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-500";
  if (score >= 70) return "text-green-500";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number): string {
  if (score >= 90) return "bg-emerald-500";
  if (score >= 70) return "bg-green-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

export function SkillReviewPanel({
  review,
  error,
  reportMeta,
  onRetry,
  onFix,
  fixing,
}: SkillReviewPanelProps) {
  if (error) {
    return (
      <div className="grid min-h-48 place-items-center gap-3 text-center">
        <XCircle className="h-6 w-6 text-red-400" />
        <p className="text-sm text-text-secondary">{error}</p>
        {onRetry && (
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            重试
          </Button>
        )}
      </div>
    );
  }

  // 无报告空态由 SkillReviewBrief（审查须知卡）承载，包含唯一「开始审查」入口；
  // 进行中同理，所以本组件只处理结果与错误。
  if (!review) return null;

  const hasIssues = review.issues.length > 0;

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* 报告元数据 */}
      {reportMeta && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/30 bg-glass-1 px-3 py-1.5 text-[10px] text-text-tertiary">
          <span>技能：{reportMeta.skillName}</span>
          <span>·</span>
          <span>审查时间：{fmtTime(reportMeta.reviewedAt)}</span>
          <span>·</span>
          <span>{reportMeta.issueCount} 个问题</span>
          {reportMeta.fixedAt && (
            <>
              <span>·</span>
              <span className="text-emerald-500">已修复 {fmtTime(reportMeta.fixedAt)}</span>
            </>
          )}
        </div>
      )}

      {/* 总分 + 总结 */}
      <div className="flex items-start gap-4 rounded-md border border-border/40 bg-glass-1 p-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className={cn("text-3xl font-bold tabular-nums", scoreColor(review.overall_score))}>
            {review.overall_score}
          </span>
          <span className="text-[10px] text-text-tertiary">综合评分</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-text-primary">{review.summary}</p>
          {review.strengths.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {review.strengths.map((s, i) => (
                <Badge key={i} variant="outline" className="border-emerald-500/30 text-[10px] text-emerald-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {s}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 一键修复入口 */}
      {hasIssues && onFix && (
        <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
          <Wrench className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-text-primary">
              发现 {review.issues.length} 个可修复问题
            </p>
            <p className="text-[11px] text-text-tertiary">
              系统将按 shark-skill-creator 规范自动修正正文结构、补充缺失章节
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={fixing}
            onClick={onFix}
            className="shrink-0 gap-1.5"
          >
            {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
            {fixing ? "修复中…" : "一键修复"}
          </Button>
        </div>
      )}

      {/* 维度评分 */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <CircleHelp className="h-3.5 w-3.5 text-primary" />
          维度评分
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {review.dimensions.map((dim) => (
            <div
              key={dim.id}
              className="flex items-center gap-3 rounded-md border border-border/30 bg-glass-1 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-text-secondary">
                    {DIMENSION_LABELS[dim.id] ?? dim.id}
                  </span>
                  <span className={cn("shrink-0 font-mono text-[11px] font-semibold", scoreColor(dim.score))}>
                    {dim.score}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-glass-2">
                  <div
                    className={cn("h-full rounded-full transition-[width]", scoreBg(dim.score))}
                    style={{ width: `${dim.score}%` }}
                  />
                </div>
                <p className="mt-1 truncate text-[10px] text-text-tertiary">{dim.comment}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 问题与改进建议 */}
      {hasIssues && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            问题与改进建议（{review.issues.length}）
          </h3>
          <div className="flex flex-col gap-2">
            {review.issues.map((issue, i) => {
              const meta = SEVERITY_META[issue.severity] ?? SEVERITY_META.info;
              const Icon = meta.icon;
              return (
                <div
                  key={i}
                  className={cn("rounded-md border p-3", meta.className)}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium">{meta.label}</span>
                        <span className="rounded-full bg-glass-2 px-1.5 py-0.5 text-[9px] text-text-tertiary">
                          {DIMENSION_LABELS[issue.category] ?? issue.category}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-text-primary">
                        {issue.message}
                      </p>
                      <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-text-secondary">
                        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                        <span>{issue.suggestion}</span>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 无问题时的正面反馈 */}
      {!hasIssues && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <p className="text-[12px] text-text-secondary">
            未发现明显问题，该技能质量优秀！
          </p>
        </div>
      )}
    </div>
  );
}
