import type { CSSProperties } from "react";
import { Box, Download, MoreVertical, Package, Pencil, Trash2, UploadCloud } from "lucide-react";
import type { PackInfo } from "@/lib/api";
import { Tip } from "@/components/common/Tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type PackAction = "install" | "export" | "publish" | "rename" | "delete";

interface PackCardProps {
  pack: PackInfo;
  index: number;
  onAction: (action: PackAction, pack: PackInfo) => void;
  /** 发布动作的禁用原因（未配置仓库/无 git 等）；为空表示可用 */
  publishDisabledReason?: string;
  /** 发布进行中 */
  publishing?: boolean;
}

/** hover 微抬升+提亮+辉光；active 收缩+回落，给出明确按压反馈 */
const pressable =
  "transition-all duration-200";
const ghostBtn =
  "inline-flex items-center gap-[6px] rounded-md border border-stroke bg-glass px-[13px] py-[7px] text-[12.5px] font-medium text-text-secondary hover:border-stroke-hi hover:bg-glass-2 hover:text-text-primary " +
  pressable;
const primaryBtn =
  "inline-flex items-center gap-[6px] rounded-full border border-transparent bg-brand px-[13px] py-[7px] text-[12.5px] font-medium text-white " +
  pressable;

/** 技能名 tag 上限：超出折叠为 +N */
const MAX_TAGS = 3;

/** Skill Pack 卡片：版本徽章、技能名标签、概述与操作按钮（PLAN-05 P1）。 */
export function PackCard({ pack, index, onAction, publishDisabledReason, publishing }: PackCardProps) {
  const shown = pack.skill_names.slice(0, MAX_TAGS);
  const rest = pack.skill_names.length - shown.length;

  return (
    <div className="card-wrap" style={{ "--i": index } as CSSProperties}>
      <div className="glass-card card-deco card-glow relative flex h-full flex-col overflow-hidden p-5">
        <div className="relative z-[1] flex items-start justify-between">
          <span className="grid h-[46px] w-[46px] place-items-center rounded-[13px] border border-stroke bg-glass-2 text-amber">
            <Package className="h-[22px] w-[22px]" />
          </span>
          <div className="flex items-center gap-1">
            {/* 右上角操作菜单：修改名称 / 删除（网格布局） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Pack 操作"
                  className="iconbtn h-7 w-7 rounded-md"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[132px]">
                <DropdownMenuItem onSelect={() => onAction("rename", pack)}>
                  <Pencil />
                  修改名称
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete", pack)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <h3 className="relative z-[1] mt-4 truncate font-display text-[19px] font-semibold text-text-primary">
          {pack.name}
        </h3>
        <p className="relative z-[1] mt-[3px] truncate text-[12.5px] text-text-secondary">
          by {pack.author || "未知"} · <span className="font-mono text-brand">v{pack.ver}</span> · {pack.skill_count} 个技能 · {pack.translated} 已翻译
        </p>

        {shown.length > 0 && (
          <div className="relative z-[1] mt-[14px] flex flex-wrap items-center gap-[6px]">
            {shown.map((n, k) => (
              <Tip key={k} label={n}>
                <span className="max-w-[120px] truncate rounded-[8px] border border-stroke bg-glass-2 px-[8px] py-[3px] text-[11px] text-text-secondary">
                  {n}
                </span>
              </Tip>
            ))}
            {rest > 0 && (
              <Tip label={pack.skill_names.slice(MAX_TAGS).join("、")}>
                <span className="rounded-[8px] border border-stroke bg-glass-2 px-[8px] py-[3px] text-[11px] text-text-secondary">
                  +{rest}
                </span>
              </Tip>
            )}
          </div>
        )}

        <p className="relative z-[1] mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-text-secondary">
          {pack.overview}
        </p>

        <div className="relative z-[1] mt-4 flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} onClick={() => onAction("install", pack)}>
            <Download className="h-3.5 w-3.5" />
            安装
          </button>
          <button type="button" className={ghostBtn} onClick={() => onAction("export", pack)}>
            <Box className="h-3.5 w-3.5" />
            导出
          </button>
          <Tip label={publishDisabledReason || "发布到技能仓库"}>
            <button
              type="button"
              className={ghostBtn}
              disabled={!!publishDisabledReason || publishing}
              onClick={() => onAction("publish", pack)}
              style={
                publishDisabledReason || publishing
                  ? { opacity: 0.45, cursor: "not-allowed" }
                  : undefined
              }
            >
              <UploadCloud className="h-3.5 w-3.5" />
              {publishing ? "发布中…" : "发布"}
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
