/**
 * 翻译模块 prompt（技术文档 英 → 中）。
 * 维护提示：改这里即可，无需动调用方。
 */

/** 分块阈值：10000 字符 ≈ 2500 input tokens，译文约 5000~7500 output tokens，
 *  在 max_tokens=8192 内安全。常规 README（≤10000 字符）单次请求完成。 */
export const TRANSLATE_CHUNK_SIZE = 10000;

export function buildTranslatePrompt(chunk: string): string {
  return [
    "你是一个技术文档翻译专家。请将以下英文内容翻译为中文。",
    "要求：",
    "1. 保留所有 Markdown 格式（标题、代码块、列表等）",
    "2. 代码块内的代码不翻译，但代码块前后的说明文字要翻译",
    "3. 专业术语保留英文，首次出现时用括号标注中文",
    "4. 翻译要通顺、专业、准确",
    "5. 直接输出翻译结果，不要加任何前缀说明",
    "",
    "---",
    chunk,
  ].join("\n");
}