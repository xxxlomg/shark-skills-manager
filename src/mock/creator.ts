import type { CreatorAsset, CreatorInfo } from "@/lib/api";

/**
 * mock 内置 shark-skill-creator 定义样本（?mock=1 演示用）。
 * 真实数据由后端读取内置资源目录返回；此处覆盖：
 * - SKILL.md 简版（七阶段概览 + 资源导航，与真实版同构）
 * - references/scripts 清单（首行标题提取）
 * - 部分资源全文（按需读取路径走 MOCK_CREATOR_DOCS）
 */
export const MOCK_CREATOR_INFO: CreatorInfo = {
  name: "shark-skill-creator",
  description:
    "进阶版 Skill Creator（Meta-Skill）：通过对话式访谈，把重复工作流和隐性经验编译成标准化、可执行、可评测、可迭代的 Agent Skill。",
  skill_md: `---
name: shark-skill-creator
description: 进阶版 Skill Creator（Meta-Skill）：把重复工作流编译成标准化 Skill。
---

# Skill Creator Pro —— 进阶版技能创作者

## 工作流程总览（七阶段）

1. Discover 发现需求
2. Scope 定义边界
3. Model 结构化建模
4. Design 设计 Skill
5. Generate 生成 Skill Package
6. Evaluate 测试评估
7. Package 打包发布

## Skill 标准结构（规范层）

\`\`\`text
skill-name/
├── SKILL.md            # 必需：身份与发现 + 工作指令 + 资源导航
├── references/         # 可选：领域知识、官方文档摘要、规范、最佳实践
├── scripts/            # 可选：确定性程序（解析、校验等不该靠 LLM 猜的工作）
└── assets/             # 可选：模板、logo、示例素材
\`\`\`

## 资源导航

| 需要什么 | 读取 |
|---|---|
| 14 节完整 Skill Specification 模板 | references/skill-specification.md |
| 状态机设计 + Skill State 数据模型 | references/skill-state-model.md |
| 对话六原则详解 + 各阶段提问话术 | references/interview-protocol.md |
| Evaluation 方法 + Skill Quality 维度 | references/evaluation-and-quality.md |
| SKILL.md / references / scripts / assets 分工细则 | references/progressive-disclosure.md |
| 常见误区详解与规避 | references/common-mistakes.md |
| 脚手架生成（Node/Python 双版本） | scripts/init_skill.mjs、scripts/init_skill.py |
| 结构校验（Node/Python 双版本） | scripts/validate_skill.mjs、scripts/validate_skill.py |
`,
  references: [
    { rel_path: "references/skill-specification.md", title: "Skill Specification 完整模板", size: 4039 },
    { rel_path: "references/progressive-disclosure.md", title: "渐进披露：SKILL.md / references / scripts 分工", size: 3720 },
    { rel_path: "references/common-mistakes.md", title: "常见误区详解", size: 2407 },
  ] as CreatorAsset[],
  scripts: [
    { rel_path: "scripts/init_skill.mjs", title: "脚手架生成（Node）", size: 3952 },
    { rel_path: "scripts/validate_skill.mjs", title: "结构校验（Node）", size: 4782 },
  ] as CreatorAsset[],
};

/** 按需读取的资源全文样本（key = rel_path） */
export const MOCK_CREATOR_DOCS: Record<string, string> = {
  "references/interview-protocol.md": `# 对话式创建协议：六原则

一次只问当前最重要的问题，根据之前的答案动态决定下一步。

1. 一次只追问最重要的未知量；
2. 能给选项时优先给选项 + 推荐项；
3. 允许用户直接说自然语言，Agent 自动结构化；
4. Agent = Interviewer + Analyst + Architect（主动提设计意见）；
5. 主动暴露不确定性；
6. 始终让用户看到产物。

提问必须紧扣用户的具体描述，引用其中关键词，帮助解析意图深度；严禁套用与用户输入无关的通用模板。`,
  "references/progressive-disclosure.md": `# 渐进披露原则

用户请求 → Skill Discovery（name + description）→ 加载 SKILL.md → 必要时才读 references/ 或运行 scripts/

一句话：**先知道有没有用，再知道怎么用，最后才加载深层资源。** 因此 description 必须同时包含 WHAT（做什么）和 WHEN（何时用、触发场景）。`,
  "scripts/init_skill.mjs": `import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// 脚手架：生成标准 Skill Package 目录结构（mock 样本）
const [skillName, ...rest] = process.argv.slice(2);
// ...（完整实现见内置资源 scripts/init_skill.mjs）`,
};