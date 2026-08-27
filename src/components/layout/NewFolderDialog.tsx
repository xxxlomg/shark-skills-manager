import { useEffect, useState } from "react";
import { FolderPlus, FolderOpen, Loader2 } from "lucide-react";
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
import { addFolderRoot } from "@/lib/api";
import { isMockMode } from "@/mock/mode";
import { winPath } from "@/lib/path";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 创建成功回调：label=新工具根名（最外层，无父级） */
  onCreated: (label: string) => void;
}

/**
 * 新建文件夹 —— 只在技能库主页使用，仅创建「最外层」扫描根。
 * 让用户自己用 Windows 目录选择器挑一个全新目录即可，不再嵌套子文件夹逻辑。
 * 路径是唯一判定标准：重复路径由后端 add_folder_root 拒绝。
 */
export function NewFolderDialog({ open, onClose, onCreated }: Props) {
  const [rootPath, setRootPath] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setRootPath("");
      setBusy(false);
    }
  }, [open]);

  const pickDir = async () => {
    if (isMockMode()) {
      toast.info("mock 模式：请直接输入路径");
      return;
    }
    try {
      const { open: openDlg } = await import("@tauri-apps/plugin-dialog");
      const dir = await openDlg({ directory: true, multiple: false });
      if (typeof dir === "string" && dir) setRootPath(winPath(dir));
    } catch (e) {
      toast.error(`打开目录选择器失败：${String(e)}`);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const p = rootPath.trim();
      if (!p) throw new Error("请选择或输入一个目录");
      await addFolderRoot(p);
      const label = p.split(/[\\/]/).filter(Boolean).pop() || "skills";
      toast.success(`已添加新位置：${winPath(p)}`);
      onCreated(label);
      onClose();
    } catch (e) {
      toast.error(`新建失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-primary" />
            新建文件夹
          </DialogTitle>
          <DialogDescription>
            选择一个全新目录作为技能库位置（最外层扫描根）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            选择目录（Windows 文件夹选择）*
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="例：D:\MySkills"
              className="h-9 flex-1 font-mono text-[12px]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={pickDir}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              浏览
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !rootPath.trim()}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}