/**
 * 中英对照解析
 * 翻译文件格式（由 translate.py 生成）：
 *   <!-- anchor:original --> <原文块> <!-- anchor:translated --> <译文块> ...
 */

export interface BilingualContent {
  originals: string[];
  translated: string[];
  header: string;
}

export function parseBilingual(text: string): BilingualContent {
  const parts = String(text).split(
    /<!--\s*anchor:(original|translated)\s*-->/,
  );
  const originals: string[] = [];
  const translated: string[] = [];
  let mode: string | null = null;

  // parts[0] 是前置内容（frontmatter 等），之后交替 original/translated
  for (let i = 1; i < parts.length; i++) {
    if (i % 2 === 1) {
      mode = parts[i].trim();
    } else {
      const content = parts[i].replace(/^\n+|\n+$/g, "");
      if (mode === "original") originals.push(content);
      else if (mode === "translated") translated.push(content);
    }
  }

  return { originals, translated, header: parts[0] || "" };
}
