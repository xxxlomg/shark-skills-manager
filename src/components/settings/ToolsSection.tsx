/**
 * 设置 → 工具分区（从 SettingsDialog 拆出）。
 * 工具列表（启用/禁用/删除）+ 导入工具包（选目录自动探测 skills）+ 下载/导入路径。
 * 状态与 handler 由父级 SettingsDialog 持有，本组件纯展示。
 */
import {
  AlertTriangle,
  Check,
  FolderOpen,
  Link2,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/common/Tip";
import { toolDisplayName } from "@/hooks/useSkills";
import { isMockMode } from "@/mock";
import type { ToolDirProbe, ToolInfo } from "@/lib/api";

interface ToolsSectionProps {
  tools: ToolInfo[];
  loaded: boolean;
  onToggle: (tool: ToolInfo) => void;
  onRemove: (tool: ToolInfo) => void;
  // 导入工具包（三态：探测中 / 有效 / 无效）
  probe: ToolDirProbe | null;
  probeError: string;
  probeBusy: boolean;
  importName: string;
  onImportNameChange: (value: string) => void;
  importing: boolean;
  mockDir: string;
  onMockDirChange: (value: string) => void;
  onPickDir: () => void;
  onMockDetect: () => void;
  onImport: () => void;
  // 下载/导入路径（P5）
  downloadDir: string;
  onDownloadDirChange: (value: string) => void;
  downloadDirSaving: boolean;
  onPickDownloadDir: () => void;
  onSaveDownloadDir: () => void;
  onResetDownloadDir: () => void;
}

export function ToolsSection({
  tools,
  loaded,
  onToggle,
  onRemove,
  probe,
  probeError,
  probeBusy,
  importName,
  onImportNameChange,
  importing,
  mockDir,
  onMockDirChange,
  onPickDir,
  onMockDetect,
  onImport,
  downloadDir,
  onDownloadDirChange,
  downloadDirSaving,
  onPickDownloadDir,
  onSaveDownloadDir,
  onResetDownloadDir,
}: ToolsSectionProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        工具即扫描来源，也是 Hub
        引用落点。内置工具只能启用/禁用；自定义工具可增删。改动即时保存。
      </p>

      {/* 工具列表 */}
      <div className="space-y-2">
        {tools.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">暂无工具</p>
        )}
        {tools.map((t) => {
          const existsAny = t.path_exists.some(Boolean);
          const badge = t.app_owned
            ? "应用自有"
            : t.builtin
              ? "内置"
              : "自定义";
          return (
            <div
              key={t.id}
              className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${
                !t.app_owned && !existsAny
                  ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"
                  : "border-border"
              }`}
            >
              <Tip label={t.enabled ? "点击禁用" : "点击启用"}>
                <button
                  type="button"
                  onClick={() => onToggle(t)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {t.enabled ? (
                    <ToggleRight className="h-[26px] w-[26px] text-green-500" />
                  ) : (
                    <ToggleLeft className="h-[26px] w-[26px]" />
                  )}
                </button>
              </Tip>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{toolDisplayName(t.name)}</span>
                  <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] text-muted-foreground">
                    {badge}
                  </span>
                  {t.link_count > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[10px] text-brand">
                      <Link2 className="h-2.5 w-2.5" />
                      {t.link_count} 条引用
                    </span>
                  )}
                </p>
                {t.app_owned ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    路径由应用管理（
                    {t.id === "builtin" ? "内置技能" : "导入安装的技能"}）
                  </p>
                ) : (
                  <div className="mt-0.5 space-y-px">
                    {t.paths.map((p, i) => (
                      <p
                        key={i}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                            t.path_exists[i] ? "bg-green-500" : "bg-stroke-hi"
                          }`}
                        />
                        <span className="truncate">{p}</span>
                      </p>
                    ))}
                  </div>
                )}
                {!t.app_owned && !existsAny && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    候选目录均不存在（引用时将自动创建首个候选）
                  </p>
                )}
              </div>
              {!t.builtin && !t.app_owned && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => onRemove(t)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* 导入工具包（文件选择器交互）：选目录 → 自动探测 skills → 有效才可导入 */}
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">
          导入工具包（可作为 Hub 引用落点）
        </p>
        <p className="text-[11px] text-text-tertiary">
          选择包含 skills
          子文件夹的文件夹，应用将自动识别为有效工具包并登记为自定义工具。
        </p>

        {isMockMode() ? (
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="输入工具包路径，如 D:\vault\my-tool\skills"
              value={mockDir}
              onChange={(e) => onMockDirChange(e.target.value)}
              className="text-xs"
              disabled={probeBusy || importing}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onMockDetect}
              className="shrink-0 text-xs"
              disabled={probeBusy || importing || !mockDir.trim()}
            >
              检测
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onPickDir}
            className="w-full text-xs"
            disabled={!loaded || probeBusy || importing}
          >
            <FolderOpen className="mr-1 h-3 w-3" />
            {probeBusy ? "检测中…" : "选择工具包文件夹…"}
          </Button>
        )}

        {/* 探测失败（invoke 异常） */}
        {!probeBusy && probeError && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50/50 p-2.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{probeError}</span>
          </p>
        )}

        {/* 目录无效：不满足工具包要求 */}
        {!probeBusy && probe && !probe.has_skills && (
          <div className="space-y-1 rounded-lg border border-red-300 bg-red-50/50 p-2.5 dark:border-red-900 dark:bg-red-950/20">
            <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {probe.base_exists
                  ? "该目录不符合工具包要求：未找到 skills 子文件夹"
                  : "该目录不存在，无法识别为工具包"}
              </span>
            </p>
            <p className="pl-5 text-[11px] text-red-500/80 dark:text-red-400/80">
              若选中的是 skills 目录本身，请选择其父文件夹重试。
            </p>
          </div>
        )}

        {/* 目录有效：识别为工具包，可一键导入 */}
        {!probeBusy && probe?.has_skills && (
          <div className="space-y-2 rounded-lg border border-green-500/40 bg-green-50/50 p-2.5 dark:border-green-900 dark:bg-green-950/20">
            <p className="flex items-start gap-1.5 text-xs text-green-700 dark:text-green-400">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-all">
                已识别为有效工具包，skills 目录：
                <span className="font-mono">{probe.skills_path}</span>
              </span>
            </p>
            <Input
              type="text"
              placeholder="工具名称"
              value={importName}
              onChange={(e) => onImportNameChange(e.target.value)}
              className="text-xs"
              disabled={importing}
            />
            <Button
              size="sm"
              onClick={onImport}
              className="text-xs"
              disabled={importing || !importName.trim()}
            >
              <Plus className="mr-1 h-3 w-3" />
              {importing ? "导入中…" : "导入工具"}
            </Button>
          </div>
        )}
      </div>

      {/* P5 下载/导入路径 */}
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">下载/导入路径</p>
        <p className="text-[11px] text-text-tertiary">
          URL 下载、Pack 安装、zip/目录导入的技能存放目录。留空使用默认。
        </p>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="D:\skills-downloads （留空 = 默认）"
            value={downloadDir}
            onChange={(e) => onDownloadDirChange(e.target.value)}
            className="text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPickDownloadDir}
            className="shrink-0"
          >
            选择…
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onSaveDownloadDir}
            disabled={downloadDirSaving || !loaded}
          >
            {downloadDirSaving ? "保存中…" : "保存路径"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetDownloadDir}
            disabled={downloadDirSaving || !loaded}
            className="text-text-tertiary"
          >
            恢复默认
          </Button>
        </div>
      </div>
    </>
  );
}