import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  Link2,
  Link2Off,
  Loader2,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  Search,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { winPath } from "@/lib/path";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { SectionHead } from "@/components/common/SectionHead";
import { LayoutToggle } from "@/components/skill/LayoutToggle";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import type { LayoutMode, Skill } from "@/hooks/useSkills";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  hubConvertToCopy,
  hubLinkableTools,
  hubLinkSkill,
  hubLinksStatus,
  hubSetDisplayName,
  hubUnlinkSkill,
  type LinkableTool,
  type LinkStatus,
} from "@/lib/api";

interface HubViewProps {
  skills: Skill[];
  /** 磁盘变更后刷新技能列表（App 的 refresh） */
  onSkillsRefresh: () => Promise<void> | void;
  /** 外部引用变更令牌（App 层 hubToken）：变化时重取台账 */
  refreshToken?: number;
}

/** 路径归一化：技能目录与账本 source 对齐用（忽略斜杠方向/尾部斜杠/大小写） */
const normPath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const HEALTH: Record<LinkStatus["health"], { label: string; cls: string; dot: string }> = {
  normal: { label: "正常", cls: "text-text-secondary", dot: "bg-emerald-400" },
  missing: { label: "落点缺失", cls: "text-amber-500", dot: "bg-amber-400" },
  orphaned: { label: "孤儿", cls: "text-red-400", dot: "bg-red-400" },
};

function readHubLayout(): LayoutMode {
  try {
    const v = localStorage.getItem("sm:hublayout");
    if (v === "list" || v === "grid") return v;
  } catch { /* ignore */ }
  return "list";
}

/** 分区标题：已勾选 / 未勾选（与技能库全部技能页同形态） */
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

/**
 * Hub 页（引用平铺管理模式）：
 * - 平铺展示所有已建立的 hub 引用项（每条 = 一个技能 × 一个目标工具），不嵌套、不分组；
 * - 勾选（引用项粒度）后顶部出现批量工具条：解除引用 / 清空选择；不提供派送/打标/打包；
 * - 不支持点击打开详情抽屉（DetailSheet），只能通过勾选/取消勾选管理引用；
 * - 引用行内提供管理菜单：设置中文名 / 复制英文名 / 转副本 / 重建链接 / 解除（移除）；
 * - 数据与技能库同源：磁盘/账本变更后经 refreshToken + onSkillsRefresh 联动刷新。
 */
export function HubView({ skills, onSkillsRefresh, refreshToken }: HubViewProps) {
  const [layout, setLayout] = useState<LayoutMode>(readHubLayout);
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<"all" | "abnormal">("all");
  const [selectedOpen, setSelectedOpen] = useState(true);

  // ===== 工具名映射 + 引用台账 =====
  const [tools, setTools] = useState<LinkableTool[]>([]);
  const [statuses, setStatuses] = useState<LinkStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // ===== 批量选择（引用项粒度）=====
  const sel = useBatchSelection();
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchUnlinkOpen, setBatchUnlinkOpen] = useState(false);

  // ===== 单条引用操作 =====
  const [actingId, setActingId] = useState<string | null>(null);
  const [pending, setPending] = useState<
    | { kind: "unlink"; link: LinkStatus }
    | { kind: "convert"; link: LinkStatus }
    | { kind: "rebuild"; link: LinkStatus }
    | null
  >(null);
  const [renaming, setRenaming] = useState<LinkStatus | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    hubLinkableTools()
      .then(setTools)
      .catch(() => setTools([]));
  }, []);

  const refreshStatuses = useCallback(async () => {
    try {
      setStatuses(await hubLinksStatus());
    } catch (e) {
      toast.error(`加载引用状态失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses, refreshToken]);

  const handleLayoutChange = (mode: LayoutMode) => {
    setLayout(mode);
    try { localStorage.setItem("sm:hublayout", mode); } catch { /* ignore */ }
  };

  const toolNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tools) map[t.id] = t.name;
    return map;
  }, [tools]);

  // 源技能匹配：引用 source ↔ 技能 skill_dir（用于展示 emoji/中文名/合集）
  const skillByDir = useMemo(() => {
    const map = new Map<string, Skill>();
    for (const s of skills) map.set(normPath(s.skill_dir), s);
    return map;
  }, [skills]);

  const matchSkill = useCallback(
    (r: LinkStatus) => skillByDir.get(normPath(r.source)),
    [skillByDir]
  );

  // 全部引用项（含孤儿：源技能已删的引用也在平铺列表中，标红可清理）
  const filtering = useMemo(() => {
    const q = query.trim().toLowerCase();
    return statuses.filter((r) => {
      if (healthFilter === "abnormal" && r.health === "normal") return false;
      if (!q) return true;
      const name = (r.display_name || r.skill_name).toLowerCase();
      const tool = (toolNames[r.target_tool] ?? r.target_tool).toLowerCase();
      const path = winPath(r.target).toLowerCase();
      return (
        name.includes(q) ||
        tool.includes(q) ||
        path.includes(q) ||
        r.skill_name.toLowerCase().includes(q)
      );
    });
  }, [statuses, query, healthFilter, toolNames]);

  const abnormalCount = useMemo(
    () => statuses.filter((s) => s.health !== "normal").length,
    [statuses]
  );
  const referencedSkillCount = useMemo(
    () => new Set(statuses.map((s) => normPath(s.source))).size,
    [statuses]
  );

  // 已勾选（全量，任何筛选下都展示）vs 未勾选（当前筛选结果里没被勾的）
  const selectedItems = useMemo(
    () => statuses.filter((r) => sel.isSelected(r.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, sel.selected]
  );
  const unselectedItems = useMemo(
    () => filtering.filter((r) => !sel.isSelected(r.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtering, sel.selected]
  );

  // 列表头复选框状态：全部选中 / 部分选中 / 未选（当前筛选结果）
  const visibleIds = useMemo(() => filtering.map((r) => r.id), [filtering]);
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

  // ===== 批量解除引用：对勾选的引用项逐个 unlink（link 移除 junction / copy 清账本）=====
  const doBatchUnlink = async () => {
    const picked = statuses.filter((r) => sel.isSelected(r.id));
    if (picked.length === 0) return;
    setBatchBusy(true);
    const ok: string[] = [];
    const fail: string[] = [];
    for (const r of picked) {
      try {
        await hubUnlinkSkill(r.id);
        ok.push(r.display_name || r.skill_name);
      } catch {
        fail.push(r.skill_name);
      }
    }
    if (ok.length > 0) {
      toast.success(`已解除 ${ok.length} 条引用`);
    }
    if (fail.length > 0) {
      toast.error(`${fail.length} 条失败：${fail.slice(0, 3).join("、")}${fail.length > 3 ? "…" : ""}`);
    }
    sel.clear();
    setBatchUnlinkOpen(false);
    setBatchBusy(false);
    if (ok.length > 0) await Promise.all([onSkillsRefresh(), refreshStatuses()]);
    else await refreshStatuses();
  };

  // ===== 单条引用操作 =====
  const doAction = useCallback(
    async (p: NonNullable<typeof pending>) => {
      setActingId(p.link.id);
      try {
        if (p.kind === "unlink") {
          await hubUnlinkSkill(p.link.id);
          toast.success(
            p.link.mode === "link"
              ? `已解除「${p.link.skill_name}」的链接`
              : `已移除「${p.link.skill_name}」的账本记录`
          );
        } else if (p.kind === "convert") {
          await hubConvertToCopy(p.link.id);
          toast.success(`「${p.link.skill_name}」已转为独立副本`);
        } else {
          await hubUnlinkSkill(p.link.id);
          await hubLinkSkill({ sourcePath: p.link.source, targetToolId: p.link.target_tool, mode: "link" });
          toast.success(`「${p.link.skill_name}」的链接已重建`);
        }
        await Promise.all([refreshStatuses(), Promise.resolve(onSkillsRefresh())]);
      } catch (e) {
        toast.error(`操作失败：${String(e)}`);
        await refreshStatuses();
      } finally {
        setActingId(null);
        setPending(null);
      }
    },
    [refreshStatuses, onSkillsRefresh]
  );

  const openRename = useCallback((s: LinkStatus) => {
    setRenameValue(s.display_name ?? "");
    setRenaming(s);
  }, []);

  const saveRename = useCallback(async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    try {
      await hubSetDisplayName(renaming.id, name);
      toast.success(name ? `「${renaming.skill_name}」的显示名已更新为「${name}」` : "已清除自定义显示名");
      setRenaming(null);
      await refreshStatuses();
    } catch (e) {
      toast.error(`保存显示名失败：${String(e)}`);
    }
  }, [renaming, renameValue, refreshStatuses]);

  const copyEnglishName = useCallback(async (s: LinkStatus) => {
    try {
      await navigator.clipboard.writeText(s.skill_name);
      toast.success(`英文名「${s.skill_name}」已复制`);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }, []);

  const healthChip = (s: LinkStatus) => {
    if (s.health === "normal") return null;
    const cls =
      s.health === "missing"
        ? "border-amber-300/60 bg-amber-400/10 text-amber-500"
        : "border-red-300/60 bg-red-400/10 text-red-400";
    return (
      <span className={`shrink-0 rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium ${cls}`}>
        {HEALTH[s.health].label}
      </span>
    );
  };

  // 引用行管理菜单：设置中文名 / 复制英文名 / 转副本（link+正常）/ 重建链接（link+异常）/ 解除（移除）
  const renderRefMenu = (s: LinkStatus, busy: boolean) => {
    const isLink = s.mode === "link";
    const healthy = s.health === "normal";
    const orphaned = s.health === "orphaned";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="引用操作" disabled={busy} className="iconbtn h-7 w-7 rounded-md">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[168px]">
          {!orphaned && (
            <>
              <DropdownMenuItem onSelect={() => openRename(s)}><PenLine />设置中文名</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyEnglishName(s)}><Copy />复制英文名</DropdownMenuItem>
              <DropdownMenuSeparator />
              {isLink && healthy && (
                <DropdownMenuItem onSelect={() => setPending({ kind: "convert", link: s })}><CopyPlus />转副本</DropdownMenuItem>
              )}
              {isLink && !healthy && (
                <DropdownMenuItem onSelect={() => setPending({ kind: "rebuild", link: s })}><RefreshCw />重建链接</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setPending({ kind: "unlink", link: s })}>
            <Link2Off />
            {orphaned ? "移除记录" : s.health === "normal" ? "解除链接" : "移除记录"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const selectBox = (r: LinkStatus) => (
    <input
      type="checkbox"
      checked={sel.isSelected(r.id)}
      onChange={() => sel.toggle(r.id)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
      aria-label={`选择 ${r.display_name || r.skill_name}`}
    />
  );

  // 引用项主体：纯展示，不可点击打开详情（需求：仅勾选管理）
  const renderBody = (r: LinkStatus) => {
    const skill = matchSkill(r);
    const title = r.display_name || skill?.title_zh || r.skill_name;
    const subName = (skill?.title_zh && r.skill_name !== skill.title_zh && !r.display_name)
      ? r.skill_name
      : (!r.display_name ? r.skill_name : "");
    return (
      <>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border border-stroke bg-glass-2 text-[19px]">
          {skill?.emoji || "🧩"}
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate font-display text-[14px] font-semibold text-text-primary">{title}</span>
          {subName && <span className="ml-1.5 truncate font-mono text-[11px] text-text-tertiary">{subName}</span>}
        </div>
        <span className="hidden shrink-0 rounded-md border border-stroke bg-glass-2 px-1.5 py-[1px] text-[10.5px] text-text-secondary sm:block">
          {toolNames[r.target_tool] ?? r.target_tool}
        </span>
        <span className="shrink-0 rounded border border-stroke px-1.5 py-px text-[10.5px] text-text-secondary">
          {r.mode === "link" ? "链接" : "复制"}
        </span>
        {healthChip(r)}
        <span className="hidden min-w-0 max-w-[210px] truncate font-mono text-[11px] text-text-tertiary xl:block" title={winPath(r.target)}>
          {winPath(r.target)}
        </span>
        {renderRefMenu(r, actingId === r.id)}
      </>
    );
  };

  const renderItems = (list: LinkStatus[]) =>
    list.map((r, i) => {
      const wrapStyle = { "--i": i } as CSSProperties;
      const selectedCls = sel.isSelected(r.id) ? "card-selected" : "";
      const leftCls =
        r.health === "normal"
          ? "border-l-transparent"
          : r.health === "missing"
            ? "border-l-amber-400"
            : "border-l-red-400";
      if (layout === "grid") {
        return (
          <div key={r.id} className="card-wrap" style={wrapStyle}>
            <div
              className={`glass-card glass-card-hover card-deco relative flex h-full w-full flex-col gap-2.5 overflow-hidden p-4 transition-colors ${selectedCls}`}
            >
              <div className="relative z-[1] flex items-start justify-between gap-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border border-stroke bg-glass-2 text-[20px]">
                  {matchSkill(r)?.emoji || "🧩"}
                </span>
                {selectBox(r)}
              </div>
              <div className="relative z-[1] min-w-0">
                <h3 className="truncate font-display text-[15px] font-semibold text-text-primary">
                  {r.display_name || matchSkill(r)?.title_zh || r.skill_name}
                </h3>
                {!r.display_name && (
                  <p className="truncate font-mono text-[11px] text-text-tertiary">{r.skill_name}</p>
                )}
              </div>
              <div className="relative z-[1] flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-stroke bg-glass-2 px-1.5 py-[1px] text-[10.5px] text-text-secondary">
                  {toolNames[r.target_tool] ?? r.target_tool}
                </span>
                <span className="rounded border border-stroke px-1.5 py-px text-[10.5px] text-text-secondary">
                  {r.mode === "link" ? "链接" : "复制"}
                </span>
                {healthChip(r)}
              </div>
              <div className="relative z-[1] flex items-center justify-between gap-2 border-t border-stroke/60 pt-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-tertiary" title={winPath(r.target)}>
                  {winPath(r.target)}
                </span>
                {renderRefMenu(r, actingId === r.id)}
              </div>
            </div>
          </div>
        );
      }
      return (
        <div key={r.id} className="card-wrap" style={wrapStyle}>
          <div
            className={`glass-card glass-card-hover relative flex w-full items-center gap-2.5 overflow-hidden px-4 py-2.5 transition-colors ${leftCls} ${selectedCls}`}
          >
            {selectBox(r)}
            {renderBody(r)}
          </div>
        </div>
      );
    });

  const hasFilter = query || healthFilter === "abnormal";

  return (
    <div className="relative py-6">
      <SectionHead
        title="Hub"
        subtitle={`${statuses.length} 条引用 · ${referencedSkillCount} 个技能 · ${abnormalCount} 异常 · 跨工具引用管理`}
      >
        <LayoutToggle value={layout} onChange={handleLayoutChange} />
      </SectionHead>

      {/* 搜索 + 健康筛选 + 刷新 */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能名 / 工具 / 路径…"
            className="h-9 w-full rounded-md border border-stroke bg-glass-2 pl-8 pr-2 text-[13px] outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60"
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-stroke text-[12px]">
          <button
            type="button"
            onClick={() => setHealthFilter("all")}
            className={`px-2.5 py-1.5 transition-colors ${healthFilter === "all" ? "bg-brand text-white" : "bg-glass text-text-secondary hover:text-text-primary"}`}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setHealthFilter("abnormal")}
            className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${healthFilter === "abnormal" ? "bg-brand text-white" : "bg-glass text-text-secondary hover:text-text-primary"}`}
          >
            异常
            {abnormalCount > 0 && (
              <span className={`rounded-sm px-1 text-[10px] ${healthFilter === "abnormal" ? "bg-white/25 text-white" : "bg-amber-500/90 text-white"}`}>
                {abnormalCount}
              </span>
            )}
          </button>
        </div>
        <button type="button" className="iconbtn h-9 w-9 shrink-0" onClick={refreshStatuses} aria-label="刷新台账">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* 全选当前筛选结果（对齐技能库勾选交互） */}
      {filtering.length > 0 && (
        <div className="mb-1 flex items-center gap-2 px-1 py-1 text-[11px] text-text-tertiary">
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
            全选当前 {filtering.length} 项
          </button>
        </div>
      )}

      {/* 勾选后批量工具条：仅「解除引用」+「清空选择」，无派送 */}
      {sel.count > 0 && (
        <div className="mb-3 rounded-[12px] border border-stroke bg-glass" style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="mr-1 text-[12.5px] font-semibold text-text-primary">
              已选 {sel.count} 项
            </span>
            <button
              type="button"
              className="mbtn inline-flex shrink-0 items-center gap-1.5 !border-red-400/40 !text-red-400 hover:!bg-red-400/10"
              disabled={batchBusy}
              onClick={() => setBatchUnlinkOpen(true)}
            >
              {batchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              解除引用
            </button>
            <button type="button" className="mbtn ml-auto shrink-0" onClick={sel.clear}>
              清空选择
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-[10px] pt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[44px] animate-pulse rounded-[12px] bg-glass-2" />
          ))}
        </div>
      ) : statuses.length === 0 ? (
        <EmptyPanel
          icon={<Link2 className="h-7 w-7" />}
          title="还没有任何引用"
          description="在技能库中勾选技能并「派送到工具」后，这里会平铺展示所有已建立的跨工具引用，集中管理。"
        />
      ) : filtering.length === 0 && selectedItems.length === 0 ? (
        <EmptyPanel
          icon={<Search className="h-7 w-7" />}
          title={hasFilter ? "没有匹配的引用" : "还没有任何引用"}
          description={hasFilter ? "换个关键词，或清除筛选条件再试试。" : undefined}
        />
      ) : (
        <>
          {/* ---- 已勾选区：顶部固定展示勾了什么 ---- */}
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
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{renderItems(selectedItems)}</div>
                ) : (
                  <div className="flex flex-col gap-[10px]">{renderItems(selectedItems)}</div>
                ))}
            </section>
          )}

          {/* ---- 未勾选区 ---- */}
          <section aria-label="未勾选">
            <BlockHead title="未勾选" count={unselectedItems.length} />
            {unselectedItems.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-stroke px-4 py-6 text-center text-[12.5px] text-text-tertiary">
                {selectedItems.length > 0 ? "当前筛选范围内的引用已全部勾选" : "没有待勾选的引用"}
              </p>
            ) : layout === "grid" ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{renderItems(unselectedItems)}</div>
            ) : (
              <div className="flex flex-col gap-[10px]">{renderItems(unselectedItems)}</div>
            )}
          </section>
        </>
      )}

      {/* ===== 批量解除引用确认 ===== */}
      <ConfirmDialog
        open={batchUnlinkOpen}
        onOpenChange={(o) => !o && !batchBusy && setBatchUnlinkOpen(false)}
        title="批量解除引用"
        description={`确定解除选中的 ${sel.count} 条引用吗？\n链接将移除 junction 本体（出处内容不受影响）；副本将移除账本记录（副本目录保留在磁盘）。`}
        confirmText="解除引用"
        variant="destructive"
        loading={batchBusy}
        onConfirm={doBatchUnlink}
      />

      {/* ===== 单条引用操作确认 ===== */}
      <ConfirmDialog
        open={pending?.kind === "unlink"}
        onOpenChange={(o) => !o && !actingId && setPending(null)}
        title={pending?.link.mode === "link" ? "解除链接" : "移除账本记录"}
        description={
          pending?.link.mode === "link"
            ? `确定解除「${pending?.link.skill_name}」的链接吗？\n只移除 junction 本体，出处内容不受影响。`
            : `确定移除「${pending?.link.skill_name}」的账本记录吗？\n副本目录会保留在磁盘上。`
        }
        confirmText="确定"
        variant="destructive"
        loading={!!actingId}
        onConfirm={() => pending && doAction(pending)}
      />
      <ConfirmDialog
        open={pending?.kind === "convert"}
        onOpenChange={(o) => !o && !actingId && setPending(null)}
        title="转为副本"
        description={`把「${pending?.link.skill_name}」从链接转为独立副本？\n将复制一份实体替换 junction。`}
        confirmText="转副本"
        loading={!!actingId}
        onConfirm={() => pending && doAction(pending)}
      />
      <ConfirmDialog
        open={pending?.kind === "rebuild"}
        onOpenChange={(o) => !o && !actingId && setPending(null)}
        title="重建链接"
        description={`重建「${pending?.link.skill_name}」的链接？\n将移除损坏的落点，并以原出处重新创建 junction。`}
        confirmText="重建"
        loading={!!actingId}
        onConfirm={() => pending && doAction(pending)}
      />

      {/* ===== 设置中文名 ===== */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>设置中文显示名</DialogTitle>
            <DialogDescription>
              只改界面显示，不影响落点文件夹名；「/」指令调用仍用英文名{renaming ? `（${renaming.skill_name}）` : ""}。
            </DialogDescription>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveRename(); } }}
            placeholder={renaming?.skill_name ?? "输入中文显示名…"}
            autoFocus
            className="h-9 w-full rounded-lg border border-stroke bg-glass px-3 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-stroke-hi"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="mbtn" onClick={() => setRenaming(null)}>取消</button>
            <button type="button" className="mbtn primary" onClick={saveRename}>保存</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}