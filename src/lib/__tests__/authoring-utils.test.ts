/**
 * 创作工作台纯函数测试（src/lib/authoring-utils.ts）。
 * 重点锁定 frontmatter 元数据写入的字节级正确性（trigger_keywords 不外泄、未知字段不动）。
 */
import { describe, expect, it } from "vitest";
import {
  appendPlatformMetadata,
  buildAttachmentFiles,
  buildDesc,
  COMMON_EMOJI,
  generateSkillName,
  splitFrontmatter,
  yq,
} from "../authoring-utils";
import { EMPTY_DRAFT, type WbDraft } from "../wb-draft";

describe("appendPlatformMetadata：trigger_keywords 写入 metadata.skills-shark", () => {
  it("无 metadata 时追加平台块（缩进 2/4/6）", () => {
    const fm = appendPlatformMetadata("name: demo\ndescription: 演示", ["kw1", "kw2"]);
    expect(fm).toContain("metadata:");
    expect(fm).toContain("  skills-shark:");
    expect(fm).toContain("    trigger_keywords:");
    expect(fm).toContain("      - kw1");
    expect(fm).toContain("      - kw2");
    // 原字段保持
    expect(fm).toContain("name: demo");
  });

  it("已有 skills-shark 块时整体替换，不产生重复", () => {
    const base =
      "name: demo\ndescription: 演示\nmetadata:\n  skills-shark:\n    trigger_keywords:\n      - old\n  keep: yes";
    const fm = appendPlatformMetadata(base, ["new-kw"]);
    expect(fm.match(/skills-shark:/g)).toHaveLength(1);
    expect(fm).toContain("- new-kw");
    expect(fm).not.toContain("old");
    // 无关 metadata 子字段原样保留
    expect(fm).toContain("keep: yes");
  });

  it("关键词清空时移除平台块但保留其余 metadata", () => {
    const base =
      "name: demo\nmetadata:\n  skills-shark:\n    trigger_keywords:\n      - old\n  keep: yes";
    const fm = appendPlatformMetadata(base, []);
    expect(fm).not.toContain("skills-shark");
    expect(fm).toContain("keep: yes");
  });

  it("含特殊字符的关键词走 yq 引号（YAML 安全）", () => {
    const fm = appendPlatformMetadata("name: demo", ["含:冒号", "带'引号"]);
    expect(fm).toContain('"含:冒号"');
    expect(fm).toContain('"带\'引号"');
  });
});

describe("yq：YAML 标量安全引号", () => {
  it("普通文本不引号", () => {
    expect(yq("plain")).toBe("plain");
    expect(yq("中文 normal")).toBe("中文 normal");
  });
  it("冒号/井号/引号/首尾空白 → JSON 引号", () => {
    expect(yq("a: b")).toBe('"a: b"');
    expect(yq("#x")).toBe('"#x"');
    expect(yq('say "hi"')).toBe('"say \\"hi\\""');
    expect(yq("  lead")).toBe('"  lead"');
    expect(yq("")).toBe('""');
  });
});

describe("splitFrontmatter", () => {
  it("标准 frontmatter 拆 fm/body", () => {
    const r = splitFrontmatter("---\nname: a\n---\n# body");
    expect(r?.fm).toBe("name: a");
    expect(r?.body).toBe("# body");
  });
  it("非 frontmatter 开头返回 null", () => {
    expect(splitFrontmatter("# 无 frontmatter")).toBeNull();
  });
});

describe("generateSkillName：hyphen-case 自动命名", () => {
  it("英文描述提取前三词", () => {
    expect(generateSkillName("Convert PDF files to plain text")).toBe("convert-pdf-files");
  });
  it("纯中文描述回落时间戳名", () => {
    expect(generateSkillName("处理文档格式与内容转换")).toMatch(/^skill-[a-z0-9]+$/);
  });
  it("已有合法名称直接使用", () => {
    expect(generateSkillName("anything", "my-skill")).toBe("my-skill");
  });
  it("非法既有名称不采用（重新生成）", () => {
    expect(generateSkillName("Convert PDF")).not.toBe("My_Skill");
  });
});

describe("buildDesc + EMPTY_DRAFT 语义", () => {
  it("description 即 purpose（PLAN-11 单输入）", () => {
    const d: WbDraft = { ...EMPTY_DRAFT, purpose: "  做一件事  " };
    expect(buildDesc(d)).toBe("做一件事");
  });
  it("buildAttachmentFiles 产出三目录四文件骨架", () => {
    const files = buildAttachmentFiles("demo", "desc");
    expect(files.map((f) => f.path)).toEqual([
      "references/domain-knowledge.md",
      "references/guardrails.md",
      "scripts/validate_input.py",
      "assets/example-template.md",
    ]);
    expect(files.every((f) => f.content.includes("demo"))).toBe(true);
  });
  it("COMMON_EMOJI 快选网格非空且含默认 🧩", () => {
    expect(COMMON_EMOJI).toContain("🧩");
    expect(COMMON_EMOJI.length).toBeGreaterThanOrEqual(12);
  });
});