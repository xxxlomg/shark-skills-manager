/**
 * 草稿恢复横幅（从 AuthoringWorkbench 拆出）。
 * 三态动作：恢复草稿 / 用磁盘内容 / 丢弃草稿；恢复逻辑（含 creationState 迁移）由父组件提供。
 */
import { Button } from "@/components/ui/button";

interface DraftRestoreBannerProps {
  savedAt: string;
  onRestore: () => void;
  onDismiss: () => void;
  onDiscard: () => void;
}

export function DraftRestoreBanner({
  savedAt,
  onRestore,
  onDismiss,
  onDiscard,
}: DraftRestoreBannerProps) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-text-secondary">
      <span>检测到未保存草稿（{savedAt} 保存）</span>
      <div className="flex-1" />
      <Button variant="secondary" size="sm" onClick={onRestore}>
        恢复草稿
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        用磁盘内容
      </Button>
      <Button variant="ghost" size="sm" className="text-red-400" onClick={onDiscard}>
        丢弃草稿
      </Button>
    </div>
  );
}