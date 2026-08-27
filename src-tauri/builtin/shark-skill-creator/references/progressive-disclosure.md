# Progressive Disclosure：分层结构与分工细则

## 为什么需要渐进披露

如果一个 Agent 有 100 个 Skill，每个都很长，全部一次性放进上下文会：

- Context 快速膨胀。
- 不相关信息干扰模型。
- 成本上升。
- 触发判断变差。
- 维护困难。

因此采用分层加载：

```text
用户请求
   ↓
Skill Discovery（只看 name + description）
   ↓
判断是否相关
   ↓
加载 SKILL.md
   ↓
只有必要时
   ├── 读取 references/
   ├── 执行 scripts/
   └── 使用 assets/
```

一句话：**先知道有没有用，再知道怎么用，最后才加载深层资源。**

## 三个加载层级

1. **Metadata（name + description）**—— 始终在上下文（~100 词）。决定是否触发。
2. **SKILL.md 正文** —— 触发后加载（控制在 <5k 词 / <500 行）。
3. **Bundled Resources** —— 按需读取/执行（references 读入上下文；scripts 可直接执行；assets 用于产物）。

## 各目录一句话定义（附录 B）

```text
SKILL.md
= "这个 Skill 是什么，以及 Agent 应该怎么工作。"

references/
= "Agent 需要知道的深层知识。"

scripts/
= "不应该靠模型猜，而应该交给程序完成的确定性工作。"

assets/
= "完成任务时需要使用的模板和素材。"
```

## SKILL.md 的三类职责

1. **身份与发现**：这是什么 Skill、什么时候可能有用（frontmatter 承担）。
2. **工作指令**：如何执行这一类任务（核心编排流程）。
3. **资源导航**：什么情况下读哪个 reference、运行哪个 script。

**SKILL.md 负责"编排和指导"，不把所有知识都塞进去。**

## references/：知识外置

适合存放：

- 领域知识、官方文档摘要。
- 企业内部规范、最佳实践。
- Troubleshooting 指南、错误类型说明。
- API 规范、决策规则。

回答："为了完成任务，Agent 需要知道什么？"

示例：

```text
references/
├── dependency-conflicts.md
├── bean-creation-errors.md
├── datasource-errors.md
└── diagnosis-methodology.md
```

## scripts/：确定性程序

适合放解析、校验、转换等机械操作：

```text
LLM：解释异常
Script：机械地解析异常链、提取文件名/行号/异常类型
```

回答："有没有事情应该交给程序做，而不是交给 LLM 猜？"

最理想组合：**LLM Reasoning + Deterministic Scripts**。

## assets/：工作素材

存放产出需要的模板与资源：

```text
assets/
├── report-template.docx
├── company-logo.svg
├── brand-template.pptx
└── icons/
```

回答："这个任务要实际产出东西时，需要哪些素材？"

## access / permissions：平台扩展层

```text
Agent Skills Core          Platform Extensions
├── SKILL.md               ├── permissions
├── references/            ├── authentication
├── scripts/               ├── allowed tools
└── assets/                ├── hooks
                           └── runtime config
```

这些通常属于宿主 Agent 平台的扩展机制，不是 Skill 最小核心结构。设计平台时把**规范层**与**平台扩展层**分离。

## 编写检查清单

- [ ] SKILL.md 是否只含核心流程与资源导航？（<500 行）
- [ ] 深层知识是否已外置到 references/？
- [ ] 机械操作是否已写成 scripts/？
- [ ] 每个资源是否在 SKILL.md 中说明"何时读取/使用"？
- [ ] description 是否同时包含 WHAT 和 WHEN？（触发只在 description，不在正文）
- [ ] 引用是否保持一层深（SKILL.md → references/xxx.md，不嵌套过深）？
