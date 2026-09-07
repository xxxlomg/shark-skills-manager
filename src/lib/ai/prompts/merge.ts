/**
 * 阶段 3 工作流 M：智能合并 —— AI 润色 prompt（D6：可选路径，激进选择权归用户）。
 * 维护提示：改这里即可，无需动调用方。
 */

export const MERGE_POLISH_INPUT_CAP = 12000;

/**
 * 只做三件事：去重复表述、顺句子、统一术语。
 * 禁止增删事实、禁止改 frontmatter、禁止改变 Markdown 结构层级。
 */
export function buildMergePolishPrompt(mergedSkillMd: string): string {
  const body =
    mergedSkillMd.length > MERGE_POLISH_INPUT_CAP
      ? mergedSkillMd.slice(0, MERGE_POLISH_INPUT_CAP) + "\n…（正文过长已截断）"
      : mergedSkillMd;
  return [
    "你是 Markdown 技能文档编辑专家。下面是一份由两份相似技能『智能合并』得到的 SKILL.md 草稿。",
    "请对它做一次【保守润色】，并且只允许做三件事：",
    "1. 去重复表述：两份原文拼接后可能出现的重复段落/重复要点，合并成一份；",
    "2. 顺句子：把拼接处生硬、断裂的句子理顺；",
    "3. 统一术语：同一概念在全文使用同一叫法。",
    "",
    "严格禁止：",
    "- 禁止增删任何事实、步骤、参数、示例（正文里出现过的可以整理，但绝不能新造或删掉）；",
    "- 禁止修改 frontmatter（--- 包裹的部分原样保留）；",
    "- 禁止改变 Markdown 标题层级结构；",
    "- 不要输出任何解释文字，直接输出润色后的完整 SKILL.md 原文。",
    "",
    "---",
    body,
  ].join("\n");
}