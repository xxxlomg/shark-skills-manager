---
name: sample-unknown-field
description: Mock 样本——frontmatter 含白名单外的 category 字段，用于验证 C2/C3 诊断提示与矩阵分流（诊断=warn 不阻断，严格=error）
category: testing
---

# Sample Unknown Field

本目录是校验器 mock 样本，不是真实技能。

预期行为（见 PLAN-06 §3.5/§3.6）：

- diagnostic 模式：claude 侧报 warn（未知字段 'category'），passed=true；
- strict 模式：未知字段升级为 error，claude 侧 verdict=fail；
- codex 侧同样不识别 category，按 CX 白名单基线五字段分流。
