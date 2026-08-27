# Skill State 状态机与数据模型

聊天只是表现层。真正的创作系统必须维护一个结构化 **Skill Creation State**，Agent 的每一次提问都在完善这个结构。

## 状态机

```text
                ┌───────────────┐
                │   Discovery   │
                └───────┬───────┘
                        ↓
                ┌───────────────┐
                │     Scope     │
                └───────┬───────┘
                        ↓
                ┌───────────────┐
                │    Workflow   │
                └───────┬───────┘
                        ↓
                ┌───────────────┐
                │    Design     │
                └───────┬───────┘
                        ↓
                ┌───────────────┐
                │   Generate    │
                └───────┬───────┘
                        ↓
                ┌───────────────┐
                │   Evaluate    │
                └───┬───────┬───┘
                  Fail     Pass
                    ↓        ↓
                Refine    Package
                    │
                    └──────→ Evaluate
```

规则：

- 允许前进、回退、跳转（已有 Skill 可从 Model/Design/Generate 进入，不强制从 Discover 重做）。
- 阶段完成度由字段覆盖度计算，**不以"AI 返回成功"作为完成条件**。
- Evaluation 失败或用户标记缺口后，回到 Scope / Model / Design / Generate 之一 Refine，再回 Evaluate。

## Skill State 数据模型（JSON）

```json
{
  "name": "",
  "description": "",
  "goal": "",
  "triggers": [],
  "inputs": [],
  "outputs": [],
  "workflow": [],
  "knowledge": [],
  "tools": [],
  "scripts": [],
  "assets": [],
  "guardrails": [],
  "examples": [],
  "evaluations": [],
  "status": "designing"
}
```

`status` 取值建议：`designing`（设计中）→ `generated`（已生成）→ `needs_refinement`（需改进）→ `ready`（就绪）。**评测未完成不得进入 `ready`。**

## 完整数据模型（平台内部抽象）

```text
Skill
│
├── Identity
│   ├── name
│   ├── description
│   └── version
│
├── Scope
│   ├── goals
│   ├── triggers
│   ├── inputs
│   └── outputs
│
├── Workflow
│   ├── steps
│   ├── decision points
│   ├── fallback
│   └── escalation
│
├── Knowledge
│   └── references
│
├── Tools
│   ├── MCP
│   └── local tools
│
├── Scripts
│   └── executable procedures
│
├── Assets
│   └── templates / resources
│
├── Guardrails
│   ├── must
│   ├── must-not
│   └── uncertainty
│
└── Evaluation
    ├── test cases
    ├── expected behavior
    └── quality criteria
```

## 分层原则

- **Skill 核心规范层**：SKILL.md + references/ + scripts/ + assets/ —— 可移植、可导入任何平台。
- **平台工程层**：manifest、evals/、changelog、metadata、部署配置 —— 平台私有，与核心规范分离管理，避免把平台私有内容混入标准结构。
