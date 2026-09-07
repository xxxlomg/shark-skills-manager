import { type CSSProperties } from "react";
import {
  Check,
  File as FileIcon,
  Folder,
  FileText,
} from "lucide-react";
import { SkillCard } from "./SkillCard";
import type { LibTreeNode, LibTreeFile } from "@/lib/api";
import type { Skill, LayoutMode } from "@/hooks/useSkills";

/** 技能库「文件管理器」浏览器。
 *  视觉与技能库主页完全一致：技能=SkillCard、文件夹=文件夹卡、文件=文件卡，
 *  支持网格/列表切换。行为：技能文件夹/普通文件夹下钻；SKILL.md/文件开抽屉。
 */

function kindLabel(kind: string): string {
  switch (kind) {
    case "skill-doc":
      return "技能说明";
    case "markdown":
      return "文档";
    case "script":
      return "脚本";
    case "resource":
      return "资源";
    default:
      return "文件";
  }
}

/** 文件夹勾选态：all 全选 / some 部分 / none 未选（勾选整文件夹 = 其下全部技能）。 */
export interface FolderSelect {
  state: "all" | "some" | "none";
  onToggle: () => void;
}

/** 三态勾选框（跨层联动共用）：stopPropagation 避免冒泡触发卡身下钻。 */
function TriCheckbox({ state, onToggle }: { state: FolderSelect["state"]; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label="选择文件夹内全部技能"
      className={`relative z-[2] grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors ${
        state !== "none" ? "border-brand bg-brand text-white" : "border-stroke bg-transparent"
      }`}
    >
      {state === "all" && <Check className="h-3 w-3" strokeWidth={3} />}
      {state === "some" && <span className="h-[6px] w-[6px] rounded-[1.5px] bg-white" />}
    </button>
  );
}

/** 文件夹卡（与主页 FolderCard / 旧 FolderNavCard 同形的玻璃卡）；可带三态勾选框。 */
function FolderNodeCard({
  name,
  count,
  index,
  layout,
  onClick,
  select,
}: {
  name: string;
  count: number;
  index: number;
  layout: LayoutMode;
  onClick: () => void;
  select?: FolderSelect;
}) {
  const wrap = { "--i": index } as CSSProperties;
  const box = select ? <TriCheckbox state={select.state} onToggle={select.onToggle} /> : null;
  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrap}>
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }}
          className="glass-card glass-card-hover card-glow relative flex w-full cursor-pointer items-center gap-3 overflow-hidden px-[18px] py-[14px] text-left"
        >
          {box}
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-brand">
            <Folder className="h-5 w-5" />
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="truncate font-display text-[15.5px] font-semibold text-text-primary">{name}/</h3>
            <p className="font-mono text-[11px] text-text-tertiary">文件夹</p>
          </div>
          <span className="relative z-[1] shrink-0 rounded-md border border-stroke bg-glass-2 px-2 py-0.5 font-mono text-xs text-text-secondary">{count}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="card-wrap" style={wrap}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="glass-card glass-card-hover card-deco card-glow relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-5 text-left"
      >
        <div className="relative z-[1] flex items-start justify-between gap-2">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-brand">
            <Folder className="h-[22px] w-[22px]" />
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {box}
            <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-[10px] py-[3px] font-mono text-[12px] text-text-secondary">{count}</span>
          </div>
        </div>
        <h3 className="relative z-[1] mt-4 truncate font-display text-[19px] font-semibold leading-snug text-text-primary">{name}/</h3>
        <p className="relative z-[1] mt-[3px] font-mono text-[12px] text-text-tertiary">文件夹</p>
      </div>
    </div>
  );
}

/** 文件卡（与玻璃卡同形）：点击开文件抽屉。 */
function FileNodeCard({
  file,
  index,
  layout,
  onClick,
}: {
  file: LibTreeFile;
  index: number;
  layout: LayoutMode;
  onClick: () => void;
}) {
  const wrap = { "--i": index } as CSSProperties;
  const icon = file.kind === "script" ? <FileText className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />;
  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrap}>
        <button
          type="button"
          onClick={onClick}
          className="glass-card glass-card-hover card-glow relative flex w-full items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left"
        >
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-text-tertiary">
            {icon}
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="truncate font-mono text-[14px] font-medium text-text-primary">{file.name}</h3>
            <p className="truncate font-mono text-[11px] text-text-tertiary">{file.rel}</p>
          </div>
          <span className="relative z-[1] shrink-0 rounded border border-stroke/60 bg-glass px-1.5 py-px text-[10px] text-text-tertiary">
            {kindLabel(file.kind)}
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="card-wrap" style={wrap}>
      <button
        type="button"
        onClick={onClick}
        className="glass-card glass-card-hover card-glow relative flex h-full w-full flex-col overflow-hidden p-5 text-left"
      >
        <div className="relative z-[1] flex items-start justify-between gap-2">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-text-tertiary">
            {icon}
          </span>
          <span className="shrink-0 rounded border border-stroke/60 bg-glass px-1.5 py-px text-[10px] text-text-tertiary">
            {kindLabel(file.kind)}
          </span>
        </div>
        <h3 className="relative z-[1] mt-4 truncate font-mono text-[15px] font-medium leading-snug text-text-primary">{file.name}</h3>
        <p className="relative z-[1] mt-[3px] truncate font-mono text-[11px] text-text-tertiary">{file.rel}</p>
      </button>
    </div>
  );
}

interface LibraryExplorerProps {
  stack: LibTreeNode[];
  skillsById: Map<string, Skill>;
  query: string;
  layout: LayoutMode;
  onDrill: (node: LibTreeNode) => void;
  onOpenSkill: (skill: Skill) => void;
  onOpenFile: (file: LibTreeFile) => void;
  isSelected?: (id: string) => boolean;
  onToggle?: (id: string) => void;
  /** 文件夹批量勾选口：返回 undefined 表示该文件夹无技能、不展示勾选框 */
  folderSelect?: (node: LibTreeNode) => FolderSelect | undefined;
}

export function LibraryExplorer({
  stack,
  skillsById,
  query,
  layout,
  onDrill,
  onOpenSkill,
  onOpenFile,
  isSelected,
  onToggle,
  folderSelect,
}: LibraryExplorerProps) {
  const current = stack[stack.length - 1];
  if (!current) return null;

  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const dirs = current.children.filter((c) => match(c.name));
  const files = current.files.filter(
    (f) => match(f.name) && !(current.is_skill && f.name.toLowerCase() === "skill.md")
  );
  const ownSkill = current.is_skill && current.skill_id ? skillsById.get(current.skill_id) : undefined;

  const sel = (id: string) =>
    onToggle ? { selected: isSelected?.(id) ?? false, onToggle: () => onToggle(id) } : undefined;

  let idx = 0;
  const containerCls =
    layout === "grid" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-[10px]";

  return (
    <div className="flex flex-col gap-3">
      {dirs.length === 0 && files.length === 0 && !ownSkill ? (
        <p className="rounded-[12px] border border-stroke bg-glass p-6 text-center text-[12.5px] text-text-tertiary">
          {q ? `没有匹配「${query}」的条目` : "（空目录）"}
        </p>
      ) : (
        <div className={containerCls}>
          {/* 当前目录的 SKILL.md（技能卡，开技能抽屉） */}
          {ownSkill && (
            <SkillCard
              skill={ownSkill}
              index={idx++}
              layout={layout}
              onClick={() => onOpenSkill(ownSkill)}
              select={sel(ownSkill.id)}
            />
          )}
          {/* 子目录：含子目录的（包/带附件技能/普通目录）=文件夹卡下钻；叶子技能=技能卡开抽屉 */}
          {dirs.map((d) => {
            const skill = d.is_skill && d.skill_id ? skillsById.get(d.skill_id) : undefined;
            const isFolder = d.children.length > 0 || !d.is_skill;
            if (!isFolder && skill) {
              return (
                <SkillCard
                  key={d.rel}
                  skill={skill}
                  index={idx++}
                  layout={layout}
                  onClick={() => onOpenSkill(skill)}
                  select={sel(skill.id)}
                />
              );
            }
            return (
              <FolderNodeCard
                key={d.rel}
                name={d.name}
                count={d.children.length + d.files.length}
                index={idx++}
                layout={layout}
                onClick={() => onDrill(d)}
                select={folderSelect ? folderSelect(d) : undefined}
              />
            );
          })}
          {/* 文件：文件卡（开文件抽屉） */}
          {files.map((f) => (
            <FileNodeCard key={f.rel} file={f} index={idx++} layout={layout} onClick={() => onOpenFile(f)} />
          ))}
        </div>
      )}
    </div>
  );
}
