/**
 * PLAN-13 工作流 S：用途速览状态 Hook。
 * 生成走 @/lib/summary-api（前端 LLM），生成后重读磁盘保持一致。
 */

import { useState, useEffect, useCallback } from "react";
import { loadSummaries, writeSummary, type SummariesData, type Summary } from "@/lib/api";
import { generateSkillSummary } from "@/lib/summary-api";

const EMPTY: SummariesData = { version: 1, summaries: {} };

export interface UseSummariesApi {
  data: SummariesData;
  loading: boolean;
  get: (skillId: string) => Summary | undefined;
  /** 生成并持久化；onDelta 供流式展示原始输出 */
  generate: (
    skillId: string,
    skillMd: string,
    onDelta?: (delta: string) => void,
    abortSignal?: AbortSignal
  ) => Promise<void>;
  /** 手动编辑并持久化（不依赖 AI；model=static）；sourceHash 由调用方按当前正文计算 */
  save: (
    skillId: string,
    when: string,
    input: string,
    output: string,
    sourceHash: string
  ) => Promise<void>;
}

export function useSummaries(): UseSummariesApi {
  const [data, setData] = useState<SummariesData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadSummaries());
    } catch {
      // 速览是增强项：读取失败回落空数据，不阻塞主流程
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const get = useCallback(
    (skillId: string) => data.summaries[skillId],
    [data]
  );

  const generate = useCallback(
    async (
      skillId: string,
      skillMd: string,
      onDelta?: (delta: string) => void,
      abortSignal?: AbortSignal
    ) => {
      await generateSkillSummary(skillId, skillMd, onDelta, abortSignal);
      await refresh();
    },
    [refresh]
  );

  const save = useCallback(
    async (
      skillId: string,
      when: string,
      input: string,
      output: string,
      sourceHash: string
    ) => {
      await writeSummary({ skillId, when, input, output, sourceHash, model: "static" });
      await refresh();
    },
    [refresh]
  );

  return { data, loading, get, generate, save };
}
