/**
 * PLAN-13 工作流 T：标签筛选条（技能库 CategoryView 用）。
 * 横向 chips 多选 AND；选中态描边 + 品牌色强调；「清除筛选」一键复位。
 * 只展示「当前范围内实际被挂过」的标签 + 全部标签里已有挂载的，避免无效选项噪音；
 * 无任何挂载时整条不渲染（筛选无意义）。
 */

import { useMemo } from "react";
import { X } from "lucide-react";
import type { UseTagsApi } from "@/hooks/useTags";
import { tagKeySkill } from "@/lib/api";
import type { Skill } from "@/hooks/useSkills";

interface TagFilterBarProps {
  tagsApi: UseTagsApi;
  /** 当前筛选中的 tag_id 列表（AND） */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** 筛选范围（用于推导可选标签集合；不传 = 全部标签） */
  skills?: Skill[];
  /** 根节点 className（默认含 mb-4 外边距；嵌入容器时可传无外边距变体） */
  className?: string;
}

export function TagFilterBar({ tagsApi, selected, onChange, skills, className = "mb-4 flex flex-wrap items-center gap-1.5" }: TagFilterBarProps) {
  const { data } = tagsApi;

  // 可选标签：范围内有挂载的标签（保持 内置优先 + 名称序）
  const candidates = useMemo(() => {
    let ids: string[];
    if (skills && skills.length > 0) {
      const inScope = new Set<string>();
      for (const s of skills) {
        for (const t of data.assignments[tagKeySkill(s.id)] ?? []) inScope.add(t);
      }
      ids = [...inScope];
    } else {
      ids = Object.keys(data.tags);
    }
    return ids
      .filter((id) => data.tags[id])
      .sort((a, b) => {
        const da = data.tags[a];
        const db = data.tags[b];
        if (da.builtin !== db.builtin) return da.builtin ? -1 : 1;
        return da.name.localeCompare(db.name, "zh");
      });
  }, [data, skills]);

  if (candidates.length === 0) return null;

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((t) => t !== id)
        : [...selected, id]
    );
  };

  return (
    <div className={className}>
      <span className="mr-0.5 text-[11.5px] text-text-tertiary">按标签筛选</span>
      {candidates.map((id) => {
        const active = selected.includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            className={`inline-flex h-[26px] items-center rounded-full border px-2.5 text-[12px] transition-colors ${
              active
                ? "border-brand/60 text-brand"
                : "border-stroke bg-glass text-text-secondary hover:border-stroke-hi hover:text-text-primary"
            }`}
            style={
              active
                ? { backgroundColor: "color-mix(in srgb, var(--brand) 12%, transparent)" }
                : undefined
            }
          >
            {data.tags[id].name}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="inline-flex h-[26px] items-center gap-1 rounded-full px-2 text-[11.5px] text-text-tertiary transition-colors hover:text-text-primary"
        >
          <X className="h-3 w-3" />
          清除筛选
        </button>
      )}
    </div>
  );
}
