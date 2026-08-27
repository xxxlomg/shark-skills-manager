import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { translateSkill } from "@/lib/translate-api";
import { readSkillFile } from "@/lib/api";
import { loadLLMConfig } from "@/lib/llm-config";
import type { Skill } from "@/hooks/useSkills";

interface BatchState {
  /** 当前正在翻译的是第几个（1 起） */
  current: number;
  total: number;
  /** 当前正在翻译的技能名（供进度可观测） */
  name: string;
}

/**
 * 批量翻译队列：顺序翻译一组 skill，单个失败不中断整体。
 * 支持「停止」：内部持有 AbortController，分块间隙与 LLM 流内都会响应；
 * 进度对外暴露 current/total/name，便于 UI 展示「翻译到第几个 / 当前是谁」。
 * 内置重入锁，防止重复触发。
 */
export function useBatchTranslate(opts: {
  onNeedSettings?: () => void;
  onDone?: () => void;
}) {
  const { onNeedSettings, onDone } = opts;
  const [batch, setBatch] = useState<BatchState | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(
    async (skills: Skill[]) => {
      const targets = skills.filter((s) => !s.has_translation && !s.source_deleted);
      if (runningRef.current || targets.length === 0) return;

      // 预检 API Key，避免队列中途整体失败
      const cfg = await loadLLMConfig().catch(() => ({ hasKey: false }));
      if (!cfg.hasKey) {
        toast.error("请先在设置中配置 API Key");
        onNeedSettings?.();
        return;
      }

      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      let ok = 0;
      let fail = 0;
      let stopped = false;
      const total = targets.length;

      for (let i = 0; i < total; i++) {
        // 队列间隙：用户已点停止 → 不再进入下一个
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }
        const s = targets[i];
        setBatch({ current: i + 1, total, name: s.title_zh || s.name });
        try {
          const raw = await readSkillFile(s.source_path);
          await translateSkill(s.id, raw, s.source_path, s.scan_label, undefined, controller.signal);
          ok++;
        } catch {
          // 停止导致的 abort 不计入失败，直接退出队列
          if (controller.signal.aborted) {
            stopped = true;
            break;
          }
          fail++;
        }
      }

      setBatch(null);
      runningRef.current = false;
      abortRef.current = null;

      if (stopped) {
        toast.warning(`已停止批量翻译：成功 ${ok}，未完成 ${total - ok - fail}`);
      } else if (fail === 0) {
        toast.success(`批量翻译完成：${ok} 个技能`);
      } else {
        toast.warning(`批量翻译完成：成功 ${ok}，失败 ${fail}`);
      }
      onDone?.();
    },
    [onNeedSettings, onDone]
  );

  return { batch, running: batch !== null, run, stop };
}
