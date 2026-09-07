import { useState, useEffect, useCallback } from "react";
import {
  Key,
  Globe,
  Cpu,
  Brain,
  Gauge,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Wifi,
  FolderOpen,
  Palette,
  Settings2,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { isMockMode } from "@/mock";
import { ToolsSection } from "./ToolsSection";
import { RepoSection } from "./RepoSection";
import { AppearanceSection } from "./AppearanceSection";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  loadLLMConfig,
  saveLLMConfig,
  LLM_DEFAULTS,
} from "@/lib/llm-config";
import type { ThinkingMode, ReasoningEffort } from "@/lib/llm-config";
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
import { getAccent, setAccent, type AccentId } from "@/lib/accent";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存成功后的回调（用于主界面刷新列表） */
  onSaved?: () => void;
  /** P2：全局布局切换（顶栏 / 侧栏） */
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
  const [thinking, setThinking] = useState<ThinkingMode>(LLM_DEFAULTS.thinking);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(LLM_DEFAULTS.reasoningEffort);
  const [showKey, setShowKey] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [testing, setTesting] = useState(false);

  // 工具管理（注册表 + 自定义，即时保存）
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

  // 技能仓库（模块 A 发布侧）
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
          llm: {
            api_key: "",
            base_url: LLM_DEFAULTS.baseUrl,
            model: LLM_DEFAULTS.model,
            thinking: "disabled",
            reasoning_effort: "low",
          },
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
        setThinking(config.thinking);
        setReasoningEffort(config.reasoningEffort);
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
        thinking,
        reasoningEffort,
      });
      setHasExisting(true);
      toast.success("配置已保存");
      onOpenChange(false);
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg}`);
    }
  }, [apiKey, baseUrl, model, thinking, reasoningEffort, onOpenChange, onSaved, loaded]);

  const handleClear = useCallback(async () => {
    try {
      await saveLLMConfig({
        apiKey: "",
        baseUrl: LLM_DEFAULTS.baseUrl,
        model: LLM_DEFAULTS.model,
        thinking: LLM_DEFAULTS.thinking,
        reasoningEffort: LLM_DEFAULTS.reasoningEffort,
      });
      setApiKey("");
      setBaseUrl(LLM_DEFAULTS.baseUrl);
      setModel(LLM_DEFAULTS.model);
      setThinking(LLM_DEFAULTS.thinking);
      setReasoningEffort(LLM_DEFAULTS.reasoningEffort);
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
        thinking,
        reasoningEffort,
      });
      toast.success("连接成功，API 可用");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`连接失败：${msg}`);
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseUrl, model, thinking, reasoningEffort]);

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

  // ---- 技能仓库操作（模块 A 发布侧）----

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

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Brain className="h-3.5 w-3.5" />
                    思考模式
                  </label>
                  <Select value={thinking} onValueChange={(v) => setThinking(v as ThinkingMode)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">关闭（默认）</SelectItem>
                      <SelectItem value="enabled">开启</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Gauge className="h-3.5 w-3.5" />
                    思考强度
                    {thinking !== "enabled" && (
                      <span className="text-xs text-muted-foreground font-normal">
                        （需先开启思考模式）
                      </span>
                    )}
                  </label>
                  <Select
                    value={reasoningEffort}
                    onValueChange={(v) => setReasoningEffort(v as ReasoningEffort)}
                    disabled={thinking !== "enabled"}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">低（默认）</SelectItem>
                      <SelectItem value="high">中</SelectItem>
                      <SelectItem value="max">高</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-[11px] text-text-tertiary">
                  💡 思考模式与强度仅对 DeepSeek 端点生效；其他端点会自动忽略这两个参数。
                </p>

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
              <ToolsSection
              tools={tools}
              loaded={loaded}
              onToggle={handleToggleTool}
              onRemove={setRemoving}
              probe={probe}
              probeError={probeError}
              probeBusy={probeBusy}
              importName={importName}
              onImportNameChange={setImportName}
              importing={importing}
              mockDir={mockDir}
              onMockDirChange={setMockDir}
              onPickDir={handlePickToolDir}
              onMockDetect={handleMockDetect}
              onImport={handleImportTool}
              downloadDir={downloadDir}
              onDownloadDirChange={setDownloadDirState}
              downloadDirSaving={downloadDirSaving}
              onPickDownloadDir={handleDownloadDirPick}
              onSaveDownloadDir={handleSaveDownloadDir}
              onResetDownloadDir={handleResetDownloadDir}
            />
            )}

            {/* 技能仓库（模块 A 发布侧） */}
            {section === "repo" && (
              <RepoSection
              loaded={loaded}
              repoLocalPath={repoLocalPath}
              onRepoLocalPathChange={setRepoLocalPath}
              repoRemoteUrl={repoRemoteUrl}
              onRepoRemoteUrlChange={setRepoRemoteUrl}
              repoBusy={repoBusy}
              repoStatus={repoStatus}
              onPick={handleRepoPick}
              onSetup={handleRepoSetup}
              onClear={handleRepoClear}
            />
            )}

            {/* 外观 */}
            {section === "appearance" && (
              <AppearanceSection
              accent={accent}
              onAccentChange={(a) => {
                setAccent(a);
                setAccentState(a);
              }}
              navMode={navMode}
              onNavModeChange={onNavModeChange}
            />
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
