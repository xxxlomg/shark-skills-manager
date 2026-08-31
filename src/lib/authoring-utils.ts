/**
 * 创作工作台纯函数工具（从 AuthoringWorkbench 拆出，无 React 依赖）。
 * 职责：frontmatter 组装 / 描述派生 / emoji 与命名 / 标准附件骨架。
 */
import { NAME_RE, type WbDraft } from "./wb-draft";
import type { ValidationReport } from "./api";
import type { ValidationSummary } from "./creation-state";

/** 编辑区视图模式（编辑 / 分栏 / 预览） */
export type PreviewMode = "edit" | "split" | "preview";

/** 拆 frontmatter：返回 (fm, body)，非 frontmatter 开头返回 null。 */
export function splitFrontmatter(md: string): { fm: string; body: string } | null {
  if (!md.startsWith("---")) return null;
  const rest = md.slice(3);
  const idx = rest.indexOf("\n---");
  if (idx < 0) return null;
  return {
    fm: rest.slice(0, idx).replace(/^\n/, ""),
    body: rest.slice(idx + 4).replace(/^\n/, ""),
  };
}

/**
 * 「我的描述」→ description。
 * PLAN-11 阶段 0：面板单输入，description 即「我的描述」(purpose)，不再拼「何时用」。
 */
export function buildDesc(d: WbDraft): string {
  return d.purpose.trim();
}

/** YAML 标量安全引号（emoji 直拼 frontmatter 用；含特殊字符/空 → JSON 引号）。 */
export function yq(s: string): string {
  if (s === "" || /[:#]|["'\\]|^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

/** 平台元数据写入 frontmatter：trigger_keywords 收进 metadata.skills-shark（不动未知字段）。 */
export function appendPlatformMetadata(frontmatter: string, keywords: string[]): string {
  const clean = keywords.map((item) => item.trim()).filter(Boolean);
  const lines = frontmatter.replace(/\s+$/, "").split("\n");
  const metadataAt = lines.findIndex((line) => line.trim() === "metadata:");
  if (metadataAt < 0) {
    return clean.length === 0
      ? frontmatter
      : [
          ...lines,
          "metadata:",
          "  skills-shark:",
          "    trigger_keywords:",
          ...clean.map((keyword) => `      - ${yq(keyword)}`),
        ].join("\n");
  }

  let metadataEnd = metadataAt + 1;
  while (metadataEnd < lines.length && !/^[^\s]/.test(lines[metadataEnd])) {
    metadataEnd++;
  }
  const metadataLines = lines.slice(metadataAt + 1, metadataEnd);
  const withoutPlatform: string[] = [];
  for (let i = 0; i < metadataLines.length; i++) {
    if (metadataLines[i].trim() === "skills-shark:") {
      i++;
      while (i < metadataLines.length && /^\s{4}/.test(metadataLines[i])) i++;
      i--;
      continue;
    }
    withoutPlatform.push(metadataLines[i]);
  }
  if (clean.length === 0) {
    return [
      ...lines.slice(0, metadataAt + 1),
      ...withoutPlatform,
      ...lines.slice(metadataEnd),
    ].join("\n");
  }
  const platformLines = [
    "  skills-shark:",
    "    trigger_keywords:",
    ...clean.map((keyword) => `      - ${yq(keyword)}`),
  ];
  return [
    ...lines.slice(0, metadataAt + 1),
    ...withoutPlatform,
    ...platformLines,
    ...lines.slice(metadataEnd),
  ].join("\n");
}

/** 校验报告 → 状态机可用的摘要（verdict 三态归一）。 */
export function toValidationSummary(report: ValidationReport): ValidationSummary {
  const errorCount = report.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = report.issues.filter((issue) => issue.severity === "warn").length;
  const infoCount = report.issues.filter((issue) => issue.severity === "info").length;
  return {
    mode: report.mode,
    verdict: errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass",
    errorCount,
    warningCount,
    infoCount,
    issueCount: report.issues.length,
    checkedAt: new Date().toISOString(),
  };
}

/** emoji 快选网格（X5），可再自定义输入。 */
export const COMMON_EMOJI = [
  "✍️",
  "🧩",
  "🛠️",
  "🧪",
  "📦",
  "🔍",
  "🌐",
  "📊",
  "🤖",
  "📝",
  "⚡",
  "🔧",
  "🧠",
  "🚀",
  "🗂️",
  "🔔",
  "🎯",
  "📚",
  "🧮",
  "💾",
];

/** 根据描述自动生成 hyphen-case 技能名称（不重复） */
export function generateSkillName(description: string, existingName?: string): string {
  // 如果用户已填写了合法名称，直接使用
  if (existingName && NAME_RE.test(existingName)) return existingName;
  // 从描述中提取英文单词
  const words = description
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && /^[a-zA-Z]/.test(w))
    .slice(0, 3)
    .map((w) => w.toLowerCase());
  if (words.length > 0) {
    return words.join("-").slice(0, 40);
  }
  // 中文描述：用时间戳生成唯一名称
  const ts = Date.now().toString(36).slice(-6);
  return `skill-${ts}`;
}

/**
 * 按 shark-skill-creator 规范构建标准附件清单（references/scripts/assets 三目录）。
 * 与旧 buildMissingFiles 的区别：不再依赖审查问题条件触发，而是始终产出
 * 规范要求的完整附件骨架，确保 SKILL.md 与附件同时生成。
 */
export function buildAttachmentFiles(
  skillName: string,
  description: string,
): Array<{ path: string; content: string }> {
  return [
    {
      path: "references/domain-knowledge.md",
      content: `# ${skillName} 领域知识\n\n> 本文档存放技能执行所需的深层领域知识，供 SKILL.md 正文按需引用（渐进披露）。\n\n## 核心概念\n\n- ${description.slice(0, 80) || skillName}\n\n## 规则与约束\n\n- 待补充：根据实际使用场景添加领域规则。\n\n## 常见错误与处理\n\n- 待补充：记录常见失败场景及应对策略。\n`,
    },
    {
      path: "references/guardrails.md",
      content: `# ${skillName} 护栏规则\n\n> 本文档定义技能执行时必须遵守的规则和禁止行为。\n\n## 必须遵守（Must）\n\n- 输出前验证结果完整性\n- 信息不足时主动追问，不做假设\n\n## 禁止行为（Must Not）\n\n- 编造不存在的信息或数据\n- 超出技能范围处理不相关请求\n\n## 不确定时策略（Uncertainty Policy）\n\n- 如实说明不确定性\n- 提供可能的方向而非武断结论\n- 建议用户补充信息后重试\n`,
    },
    {
      path: "scripts/validate_input.py",
      content: `#!/usr/bin/env python3\n"""${skillName} 输入校验脚本。\n\n确定性操作：校验用户输入是否符合技能要求，不应交给 LLM 猜测。\n"""\nimport sys\n\n\ndef validate(input_text: str) -> tuple[bool, str]:\n    """校验输入是否有效。返回 (是否通过, 消息)。"""\n    if not input_text or not input_text.strip():\n        return False, "输入不能为空"\n    if len(input_text.strip()) < 5:\n        return False, "输入过短，请提供更完整的信息"\n    return True, "输入有效"\n\n\ndef main() -> int:\n    if len(sys.argv) < 2:\n        print("用法: python validate_input.py <input_text>")\n        return 1\n    ok, msg = validate(sys.argv[1])\n    print(msg)\n    return 0 if ok else 1\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n`,
    },
    {
      path: "assets/example-template.md",
      content: `# ${skillName} 输出模板\n\n> 本模板定义技能输出的标准格式，确保结果一致性。\n\n## 输出结构\n\n\`\`\`markdown\n# [主题]\n\n## 摘要\n[一句话概括]\n\n## 详细分析\n[分点展开]\n\n## 建议\n[可操作的下一步]\n\`\`\`\n\n## 使用示例\n\n**输入**：示例输入内容\n**输出**：按上述模板格式化的结果\n`,
    },
  ];
}