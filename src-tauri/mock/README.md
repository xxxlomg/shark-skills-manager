# 后端 mock / fixture 样本目录（PLAN-06 约定）

后端（src-tauri）所有 mock 数据、校验 fixture、样例技能**只放本目录**。
前端 mock 数据归 `frontend/src/mock/`，两个目录互不引用。

## 目录

```
mock/
└─ skills/                        # 样例技能目录（每个含 SKILL.md）
   ├─ claude-skill-creator/       # Claude 官方原件快照（§3.1 fixture 基线：校验应全绿）
   ├─ codex-skill-creator/        # Codex 官方原件快照（§3.1 fixture 基线：按预期报差异项）
   │  └─ references/openai_yaml.md # 官方 openai.yaml 字段定义（C8 emitter 锚点，2026-08-05 补拷）
   ├─ sample-unknown-field/       # 含白名单外字段 → 诊断 warn / 严格 error
   └─ sample-bad-name/            # name 违反 hyphen-case → 严格 fail / 诊断降级 warn
```

## 用途

1. **C3 真机验收**：把 `skill_validate` 指向上述目录，核对矩阵输出与预期一致；
2. **回归基线**：官方原件快照是规则表的锚点——官方改版时先 diff 快照再改规则；
3. **新增样本**：构造新规则场景时在本目录加子文件夹，并在本 README 登记预期行为。

## 铁律

- 样本是只读资产：测试与验收只读不写；需要写副作用的场景用 tempdir；
- 不引用运行时的真实用户数据（`Roaming\shark\shark-skills-manager` 内容不进本目录）；
- 快照过期处理：官方原件更新 → 重新复制覆盖并在提交信息注明日期。
