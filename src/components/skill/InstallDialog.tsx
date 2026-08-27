import { useEffect, useMemo, useState } from "react";
import {
  Check,
  FolderCog,
  FolderOpen,
  Loader2,
  MapPin,
  Star,
  X,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  hubListTools,
  packInstallPreview,
  packInstallCommit,
  type InstallPreview,
  type PackInfo,
} from "@/lib/api";
import { isMockMode } from "@/mock/mode";
import { Tip } from "@/components/common/Tip";
import { winPath, winJoin } from "@/lib/path";

interface InstallDialogProps {
  pack: PackInfo;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInstalled: (count: number) => void;
}

/** 收藏夹 localStorage 键 */
const FAV_KEY = "sm:install-favs";

function readFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((s) => String(s)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeFavs(favs: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  } catch { /* ignore */ }
}

/** 目录根（去掉 skills 尾段）：从工具路径推出快捷入口 `~/.codex` → deploy `~/.codex/skills` */
function dirname(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : s;
}

/**
 * Pack 安装对话框（P2/P4/P10）：选目标目录（快捷入口 + 收藏夹 + 目录选择器）→
 * 落点预览 `<target>/skills` → 同名冲突覆盖/跳过确认 → 部署。
 * 兼容 mock（文本输入 + 快捷入口，无 Tauri 目录选择器）与真机（可弹系统选目录）。
 */
export function InstallDialog({
  pack,
  open,
  onOpenChange,
  onInstalled,
}: InstallDialogProps) {
  const [targetDir, setTargetDir] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [presets, setPresets] = useState<{ label: string; path: string }[]>([]);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  // P10 前一步：带冲突的目录，进入覆盖确认阶段
  const [conflictStep, setConflictStep] = useState<InstallPreview | null>(null);
  const [overwrite, setOverwrite] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTargetDir("");
    setPreview(null);
    setPreviewLoading(false);
    setInstalling(false);
    setConflictStep(null);
    setOverwrite([]);
    setFavorites(readFavs());
    hubListTools()
      .then((tools) =>
        setPresets(
          tools
            .filter((t) => !t.app_owned && t.enabled && t.paths.length > 0)
            .map((t) => {
              // 取第一个「存在」的 skills 路径的父目录作为工具根快捷入口
              const idx = t.paths.findIndex((_, i) => t.path_exists?.[i]);
              const path = idx >= 0 ? t.paths[idx] : t.paths[0];
              return { label: t.name, path: dirname(path) };
            })
        )
      )
      .catch(() => setPresets([]));
  }, [open, pack]);

  const deployRoot = useMemo(
    () => (targetDir.trim() ? winJoin(targetDir.trim(), "skills") : ""),
    [targetDir]
  );

  const isFav = favorites.includes(targetDir.trim());

  const toggleFav = () => {
    const p = targetDir.trim();
    if (!p) return;
    const next = isFav ? favorites.filter((f) => f !== p) : [...favorites, p];
    setFavorites(next);
    writeFavs(next);
  };

  const removeFav = (p: string) => {
    const next = favorites.filter((f) => f !== p);
    setFavorites(next);
    writeFavs(next);
  };

  const runPreview = async () => {
    const dir = targetDir.trim();
    if (!dir) {
      toast.error("请先选择目标目录");
      return;
    }
    setPreviewLoading(true);
    setPreview(null);
    setConflictStep(null);
    try {
      const pv = await packInstallPreview(pack.id, dir);
      setPreview(pv);
      if (pv.conflicts.length > 0) {
        // D2：有同名冲突 → 进入覆盖/跳过确认阶段
        setConflictStep(pv);
        setOverwrite([...pv.conflicts]);
      } else {
        // 无冲突 → 直接提交
        await commit([]);
      }
    } catch (e) {
      toast.error(`安装失败：${String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const commit = async (overwriteList: string[]) => {
    const dir = targetDir.trim();
    if (!dir) return;
    setInstalling(true);
    try {
      const n = await packInstallCommit(pack.id, dir, overwriteList);
      toast.success(
        conflictStep && overwriteList.length > 0
          ? `已覆盖 ${overwriteList.length} 个同名技能，新装 ${n} 个`
          : `已安装 ${n} 个技能到 ${deployRoot}`
      );
      onInstalled(n);
    } catch (e) {
      toast.error(`安装失败：${String(e)}`);
    } finally {
      setInstalling(false);
    }
  };

  const pickDirectory = async () => {
    if (isMockMode()) return;
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (dir) {
        setTargetDir(String(dir));
        setPreview(null);
        setConflictStep(null);
      }
    } catch { /* 用户取消 */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-border/60 bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            安装「{pack.name}」
          </DialogTitle>
          <DialogDescription>
            选择目标目录，部署到 {`<目标>/skills/`}（D6）
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* 目标目录 */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              目标目录 *
              <Tip label="将部署到所选目录下的 skills/ 子目录">
                <span className="cursor-help text-brand">ⓘ</span>
              </Tip>
            </div>
            <div className="flex gap-2">
              <Input
                value={winPath(targetDir)}
                onChange={(e) => {
                  setTargetDir(winPath(e.target.value));
                  setPreview(null);
                  setConflictStep(null);
                }}
                placeholder="例：C:\Users\you\.codex 或 ~\.codex"
                className="h-8 flex-1 font-mono text-[12px]"
              />
              {targetDir.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={toggleFav}
                >
                  <Star className={`h-3.5 w-3.5 ${isFav ? "fill-amber-400 text-amber-400" : ""}`} />
                  {isFav ? "已收藏" : "收藏"}
                </Button>
              )}
              {!isMockMode() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={pickDirectory}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  选择目录
                </Button>
              )}
            </div>
          </div>

          {/* 快捷入口（工具根） */}
          {presets.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">工具根快捷入口</div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => {
                      setTargetDir(winPath(p.path));
                      setPreview(null);
                      setConflictStep(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors hover:border-stroke-hi hover:bg-glass-2 ${
                      targetDir.trim() === p.path
                        ? "border-brand/60 bg-brand/10 text-brand"
                        : "border-border bg-glass text-muted-foreground"
                    }`}
                  >
                    <FolderCog className="h-3 w-3" />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 收藏夹（P10：自定义收藏） */}
          {favorites.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">我的收藏</div>
              <div className="flex flex-wrap gap-1.5">
                {favorites.map((f) => (
                  <span
                    key={f}
                    className={`group inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11.5px] ${
                      targetDir.trim() === f
                        ? "border-brand/60 bg-brand/10 text-brand"
                        : "border-border bg-glass text-muted-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setTargetDir(winPath(f));
                        setPreview(null);
                        setConflictStep(null);
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span className="max-w-[180px] truncate font-mono">{winPath(f)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="移除收藏"
                      onClick={() => removeFav(f)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 落点预览 */}
          {deployRoot && (
            <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
              将部署到：<span className="text-text-primary">{deployRoot}</span>
              {preview?.is_new_tool === false && (
                <span className="ml-2 text-brand">（命中现有工具根，归属该工具）</span>
              )}
            </div>
          )}

          {/* 覆盖确认（D2） */}
          {conflictStep && conflictStep.conflicts.length > 0 && (
            <div className="shrink-0 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                以下 {conflictStep.conflicts.length} 个同名技能已存在：
              </p>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {conflictStep.conflicts.map((f) => {
                  const on = overwrite.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() =>
                        setOverwrite((prev) =>
                          on ? prev.filter((x) => x !== f) : [...prev, f]
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                        on
                          ? "border-brand/60 bg-brand/10 text-brand"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {f}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-text-tertiary">
                勾选 = 覆盖该技能；取消勾选 = 跳过。不再自动追加 -2/-3。
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={installing}
                  onClick={() => commit([])}
                >
                  {installing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  全部跳过
                </Button>
                <Button
                  size="sm"
                  disabled={installing}
                  onClick={() => commit(overwrite)}
                >
                  {installing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  覆盖所选（{overwrite.length}）
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {!conflictStep && (
            <Button
              size="sm"
              disabled={!targetDir.trim() || previewLoading || installing}
              onClick={runPreview}
            >
              {(previewLoading || installing) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              安装
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}