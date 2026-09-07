/**
 * W1：工作台草稿 localStorage 兜底。
 * dirty 期间每次变更同步写入（KB 级，无 debounce 窗口），
 * 防崩溃 / 误关 / tab 切换丢失；保存成功后清除。
 */
import {
  isSkillCreationState,
  type SkillCreationState,
} from "@/lib/creation-state";

export interface WbDraft {
  name: string;
  desc: string;
  /**
   * 「我的描述」单一输入：skill 做什么——作为 description 的源。
   * 阶段 0：删「何时用」字段，面板只留这一个描述输入；
   * 使用场景由 AI「优化描述」补进 description（能力 1）。
   */
  purpose: string;
  /** AI「优化描述」产出的触发关键词（可选落 frontmatter trigger_keywords）。 */
  triggerKeywords: string[];
  emoji: string;
  body: string;
  /**
   * shark-skill-creator 规范层结构补全：
   * 勾选的子目录在后端创建时预置引导 README，并在 SKILL.md 模板追加资源导航段。
   * 默认全选（references/scripts/assets），用户可在 CreatorSpecPanel 中调整。
   */
  scaffold: string[];
}

export interface StoredDraft {
  savedAt: number;
  draft: WbDraft;
  /** Versioned Creator state; optional for backwards compatibility. */
  creationState?: SkillCreationState;
}

export const EMPTY_DRAFT: WbDraft = {
  name: "",
  desc: "",
  purpose: "",
  triggerKeywords: [],
  emoji: "🧩",
  body: "",
  scaffold: ["references", "scripts", "assets"],
};

const keyOf = (id: string) => `ss-wb-draft:${id}`;

export function loadDraft(id: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredDraft;
    if (!v || typeof v.savedAt !== "number" || !v.draft) return null;
    // 旧草稿字段漂移兼容：与 EMPTY_DRAFT 合并补默认（emoji/triggerKeywords 等），遗留 steps/resources/triggers 自然丢弃
    return {
      savedAt: v.savedAt,
      draft: { ...EMPTY_DRAFT, ...v.draft },
      creationState: isSkillCreationState(v.creationState)
        ? v.creationState
        : undefined,
    };
  } catch {
    return null;
  }
}

export function storeDraft(
  id: string,
  draft: WbDraft,
  creationState?: SkillCreationState,
): void {
  try {
    localStorage.setItem(
      keyOf(id),
      JSON.stringify({ savedAt: Date.now(), draft, creationState }),
    );
  } catch {
    /* 配额满等异常静默——兜底机制本身不应炸 */
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(keyOf(id));
  } catch {
    /* ignore */
  }
}

export function fmtSavedAt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** hyphen-case 实时校验（顶栏 name 输入）。 */
export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
