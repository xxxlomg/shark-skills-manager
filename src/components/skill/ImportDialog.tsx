import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Package, PackageOpen } from "lucide-react";
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
  commitUrlImport,
  commitZipImport,
  packImport,
  previewZipImport,
  type ImportPreview,
  type ImportSource,
  type PackInfo,
} from "@/lib/api";

interface ImportDialogProps {
  source: ImportSource;
  onClose: () => void;
  onImported: (stem: string) => void;
  onPackImported: (info: PackInfo) => void;
}

export function ImportDialog({ source, onClose, onImported, onPackImported }: ImportDialogProps) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [stem, setStem] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replace, setReplace] = useState(false);
  const [existsConflict, setExistsConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError("");
    setReplace(false);
    setExistsConflict(false);
    const apply = (p: ImportPreview) => {
      setPreview(p);
      setStem(p.default_stem);
      setSelected(new Set(p.candidates.map((c) => c.rel)));
    };
    if (source.kind === "url") {
      apply(source.preload);
    } else {
      previewZipImport(source.path)
        .then((p) => alive && apply(p))
        .catch((e) => {
          if (alive) setError(String(e));
        });
    }
    return () => {
      alive = false;
    };
  }, [source]);

  const toggle = (rel: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) {
        next.delete(rel);
      } else {
        next.add(rel);
      }
      return next;
    });
  };

  const handleCommit = async () => {
    setBusy(true);
    setError("");
    try {
      if (source.kind === "zip") {
        await commitZipImport({
          path: source.path,
          stem,
          selected: [...selected],
          replace,
        });
      } else {
        await commitUrlImport({
          token: source.token,
          stem,
          selected: [...selected],
          replace,
        });
      }
      onImported(stem);
      onClose();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("EXISTS")) {
        setExistsConflict(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  // PLAN-05：zip 内含 pack.json → 整包导入 Packs 库
  const handlePackCommit = async () => {
    if (source.kind !== "zip") return;
    setBusy(true);
    setError("");
    try {
      const info = await packImport(source.path);
      onPackImported(info);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const subtitle =
    source.kind === "zip"
      ? (source.path.split(/[\\/]/).pop() ?? source.path)
      : source.url;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-border/60 bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-primary" />
            {source.kind === "zip" ? "导入 Zip 技能包" : "导入远程技能包"}
          </DialogTitle>
          <DialogDescription className="truncate">{subtitle}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        ) : !preview ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            解析中…
          </div>
        ) : preview.pack && source.kind === "url" ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <Package className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium">检测到 Skill Pack（{preview.pack.name}）</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Pack 包暂不支持 URL 直接导入，请下载 .skillpack / .zip 文件后从本地导入。
            </p>
          </div>
        ) : preview.pack ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-8">
            <span className="grid h-14 w-14 place-items-center rounded-[16px] border border-border/60 bg-accent/30 text-primary">
              <Package className="h-7 w-7" />
            </span>
            <div className="text-center">
              <p className="text-base font-semibold">{preview.pack.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                v{preview.pack.ver}
                {preview.pack.author && ` · by ${preview.pack.author}`} ·{" "}
                {preview.pack.skill_count} 个技能
              </p>
            </div>
            <p className="max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
              这是一个 Skill Pack（含 pack.json）。将整包导入 Packs
              库，导入后可在 Packs 页选择「安装」落地到技能库。
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/50">
              <ul className="divide-y divide-border/40">
                {preview.candidates.map((c) => {
                  const on = selected.has(c.rel);
                  return (
                    <li key={c.rel || "."}>
                      <button
                        type="button"
                        onClick={() => toggle(c.rel)}
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {c.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.rel || "（zip 根目录）"}
                            {c.description && ` · ${c.description}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground">存入库名</span>
              <Input
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                className="h-8"
              />
            </div>

            {existsConflict && (
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-amber-500">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                同名库已存在，勾选后覆盖更新
              </label>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          {preview?.pack ? (
            <Button
              size="sm"
              disabled={source.kind !== "zip" || busy}
              onClick={handlePackCommit}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              导入到 Packs 库
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!preview || selected.size === 0 || !stem.trim() || busy}
              onClick={handleCommit}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              导入 {selected.size > 0 ? `${selected.size} 项` : ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
