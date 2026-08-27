/**
 * PLAN-13 工作流 T：标签选择器（Popover）。
 * 清单勾选 + 「新建标签…」行内输入（回车创建并立即挂上）。
 * 技能库详情与 Hub 复用同一组件（objectKey 复合键区分对象类型）。
 */

import { useState, useCallback } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { UseTagsApi } from "@/hooks/useTags";

interface TagPickerProps {
  /** 复合键：skill:<skill_id> 或 hublink:<link_id> */
  objectKey: string;
  tagsApi: UseTagsApi;
}

export function TagPicker({ objectKey, tagsApi }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const assigned = tagsApi.tagsFor(objectKey);

  const handleToggle = useCallback(
    async (tagId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await tagsApi.toggleTag(objectKey, tagId);
      } catch (e) {
        toast.error(`标签更新失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, objectKey, tagsApi]
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const id = await tagsApi.createTag(name);
      // 新建后立即挂上（重名返回已有 id 时同样确保挂载）
      if (!tagsApi.tagsFor(objectKey).includes(id)) {
        await tagsApi.toggleTag(objectKey, id);
      }
      setNewName("");
    } catch (e) {
      toast.error(`创建标签失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [newName, busy, objectKey, tagsApi]);

  // 稳定顺序：内置在前（数据插入序），自定义按名排序
  const entries = Object.entries(tagsApi.data.tags).sort((a, b) => {
    if (a[1].builtin !== b[1].builtin) return a[1].builtin ? -1 : 1;
    return a[1].name.localeCompare(b[1].name, "zh");
  });

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setNewName(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-[24px] items-center gap-1 rounded-full border border-dashed border-stroke px-2 text-[11.5px] text-text-tertiary transition-colors hover:border-stroke-hi hover:text-text-primary"
          title="编辑标签"
        >
          <Plus className="h-3 w-3" />
          标签
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[240px] rounded-[12px] border-stroke bg-card p-2"
      >
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-text-tertiary">
          <Tag className="h-3 w-3" />
          选择标签（可多选）
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          {entries.length === 0 && (
            <p className="px-2 py-3 text-center text-[12px] text-text-tertiary">
              暂无标签
            </p>
          )}
          {entries.map(([id, def]) => {
            const checked = assigned.includes(id);
            return (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => handleToggle(id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-[7px] text-left text-[12.5px] text-text-secondary transition-colors hover:bg-glass-2 disabled:opacity-50"
              >
                <span
                  className={`grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[5px] border ${
                    checked
                      ? "border-brand bg-brand text-white"
                      : "border-stroke bg-transparent"
                  }`}
                >
                  {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="truncate">{def.name}</span>
                {def.builtin && (
                  <span className="ml-auto shrink-0 text-[10px] text-text-tertiary">
                    内置
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 border-t border-stroke pt-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="新建标签…（回车创建）"
            disabled={busy}
            className="h-8 w-full rounded-lg border border-stroke bg-glass px-2.5 text-[12.5px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-stroke-hi"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 已挂标签 chips（点 × 摘除）+ TagPicker 触发器。
 * DetailSheet / HubView 卡片与列表行共用的整行形态。
 */
export function TagChipsRow({
  objectKey,
  tagsApi,
}: {
  objectKey: string;
  tagsApi: UseTagsApi;
}) {
  const assigned = tagsApi.tagsFor(objectKey);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((tagId) => {
        const def = tagsApi.data.tags[tagId];
        if (!def) return null;
        return (
          <button
            key={tagId}
            type="button"
            title="点击摘除该标签"
            onClick={() =>
              tagsApi
                .toggleTag(objectKey, tagId)
                .catch((e) =>
                  toast.error(
                    `标签更新失败：${e instanceof Error ? e.message : String(e)}`
                  )
                )
            }
            className="inline-flex h-[22px] items-center gap-1 rounded-full border border-stroke bg-glass-2 px-2 text-[11px] text-text-secondary transition-colors hover:border-red-400/60 hover:text-red-500"
          >
            {def.name}
            <X className="h-2.5 w-2.5" />
          </button>
        );
      })}
      <TagPicker objectKey={objectKey} tagsApi={tagsApi} />
    </div>
  );
}

/**
 * PLAN-14 批量打标选择器（Popover）。
 * 与单对象 TagPicker 的区别：点击标签只收集到本地 picked 集合，
 * 点「确定」才经 onApply 交给调用方批量执行（D4：添加=并集 / 清除=摘除）。
 * 单对象模式（TagPicker）不受影响。
 */
export function BatchTagPicker({
  tagsApi,
  mode,
  onApply,
  busy,
  disabled,
}: {
  tagsApi: UseTagsApi;
  /** add=批量添加 / remove=批量清除 */
  mode: "add" | "remove";
  /** 用户点确定后回调（已收集的 tag_id 列表） */
  onApply: (tagIds: string[]) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");

  const applyAll = useCallback(() => {
    if (picked.size === 0) return;
    onApply([...picked]);
  }, [picked, onApply]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || busy) return;
    try {
      const id = await tagsApi.createTag(name);
      setPicked((prev) => new Set(prev).add(id));
      setNewName("");
    } catch (e) {
      toast.error(`创建标签失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [newName, busy, tagsApi]);

  const entries = Object.entries(tagsApi.data.tags).sort((a, b) => {
    if (a[1].builtin !== b[1].builtin) return a[1].builtin ? -1 : 1;
    return a[1].name.localeCompare(b[1].name, "zh");
  });

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setPicked(new Set());
          setNewName("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className="mbtn inline-flex shrink-0 items-center gap-1 disabled:opacity-50"
          title={
            mode === "add"
              ? "为选中的技能批量添加标签（并集）"
              : "从选中的技能批量清除标签"
          }
        >
          {mode === "add" ? (
            <Plus className="h-3.5 w-3.5" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          {mode === "add" ? "添加标签" : "清除标签"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[240px] rounded-[12px] border-stroke bg-card p-2"
      >
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-text-tertiary">
          <Tag className="h-3 w-3" />
          {mode === "add" ? "选择要添加的标签" : "选择要清除的标签"}
          <span className="ml-auto">已选 {picked.size}</span>
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          {entries.length === 0 && (
            <p className="px-2 py-3 text-center text-[12px] text-text-tertiary">
              暂无标签，先新建一个
            </p>
          )}
          {entries.map(([id, def]) => {
            const checked = picked.has(id);
            return (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                className="flex w-full items-center gap-2 rounded-lg px-2 py-[7px] text-left text-[12.5px] text-text-secondary transition-colors hover:bg-glass-2 disabled:opacity-50"
              >
                <span
                  className={`grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[5px] border ${
                    checked
                      ? "border-brand bg-brand text-white"
                      : "border-stroke bg-transparent"
                  }`}
                >
                  {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="truncate">{def.name}</span>
                {def.builtin && (
                  <span className="ml-auto shrink-0 text-[10px] text-text-tertiary">
                    内置
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 border-t border-stroke pt-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="新建标签…（回车创建并勾选）"
            disabled={busy}
            className="h-8 w-full rounded-lg border border-stroke bg-glass px-2.5 text-[12.5px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-stroke-hi"
          />
        </div>
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            className="mbtn h-7 px-2.5 text-[12px]"
            onClick={() => setOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="mbtn primary h-7 px-2.5 text-[12px]"
            disabled={picked.size === 0 || busy}
            onClick={applyAll}
          >
            {busy ? "执行中…" : `确定（${picked.size}）`}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
