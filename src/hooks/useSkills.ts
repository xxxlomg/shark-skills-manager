/**
 * Skills 数据 Hook — 通过 Tauri invoke 扫描 + 前端分组
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MOCK_SKILLS, isMockMode } from "@/mock";

export interface Skill {
  id: string;
  name: string;
  folder_name: string;
  description: string;
  emoji: string | null;
  scan_label: string;
  source_path: string;
  /** v0.2（B4）：实际扫描到的技能目录（junction 落点不穿透，hub 操作锚点） */
  skill_dir: string;
  /** 来源工具注册表 id */
  tool_id: string;
  /** 同名组代表卡片（B4 代表选取） */
  is_representative: boolean;
  /** 其他持有同名技能的工具 id 列表（UI 徽标用） */
  other_sources: string[];
  /** 该目录是 junction（hub link 落点） */
  hub_linked: boolean;
  /** 账本中对应的 link id（供解除引用/转副本） */
  hub_link_id: string | null;
  has_translation: boolean;
  /** 元数据在但译文 .md 丢失/为空 */
  translation_lost: boolean;
  title_zh: string;
  /** 译文中的中文描述（无译文为空串），展示优先于 description */
  description_zh: string;
  source_deleted: boolean;
  parent_collection: string | null;
}

export interface SkillGroup {
  label: string;
  skills: Skill[];
}

export type LayoutMode = "grid" | "list";

/** 翻译状态：ok 已翻译 / lost 译文丢失（曾翻译但文件没了）/ no 待翻译 */
export type TranslateStatus = "ok" | "lost" | "no";

export function skillStatus(s: Skill): TranslateStatus {
  if (s.has_translation) return "ok";
  if (s.translation_lost) return "lost";
  return "no";
}

export const STATUS_TEXT: Record<TranslateStatus, string> = {
  ok: "已翻译",
  lost: "译文丢失",
  no: "待翻译",
};

/**
 * 工具/分类显示名映射。
 * 内部 id（builtin/imported/authored）是 scanner/translations 的硬契约，不可修改；
 * 仅在 UI 层把晦涩的 id 换成更易懂的中文名。新增映射只需加一行。
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  builtin: "示例技能",
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor",
  qwenpaw: "QwenPaw",
  opencode: "OpenCode",
};

/** 将工具/分类内部名映射为面向用户的显示名（无映射时原样返回）。 */
export function toolDisplayName(label: string): string {
  return TOOL_DISPLAY_NAMES[label] ?? label;
}

/** 通用容器目录名：嵌套合集最内层常叫 skills/skill，无标识意义，显示时跳过 */
const GENERIC_COLLECTION_SEGMENTS = new Set(["skills", "skill"]);

/**
 * 合集显示名：取相对扫描根路径里「第一个有标识意义的段」。
 * 例：superpowers/skills → superpowers；skills/superpowers → superpowers。
 * 末段常是通用容器词 skills，直接取末段会丢失真正的父级名。
 * 全为通用词的极端情况回退末段，避免空串。
 */
export function collectionDisplayName(collection: string): string {
  const segments = collection
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return collection;
  const meaningful = segments.find(
    (s) => !GENERIC_COLLECTION_SEGMENTS.has(s.toLowerCase())
  );
  return meaningful ?? segments[segments.length - 1];
}

/**
 * 合集相对当前工具的显示名：已在某工具内时，去掉「工具/」前缀，
 * 让子文件夹卡与面包屑显示真正的子级名（Claude/testing → testing）。
 */
export function collectionRelativeName(
  label: string,
  collection: string,
): string {
  const pref = label + "/";
  if (collection.startsWith(pref)) {
    const rest = collection.slice(pref.length).trim();
    if (rest) return rest;
  }
  return collectionDisplayName(collection);
}

/**
 * 面包屑可见段：从目录路径段里筛掉通用容器段（skills/skill），
 * 保留每段的「原始前缀索引」（endIndex = 该可见段对应的完整路径长度），供点击导航。
 * 例：["superpowers","skills"] → [{ name:"superpowers", endIndex:1 }]。
 */
export function breadcrumbSegments(
  path: string[],
): { name: string; endIndex: number }[] {
  const out: { name: string; endIndex: number }[] = [];
  path.forEach((seg, i) => {
    if (!GENERIC_COLLECTION_SEGMENTS.has(seg.trim().toLowerCase())) {
      out.push({ name: seg, endIndex: i });
    }
  });
  return out;
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 软合并（coalescing）：一次扫描在途期间的新 refresh 只标记重跑，
  // 上一次结束后合入执行一次——连续 N 次 refresh 最多扫 2 次，
  // 且最终状态不丢（保存/翻译连击不再触发全量重扫风暴）。
  const inflightRef = useRef(false);
  const rerunRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inflightRef.current) {
      rerunRef.current = true; // 排队：当前扫描结束后合入再扫一次
      return;
    }
    inflightRef.current = true;
    try {
      do {
        rerunRef.current = false;
        setLoading(true);
        setError(null);
        try {
          if (isMockMode()) {
            await new Promise((r) => setTimeout(r, 250));
            // 浅拷贝新引用：MOCK_SKILLS 可变（CRUD mock 直接增删），同引用 React 不重渲染
            setSkills([...MOCK_SKILLS]);
          } else {
            const data = await invoke<Skill[]>("scan_skills");
            setSkills(data);
          }
        } catch (err: any) {
          setError(err?.message ?? String(err));
        } finally {
          setLoading(false);
        }
      } while (rerunRef.current);
    } finally {
      inflightRef.current = false;
    }
  }, []);

  /** 刷新同步：标记已删除 + 重新扫描 */
  const sync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isMockMode()) {
        await new Promise((r) => setTimeout(r, 250));
        setSkills([...MOCK_SKILLS]);
        return;
      }
      const currentIds = skills.map((s) => s.id);
      const data = await invoke<Skill[]>("sync_deleted", { currentIds });
      setSkills(data);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [skills]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * B4 折叠：同名技能跨工具只留代表卡（后端确定性选取）。
   * 全量 `skills` 仍保留——sync_deleted 依赖全量 id 防误杀译文。
   */
  const visible = useMemo(() => skills.filter((s) => s.is_representative), [skills]);

  /**
   * 按 scan_label 分组，保持首次出现顺序。
   * 空标签归"未分类"，排最后。
   * 0 个 skill 的组不输出。
   */
  const groups = useMemo<SkillGroup[]>(() => {
    const map = new Map<string, Skill[]>();
    const order: string[] = [];

    for (const s of visible) {
      const key = s.scan_label || "未分类";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(s);
    }

    // "未分类" 排最后
    const uncat = "未分类";
    const sorted = order.filter((k) => k !== uncat);
    if (map.has(uncat)) sorted.push(uncat);

    return sorted
      .map((label) => ({ label, skills: map.get(label)! }))
      .filter((g) => g.skills.length > 0);
  }, [visible]);

  return {
    skills,
    visible,
    groups,
    loading,
    error,
    refresh,
    sync,
  };
}
