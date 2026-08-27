# 统一 AI 层

本产品所有 AI 能力都从这里走：**LLM 调用客户端**（`client.ts`）+ **各模块 prompt**（`prompts/`）。

## 为什么建这层

- **全局 AI 统一用设置页配置**：`config.json` 里的 LLM（api_key / base_url / model）
  由 `@/lib/llm-config` 读取，`client.ts` 的 `requireLLMConfig()` 是所有调用的统一入口
  （未配 Key 统一抛「请先在设置中配置 API Key」）。翻译、AI 创作、连接测试都走它。
- **prompt 集中管理**：不同模块的 prompt 模板统一放在 `prompts/` 一个文件夹，
  维护时只改这里，不用翻业务代码。

## 目录结构

```
src/lib/ai/
├── client.ts          # callLLMStream（SSE 流式）、testLLMConnection、requireLLMConfig
├── prompts/
│   ├── translate.ts   # 翻译 prompt（英→中）：buildTranslatePrompt、分块阈值
│   ├── authoring.ts   # 创作 prompt（直出 SKILL.md）：buildAuthoringPrompt
│   └── index.ts       # prompt 统一出口
└── index.ts           # 业务代码统一从这里 import
```

## 使用约定

- 业务代码从 `@/lib/ai` 或 `@/lib/ai/prompts` import，不要直接 import 子模块内部。
- LLM 调用走 `callLLMStream(prompt, apiKey, baseUrl, model, onDelta)`；
  需要「未配 Key 即报错」时先调 `requireLLMConfig()`。
- 新增一个使用 AI 的模块：在 `prompts/` 下加一个文件，并在 `prompts/index.ts` 导出。

## 说明

- LLM 请求目前在前端发起（需要 SSE 流式）。Rust（Tauri）只负责存储 config.json
  与暴露明文 key（`get_llm_api_key`），不直接发 LLM 请求。
- 创作台 description 即「我的描述」单输入（PLAN-11 阶段 0 删「何时用」），
  派生在 `AuthoringWorkbench.tsx` 的 `buildDesc`；使用场景由能力 1「优化描述」补全。