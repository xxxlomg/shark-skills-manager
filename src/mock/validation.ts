import type { ValidateMode, ValidationReport } from "@/lib/api";

/**
 * C3 校验矩阵 mock 样本（?mock=1 下 skillValidate 的返回）。
 * 分布覆盖三态：全绿 / 单侧 warn / 单侧 fail（仅 strict 可见）。
 * 铁律：diagnostic 永不 fail——fail 样本在诊断模式下降级为 warn。
 */

interface MatrixCell {
  verdict: "pass" | "warn" | "fail";
  notes: string[];
}

interface MockCase {
  claude: MatrixCell;
  codex: MatrixCell;
  issues?: ValidationReport["issues"];
}

/** key = MOCK_SKILLS 的 id；未命中的技能走 DEFAULT（全绿） */
const CASES: Record<string, MockCase> = {
  // 全绿样本
  c1: {
    claude: { verdict: "pass", notes: [] },
    codex: { verdict: "pass", notes: [] },
  },
  // codex 单侧 warn：default_prompt 未含 $skill-name（§3.6 示例场景）
  c2: {
    claude: { verdict: "pass", notes: [] },
    codex: { verdict: "warn", notes: ["default_prompt 未含 $skill-name"] },
    issues: [
      {
        rule_id: "CX-05",
        severity: "warn",
        message: "default_prompt 未包含 $skill-name 占位符",
        path: "openai.yaml",
        hint: "在 prompt 模板中加入 $skill-name，确保调用时技能名被注入",
      },
    ],
  },
  // claude 单侧 warn：未知字段（诊断=提示）
  o3: {
    claude: { verdict: "warn", notes: ["未知字段 'category'"] },
    codex: { verdict: "pass", notes: [] },
    issues: [
      {
        rule_id: "CL-03",
        severity: "warn",
        message: "字段 'category' 为 Claude 未知字段",
        path: "SKILL.md",
        hint: "移入 references/ 或从 frontmatter 删除",
      },
    ],
  },
  // codex fail：name 规范违例——仅 strict 模式可见，diagnostic 降级 warn
  x2: {
    claude: { verdict: "pass", notes: [] },
    codex: { verdict: "fail", notes: ["name 含大写字符，违反 Codex 命名规范"] },
    issues: [
      {
        rule_id: "CX-02",
        severity: "error",
        message: "name 'Git-Flow' 含大写字符，Codex 要求全小写短横线命名",
        path: "SKILL.md",
        hint: "重命名为 'git-flow' 并同步目录名",
      },
    ],
  },
};

const DEFAULT_CASE: MockCase = {
  claude: { verdict: "pass", notes: [] },
  codex: { verdict: "pass", notes: [] },
};

export function mockValidationReport(
  skillId: string,
  mode: ValidateMode
): ValidationReport {
  const c = CASES[skillId] ?? DEFAULT_CASE;
  const cell = (m: MatrixCell): MatrixCell =>
    mode === "diagnostic" && m.verdict === "fail"
      ? { verdict: "warn", notes: m.notes }
      : m;
  const claude = cell(c.claude);
  const codex = cell(c.codex);
  const issues = (c.issues ?? []).map((i) =>
    mode === "diagnostic" && i.severity === "error"
      ? { ...i, severity: "warn" as const }
      : i
  );
  const failed = claude.verdict === "fail" || codex.verdict === "fail";
  return {
    mode,
    passed: !failed,
    issues,
    matrix: { claude, codex },
  };
}
