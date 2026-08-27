# Skill Specification v1 —— 14 节完整模板

本模板是 Skill 制作的**结果规范**（回答"最终的 Skill 长什么样"）。它更适合作为平台内部建模规范，不一定全部映射进 `SKILL.md`。生成 Skill 时按此结构访谈、建模、落盘。

## 1. Identity 身份

```text
- name:         小写字母/数字/连字符，≤64 字符，与目录名一致
- description:  同时包含 WHAT（做什么）+ WHEN（何时用、触发场景），≤1024 字符
- version:      语义化版本，如 v1.0.0
```

`description` 是 Skill 的触发入口，务必写清楚触发场景；"何时使用"信息必须放在 description 而不是正文——正文在触发后才加载。

## 2. Problem 问题

```text
- user_problem:      用户遇到的真实问题（用用户的话）
- desired_outcome:   用户希望得到的最终结果
- why_skill_exists:  为什么值得封装成 Skill（重复？高成本？易出错？）
```

## 3. Scope 范围

```text
- in_scope:               做什么（尽量窄，明确任务族）
- out_of_scope:           不做什么（显式排除）
- escalation_conditions:  什么情况应该退出、升级或求助于人
```

边界越清晰，Skill 越容易触发、维护、测试、复用、迭代。

## 4. Trigger 触发

```text
- trigger_phrases:     用户常说的触发短语
- trigger_conditions:  触发条件（满足哪些条件才应用本 Skill）
- negative_conditions: 明确不触发的情况（防止误触发）
```

## 5. Inputs 输入

```text
- required:           必需输入
- optional:           可选输入
- follow_up_questions:信息不足时应追问什么
```

明确"输入不足时怎么办"，避免把推测当结论。

## 6. Outputs 输出

```text
- format:             输出格式（文本 / 结构化 / 文件 / 图表）
- required_sections:  必须包含的章节
- validation_rules:   什么样的输出才算合格
```

## 7. Workflow 工作流

```text
- step_1..step_n:     核心步骤（留在 SKILL.md 的编排流程）
- decision_points:    决策点（分情况走不同分支）
- fallback:           兜底策略（信息不足 / 执行失败时）
```

## 8. Knowledge 知识

```text
- references:       需要外置的领域知识清单（写入 references/）
- knowledge_gaps:   目前缺失、需要用户补充的知识
```

## 9. Tools 工具

```text
- MCP:            需要连接的外部服务/系统
- local_tools:     本地工具（读文件、跑命令、浏览等）
```

## 10. Scripts 脚本

```text
- executable_procedures:  确定性、可重复的操作（解析、校验、转换等）
- usage_rules:            何时运行、输入输出约定
```

脚本回答："有没有事情应该交给程序做，而不是交给 LLM 猜？" 理想组合 = LLM Reasoning + Deterministic Scripts。

## 11. Assets 素材

```text
- templates:  输出要用的模板（docx / pptx / 代码骨架）
- resources:  图标、logo、示例数据等
```

## 12. Guardrails 护栏

```text
- must:               必须遵守的规则
- must_not:           禁止的行为
- uncertainty_policy: 不确定时怎么办（如实说明、不编造）
```

## 13. Examples 示例

```text
- good_examples:    好的输入→输出示例
- failure_examples: 失败示例（哪些输入会导致错误结论，如何避免）
```

## 14. Evaluation 评测

```text
- test_cases:        代表性测试案例（3~5 个）
- expected_behavior: 每个案例的期望行为
- quality_metrics:   质量维度（见 evaluation-and-quality.md）
```

---

## 使用说明

1. **访谈时**：按本模板逐节补齐 Skill State，一次只问一个最重要的未知量。
2. **设计时**：决定每节内容放哪里 —— 核心流程进 `SKILL.md`，深层知识进 `references/`，确定性操作进 `scripts/`，素材进 `assets/`。
3. **生成时**：`SKILL.md` 只承载 1/4/7 的编排部分与资源导航；其余外置。
4. **评测时**：用第 14 节生成测试案例并执行 Pass/Fail。
