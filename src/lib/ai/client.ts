/**
 * 统一 LLM 调用层（前端直调，SSE 流式）。
 *
 * 说明：本产品所有 AI 能力（翻译、AI 创作、连接测试）都从这里发 LLM 请求，
 * 配置统一取自设置页写入的 config.json（见 @/lib/llm-config）——「全局 AI 都用
 * 配置项里定义的 API」，各模块只负责提供各自的 prompt（见 @/lib/ai/prompts/）。
 */

import { getLLMConfig, type LLMConfig } from "@/lib/llm-config";

/** 流式空闲超时：只要持续有数据返回就不超时，仅在长时间无响应时 abort */
const STREAM_IDLE_TIMEOUT = 30_000;

/** 读取全局 LLM 配置；未配置 API Key 时抛错（翻译 / AI 创作的统一入口） */
export function requireLLMConfig(): LLMConfig {
  const config = getLLMConfig();
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 API Key");
  }
  return config;
}

export interface StreamResult {
  text: string;
  finishReason: string;
  /** 收到的 reasoning_content 片段数（思考模式诊断用） */
  reasoningChunks: number;
}

/**
 * 流式调用 LLM（SSE）。每收到一段增量文本就回调 onDelta，返回完整文本。
 * 采用空闲超时：每次收到数据重置计时器，仅在长时间无响应时 abort，
 * 避免长文本块因固定总超时被误杀。
 *
 * DeepSeek 注意：v4 系列思考模式默认开启，推理内容走 reasoning_content 且
 * 计入 max_tokens 预算——会出现「HTTP 200 + [DONE] 但 content 为空」。
 * 本客户端默认显式禁用思考模式。
 */
export async function callLLMStream(
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  onDelta: (delta: string) => void,
  /** 外部中止信号（用户点「停止」时 abort）。与内部空闲超时共用同一 controller。 */
  externalSignal?: AbortSignal
): Promise<StreamResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (externalSignal) {
    // 外部已中止 → 立即随之中止；否则监听其 abort 事件
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", cancel, { once: true });
  }
  let idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT);
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        // DeepSeek 输出上限 8192；与翻译 CHUNK_SIZE=10000 匹配，防止译文被截断
        max_tokens: 8192,
        stream: true,
        // 默认禁思考/低推理成本。仅对 DeepSeek 端点发送（其他 OpenAI 兼容
        // 服务可能不识别该参数而报 400）。
        ...(baseUrl.includes("deepseek")
          ? { thinking: { type: "disabled" }, reasoning_effort: "low" }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM API 错误 ${response.status}: ${errText.slice(0, 200)}`);
    }
    if (!response.body) {
      throw new Error("LLM API 未返回流式响应体");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let full = "";
    let finishReason = "";
    let reasoningChunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      sseBuffer += decoder.decode(value, { stream: true });
      // SSE 以行分隔；保留最后一段可能不完整的行待下次拼接
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choice = json.choices?.[0];
          if (choice?.finish_reason) finishReason = String(choice.finish_reason);
          // 思考模式的推理内容：不计入正文，仅计数用于诊断
          if (choice?.delta?.reasoning_content) reasoningChunks++;
          const delta = choice?.delta?.content ?? "";
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // 忽略无法解析的行（心跳、注释等）
        }
      }
    }
    return { text: full, finishReason, reasoningChunks };
  } finally {
    clearTimeout(idleTimer);
    externalSignal?.removeEventListener("abort", cancel);
  }
}

/**
 * 测试 LLM 连接（设置页保存前试探，config 为候选值，未落盘）。
 */
export async function testLLMConnection(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        ...(config.baseUrl.includes("deepseek")
          ? { thinking: { type: "disabled" }, reasoning_effort: "low" }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`API 错误 ${response.status}: ${errText.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}