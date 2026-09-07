/**
 * 工作流 M 阶段 2 mock：查重演示数据（?mock=1 预览用）。
 * 成员指向虚拟目录 /mock/dupdemo/*，与 MOCK_SKILLS 隔离；
 * readSkillFile / skillListFiles 对这些路径返回本文件的演示内容，
 * 不触碰既有 mock（MOCK_RAW 哈希对齐的速览演示不受影响）。
 *
 * R4：成员携带 body_hash/body_len/mtime 三字段——
 * g-0005 为 10 成员极端压测组（4 种内容变体 + 6 份相同副本）。
 */
import type { DupGroup, DupMember } from "@/lib/api";

/**
 * A 侧正文：docker 容器查询（基础版）。
 * 故意以 CRLF 存储（split/join 转换）：模拟 Boss 实测场景——
 * 本地工具目录 CRLF vs 导入 zip LF 的同一份技能，
 * 验证 LineDiff 行尾归一后只高亮真实内容差异而非整篇全红。
 */
const DEMO_MD_A_LF = `---
name: docker-ps
description: List running docker containers with status
---

# docker-ps

查询正在运行的 Docker 容器列表。

## 何时使用
- 想知道当前有哪些容器在运行
- 排查容器状态问题

## 步骤
1. 执行 \`docker ps\`
2. 需要详细信息时加 \`--format\`

## 输出格式
CONTAINER ID / IMAGE / STATUS / PORTS
`;
export const DEMO_MD_A = DEMO_MD_A_LF.split("\n").join("\r\n");

/** B 侧正文：docker 容器查询（增强版，与 A 相近微差 → diff 有真实内容） */
export const DEMO_MD_B = `---
name: docker-ps-v2
description: List running docker containers with status and ports, with filtering support
---

# docker-ps

查询正在运行的 Docker 容器列表（增强版）。

## 何时使用
- 想知道当前有哪些容器在运行
- 需要按镜像名过滤容器

## 步骤
1. 执行 \`docker ps --all\`
2. 用 \`--filter ancestor=<image>\` 过滤
3. 输出 JSON 格式便于脚本解析

## 常见问题
Q：权限被拒绝怎么办？
A：加 sudo 或把用户加入 docker 组。
`;

/** 附件演示内容（按 rel 区分） */
const DEMO_FILES: Record<string, [string, string]> = {
  "scripts/setup.sh": [
    "#!/usr/bin/env bash\n# 基础版：仅检查 docker 是否安装\ncommand -v docker >/dev/null || exit 1\n",
    "#!/usr/bin/env bash\n# 增强版：检查 docker + compose\ncommand -v docker >/dev/null || exit 1\ncommand -v docker-compose >/dev/null || echo 'compose missing'\n",
  ],
  "references/guide.md": [
    "# 参考\n\ndocker ps 常用参数速查。\n",
    "# 参考\n\ndocker ps 常用参数速查（含 filter 章节）。\n\n## filter\n--filter ancestor=...\n",
  ],
};

/**
 * 长文演示（验收案例：对应 Boss 实测的 design-taste-frontend，~1200 行）。
 * A/B 章节标题相同、段落微差 → mergeBodies 产生大量段落冲突，
 * 用于验证滚动域（页面不滚 / 内容视口滚 / footer 常驻）与冲突列表渲染。
 */
function buildLongBody(seed: number): string {
  const lines: string[] = ["# design-taste-frontend", "", "前端设计品味长文演示（mock 生成）。", ""];
  for (let s = 0; s < 100; s++) {
    lines.push(`## Section ${s + 1}`);
    for (let p = 0; p < 10; p++) {
      lines.push(
        `Paragraph ${s + 1}.${p + 1}: 设计是空间、节奏与层级的安排，留白即克制，hairline 即秩序。（variant ${seed}-${s}-${p}）`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
export const DEMO_MD_LONG_A = `---\nname: design-taste-frontend\ndescription: 长文演示技能 A（~1200 行）\n---\n\n${buildLongBody(1)}`;
export const DEMO_MD_LONG_B = `---\nname: design-taste-frontend\ndescription: 长文演示技能 B（~1200 行，微调版）\n---\n\n${buildLongBody(2)}`;

/**
 * 多副本（N>2）演示正文：同名 docker-ps 散落在多个工具目录，
 * 内容完整度各异 → 供 DupPanel「推荐基准」打分演示（F3）。
 */
export const DEMO_MD_C = `---
name: docker-ps
description: 查询 docker 容器
---

# docker-ps

快速查询容器。
`;
export const DEMO_MD_D = `---
name: docker-ps
---

# docker-ps

容器查询工具（缺 description 的残缺版）。

## 步骤
1. 执行 docker ps
`;

/** dupdemo 路径 → 演示正文；非 dupdemo 路径返回 null（调用方回落 MOCK_RAW）。
 *  R4：e-/i- 复用 A 内容、f-/j- 复用 B、g- 复用 C、h- 复用 D（10 成员组的相同副本）。 */
export function dupDemoFile(path: string): string | null {
  const norm = path.replace(/\\/g, "/");
  if (!norm.includes("/dupdemo/")) return null;
  if (norm.endsWith("SKILL.md")) {
    if (norm.includes("/dupdemo/long-a-")) return DEMO_MD_LONG_A;
    if (norm.includes("/dupdemo/long-b-")) return DEMO_MD_LONG_B;
    if (norm.includes("/dupdemo/c-") || norm.includes("/dupdemo/g-")) return DEMO_MD_C;
    if (norm.includes("/dupdemo/d-") || norm.includes("/dupdemo/h-")) return DEMO_MD_D;
    if (norm.includes("/dupdemo/b-") || norm.includes("/dupdemo/f-") || norm.includes("/dupdemo/j-"))
      return DEMO_MD_B;
    return DEMO_MD_A;
  }
  const isA = norm.includes("/dupdemo/a-") || norm.includes("/dupdemo/e-") || norm.includes("/dupdemo/i-");
  for (const [rel, pair] of Object.entries(DEMO_FILES)) {
    if (norm.endsWith(`/${rel}`)) return isA ? pair[0] : pair[1];
  }
  return "# （mock 演示文件）";
}

/** R4 紧凑成员工厂：统一补 body_hash/body_len/mtime 三字段 */
function mem(
  skill_id: string,
  name: string,
  title_zh: string,
  scan_label: string,
  tool_id: string,
  dir: string,
  o: { emoji?: string; tr?: boolean; hash?: string | null; len?: number; mt?: number } = {}
): DupMember {
  const prefix = dir.startsWith("/mock/") ? dir : `/mock/dupdemo/${dir}`;
  return {
    skill_id,
    name,
    title_zh,
    emoji: o.emoji ?? "🐳",
    scan_label,
    tool_id,
    skill_dir: prefix,
    source_path: `${prefix}/SKILL.md`,
    hub_linked: false,
    has_translation: o.tr ?? false,
    body_hash: o.hash === undefined ? null : o.hash,
    body_len: o.len ?? 0,
    mtime: o.mt ?? 0,
  };
}

/** mock 查重结果：identical 组 / 同名组 / 长文组 / 4 副本组 / 10 成员极端组 */
export const MOCK_DUP_GROUPS: DupGroup[] = [
  {
    id: "g-0001",
    kind: "identical",
    score: 1.0,
    reason: "SKILL.md 正文完全相同（frontmatter 可能微差）——疑似同一份技能散落在多处。",
    members: [
      mem("builtin|skills-shark-quickstart", "skills-shark-quickstart", "快速上手", "builtin", "builtin", "/mock/builtin/skills-shark-quickstart", { emoji: "🦈", tr: true, hash: "h-q", len: 480, mt: 1754800000 }),
      mem("imported|skills-shark-quickstart-copy", "skills-shark-quickstart", "快速上手", "imported", "imported", "/mock/imported/skills-shark-quickstart-copy", { emoji: "🦈", hash: "h-q", len: 480, mt: 1754700000 }),
    ],
  },
  {
    id: "g-0002",
    kind: "same_name",
    score: 0.5,
    reason: "同名技能出现在不同目录——可能是同一技能的副本或微调版本，请对比后处理。",
    members: [
      mem("claude|docker-ps", "docker-ps", "容器列表", "Claude", "claude-code", "a-docker-ps", { tr: true, hash: "h-a", len: 400, mt: 1754900000 }),
      mem("authored|docker-ps", "docker-ps", "容器列表（副本）", "authored", "authored", "b-docker-ps", { hash: "h-b", len: 520, mt: 1755000000 }),
    ],
  },
  {
    id: "g-0003",
    kind: "same_name",
    score: 0.5,
    reason: "同名长文技能（~1200 行）——滚动域验收案例，段落微差需逐节确认。",
    members: [
      mem("claude|design-taste-frontend", "design-taste-frontend", "前端设计品味", "Claude", "claude-code", "long-a-design-taste", { emoji: "🎨", tr: true, hash: "h-la", len: 60000, mt: 1754000000 }),
      mem("imported|design-taste-frontend", "design-taste-frontend", "前端设计品味", "imported", "imported", "long-b-design-taste", { emoji: "🎨", hash: "h-lb", len: 60100, mt: 1755100000 }),
    ],
  },
  {
    id: "g-0004",
    kind: "same_name",
    score: 0.5,
    reason: "同名技能散落在 4 个工具目录——多副本场景，可先按推荐基准处理。",
    members: [
      mem("claude|docker-ps", "docker-ps", "容器列表", "Claude", "claude-code", "a-docker-ps", { tr: true, hash: "h-a", len: 400, mt: 1754900000 }),
      mem("authored|docker-ps", "docker-ps", "容器列表（增强）", "authored", "authored", "b-docker-ps", { hash: "h-b", len: 520, mt: 1755000000 }),
      mem("imported|docker-ps", "docker-ps", "容器列表（精简）", "imported", "imported", "c-docker-ps", { hash: "h-c", len: 60, mt: 1754200000 }),
      mem("codex|docker-ps", "docker-ps", "容器列表（残缺）", "codex", "codex", "d-docker-ps", { hash: "h-d", len: 90, mt: 1754000000 }),
    ],
  },
  {
    id: "g-0005",
    kind: "same_name",
    score: 0.5,
    reason: "同名技能散落在 10 个工具目录——极端多副本压测：4 种内容变体，其中 6 份为相同副本。",
    members: [
      // 变体 A（×3）
      mem("claude|docker-ps", "docker-ps", "容器列表", "Claude", "claude-code", "a-docker-ps", { tr: true, hash: "h-a", len: 400, mt: 1755100000 }),
      mem("imported|docker-ps-a2", "docker-ps", "容器列表", "imported", "imported", "e-docker-ps", { hash: "h-a", len: 400, mt: 1754600000 }),
      mem("codex|docker-ps-a3", "docker-ps", "容器列表", "codex", "codex", "i-docker-ps", { hash: "h-a", len: 400, mt: 1754500000 }),
      // 变体 B（×3）
      mem("authored|docker-ps", "docker-ps", "容器列表（增强）", "authored", "authored", "b-docker-ps", { hash: "h-b", len: 520, mt: 1755000000 }),
      mem("claude|docker-ps-b2", "docker-ps", "容器列表（增强）", "Claude", "claude-code", "f-docker-ps", { hash: "h-b", len: 520, mt: 1754400000 }),
      mem("imported|docker-ps-b3", "docker-ps", "容器列表（增强）", "imported", "imported", "j-docker-ps", { hash: "h-b", len: 520, mt: 1754300000 }),
      // 变体 C（×2）
      mem("imported|docker-ps", "docker-ps", "容器列表（精简）", "imported", "imported", "c-docker-ps", { hash: "h-c", len: 60, mt: 1754200000 }),
      mem("codex|docker-ps-c2", "docker-ps", "容器列表（精简）", "codex", "codex", "g-docker-ps", { hash: "h-c", len: 60, mt: 1754100000 }),
      // 变体 D（×2）
      mem("codex|docker-ps", "docker-ps", "容器列表（残缺）", "codex", "codex", "d-docker-ps", { hash: "h-d", len: 90, mt: 1754000000 }),
      mem("authored|docker-ps-d2", "docker-ps", "容器列表（残缺）", "authored", "authored", "h-docker-ps", { hash: "h-d", len: 90, mt: 1753900000 }),
    ],
  },
  {
    id: "g-0006",
    kind: "identical",
    score: 1.0,
    reason: "三份内容全等的副本——V==1 特例验收组：无需合并，直接保留基准处置其余。",
    members: [
      mem("claude|skills-shark-packs", "skills-shark-packs", "打包流通", "Claude", "claude-code", "v1-packs", { emoji: "📦", tr: true, hash: "h-p", len: 300, mt: 1755200000 }),
      mem("imported|skills-shark-packs-2", "skills-shark-packs", "打包流通", "imported", "imported", "v2-packs", { emoji: "📦", hash: "h-p", len: 300, mt: 1755000000 }),
      mem("codex|skills-shark-packs-3", "skills-shark-packs", "打包流通", "codex", "codex", "v3-packs", { emoji: "📦", hash: "h-p", len: 300, mt: 1754900000 }),
    ],
  },
];
