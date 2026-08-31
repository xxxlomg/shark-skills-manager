import {
  Braces,
  FolderCheck,
  Gauge,
  Layers,
  LayoutTemplate,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 智能审查「须知卡」（检查 Skill tab 的门面）。
 *
 * 设计取向：瑞士风强网格 + 单一强调色，用图形层级替代大段文字——
 * ① 一句话目的 ② 六个检查要点（图标网格，发丝线分隔）
 * ③ 评分口径（0-100 分段色带 + 四档动作，色值与 SkillReviewPanel 的 scoreColor 阈值一致）
 * ④ 底部动作区（唯一「开始审查」入口；进行中原地变为进度 + 取消，避免布局跳动）。
 */

const CHECKS = [
  { icon: LayoutTemplate, title: "结构合规", desc: "frontmatter 与正文章节齐备" },
  { icon: Braces, title: "元数据", desc: "说清做什么 + 何时触发" },
  { icon: FolderCheck, title: "引用有效", desc: "正文引用与文件树对得上" },
  { icon: ShieldAlert, title: "护栏", desc: "必须 / 禁止 / 不确定策略" },
  { icon: Layers, title: "知识分层", desc: "深层知识外置，正文精简" },
  { icon: Gauge, title: "可评测", desc: "输入输出与验收标准明确" },
] as const;

/** 分数四档：span 为色带宽度权重（与 0-100 区间等比），阈值对齐 scoreColor()。 */
const BANDS = [
  { span: 50, range: "0–49", action: "回正文补关键章节", bar: "bg-red-500/70", dot: "bg-red-500" },
  { span: 20, range: "50–69", action: "按清单「一键修复」", bar: "bg-amber-500/70", dot: "bg-amber-500" },
  { span: 20, range: "70–89", action: "良好，可直接使用", bar: "bg-green-500/70", dot: "bg-green-500" },
  { span: 10, range: "90+", action: "优秀，可发布", bar: "bg-emerald-500/70", dot: "bg-emerald-500" },
] as const;

interface SkillReviewBriefProps {
  /** 正文为空：审查仍能跑，但先给一条更省事的替代路径 */
  bodyEmpty: boolean;
  /** 审查进行中：底部动作区原地变为进度 + 取消 */
  running?: boolean;
  onRun: () => void;
  onCancel?: () => void;
}

export function SkillReviewBrief({
  bodyEmpty,
  running,
  onRun,
  onCancel,
}: SkillReviewBriefProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-stroke bg-glass">
      {/* ① 目的 */}
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/[0.08]">
          <ShieldCheck className="h-4 w-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-semibold text-text-primary">技能体检</h4>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-secondary">
            按 shark-skill-creator 规范打分，把技能从「能看」推到「能稳定触发、可执行、可评测」。
          </p>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          <span className="font-mono text-[10px] text-text-tertiary">8 维度评分</span>
          <span className="font-mono text-[10px] text-text-tertiary">报告随技能留存</span>
        </div>
      </div>

      {/* ② 检查要点：发丝线网格（gap-px + bg-stroke 造 1px 分隔线） */}
      <div className="grid gap-px border-y border-stroke bg-stroke sm:grid-cols-2 lg:grid-cols-3">
        {CHECKS.map((c) => (
          <div key={c.title} className="flex items-start gap-2.5 bg-glass px-4 py-3">
            <c.icon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-[11.5px] font-medium text-text-primary">{c.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-text-tertiary">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ③ 评分口径：分段色带 + 四档动作 */}
      <div className="px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium text-text-secondary">评分口径</p>
          <p className="font-mono text-[10px] text-text-tertiary">综合评分 0 → 100</p>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full">
          {BANDS.map((b) => (
            <span
              key={b.range}
              className={cn("h-full", b.bar)}
              style={{ flexGrow: b.span, flexBasis: 0 }}
              aria-hidden
            />
          ))}
        </div>
        <div className="mt-2.5 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {BANDS.map((b) => (
            <div key={b.range} className="flex items-start gap-1.5">
              <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-[3px]", b.dot)} />
              <div className="min-w-0">
                <p className="font-mono text-[10.5px] font-semibold text-text-primary">{b.range}</p>
                <p className="text-[10.5px] leading-tight text-text-tertiary">{b.action}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ④ 底部动作区：唯一入口；进行中不换卡片，原地变进度 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-stroke bg-bg-1/70 px-4 py-3">
        {running ? (
          <>
            <span className="flex items-center gap-2 text-[11.5px] text-text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              正在按规范体检，8 个维度逐项评分…
            </span>
            <span className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1.5 border-red-400/60 text-red-500 hover:!bg-red-500/10 hover:!text-red-500"
              onClick={onCancel}
            >
              <StopCircle className="h-3.5 w-3.5" />
              取消审查
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={onRun}
            >
              <Sparkles className="h-3.5 w-3.5" />
              开始审查
            </Button>
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-tertiary">
              {bodyEmpty
                ? "正文还是空的：可以先审一次拿到问题清单，或回创作引导生成初稿再审。"
                : "审查按当前草稿与对话上下文进行，结果可作为发布前的质量基线。"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
