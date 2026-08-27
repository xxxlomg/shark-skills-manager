import type { SummariesData } from "@/lib/api";

/**
 * mock 用途速览（PLAN-13 工作流 S，?mock=1 预览用）。
 * 两个 builtin 演示技能预置三段式结构化速览（何时调用/输入/输出）。
 * source_hash = MOCK_RAW 的真实 SHA-256（与 readSkillFile 返回值一致），
 * 演示态不触发「内容已变化」失效标。
 */
const MOCK_RAW_HASH =
  "892eb5da3ea463d2c9f23a94b11caade5df335247890dd277f71e54ce72844ce";

export const MOCK_SUMMARIES: SummariesData = {
  version: 1,
  summaries: {
    b1: {
      when: "第一次打开 shark skills，或问「这个应用怎么用」时",
      input: "无需输入；按引导依次配置扫描源与 LLM Key 即可",
      output: "完成首跑配置：能浏览技能列表，并产出一份双语翻译",
      source_hash: MOCK_RAW_HASH,
      model: "mock-model",
      created_at: "2026-08-12T20:00:00+0800",
    },
    b2: {
      when: "想把若干技能打包分享给队友，或说「导出技能包」时",
      input: "在 Packs 页选择要打包的技能 + 包名",
      output: "一个可导入的 .skillpack 文件，队友一键安装",
      source_hash: MOCK_RAW_HASH,
      model: "mock-model",
      created_at: "2026-08-12T20:00:00+0800",
    },
  },
};
