---
name: Sample-Bad-Name
description: Mock 样本——name 含大写字符违反 hyphen-case，验证严格模式下 codex 侧 fail 与诊断模式降级 warn
---

# Sample Bad Name

本目录是校验器 mock 样本，不是真实技能。

预期行为（见 PLAN-06 §3.1 命名规则 / §3.6 双轨）：

- strict 模式：name 非 hyphen-case → error，codex 侧 verdict=fail，passed=false；
- diagnostic 模式：同规则降级为 warn，永不 fail。
