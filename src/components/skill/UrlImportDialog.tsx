import { useState } from "react";
import { AlertTriangle, GitBranch, Loader2 } from "lucide-react";
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
import { previewUrlImport, type ImportSource } from "@/lib/api";

interface UrlImportDialogProps {
  onClose: () => void;
  onReady: (source: ImportSource) => void;
}

export function UrlImportDialog({ onClose, onReady }: UrlImportDialogProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await previewUrlImport(url);
      if (!p.token) {
        setError("后端未返回解析凭证，请重试");
        return;
      }
      onReady({ kind: "url", url, token: p.token, preload: p });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            从 Git 仓库导入
          </DialogTitle>
          <DialogDescription>
            支持 GitHub / Gitee 仓库地址或直链 zip；优先下载归档，git 兜底
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !busy) handleSubmit();
            }}
            className="h-9"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!url.trim() || busy}
            onClick={handleSubmit}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "解析中…" : "解析"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
