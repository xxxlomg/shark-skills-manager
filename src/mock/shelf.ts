import type { ShelfPreview } from "@/lib/api";

/**
 * 模块 A：货架浏览 mock（?mock=1 下 RepoBrowseDialog 演示数据）。
 * 覆盖三类形态：正常条目、含中文简介、sha256 声明不符（演示警告徽标）。
 */
export const MOCK_SHELF: Omit<ShelfPreview, "token"> = {
  repo_name: "ruanzh 的技能货架",
  updated_at: "2026-08-04T12:00:00Z",
  source: "git+index",
  packs: [
    {
      id: "opencode-essentials",
      name: "OpenCode Essentials",
      ver: "1.2.0",
      path: "packs/opencode-essentials.skillpack",
      skill_count: 5,
      summary_zh: "OpenCode 日常开发必备：提交信息、代码审查、重构",
      updated_at: "2026-08-01T09:30:00Z",
      declared_sha256: "a1b2c3d4e5f6",
      actual_sha256: "a1b2c3d4e5f6",
      sha256_mismatch: false,
    },
    {
      id: "frontend-toolkit",
      name: "Frontend Toolkit",
      ver: "0.9.1",
      path: "packs/frontend-toolkit.skillpack",
      skill_count: 8,
      summary_zh: "前端全家桶：组件生成、样式审查、a11y 检查",
      updated_at: "2026-08-03T18:12:00Z",
      declared_sha256: "f6e5d4c3b2a1",
      actual_sha256: "f6e5d4c3b2a1",
      sha256_mismatch: false,
    },
    {
      id: "docs-writer",
      name: "Docs Writer",
      ver: "2.0.0",
      path: "packs/docs-writer.skillpack",
      skill_count: 3,
      summary_zh: "文档生成与润色（清单已过期，sha256 演示不一致）",
      updated_at: "2026-07-20T10:00:00Z",
      declared_sha256: "deadbeef0000",
      actual_sha256: "c0ffee112233",
      sha256_mismatch: true,
    },
  ],
};
