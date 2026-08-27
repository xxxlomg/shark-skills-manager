/**
 * PLAN-14 工作流 B：勾选集 Hook（D3 临时语义）。
 * 纯前端临时状态，只在「全部技能」页内有效；切走即清空，不持久化。
 */

import { useState, useCallback } from "react";

export function useBatchSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** 批量设置一组 id 的选中态（全选/取消某批） */
  const setMany = useCallback((ids: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const count = selected.size;

  return { selected, toggle, setMany, clear, isSelected, count };
}