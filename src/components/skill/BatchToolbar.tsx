import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Package, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { BatchTagPicker } from "@/components/common/TagPicker";
import type { UseTagsApi } from "@/hooks/useTags";
import type { Skill } from "@/hooks/useSkills";
import {
  hubLinkSkill,
  hubLinkableTools,
  tagKeySkill,
  type LinkMode,
  type LinkableTool,
} from "@/lib/api";

interface BatchToolbarProps {
  /** 已勾选数量 */
  count: number;
  /** 已勾选的技能（派送时逐个建链） */
  selectedSkills: Skill[];
  /** 标签 API（缺省时隐藏打标按钮） */
  tagsApi?: UseTagsApi;
  onClear: () => void;
  /** 派送成功后的回调（刷新技能扫描等） */
  onLinked?: () => void;
  /** 打包入口：提供时启用「打包」按钮，点击携已勾选技能打开打包对话框 */
  onPack?: () => void;
  /** 批量删除入口：提供时启用「删除」按钮（确认/引用检查由上游弹窗承接） */
  onDelete?: () => void;
}

/**
 * 批量操作工具条（共享组件）：勾选技能后出现，承载批量打标 + 批量派送到工具。
 * 技能库分类视图（CategoryView）与全部技能视图（AllSkillsView）共用，
 * 避免两份批量逻辑漂移。打包能力暂占位（本期不做）。
 */
export function BatchToolbar({
  count,
  selectedSkills,
  tagsApi,
  onClear,
  onLinked,
  onPack,
  onDelete,
}: BatchToolbarProps) {
  const [tagBusy, setTagBusy] = useState(false);

  // ===== 批量派送 =====
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkTools, setLinkTools] = useState<LinkableTool[]>([]);
  const [linkToolsLoading, setLinkToolsLoading] = useState(false);
  const [linkTargetIds, setLinkTargetIds] = useState<Set<string>>(new Set());
  const [linkMode, setLinkMode] = useState<LinkMode>("link");
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    if (!linkPanelOpen) return;
    setLinkToolsLoading(true);
    hubLinkableTools()
      .then(setLinkTools)
      .catch(() => setLinkTools([]))
      .finally(() => setLinkToolsLoading(false));
  }, [linkPanelOpen]);

  const toggleLinkTarget = (id: string) =>
    setLinkTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyBatchTags = async (tagIds: string[], mode: "add" | "remove") => {
    if (count === 0 || tagIds.length === 0) return;
    const keys = selectedSkills.map((s) => tagKeySkill(s.id));
    const names = tagIds
      .map((id) => tagsApi?.data.tags[id]?.name)
      .filter(Boolean)
      .join("、");
    setTagBusy(true);
    try {
      if (!tagsApi) throw new Error("标签数据未就绪");
      if (mode === "add") await tagsApi.batchAddTags(keys, tagIds);
      else await tagsApi.batchRemoveTags(keys, tagIds);
      toast.success(
        mode === "add"
          ? `已为 ${count} 个技能添加标签「${names}」`
          : `已从 ${count} 个技能清除标签「${names}」`,
      );
    } catch (e) {
      toast.error(`批量打标失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTagBusy(false);
    }
  };

  const doBatchLink = async () => {
    if (linkTargetIds.size === 0 || count === 0) return;
    setLinkBusy(true);
    const ok: string[] = [];
    const fail: string[] = [];
    for (const skill of selectedSkills) {
      for (const tid of linkTargetIds) {
        try {
          await hubLinkSkill({
            sourcePath: skill.skill_dir,
            targetToolId: tid,
            mode: linkMode,
          });
          ok.push(`${skill.name} → ${tid}`);
        } catch (e) {
          fail.push(`${skill.name} → ${tid}（${String(e)}）`);
        }
      }
    }
    if (ok.length > 0) {
      toast.success(`已${linkMode === "link" ? "链接" : "复制"} ${ok.length} 条引用`);
      onLinked?.();
    }
    if (fail.length > 0) {
      toast.error(
        `${fail.length} 条失败：${fail.slice(0, 3).join("；")}${fail.length > 3 ? "…" : ""}`,
      );
    }
    setLinkBusy(false);
    setLinkPanelOpen(false);
    setLinkTargetIds(new Set());
    if (ok.length > 0) onClear();
  };

  return (
    <div
      className="sticky top-0 z-10 mb-4 rounded-[12px] border border-stroke bg-glass"
      style={{
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        boxShadow: "0 10px 30px -12px var(--glow)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="mr-1 text-[12.5px] font-semibold text-text-primary">
          已选 {count} 个
        </span>
        {tagsApi && (
          <>
            <BatchTagPicker
              tagsApi={tagsApi}
              mode="add"
              busy={tagBusy}
              disabled={tagBusy}
              onApply={(ids) => applyBatchTags(ids, "add")}
            />
            <BatchTagPicker
              tagsApi={tagsApi}
              mode="remove"
              busy={tagBusy}
              disabled={tagBusy}
              onApply={(ids) => applyBatchTags(ids, "remove")}
            />
          </>
        )}
        {/* 批量派送到工具 */}
        <button
          type="button"
          className={`mbtn inline-flex shrink-0 items-center gap-1 ${linkPanelOpen ? "primary" : ""}`}
          onClick={() => setLinkPanelOpen((v) => !v)}
        >
          <Send className="h-3.5 w-3.5" />
          派送到工具
        </button>
        {/* 批量打包：提供 onPack 时启用（携已勾选技能打开打包对话框） */}
        <button
          type="button"
          disabled={!onPack}
          title={onPack ? "把已勾选技能打包为 Skill Pack" : "批量打包即将支持"}
          className={`mbtn inline-flex shrink-0 items-center gap-1 ${onPack ? "" : "opacity-50"}`}
          onClick={() => onPack?.()}
        >
          <Package className="h-3.5 w-3.5" />
          打包
        </button>
        {/* 批量删除：提供 onDelete 时启用（「清空选择」左侧紧邻，最右位不变） */}
        {onDelete && (
          <button
            type="button"
            className="mbtn danger inline-flex shrink-0 items-center gap-1"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        )}
        <button type="button" className="mbtn ml-auto shrink-0" onClick={onClear}>
          清空选择
        </button>
      </div>

      {/* 批量派送面板（展开时显示） */}
      {linkPanelOpen && (
        <div className="border-t border-stroke/60 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              派送到哪些工具（可多选）
            </span>
            <button
              type="button"
              className="iconbtn h-6 w-6"
              onClick={() => setLinkPanelOpen(false)}
              aria-label="关闭派送面板"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {linkToolsLoading ? (
            <p className="flex items-center gap-2 py-2 text-[12px] text-text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载工具清单…
            </p>
          ) : linkTools.length === 0 ? (
            <p className="py-2 text-[12px] text-text-tertiary">
              暂无可链接的外部工具，请先在设置中启用。
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {linkTools.map((t) => {
                  const on = linkTargetIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleLinkTarget(t.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${on ? "border-brand bg-brand/10 font-medium text-brand" : "border-stroke bg-glass-2 text-text-secondary hover:border-stroke-hi"}`}
                    >
                      <span
                        className={`grid h-3.5 w-3.5 place-items-center rounded-sm border ${on ? "border-brand bg-brand text-white" : "border-stroke"}`}
                      >
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </span>
                      {t.name}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-text-tertiary">方式</span>
                  <div className="flex overflow-hidden rounded-md border border-stroke text-[12px]">
                    <button
                      type="button"
                      onClick={() => setLinkMode("link")}
                      className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${linkMode === "link" ? "bg-brand text-white" : "bg-glass text-text-secondary hover:text-text-primary"}`}
                    >
                      <Link2 className="h-3 w-3" /> 链接
                    </button>
                    <button
                      type="button"
                      onClick={() => setLinkMode("copy")}
                      className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${linkMode === "copy" ? "bg-brand text-white" : "bg-glass text-text-secondary hover:text-text-primary"}`}
                    >
                      <Copy className="h-3 w-3" /> 复制
                    </button>
                  </div>
                </div>
                <span className="min-w-0 flex-1 text-[12px] text-text-tertiary">
                  {linkTargetIds.size === 0
                    ? "请选择目标工具"
                    : `将把 ${count} 个技能派送到 ${linkTargetIds.size} 个工具（${count * linkTargetIds.size} 条新引用）`}
                </span>
                <button
                  type="button"
                  className="mbtn primary"
                  disabled={linkTargetIds.size === 0 || linkBusy}
                  onClick={doBatchLink}
                >
                  {linkBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  确认派送
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
