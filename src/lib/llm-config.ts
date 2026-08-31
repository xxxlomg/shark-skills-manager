/**
 * LLM 配置管理 — 通过 Tauri invoke 读写数据目录 config.json
 * v0.2（B5 收尾）：工具管理改走 hub_*_tool 命令，此处只管 LLM。
 */

import { invoke } from "@tauri-apps/api/core";
import type { MaskedConfig } from "./api";

export type ThinkingMode = "enabled" | "disabled";
export type ReasoningEffort = "low" | "high" | "max";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 思考模式（默认关；仅 DeepSeek 端点发送且开启时附带） */
  thinking: ThinkingMode;
  /** 思考强度（默认 low；思考关闭时不发送） */
  reasoningEffort: ReasoningEffort;
}

export const LLM_DEFAULTS = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  thinking: "disabled" as ThinkingMode,
  reasoningEffort: "low" as ReasoningEffort,
};

const DEFAULT_LLM: LLMConfig = {
  apiKey: "",
  baseUrl: LLM_DEFAULTS.baseUrl,
  model: LLM_DEFAULTS.model,
  thinking: LLM_DEFAULTS.thinking,
  reasoningEffort: LLM_DEFAULTS.reasoningEffort,
};

let cachedConfig: (LLMConfig & { hasKey: boolean }) | null = null;

/** 从 Rust 端加载配置 */
export async function loadLLMConfig(): Promise<LLMConfig & { hasKey: boolean }> {
  try {
    // load_config 返回脱敏 key（仅用于"是否已配置"指示与 base_url/model），
    // 实际发请求需明文 key，故并行取 get_llm_api_key。
    const [cfg, rawKey] = await Promise.all([
      invoke<MaskedConfig>("load_config"),
      invoke<string>("get_llm_api_key"),
    ]);
    cachedConfig = {
      apiKey: rawKey,
      baseUrl: cfg.llm.base_url,
      model: cfg.llm.model,
      thinking: cfg.llm.thinking === "enabled" ? "enabled" : "disabled",
      reasoningEffort:
        cfg.llm.reasoning_effort === "high" || cfg.llm.reasoning_effort === "max"
          ? cfg.llm.reasoning_effort
          : "low",
      hasKey: cfg._has_key,
    };
    return cachedConfig;
  } catch {
    return { ...DEFAULT_LLM, hasKey: false };
  }
}

/** 获取当前 LLM 配置（同步，使用缓存） */
export function getLLMConfig(): LLMConfig {
  if (cachedConfig) {
    return {
      apiKey: cachedConfig.apiKey,
      baseUrl: cachedConfig.baseUrl,
      model: cachedConfig.model,
      thinking: cachedConfig.thinking,
      reasoningEffort: cachedConfig.reasoningEffort,
    };
  }
  return DEFAULT_LLM;
}

/** 保存配置到 Rust 端（仅 LLM；tools 不在本通道） */
export async function saveLLMConfig(llm: LLMConfig): Promise<void> {
  await invoke("save_config", {
    llmApiKey: llm.apiKey,
    llmBaseUrl: llm.baseUrl,
    llmModel: llm.model,
    llmThinking: llm.thinking,
    llmReasoningEffort: llm.reasoningEffort,
  });
  cachedConfig = { ...llm, hasKey: !!llm.apiKey };
}
