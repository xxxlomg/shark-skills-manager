/**
 * 变体聚合测试（src/lib/variants.ts）+ 文件树工具（src/lib/file-tree-utils.ts）。
 */
import { describe, expect, it } from "vitest";
import { buildVariants, recommendReason, scoreOf, toolDot } from "../variants";
import type { DupGroup } from "../api";
import { buildVirtualTree, isBinaryName, refTemplate, templatesFor } from "../file-tree-utils";

function member(id: string, hash: string | null, bodyLen: number, opts: { trans?: boolean; mtime?: number } = {}) {
  return {
    skill_id: id,
    name: "demo",
    title_zh: "",
    emoji: null,
    scan_label: "t",
    tool_id: "codex",
    skill_dir: `/tmp/${id}`,
    source_path: `/tmp/${id}/SKILL.md`,
    hub_linked: false,
    has_translation: opts.trans ?? false,
    body_hash: hash,
    body_len: bodyLen,
    mtime: opts.mtime ?? 0,
  };
}

function group(members: ReturnType<typeof member>[]): DupGroup {
  return { id: "g", kind: "identical", score: 1.0, reason: "", members };
}

describe("buildVariants：同 body_hash 聚合 + 字母序", () => {
  it("相同副本折叠为同变体，成员保留", () => {
    const g = group([
      member("a", "h1", 100),
      member("b", "h1", 100),
      member("c", "h2", 50),
    ]);
    const vs = buildVariants(g);
    expect(vs).toHaveLength(2);
    // A = score 最高（h1 组 100 > h2 组 50）
    const v1 = vs.find((v) => v.letter === "A")!;
    expect(v1.members).toHaveLength(2);
  });

  it("A = 推荐基准（score 最高），且理由可见", () => {
    const g = group([
      member("a", "h1", 100),
      member("b", "h1", 300), // 内容更长 → 应成为 A
    ]);
    const vs = buildVariants(g);
    expect(vs[0].letter).toBe("A");
    expect(vs[0].rep.skill_id).toBe("b");
    expect(recommendReason(vs[0], vs)).toContain("内容最完整");
  });

  it("已翻译加 1000 分主导推荐", () => {
    const g = group([
      member("a", "h1", 50, { trans: true }),
      member("b", "h1", 100),
    ]);
    const vs = buildVariants(g);
    expect(vs[0].rep.skill_id).toBe("a");
  });

  it("独立 body_hash 兜底 solo:，不崩溃", () => {
    const g = group([member("a", null, 10), member("b", null, 20)]);
    const vs = buildVariants(g);
    expect(vs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("scoreOf / toolDot", () => {
  it("body_len 主导 + 翻译加权", () => {
    const a = scoreOf(member("a", null, 100));
    const b = scoreOf(member("b", null, 100, { trans: true }));
    expect(b - a).toBe(1000);
  });
  it("未注册工具回落灰色", () => {
    expect(toolDot("unknown-tool")).toBe("bg-zinc-400");
    expect(toolDot("codex")).toBe("bg-emerald-500");
  });
});

describe("file-tree-utils", () => {
  it("buildVirtualTree 嵌套结构（references/guide.md → 两层）", () => {
    const tree = buildVirtualTree([{ path: "references/guide.md" }, { path: "scripts/run.py" }]);
    expect(tree).toHaveLength(2);
    const refs = tree.find((n) => n.name === "references")!;
    expect(refs.is_dir).toBe(true);
    expect(refs.children[0].name).toBe("guide.md");
    expect(refs.children[0].is_dir).toBe(false);
  });

  it("isBinaryName：扩展名判定", () => {
    expect(isBinaryName("logo.png")).toBe(true);
    expect(isBinaryName("LOGO.PNG")).toBe(true);
    expect(isBinaryName("guide.md")).toBe(false);
    expect(isBinaryName("noext")).toBe(false);
  });

  it("refTemplate：按顶层目录给引用文案", () => {
    expect(refTemplate("references/guide.md")).toContain("参考 references/guide.md");
    expect(refTemplate("scripts/run.py")).toContain("运行");
    expect(refTemplate("templates/t.md")).toContain("套用");
  });

  it("templatesFor：scripts 给脚本模板、其他给文档模板", () => {
    const script = templatesFor("scripts/new.py");
    expect(script[0].label).toBe("Python 脚本骨架");
    const doc = templatesFor("references/x.md");
    expect(doc[0].label).toBe("参考文档结构");
  });
});