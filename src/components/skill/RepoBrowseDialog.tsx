import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Package,
  Store,
} from "lucide-react";
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
import {
  repoBrowse,
  repoImportCommit,
  type RepoImportResult,
  type ShelfPreview,
} from "@/lib/api";

interface RepoBrowseDialogProps {
  onClose: () => void;
  /** 导入完成后刷新 Packs 列表 */
  onImported: (result: RepoImportResult) => void;
}

type Stage = "url" | "shelf" | "done";

/**
 * 从技能仓库导入（模块 A；PLAN-06 §1.4）。
 * 与技能库页「从 Git 仓库导入」（裸技能）语义不同：本对话框导入 .skillpack 货架，进 Packs 库。
 */
export function RepoBrowseDialog({ onClose, onImported }: RepoBrowseDialogProps) {
  const [stage, setStage] = useState<Stage>("url");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shelf, setShelf] = useState<ShelfPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<RepoImportResult | null>(null);

  const handleBrowse = async () => {
    setBusy(true);
    setError("");
    try {
      const preview = await repoBrowse(url);
      setShelf(preview);
      setSelected(new Set(preview.packs.map((p) => p.path)));
      setStage("shelf");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!shelf || selected.size === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await repoImportCommit({
        token: shelf.token,
        selected: Array.from(selected),
      });
      setResult(res);
      setStage("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const sourceLabel = shelf?.source.startsWith("archive")
    ? "archive 降级通道（无 git）"
    : shelf?.source.endsWith("+scan")
      ? "目录扫描（无 index.json）"
      : "index.json 货架清单";

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (o || busy) return;
        if (stage === "done" && result) onImported(result);
        onClose();
      }}
    >
      <DialogContent className="max-w-lg border-border/60 bg-card">
        {stage === "url" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                从技能仓库导入
              </DialogTitle>
              <DialogDescription>
                导入 .skillpack 货架到 Packs 库；浅克隆仓库，支持 https / ssh
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Input
                autoFocus
                placeholder="https://github.com/owner/skill-repo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim() && !busy) handleBrowse();
                }}
                className="h-9"
              />
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">{error}</span>
                </div>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                提示：无 git 环境时自动降级为归档下载（仅支持 GitHub / Gitee
                公开仓库的默认分支）；私有仓库需要本机 git 与访问权限。
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                取消
              </Button>
              <Button size="sm" disabled={!url.trim() || busy} onClick={handleBrowse}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "克隆中…（最长约 2 分钟）" : "浏览货架"}
              </Button>
            </DialogFooter>
          </>
        )}

        {stage === "shelf" && shelf && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                {shelf.repo_name || "技能货架"}
              </DialogTitle>
              <DialogDescription>
                来源：{sourceLabel} · 共 {shelf.packs.length} 个包
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {shelf.packs.map((p) => (
                <label
                  key={p.path}
                  className="glass-card flex cursor-pointer items-start gap-3 px-3.5 py-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.path)}
                    onChange={() => toggle(p.path)}
                    className="mt-1 h-4 w-4 accent-[var(--brand)]"
                  />
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-stroke bg-glass-2 text-amber">
                    <Package className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-display text-[13.5px] font-semibold text-text-primary">
                        {p.name}
                      </span>
                      <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-2 py-[2px] font-mono text-[10.5px] text-brand">
                        v{p.ver}
                      </span>
                      {p.sha256_mismatch && (
                        <span
                          className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-[2px] text-[10.5px] text-amber-600 dark:text-amber-400"
                          title="货架清单声明的 sha256 与包内容不一致（清单可能过期）"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          清单不一致
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-text-tertiary">
                      {p.summary_zh || "（无简介）"} · {p.skill_count} 个技能
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStage("url");
                  setShelf(null);
                  setError("");
                }}
                disabled={busy}
              >
                换一个仓库
              </Button>
              <Button size="sm" disabled={selected.size === 0 || busy} onClick={handleCommit}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "导入中…" : `导入 ${selected.size} 个包`}
              </Button>
            </DialogFooter>
          </>
        )}

        {stage === "done" && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                导入完成
              </DialogTitle>
              <DialogDescription>
                成功 {result.imported.length} 个
                {result.failed.length > 0 && ` · 失败 ${result.failed.length} 个`}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1 text-sm">
              {result.imported.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-text-primary">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 font-mono text-xs text-text-tertiary">v{p.ver}</span>
                </div>
              ))}
              {result.failed.map((f) => (
                <div key={f.path} className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">
                    {f.path}：{f.error}
                  </span>
                </div>
              ))}
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">{w}</span>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                size="sm"
                onClick={() => {
                  onImported(result);
                  onClose();
                }}
              >
                完成
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
