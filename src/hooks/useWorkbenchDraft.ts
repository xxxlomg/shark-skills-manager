/**
 * 创作台草稿统一工具（Hook）——dirty 判定、自动落盘、恢复/丢弃/保存后清理
 * 全部收敛到本文件。创作台页面不再散落 storeDraft / setDirtyAll / loadDraft
 * 的判断，所有读写经此单一入口。
 *
 * 核心原则：
 * - init(...)      初始化回显（磁盘内容 / 草稿恢复前的默认填充）：不标脏、不落盘
 * - patch(...)     真实修改 → 标脏 + 立即同步落盘（localStorage 兜底崩溃恢复）
 * - persistIfDirty(state?)    状态机推进（阶段切换等）→ 仅在有脏时落盘，
 *   纯查看不写盘（避免「打开→查看→退出→再进」误报恢复横幅）
 * - markClean(ownerId?)       保存成功后清脏、清对应草稿
 * - restoreStored / dismissStored / discardStored  恢复横幅三态
 */
import { useCallback, useRef, useState } from "react";
import {
  EMPTY_DRAFT,
  clearDraft,
  loadDraft,
  storeDraft,
  type StoredDraft,
  type WbDraft,
} from "@/lib/wb-draft";
import type { SkillCreationState } from "@/lib/creation-state";

export interface WorkbenchDraftApi {
  draft: WbDraft;
  dirty: boolean;
  stored: StoredDraft | null;
  /** 初始化/只读回显：直接设置草稿内容，不标脏不落盘 */
  setDraftSilently: (updater: (d: WbDraft) => WbDraft) => void;
  /** 真实修改：标脏 + 立即同步落盘 */
  patch: (p: Partial<WbDraft>) => void;
  /** 状态机推进（阶段切换等）：仅在有脏时落盘（可显式传最新 creationState） */
  persistIfDirty: (state?: SkillCreationState) => void;
  /** 保存成功：清脏；传 ownerId 时一并清除该 id 的草稿 */
  markClean: (ownerId?: string) => void;
  /** 恢复草稿内容（内容替换为 stored 快照，标脏让用户重保存） */
  restoreStored: () => void;
  /** 关闭恢复横幅、保留磁盘内容（不删草稿快照？否——等同忽略，删快照） */
  dismissStored: () => void;
  /** 丢弃存储草稿（横幅「丢弃草稿」） */
  discardStored: () => void;
  /** 主动放弃创作：清草稿快照 + 脏状态（下次新建干净空态） */
  clearAll: () => void;
}

export function useWorkbenchDraft(
  draftId: string,
  getCreationState: () => SkillCreationState | undefined,
): WorkbenchDraftApi {
  const [draft, _setDraft] = useState<WbDraft>({ ...EMPTY_DRAFT });
  const draftRef = useRef(draft);
  const [dirty, _setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [stored, setStored] = useState<StoredDraft | null>(() => loadDraft(draftId));

  const setDraftState = useCallback((updater: (d: WbDraft) => WbDraft) => {
    _setDraft((d) => {
      const next = updater(d);
      draftRef.current = next;
      return next;
    });
  }, []);

  const markDirty = useCallback((v: boolean) => {
    dirtyRef.current = v;
    _setDirty(v);
  }, []);

  /** 初始化/只读回显 */
  const setDraftSilently = useCallback(
    (updater: (d: WbDraft) => WbDraft) => {
      setDraftState(updater);
    },
    [setDraftState],
  );

  /** 真实修改：标脏 + 立即落盘 */
  const patch = useCallback(
    (p: Partial<WbDraft>) => {
      setDraftState((d) => {
        const next = { ...d, ...p };
        storeDraft(draftId, next, getCreationState());
        return next;
      });
      markDirty(true);
    },
    [draftId, getCreationState, markDirty, setDraftState],
  );

  /** 状态机推进：仅在有脏时落盘（查看阶段零写盘） */
  const persistIfDirty = useCallback(
    (state?: SkillCreationState) => {
      if (!dirtyRef.current) return;
      storeDraft(draftId, draftRef.current, state ?? getCreationState());
    },
    [draftId, getCreationState],
  );

  /** 保存成功 */
  const markClean = useCallback(
    (ownerId?: string) => {
      markDirty(false);
      if (ownerId) clearDraft(ownerId);
    },
    [markDirty],
  );

  /** 恢复草稿内容（标脏，用户需重新保存） */
  const restoreStored = useCallback(() => {
    if (!stored) return;
    setDraftState(() => ({ ...EMPTY_DRAFT, ...stored.draft }));
    markDirty(true);
    setStored(null);
  }, [stored, markDirty, setDraftState]);

  /** 忽略恢复横幅，用磁盘内容（清快照） */
  const dismissStored = useCallback(() => {
    setStored(null);
  }, []);

  /** 丢弃存储草稿 */
  const discardStored = useCallback(() => {
    clearDraft(draftId);
    setStored(null);
  }, [draftId]);

  /** 主动放弃创作：清除草稿快照 + 脏状态（下次新建呈现干净空态） */
  const clearAll = useCallback(() => {
    clearDraft(draftId);
    setStored(null);
    markDirty(false);
  }, [draftId, markDirty]);

  return {
    draft,
    dirty,
    stored,
    setDraftSilently,
    patch,
    persistIfDirty,
    markClean,
    restoreStored,
    dismissStored,
    discardStored,
    clearAll,
  };
}