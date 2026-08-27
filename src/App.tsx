import { Fragment, useState, useCallback, useMemo, useEffect } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isMockMode } from "@/mock/mode";
import { Toaster } from "@/components/ui/sonner";
import { BackgroundFX } from "@/components/layout/BackgroundFX";
import { Topbar } from "@/components/layout/Topbar";
import { TabNav } from "@/components/layout/TabNav";
import { Sidebar } from "@/components/layout/Sidebar";
import type { StatsData, ToolStat } from "@/components/layout/StatsCard";
import { NewFolderDialog } from "@/components/layout/NewFolderDialog";
import { DEFAULT_VIEW, type ViewId } from "@/lib/view-registry";
import { LinkDialog } from "@/components/hub/LinkDialog";
import { HubView } from "@/components/hub/HubView";
import { Footer } from "@/components/layout/Footer";
import { HomeView } from "@/components/skill/HomeView";
import { AllSkillsView } from "@/components/skill/AllSkillsView";
import { CategoryView } from "@/components/skill/CategoryView";
import { PacksView } from "@/components/skill/PacksView";
import { PackCreateDialog } from "@/components/skill/PackCreateDialog";
import { CreationView } from "@/components/skill/CreationView";
import { AuthoringWorkbench } from "@/components/skill/AuthoringWorkbench";
import { DupWorkbench } from "@/components/skill/DupWorkbench";
import { MergeWorkbench } from "@/components/skill/MergeWorkbench";
import { MultiMergeWorkbench } from "@/components/skill/MultiMergeWorkbench";
import { ManualPage } from "@/components/manual/ManualPage";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { PackAction } from "@/components/skill/PackCard";
import { DetailSheet } from "@/components/skill/DetailSheet";
import { ScanTreeDialog } from "@/components/skill/ScanTreeDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { CommandSearch } from "@/components/common/CommandSearch";
import { ImportDialog } from "@/components/skill/ImportDialog";
import { UrlImportDialog } from "@/components/skill/UrlImportDialog";
import { RepoBrowseDialog } from "@/components/skill/RepoBrowseDialog";
import {
  packDelete,
  packExport,
  packRename,
  packsList,
  gitStatus,
  publishPack,
  hubLinksStatus,
  scanLibraryTree,
  type DupGroup,
  type DupMember,
  type GitStatusInfo,
  type ImportSource,
  type LibraryTreeRoot,
  type LinkStatus,
  type PackInfo,
  type RepoImportResult,
} from "@/lib/api";
import { InstallDialog } from "@/components/skill/InstallDialog";
import { EmptyState } from "@/components/common/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSkills, breadcrumbSegments, type Skill, type LayoutMode } from "@/hooks/useSkills";
import { useCreatedFolders } from "@/hooks/useCreatedFolders";
import { useTags } from "@/hooks/useTags";
import { useSummaries } from "@/hooks/useSummaries";

declare global {
  interface Window {
    hideSplash?: () => void;
  }
}

type NavMode = "top" | "sidebar";

type View = { type: "home" } | { type: "category"; label: string; path?: string[] } | { type: "all" };

function readLayout(): LayoutMode {
  try {
    const v = localStorage.getItem("sm:layout");
    if (v === "list" || v === "grid") return v;
  } catch { /* ignore */ }
  return "grid";
}

function readNavMode(): NavMode {
  try {
    const v = localStorage.getItem("sm:navmode");
    if (v === "top" || v === "sidebar") return v;
  } catch { /* ignore */ }
  return "top";
}

function App() {
  const { skills, groups, loading, error, sync, refresh } = useSkills();
  const { folders, addFolder } = useCreatedFolders();
  // PLAN-13：标签（T）与用途速览（S）状态提升到 App，跨视图共享
  const tagsApi = useTags();
  const summariesApi = useSummaries();

  const [tab, setTab] = useState<ViewId>(DEFAULT_VIEW);
  const [view, setView] = useState<View>({ type: "home" });
  // PLAN-10 P1：使用手册白皮书面（全屏覆盖层，右上角「关于」菜单进入）
  const [manualOpen, setManualOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(readLayout);
  // PLAN-10 P2：全局布局切换（顶栏 ↔ 侧栏），持久化 sm:navmode
  const [navMode, setNavMode] = useState<NavMode>(readNavMode);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scanTreeOpen, setScanTreeOpen] = useState(false);

  // PLAN-19：技能库文件管理器目录树缓存（App 层持有，进程内构建一次，手动刷新时重建）
  const [libraryTree, setLibraryTree] = useState<LibraryTreeRoot[] | null>(null);
  const loadLibraryTree = useCallback(async (force = false) => {
    try {
      setLibraryTree(await scanLibraryTree(force));
    } catch (e) {
      console.error("scan_library_tree failed:", e);
      setLibraryTree([]);
    }
  }, []);
  useEffect(() => {
    loadLibraryTree();
  }, [loadLibraryTree]);

  // 模块 A 发布侧：git/仓库健康度（发布按钮使能依据，§1.11）
  const [gitInfo, setGitInfo] = useState<GitStatusInfo | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const refreshGitInfo = useCallback(() => {
    gitStatus().then(setGitInfo).catch(() => setGitInfo(null));
  }, []);
  useEffect(() => {
    refreshGitInfo();
  }, [refreshGitInfo]);

  const handleLayoutChange = useCallback((mode: LayoutMode) => {
    setLayout(mode);
    try { localStorage.setItem("sm:layout", mode); } catch { /* ignore */ }
  }, []);

  const handleNavModeChange = useCallback((mode: NavMode) => {
    setNavMode(mode);
    try { localStorage.setItem("sm:navmode", mode); } catch { /* ignore */ }
  }, []);

  const handleFolderClick = useCallback((label: string) => {
    setView({ type: "category", label });
  }, []);

  // PLAN-10 P2：侧栏目录树节点直达（工具 / 合集）；合集带 path 段定位
  const handleOpenCollection = useCallback(
    (label: string, path: string[] | null) => {
      setTab("lib");
      setView({ type: "category", label, path: path ?? undefined });
    },
    []
  );

  const handleBack = useCallback(() => {
    setView({ type: "home" });
  }, []);

  // PLAN-14：进入「全部技能」扁平视图
  const handleAllSkills = useCallback(() => {
    setTab("lib");
    setView({ type: "all" });
  }, []);

  // 层级返回：在下钻目录内 → 回上一级；已在工具根 → 回技能库
  const handleBackLevel = useCallback(() => {
    setView((v) => {
      if (v.type !== "category") return { type: "home" };
      if (v.path && v.path.length > 0) {
        return { type: "category", label: v.label, path: v.path.slice(0, -1) };
      }
      return { type: "home" };
    });
  }, []);

  const handleSkillClick = useCallback((skill: Skill) => {
    setSelectedSkill(skill);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await sync();
      await loadLibraryTree(true); // 同步后重建目录树缓存
    } finally {
      setSyncing(false);
    }
  }, [sync, loadLibraryTree]);

  // Skill Packs（PLAN-05 P1：真实数据）
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [packDialogOpen, setPackDialogOpen] = useState(false);
  // 从技能库批量勾选打包时携入的预选技能 id（null = 无预选，如 Packs 页「新建 Pack」）
  const [packInitialIds, setPackInitialIds] = useState<string[] | null>(null);
  // 技能库页头（HomeView/CategoryView）左上角「新建文件夹」按钮 → App 级弹窗。
  // parentLabel 由当前视图推导：home→null（全新路径模式）；分类→当前工具/合集。
  const [libFolderDialogOpen, setLibFolderDialogOpen] = useState(false);
  // PLAN-07：工作台沉浸态 → 隐藏 StatBar/TabNav；工作台状态提升到 App（避免侧栏布局壳
  // 切换导致 CreationView 卸载重挂、丢失工作台状态）
  const [wbActive, setWbActive] = useState(false);
  // PLAN-13 M 阶段 2：查重面板 + 对比/合并工作台（沉浸态同创作台模式，状态在 App 层）
  const [dupOpen, setDupOpen] = useState(false);
  const [dupPair, setDupPair] = useState<{
    a: DupMember;
    b: DupMember;
    group: DupGroup;
  } | null>(null);
  // PLAN-15 阶段 4：N 路合并工作台（全页，替代原 MultiMergeDialog 弹窗）
  const [multiMerge, setMultiMerge] = useState<{
    group: DupGroup;
    baseId: string;
  } | null>(null);
  // 查重工作台返回定位：记住用户选中的分组，进出对比页不丢失
  const [dupSelectedId, setDupSelectedId] = useState<string | null>(null);
  const [wbSkill, setWbSkill] = useState<Skill | null>(null);
  // 新建态落点预选（从技能库「在当前目录下创作」进入时带上工具名）
  const [wbInitialLocation, setWbInitialLocation] = useState<string | null>(
    null,
  );
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PackInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [installTarget, setInstallTarget] = useState<PackInfo | null>(null);
  const [renameTarget, setRenameTarget] = useState<PackInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const loadPacks = useCallback(async () => {
    try {
      setPacks(await packsList());
    } catch (e) {
      console.error("packs_list failed:", e);
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // ---- 导入（PLAN-04 §3：zip 本地 + URL 远程）----
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);

  // ---- Hub 引用（PLAN-06 §2.8，B5）：新建引用对话框由 App 统一持有，
  // Hub 页与技能详情页共用同一实例 ----
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialSkillId, setLinkInitialSkillId] = useState<string | null>(null);

  const openLinkDialog = useCallback((skillId?: string) => {
    setLinkInitialSkillId(skillId ?? null);
    setLinkDialogOpen(true);
  }, []);

  const closeLinkDialog = useCallback(() => {
    setLinkDialogOpen(false);
    setLinkInitialSkillId(null);
  }, []);

  // 建链成功后联动刷新：技能扫描 + Hub 台账令牌（修复台账不自动刷新）
  const [hubToken, setHubToken] = useState(0);

  // ===== 引用健康监控（原 Hub 页能力收编） =====
  const [linkStatuses, setLinkStatuses] = useState<LinkStatus[]>([]);
  const refreshLinkStatuses = useCallback(() => {
    hubLinksStatus().then(setLinkStatuses).catch(() => setLinkStatuses([]));
  }, []);
  useEffect(() => {
    refreshLinkStatuses();
  }, [refreshLinkStatuses, hubToken]);

  const abnormalLinkCount = useMemo(
    () => linkStatuses.filter((s) => s.health !== "normal").length,
    [linkStatuses]
  );

  const handleLinked = useCallback(() => {
    refresh();
    setHubToken((t) => t + 1);
    loadLibraryTree(true); // 建链/删技能等磁盘变动后重建目录树
  }, [refresh, loadLibraryTree]);

  // 设置页工具管理改动（启停/增删/删带引用工具）同样要刷 Hub 台账与目录树缓存
  const handleSettingsSaved = useCallback(() => {
    refresh();
    setHubToken((t) => t + 1);
    refreshGitInfo(); // 仓库配置可能在设置页变更
    loadLibraryTree(true); // 扫描路径可能变更，强制重建目录树缓存
  }, [refresh, refreshGitInfo, loadLibraryTree]);

  const handleGitImport = useCallback(() => {
    setUrlDialogOpen(true);
  }, []);

  // 技能库「在当前目录下创作」：新建态 + 落点预选为当前选中工具
  const handleCreateIn = useCallback((target: string | null) => {
    setTab("create");
    setWbSkill(null);
    setWbInitialLocation(target);
    setWbActive(true);
  }, []);

  // 编辑存量技能：关闭详情，打开工作台编辑态
  const handleEditSkill = useCallback((skill: Skill) => {
    setModalOpen(false);
    setTab("create");
    setWbInitialLocation(null);
    setWbSkill(skill);
    setWbActive(true);
  }, []);

  // 创作工作台开关（状态在 App 层 —— 侧栏布局壳切换时 CreationView 会卸载重挂，
  // 若由 CreationView 自持则工作台状态会丢失；提升到 App 后稳定保持）
  const openWorkbench = useCallback((skill: Skill | null) => {
    setWbSkill(skill);
    setWbActive(true);
  }, []);
  const closeWorkbench = useCallback(() => {
    setWbActive(false);
    setWbSkill(null);
    refresh();
    loadLibraryTree(true); // 创作/编辑落盘后重建目录树
  }, [refresh, loadLibraryTree]);

  // 拖拽 zip / skillpack 到窗口任意位置 → 打开导入对话框
  useEffect(() => {
    // 无 tauri 环境（vite dev / mock 预览）下 listen 会因缺少 __TAURI_INTERNALS__
    // 同步抛错而中止整个 commit，导致应用挂载失败——先短路跳过。
    if (isMockMode()) return;
    let unlisten: (() => void) | undefined;
    listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      const file = e.payload.paths.find((p) => {
        const lp = p.toLowerCase();
        return lp.endsWith(".zip") || lp.endsWith(".skillpack");
      });
      if (file) setImportSource({ kind: "zip", path: file });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const handleZipImport = useCallback(async () => {
    const file = await open({
      multiple: false,
      filters: [
        { name: "技能包", extensions: ["zip", "skillpack"] },
      ],
    });
    if (typeof file === "string") setImportSource({ kind: "zip", path: file });
  }, []);

  const handleImported = useCallback(
    (stem: string) => {
      toast.success(`已导入到「${stem}」库`);
      refresh();
      loadLibraryTree(true); // 导入落盘后重建目录树
      setTab("lib");
      setView({ type: "category", label: "导入" });
    },
    [refresh, loadLibraryTree]
  );

  const handleCreatePack = useCallback(() => {
    setPackInitialIds(null);
    setPackDialogOpen(true);
  }, []);

  // 技能库批量勾选 → 打包：携已勾选技能 id 打开 PackCreateDialog 并预选
  const handlePackSelected = useCallback((selSkills: Skill[]) => {
    setPackInitialIds(selSkills.map((s) => s.id));
    setPackDialogOpen(true);
  }, []);

  const handleImportPack = useCallback(() => {
    // 与 zip 导入同入口：后端按 pack.json 自动分流（PLAN-05 §3）
    handleZipImport();
  }, [handleZipImport]);

  const handleRepoImport = useCallback(() => {
    setRepoDialogOpen(true);
  }, []);

  const handleRepoImported = useCallback(
    (result: RepoImportResult) => {
      const ok = result.imported.length;
      const fail = result.failed.length;
      if (fail === 0) {
        toast.success(`已从货架导入 ${ok} 个 Pack`);
      } else {
        toast.warning(`导入完成：${ok} 成功 / ${fail} 失败`);
      }
      loadPacks();
      setTab("packs");
    },
    [loadPacks]
  );

  const handlePackImported = useCallback(
    (info: PackInfo) => {
      toast.success(`Pack「${info.name}」已导入`);
      loadPacks();
      setTab("packs");
    },
    [loadPacks]
  );

  const handlePackAction = useCallback(
    async (action: PackAction, pack: PackInfo) => {
      if (action === "install") {
        setInstallTarget(pack);
        return;
      }
      if (action === "export") {
        try {
          const dest = await save({
            defaultPath: `${pack.name.replace(/[\\/:*?"<>|]/g, "-")}.skillpack`,
            filters: [{ name: "Skill Pack", extensions: ["skillpack"] }],
          });
          if (!dest) return;
          const size = await packExport(pack.id, dest);
          const mb = size / 1024 / 1024;
          toast.success(`已导出（${mb < 0.1 ? "<0.1" : mb.toFixed(1)} MB）`);
          if (size > 50 * 1024 * 1024) {
            toast.warning("导出文件超过 50MB，分享时注意体积");
          }
        } catch (e) {
          toast.error(`导出失败：${String(e)}`);
        }
        return;
      }
      if (action === "publish") {
        setPublishingId(pack.id);
        try {
          const r = await publishPack({ packId: pack.id });
          toast.success(
            r.rebase_retried
              ? `已发布（远端有新提交，自动 rebase 后推送成功）：${r.pack_path}`
              : `已发布到仓库：${r.pack_path}`
          );
          if (r.repo_url) {
            toast.info(`仓库地址：${r.repo_url}`, { duration: 6000 });
          }
          refreshGitInfo();
        } catch (e) {
          toast.error(`发布失败：${String(e)}`, { duration: 8000 });
          refreshGitInfo();
        } finally {
          setPublishingId(null);
        }
        return;
      }
      if (action === "delete") {
        setDeleteTarget(pack);
      }
      if (action === "rename") {
        setRenameTarget(pack);
        setRenameValue(pack.name);
      }
    },
    [refresh, refreshGitInfo]
  );

  // 发布按钮禁用原因（§1.9 降级立场：不静默失败，明确引导）
  const publishDisabledReason = useMemo(() => {
    if (!gitInfo) return "正在检测 git 环境…";
    if (!gitInfo.installed)
      return "未检测到系统 git——请安装 git，或改用「导出」后自行上传";
    if (!gitInfo.repo_configured)
      return "请先在设置 →「技能仓库」配置本地仓库与远端";
    if (!gitInfo.repo_exists)
      return "配置的仓库路径无效——请在设置中重新初始化";
    if (!gitInfo.clean) return "仓库有未提交改动，请先处理再发布";
    return undefined;
  }, [gitInfo]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await packDelete(deleteTarget.id);
      toast.success(`Pack「${deleteTarget.name}」已删除`);
      setDeleteTarget(null);
      loadPacks();
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, loadPacks]);

  const handleConfirmRename = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      toast.error("名称不能为空");
      return;
    }
    if (name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      const updated = await packRename(renameTarget.id, name);
      toast.success(`Pack「${updated.name}」已重命名`);
      setRenameTarget(null);
      loadPacks();
    } catch (e) {
      toast.error(`重命名失败：${String(e)}`);
    } finally {
      setRenaming(false);
    }
  }, [renameTarget, renameValue, loadPacks]);

  const totalSkills = useMemo(
    () => groups.reduce((sum, g) => sum + g.skills.length, 0),
    [groups]
  );

  const translatedCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.skills.filter((s) => s.has_translation).length, 0),
    [groups]
  );

  const lostCount = useMemo(
    () => skills.filter((s) => s.translation_lost).length,
    [skills]
  );

  // 按工具统计（顶栏悬停卡 / 侧栏底部菜单的「工具数据」）
  const toolStats = useMemo<ToolStat[]>(
    () =>
      groups
        .map((g) => ({
          label: g.label,
          total: g.skills.length,
          translated: g.skills.filter((s) => s.has_translation).length,
          lost: g.skills.filter((s) => s.translation_lost).length,
        }))
        .sort((a, b) => b.total - a.total),
    [groups]
  );

  const stats: StatsData = useMemo(
    () => ({
      total: totalSkills,
      translated: translatedCount,
      lost: lostCount,
      packCount: packs.length,
      tools: toolStats,
      abnormalLinks: abnormalLinkCount,
    }),
    [totalSkills, translatedCount, lostCount, packs.length, toolStats, abnormalLinkCount]
  );

  // 首屏加载结束 → 淡出启动蒙版
  useEffect(() => {
    if (!loading) window.hideSplash?.();
  }, [loading]);

  // 兜底：无论加载是否完成，4s 后强制移除蒙版，防止卡死白屏
  useEffect(() => {
    const t = setTimeout(() => window.hideSplash?.(), 4000);
    return () => clearTimeout(t);
  }, []);

  // 全局 Ctrl/Cmd + K 唤起搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 当前分类的 skills
  const currentGroup = useMemo(() => {
    if (view.type !== "category") return null;
    return groups.find((g) => g.label === view.label) ?? null;
  }, [view, groups]);

  // 技能 id → Skill（侧栏目录树技能节点渲染/打开详情用；全量 skills 覆盖 libraryTree 所有 skill_id）
  const skillsById = useMemo(
    () => new Map(skills.map((s) => [s.id, s])),
    [skills]
  );

  // 抽屉 skill 用列表里的 live 对象：翻译完成 sync 后 title_zh/description_zh
  // 立即生效，不用关抽屉重开。列表里找不到（源被删等）回退快照。
  const liveSelectedSkill = useMemo(() => {
    if (!selectedSkill) return null;
    return skills.find((s) => s.id === selectedSkill.id) ?? selectedSkill;
  }, [skills, selectedSkill]);

  // PLAN-10 P2：侧栏仅在「非沉浸态 + 侧栏模式」下渲染
  const sidebarShown = navMode === "sidebar";

  // ===== 视图分发（顶栏 / 侧栏两种布局共用，抽成变量避免重复）=====
  const viewDispatch = (
    <div key={tab} className="animate-view-enter">
      {tab === "packs" ? (
        <PacksView
          packs={packs}
          onCreatePack={handleCreatePack}
          onImportPack={handleImportPack}
          onRepoImport={handleRepoImport}
          onPackAction={handlePackAction}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          publishDisabledReason={publishDisabledReason}
          publishingId={publishingId}
        />
      ) : tab === "hub" ? (
        /* Hub 引用平铺管理页（B5 恢复 Tab；引用数据独立于技能扫描，不受 error/loading 阻塞） */
        <HubView
          skills={skills}
          onSkillsRefresh={refresh}
          refreshToken={hubToken}
        />
      ) : tab === "create" ? (
        <CreationView
          skills={skills}
          refresh={refresh}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          onOpenWorkbench={openWorkbench}
        />
      ) : error ? (
        <EmptyState hasError errorMessage={error} />
      ) : loading ? (
        <div className="grid gap-5 pt-8 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-6">
              <div className="mb-3 h-1 w-full animate-pulse rounded bg-glass-2" />
              <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-glass-2" />
              <div className="mb-4 h-3 w-1/2 animate-pulse rounded bg-glass-2" />
              <div className="h-3 w-full animate-pulse rounded bg-glass-2" />
              <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-glass-2" />
            </div>
          ))}
        </div>
      ) : view.type === "all" ? (
        /* PLAN-14：全部技能扁平视图（批量打标） */
        <AllSkillsView
          skills={skills}
          onSkillClick={handleSkillClick}
          tagsApi={tagsApi}
          onPackSelected={handlePackSelected}
          onSkillsRefresh={handleLinked}
        />
      ) : view.type === "home" ? (
        <HomeView
          groups={groups}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          onFolderClick={handleFolderClick}
          onSkillClick={handleSkillClick}
          onGitImport={handleGitImport}
          onZipImport={handleZipImport}
          onNewFolder={() => setLibFolderDialogOpen(true)}
          onDupCheck={() => setDupOpen(true)}
          onAllSkills={handleAllSkills}
          onScanTree={() => setScanTreeOpen(true)}
          extraFolderLabels={folders
            .filter((f) => f.collection === null)
            .map((f) => f.label)}
        />
      ) : (
        // 空文件夹（新建后 0 技能、扫描 groups 里不存在）也要进 CategoryView：
        // 保留返回 / 标题 / 创作 / 布局切换头部，skills 兜底空数组。
        <CategoryView
          key={view.label}
          label={view.label}
          skills={currentGroup?.skills ?? []}
          tree={libraryTree ?? []}
          path={view.path ?? []}
          onPathChange={(p) =>
            setView((v) =>
              v.type === "category" && v.label === view.label
                ? { ...v, path: p }
                : v,
            )
          }
          layout={layout}
          onLayoutChange={handleLayoutChange}
          onSkillClick={handleSkillClick}
          onCreateIn={handleCreateIn}
          onSettingsOpen={() => setSettingsOpen(true)}
          onTranslateDone={handleSync}
          tagsApi={tagsApi}
          onPackSelected={handlePackSelected}
          onSkillsRefresh={handleLinked}
        />
      )}
    </div>
  );

  // 单行导航栏：返回按钮 + 面包屑同行（返回按钮在前，面包屑文字在后）。
  // 仅在技能库 tab 且位于分类/全部视图时显示；返回按钮交互不变（分类逐级返回，全部=回技能库）。
  const breadcrumb =
    tab === "lib" && view.type === "category" ? (
      <nav className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-4" aria-label="面包屑">
        <button
          type="button"
          onClick={handleBackLevel}
          className="back-btn"
          style={{ marginBottom: 0 }}
        >
          <ArrowLeft className="h-[15px] w-[15px]" />
          {view.path && view.path.length > 0 ? "返回上一级" : "返回技能库"}
        </button>
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
          <button
            type="button"
            onClick={handleBack}
            className="transition-colors hover:text-text-primary"
          >
            技能库
          </button>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <button
            type="button"
            onClick={() => handleFolderClick(view.label)}
            className="truncate transition-colors hover:text-text-primary"
          >
            {view.label}
          </button>
          {breadcrumbSegments(view.path ?? []).map(({ name, endIndex }, i, arr) => {
            const isLast = i === arr.length - 1;
            return (
              <Fragment key={`${endIndex}:${name}`}>
                <ChevronRight className="h-3 w-3 shrink-0" />
                {isLast ? (
                  <span className="truncate text-text-secondary">{name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setView({
                        type: "category",
                        label: view.label,
                        path: (view.path ?? []).slice(0, endIndex + 1),
                      })
                    }
                    className="truncate transition-colors hover:text-text-primary"
                  >
                    {name}
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
      </nav>
    ) : tab === "lib" && view.type === "all" ? (
      <nav className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-4" aria-label="面包屑">
        <button
          type="button"
          onClick={handleBack}
          className="back-btn"
          style={{ marginBottom: 0 }}
        >
          <ArrowLeft className="h-[15px] w-[15px]" />
          返回技能库
        </button>
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
          <button
            type="button"
            onClick={handleBack}
            className="transition-colors hover:text-text-primary"
          >
            技能库
          </button>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="truncate text-text-secondary">全部技能</span>
        </div>
      </nav>
    ) : null;

  return (
    <>
      <BackgroundFX />

      {/* PLAN-10 侧栏重构：创作工作台沉浸态 → 整页渲染（侧栏/顶栏布局均让位）。
          状态在 App 层，避免侧栏布局壳切换导致 CreationView 卸载重挂、工作台丢失 */}
      {wbActive ? (
        <main className="workbench-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex min-h-0 w-full flex-1 flex-col px-5 lg:px-6">
            <AuthoringWorkbench
              key={`${wbSkill?.id ?? "new"}:${wbInitialLocation ?? ""}`}
              skill={wbSkill}
              skills={skills}
              initialLocation={wbInitialLocation}
              refresh={refresh}
              onOpenSettings={() => setSettingsOpen(true)}
              onExit={closeWorkbench}
            />
          </div>
        </main>
      ) : multiMerge ? (
        /* PLAN-15 阶段 4：N 路合并工作台（10+ 同名技能，全页沉浸态） */
        <main className="workbench-canvas flex h-screen min-h-0 flex-col overflow-hidden">
          <div className="mx-auto flex w-full min-h-0 flex-1 flex-col px-[26px]">
            <MultiMergeWorkbench
              group={multiMerge.group}
              baseId={multiMerge.baseId}
              onBack={() => {
                setMultiMerge(null);
                setDupOpen(true);
              }}
              onResolved={async () => {
                setMultiMerge(null);
                await refresh();
                setDupOpen(true);
              }}
            />
          </div>
        </main>
      ) : dupPair ? (
        /* PLAN-13 M 阶段 2：对比/合并工作台沉浸态（同创作台模式）
           PLAN-15 §2：固定视口工作台壳 —— 页面不滚，仅内容视口滚，footer 常驻可见 */
        <main className="workbench-canvas flex h-screen min-h-0 flex-col overflow-hidden">
          <div className="mx-auto flex w-full min-h-0 flex-1 flex-col px-[26px]">
            <MergeWorkbench
              a={dupPair.a}
              b={dupPair.b}
              group={dupPair.group}
              onBack={() => {
                setDupPair(null);
                setDupOpen(true);
              }}
              onResolved={async () => {
                setDupPair(null);
                await refresh();
                setDupOpen(true);
              }}
              onMerge={(g, baseId) => {
                setDupPair(null);
                setMultiMerge({ group: g, baseId });
              }}
            />
          </div>
        </main>
      ) : dupOpen ? (
        /* PLAN-16 阶段 6：查重工作台（主从式全页，替代原弹窗） */
        <main className="workbench-canvas flex h-screen min-h-0 flex-col overflow-hidden">
          <div className="mx-auto flex w-full min-h-0 flex-1 flex-col px-[26px]">
            <DupWorkbench
              onBack={() => setDupOpen(false)}
              initialSelectedId={dupSelectedId}
              onSelectId={setDupSelectedId}
              onCompare={(a, b, group) => {
                setDupOpen(false);
                setDupPair({ a, b, group });
              }}
              onMultiMerge={(group, baseId) => {
                setDupOpen(false);
                setMultiMerge({ group, baseId });
              }}
              onChanged={refresh}
            />
          </div>
        </main>
      ) : (
        <>
      {/* PLAN-10 侧栏重构：仅顶栏模式渲染全局 Topbar；侧栏模式其功能已收编进 Sidebar */}
      {navMode === "top" && (
        <Topbar
          stats={stats}
          syncing={syncing}
          onSearchClick={() => setCmdkOpen(true)}
          onSync={handleSync}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenManual={() => setManualOpen(true)}
        />
      )}

      {/* ===== PLAN-10 侧栏重构：布局壳 =====
          侧栏模式：全高两栏，页面不滚，侧栏树区与主内容区各自独立滚动；
                    顶栏功能（品牌/搜索/工具集/页脚）已收编进 Sidebar。
          顶栏模式：Topbar + 页面级滚动 + Footer（原有行为）。
          工作台沉浸态（wbActive）：全宽、无 Topbar/Sidebar/Footer。 */}
      {sidebarShown ? (
        <div className="flex h-screen overflow-hidden">
          <Sidebar
            activeTab={tab}
            onChangeTab={setTab}
            tree={libraryTree ?? []}
            skillsById={skillsById}
            currentLabel={view.type === "category" ? view.label : null}
            currentPath={
              view.type === "category" ? view.path ?? null : null
            }
            selectedSkillId={liveSelectedSkill?.id ?? null}
            onOpenCollection={handleOpenCollection}
            onOpenSkill={handleSkillClick}
            syncing={syncing}
            onSync={handleSync}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenManual={() => setManualOpen(true)}
          />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1180px] px-[26px] pb-16">
              {breadcrumb}
              {viewDispatch}
            </div>
          </main>
        </div>
      ) : (
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1180px] px-[26px] pb-20">
            {navMode === "top" && (
              <TabNav activeTab={tab} onChange={setTab} />
            )}

            {navMode === "top" && breadcrumb}

            {viewDispatch}
          </div>
        </main>
      )}

      {navMode === "top" && <Footer />}
        </>
      )}

      {/* PLAN-10 P1：使用手册白皮书面（全屏覆盖层） */}
      {manualOpen && <ManualPage onClose={() => setManualOpen(false)} />}

      <DetailSheet
        skill={liveSelectedSkill}
        open={modalOpen}
        onClose={handleCloseModal}
        onSettingsOpen={() => setSettingsOpen(true)}
        onTranslateDone={handleSync}
        onLinkSkill={(s) => openLinkDialog(s.id)}
        onEdit={handleEditSkill}
        tagsApi={tagsApi}
        summariesApi={summariesApi}
      />

      <ScanTreeDialog open={scanTreeOpen} onClose={() => setScanTreeOpen(false)} />

      {linkDialogOpen && (
        <LinkDialog
          skills={skills}
          initialSkillId={linkInitialSkillId}
          onClose={closeLinkDialog}
          onLinked={handleLinked}
        />
      )}

      <NewFolderDialog
        open={libFolderDialogOpen}
        onClose={() => setLibFolderDialogOpen(false)}
        onCreated={(label) => {
          addFolder(label, null);
          refresh();
          loadLibraryTree(true); // 新建扫描根后重建目录树（侧栏树 / 主视图即时可见）
        }}
      />

      {urlDialogOpen && (
        <UrlImportDialog
          onClose={() => setUrlDialogOpen(false)}
          onReady={(s) => setImportSource(s)}
        />
      )}

      {repoDialogOpen && (
        <RepoBrowseDialog
          onClose={() => setRepoDialogOpen(false)}
          onImported={handleRepoImported}
        />
      )}

      {importSource && (
        <ImportDialog
          source={importSource}
          onClose={() => setImportSource(null)}
          onImported={handleImported}
          onPackImported={handlePackImported}
        />
      )}

      {packDialogOpen && (
        <PackCreateDialog
          skills={skills}
          initialSelectedIds={packInitialIds ?? undefined}
          onClose={() => {
            setPackDialogOpen(false);
            setPackInitialIds(null);
          }}
          onCreated={(info) => {
            toast.success(`Pack「${info.name}」已创建`);
            loadPacks();
            setTab("packs");
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}
        title="删除 Pack"
        description={`确定删除「${deleteTarget?.name ?? ""}」吗？\n只移除 Packs 库中的记录，已导出的 .skillpack 文件不受影响。`}
        confirmText="删除"
        variant="destructive"
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />

      <InstallDialog
        open={!!installTarget}
        onOpenChange={(o) => !o && setInstallTarget(null)}
        pack={
          installTarget ?? {
            id: "",
            name: "",
            ver: "",
            author: "",
            created_at: "",
            skill_count: 0,
            translated: 0,
            overview: "",
            summary_source: "static",
            skill_names: [],
          }
        }
        onInstalled={async () => {
          setInstallTarget(null);
          await refresh();
          await loadLibraryTree(true);
        }}
      />

      <Dialog
        open={!!renameTarget}
        onOpenChange={(o) => !o && !renaming && setRenameTarget(null)}
      >
        <DialogContent className="border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>修改 Pack 名称</DialogTitle>
            <DialogDescription>
              将「{renameTarget?.name ?? ""}」重命名，包内技能与版本不受影响。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="输入新的名称"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !renaming && renameValue.trim()) {
                handleConfirmRename();
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={renaming}
              onClick={() => setRenameTarget(null)}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={!renameValue.trim() || renaming}
              onClick={handleConfirmRename}
            >
              {renaming ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={handleSettingsSaved}
        navMode={navMode}
        onNavModeChange={handleNavModeChange}
      />

      <CommandSearch
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        groups={groups}
        onSkillSelect={(skill) => {
          setSelectedSkill(skill);
          setModalOpen(true);
        }}
        onCategorySelect={(label) => {
          setTab("lib");
          setView({ type: "category", label });
        }}
        onGitImport={() => setUrlDialogOpen(true)}
        onCreatePack={() => setPackDialogOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Toaster position="top-center" />
    </>
  );
}

export default App;
