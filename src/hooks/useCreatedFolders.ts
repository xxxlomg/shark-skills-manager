/**
 * 新建文件夹可见性（2026-08-07 反馈 2）：
 * 技能库树/卡片由 skills 派生，0 技能的纯空文件夹会被过滤掉，导致「新建无效」。
 * 这里维护一份本会话新建的空文件夹清单（持久化到 localStorage），
 * 让树与卡片立即显示它；一旦文件夹里有了真实技能，由扫描结果自然展示，
 * 本清单仅做去重补充（已存在的同名不重复渲染）。
 */

import { useCallback, useState } from "react";

export interface CreatedFolder {
  /** 工具（scan_label） */
  label: string;
  /** 合集名；null = 全新工具根（无父级选择） */
  collection: string | null;
}

const KEY = "sm:created-folders";

function read(): CreatedFolder[] {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return [];
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.label === "string") : [];
  } catch {
    return [];
  }
}

export function useCreatedFolders() {
  const [folders, setFolders] = useState<CreatedFolder[]>(read);

  const addFolder = useCallback((label: string, collection: string | null) => {
    setFolders((prev) => {
      // 去重：同 label+collection 只记一次
      const next = prev.some(
        (f) => f.label === label && f.collection === collection
      )
        ? prev
        : [...prev, { label, collection }];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { folders, addFolder };
}