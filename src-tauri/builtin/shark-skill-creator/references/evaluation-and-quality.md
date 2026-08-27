# Evaluation 评测方法与 Skill Quality 质量维度

## 为什么一定要有测试

很多 Skill Builder 的问题：

```text
用户需求 → 生成 SKILL.md → 完成
```

但 **看起来合理 ≠ 真的有效**。Skill 必须经过评测。把流程升级为：

```text
Create → Test → Evaluate → Improve → Retest → Release
```

## 评测结构

```text
Skill
  +
Test Case
  ↓
Agent
  ↓
Output
  ↓
Evaluator
  ↓
Score / Pass / Fail
```

## 测试案例类型（默认生成 3~5 个）

| 类型 | 说明 | 示例（Spring Boot 异常排查） |
|---|---|---|
| Happy Path | 正常输入，走主流程 | 完整日志 + 明显 BeanCreationException |
| Edge Case | 边界/极端输入 | 日志截断、只有最后一行异常 |
| Missing Information | 信息不足 | 只有一行报错没有上下文 |
| Failure Case | 已知错误输入 | 空日志 / 无异常堆栈 |
| 领域特例（可选） | 该领域专属场景 | DataSource 初始化失败 |

每个案例包含：

```text
- id / 类型
- input：输入内容
- expected_behavior：期望行为（如"正确识别 Bean 创建类问题、沿 cause chain 继续分析、不武断归因"）
- status：pending / pass / fail / not-run
- notes：失败说明 / 改进方向
```

## 案例示例

**Test Case 01：BeanCreationException**
输入：`BeanCreationException` + `Caused by: ...`
期望：
- 正确识别 Bean 创建类问题。
- 沿 cause chain 继续分析。
- 不直接武断归因为代码问题。

**Test Case 02：NoSuchBeanDefinitionException**
期望：
- 判断 Bean 注册/扫描相关问题。
- 检查 component scan / configuration / bean definition。

**Test Case 03：DataSource 初始化失败**
期望：
- 判断 datasource / DB 配置问题。
- 优先检查连接信息、驱动、环境。

## Skill Quality 评分维度

```text
Skill Quality
────────────────────
Trigger accuracy       92%   触发准确度：description 是否精准触发
Scope clarity          95%   范围清晰度：边界是否明确
Workflow compliance    88%   流程符合度：是否按步骤执行
Knowledge coverage     81%   知识覆盖率：references 是否覆盖领域
Tool usage             90%   工具使用正确性
Reliability            87%   可靠性：多种输入下的稳定性
Evaluation coverage    85%   评测覆盖率：测试案例是否覆盖主要场景
────────────────────
Overall                89%
```

## 评分后的解释与迭代

评分后向用户解释缺口并提出改进建议，而非只报分数：

```text
当前 Skill 可以使用，但仍有两个明显缺口：
1. 对依赖冲突缺乏明确判断规则。
2. 对日志信息不足的情况没有定义追问策略。
建议补充两个案例后重新测试。
```

## 评测注意事项

- 评测评估的是**设计预期与案例覆盖**，不是格式校验本身（Validation ≠ Evaluation）。
- 首版可人工判定 Pass/Fail；不执行不可信脚本，不调用不可信外部 Agent。
- 失败案例可回链到 Scope / Workflow / Guardrails / Generate 阶段，精准迭代。
- 评测未完成时，状态不得标记为 ready。
