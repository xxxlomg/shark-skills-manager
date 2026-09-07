/**
 * 阶段 1：共享身份语言 —— 重复组成员按内容聚合为「变体」。
 *
 * DupPanel 与统一合并工作台共用本文件（单一来源），保证字母/色标/推荐序
 * 在「查重 → 工作台 → 保存」全链路一贯（P7）。
 *
 * 概念：
 *  - 变体（Variant）= 同一 body_hash 的成员聚合；rep 为变体内推荐代表；
 *  - 字母按 score 降序赋 A…，A = 推荐基准；
 *  - 相同副本（变体内的非 rep 成员）不进决策、不进流水线 rail。
 */
import type { DupGroup, DupMember } from "@/lib/api";

/** 工具色标（身份语言：与工作台「取 A/取 B」一贯） */
export const TOOL_DOT: Record<string, string> = {
  "claude-code": "bg-orange-500",
  claude: "bg-orange-500",
  codex: "bg-emerald-500",
  imported: "bg-sky-500",
  authored: "bg-violet-500",
  builtin: "bg-zinc-400",
};

export function toolDot(toolId: string): string {
  return TOOL_DOT[toolId] ?? "bg-zinc-400";
}

/** 路径尾两段（…/a-docker-ps），同名成员的首要区分信息 */
export function pathTail(p: string): string {
  const parts = p.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts.slice(-2).join("/");
}

/** 推荐基准打分：内容更完整（body_len）+ 已翻译加分 + 较新加分 */
export function scoreOf(m: DupMember): number {
  return m.body_len + (m.has_translation ? 1000 : 0) + Math.floor(m.mtime / 100000);
}

/** 内容变体：同 body_hash 的成员聚合；rep = 变体内推荐代表 */
export interface Variant {
  letter: string;
  rep: DupMember;
  members: DupMember[];
}

/** 按 body_hash 聚合成员为变体，按 score 降序赋字母 A… */
export function buildVariants(g: DupGroup): Variant[] {
  const byHash = new Map<string, DupMember[]>();
  for (const m of g.members) {
    const k = m.body_hash ?? `solo:${m.skill_id}`;
    const arr = byHash.get(k) ?? [];
    arr.push(m);
    byHash.set(k, arr);
  }
  const vs = [...byHash.values()].map((members) => {
    const sorted = [...members].sort((a, b) => scoreOf(b) - scoreOf(a));
    return { rep: sorted[0], members: sorted };
  });
  vs.sort((a, b) => scoreOf(b.rep) - scoreOf(a.rep));
  return vs.map((v, i) => ({ ...v, letter: String.fromCharCode(65 + i) }));
}

/** 推荐理由：取 score 主导项（内容最完整 / 较新 / 已翻译），供基准下拉与 rail 展示 */
export function recommendReason(v: Variant, all: Variant[]): string {
  const reasons: string[] = [];
  const maxLen = Math.max(...all.map((x) => x.rep.body_len));
  const maxMt = Math.max(...all.map((x) => x.rep.mtime));
  if (v.rep.body_len > 0 && v.rep.body_len === maxLen) reasons.push("内容最完整");
  if (v.rep.mtime > 0 && v.rep.mtime === maxMt) reasons.push("较新");
  if (v.rep.has_translation) reasons.push("已翻译");
  return reasons.join("·") || "综合评分最高";
}
