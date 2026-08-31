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
  /** 完整的思考过程文本（仅内存可视化用，不持久化） */
  thinking: string;
}

/** LLM 对话消息（OpenAI 风格三态） */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 会话输入 token 护栏：达到 DeepSeek 1M 窗口的 80% 时拒绝发送（不静默裁剪） */
const CONTEXT_GUARD_TOKENS = 800_000;

/** 粗估 token：中英混合每 ~2.5 字符 ≈ 1 token */
function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 2.5);
}

/**
 * 流式调用 LLM（SSE）。每收到一段增量文本就回调 onDelta，返回完整文本。
 * onThinking：思考模式下的 reasoning_content 流（仅内存可视化，不持久化）。
 * 采用空闲超时：每次收到数据重置计时器，仅在长时间无响应时 abort，
 * 避免长文本块因固定总超时被误杀。
 *
 * DeepSeek 注意：v4 系列思考模式默认开启，推理内容走 reasoning_content 且
 * 计入 max_tokens 预算——会出现「HTTP 200 + [DONE] 但 content 为空」。
 * 本客户端默认显式禁用思考模式。
 */
/**
 * SSE 核心：组装请求体并按前缀稳定顺序发送（命中 DeepSeek KV Cache）。
 * messages[0] 通常是 system；历史只追加不改写、不裁剪、不重排。
 */
async function streamChat(
  messages: ChatMessage[],
  apiKey: string,
  baseUrl: string,
  model: string,
  onDelta: (delta: string) => void,
  externalSignal?: AbortSignal,
  onThinking?: (delta: string) => void
): Promise<StreamResult> {
  // 护栏：输入估算超窗（80% of 1M）→ 拒绝发送，提示新建会话；不做静默裁剪
  if (estimateTokens(messages) >= CONTEXT_GUARD_TOKENS) {
    throw new Error(
      "会话过长（接近 DeepSeek 上下文窗口上限），建议保存当前技能后新建技能继续。"
    );
  }
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
    // 思考参数取自全局配置（设置页保存）：仅 DeepSeek 端点发送；
    // 关闭思考时 thinking/reasoning_effort 都不发（API 默认行为即非思考）。
    let thinkingEnabled = false;
    let reasoningEffort: string = "low";
    try {
      const llmCfg = getLLMConfig();
      thinkingEnabled = llmCfg.thinking === "enabled";
      reasoningEffort = llmCfg.reasoningEffort ?? "low";
    } catch {
      // 配置缓存不可用时按默认关闭思考
    }
    const isDeepseek = baseUrl.includes("deepseek");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        // 思考模型忽略温度参数：开启思考时不发 temperature，关闭时保留 0.3
        ...(thinkingEnabled ? {} : { temperature: 0.3 }),
        // DeepSeek 输出上限 8192；与翻译 CHUNK_SIZE=10000 匹配，防止译文被截断
        max_tokens: 8192,
        stream: true,
        // 仅 DeepSeek 端点发送思考参数（其他 OpenAI 兼容服务可能不识别而报 400）
        ...(isDeepseek && thinkingEnabled
          ? { thinking: { type: "enabled" }, reasoning_effort: reasoningEffort }
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
    let thinking = "";

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
          // 思考模式的推理内容：不计入正文，仅用于可视化（不持久化）
          const reasoningDelta = choice?.delta?.reasoning_content ?? "";
          if (reasoningDelta) {
            reasoningChunks++;
            thinking += reasoningDelta;
            onThinking?.(reasoningDelta);
          }
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
    return { text: full, finishReason, reasoningChunks, thinking };
  } finally {
    clearTimeout(idleTimer);
    externalSignal?.removeEventListener("abort", cancel);
  }
}

/**
 * 流式调用 LLM（SSE）。每收到一段增量文本就回调 onDelta，返回完整文本。
 * onThinking：思考模式下的 reasoning_content 流（仅内存可视化，不持久化）。
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
  externalSignal?: AbortSignal,
  /** 思考过程流（开思考时逐块回调；不持久化） */
  onThinking?: (delta: string) => void
): Promise<StreamResult> {
  return streamChat(
    [{ role: "user", content: prompt }],
    apiKey,
    baseUrl,
    model,
    onDelta,
    externalSignal,
    onThinking
  );
}

/**
 * 多轮对话调用（T4 正式 Agent 体系）：system + 历史消息 + 本轮指令。
 * 前缀稳定追加（命中 KV Cache）；输入超 800K token 护栏拒绝发送。
 */
export async function callLLMChat(opts: {
  system?: string;
  messages: ChatMessage[];
  apiKey: string;
  baseUrl: string;
  model: string;
  onDelta: (delta: string) => void;
  externalSignal?: AbortSignal;
  onThinking?: (delta: string) => void;
}): Promise<StreamResult> {
  const combined: ChatMessage[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    ...opts.messages,
  ];
  return streamChat(
    combined,
    opts.apiKey,
    opts.baseUrl,
    opts.model,
    opts.onDelta,
    opts.externalSignal,
    opts.onThinking
  );
}

/**
 * 测试 LLM 连接（设置页保存前试探，config 为候选值，未落盘）。
 * 思考参数按候选值发送，与保存后的真实请求行为一致。
 */
export async function testLLMConnection(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "low" | "high" | "max";
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
        ...(config.baseUrl.includes("deepseek") && config.thinking === "enabled"
          ? {
              thinking: { type: "enabled" },
              reasoning_effort: config.reasoningEffort ?? "low",
            }
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