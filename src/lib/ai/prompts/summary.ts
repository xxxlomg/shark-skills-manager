/**
 * PLAN-13 工作流 S：技能用途速览 prompt（固定模板三段式）。
 * 维护提示：改这里即可，无需动调用方。
 */

/** SKILL.md 截断上限：速览只需主旨，超长正文截断省 token */
export const SUMMARY_INPUT_CAP = 8000;

export function buildSkillSummaryPrompt(skillMd: string): string {
  const body =
    skillMd.length > SUMMARY_INPUT_CAP
      ? skillMd.slice(0, SUMMARY_INPUT_CAP) + "\n…（正文过长已截断）"
      : skillMd;
  return [
    "你是 AI 技能文档分析专家。请根据下方 SKILL.md 内容，为用户生成一份结构化的用途速览。",
    "要求输出严格 JSON（不要输出任何其他文字、解释或代码围栏），固定三个字段：",
    '- when：何时调用——用户说什么话/什么场景下该技能会被用到（1~2 句）',
    '- input：需要什么输入——使用前提与必要输入，如参数/文件/环境/依赖（1~2 句；确无则写"无"）',
    '- output：最终输出什么——执行完毕的产物与效果（1~2 句）',
    "语言：中文；简洁直白，直接说结论，不复述原文。",
    "",
    "输出格式示例：",
    '{"when":"用户要求批量重命名文件时","input":"目标文件夹路径 + 命名规则","output":"重命名完成的文件清单"}',
    "",
    "---",
    body,
  ].join("\n");
}
