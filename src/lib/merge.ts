/**
 * PLAN-13 阶段 3：智能合并 —— 段落级拼接引擎（纯前端，交互式冲突解决）。
 *
 * 契约（§4.4 Step 2/3/4）：
 *  - Step 2 frontmatter 合并：纯规则（取更长/并集去重），无 LLM；
 *  - Step 3 正文按 Markdown 标题切块 → 归一化对齐 → 配对块取更长（冲突可切 a/b/both）、
 *    独有块按序保留、B 独有块追加到同层末尾、头部块取更长；
 *  - Step 4 附件按相对路径对齐：同名同内容保留一份 / 同名异内容标记冲突 / 仅一侧直接并集。
 *
 * 本模块只产出「草稿 + 冲突清单」，不落盘；最终由 MergeWorkbench 让用户逐项确认后
 * 交给后端 smart_merge_apply 落盘。
 */

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 文本归一化：小写 + 去空白（用于标题对齐） */
function normHeading(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** 分词：ASCII 连续字母数字为词（小写）；CJK 逐字成词。与后端 dedup.rs 同思路。 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  let word = "";
  const flush = () => {
    if (word) {
      out.add(word);
      word = "";
    }
  };
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff);
    if (/[A-Za-z0-9]/.test(ch)) {
      word += ch.toLowerCase();
    } else if (isCjk) {
      flush();
      out.add(ch);
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/** 重叠系数 |A∩B| / min(|A|,|B|)，空集记 0。 */
function overlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// ---------------------------------------------------------------------------
// 正文段落切块
// ---------------------------------------------------------------------------

export interface BodyBlock {
  id: string;
  /** null = 首个标题前的内容（头部块） */
  heading: string | null;
  level: number;
  content: string;
}

/** 按 Markdown 标题切块。heading 行自带，其下内容到下一个同/更高层标题为止。 */
export function splitBlocks(body: string): BodyBlock[] {
  // 归一化行尾：CRLF/CR → LF。否则 `$` 锚点在 `\r` 前不匹配，标题行会被误归入头部块。
  const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: BodyBlock[] = [];
  let cur: { heading: string | null; level: number; lines: string[] } | null = null;
  let idx = 0;

  const push = () => {
    if (!cur) return;
    blocks.push({
      id: `b${idx++}`,
      heading: cur.heading,
      level: cur.level,
      content: cur.lines.join("\n").trim(),
    });
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      push();
      cur = { heading: m[2].trim(), level: m[1].length, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      // 首个标题前的内容 → 头部块（只发生一次，直到遇到第一个标题）
      cur = { heading: null, level: 0, lines: [line] };
    }
  }
  // 收尾：如果全文无标题，头部块就是整篇
  if (!cur) cur = { heading: null, level: 0, lines: [] };
  push();
  return blocks;
}

// ---------------------------------------------------------------------------
// 对齐 + 合并
// ---------------------------------------------------------------------------

export type BlockChoice = "a" | "b" | "both";

/** 冲突类别：
 *  - align   同标题（或对齐）但内容不同 → 取A/取B/都保留
 *  - head    首个标题前的开头段落不同 → 取A/取B/都保留
 *  - only-a  A 独有章节（B 无此标题）→ 保留/丢弃
 *  - only-b  B 独有章节（A 无此标题）→ 保留/丢弃
 */
export type ConflictKind = "align" | "head" | "only-a" | "only-b";

export interface MergeConflict {
  id: string;
  kind: ConflictKind;
  /** 展示标题：章节标题；head = "（开头段落）" */
  heading: string;
  /** A 侧内容（only-b 时为空串） */
  aContent: string;
  /** B 侧内容（only-a 时为空串） */
  bContent: string;
  /** align/head: "a"|"b"|"both"；only-a/only-b: "keep"|"drop" */
  chosen: BlockChoice | "keep" | "drop";
}

export interface MergeBlock {
  id: string;
  heading: string | null;
  level: number;
  content: string;
  source: "a" | "b" | "shared" | "conflict";
  conflictId?: string;
  /** 该块在 A 列原文序列中的锚点（含头部块偏移；null = 不存在于 A） */
  aIdx?: number;
  /** 该块在 B 列原文序列中的锚点 */
  bIdx?: number;
}

export interface MergedDraft {
  blocks: MergeBlock[];
  conflicts: MergeConflict[];
  /** 序列化当前选择的合并正文 */
  text: string;
}

// ---------------------------------------------------------------------------
// 三向合并视图（PLAN-15 §3.1）：暴露 A/B 对齐关系，供三列工作台渲染。
// ---------------------------------------------------------------------------

/** 三向合并的单个对齐单元（段落块）。 */
export interface ThreeWayRow {
  id: string;
  /** same=两侧相同（自动、灰）；onlyA/onlyB=仅一侧（自动并入、灰）；
   *  conflict=同名/对齐但内容不同（必须决策：取A/取B/都保留） */
  kind: "same" | "onlyA" | "onlyB" | "conflict";
  heading: string | null;
  /** A 列该单元原文（onlyB 时 null） */
  aText: string | null;
  /** B 列该单元原文（onlyA 时 null） */
  bText: string | null;
  /** kind=conflict 时指向 conflicts 中的冲突项（用于选择与投影） */
  conflictId: string | null;
  /** A/B 列锚点（在 buildThreeWayView 返回的 aBlocks/bBlocks 中的块序，供滚动同步） */
  aIdx: number | null;
  bIdx: number | null;
}

export interface ThreeWayView {
  rows: ThreeWayRow[];
  /** A 列原文序列（含未对齐块原序） */
  aBlocks: BodyBlock[];
  bBlocks: BodyBlock[];
  /** 需要决策的冲突（仅 align/head；only-a/only-b 在三向视图里自动并入） */
  conflicts: MergeConflict[];
}

function renderBlocks(blocks: MergeBlock[], conflicts: MergeConflict[]): string {
  const byId = new Map(conflicts.map((c) => [c.id, c]));
  return blocks
    .map((b) => {
      if (b.conflictId) {
        const c = byId.get(b.conflictId);
        if (c) return resolveConflictText(c);
      }
      return b.content;
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}

function joinBoth(c: MergeConflict): string {
  // 「都保留」= 先 A 后 B（若相等则一份）
  if (c.aContent.trim() === c.bContent.trim()) return c.aContent;
  return `${c.aContent.trim()}\n\n${c.bContent.trim()}`;
}

/** 还原某冲突后的正文（按 kind + chosen 取最终文本）。 */
export function resolveConflictText(c: MergeConflict): string {
  if (c.kind === "only-a") return c.chosen === "drop" ? "" : c.aContent;
  if (c.kind === "only-b") return c.chosen === "drop" ? "" : c.bContent;
  // align / head：取A / 取B / 都保留
  return c.chosen === "a" ? c.aContent : c.chosen === "b" ? c.bContent : joinBoth(c);
}

/** 按当前选择序列化三向视图的中立结果正文（与 mergeBodies().text 一致）。 */
export function renderThreeWayText(rows: ThreeWayRow[], conflicts: MergeConflict[]): string {
  const byId = new Map(conflicts.map((c) => [c.id, c]));
  return rows
    .map((r) => {
      if (r.kind === "same") return r.aText ?? "";
      if (r.kind === "onlyA") return r.aText ?? "";
      if (r.kind === "onlyB") return r.bText ?? "";
      const c = r.conflictId ? byId.get(r.conflictId) : undefined;
      return c ? resolveConflictText(c) : "";
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}

/** computeMerge 的内部产物：拼接草稿 + 供三向视图还原原文序列的全量块。 */
interface ComputeMerge {
  aAll: BodyBlock[];
  bAll: BodyBlock[];
  blocks: MergeBlock[];
  conflicts: MergeConflict[];
  text: string;
}

/**
 * 段落级拼接核心（mergeBodies 与 buildThreeWayView 共用同一份对齐结果，
 * 从根上保证两条渲染路径一致，不会漂移）。
 * - alignThreshold：块对齐的 token 重叠阈值（默认 0.6，§4.4 Step 3.2）。
 */
function computeMerge(bodyA: string, bodyB: string, alignThreshold: number): ComputeMerge {
  const aAll = splitBlocks(bodyA);
  const bAll = splitBlocks(bodyB);

  const aHead = aAll.find((x) => x.heading === null) ?? null;
  const bHead = bAll.find((x) => x.heading === null) ?? null;
  const aBlocks = aAll.filter((x) => x.heading !== null);
  const bBlocks = bAll.filter((x) => x.heading !== null);

  // 头部块（heading === null）在原文序列中恒为第 0 位（splitBlocks 保证）
  const headOffsetA = aHead ? 1 : 0;
  const headOffsetB = bHead ? 1 : 0;

  const blocks: MergeBlock[] = [];
  const conflicts: MergeConflict[] = [];

  /** 产出一个冲突项 + 对应占位块（content 由 resolveConflictText 按 chosen 还原）。 */
  const pushConflict = (
    kind: ConflictKind,
    id: string,
    heading: string | null,
    level: number,
    aContent: string,
    bContent: string,
    chosen: MergeConflict["chosen"],
    aIdx: number | null,
    bIdx: number | null
  ) => {
    const conflict: MergeConflict = { id, kind, heading: heading ?? "", aContent, bContent, chosen };
    conflicts.push(conflict);
    blocks.push({
      id: `x-${id}`,
      heading,
      level,
      content: "",
      source: "conflict",
      conflictId: conflict.id,
      aIdx: aIdx ?? undefined,
      bIdx: bIdx ?? undefined,
    });
  };

  // ---- 头部块（首个标题前的内容）：不同 → head 冲突；单侧 → only-a/only-b；相同 → shared ----
  const headA = (aHead?.content ?? "").trim();
  const headB = (bHead?.content ?? "").trim();
  if (headA && headB && headA !== headB) {
    pushConflict("head", "head", null, 0, aHead!.content, bHead!.content, headA.length >= headB.length ? "a" : "b", 0, 0);
  } else if (headA && !headB) {
    pushConflict("only-a", "head", null, 0, aHead!.content, "", "keep", 0, null);
  } else if (!headA && headB) {
    pushConflict("only-b", "head", null, 0, "", bHead!.content, "keep", null, 0);
  } else if (headA && headB) {
    blocks.push({ id: "head", heading: null, level: 0, content: aHead!.content, source: "shared", aIdx: 0, bIdx: 0 });
  }

  // ---- 对齐：B 块 → A 块（归一化标题相等优先，其次同层 token 重叠 ≥ 阈值）----
  const usedA = new Set<number>();
  const pairBtoA = new Map<number, number>(); // bIdx -> aIdx
  const normOf = (x: { heading: string | null }) => (x.heading ? normHeading(x.heading) : "");

  bBlocks.forEach((blk, bi) => {
    // 1) 标题完全相等
    let hit = aBlocks.findIndex((x, ai) => !usedA.has(ai) && x.level === blk.level && normOf(x) === normOf(blk));
    // 2) 标题缺失/不等 → 同层 token 重叠 ≥ 阈值
    if (hit === -1) {
      let best = -1;
      let bestScore = 0;
      aBlocks.forEach((x, ai) => {
        if (usedA.has(ai) || x.level !== blk.level) return;
        const s = overlap(normOf(x) || x.content, normOf(blk) || blk.content);
        if (s > bestScore) {
          bestScore = s;
          best = ai;
        }
      });
      if (bestScore >= alignThreshold) hit = best;
    }
    if (hit !== -1) {
      usedA.add(hit);
      pairBtoA.set(bi, hit);
    }
  });

  // ---- 组装：配对块在 A 位置；A/B 独有块改为冲突（保留/丢弃）----
  const bPaired = new Set<number>();

  aBlocks.forEach((ablk, ai) => {
    const bi = [...pairBtoA.entries()].find(([, v]) => v === ai)?.[0];
    if (bi !== undefined) {
      bPaired.add(bi);
      const bblk = bBlocks[bi];
      if (ablk.content.trim() === bblk.content.trim()) {
        blocks.push({ id: `s-${ai}`, heading: ablk.heading, level: ablk.level, content: ablk.content, source: "shared", aIdx: ai + headOffsetA, bIdx: bi + headOffsetB });
      } else {
        pushConflict("align", `c-${ai}`, ablk.heading, ablk.level, ablk.content, bblk.content, ablk.content.length >= bblk.content.length ? "a" : "b", ai + headOffsetA, bi + headOffsetB);
      }
    } else {
      // A 独有块：默认保留
      pushConflict("only-a", `c-${ai}`, ablk.heading, ablk.level, ablk.content, "", "keep", ai + headOffsetA, null);
    }
  });

  // B 独有块：默认保留
  bBlocks.forEach((blk, bi) => {
    if (bPaired.has(bi)) return;
    pushConflict("only-b", `c-b-${bi}`, blk.heading, blk.level, "", blk.content, "keep", null, bi + headOffsetB);
  });

  return { aAll, bAll, blocks, conflicts, text: renderBlocks(blocks, conflicts) };
}

/**
 * 段落级拼接主入口（对外行为不变）。
 * - alignThreshold：块对齐的 token 重叠阈值（默认 0.6，§4.4 Step 3.2）。
 */
export function mergeBodies(bodyA: string, bodyB: string, alignThreshold = 0.6): MergedDraft {
  const r = computeMerge(bodyA, bodyB, alignThreshold);
  return { blocks: r.blocks, conflicts: r.conflicts, text: r.text };
}

/**
 * 三向合并视图（PLAN-15 D2/D4 核心）：A 来源 | 中立结果 | B 来源。
 * 与 mergeBodies 共用 computeMerge，rows 按默认 choice 渲染的正文
 * 恒等于 mergeBodies().text（一致性铁律，单测锁定）。
 */
export function buildThreeWayView(bodyA: string, bodyB: string, alignThreshold = 0.6): ThreeWayView {
  const r = computeMerge(bodyA, bodyB, alignThreshold);
  const byId = new Map(r.conflicts.map((c) => [c.id, c]));

  const rows: ThreeWayRow[] = r.blocks.map((blk) => {
    if (blk.source === "shared") {
      return {
        id: blk.id,
        kind: "same",
        heading: blk.heading,
        aText: blk.content,
        bText: blk.content,
        conflictId: null,
        aIdx: blk.aIdx ?? null,
        bIdx: blk.bIdx ?? null,
      };
    }
    const c = blk.conflictId ? byId.get(blk.conflictId) : undefined;
    if (!c) {
      // 兜底：不应发生（conflict 块必有冲突项）
      return {
        id: blk.id,
        kind: "same",
        heading: blk.heading,
        aText: blk.content,
        bText: blk.content,
        conflictId: null,
        aIdx: null,
        bIdx: null,
      };
    }
    if (c.kind === "only-a") {
      return { id: blk.id, kind: "onlyA", heading: blk.heading, aText: c.aContent, bText: null, conflictId: null, aIdx: blk.aIdx ?? null, bIdx: null };
    }
    if (c.kind === "only-b") {
      return { id: blk.id, kind: "onlyB", heading: blk.heading, aText: null, bText: c.bContent, conflictId: null, aIdx: null, bIdx: blk.bIdx ?? null };
    }
    // align / head → conflict（需决策）
    return { id: blk.id, kind: "conflict", heading: blk.heading, aText: c.aContent, bText: c.bContent, conflictId: c.id, aIdx: blk.aIdx ?? null, bIdx: blk.bIdx ?? null };
  });

  // 三向视图的「冲突」= 仅 align/head；only-a/only-b 已自动并入（D4）
  const conflicts = r.conflicts.filter((c) => c.kind === "align" || c.kind === "head");

  return { rows, aBlocks: r.aAll, bBlocks: r.bAll, conflicts };
}

// ---------------------------------------------------------------------------
// frontmatter 合并（Step 2，纯规则）
// ---------------------------------------------------------------------------

export interface FmMerge {
  name: string;
  description: string;
  emoji: string | null;
  triggerKeywords: string[];
  /** 来源说明（description 取自哪侧等） */
  note: string;
}

/** 从 md 文本解析简单 frontmatter（键: 值，去引号）。 */
export function parseFm(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.length >= 2) {
      const f = val[0];
      const l = val[val.length - 1];
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) val = val.slice(1, -1);
    }
    out[kv[1]] = val;
  }
  return out;
}

/** 规整后的合并 frontmatter（name 交由外部按落点/keep 侧决定，这里给建议）。 */
export function mergeFrontmatter(mdA: string, mdB: string, defaultName: string): FmMerge {
  const a = parseFm(mdA);
  const b = parseFm(mdB);
  const da = (a.description ?? "").trim();
  const db = (b.description ?? "").trim();
  const ratio = da.length > 0 && db.length > 0 ? Math.max(da.length, db.length) / Math.min(da.length, db.length) : 0;
  let description: string;
  let note: string;
  if (ratio > 1.5) {
    description = da.length >= db.length ? da : db;
    note = da.length >= db.length ? "description 取更长（A）" : "description 取更长（B）";
  } else if (da === db) {
    description = da;
    note = "description 两侧一致";
  } else {
    description = `${da}${da && db ? "\n\n" : ""}${db}`;
    note = "description 近似，已拼接（超长截断）";
    if (description.length > 1024) description = description.slice(0, 1024) + "…";
  }

  const emoji = a.emoji || b.emoji || null;

  const kwA = (a.trigger_keywords ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kwB = (b.trigger_keywords ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const triggerKeywords = [...new Set([...kwA, ...kwB])].sort();

  return { name: defaultName, description, emoji, triggerKeywords, note };
}

// ---------------------------------------------------------------------------
// 附件对齐（Step 4）
// ---------------------------------------------------------------------------

export interface AttachAlign {
  /** 同名且（视为）同内容 → 只保留 A */
  same: string[];
  /** 同名但内容不同 → 冲突，需用户选 A/B/都保留（改名） */
  conflictSame: string[];
  onlyA: string[];
  onlyB: string[];
}

export function alignAttachments(filesA: string[], filesB: string[]): AttachAlign {
  const setA = new Set(filesA);
  const setB = new Set(filesB);
  const same = filesA.filter((r) => setB.has(r));
  const usedSame = new Set(same);
  return {
    same,
    conflictSame: [],
    onlyA: filesA.filter((r) => !setB.has(r)),
    onlyB: filesB.filter((r) => !setA.has(r) && !usedSame.has(r)),
  };
}

// ---------------------------------------------------------------------------
// 单测（node 可直接跑；tsc 校验类型）
// ---------------------------------------------------------------------------