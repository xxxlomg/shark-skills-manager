import { Download, Package, Plus, Box, Pencil, Trash2, Store, UploadCloud, ChevronDown } from "lucide-react";
import { PackCard, type PackAction } from "./PackCard";
import { LayoutToggle } from "./LayoutToggle";
import { Tip } from "@/components/common/Tip";
import type { PackInfo } from "@/lib/api";
import type { LayoutMode } from "@/hooks/useSkills";
import { GhostCard } from "@/components/common/GhostCard";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { SectionHead } from "@/components/common/SectionHead";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PacksViewProps {
  packs: PackInfo[];
  onCreatePack: () => void;
  onImportPack: () => void;
  onRepoImport: () => void;
  onPackAction: (action: PackAction, pack: PackInfo) => void;
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  /** 发布动作禁用原因（未配置仓库/无 git）；为空表示可用 */
  publishDisabledReason?: string;
  /** 正在发布中的 pack id */
  publishingId?: string | null;
}

/** Skill Packs 视图：卡片网格 / 列表行 双布局 + 导入 ghost 卡（PLAN-05 P1 真实数据）。 */
export function PacksView({
  packs,
  onCreatePack,
  onImportPack,
  onRepoImport,
  onPackAction,
  layout,
  onLayoutChange,
  publishDisabledReason,
  publishingId,
}: PacksViewProps) {
  let idx = 0;

  const repoGhost = (
    <GhostCard
      icon={<Store className="h-[22px] w-[22px]" />}
      title="从技能仓库导入"
      subtitle=".skillpack 货架（Git 仓库）"
      index={idx++}
      onClick={onRepoImport}
    />
  );

  const importGhost = (
    <GhostCard
      icon={<Download className="h-[22px] w-[22px]" />}
      title="导入 .skillpack"
      subtitle="拖入或选择打包文件"
      index={idx++}
      onClick={onImportPack}
    />
  );

  return (
    <div className="relative py-6">
      <SectionHead
        title="Skill Packs"
        subtitle="自由组合技能、封装成包，一键分享与安装"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mbtn inline-flex shrink-0 items-center gap-1.5" title="导入 Pack">
              <Download className="h-3.5 w-3.5" />
              导入
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8}>
            <DropdownMenuItem onSelect={onImportPack}>
              <Download className="h-3.5 w-3.5" />
              导入 .skillpack
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRepoImport}>
              <Store className="h-3.5 w-3.5" />
              从技能仓库导入
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className="mbtn primary" onClick={onCreatePack}>
          <Plus className="h-3.5 w-3.5" />
          新建 Pack
        </button>
        {/* 布局切换固定最右，远离主操作按钮防误触 */}
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {packs.length === 0 ? (
        <EmptyPanel
          icon={<Package className="h-7 w-7" />}
          title="还没有 Skill Pack"
          description="把常用技能组合打包，一键分享给团队，或导入别人做好的包。"
          actions={[importGhost, repoGhost]}
        />
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              index={idx++}
              onAction={onPackAction}
              publishDisabledReason={publishDisabledReason}
              publishing={publishingId === p.id}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {packs.map((p) => (
            <div
              key={p.id}
              className="glass-card flex flex-wrap items-center gap-x-4 gap-y-2 px-[18px] py-[14px]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-stroke bg-glass-2 text-amber">
                  <Package className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-display text-[14.5px] font-semibold text-text-primary">
                      {p.name}
                    </span>
                    <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-2 py-[2px] font-mono text-[10.5px] text-brand">
                      v{p.ver}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-text-tertiary">
                    by {p.author || "未知"} · {p.skill_count} 个技能 · {p.translated} 已翻译
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Tip label="修改名称">
                  <button
                    type="button"
                    className="mbtn"
                    onClick={() => onPackAction("rename", p)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </Tip>
                <button
                  type="button"
                  className="mbtn primary"
                  onClick={() => onPackAction("install", p)}
                >
                  <Download className="h-3.5 w-3.5" />
                  安装
                </button>
                <button
                  type="button"
                  className="mbtn"
                  onClick={() => onPackAction("export", p)}
                >
                  <Box className="h-3.5 w-3.5" />
                  导出
                </button>
                <Tip label={publishDisabledReason || "发布到技能仓库"}>
                  <button
                    type="button"
                    className="mbtn"
                    disabled={!!publishDisabledReason || publishingId === p.id}
                    style={
                      publishDisabledReason || publishingId === p.id
                        ? { opacity: 0.45, cursor: "not-allowed" }
                        : undefined
                    }
                    onClick={() => onPackAction("publish", p)}
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                  </button>
                </Tip>
                <Tip label="删除 Pack">
                  <button
                    type="button"
                    className="mbtn"
                    onClick={() => onPackAction("delete", p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
