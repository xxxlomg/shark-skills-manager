# 常见误区详解与规避

## 误区一：Skill 就是一大段 Prompt

**问题**：太长、不易维护、不易组合、不易测试、不易版本化。

**改进**：把 Prompt 拆解为能力结构：

```text
Prompt → Workflow → Knowledge → Scripts → Evaluation
```

Prompt 可能是一个 Skill 的核心组成部分，但 **Prompt ⊂ Skill**，Skill ≠ Prompt。

## 误区二：所有东西都塞进 SKILL.md

**问题**：Context 膨胀、说明文件越来越难读、模型抓不到重点。

**改进**：

```text
SKILL.md    → 核心流程（编排与指导）
references  → 深层知识
scripts     → 确定性操作
assets      → 素材
```

## 误区三：Skill 范围越大越厉害

**问题**：通常恰恰相反。Skill 越大越难精准触发、清晰描述、稳定执行、评测、维护。

**改进**：使用"明确任务族"的 Skill，边界收窄：

```text
Java
  → Spring Boot
  → Spring Boot Error
  → Spring Boot Startup Error Diagnosis   ← 适合做成 Skill
```

## 误区四：生成成功就算成功

**问题**：看起来合理 ≠ 真的有效。

**改进**：必须有测试与评估：

```text
Generated ≠ Validated
```

流程应为 `Create → Test → Evaluate → Improve → Retest → Release`。

## 误区五：对话式 Skill Creator 只是一个聊天机器人

**问题**：只有聊天记录，没有结构化沉淀。

**改进**：真正的 Skill Creator 必须具备：

- **Skill State**（结构化创作状态）。
- **State Machine**（阶段机，可前进/回退/跳转）。
- **Structured Data Model**（Identity/Scope/Workflow/Knowledge/...）。
- **Evaluation**（测试案例 + Pass/Fail）。
- **Artifact Generation**（产出可编辑的 Skill 产物）。

聊天只是 UI；状态与产物才是系统的核心。

## 其他常见偏差

- **问用户"你的 Skill 叫什么名字"而不是"你经常让 AI 做什么"** —— Discover 应从工作出发，而非命名。
- **把平台私有字段直接写进目标生态的顶层 frontmatter** —— 先分层保存（平台元数据 / 生态导出映射），避免污染标准结构。
- **诊断通过就被当作 Skill 有效** —— 格式兼容 ≠ 真实任务能力可靠；Validation 与 Evaluation 要区分。
- **用户手工编辑正文后静默覆盖** —— 重新编译前需用户确认，标记 artifact diverged。
