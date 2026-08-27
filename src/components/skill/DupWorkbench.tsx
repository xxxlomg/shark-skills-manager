/**
 * PLAN-16 阶段 7：查重工作台重构（左双模块 + 主区去卡片化）。
 *
 * - 左栏两模块：「待处理」（分组列表）+「合并历史」（点击 → 主区切历史视图，不再弹窗）；
 * - 主区瑞士风：变体/成员/历史全部 hairline 平铺行，零卡片嵌套；
 *   状态用字母徽标 + 3px 左色条表达，替代「外层卡 → 变体卡 → 成员卡」三层包裹。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  GitCompareArrows,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  detectDuplicates,
  dupResolveMany,
  listMergeHistory,
  readSkillFile,
  scanSkills,
  undoMerge,
  type DupGroup,
  type DupMember,
  type MergeRecord,
} from "@/lib/api";
import { parseFm } from "@/lib/merge";
import { computeLineDiff } from "@/components/common/LineDiff";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { buildVariants, pathTail, toolDot } from "@/lib/variants";

interface DupWorkbenchProps {
  onBack: () => void;
  onCompare: (a: DupMember, b: DupMember, group: DupGroup) => void;
  onMultiMerge: (group: DupGroup, baseId: string) => void;
  onChanged: () => void;
  /** 返回定位：上次选中的分组 id（进出对比页后恢复） */
  initialSelectedId?: string | null;
  onSelectId?: (id: string) => void;
}

interface VStats {
  lines: number;
  hasDesc: boolean;
  plus: number;
  minus: number;
}

const DISPOSAL_LABEL: Record<MergeRecord["disposal"], string> = {
  delete_both: "两侧已回收站",
  delete_weaker: "较弱方已回收站",
  keep_both: "两侧保留",
};

/** 从 skill_id（tool|rel）取工具名 / 技能名 */
const toolOf = (sid: string) => sid.split("|")[0] ?? "";
const nameOf = (sid: string) => sid.split("|")[1] ?? sid;
/** 取产物路径末段（展示名） */
const resultName = (p: string) => {
  const seg = p.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return seg[seg.length - 1] ?? p;
};

/** 组头（2 成员 / 多变体共用）：类型徽标 + 组名 + 计数 + 理由 */
function GroupHeader({ group, variantCount }: { group: DupGroup; variantCount?: number }) {
  const folded = variantCount !== undefined ? group.members.length - variantCount : 0;
  return (
    <div className="border-b border-stroke/60 pb-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`shrink-0 rounded border px-1.5 py-px text-[12px] font-medium ${
            group.kind === "identical"
              ? "border-red-500/40 bg-red-500/10 text-red-500"
              : "border-amber-500/40 bg-amber-500/10 text-amber-600"
          }`}
        >
          {group.kind === "identical" ? "内容全等" : "同名"}
        </span>
        <span className="text-[15px] font-semibold leading-tight text-text-primary">{group.members[0]?.name}</span>
        <span className="font-mono text-[12px] text-text-tertiary">
          ×{group.members.length}
          {variantCount !== undefined ? ` · ${variantCount} 种内容${folded > 0 ? ` · ${folded} 份副本已折叠` : ""}` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{group.reason}</p>
    </div>
  );
}

/** 成员表对齐网格 + 列标签（跨行对齐，路径/徽标各归其列）。
 *  注意：表头与每行是独立 grid 容器，fr/auto 按各自内容求解——
 *  状态列必须定宽（不能用 auto），否则各行徽章有无不同会导致列错位。 */
const MEMBER_GRID = "grid grid-cols-[14px_minmax(0,1.2fr)_92px_minmax(0,1.8fr)_124px_26px] items-center gap-x-2";
function MemberHead() {
  return (
    <div className={`${MEMBER_GRID} border-b border-stroke/60 pb-1.5 font-mono text-[11px] text-text-tertiary`}>
      <span />
      <span>成员</span>
      <span>来源</span>
      <span>路径</span>
      <span className="text-right">状态</span>
      <span />
    </div>
  );
}

/** 成员行（对齐网格、hairline 平铺，无卡片） */
function MemberRow({ m }: { m: DupMember }) {
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(m.source_path);
      toast.success("完整路径已复制");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  };
  return (
    <div className={`${MEMBER_GRID} border-b border-stroke/40 py-2.5`}>
      <span className="h-2 w-2 rounded-full bg-stroke-hi" aria-hidden />
      <span className="min-w-0 truncate text-[14px] font-medium text-text-primary">
        <span className="mr-1.5 text-[14px]">{m.emoji ?? "🧩"}</span>
        {m.name}
        {m.title_zh && <span className="ml-1.5 text-[12px] font-normal text-text-tertiary">{m.title_zh}</span>}
      </span>
      <span className="truncate font-mono text-[12px] uppercase text-text-tertiary">{m.scan_label}</span>
      <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary" title={`完整路径：${m.source_path}\n点击复制`}>
        {m.source_path}
      </span>
      <span className="flex items-center justify-end gap-1">
        {m.hub_linked && <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[11px] text-amber-600">Hub 落点</span>}
        {m.has_translation && <span className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[11px] text-brand">已翻译</span>}
      </span>
      <button type="button" onClick={copyPath} title="复制完整路径" className="shrink-0 rounded border border-stroke bg-glass px-1 py-px text-text-tertiary transition-colors hover:border-stroke-hi hover:text-text-secondary">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

/** N>2 组：变体平铺（hairline 行，零卡片） */
function VariantGroupCard({
  group,
  stats,
  onCompare,
  onResolveMany,
  onMultiMerge,
}: {
  group: DupGroup;
  stats: Record<string, VStats>;
  onCompare: (a: DupMember, b: DupMember, g: DupGroup) => void;
  onResolveMany: (keep: DupMember, remove: DupMember[], kind: DupGroup["kind"]) => void;
  onMultiMerge: (base: DupMember) => void;
}) {
  const variants = useMemo(() => buildVariants(group), [group]);
  const repA = variants[0]?.rep;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pickL, setPickL] = useState("A");
  const [pickR, setPickR] = useState("B");

  const toggle = (k: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  const repOf = (letter: string) => variants.find((v) => v.letter === letter)?.rep;

  return (
    <div className="flex flex-col">
      {/* 组头（共用 GroupHeader） */}
      <GroupHeader group={group} variantCount={variants.length} />

      {/* 变体行（hairline，无卡） */}
      <div className="divide-y divide-stroke/70">
        {variants.map((v) => {
          const st = stats[`${group.id}:${v.letter}`];
          const aMt = variants[0]?.rep.mtime ?? 0;
          const mtTag = v.letter === "A" || !v.rep.mtime || !aMt ? "" : v.rep.mtime > aMt ? " · 较新" : v.rep.mtime < aMt ? " · 较旧" : "";
          const exp = expanded.has(`${group.id}:${v.letter}`);
          return (
            <div key={v.letter}>
              <div className="flex flex-wrap items-center gap-2 py-2.5">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border font-mono text-[12px] ${v.letter === "A" ? "border-brand/60 bg-brand/10 text-brand" : "border-stroke text-text-tertiary"}`}>
                  {v.letter}
                </span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${toolDot(v.rep.tool_id)}`} aria-hidden />
                <span className="w-[84px] shrink-0 truncate font-mono text-[12px] uppercase text-text-tertiary">{v.rep.scan_label}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary" title={v.rep.source_path}>…/{pathTail(v.rep.skill_dir)}</span>
                {st && (
                  <span className="shrink-0 font-mono text-[12px] text-text-tertiary">
                    {st.lines} 行 · {st.hasDesc ? "描述齐" : "缺描述"}{mtTag}{v.letter !== "A" ? ` · 比A +${st.plus}/−${st.minus}` : ""}
                  </span>
                )}
                {v.rep.has_translation && <span className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[11px] text-brand">已翻译</span>}
                {v.letter === "A" ? (
                  <span className="shrink-0 rounded border border-brand/50 bg-brand/10 px-1.5 py-px text-[11px] font-medium text-brand">推荐基准</span>
                ) : (
                  repA && (
                    <button type="button" onClick={() => onCompare(repA, v.rep, group)} className="shrink-0 rounded border border-stroke bg-glass px-2 py-1 text-[12px] text-text-secondary transition-colors hover:border-brand/50 hover:text-brand" title={`对比「A · ${repA.scan_label}」与「${v.letter} · ${v.rep.scan_label}」`}>
                      <GitCompareArrows className="h-3 w-3" />
                      与 A 对比
                    </button>
                  )
                )}
              </div>
              {v.members.length > 1 && (
                <div className="pb-1">
                  <button type="button" onClick={() => toggle(`${group.id}:${v.letter}`)} className="flex items-center gap-1.5 pl-7 text-[12px] text-text-tertiary transition-colors hover:text-text-secondary">
                    <ChevronDown className={`h-3 w-3 transition-transform ${exp ? "" : "-rotate-90"}`} />
                    相同副本 ×{v.members.length}（内容全等，处置零风险）
                  </button>
                  {exp && (
                    <div className="flex flex-col">
                      {v.members.map((m) => <MemberRow key={m.skill_id} m={m} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 动作区（hairline 顶） */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stroke/60 pt-2.5">
        {repA && (
          <>
            <button type="button" onClick={() => onMultiMerge(repA)} className="mbtn primary" title={`以「A · ${repA.scan_label}」为基准，其余 ${group.members.length - 1} 份自动合入`}>
              <Sparkles className="h-3.5 w-3.5" />
              一键智能合并 {variants.length} 变体（{group.members.length} 份）
            </button>
            <button type="button" onClick={() => onResolveMany(repA, group.members.filter((m) => m.skill_id !== repA.skill_id), group.kind)} className="mbtn" title={`保留「A · ${repA.scan_label}」，其余 ${group.members.length - 1} 个备份后进回收站`}>
              <Trash2 className="h-3.5 w-3.5" />
              保留「{repA.scan_label}」，处置其余 {group.members.length - 1} 个
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[12.5px] text-text-tertiary">自由对比</span>
          <select value={pickL} onChange={(e) => setPickL(e.target.value)} className="h-[26px] rounded-md border border-stroke bg-glass-2 px-1.5 font-mono text-[12.5px] text-text-secondary outline-none" aria-label="对比左侧变体">
            {variants.map((v) => <option key={v.letter} value={v.letter}>{v.letter} · {v.rep.scan_label}</option>)}
          </select>
          <span className="font-mono text-[11px] text-text-tertiary">vs</span>
          <select value={pickR} onChange={(e) => setPickR(e.target.value)} className="h-[26px] rounded-md border border-stroke bg-glass-2 px-1.5 font-mono text-[12.5px] text-text-secondary outline-none" aria-label="对比右侧变体">
            {variants.map((v) => <option key={v.letter} value={v.letter}>{v.letter} · {v.rep.scan_label}</option>)}
          </select>
          <button type="button" disabled={pickL === pickR || !repOf(pickL) || !repOf(pickR)} onClick={() => { const a = repOf(pickL); const b = repOf(pickR); if (a && b) onCompare(a, b, group); }} className="mbtn" title="对比所选两个变体">
            <GitCompareArrows className="h-3.5 w-3.5" />
            对比
          </button>
        </div>
      </div>
    </div>
  );
}

export function DupWorkbench({ onBack, onCompare, onMultiMerge, onChanged, initialSelectedId, onSelectId }: DupWorkbenchProps) {
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"scan" | "compare">("scan");
  const [scannedCount, setScannedCount] = useState(0);
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  // 左栏两模块：pending = 待处理分组；history = 合并历史；null = 全部收起
  const [view, setView] = useState<"pending" | "history" | null>("pending");

  // 合并历史（主区内联，不再弹窗）
  const [historyRecords, setHistoryRecords] = useState<MergeRecord[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);

  const run = useCallback(() => {
    setLoading(true);
    setStage("scan");
    setError(null);
    scanSkills()
      .then((skills) => {
        setScannedCount(skills.length);
        setStage("compare");
        return detectDuplicates();
      })
      .then(setGroups)
      .catch((e) => {
        setGroups(null);
        setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    if (groups && groups.length > 0 && !groups.some((g) => g.id === selectedId)) {
      setSelectedId(groups[0].id);
    }
  }, [groups, selectedId]);

  const selectGroup = useCallback(
    (id: string) => {
      setSelectedId(id);
      onSelectId?.(id);
    },
    [onSelectId]
  );

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    listMergeHistory()
      .then(setHistoryRecords)
      .catch((e) => {
        setHistoryRecords(null);
        toast.error(`读取合并历史失败：${String(e instanceof Error ? e.message : e)}`);
      })
      .finally(() => setHistoryLoading(false));
  }, []);

  const doUndo = async (rec: MergeRecord) => {
    setUndoing(rec.id);
    try {
      await undoMerge(rec.id);
      toast.success("已撤销合并：原件已恢复，合并产物已删除");
      onChanged();
      loadHistory();
      run();
    } catch (e) {
      toast.error(`撤销失败：${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setUndoing(null);
    }
  };

  // 变体统计（仅 N>2 组）
  const [stats, setStats] = useState<Record<string, VStats>>({});
  useEffect(() => {
    if (!groups) return;
    let alive = true;
    (async () => {
      const next: Record<string, VStats> = {};
      for (const g of groups.filter((x) => x.members.length > 2)) {
        const vs = buildVariants(g);
        const bodies = new Map<string, string>();
        for (const v of vs) {
          let md = "";
          try {
            md = await readSkillFile(v.rep.source_path);
          } catch {
            md = "";
          }
          bodies.set(v.letter, md);
        }
        const aBody = (bodies.get("A") ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
        for (const v of vs) {
          const md = bodies.get(v.letter) ?? "";
          const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
          let plus = 0;
          let minus = 0;
          if (v.letter !== "A" && aBody.trim()) {
            const { rows } = computeLineDiff(aBody, body);
            for (const r of rows) {
              if (r.kind === "add") plus++;
              else if (r.kind === "del") minus++;
            }
          }
          next[`${g.id}:${v.letter}`] = { lines: body.split("\n").length, hasDesc: !!parseFm(md).description, plus, minus };
        }
      }
      if (alive) setStats(next);
    })();
    return () => {
      alive = false;
    };
  }, [groups]);

  const [pendingResolve, setPendingResolve] = useState<{ keep: DupMember; remove: DupMember[]; kind: DupGroup["kind"] } | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const askResolveMany = (keep: DupMember, remove: DupMember[], kind: DupGroup["kind"]) => setPendingResolve({ keep, remove, kind });
  const confirmResolveMany = async () => {
    if (!pendingResolve) return;
    setResolveBusy(true);
    try {
      const backups = await dupResolveMany(pendingResolve.keep.skill_id, pendingResolve.remove.map((m) => m.skill_id));
      toast.success(`已保留「${pendingResolve.keep.name}」，处置 ${pendingResolve.remove.length} 个（备份 ${backups.length} 份，可恢复）`);
      setPendingResolve(null);
      onChanged();
      run();
    } catch (e) {
      toast.error(`处置失败：${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setResolveBusy(false);
    }
  };

  const totals = useMemo(() => {
    if (!groups) return { groups: 0, skills: 0 };
    return { groups: groups.length, skills: groups.reduce((s, g) => s + g.members.length, 0) };
  }, [groups]);

  const groupMeta = useMemo(() => (groups ?? []).map((g) => ({ g, variants: buildVariants(g).length })), [groups]);
  const selectedGroup = groups?.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ===== header ===== */}
      <header className="shrink-0 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={onBack} className="mbtn" aria-label="返回技能库">
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-text-tertiary" />
            <span className="text-[16px] font-semibold text-text-primary">查重检测</span>
            {groups && !loading && (
              <span className="font-mono text-[12.5px] text-text-tertiary">{totals.groups} 组疑似 · 涉及 {totals.skills} 个技能</span>
            )}
          </div>
          <span className="hidden text-[12.5px] text-text-tertiary md:block">本地快路径：正文哈希全等 + 同名检测；不消耗 LLM</span>
          <div className="ml-auto">
            <button type="button" onClick={run} disabled={loading} className="mbtn">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              重新检测
            </button>
          </div>
        </div>
      </header>

      {/* ===== main：左菜单 + 主区 ===== */}
      <main className="flex min-h-0 flex-1 overflow-hidden pt-3">
        {/* 左栏：双 accordion 菜单（待处理 / 合并历史，头部固定、点击展开/收起） */}
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-stroke/60 pr-2">
          {/* 顶部：待处理菜单项 */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setView((v) => (v === "pending" ? null : "pending"))}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${view === "pending" ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}
            >
              {view === "pending" ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">待处理</span>
              {groups && !loading && <span className="shrink-0 font-mono text-[12px] text-text-tertiary">{groups.length}</span>}
            </button>
          </div>
          {/* 滚动区：待处理展开时显示分组列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-1">
            {view === "pending" && (
              <div className="flex flex-col pl-2">
                {loading ? (
                  <div className="flex flex-col gap-1.5 p-1">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="h-7 animate-pulse rounded-md bg-glass-2" />)}
                  </div>
                ) : error ? (
                  <p className="p-1 text-[13px] text-red-500">检测失败</p>
                ) : !groups || groups.length === 0 ? (
                  <p className="p-1 text-[13px] text-text-tertiary">没有疑似重复</p>
                ) : (
                  groupMeta.map(({ g, variants }) => {
                    const active = g.id === selectedId;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => selectGroup(g.id)}
                        className={`relative flex w-full items-center gap-2 border-b border-stroke/40 px-2 py-2 text-left transition-colors ${active ? "" : "hover:text-text-secondary"}`}
                      >
                        {active && <span className="absolute left-0 top-[15%] h-[70%] w-[2px] rounded-r bg-brand" aria-hidden />}
                        <span className={`h-2 w-2 shrink-0 rounded-full ${g.kind === "identical" ? "bg-red-500" : "bg-amber-500"}`} aria-hidden />
                        <span className={`min-w-0 flex-1 truncate text-[14px] text-text-primary ${active ? "font-semibold" : "font-medium"}`}>
                          {g.members[0]?.name}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-text-tertiary">×{g.members.length}</span>
                        {variants > 1 && <span className="shrink-0 font-mono text-[11px] text-text-tertiary">{variants} 变体</span>}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          {/* 底部：合并历史菜单项（固定在 sidebar 底部） */}
          <div className="shrink-0 border-t border-stroke/60 pt-1.5">
            <button
              type="button"
              onClick={() =>
                setView((v) => {
                  if (v !== "history") loadHistory();
                  return v === "history" ? null : "history";
                })
              }
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${view === "history" ? "text-brand" : "text-text-tertiary hover:text-text-secondary"}`}
            >
              <History className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">合并历史</span>
              {historyRecords && <span className="shrink-0 font-mono text-[12px] text-text-tertiary">{historyRecords.length}</span>}
            </button>
          </div>
        </aside>

        {/* 主区：待处理 → 组详情；合并历史 → 历史列表 */}
        <div className="min-w-0 flex-1 overflow-y-auto px-3 pb-4">
          {view === "history" ? (
            /* ===== 合并历史视图（内联，hairline 行）===== */
            <div className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-stroke/60 pb-2">
                <span className="text-[14px] font-semibold text-text-primary">合并历史</span>
                <span className="font-mono text-[11px] text-text-tertiary">备份在即可撤销</span>
              </div>
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 p-10 text-[14px] text-text-tertiary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载…
                </div>
              ) : !historyRecords || historyRecords.length === 0 ? (
                <p className="p-6 text-center text-[14px] text-text-tertiary">还没有合并记录。</p>
              ) : (
                <div className="divide-y divide-stroke/70">
                  {historyRecords.map((r) => (
                    <div key={r.id} className="py-3">
                      {/* 第一行：时间 + 徽标（处置右对齐） */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 font-mono text-[12px] text-text-tertiary">{r.at}</span>
                        <span className="shrink-0 rounded border border-brand/30 bg-brand/10 px-1.5 py-px text-[11px] text-brand">
                          {r.kind === "dispose" ? "处置副本" : r.polished ? "已润色" : "段落拼接"}
                        </span>
                        <span className="ml-auto shrink-0 rounded border border-stroke bg-glass-2 px-1.5 py-px text-[11px] text-text-secondary">{DISPOSAL_LABEL[r.disposal]}</span>
                      </div>
                      {/* 第二行：链路（处置=保留/处置；合并=⇄→产物） */}
                      {r.kind === "dispose" ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
                          <span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[11px] text-emerald-500">保留</span>
                          <span className="shrink-0 rounded border border-stroke/60 bg-glass-2 px-1 py-px font-mono text-[11px] text-text-secondary">{toolOf(r.a.skill_id)}</span>
                          <span className="max-w-[120px] truncate font-medium text-text-primary" title={r.a.path}>{nameOf(r.a.skill_id)}</span>
                          <span className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[11px] text-red-400">处置</span>
                          <span className="shrink-0 rounded border border-stroke/60 bg-glass-2 px-1 py-px font-mono text-[11px] text-text-secondary">{toolOf(r.b.skill_id)}</span>
                          <span className="max-w-[120px] truncate font-medium text-text-primary" title={r.b.path}>{nameOf(r.b.skill_id)}</span>
                        </div>
                      ) : (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
                          <span className="shrink-0 rounded border border-stroke/60 bg-glass-2 px-1 py-px font-mono text-[11px] text-text-secondary">{toolOf(r.a.skill_id)}</span>
                          <span className="max-w-[120px] truncate font-medium text-text-primary" title={r.a.path}>{nameOf(r.a.skill_id)}</span>
                          <span className="shrink-0 text-text-tertiary">⇄</span>
                          <span className="shrink-0 rounded border border-stroke/60 bg-glass-2 px-1 py-px font-mono text-[11px] text-text-secondary">{toolOf(r.b.skill_id)}</span>
                          <span className="max-w-[120px] truncate font-medium text-text-primary" title={r.b.path}>{nameOf(r.b.skill_id)}</span>
                          <span className="shrink-0 text-text-tertiary">→</span>
                          <span className="min-w-0 truncate font-mono text-[12.5px] text-brand" title={r.result_path}>{resultName(r.result_path)}</span>
                        </div>
                      )}
                      {/* 第三行：备份路径 + 撤销 */}
                      <div className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-tertiary" title={r.backup_dir}>备份：{r.backup_dir}</span>
                        <button type="button" className="mbtn shrink-0" disabled={undoing !== null} onClick={() => doUndo(r)}>
                          {undoing === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                          撤销
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-[14px] text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" />
                {stage === "scan" ? "正在扫描技能库目录…" : `正在比对 ${scannedCount} 个技能…`}
              </div>
              <div className="h-24 animate-pulse rounded-[12px] border border-stroke bg-glass" />
              <div className="h-24 animate-pulse rounded-[12px] border border-stroke bg-glass" />
            </div>
          ) : error ? (
            <div className="border-l-[3px] border-red-500 bg-red-500/[.06] px-3 py-3 text-[14px] text-red-500">检测失败：{error}</div>
          ) : !selectedGroup ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-[16px] border border-stroke bg-glass-2 text-emerald-500"><Sparkles className="h-7 w-7" /></span>
              <h3 className="font-display text-[16px] font-semibold text-text-primary">没有发现疑似重复</h3>
              <p className="max-w-sm text-[14px] text-text-secondary">技能库很干净 🦈——内容全等与同名两条线都查过了。</p>
            </div>
          ) : selectedGroup.members.length > 2 ? (
            <VariantGroupCard
              group={selectedGroup}
              stats={stats}
              onCompare={onCompare}
              onResolveMany={askResolveMany}
              onMultiMerge={(base) => onMultiMerge(selectedGroup, base.skill_id)}
            />
          ) : (
            /* 2 成员组：共用组头 + 对齐成员表 + 统一动作栏 */
            <div className="flex flex-col">
              <GroupHeader group={selectedGroup} />
              <div className="mt-1 flex flex-col">
                <MemberHead />
                {selectedGroup.members.map((m) => <MemberRow key={m.skill_id} m={m} />)}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-stroke/60 pt-2.5">
                <button type="button" onClick={() => onMultiMerge(selectedGroup, selectedGroup.members[0].skill_id)} className="mbtn primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  智能合并
                </button>
                <button type="button" onClick={() => onCompare(selectedGroup.members[0], selectedGroup.members[1], selectedGroup)} className="mbtn">
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  对比（只读 diff）
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== footer ===== */}
      <footer className="shrink-0 border-t border-stroke/70 py-3">
        <div className="flex items-center gap-2">
          <span className="mr-auto text-[13px] text-text-tertiary">
            {view === "history"
              ? "合并历史 · 撤销会恢复原件并删除产物（可撤销）"
              : groups
                ? `${totals.groups} 组疑似 · 涉及 ${totals.skills} 个技能 · 选一个分组开始处理`
                : stage === "scan"
                  ? "正在扫描技能库…"
                  : "正在比对内容…"}
          </span>
          {view === "pending" && selectedGroup && (
            <span className="text-[12.5px] text-text-tertiary">当前：{selectedGroup.members[0]?.name} ×{selectedGroup.members.length}</span>
          )}
        </div>
      </footer>

      <ConfirmDialog
        open={pendingResolve !== null}
        onOpenChange={(o) => !o && !resolveBusy && setPendingResolve(null)}
        title={pendingResolve ? `保留「${pendingResolve.keep.name}」，处置其余 ${pendingResolve.remove.length} 个？` : ""}
        description={
          pendingResolve
            ? pendingResolve.kind === "identical"
              ? `这些副本内容全等，处置不会丢失内容。\n其余 ${pendingResolve.remove.length} 个将先完整备份到 merge-backups，再移入回收站（可恢复）。`
              : `同名但内容可能有差异：其余 ${pendingResolve.remove.length} 个的独有内容将只保留备份。\n若其中含有你想保留的内容，建议改用「逐个对比合并」。\n确认后它们将备份进 merge-backups 并移入回收站（可恢复）。`
            : ""
        }
        confirmText={resolveBusy ? "处置中…" : "备份并处置"}
        variant="destructive"
        loading={resolveBusy}
        onConfirm={confirmResolveMany}
      />
    </div>
  );
}
