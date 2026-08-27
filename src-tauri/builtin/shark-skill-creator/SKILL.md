---
name: shark-skill-creator
description: 进阶版 Skill Creator（Meta-Skill）：通过对话式访谈，帮助用户把重复工作流和隐性经验编译成标准化、可执行、可评测、可迭代的 Agent Skill。Use when the user wants to create a new skill, improve an existing skill, or turn a repeated workflow / expertise into a reusable agent capability. 当用户想创建或改进 Skill、想把"我经常这样做"变成"Agent 可以稳定这样做"时使用。
---

# Skill Creator Pro —— 进阶版技能创作者

本 Skill 是一个 **Meta-Skill：用 Skill 帮助人创建 Skill**。目标不是帮用户"写一段 Prompt"，而是把用户的经验与工作流编译成完整的能力封装单元（Skill Package）。

## 何时使用本 Skill

当出现以下任一情况时触发：

- 用户想"做一个 Skill / 技能 / 助手能力"。
- 用户想改进、重构或评测现有 Skill。
- 用户描述了一个重复性工作流（"我每次都要让 AI 做 X"）。
- 用户希望 Agent 按一套固定方法稳定完成任务。
- 用户问 Skill、Tool、MCP 是什么关系，或 Skill 该怎么做。

## 核心心智模型

先用以下框架校准对 Skill 的理解：

- **Skill ≈ Prompt + Workflow + Knowledge + Executable Resources**（工程化定义：可发现、可组合、可按需加载、可执行、可测试的能力封装单元）。
- **Tool = 手；Skill = 技能/方法；Agent = 使用手和技能解决问题的人**。
- **Prompt ⊂ Skill**：Prompt 告诉模型"怎么回答"，Skill 告诉 Agent"这一类任务应该怎么工作"。
- **MCP / Tools = 能力接口；Skill = 方法与流程；Agent = 决定何时、为何、如何组合能力**。
- 一句话哲学：**不要帮用户写 Prompt；帮用户把经验编译成能力。**

## 工作流程总览（七阶段）

所有 Skill 制作统一走七阶段，通常按序推进，允许按需回退：

```text
1. Discover  发现需求
2. Scope     定义边界
3. Model     结构化建模
4. Design    设计 Skill
5. Generate  生成 Skill Package
6. Evaluate  测试评估
7. Package   打包发布
```

聊天只是表现层。真正的系统必须维护一个结构化 **Skill State**（状态机），每次用户回答都更新它。详细的状态机与数据模型见 `references/skill-state-model.md`。

## 对话式创建协议（六原则）

整个制作过程采用对话式访谈，而不是大表单。遵循六原则：

1. **一次只追问最重要的未知量**：不要一次问十个问题；根据当前 Skill State，只问对最终设计影响最大的那一个。
2. **能给选项时优先给选项**：提供 A/B/C/D 选项 + 推荐项，用户更容易回答。
3. **允许用户直接用自然语言回答**：用户说"我大概就是先看 Caused by 再查配置"，Agent 自动结构化。
4. **Agent 不只是提问，还要提设计意见**：角色 = Interviewer + Analyst + Architect，主动给建议（如"推荐先从 A+B 开始，否则范围过大"）。
5. **主动暴露不确定性**：指出信息缺口与风险（如"缺少日志不足时的 fallback 规则"），建议补充策略。
6. **始终让用户看到产物**：每次回答后，Skill State / 产物预览都要有可见变化，增强"正在创造真实东西"的感觉。

各阶段的具体提问话术见 `references/interview-protocol.md`。

## 七阶段执行细则

### 阶段 1：Discover —— 发现真实任务

从用户的工作出发，不先问名字。追问：

- 你经常让 AI 做什么？
- 这个任务为什么值得 Skill 化？
- 现在是怎么做的？
- 哪一步最耗时 / 最容易出错？

**判定是否适合 Skill 化**（见下节清单），不适合时说明原因并帮用户梳理流程。

### 阶段 2：Scope —— 定义边界

Skill 最容易犯的范围过大的错误。边界越清晰，越容易触发、维护、测试、复用、迭代。明确：

- 做什么 / 不做什么。
- 面向谁。
- 哪些输入在范围内。
- 什么情况应退出或升级（escalation）。

收窄示例：`Java` → `Spring Boot` → `Spring Boot Error` → `Spring Boot Startup Error Diagnosis`。

### 阶段 3：Model —— 结构化建模

把自然语言需求拆成能力结构：

```text
Identity / Scope / Trigger / Input / Output / Workflow /
Knowledge / Tools / Scripts / Assets / Guardrails / Evaluation
```

这是从"自然语言需求"变成"能力结构"的关键一步。产出即 Skill State 的结构化字段。

### 阶段 4：Design —— 设计 Skill

决定每一部分放哪里：

- 什么写进 `SKILL.md`（核心流程与编排）。
- 什么放 `references/`（深层知识）。
- 什么写成 `scripts/`（确定性操作）。
- 什么用 `assets/`（模板素材）。
- 什么需要用户补充。

基本原则：**核心流程留在 SKILL.md，细节知识外置**。详见 `references/progressive-disclosure.md`。

### 阶段 5：Generate —— 生成 Skill Package

生成完整 Skill Package 而非一段 Prompt：

```text
skill-name/
├── SKILL.md        # 核心入口：身份与发现 + 工作指令 + 资源导航
├── references/     # 深层知识（按需加载）
├── scripts/        # 确定性、可重复的操作
└── assets/         # 工作素材、模板
```

使用脚手架生成目录后填充内容（Node 与 Python 二选一，环境有 Node 优先；无 Node 用 Python）：

```bash
node scripts/init_skill.mjs <skill-name> --path <输出目录> [--resources scripts,references,assets]
# 或：python scripts/init_skill.py <skill-name> --path <输出目录> [--resources scripts,references,assets]
```

平台工程层（manifest / evals / changelog / 平台私有字段）与 Skill 核心规范层分离，不混入标准结构。

### 阶段 6：Evaluate —— 测试评估

**Generated ≠ Validated**。生成成功不等于真的有效。必须：

1. 生成 3~5 个代表性测试案例（Happy Path / Edge Case / Missing Information / Failure Case）。
2. 明确每个案例的期望行为。
3. 用 `scripts/validate_skill.mjs`（或 `scripts/validate_skill.py`）做结构校验（frontmatter / 命名 / 引用完整性）。
4. 对真实或模拟输入执行评估，判 Pass / Fail。
5. 失败则回退到对应阶段 Refine，再回 Evaluate。

评测方法与质量维度详见 `references/evaluation-and-quality.md`。

### 阶段 7：Package —— 打包发布

形成可移动、可复用、可导入的 Skill Package：Skill 核心结构 + 元数据 + 评测结果 + 版本。如需分发，压缩为 zip 或按平台要求打包；评估未完成时不得声称 ready。

## Skill 标准结构（规范层）

```text
skill-name/
├── SKILL.md            # 必需：身份与发现 + 工作指令 + 资源导航
├── references/         # 可选：领域知识、官方文档摘要、规范、最佳实践
├── scripts/            # 可选：确定性程序（解析、校验等不该靠 LLM 猜的工作）
└── assets/             # 可选：模板、logo、示例素材
```

**SKILL.md 只负责"编排和指导"，不把所有知识塞进去。** access / permissions / allowed-tools / auth / hooks / config 属于宿主平台扩展层，不属于 Skill 最小核心，设计时把规范层与平台扩展层分离。

## 渐进披露原则

```text
用户请求 → Skill Discovery（name + description）→ 加载 SKILL.md → 必要时才读 references/ 或运行 scripts/
```

一句话：**先知道有没有用，再知道怎么用，最后才加载深层资源。** 因此 `description` 必须同时包含 WHAT（做什么）和 WHEN（何时用、触发场景）。

## 什么任务适合做成 Skill（判定清单）

同时具备以下特征的任务才适合 Skill 化：

- **重复发生**：经常要做。
- **方法相对稳定**：用户能说"我一直按这 N 个步骤处理"。
- **有明确输入和输出**。
- **有一套可复用的方法论**。
- **能定义"完成得好不好"**（正确率 / 覆盖率 / 是否遵守流程 / 是否给出验证步骤）。

若用户只能说"帮我处理一下，我也不知道该怎么做"，说明尚未形成稳定方法论，应先帮其梳理，而非强行生成 Skill。

## 常见误区（速查）

1. **Skill 就是一大段 Prompt** —— 错。应拆为 Workflow + Knowledge + Scripts + Evaluation。
2. **所有东西都塞进 SKILL.md** —— 错。SKILL.md 只留核心流程，其余外置。
3. **范围越大越厉害** —— 通常相反，大范围难以触发、评测、维护。
4. **生成成功就算成功** —— 错。必须有测试和评估（Generated ≠ Validated）。
5. **对话式 Skill Creator 只是聊天机器人** —— 错。必须有 Skill State、状态机、结构化数据模型、Evaluation、Artifact Generation。聊天只是 UI。

误区详解见 `references/common-mistakes.md`。

## 资源导航

按需读取，不一次性全部加载：

| 需要什么 | 读取 |
|---|---|
| 14 节完整 Skill Specification 模板 | `references/skill-specification.md` |
| 状态机设计 + Skill State 数据模型 | `references/skill-state-model.md` |
| 对话六原则详解 + 各阶段提问话术 | `references/interview-protocol.md` |
| Evaluation 方法 + Skill Quality 维度 | `references/evaluation-and-quality.md` |
| SKILL.md / references / scripts / assets 分工细则 | `references/progressive-disclosure.md` |
| 常见误区详解与规避 | `references/common-mistakes.md` |
| 脚手架生成（Node/Python 双版本） | `scripts/init_skill.mjs`、`scripts/init_skill.py` |
| 结构校验（Node/Python 双版本） | `scripts/validate_skill.mjs`、`scripts/validate_skill.py` |

## 交付要求

完成全部七阶段后交付：

- 完整 Skill Package（含 SKILL.md 与必要资源）。
- 3~5 个评测案例及 Pass/Fail 结果。
- 结构校验通过（`validate_skill.mjs` / `validate_skill.py` 无 error）。
- 一段面向用户的说明：Skill 名称、触发场景、目录结构、已知限制。
