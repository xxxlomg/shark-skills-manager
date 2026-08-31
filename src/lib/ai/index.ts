/**
 * 统一 AI 层出口：LLM 调用客户端 + 各模块 prompt。
 * 业务代码从这里 import，不要直接 import prompts 子模块。
 */
export {
  callLLMStream,
  callLLMChat,
  testLLMConnection,
  requireLLMConfig,
  type StreamResult,
  type ChatMessage,
} from "./client";
export * as prompts from "./prompts";