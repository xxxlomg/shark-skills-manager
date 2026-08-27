import { useState, useMemo } from "react";
import {
  Search,
  FolderOpen,
  Languages,
  Loader2,
  PenLine,
  Square,
  Check,
  ChevronDown,
  X,
} from "lucide-react";
import { LibraryExplorer } from "./LibraryExplorer";
import { FileDrawer } from "./FileDrawer";
import { LayoutToggle } from "./LayoutToggle";
import { BatchToolbar } from "./BatchToolbar";
import { BatchDeleteDialog } from "./BatchDeleteDialog";
import { SectionHead } from "@/components/common/SectionHead";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { TagFilterBar } from "@/components/common/TagFilterBar";
import { useBatchTranslate } from "@/hooks/useBatchTranslate";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import type { UseTagsApi } from "@/hooks/useTags";
import { tagKeySkill, type LibTreeNode, type LibTreeFile, type LibraryTreeRoot } from "@/lib/api";
import type { Skill, LayoutMode } from "@/hooks/useSkills";
import { toolDisplayName } from "@/hooks/useSkills";

interface CategoryViewProps {
  label: string;
  skills: Skill[];
  /** 目录树数据（App 层缓存，进程内一次性构建） */
  tree: LibraryTreeRoot[];
  /** 当前下钻路径段（相对工具扫描根，含合集段）；受控 */
  path: string[];
  /** 下钻路径变化上报（App 更新 view.path，驱动顶部唯一面包屑） */
  onPathChange: (path: string[]) => void;
  layout?: LayoutMode;
  onLayoutChange?: (mode: LayoutMode) => void;
  onSkillClick: (skill: Skill) => void;
  onCreateIn?: (target: string) => void;
  onSettingsOpen?: () => void;
  onTranslateDone?: () => void;
  tagsApi?: UseTagsApi;
  onPackSelected?: (skills: Skill[]) => void;
  onSkillsRefresh?: () => void;
}

/** 收集节点（含自身）下所有技能 id。 */
function collectSkillIds(node: LibTreeNode, out: Set<string>) {
  if (node.skill_id) out.add(node.skill_id);
  for (const c of node.children) collectSkillIds(c, out);
}

export function CategoryView({
  label,
  skills,
  tree,
  path,
  onPathChange,
  layout,
  onLayoutChange,
  onSkillClick,
  onCreateIn,
  onSettingsOpen,
  onTranslateDone,
  tagsApi,
  onPackSelected,
  onSkillsRefresh,
}: CategoryViewProps) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const { batch, running, run, stop } = useBatchTranslate({
    onNeedSettings: onSettingsOpen,
    onDone: onTranslateDone,
  });
  const sel = useBatchSelection();
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ===== PLAN-19：文件管理器树（受控：树 + 路径均来自 App 层），下钻 stack 由 path 派生 =====
  const [drawerFile, setDrawerFile] = useState<LibTreeFile | null>(null);

  const stack = useMemo<LibTreeNode[]>(() => {
    // 不匹配时不得兜底选树（tree[0] 会渲染无关工具的目录，见「示例技能幽灵」bug）：
    // 找不到对应扫描根 → 空栈 → 下方空态提示，而不是展示别的工具的技能。
    const root = tree.find((r) => r.label === label) ?? null;
    if (!root) return [];
    const st: LibTreeNode[] = [root.root];
    let cur = root.root;
    for (const seg of path) {
      const next = cur.children.find((c) => c.name === seg);
      if (!next) break;
      st.push(next);
      cur = next;
    }
    return st;
  }, [tree, label, path]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  const skillsById = useMemo(
    () => new Map(skills.map((s) => [s.id, s])),
    [skills]
  );

  // 作用域 = 当前目录下的全部技能（含嵌套），供计数/批量/筛选
  const base = useMemo(() => {
    if (!current) return skills;
    const ids = new Set<string>();
    collectSkillIds(current, ids);
    return skills.filter((s) => ids.has(s.id));
  }, [skills, current]);

  const scopedTitle = label;

  const createTarget = useMemo(() => {
    const t = base.find(
      (s) => s.tool_id && s.tool_id !== "authored" && s.tool_id !== "builtin",
    );
    return t?.tool_id ?? label;
  }, [base, label]);

  const filtered = useMemo(() => {
    let list = base;
    if (tagsApi && tagFilter.length > 0) {
      list = list.filter((s) => {
        const assigned = tagsApi.tagsFor(tagKeySkill(s.id));
        return tagFilter.every((t) => assigned.includes(t));
      });
    }
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.title_zh.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.description_zh.toLowerCase().includes(q) ||
        s.folder_name.toLowerCase().includes(q)
    );
  }, [base, query, tagFilter, tagsApi]);

  const okCount = base.filter((s) => s.has_translation).length;
  const pendingCount = base.length - okCount;
  const hasUntranslated = pendingCount > 0;

  const visibleIds = useMemo(() => filtered.map((s) => s.id), [filtered]);
  const headerState = useMemo(() => {
    const on = visibleIds.filter((id) => sel.isSelected(id)).length;
    if (on === 0) return "none" as const;
    if (on === visibleIds.length) return "all" as const;
    return "some" as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, sel.count, sel.selected]);
  const toggleHeader = () => sel.setMany(visibleIds, headerState !== "all");
  const selectedSkills = useMemo(
    () => skills.filter((s) => sel.isSelected(s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skills, sel.selected]
  );

  // 文件夹批量勾选：递归收集子树全部技能 id，派生三态；勾选/取消即整组加入/移出选中集
  const folderSelect = (node: LibTreeNode) => {
    const ids = new Set<string>();
    collectSkillIds(node, ids);
    const idList = [...ids].filter((id) => skillsById.has(id));
    if (idList.length === 0) return undefined;
    const on = idList.filter((id) => sel.isSelected(id)).length;
    const state: "all" | "some" | "none" =
      on === 0 ? "none" : on === idList.length ? "all" : "some";
    return { state, onToggle: () => sel.setMany(idList, state !== "all") };
  };

  const hasTagCandidates = useMemo(() => {
    if (!tagsApi) return false;
    return base.some(
      (s) => (tagsApi.data.assignments[tagKeySkill(s.id)] ?? []).length > 0
    );
  }, [tagsApi, base]);
  const hasExpandContent = hasTagCandidates || filtered.length > 0;

  return (
    <div className="relative py-6">
      <SectionHead
        title={toolDisplayName(scopedTitle)}
        subtitle={`${base.length} 个技能 · ${okCount} 已翻译 · ${pendingCount} 待处理`}
      >
        {onCreateIn && (
          <button
            type="button"
            className="mbtn primary"
            onClick={() => onCreateIn(createTarget)}
            title={`在「${toolDisplayName(label)}」下创作技能`}
          >
            <PenLine className="h-3.5 w-3.5" />
            创作
          </button>
        )}
        {running ? (
          <>
            <button type="button" className="mbtn primary" disabled title={`当前正在翻译：${batch?.name ?? ""}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="max-w-[180px] truncate">
                翻译中 {batch?.current}/{batch?.total} · {batch?.name}
              </span>
            </button>
            <button type="button" className="mbtn" onClick={stop} title="停止批量翻译（已完成的不受影响）">
              <Square className="h-3.5 w-3.5" />
              停止
            </button>
          </>
        ) : (
          <button
            type="button"
            className="mbtn primary"
            onClick={() => run(base)}
            disabled={!hasUntranslated}
          >
            <Languages className="h-3.5 w-3.5" />
            批量翻译未译
          </button>
        )}
        {onLayoutChange && (
          <LayoutToggle value={layout ?? "grid"} onChange={onLayoutChange} />
        )}
      </SectionHead>

      {/* 统一筛选工具栏 */}
      <div
        className="mb-5 overflow-hidden rounded-[12px] border border-stroke bg-glass"
        style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
      >
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-[14px] top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="在本分类中搜索…"
            className="h-10 w-full rounded-[12px] border-0 bg-transparent pl-10 pr-11 text-[13.5px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
          {hasExpandContent && (
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              aria-label={filterOpen ? "收起筛选" : "展开筛选"}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-glass-2 hover:text-text-primary"
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${filterOpen ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>

        {tagsApi && tagFilter.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
            {tagFilter.map((id) => (
              <span key={id} className="inline-flex h-[24px] items-center gap-1 rounded-full border border-brand/50 bg-brand/10 pl-2.5 pr-1 text-[11.5px] font-medium text-brand">
                {tagsApi.data.tags[id]?.name ?? id}
                <button
                  type="button"
                  onClick={() => setTagFilter((prev) => prev.filter((t) => t !== id))}
                  aria-label={`移除标签 ${tagsApi.data.tags[id]?.name ?? id}`}
                  className="grid h-4 w-4 place-items-center rounded-full transition-colors hover:bg-brand/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className={`grid transition-all duration-200 ease-out ${filterOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="border-t border-stroke/60 px-3 pb-2 pt-2.5">
              {tagsApi && (
                <TagFilterBar
                  tagsApi={tagsApi}
                  selected={tagFilter}
                  onChange={setTagFilter}
                  skills={base}
                  className="flex flex-wrap items-center gap-1.5"
                />
              )}
              {filtered.length > 0 && (
                <div className="mt-1 flex items-center gap-2 px-1 py-1 text-[11px] text-text-tertiary">
                  <button
                    type="button"
                    onClick={toggleHeader}
                    className="flex items-center gap-2 transition-colors hover:text-text-primary"
                    title={headerState === "all" ? "取消全选当前筛选结果" : "全选当前筛选结果"}
                  >
                    <span className={`grid h-[16px] w-[16px] place-items-center rounded-[5px] border ${headerState !== "none" ? "border-brand bg-brand text-white" : "border-stroke bg-transparent"}`}>
                      {headerState === "all" && <Check className="h-3 w-3" strokeWidth={3} />}
                      {headerState === "some" && <span className="h-[6px] w-[6px] rounded-[1.5px] bg-white" />}
                    </span>
                    全选当前 {filtered.length} 个
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {sel.count > 0 && (
        <BatchToolbar
          count={sel.count}
          selectedSkills={selectedSkills}
          tagsApi={tagsApi}
          onClear={sel.clear}
          onPack={onPackSelected ? () => onPackSelected(selectedSkills) : undefined}
          onDelete={() => setDeleteOpen(true)}
        />
      )}

      <BatchDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        skills={selectedSkills}
        onDone={onSkillsRefresh}
        onCleared={sel.clear}
      />

      {!current ? (
        <EmptyPanel
          icon={<FolderOpen className="h-7 w-7" />}
          title="正在读取目录…"
          description="按磁盘真实结构加载该工具的技能目录树。"
        />
      ) : (
        <LibraryExplorer
          stack={stack}
          skillsById={skillsById}
          query={query}
          layout={layout ?? "grid"}
          onDrill={(n) => onPathChange([...path, n.name])}
          onOpenSkill={onSkillClick}
          onOpenFile={setDrawerFile}
          isSelected={sel.isSelected}
          onToggle={sel.toggle}
          folderSelect={folderSelect}
        />
      )}

      <FileDrawer file={drawerFile} open={!!drawerFile} onClose={() => setDrawerFile(null)} />
    </div>
  );
}
