import type { ReactNode } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuthoringResultKind } from "@/lib/creation-state";

interface AuthoringFileCardProps {
  fileName: string;
  kind: AuthoringResultKind;
  status: "generating" | "pending" | "applied";
  onOpen?: () => void;
  children?: ReactNode;
}

/** Compact reference to a generated file; the file contents stay in the editor pane. */
export function AuthoringFileCard({
  fileName,
  kind,
  status,
  onOpen,
  children,
}: AuthoringFileCardProps) {
  const statusLabel =
    status === "generating"
      ? "生成中"
      : status === "applied"
        ? "已确认"
        : "待确认";

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-card text-sm text-foreground shadow-sm">
      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button
              type="button"
              className="block max-w-full truncate text-left text-[13px] font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title={`打开 ${fileName}`}
              onClick={onOpen}
            >
              {fileName}
            </button>
          ) : (
            <span className="block max-w-full truncate text-[13px] font-medium text-text-primary" title={fileName}>
              {fileName}
            </span>
          )}
          <p className="truncate text-[11px] text-text-tertiary">
            {kind === "body" ? "Skill 正文" : "附带文件"} · {statusLabel}
          </p>
        </div>
        {onOpen && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 gap-1 text-text-secondary hover:text-text-primary"
            onClick={onOpen}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            打开
          </Button>
        )}
      </div>
      {children && (
        <div className="min-w-0 max-w-full overflow-hidden border-t border-border/40 px-3 py-2">
          {children}
        </div>
      )}
    </div>
  );
}
