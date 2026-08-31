/**
 * 合并引擎测试（src/lib/merge.ts）。
 * 重点锁定「一致性铁律」：mergeBodies 与 buildThreeWayView 共用同一 computeMerge，
 * 三向视图的默认渲染必须与实际合并结果恒等（PLAN-15 D2/D4 注释承诺）。
 */
import { describe, expect, it } from "vitest";
import {
  alignAttachments,
  buildThreeWayView,
  mergeBodies,
  mergeFrontmatter,
  parseFm,
  splitBlocks,
} from "../merge";

const A = `# demo-tool

## 步骤

- 先做 A

## 输出

返回结果
`;

const B = `# demo-tool

## 步骤

- 先做 B

## 输出

返回结果
`;

function viewDefaultText(rows: ReturnType<typeof buildThreeWayView>["rows"]): string {
  // 与 renderBlocks 同语义：same/onlyA→A 侧、onlyB→B 侧、conflict→A 侧（默认取 A）
  return rows
    .map((r) => {
      if (r.kind === "same") return r.aText;
      if (r.kind === "onlyA") return r.aText;
      if (r.kind === "onlyB") return r.bText;
      return r.aText; // conflict 默认取 A
    })
    .filter((s) => (s ?? "").trim().length > 0)
    .join("\n\n");
}

describe("一致性铁律：三向视图默认渲染 == mergeBodies 结果", () => {
  it("完全相同的正文：无冲突且文本恒等", () => {
    const m = mergeBodies(A, A);
    const v = buildThreeWayView(A, A);
    expect(m.conflicts).toHaveLength(0);
    expect(v.conflicts).toHaveLength(0);
    expect(v.rows.every((r) => r.kind === "same")).toBe(true);
    expect(viewDefaultText(v.rows)).toBe(m.text);
  });

  it("单侧差异（only-a）：自动并入且文本恒等", () => {
    const onlyA = `${A}\n## 附加\n\n仅 A 有\n`;
    const m = mergeBodies(onlyA, A);
    const v = buildThreeWayView(onlyA, A);
    // only-a 不进 view.conflicts（D4 自动并入），但进入 merge.conflicts 全量
    expect(v.conflicts).toHaveLength(0);
    expect(m.text).toContain("仅 A 有");
    expect(viewDefaultText(v.rows)).toBe(m.text);
  });

  it("同标题异内容（align 冲突）：冲突集合对应且默认渲染恒等", () => {
    const m = mergeBodies(A, B);
    const v = buildThreeWayView(A, B);
    // view 只暴露 align/head（需决策）；merge 全量
    expect(v.conflicts.length).toBeGreaterThan(0);
    for (const c of v.conflicts) {
      expect(["align", "head"]).toContain(c.kind);
    }
    expect(m.conflicts.map((c) => c.id).sort()).toEqual(
      [...v.conflicts.map((c) => c.id), ...m.conflicts.filter((c) => c.kind === "only-a" || c.kind === "only-b").map((c) => c.id)].sort(),
    );
    expect(viewDefaultText(v.rows)).toBe(m.text);
  });

  it("冲突块在 rows 中以 conflictId 指向，且在 aBlocks/bBlocks 有锚点", () => {
    const v = buildThreeWayView(A, B);
    const conflictRows = v.rows.filter((r) => r.kind === "conflict");
    expect(conflictRows.length).toBeGreaterThan(0);
    for (const r of conflictRows) {
      expect(r.conflictId).not.toBeNull();
      expect(r.aIdx).not.toBeNull();
      expect(r.bIdx).not.toBeNull();
      expect(v.aBlocks[r.aIdx!]).toBeDefined();
      expect(v.bBlocks[r.bIdx!]).toBeDefined();
    }
  });
});

describe("splitBlocks 段落切块", () => {
  it("按标题切块并保留层级", () => {
    const blocks = splitBlocks(A);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0].heading).toBe("demo-tool");
    expect(blocks[0].level).toBe(1);
    expect(blocks.some((b) => b.heading === "步骤")).toBe(true);
    expect(blocks.some((b) => b.heading === "输出")).toBe(true);
  });
});

describe("frontmatter 合并（纯规则）", () => {
  it("parseFm 解析 name/description（完整 md 文本）", () => {
    const fm = parseFm("---\nname: demo\ndescription: 演示\nemoji: 🧩\n---\n正文");
    expect(fm.name).toBe("demo");
    expect(fm.description).toBe("演示");
    expect(fm.emoji).toBe("🧩");
  });

  it("mergeFrontmatter 取 defaultName 并合并两侧字段", () => {
    const mdA = "---\nname: alpha\ndescription: A 描述\n---\nbodyA";
    const mdB = "---\nname: beta\n---\nbodyB";
    const r = mergeFrontmatter(mdA, mdB, "merged-name");
    expect(r.name).toBe("merged-name");
    expect(r.description).toBe("A 描述");
  });
});

describe("alignAttachments 附件对齐", () => {
  it("同名附件归入 same，单侧标 only", () => {
    const r = alignAttachments(
      ["references/guide.md", "scripts/run.py"],
      ["references/guide.md", "assets/logo.png"],
    );
    // 同名（视为同内容）→ same；各自独有 → onlyA/onlyB
    expect(r.same).toContain("references/guide.md");
    expect(r.onlyA).toContain("scripts/run.py");
    expect(r.onlyB).toContain("assets/logo.png");
    expect(r.conflictSame).toHaveLength(0);
  });
});