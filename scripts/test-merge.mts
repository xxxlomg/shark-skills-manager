/**
 * merge.ts 一致性单测（PLAN-15 §10）。
 *
 * 运行：node scripts/test-merge.mts
 * 依赖：Node ≥ 22.6（原生 type-stripping；本机 Node 25 默认开启）。
 * 通过 = 无输出 + exit 0；失败 = 打印断言差异 + exit 1。
 */
import assert from "node:assert/strict";
import {
  buildThreeWayView,
  mergeBodies,
  renderThreeWayText,
  resolveConflictText,
} from "../src/lib/merge.ts";

/** 断言 rows 默认渲染 === mergeBodies().text（一致性铁律） */
function assertConsistency(bodyA: string, bodyB: string, label: string) {
  const draft = mergeBodies(bodyA, bodyB);
  const view = buildThreeWayView(bodyA, bodyB);
  const rendered = renderThreeWayText(view.rows, view.conflicts);
  assert.equal(rendered, draft.text, `[${label}] 默认 choice 渲染不一致`);
  return { draft, view };
}

/** 修改某冲突选择后，两条渲染路径仍一致 */
function assertChoiceConsistency(bodyA: string, bodyB: string, label: string) {
  const draft = mergeBodies(bodyA, bodyB);
  const view = buildThreeWayView(bodyA, bodyB);
  // 找一个 conflict 行，把它的 chosen 改成与默认不同的值
  const row = view.rows.find((r) => r.kind === "conflict");
  if (!row) return; // 无冲突，跳过
  const target = view.conflicts.find((c) => c.id === row.conflictId)!;
  const alt = target.chosen === "a" ? "b" : "a";
  view.conflicts = view.conflicts.map((c) => (c.id === target.id ? { ...c, chosen: alt } : c));
  draft.conflicts = draft.conflicts.map((c) => (c.id === target.id ? { ...c, chosen: alt } : c));
  const fromRows = renderThreeWayText(view.rows, view.conflicts);
  const fromDraft = draft.blocks
    .map((blk) => {
      if (blk.conflictId) {
        const c = draft.conflicts.find((x) => x.id === blk.conflictId);
        if (c) return resolveConflictText(c);
      }
      return blk.content;
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  assert.equal(fromRows, fromDraft, `[${label}] 改选后渲染不一致`);
}

// ---- 场景 1：全同 ----
{
  const same = `# 技能\n\n## 用途\n做事情 A。\n\n## 步骤\n1. 执行 x\n`;
  const { view } = assertConsistency(same, same, "全同");
  assert.equal(view.conflicts.length, 0, "全同应零冲突");
  assert.ok(view.rows.every((r) => r.kind === "same"), "全同应全为 same 行");
}

// ---- 场景 2：全异（标题完全不同 → 全 onlyA/onlyB）----
{
  const a = `# 甲\n\n内容 A。\n`;
  const b = `# 乙\n\n内容 B。\n`;
  const { view } = assertConsistency(a, b, "全异");
  assert.equal(view.conflicts.length, 0, "全异（标题不同）应零 align 冲突");
  assert.ok(view.rows.some((r) => r.kind === "onlyA"), "应有 onlyA 行");
  assert.ok(view.rows.some((r) => r.kind === "onlyB"), "应有 onlyB 行");
}

// ---- 场景 3：部分对齐（混合 same/conflict/onlyA/onlyB）----
// 注意：onlyA/onlyB 的标题需 token 重叠 < 0.6，否则会被对齐成 conflict
{
  const a = `# 相同节\n\n完全相同内容。\n\n# 冲突节\n\nA 版本内容。\n\n# 故障排查\n\n只有 A 有。\n`;
  const b = `# 相同节\n\n完全相同内容。\n\n# 冲突节\n\nB 版本内容。\n\n# 示例代码\n\n只有 B 有。\n`;
  const { view } = assertConsistency(a, b, "部分对齐");
  const kinds = view.rows.map((r) => r.kind);
  assert.ok(kinds.includes("same"), "应有 same 行");
  assert.ok(kinds.includes("conflict"), "应有 conflict 行");
  assert.ok(kinds.includes("onlyA"), "应有 onlyA 行");
  assert.ok(kinds.includes("onlyB"), "应有 onlyB 行");
  assert.equal(view.conflicts.length, 1, "应恰有一个 align 冲突");
  assertChoiceConsistency(a, b, "部分对齐");
}

// ---- 场景 4：头部块冲突（无标题时整篇对照退化）----
{
  const a = "第一段开头内容（无标题）。";
  const b = "第二段开头内容（无标题，不同）。";
  const { view } = assertConsistency(a, b, "头部冲突");
  assert.equal(view.conflicts.length, 1, "无标题文档应退化为单 head 冲突");
  assert.equal(view.rows[0].kind, "conflict", "头部差异应为 conflict 行");
}

// ---- 场景 5：头部相同 + 无正文标题 → shared 单行 ----
{
  const a = "同一段开头。";
  const { view } = assertConsistency(a, a, "头部相同");
  assert.equal(view.rows[0].kind, "same");
}

// ---- 场景 6：empty 一侧 ----
{
  const { view } = assertConsistency("", "# 只有B\n\n内容。\n", "空 A");
  assert.ok(view.rows.every((r) => r.kind === "onlyB"), "空 A 应全 onlyB");
}

console.log("merge.ts 一致性单测全部通过 ✅");
