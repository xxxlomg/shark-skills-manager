/**
 * PLAN-13 工作流 S：技能用途速览生成编排。
 * 统一 AI 层（@/lib/ai）调用 LLM → 解析 JSON 契约 → 持久化 summaries.json。
 * 与翻译同架构：LLM 请求在前端，Rust 仅存。
 */

import { requireLLMConfig, callLLMStream } from "@/lib/ai";
import { buildSkillSummaryPrompt } from "@/lib/ai/prompts";
import { writeSummary } from "@/lib/api";
import { sha256Hex } from "@/lib/translate-api";

export interface SummaryResult {
  when: string;
  input: string;
  output: string;
  model: string;
}

/**
 * 生成并持久化一条用途速览。
 * @param skillId  技能稳定键（v0.2：tool_id|rel）
 * @param skillMd  SKILL.md 原文（哈希用于失效检测）
 */
export async function generateSkillSummary(
  skillId: string,
  skillMd: string,
  onDelta?: (delta: string) => void,
  abortSignal?: AbortSignal
): Promise<SummaryResult> {
  const config = requireLLMConfig();
  const prompt = buildSkillSummaryPrompt(skillMd);

  const { text, finishReason, reasoningChunks } = await callLLMStream(
    prompt,
    config.apiKey,
    config.baseUrl,
    config.model,
    (delta) => onDelta?.(delta),
    abortSignal
  );

  if (!text.trim()) {
    throw new Error(
      reasoningChunks > 0
        ? "模型只返回了推理内容、未返回速览——思考模式消耗了全部 max_tokens 预算"
        : "模型返回内容为空，速览生成失败"
    );
  }
  if (finishReason === "length") {
    throw new Error("模型输出达到 max_tokens 上限被截断，速览生成失败");
  }

  const parsed = parseSummaryJson(text);
  const sourceHash = await sha256Hex(skillMd);
  await writeSummary({
    skillId,
    when: parsed.when,
    input: parsed.input,
    output: parsed.output,
    sourceHash,
    model: config.model,
  });

  return { ...parsed, model: config.model };
}

/**
 * 解析 LLM 输出的速览 JSON（容错：剥代码围栏 / 截取首个 {...}）。
 * 解析失败抛错，由 UI 提示重试（PLAN-11 容错模式）。
 */
export function parseSummaryJson(
  text: string
): { when: string; input: string; output: string } {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const obj = JSON.parse(s);
    const when = String(obj?.when ?? "").trim();
    const input = String(obj?.input ?? "").trim();
    const output = String(obj?.output ?? "").trim();
    if (!when && !input && !output) throw new Error("all fields empty");
    return { when, input, output };
  } catch {
    throw new Error("速览解析失败：模型输出不是合法 JSON，请重试");
  }
}
