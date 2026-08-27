import { useState, useEffect, useCallback } from "react";
import {
  Key,
  Globe,
  Cpu,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Wifi,
  FolderOpen,
  Plus,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Palette,
  Check,
  Settings2,
  Link2,
  Store,
  GitBranch,
  PanelTop,
  PanelLeft,
} from "lucide-react";
import { toast } from "sonner";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { isMockMode } from "@/mock";
import { toolDisplayName } from "@/hooks/useSkills";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/common/Tip";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  loadLLMConfig,
  saveLLMConfig,
  LLM_DEFAULTS,
} from "@/lib/llm-config";
import {
  hubListTools,
  hubAddTool,
  hubUpdateTool,
  hubRemoveTool,
  probeToolDir,
} from "@/lib/api";
import type { ToolInfo, ToolDirProbe } from "@/lib/api";
import {
  repoSetup,
  savePublishRepo,
  gitStatus,
  setDownloadDir,
} from "@/lib/api";
import type { GitStatusInfo } from "@/lib/api";
import { invoke } from "@tauri-apps/api/core";
import type { MaskedConfig } from "@/lib/api";
import { testLLMConnection } from "@/lib/ai";
import { ACCENTS, getAccent, setAccent, type AccentId } from "@/lib/accent";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存成功后的回调（用于主界面刷新列表） */
  onSaved?: () => void;
  /** PLAN-10 P2：全局布局切换（顶栏 / 侧栏） */
  navMode?: "top" | "sidebar";
  onNavModeChange?: (mode: "top" | "sidebar") => void;
}

type Section = "llm" | "tools" | "repo" | "appearance";

const SECTIONS: { id: Section; label: string; icon: typeof Key; hint: string }[] = [
  { id: "llm", label: "LLM 配置", icon: Key, hint: "翻译服务的密钥与端点" },
  { id: "tools", label: "工具", icon: FolderOpen, hint: "扫描来源与引用落点" },
  { id: "repo", label: "技能仓库", icon: Store, hint: "发布用的本地仓库与远端（凭据走你自己的 git）" },
  { id: "appearance", label: "外观", icon: Palette, hint: "界面主题色" },
];

export function SettingsDialog({ open, onOpenChange, onSaved, navMode, onNavModeChange }: SettingsDialogProps) {
  // 当前分区（sidebar 导航）
  const [section, setSection] = useState<Section>("llm");

  // LLM 配置
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(LLM_DEFAULTS.baseUrl);
  const [model, setModel] = useState(LLM_DEFAULTS.model);
  const [showKey, setShowKey] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [testing, setTesting] = useState(false);

  // 工具管理（PLAN-06 §2.6：注册表 + 自定义，即时保存）
  const [tools, setTools] = useState<ToolInfo[]>([]);
  // 工具包导入（文件选择器交互）：选中目录后自动探测 skills 子文件夹
  const [probe, setProbe] = useState<ToolDirProbe | null>(null);
  const [probeError, setProbeError] = useState("");
  const [probeBusy, setProbeBusy] = useState(false);
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);
  // mock 模式降级入口：无系统选择器，改由手动输入路径触发探测
  const [mockDir, setMockDir] = useState("");
  const [loaded, setLoaded] = useState(false);
  // 删除确认（link_count > 0 时提示「一并移除记录」）
  const [removing, setRemoving] = useState<ToolInfo | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // 主题色预设
  const [accent, setAccentState] = useState<AccentId>(() => getAccent());

  // 技能仓库（模块 A 发布侧，§1.3）
  const [repoLocalPath, setRepoLocalPath] = useState("");
  const [repoRemoteUrl, setRepoRemoteUrl] = useState("");
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoStatus, setRepoStatus] = useState<GitStatusInfo | null>(null);
  // P5 下载/导入目录
  const [downloadDir, setDownloadDirState] = useState("");
  const [downloadDirSaving, setDownloadDirSaving] = useState(false);

  // 加载配置
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    const loadMasked = (): Promise<MaskedConfig> => {
      if (isMockMode()) {
        return Promise.resolve({
          llm: { api_key: "", base_url: LLM_DEFAULTS.baseUrl, model: LLM_DEFAULTS.model },
          _has_key: false,
          publish_repo: {
            local_path: "D:\\mock\\my-skill-repo",
            remote_url: "https://github.com/mock/my-skill-repo.git",
          },
          download_dir: "D:\\mock\\skills",
          ai_hint_dismissed: false,
        });
      }
      return invoke<MaskedConfig>("load_config");
    };
    Promise.all([loadLLMConfig(), hubListTools(), loadMasked()])
      .then(([config, toolList, masked]) => {
        if (config.hasKey) {
          setApiKey(config.apiKey);
          setHasExisting(true);
        } else {
          setApiKey("");
          setHasExisting(false);
        }
        setBaseUrl(config.baseUrl || LLM_DEFAULTS.baseUrl);
        setModel(config.model || LLM_DEFAULTS.model);
        setTools(toolList);
        setRepoLocalPath(masked.publish_repo?.local_path ?? "");
        setRepoRemoteUrl(masked.publish_repo?.remote_url ?? "");
        setDownloadDirState(masked.download_dir ?? "");
        if (masked.publish_repo) {
          gitStatus().then(setRepoStatus).catch(() => setRepoStatus(null));
        } else {
          setRepoStatus(null);
        }
      })
      .catch(() => {
        toast.error("加载配置失败");
      })
      .finally(() => setLoaded(true));
    setShowKey(false);
    setProbe(null);
    setProbeError("");
    setImportName("");
    setMockDir("");
  }, [open]);

  const handleSave = useCallback(async () => {
    if (!loaded) {
      toast.error("配置尚未加载完成，请稍候");
      return;
    }
    try {
      await saveLLMConfig({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || LLM_DEFAULTS.baseUrl,
        model: model.trim() || LLM_DEFAULTS.model,
      });
      setHasExisting(true);
      toast.success("配置已保存");
      onOpenChange(false);
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg}`);
    }
  }, [apiKey, baseUrl, model, onOpenChange, onSaved, loaded]);

  const handleClear = useCallback(async () => {
    try {
      await saveLLMConfig({
        apiKey: "",
        baseUrl: LLM_DEFAULTS.baseUrl,
        model: LLM_DEFAULTS.model,
      });
      setApiKey("");
      setBaseUrl(LLM_DEFAULTS.baseUrl);
      setModel(LLM_DEFAULTS.model);
      setHasExisting(false);
      toast.success("LLM 配置已清除");
    } catch {
      toast.error("清除失败");
    }
  }, []);

  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) {
      toast.error("请先填写 API Key");
      return;
    }
    setTesting(true);
    try {
      await testLLMConnection({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || LLM_DEFAULTS.baseUrl,
        model: model.trim() || LLM_DEFAULTS.model,
      });
      toast.success("连接成功，API 可用");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`连接失败：${msg}`);
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseUrl, model]);

  // ---- 工具管理操作（全部即时保存，不经底部「保存」按钮）----

  const refreshTools = useCallback(async () => {
    setTools(await hubListTools());
  }, []);

  const handleToggleTool = useCallback(
    async (tool: ToolInfo) => {
      try {
        await hubUpdateTool({ id: tool.id, enabled: !tool.enabled });
        await refreshTools();
        toast.success(!tool.enabled ? `已启用 ${tool.name}` : `已禁用 ${tool.name}`);
        onSaved?.();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`操作失败：${msg}`);
      }
    },
    [refreshTools, onSaved],
  );

  // ---- 工具包导入（文件选择器交互）：选目录 → 自动探测 skills → 有效才可导入 ----

  const runProbe = useCallback(async (dir: string) => {
    setProbeBusy(true);
    setProbeError("");
    setProbe(null);
    try {
      const p = await probeToolDir(dir);
      setProbe(p);
      setImportName(p.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setProbeError(msg);
    } finally {
      setProbeBusy(false);
    }
  }, []);

  const handlePickToolDir = useCallback(async () => {
    if (isMockMode()) {
      toast.info("Mock 模式不支持文件选择，请直接输入路径");
      return;
    }
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked === "string") await runProbe(picked);
    } catch {
      /* 用户取消 */
    }
  }, [runProbe]);

  // mock 模式降级入口：输入路径后手动触发探测
  const handleMockDetect = useCallback(async () => {
    await runProbe(mockDir);
  }, [mockDir, runProbe]);

  const handleImportTool = useCallback(async () => {
    if (!probe?.has_skills) return;
    setImporting(true);
    try {
      const t = await hubAddTool({
        name: importName.trim(),
        paths: [probe.skills_path],
      });
      toast.success(`已导入工具 ${t.name}`);
      setProbe(null);
      setProbeError("");
      setImportName("");
      setMockDir("");
      await refreshTools();
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`导入失败：${msg}`);
    } finally {
      setImporting(false);
    }
  }, [probe, importName, refreshTools, onSaved]);

  const handleConfirmRemove = useCallback(async () => {
    if (!removing) return;
    setRemoveLoading(true);
    try {
      // link_count > 0 → 确认框已说明将一并移除记录，force=true
      await hubRemoveTool({ id: removing.id, force: removing.link_count > 0 });
      toast.success(`已删除工具 ${removing.name}`);
      setRemoving(null);
      await refreshTools();
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`删除失败：${msg}`);
    } finally {
      setRemoveLoading(false);
    }
  }, [removing, refreshTools, onSaved]);

  // ---- 技能仓库操作（模块 A 发布侧，§1.3/§1.11）----

  const handleRepoPick = useCallback(async () => {
    if (isMockMode()) {
      toast.info("Mock 模式不支持选择文件夹，请直接输入路径");
      return;
    }
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked === "string") setRepoLocalPath(picked);
    } catch {
      /* 用户取消 */
    }
  }, []);

  const handleRepoSetup = useCallback(
    async (initIfMissing: boolean) => {
      const localPath = repoLocalPath.trim();
      const remoteUrl = repoRemoteUrl.trim();
      if (!localPath || !remoteUrl) {
        toast.error("请填写本地路径与远端 URL");
        return;
      }
      setRepoBusy(true);
      try {
        await repoSetup({ localPath, remoteUrl, initIfMissing });
        await savePublishRepo(localPath, remoteUrl);
        const status = await gitStatus();
        setRepoStatus(status);
        toast.success(
          initIfMissing ? "仓库已初始化并保存配置" : "仓库校验通过，配置已保存"
        );
        onSaved?.();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`仓库设置失败：${msg}`);
      } finally {
        setRepoBusy(false);
      }
    },
    [repoLocalPath, repoRemoteUrl, onSaved],
  );

  const handleRepoClear = useCallback(async () => {
    try {
      await savePublishRepo("", "");
      setRepoLocalPath("");
      setRepoRemoteUrl("");
      setRepoStatus(null);
      toast.success("仓库配置已清除");
      onSaved?.();
    } catch {
      toast.error("清除失败");
    }
  }, [onSaved]);

  // ---- P5 下载/导入目录 ----

  const handleDownloadDirPick = useCallback(async () => {
    if (isMockMode()) {
      toast.info("Mock 模式不支持选择文件夹，请直接输入路径");
      return;
    }
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked === "string") setDownloadDirState(picked);
    } catch {
      /* 用户取消 */
    }
  }, []);

  const handleSaveDownloadDir = useCallback(async () => {
    setDownloadDirSaving(true);
    try {
      await setDownloadDir(downloadDir.trim());
      toast.success(downloadDir.trim() ? "下载/导入目录已保存" : "已恢复默认下载目录");
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg}`);
    } finally {
      setDownloadDirSaving(false);
    }
  }, [downloadDir, onSaved]);

  const handleResetDownloadDir = useCallback(async () => {
    setDownloadDirState("");
    setDownloadDirSaving(true);
    try {
      await setDownloadDir("");
      toast.success("已恢复默认下载目录");
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`操作失败：${msg}`);
    } finally {
      setDownloadDirSaving(false);
    }
  }, [onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(660px,88vh)] w-[min(880px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-stroke px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-text-primary">
            <Settings2 className="h-4 w-4 text-brand" />
            设置
          </DialogTitle>
          <DialogDescription>
            配置 LLM API 密钥、工具注册表与外观。
          </DialogDescription>
        </DialogHeader>

        {/* 主体：左侧 sidebar 导航 + 右侧内容区 */}
        <div className="flex min-h-0 flex-1">
          <nav className="w-40 shrink-0 space-y-1 overflow-y-auto border-r border-stroke p-3">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-brand/10 font-medium text-brand ring-1 ring-brand/40"
                      : "text-text-secondary hover:bg-glass-2 hover:text-text-primary"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {s.label}
                </button>
              );
            })}
            <p className="px-3 pt-2 text-[11px] leading-relaxed text-text-tertiary">
              {SECTIONS.find((s) => s.id === section)?.hint}
            </p>
          </nav>

          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
            {/* LLM 配置 */}
            {section === "llm" && (
              <>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Key className="h-3.5 w-3.5" />
                    API Key
                  </label>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Globe className="h-3.5 w-3.5" />
                    Base URL
                  </label>
                  <Input
                    type="text"
                    placeholder={LLM_DEFAULTS.baseUrl}
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Cpu className="h-3.5 w-3.5" />
                    Model
                    <span className="text-xs text-muted-foreground font-normal">
                      （可选）
                    </span>
                  </label>
                  <Input
                    type="text"
                    placeholder={LLM_DEFAULTS.model}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testing}
                    className="text-xs"
                  >
                    <Wifi className="mr-1 h-3 w-3" />
                    {testing ? "测试中..." : "测试连接"}
                  </Button>
                  <div className="flex-1" />
                  {hasExisting && (
                    <Button
                      variant="outline"
                      onClick={handleClear}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <p className="text-[11px] text-text-tertiary">
                  💡「测试连接」仅校验配置，需点底部「保存配置」后对翻译生效。
                </p>

                <p className="text-xs text-muted-foreground">
                  ⚠️ API Key 仅保存在本机配置文件，不会上传到任何外部服务。
                </p>
              </>
            )}

            {/* 工具管理 */}
            {section === "tools" && (
              <>
                <p className="text-xs text-muted-foreground">
                  工具即扫描来源，也是 Hub 引用落点。内置工具只能启用/禁用；自定义工具可增删。改动即时保存。
                </p>

                {/* 工具列表 */}
                <div className="space-y-2">
                  {tools.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      暂无工具
                    </p>
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
                            onClick={() => handleToggleTool(t)}
                            className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
                          >
                            {t.enabled ? (
                              <ToggleRight className="h-[26px] w-[26px] text-green-500" />
                            ) : (
                              <ToggleLeft className="h-[26px] w-[26px]" />
                            )}
                          </button>
                        </Tip>
                        <div className="flex-1 min-w-0">
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
                            <p className="text-xs text-muted-foreground mt-0.5">
                              路径由应用管理（{t.id === "builtin" ? "内置技能" : "导入安装的技能"}）
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
                                      t.path_exists[i]
                                        ? "bg-green-500"
                                        : "bg-stroke-hi"
                                    }`}
                                  />
                                  <span className="truncate">{p}</span>
                                </p>
                              ))}
                            </div>
                          )}
                          {!t.app_owned && !existsAny && (
                            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5">
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
                            onClick={() => setRemoving(t)}
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
                    选择包含 skills 子文件夹的文件夹，应用将自动识别为有效工具包并登记为自定义工具。
                  </p>

                  {isMockMode() ? (
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="输入工具包路径，如 D:\vault\my-tool\skills"
                        value={mockDir}
                        onChange={(e) => setMockDir(e.target.value)}
                        className="text-xs"
                        disabled={probeBusy || importing}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMockDetect}
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
                      onClick={handlePickToolDir}
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
                        onChange={(e) => setImportName(e.target.value)}
                        className="text-xs"
                        disabled={importing}
                      />
                      <Button
                        size="sm"
                        onClick={handleImportTool}
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
                  <p className="text-xs font-medium text-muted-foreground">
                    下载/导入路径
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    URL 下载、Pack 安装、zip/目录导入的技能存放目录。留空使用默认。
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="D:\skills-downloads （留空 = 默认）"
                      value={downloadDir}
                      onChange={(e) => setDownloadDirState(e.target.value)}
                      className="text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadDirPick}
                      className="shrink-0"
                    >
                      选择…
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveDownloadDir}
                      disabled={downloadDirSaving || !loaded}
                    >
                      {downloadDirSaving ? "保存中…" : "保存路径"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleResetDownloadDir}
                      disabled={downloadDirSaving || !loaded}
                      className="text-text-tertiary"
                    >
                      恢复默认
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* 技能仓库（模块 A 发布侧） */}
            {section === "repo" && (
              <>
                <p className="text-xs text-muted-foreground">
                  发布 Pack 到你的「技能货架」仓库。凭据完全走你自己的 git 配置
                  （SSH / credential manager），App 不碰任何凭据。
                </p>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <FolderOpen className="h-3.5 w-3.5" />
                    本地仓库路径
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="D:\my-skill-repo"
                      value={repoLocalPath}
                      onChange={(e) => setRepoLocalPath(e.target.value)}
                    />
                    <Tip label="选择文件夹">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRepoPick}
                        className="shrink-0 px-2.5"
                        aria-label="选择文件夹"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </Tip>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <GitBranch className="h-3.5 w-3.5" />
                    远端 URL
                  </label>
                  <Input
                    type="text"
                    placeholder="https://github.com/you/my-skill-repo.git（仓库须已存在）"
                    value={repoRemoteUrl}
                    onChange={(e) => setRepoRemoteUrl(e.target.value)}
                  />
                  <p className="text-[11px] text-text-tertiary">
                    App 不代建远程仓库：先去 GitHub/Gitee 建一个空仓库，把 URL 贴进来。
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleRepoSetup(true)}
                    disabled={repoBusy || !loaded}
                  >
                    {repoBusy ? "处理中…" : "初始化新仓库"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRepoSetup(false)}
                    disabled={repoBusy || !loaded}
                  >
                    校验已有仓库
                  </Button>
                  {repoStatus?.repo_configured && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRepoClear}
                      disabled={repoBusy}
                      className="ml-auto text-text-tertiary"
                    >
                      清除配置
                    </Button>
                  )}
                </div>

                {repoStatus?.repo_configured && (
                  <div className="rounded-lg border border-stroke bg-glass-1 p-3 text-xs text-text-secondary space-y-1">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <Store className="h-3.5 w-3.5 text-brand" />
                      当前仓库状态
                    </p>
                    {repoStatus.repo_exists ? (
                      <>
                        <p>
                          分支 <span className="font-mono">{repoStatus.branch}</span>
                          {" · "}
                          <span className="font-mono">
                            {repoStatus.clean ? "工作区干净" : "有未提交改动"}
                          </span>
                          {repoStatus.ahead > 0 && ` · 领先远端 ${repoStatus.ahead} 个提交`}
                          {repoStatus.behind > 0 && ` · 落后远端 ${repoStatus.behind} 个提交`}
                        </p>
                        <p className="text-text-tertiary font-mono break-all">
                          {repoStatus.repo_path}
                        </p>
                      </>
                    ) : (
                      <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        配置的路径不存在或不是 git 仓库——点「初始化新仓库」修复
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* 外观 */}
            {section === "appearance" && (
              <>
                <p className="text-xs text-muted-foreground">
                  界面主题色，点击立即生效并自动保存。
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAccent(a.id);
                        setAccentState(a.id);
                      }}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors ${
                        accent === a.id
                          ? "border-stroke-hi bg-glass-2"
                          : "border-border hover:border-stroke-hi"
                      }`}
                    >
                      <span className="flex shrink-0 -space-x-1.5">
                        <span
                          className="h-4 w-4 rounded-full ring-1 ring-black/20"
                          style={{ background: a.dark }}
                        />
                        <span
                          className="h-4 w-4 rounded-full ring-1 ring-white/40"
                          style={{ background: a.light }}
                        />
                      </span>
                      <span className="text-sm text-foreground">{a.name}</span>
                      {accent === a.id && (
                        <Check className="ml-auto h-4 w-4 text-[var(--accent)]" />
                      )}
                    </button>
                  ))}
                </div>

                {/* PLAN-10 P2：全局布局切换（立即生效并自动保存） */}
                <div className="space-y-1.5 border-t border-stroke pt-3">
                  <p className="text-sm font-medium text-foreground">
                    导航布局
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    侧栏模式在左侧常驻主视图菜单与技能库目录树，深层级技能查看时可直达任意层级。
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: "top", label: "顶栏", icon: PanelTop },
                        { id: "sidebar", label: "侧栏", icon: PanelLeft },
                      ] as const
                    ).map((opt) => {
                      const Icon = opt.icon;
                      const active = (navMode ?? "top") === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onNavModeChange?.(opt.id)}
                          className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
                            active
                              ? "border-stroke-hi bg-glass-2 text-foreground"
                              : "border-border text-text-secondary hover:border-stroke-hi hover:text-text-primary"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {opt.label}
                          {active && (
                            <Check className="ml-auto h-4 w-4 text-[var(--accent)]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 保存按钮（仅 LLM；工具改动即时保存） */}
        <div className="flex shrink-0 justify-end border-t border-stroke px-5 py-4">
          <Button
            onClick={handleSave}
            className="w-full"
            disabled={!loaded}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {loaded ? "保存配置" : "加载配置中…"}
          </Button>
        </div>

        {/* 删除自定义工具确认 */}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`删除工具「${removing?.name ?? ""}」`}
          description={
            removing && removing.link_count > 0
              ? `该工具名下还有 ${removing.link_count} 条引用记录。\n删除后这些记录将一并从台账移除（磁盘上的落点目录不会被删除，但不再被纳管）。`
              : "删除后该工具的目录将不再被扫描。\n此操作不可撤销。"
          }
          confirmText={
            removing && removing.link_count > 0 ? "删除并移除记录" : "删除"
          }
          variant="destructive"
          loading={removeLoading}
          onConfirm={handleConfirmRemove}
        />
      </DialogContent>
    </Dialog>
  );
}
