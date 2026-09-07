import { useMemo } from "react";
import { Archive, ChevronDown, FolderPlus, GitBranch, LayoutGrid, ListTree, ScanSearch, Upload } from "lucide-react";
import { FolderCard } from "./FolderCard";
import { LayoutToggle } from "./LayoutToggle";
import { GhostCard } from "@/components/common/GhostCard";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { SectionHead } from "@/components/common/SectionHead";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Skill, SkillGroup, LayoutMode } from "@/hooks/useSkills";

interface HomeViewProps {
  groups: SkillGroup[];
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onFolderClick: (label: string) => void;
  onSkillClick: (skill: Skill) => void;
  onGitImport: () => void;
  onZipImport: () => void;
  /** 技能库页头「新建文件夹」入口（顶栏布局的主入口） */
  onNewFolder?: () => void;
  /** M 阶段 2：打开查重面板 */
  onDupCheck?: () => void;
  /** 进入「全部技能」扁平视图 */
  onAllSkills?: () => void;
  /** 打开「层级结构」树视图：校验扫描映射与磁盘结构 */
  onScanTree?: () => void;
  /** 本会话新建的空工具根（0 技能），补一张空卡片 */
  extraFolderLabels?: string[];
}

export function HomeView({
  groups,
  layout,
  onLayoutChange,
  onFolderClick,
  onSkillClick,
  onGitImport,
  onZipImport,
  onNewFolder,
  onDupCheck,
  onAllSkills,
  onScanTree,
  extraFolderLabels,
}: HomeViewProps) {
  const totalSkills = groups.reduce((sum, g) => sum + g.skills.length, 0);

  // 新建但尚无技能的工具根（不在 groups 里），补空卡片
  const extraTools = useMemo(
    () =>
      (extraFolderLabels ?? []).filter(
        (l) => !groups.some((g) => g.label === l)
      ),
    [extraFolderLabels, groups]
  );

  let idx = 0;

  return (
    <div className="relative py-6">
      <SectionHead
        title="技能库"
        subtitle={`${groups.length} 个分类 · ${totalSkills} 个技能 · 跨工具统一管理`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mbtn inline-flex shrink-0 items-center gap-1.5" title="导入技能">
              <Upload className="h-3.5 w-3.5" />
              导入
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8}>
            <DropdownMenuItem onSelect={onZipImport}>
              <Archive className="h-3.5 w-3.5" />
              本地 Zip
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onGitImport}>
              <GitBranch className="h-3.5 w-3.5" />
              Git 仓库
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onAllSkills && (
          <button
            type="button"
            onClick={onAllSkills}
            title="平铺查看全部技能，勾选批量打标"
            aria-label="全部技能"
            className="mbtn inline-flex shrink-0 items-center gap-1.5"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            全部技能
          </button>
        )}
        {onDupCheck && (
          <button
            type="button"
            onClick={onDupCheck}
            title="查重：找出疑似重复的技能"
            aria-label="查重"
            className="iconbtn shrink-0"
          >
            <ScanSearch className="h-4 w-4" />
          </button>
        )}
        {onScanTree && (
          <button
            type="button"
            onClick={onScanTree}
            title="层级结构：完整目录树（扫描根 → 技能 → 资源）"
            aria-label="层级结构"
            className="iconbtn shrink-0"
          >
            <ListTree className="h-4 w-4" />
          </button>
        )}
        {onNewFolder && (
          <button
            type="button"
            onClick={onNewFolder}
            title="新建文件夹"
            aria-label="新建文件夹"
            className="iconbtn shrink-0"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        )}
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {groups.length === 0 ? (
        <EmptyPanel
          icon={<Archive className="h-7 w-7" />}
          title="技能库还是空的"
          description="导入本地 zip、从 Git 仓库拉取，或点「新建技能」，开始构建你的技能库。"
          actions={[
            <GhostCard
              key="zip"
              icon={<Archive className="h-[22px] w-[22px]" />}
              title="导入本地 Zip"
              subtitle="选择或拖拽 zip 到窗口"
              index={0}
              onClick={onZipImport}
            />,
            <GhostCard
              key="git"
              icon={<GitBranch className="h-[22px] w-[22px]" />}
              title="从 Git 仓库导入"
              subtitle="GitHub / Gitee 地址"
              index={1}
              onClick={onGitImport}
            />,
          ]}
        />
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <FolderCard
              key={g.label}
              group={g}
              index={idx++}
              layout="grid"
              onClick={() => onFolderClick(g.label)}
              onSkillClick={onSkillClick}
            />
          ))}
          {extraTools.map((l) => (
            <FolderCard
              key={`empty:${l}`}
              group={{ label: l, skills: [] }}
              index={idx++}
              layout="grid"
              onClick={() => onFolderClick(l)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {groups.map((g) => (
            <FolderCard
              key={g.label}
              group={g}
              index={idx++}
              layout="list"
              onClick={() => onFolderClick(g.label)}
            />
          ))}
          {extraTools.map((l) => (
            <FolderCard
              key={`empty:${l}`}
              group={{ label: l, skills: [] }}
              index={idx++}
              layout="list"
              onClick={() => onFolderClick(l)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
