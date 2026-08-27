import { useEffect, useState } from "react";
import { ListTree, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { scanSkillsTree } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ScanTreeDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 技能库层级结构树（扫描可视化）：还原扫描根 → 技能单元/技能包 → 子技能 → 资源文件及类型。 */
export function ScanTreeDialog({ open, onClose }: ScanTreeDialogProps) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setText(await scanSkillsTree());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // open 变化时重新扫描，避免缓存旧结构
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制层级结构");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[820px] border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTree className="h-4 w-4" />
            技能库层级结构
          </DialogTitle>
          <DialogDescription>
            扫描根 → 技能单元 / 技能包 → 子技能 → 资源文件及类型，与磁盘真实结构逐一对应。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] overflow-auto rounded-md border border-border/60 bg-black/40 p-3">
          {loading && !text ? (
            <p className="py-8 text-center text-[12px] text-text-tertiary">
              正在扫描…
            </p>
          ) : (
            <pre className="whitespace-pre font-mono text-[12px] leading-relaxed text-text-secondary">
              {error ?? text}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button size="sm" onClick={copy} disabled={!text}>
            复制
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}