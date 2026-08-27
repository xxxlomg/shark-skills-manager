/**
 * 翻译：统一 AI 层（@/lib/ai）+ 磁盘持久化（Tauri invoke）。
 * LLM 调用与 prompt 已抽到 @/lib/ai（client + prompts），本文件只做翻译编排与落盘。
 */

import { invoke } from "@tauri-apps/api/core";
import { requireLLMConfig, callLLMStream } from "@/lib/ai";
import {
  buildTranslatePrompt,
  TRANSLATE_CHUNK_SIZE,
} from "@/lib/ai/prompts";
import { isMockMode, MOCK_SKILLS } from "@/mock";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// 翻译
// ---------------------------------------------------------------------------

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > TRANSLATE_CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface TranslateResult {
  bilingualHtml: string;
  bilingualText: string;
  titleZh: string;
  model: string;
}

/**
 * 执行翻译：LLM 直调 + 分块 + 磁盘持久化
 */
export async function translateSkill(
  skillId: string,
  rawContent: string,
  sourcePath: string,
  scanLabel: string,
  onProgress?: (fullSoFar: string, chunkIndex: number, totalChunks: number) => void,
  /** 用户点「停止翻译」时 abort；分块间与块内 LLM 调用都会响应 */
  abortSignal?: AbortSignal
): Promise<TranslateResult> {
  const config = requireLLMConfig();

  const chunks = splitIntoChunks(rawContent);
  const translatedChunks: string[] = [];
  // 已完成块的译文，用于流式回调时拼接「到目前为止的完整译文」
  let completed = "";

  for (let i = 0; i < chunks.length; i++) {
    // 分块间隙：用户已点停止 → 立即中止，不进下一块
    if (abortSignal?.aborted) {
      const e = new DOMException("翻译已取消", "AbortError");
      throw e;
    }
    const prompt = buildTranslatePrompt(chunks[i]);
    let buffer = "";
    const { text: translated, finishReason, reasoningChunks } =
      await callLLMStream(
        prompt,
        config.apiKey,
        config.baseUrl,
        config.model,
        (delta) => {
          buffer += delta;
          onProgress?.(completed + buffer, i, chunks.length);
        },
        abortSignal
      );
    // 防御：拒绝「HTTP 200 但空译文」的假成功（此前会静默写入空翻译）
    if (!translated.trim()) {
      throw new Error(
        reasoningChunks > 0
          ? "模型只返回了推理内容、未返回译文——思考模式消耗了全部 max_tokens 预算。请确认模型支持关闭思考模式或改用非推理模型"
          : "模型返回内容为空，翻译失败"
      );
    }
    if (finishReason === "length") {
      throw new Error(
        "模型输出达到 max_tokens 上限被截断，译文不完整已中止。该文档过长，请拆分后重试"
      );
    }
    translatedChunks.push(translated);
    completed += translated + "\n\n";
  }

  const fullTranslation = translatedChunks.join("\n\n");

  // 提取中文标题
  const titleMatch = fullTranslation.match(/^#\s+(.+)$/m);
  const titleZh = titleMatch ? titleMatch[1].trim() : "";

  // 构建双语对照（anchor 格式，兼容 bilingual.ts 解析）
  const originalLines = rawContent.split("\n");
  const translatedLines = fullTranslation.split("\n");
  const bilingualHtmlParts: string[] = [];
  const maxLen = Math.max(originalLines.length, translatedLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = originalLines[i] ?? "";
    const trans = translatedLines[i] ?? "";
    if (orig || trans) {
      bilingualHtmlParts.push(
        `<div class="bilingual-row"><span class="orig">${escapeHtml(orig)}</span><span class="trans">${escapeHtml(trans)}</span></div>`
      );
    }
  }
  const bilingualHtml = bilingualHtmlParts.join("\n");

  // 构建 anchor 格式文本（用于磁盘存储 + bilingual.ts 解析）
  const bilingualText =
    `<!-- anchor:original -->\n${rawContent}\n` +
    `<!-- anchor:translated -->\n${fullTranslation}\n`;

  // 持久化到磁盘（Tauri invoke）
  const sourceHash = await computeHash(rawContent);
  await invoke("write_translation", {
    skillId,
    bilingualText,
    sourcePath,
    scanLabel,
    sourceHash,
    model: config.model,
    titleZh,
  });

  return { bilingualHtml, bilingualText, titleZh, model: config.model };
}

/**
 * 读取已翻译内容（从磁盘）
 */
export async function loadTranslation(skillId: string): Promise<string | null> {
  if (isMockMode()) {
    const s = MOCK_SKILLS.find((m) => m.id === skillId);
    if (s?.has_translation) {
      return [
        "<!-- anchor:original -->",
        `# ${s.name}\n\n${s.description}`,
        "<!-- anchor:translated -->",
        `# ${s.title_zh || s.name}\n\n${s.description_zh || s.description}`,
      ].join("\n");
    }
    return null;
  }
  try {
    return await invoke<string>("read_translation", { skillId });
  } catch {
    return null;
  }
}

/**
 * 读取已翻译内容的双语 HTML
 */
export async function loadTranslationHtml(skillId: string): Promise<string | null> {
  const text = await loadTranslation(skillId);
  if (!text) return null;
  return textToBilingualHtml(text);
}

function textToBilingualHtml(text: string): string {
  const lines = text.split("\n");
  const rows: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const orig = lines[i] ?? "";
    const trans = lines[i + 1] ?? "";
    if (orig || trans) {
      rows.push(
        `<div class="bilingual-row"><span class="orig">${escapeHtml(orig)}</span><span class="trans">${escapeHtml(trans)}</span></div>`
      );
    }
  }
  return rows.join("\n");
}

async function computeHash(text: string): Promise<string> {
  return sha256Hex(text);
}

/** SHA-256 hex（PLAN-13 S 速览失效检测复用） */
export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
