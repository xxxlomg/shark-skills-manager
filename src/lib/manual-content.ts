/**
 * 手册内容装配（PLAN-10 P1）：章节 markdown 以 ?raw 导入，
 * 白皮书式维护：加章节 = 加文件 + 登记一行。
 *
 * 截图管线：截图落 frontend/public/manual/img/，markdown 中以
 * 绝对路径引用（如 ![技能库首页](/manual/img/lib-home.png)）。
 */
import quickstart from "@/assets/manual/01-quickstart.md?raw";
import features from "@/assets/manual/02-features.md?raw";
import faq from "@/assets/manual/03-faq.md?raw";
import changelog from "@/assets/manual/04-changelog.md?raw";

export interface ManualChapter {
  /** 锚点 id（TOC 与正文对应） */
  id: string;
  /** 章节正文（含一级标题） */
  body: string;
}

export const MANUAL_CHAPTERS: ManualChapter[] = [
  { id: "quickstart", body: quickstart },
  { id: "features", body: features },
  { id: "faq", body: faq },
  { id: "changelog", body: changelog },
];

export interface TocEntry {
  /** 锚点 id */
  id: string;
  /** 标题文本 */
  title: string;
  /** 层级：1 = 章节（h1），2 = 小节（h2） */
  level: 1 | 2;
}

/** 从章节正文解析一级标题（# ）作为章节名 */
export function chapterTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "未命名章节";
}

/** 解析二级标题（## ）作为小节名，返回 [锚点 id, 标题] 列表 */
export function sectionHeadings(body: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const lines = body.split("\n");
  let idx = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      out.push({ id: `s${idx}`, title: m[1].trim() });
      idx++;
    }
  }
  return out;
}

/**
 * 按二级标题把章节正文切成块：第 0 块是首个 ## 之前的引子，
 * 之后每块含自己的 ## 标题行。渲染时每块包一层带 id 的容器供 TOC 跳转。
 */
export function splitSections(body: string): string[] {
  const lines = body.split("\n");
  const blocks: string[][] = [[]];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^##\s+/.test(line) && blocks[blocks.length - 1].length > 0) {
      blocks.push([]);
    }
    blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => b.join("\n")).filter((b) => b.trim() !== "");
}

/** 生成完整 TOC（章节 + 小节） */
export function buildToc(chapters: ManualChapter[]): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const ch of chapters) {
    toc.push({ id: ch.id, title: chapterTitle(ch.body), level: 1 });
    for (const s of sectionHeadings(ch.body)) {
      toc.push({ id: `${ch.id}-${s.id}`, title: s.title, level: 2 });
    }
  }
  return toc;
}
