/**
 * 批量删除二次确认弹窗（技能库「全部技能 / 分类」两视图共用）。
 *
 * 打开时调用 skill_batch_delete_check 预检 Hub 引用分类：
 * - 无任何引用 → 「将移入回收站」（先完整备份到 merge-backups，可恢复）；
 * - 存在引用（账本出处 / copy 落点 / junction 落点）→ 「将解除引用」
 *   （不删除文件；解除后技能仍保留在库，需再次勾选删除才会进回收站——二段式删除）；
 * - 源文件已删除、仅剩译文记录（扫描器孤儿 pass 复活的幽灵条目）→
 *   「将备份并清理译文记录」，技能从列表移除，不再复活；
 * - 磁盘目录已不存在且无译文记录 → 仅刷新列表令其消失。
 * 确认后调用 skill_batch_delete_apply，按服务端返回明细反馈，成功后触发刷新 + 清空勾选。
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  skillBatchDeleteApply,
  skillBatchDeleteCheck,
  type BatchDeleteCheckItem,
} from "@/lib/api";
import type { Skill } from "@/hooks/useSkills";

interface BatchDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已勾选技能（弹窗打开时预检它们） */
  skills: Skill[];
  /** 执行成功后的刷新回调（重扫技能 + Hub 联动） */
  onDone?: () => void;
  /** 执行成功后清空勾选 */
  onCleared?: () => void;
}

export function BatchDeleteDialog({
  open,
  onOpenChange,
  skills,
  onDone,
  onCleared,
}: BatchDeleteDialogProps) {
  const [items, setItems] = useState<BatchDeleteCheckItem[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useMemo(() => skills.map((s) => s.id), [skills]);

  // 打开即预检；skills 变化（重新勾选后再次打开）也重查
  useEffect(() => {
    if (!open) {
      setItems(null);
      setCheckError(null);
      setBusy(false);
      return;
    }
    setItems(null);
    setCheckError(null);
    skillBatchDeleteCheck(ids)
      .then(setItems)
      .catch((e) => {
        setCheckError(e instanceof Error ? e.message : String(e));
        toast.error(`引用检查失败：${e instanceof Error ? e.message : String(e)}`);
      });
  }, [open, ids]);

  // 分类：回收站 / 解除引用 / 清理记录 / 跳过（真已消失且无译文记录）
  const groups = useMemo(() => {
    if (!items) return null;
    return {
      toTrash: items.filter(
        (i) =>
          !i.source_deleted &&
          !i.missing_dir &&
          i.referenced_count === 0 &&
          i.copy_targets === 0 &&
          !i.as_junction
      ),
      toUnlink: items.filter(
        (i) =>
          !i.source_deleted &&
          !i.missing_dir &&
          (i.referenced_count > 0 || i.copy_targets > 0 || i.as_junction)
      ),
      toClean: items.filter((i) => i.source_deleted && i.translation_record),
      untouchable: items.filter(
        (i) =>
          (i.missing_dir || i.source_deleted) &&
          !(i.source_deleted && i.translation_record)
      ),
    };
  }, [items]);

  const handleConfirm = async () => {
    if (busy || !groups) return;
    // 纯幽灵场景（仅磁盘已不存在、且无译文记录可清理的技能）：无需后端处置，
    // 直接刷新列表 + 清空勾选，使其从列表消失。
    const hasAction =
      groups.toTrash.length > 0 ||
      groups.toUnlink.length > 0 ||
      groups.toClean.length > 0;
    if (!hasAction) {
      onDone?.();
      onCleared?.();
      onOpenChange(false);
      toast.info("已刷新列表：磁盘上不存在的技能已被移除");
      return;
    }
    setBusy(true);
    try {
      const res = await skillBatchDeleteApply(ids);
      const parts: string[] = [];
      if (res.trashed.length > 0) parts.push(`${res.trashed.length} 个已移入回收站`);
      if (res.unlinked.length > 0) parts.push(`${res.unlinked.length} 个已解除引用`);
      if (res.cleaned.length > 0) parts.push(`${res.cleaned.length} 个已清理译文记录`);
      if (res.skipped.length > 0) parts.push(`${res.skipped.length} 个跳过`);
      if (res.errors.length > 0) parts.push(`${res.errors.length} 个失败`);
      // 无论结果如何都刷新：跳过/失败同样可能有磁盘变化，
      // 旧快照继续显示会误导（幽灵技能仍挂在列表上）。
      onDone?.();
      onCleared?.();
      if (res.errors.length > 0) {
        toast.error(
          `${parts.join("，")}。失败明细：${res.errors
            .slice(0, 3)
            .map((e) => `${e.name || e.id}（${e.reason}）`)
            .join("；")}${res.errors.length > 3 ? "…" : ""}`
        );
      } else if (parts.length > 0) {
        toast.success(parts.join("，"));
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(`批量删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // 确认按钮文案与变体：仅解除引用/清理记录用默认态；涉及回收站时用危险态；
  // 纯幽灵（全部已不存在且无记录可清）时改为「刷新列表」入口。
  const onlyTrash = (groups?.toTrash.length ?? 0) > 0 && (groups?.toUnlink.length ?? 0) === 0 && (groups?.toClean.length ?? 0) === 0;
  const onlyUnlink = (groups?.toUnlink.length ?? 0) > 0 && (groups?.toTrash.length ?? 0) === 0 && (groups?.toClean.length ?? 0) === 0;
  const onlyClean = (groups?.toClean.length ?? 0) > 0 && (groups?.toTrash.length ?? 0) === 0 && (groups?.toUnlink.length ?? 0) === 0;
  const hasAction = (groups?.toTrash.length ?? 0) > 0 || (groups?.toUnlink.length ?? 0) > 0 || (groups?.toClean.length ?? 0) > 0;
  const onlyGhosts = !!groups && !hasAction;
  const confirmText = onlyGhosts
    ? "刷新列表"
    : onlyTrash
      ? "移入回收站"
      : onlyUnlink
        ? "确认解除引用"
        : onlyClean
          ? "清理记录"
          : "确认执行";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <div className="gradient-bar -mx-6 -mt-6 mb-2 rounded-t-lg" />

        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            ⚠️ 确认删除 {skills.length} 个技能？
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            删除是不可逆操作。系统会先做 Hub 引用检查，按检查结果分类处理。
          </DialogDescription>
        </DialogHeader>

        {/* ===== 预检状态区 ===== */}
        {!items && !checkError && (
          <p className="flex items-center gap-2 py-3 text-[12px] text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在检查 Hub 引用…
          </p>
        )}
        {checkError && (
          <p className="rounded-lg border border-stroke bg-glass-2 px-3 py-2.5 text-[12px] text-text-tertiary">
            引用检查失败，无法继续：{checkError}
          </p>
        )}
        {groups && (
          <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed">
            {groups.toTrash.length > 0 && (
              <p className="text-text-secondary">
                🗑️ <span className="font-semibold text-text-primary">{groups.toTrash.length} 个技能</span>将
                <span className="font-semibold text-text-primary">移入回收站</span>
                （先完整备份到 merge-backups，可从回收站或备份恢复）。
              </p>
            )}
            {groups.toUnlink.length > 0 && (
              <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2.5">
                <p>
                  🔗 <span className="font-semibold">{groups.toUnlink.length} 个技能</span>
                  存在 Hub 引用，将执行
                  <span className="font-semibold">解除引用</span>（不删除文件）。
                </p>
                <p className="mt-1 text-[11.5px] text-text-tertiary">
                  解除后技能仍保留在技能库，如需彻底移除请再次勾选删除。
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {groups.toUnlink.slice(0, 5).map((i) => (
                    <span
                      key={i.id}
                      className="rounded border border-stroke bg-glass px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary"
                    >
                      {i.name}
                    </span>
                  ))}
                  {groups.toUnlink.length > 5 && (
                    <span className="px-0.5 py-0.5 text-[10.5px] text-text-tertiary">
                      等 {groups.toUnlink.length} 个
                    </span>
                  )}
                </div>
              </div>
            )}
            {groups.toClean.length > 0 && (
              <div className="rounded-lg border border-stroke bg-glass-2 px-3 py-2.5">
                <p>
                  📄 <span className="font-semibold">{groups.toClean.length} 个技能</span>
                  源文件早已删除，仅剩译文记录，将
                  <span className="font-semibold">备份译文并清理记录</span>
                  （技能从列表移除，不再复活）。
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {groups.toClean.slice(0, 5).map((i) => (
                    <span
                      key={i.id}
                      className="rounded border border-stroke bg-glass px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary"
                    >
                      {i.name}
                    </span>
                  ))}
                  {groups.toClean.length > 5 && (
                    <span className="px-0.5 py-0.5 text-[10.5px] text-text-tertiary">
                      等 {groups.toClean.length} 个
                    </span>
                  )}
                </div>
              </div>
            )}
            {groups.untouchable.length > 0 && (
              <p className="text-[11.5px] text-text-tertiary">
                {groups.untouchable.length} 个技能在磁盘上已不存在（可能已被外部删除，或在此前操作中已移入回收站）。确认后将刷新列表使其不再显示。
              </p>
            )}
          </div>
        )}

        {/* ===== 操作区 ===== */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            className="flex-1"
            variant={onlyGhosts || onlyUnlink || onlyClean ? "outline" : "destructive"}
            onClick={handleConfirm}
            disabled={busy || !groups || !!checkError}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {busy ? "处理中…" : confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}