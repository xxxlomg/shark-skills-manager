import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/common/Tip";
import type { AuthoringResultKind } from "@/lib/creation-state";

interface FileArtifactPreviewProps {
  fileName: string;
  kind: AuthoringResultKind;
  content: string;
  pending: boolean;
  onClose: () => void;
}

/** Read-only viewer for a file result selected from the creation chat. */
export function FileArtifactPreview({
  fileName,
  kind,
  content,
  pending,
  onClose,
}: FileArtifactPreviewProps) {
  return (
    <section
      className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-md border border-border/50 bg-card"
      aria-label={`${fileName}只读预览`}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <FileText className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-semibold text-text-primary" title={fileName}>
            {fileName}
          </h2>
          <p className="truncate text-[10px] text-text-tertiary">
            {kind === "body" ? "Skill 正文" : "附带文件"} · {pending ? "待确认，只读预览" : "只读预览"}
          </p>
        </div>
        <Tip side="left" label="关闭文件预览">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-text-tertiary hover:text-text-primary"
            onClick={onClose}
            aria-label="关闭文件预览"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      </header>
      <pre className="min-h-0 min-w-0 max-w-full flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-[1.7] text-text-secondary [overflow-wrap:anywhere]">
        {content || "（文件内容为空）"}
      </pre>
    </section>
  );
}
