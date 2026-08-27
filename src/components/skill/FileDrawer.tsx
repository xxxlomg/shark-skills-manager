import { useEffect, useState } from "react";
import { File as FileIcon, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CodeEditor, langOf } from "./CodeEditor";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import {
  readSkillFile,
  readFileBase64,
  skillWriteFile,
  type LibTreeFile,
} from "@/lib/api";

/** 二进制判定（与 FileTree 对齐）：命中即只读，不做在线编辑。 */
const BIN_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".bin", ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pyc", ".class", ".wasm",
]);
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}
function isBinaryName(name: string): boolean {
  return BIN_EXT.has(extOf(name));
}

function splitAbs(abs: string): { dir: string; name: string } {
  const k = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
  return { dir: abs.slice(0, k), name: abs.slice(k + 1) };
}

interface FileDrawerProps {
  file: LibTreeFile | null;
  open: boolean;
  onClose: () => void;
}

/** PLAN-19：资源文件抽屉。文本可编辑保存（skill_write_file 归属闸），图片渲染，其余二进制只读。 */
export function FileDrawer({ file, open, onClose }: FileDrawerProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"text" | "image" | "binary">("text");
  const [editing, setEditing] = useState(false);

  const binary = file ? isBinaryName(file.name) : false;
  const isMd = file ? langOf(file.name) === "md" : false;

  useEffect(() => {
    if (!file || !open) return;
    setDraft("");
    setDataUrl(null);
    setEditing(false);
    const ext = extOf(file.name);
    if (IMG_EXT.has(ext)) {
      setMode("image");
      readFileBase64(file.abs_path).then(setDataUrl).catch(() => setDataUrl(null));
    } else if (binary) {
      setMode("binary");
    } else {
      setMode("text");
      readSkillFile(file.abs_path).then(setDraft).catch(() => setDraft(""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.abs_path, open]);

  const doSave = async () => {
    if (!file) return;
    const { dir, name } = splitAbs(file.abs_path);
    setSaving(true);
    try {
      await skillWriteFile(dir, name, draft);
      toast.success(`已保存 ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="glass-sheet flex w-[min(92vw,680px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]"
      >
        <div className="h-[3px] shrink-0 bg-brand" />
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke px-5 py-3">
          <FileIcon className="h-4 w-4 text-text-tertiary" />
          <SheetTitle className="truncate font-mono text-[14px] font-medium text-text-primary">
            {file?.name ?? ""}
          </SheetTitle>
          <span className="flex-1" />
          {mode === "text" && isMd && (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? "预览" : "编辑"}
            </Button>
          )}
          {mode === "text" && (editing || !isMd) && (
            <Button size="sm" disabled={saving} onClick={() => void doSave()}>
              <Save className="h-3 w-3" />
              保存
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-stroke bg-glass text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === "image" ? (
            <div className="grid h-full place-items-center overflow-auto p-5">
              {dataUrl ? (
                <img src={dataUrl} alt={file?.name ?? ""} className="max-h-full max-w-full rounded-md" />
              ) : (
                <p className="text-sm text-text-tertiary">图片加载失败</p>
              )}
            </div>
          ) : mode === "binary" ? (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-text-tertiary">
              二进制文件（压缩包 / 可执行 / 字体等），不支持在线编辑。
            </div>
          ) : isMd && !editing ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <MarkdownRenderer content={draft} />
            </div>
          ) : (
            <CodeEditor value={draft} onChange={setDraft} lang={langOf(file?.name ?? "")} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
