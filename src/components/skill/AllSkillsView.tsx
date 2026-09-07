/**
 * 工作流 B + T2：全部技能扁平视图（平铺 + 勾选批量打标）。
 *
 * 定位：跨工具「看全部 + 批量打标」。平铺列表（D2），不折叠分组；
 * 勾选集临时有效（D3）；批量打标只做 添加(并集)/清除(摘除)（D4）。
 * 打包执行本期不做，工具条留 disabled 占位（D5）。
 * 支持网格/列表两种布局切换（localStorage sm:alllayout 记忆）。
 *
 * 勾选反馈优化：列表分「已勾选区」+「未勾选区」两区。勾选任意技能，
 * 立即从未勾选区移入顶部已勾选区（含计数/折叠/一键清空），无需翻动即可看到勾了什么。
 */

import { useMemo, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { LayoutToggle } from "./LayoutToggle";
import { BatchToolbar } from "./BatchToolbar";
import { BatchDeleteDialog } from "./BatchDeleteDialog";
import { TagFilterBar } from "@/components/common/TagFilterBar";
import { TagChipsRow } from "@/components/common/TagPicker";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { SectionHead } from "@/components/common/SectionHead";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import type { UseTagsApi } from "@/hooks/useTags";
import { tagKeySkill } from "@/lib/api";
import {
  collectionRelativeName,
  type LayoutMode,
  type Skill,
} from "@/hooks/useSkills";

interface AllSkillsViewProps {
  skills: Skill[];
  onSkillClick: (skill: Skill) => void;
  tagsApi?: UseTagsApi;
  /** 批量打包入口：携已勾选技能上抛（App 打开 PackCreateDialog 并预选） */
  onPackSelected?: (skills: Skill[]) => void;
  /** 批量删除成功后的刷新回调（重扫技能 + Hub 联动） */
  onSkillsRefresh?: () => void;
}

function readAllLayout(): LayoutMode {
  try {
    const v = localStorage.getItem("sm:alllayout");
    if (v === "list" || v === "grid") return v;
  } catch { /* ignore */ }
  return "list";
}

/** 多选 chip：选中态描边 + 品牌色强调（与 TagFilterBar 同风格） */
function FilterChips({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (options.length === 0) return null;
  const toggle = (v: string) =>
    onChange(
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
    );
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11.5px] text-text-tertiary">{label}</span>
      {options.map((v) => {
        const active = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            className={`inline-flex h-[26px] items-center rounded-full border px-2.5 text-[12px] transition-colors ${
              active
                ? "border-brand/60 text-brand"
                : "border-stroke bg-glass text-text-secondary hover:border-stroke-hi hover:text-text-primary"
            }`}
            style={
              active
                ? { backgroundColor: "color-mix(in srgb, var(--brand) 12%, transparent)" }
                : undefined
            }
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

/** 分区标题：已勾选 / 未勾选 */
function BlockHead({
  title,
  count,
  open,
  onToggle,
  action,
}: {
  title: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="group flex items-center gap-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:text-brand"
        >
          <ChevronDown
            className={`h-4 w-4 text-text-tertiary transition-transform duration-200 group-hover:text-brand ${
              open ? "" : "-rotate-90"
            }`}
          />
          {title}
          {typeof count === "number" && (
            <span className="rounded-full bg-brand/10 px-1.5 text-[11px] font-medium text-brand">
              {count}
            </span>
          )}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text-primary">
          {title}
          {typeof count === "number" && (
            <span className="rounded-full bg-brand/10 px-1.5 text-[11px] font-medium text-brand">
              {count}
            </span>
          )}
        </span>
      )}
      <div className="h-px flex-1 bg-stroke/60" />
      {action}
    </div>
  );
}

export function AllSkillsView({
  skills,
  onSkillClick,
  tagsApi,
  onPackSelected,
  onSkillsRefresh,
}: AllSkillsViewProps) {
  const [query, setQuery] = useState("");
  const [toolFilter, setToolFilter] = useState<string[]>([]);
  const [collFilter, setCollFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // 统一筛选工具栏展开态（默认收起为单行搜索框，与 CategoryView 一致）
  const [filterOpen, setFilterOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(readAllLayout);
  const [selectedOpen, setSelectedOpen] = useState(true);
  // 批量删除确认弹窗（打开即预检引用）
  const [deleteOpen, setDeleteOpen] = useState(false);
  const sel = useBatchSelection();

  const handleLayoutChange = (mode: LayoutMode) => {
    setLayout(mode);
    try { localStorage.setItem("sm:alllayout", mode); } catch { /* ignore */ }
  };

  // 工具 / 合集 筛选项（保持首次出现顺序）
  const tools = useMemo(
    () => [...new Set(skills.map((s) => s.scan_label))],
    [skills]
  );
  const collections = useMemo(
    () => [
      ...new Set(
        skills
          .map((s) => s.parent_collection)
          .filter((c): c is string => Boolean(c))
      ),
    ],
    [skills]
  );

  const matched = useMemo(() => {
    let list = skills;
    if (toolFilter.length > 0)
      list = list.filter((s) => toolFilter.includes(s.scan_label));
    if (collFilter.length > 0)
      list = list.filter(
        (s) => s.parent_collection && collFilter.includes(s.parent_collection)
      );
    if (tagsApi && tagFilter.length > 0) {
      list = list.filter((s) => {
        const assigned = tagsApi.tagsFor(tagKeySkill(s.id));
        return tagFilter.every((t) => assigned.includes(t));
      });
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.title_zh.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.description_zh.toLowerCase().includes(q) ||
          s.folder_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, toolFilter, collFilter, tagFilter, tagsApi, query]);

  const visibleIds = useMemo(() => matched.map((s) => s.id), [matched]);

  // 已勾选（全量，任何筛选下都展示）vs 未勾选（当前筛选结果里没被勾的）
  const selectedItems = useMemo(
    () => skills.filter((s) => sel.isSelected(s.id)),
    [skills, sel.selected]
  );
  const unselectedItems = useMemo(
    () => matched.filter((s) => !sel.isSelected(s.id)),
    [matched, sel.selected]
  );

  // 列表头复选框状态：全部选中 / 部分选中 / 未选
  const headerState = useMemo(() => {
    const on = visibleIds.filter((id) => sel.isSelected(id)).length;
    if (on === 0) return "none" as const;
    if (on === visibleIds.length) return "all" as const;
    return "some" as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, sel.count, sel.selected]);

  const toggleHeader = () => {
    const toChecked = headerState !== "all";
    sel.setMany(visibleIds, toChecked);
  };

  // 展开区是否有内容：有可筛选标签 / 有工具或合集选项 / 有可选中的技能（无内容时隐藏展开按钮，避免空展开）
  const hasTagCandidates = useMemo(() => {
    if (!tagsApi) return false;
    return skills.some(
      (s) => (tagsApi.data.assignments[tagKeySkill(s.id)] ?? []).length > 0
    );
  }, [tagsApi, skills]);
  const hasExpandContent =
    hasTagCandidates || tools.length > 0 || collections.length > 0 || matched.length > 0;

  /** 勾选框（点击不触发行/卡点击） */
  const selectBox = (s: Skill) => (
    <input
      type="checkbox"
      checked={sel.isSelected(s.id)}
      onChange={() => sel.toggle(s.id)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
      aria-label={`选择 ${s.title_zh || s.name}`}
    />
  );

  /** 渲染一组技能（grid 卡片 / list 行），i 为组内索引用于入场动画 */
  const renderItems = (list: Skill[]) =>
    list.map((s, i) => {
      const wrapStyle = { "--i": i } as CSSProperties;
      const selected = sel.isSelected(s.id);
      const selectedCls = selected ? "card-selected" : "";

      if (layout === "grid") {
        return (
          <div key={s.id} className="card-wrap" style={wrapStyle}>
            <div
              className={`glass-card glass-card-hover card-deco relative flex h-full w-full flex-col overflow-hidden p-5 transition-colors ${selectedCls}`}
            >
              <div className="relative z-[1] flex items-start justify-between gap-2">
                <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-[22px]">
                  {s.emoji || "🧩"}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {selectBox(s)}
                  <StatusBadge skill={s} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSkillClick(s)}
                className="mt-4 text-left"
              >
                <h3 className="flex items-start gap-1.5 font-display text-[19px] font-semibold leading-snug text-text-primary">
                  <span className="min-w-0">{s.title_zh || s.name}</span>
                </h3>
                <p className="mt-[3px] font-mono text-[12px] text-text-tertiary">
                  {s.name}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {s.parent_collection && (
                    <span className="max-w-[130px] truncate rounded-md border border-stroke/70 bg-glass px-1.5 py-[1px] text-[10.5px] text-text-tertiary">
                      {collectionRelativeName(s.scan_label, s.parent_collection)}
                    </span>
                  )}
                </div>
                <p className="mt-[10px] line-clamp-2 text-[12.5px] leading-relaxed text-text-secondary">
                  {s.description_zh || s.description || "暂无描述"}
                </p>
              </button>
              {tagsApi && (
                <div className="relative z-[1] mt-auto pt-3">
                  <TagChipsRow objectKey={tagKeySkill(s.id)} tagsApi={tagsApi} />
                </div>
              )}
            </div>
          </div>
        );
      }

      return (
        <div key={s.id} className="card-wrap" style={wrapStyle}>
          <div
            className={`glass-card glass-card-hover relative flex w-full items-center gap-3 overflow-hidden px-[18px] py-[12px] transition-colors ${selectedCls}`}
          >
            {selectBox(s)}
            <button
              type="button"
              onClick={() => onSkillClick(s)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] border border-stroke bg-glass-2 text-[17px]">
                {s.emoji || "🧩"}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-[14px] font-semibold text-text-primary">
                  {s.title_zh || s.name}
                </h3>
                <p className="truncate font-mono text-[10.5px] text-text-tertiary">
                  {s.name}
                </p>
              </div>
              {s.parent_collection && (
                <span className="hidden max-w-[140px] shrink-0 truncate rounded-md border border-stroke/70 bg-glass px-1.5 py-[1px] text-[10.5px] text-text-tertiary sm:block">
                  {collectionRelativeName(s.scan_label, s.parent_collection)}
                </span>
              )}
              <span className="shrink-0">
                <StatusBadge skill={s} />
              </span>
            </button>
          </div>
          {tagsApi && (
            <div className="px-[18px] pb-2.5 pt-1">
              <TagChipsRow objectKey={tagKeySkill(s.id)} tagsApi={tagsApi} />
            </div>
          )}
        </div>
      );
    });

  const hasFilter =
    query || toolFilter.length > 0 || collFilter.length > 0 || tagFilter.length > 0;

  return (
    <div className="relative py-6">
      <SectionHead
        title="全部技能"
        subtitle={`${skills.length} 个技能 · 跨工具统一管理`}
      >
        <LayoutToggle value={layout} onChange={handleLayoutChange} />
      </SectionHead>

      {/* ===== 统一筛选工具栏：搜索 + 已选标签 chips + 可展开（标签/工具/合集筛选 + 全选），与技能库主页一致 ===== */}
      <div
        className="mb-5 overflow-hidden rounded-[12px] border border-stroke bg-glass"
        style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
      >
        {/* 第一行：搜索输入框 + 展开/收起切换 */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-[14px] top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="在全部技能中搜索…"
            className="h-10 w-full rounded-[12px] border-0 bg-transparent pl-10 pr-11 text-[13.5px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
          {hasExpandContent && (
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              aria-label={filterOpen ? "收起筛选" : "展开筛选"}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-glass-2 hover:text-text-primary"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${filterOpen ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>

        {/* 已选标签 chips（始终可见，可点 × 移除；输入框内嵌式多维筛选） */}
        {tagsApi && tagFilter.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
            {tagFilter.map((id) => (
              <span
                key={id}
                className="inline-flex h-[24px] items-center gap-1 rounded-full border border-brand/50 bg-brand/10 pl-2.5 pr-1 text-[11.5px] font-medium text-brand"
              >
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

        {/* 可展开区域：标签筛选 + 工具/合集筛选 + 全选（grid-rows 平滑过渡） */}
        <div
          className={`grid transition-all duration-200 ease-out ${filterOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            <div className="border-t border-stroke/60 px-3 pb-2 pt-2.5">
              {tagsApi && (
                <TagFilterBar
                  tagsApi={tagsApi}
                  selected={tagFilter}
                  onChange={setTagFilter}
                  skills={skills}
                  className="flex flex-wrap items-center gap-1.5"
                />
              )}
              <FilterChips
                label="按工具"
                options={tools}
                selected={toolFilter}
                onChange={setToolFilter}
              />
              <FilterChips
                label="按合集"
                options={collections}
                selected={collFilter}
                onChange={setCollFilter}
              />
              {matched.length > 0 && (
                <div className="mt-1 flex items-center gap-2 px-1 py-1 text-[11px] text-text-tertiary">
                  <button
                    type="button"
                    onClick={toggleHeader}
                    className="flex items-center gap-2 transition-colors hover:text-text-primary"
                    title={headerState === "all" ? "取消全选当前筛选结果" : "全选当前筛选结果"}
                  >
                    <span
                      className={`grid h-[16px] w-[16px] place-items-center rounded-[5px] border ${
                        headerState !== "none"
                          ? "border-brand bg-brand text-white"
                          : "border-stroke bg-transparent"
                      }`}
                    >
                      {headerState === "all" && <Check className="h-3 w-3" strokeWidth={3} />}
                      {headerState === "some" && (
                        <span className="h-[6px] w-[6px] rounded-[1.5px] bg-white" />
                      )}
                    </span>
                    全选当前 {matched.length} 个
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 勾选后出现的批量工具条（与技能库主页同形态、同位置） */}
      {sel.count > 0 && (
        <BatchToolbar
          count={sel.count}
          selectedSkills={selectedItems}
          tagsApi={tagsApi}
          onClear={sel.clear}
          onPack={onPackSelected ? () => onPackSelected(selectedItems) : undefined}
          onDelete={() => setDeleteOpen(true)}
        />
      )}

      {/* 批量删除二次确认（含 Hub 引用检查与警告） */}
      <BatchDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        skills={selectedItems}
        onDone={onSkillsRefresh}
        onCleared={sel.clear}
      />

      {matched.length === 0 && selectedItems.length === 0 ? (
        <EmptyPanel
          icon={<Search className="h-7 w-7" />}
          title={hasFilter ? "没有匹配的技能" : "还没有任何技能"}
          description={
            hasFilter ? "换个关键词，或清除筛选条件再试试。" : "导入技能后，这里会平铺展示全部技能。"
          }
        />
      ) : (
        // ---- 已勾选区：顶部固定展示勾了什么（含计数/折叠/清空） ----
        <>
          {selectedItems.length > 0 && (
            <section aria-label="已勾选">
              <BlockHead
                title="已勾选"
                count={selectedItems.length}
                open={selectedOpen}
                onToggle={() => setSelectedOpen((v) => !v)}
                action={
                  <button
                    type="button"
                    onClick={sel.clear}
                    className="text-[11px] text-text-tertiary transition-colors hover:text-brand"
                  >
                    清空已勾选
                  </button>
                }
              />
              {selectedOpen &&
                (layout === "grid" ? (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {renderItems(selectedItems)}
                  </div>
                ) : (
                  <div className="flex flex-col gap-[10px]">
                    {renderItems(selectedItems)}
                  </div>
                ))}
            </section>
          )}

          {/* ---- 未勾选区：当前筛选结果里没被勾的 ---- */}
          <section aria-label="未勾选">
            <BlockHead
              title="未勾选"
              count={unselectedItems.length}
            />
            {unselectedItems.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-stroke px-4 py-6 text-center text-[12.5px] text-text-tertiary">
                {selectedItems.length > 0
                  ? "当前筛选范围内的技能已全部勾选"
                  : "没有待勾选的技能"}
              </p>
            ) : layout === "grid" ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {renderItems(unselectedItems)}
              </div>
            ) : (
              <div className="flex flex-col gap-[10px]">
                {renderItems(unselectedItems)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
