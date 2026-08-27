# 对话式创建协议：六原则详解 + 提问话术

Skill Creator 采用对话式访谈而非大表单。核心形态：

```text
User
  ↕
AI Interviewer（+ Analyst + Architect）
  ↕
Skill State
```

一次只问当前最重要的问题，根据之前的答案动态决定下一步。

## 六原则详解

### 原则一：一次只追问最重要的未知量

不要一次问十个问题。根据当前 Skill State，找出**对最终设计影响最大的未知变量**，只问这一个。

### 原则二：能给选项时优先给选项

选项让用户更容易回答，且能引导收敛范围。推荐在选项后附加建议。

示例：

```text
这个 Skill 主要解决哪些问题？
A. 启动失败
B. 运行时异常
C. 数据库连接
D. 性能问题
E. 全部
推荐先从 A + B 开始，否则范围容易过大。
```

### 原则三：允许用户直接说自然语言

用户可以说："我平常大概就是先看 Caused by，然后看 Bean，再查配置。" Agent 自动结构化。

### 原则四：Agent = Interviewer + Analyst + Architect

不只是提问，还要主动提出设计意见：

```text
推荐先从启动异常开始，因为"所有 Spring Boot 异常"范围太大，容易导致触发和评测失控。
```

### 原则五：主动暴露不确定性

指出缺口与风险：

```text
目前还缺少"日志信息不足时怎么办"的规则。建议先补一个 fallback 策略。
```

### 原则六：始终让用户看到产物

用户每次回答后，Skill State / 产物预览都应可见变化，增强"我正在创造一个真实东西"的感觉。

## 各阶段提问话术

### Discover（发现真实任务）

不先问"你的 Skill 叫什么名字"，而是从工作出发：

- 你经常让 AI 做什么？
- 这个任务为什么值得自动化？
- 一般多久做一次？
- 最耗时的是哪一步？
- 哪一步最容易出错？

### Scope（定义边界）

- 这个 Skill 做什么？不做什么？
- 面向谁使用？
- 哪些输入属于范围？哪些情况应该退出或升级？
- 建议收窄：`Java` → `Spring Boot` → `Spring Boot Error` → `Spring Boot Startup Error Diagnosis`。

### Model（结构化建模）

逐个补齐结构化字段，一次一个：

- 最终希望它输出什么？
  - A. 直接给修复方案
  - B. Root Cause + 修复方案
  - C. 多个候选原因并排序
  - D. 验证步骤
  - 建议 B + C + D，减少把推测当结论的风险。
- 通常能拿到哪些输入？→ 完整日志 / Stack Trace / 配置文件 / 代码片段 / 都可能。
- 触发这个 Skill 的用户话术是什么？

### Design（设计结构）

- 哪些内容写进 SKILL.md（核心流程）？
- 哪些知识外置到 references/？
- 哪些操作应该脚本化（不该让 LLM 猜）？
- 需要哪些素材（assets/）？

### Generate（生成）

按确认的 State 生成完整 Package，而不是只生成一段 Markdown。生成后展示目录结构与 SKILL.md 预览。

### Evaluate（评测）

- 与用户确认 3~5 个代表性测试案例（Happy Path / Edge Case / Missing Information / Failure Case）。
- 明确每个案例的期望行为。
- 运行校验脚本 + 执行案例，判 Pass / Fail。
- 失败案例回链到具体设计阶段，而非重新生成全部正文。

### Package（打包发布）

- 确认目录结构、版本、评测摘要。
- 需要分发时压缩打包；平台工程层与核心规范层分离。

## 示例：Spring Boot Skill 创建对话

用户：我想做一个 Spring Boot 异常排查 Skill。

Agent：这个 Skill 主要想解决哪些问题？
A. 启动失败  B. 运行时异常  C. 数据库连接  D. 性能问题  E. 全部
推荐先从 A + B 开始，否则范围容易过大。

用户：A + B。

Agent：这个 Skill 通常能拿到哪些输入？
A. 完整日志  B. Stack Trace  C. application.yml  D. pom.xml / build.gradle  E. 代码片段  F. 都可能

用户：F。

Agent：最终你希望它输出什么？
A. 直接给修复方案  B. Root Cause + 修复方案  C. 多个候选原因并排序  D. 验证步骤
我建议 B + C + D，这样能减少把推测当结论的风险。

→ 每次回答后更新 Skill State，继续下一个最高价值问题。
