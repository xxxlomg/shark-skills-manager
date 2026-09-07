/**
 * 工作流 T：标签状态 Hook。
 * 数据层 tags.json 全量持有于前端（改完整存），多视图共享需提升到 App。
 * 乐观更新 + 失败回滚重读，杜绝 UI 与磁盘不一致残留。
 */

import { useState, useEffect, useCallback } from "react";
import { loadTags, saveTags, type TagsData } from "@/lib/api";

const EMPTY: TagsData = { version: 1, tags: {}, assignments: {} };

/** 自定义标签 id：t- + 6 位随机（与内置 t-dev 等同构） */
function genTagId(): string {
  return `t-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseTagsApi {
  data: TagsData;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** 某对象（复合键）已挂的 tag_id 列表 */
  tagsFor: (objectKey: string) => string[];
  /** 挂/摘标签（toggle） */
  toggleTag: (objectKey: string, tagId: string) => Promise<void>;
  /** 批量添加标签（并集，幂等）——对多个对象一次 commit 落盘 */
  batchAddTags: (objectKeys: string[], tagIds: string[]) => Promise<void>;
  /** 批量清除标签（摘除，无则忽略）——对多个对象一次 commit 落盘 */
  batchRemoveTags: (objectKeys: string[], tagIds: string[]) => Promise<void>;
  /** 创建自定义标签；重名返回已存在的 id（不重复创建） */
  createTag: (name: string) => Promise<string>;
  /** 改名（内置标签也可改名，不可删） */
  renameTag: (tagId: string, name: string) => Promise<void>;
  /** 删除自定义标签（级联清理挂载；内置标签拒绝） */
  deleteTag: (tagId: string) => Promise<void>;
}

export function useTags(): UseTagsApi {
  const [data, setData] = useState<TagsData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadTags());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 乐观提交：先更新 UI，落盘失败回滚并抛出（调用方 toast） */
  const commit = useCallback(
    async (next: TagsData) => {
      const prev = data;
      setData(next);
      try {
        await saveTags(next);
      } catch (e) {
        setData(prev);
        throw e;
      }
    },
    [data]
  );

  const tagsFor = useCallback(
    (objectKey: string) => data.assignments[objectKey] ?? [],
    [data]
  );

  const toggleTag = useCallback(
    async (objectKey: string, tagId: string) => {
      const assignments = { ...data.assignments };
      const cur = assignments[objectKey] ?? [];
      const nextList = cur.includes(tagId)
        ? cur.filter((t) => t !== tagId)
        : [...cur, tagId];
      if (nextList.length === 0) delete assignments[objectKey];
      else assignments[objectKey] = nextList;
      await commit({ ...data, assignments });
    },
    [data, commit]
  );

  const batchAddTags = useCallback(
    async (objectKeys: string[], tagIds: string[]) => {
      if (objectKeys.length === 0 || tagIds.length === 0) return;
      const assignments = { ...data.assignments };
      for (const key of objectKeys) {
        const cur = assignments[key] ?? [];
        const merged = [...cur];
        for (const t of tagIds) {
          if (!merged.includes(t)) merged.push(t);
        }
        if (merged.length > 0) assignments[key] = merged;
      }
      await commit({ ...data, assignments });
    },
    [data, commit],
  );

  const batchRemoveTags = useCallback(
    async (objectKeys: string[], tagIds: string[]) => {
      if (objectKeys.length === 0 || tagIds.length === 0) return;
      const assignments = { ...data.assignments };
      const tagSet = new Set(tagIds);
      for (const key of objectKeys) {
        const cur = assignments[key] ?? [];
        const kept = cur.filter((t) => !tagSet.has(t));
        if (kept.length > 0) assignments[key] = kept;
        else delete assignments[key];
      }
      await commit({ ...data, assignments });
    },
    [data, commit],
  );

  const createTag = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("标签名不能为空");
      const dup = Object.entries(data.tags).find(([, d]) => d.name === trimmed);
      if (dup) return dup[0];
      let id = genTagId();
      while (data.tags[id]) id = genTagId();
      await commit({
        ...data,
        tags: { ...data.tags, [id]: { name: trimmed, builtin: false } },
      });
      return id;
    },
    [data, commit]
  );

  const renameTag = useCallback(
    async (tagId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("标签名不能为空");
      const def = data.tags[tagId];
      if (!def) throw new Error("标签不存在");
      await commit({
        ...data,
        tags: { ...data.tags, [tagId]: { ...def, name: trimmed } },
      });
    },
    [data, commit]
  );

  const deleteTag = useCallback(
    async (tagId: string) => {
      const def = data.tags[tagId];
      if (!def) return;
      if (def.builtin) throw new Error("内置标签不能删除，可以改名");
      const tags = { ...data.tags };
      delete tags[tagId];
      const assignments: Record<string, string[]> = {};
      for (const [k, list] of Object.entries(data.assignments)) {
        const kept = list.filter((t) => t !== tagId);
        if (kept.length > 0) assignments[k] = kept;
      }
      await commit({ version: data.version, tags, assignments });
    },
    [data, commit]
  );

  return {
    data,
    loading,
    error,
    refresh,
    tagsFor,
    toggleTag,
    batchAddTags,
    batchRemoveTags,
    createTag,
    renameTag,
    deleteTag,
  };
}
