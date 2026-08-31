/**
 * 附件提案对话框（B3，从 AuthoringWorkbench 拆出）。
 * 按正文声明与规范结构生成「真实可用」附件；勾选 → 批量生成 → 随保存落盘。
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AttachProposalDialogProps {
  open: boolean;
  /** 生成中禁止关闭（onOpenChange(false) 被拦截）；由父组件处理 busy 语义 */
  onOpenChange: (open: boolean) => void;
  candidates: string[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  busy: string | null;
  onGenerate: () => void;
}

export function AttachProposalDialog({
  open,
  onOpenChange,
  candidates,
  selected,
  onToggle,
  busy,
  onGenerate,
}: AttachProposalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle>生成技能附件</DialogTitle>
        </DialogHeader>
        <p className="p-1 text-xs leading-relaxed text-muted-foreground">
          按正文声明与 shark-skill-creator
          规范结构，生成「真实可用」的附件内容（不再占位）。保存技能时随
          SKILL.md 一并写盘。
        </p>
        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto px-1">
          {candidates.map((p) => {
            const checked = selected.has(p);
            return (
              <label
                key={p}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-glass-1"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!!busy}
                  onChange={() => onToggle(p)}
                />
                <span className="font-mono text-text-secondary">{p}</span>
                {busy === p && (
                  <span className="text-[10px] text-text-tertiary">生成中…</span>
                )}
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() => onOpenChange(false)}
          >
            跳过
          </Button>
          <Button
            size="sm"
            disabled={!!busy || selected.size === 0}
            onClick={onGenerate}
          >
            {busy ? "生成中…" : `生成已选（${selected.size}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}