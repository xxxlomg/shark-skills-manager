import type { ToolInfo } from "@/lib/api";

/**
 * mock 工具注册表（?mock=1 预览用）。
 * 包含应用自有来源 + 外部可链接工具（演示安装徽标与批量派送）。
 */
export const MOCK_TOOLS: ToolInfo[] = [
  { id: "builtin", name: "builtin", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
  { id: "imported", name: "导入", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
  { id: "authored", name: "创作库", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
  { id: "claude-code", name: "Claude Code", builtin: true, app_owned: false, enabled: true, linkable: true, paths: ["~/.claude/skills"], path_exists: [true], link_count: 1 },
  { id: "codex", name: "Codex CLI", builtin: true, app_owned: false, enabled: true, linkable: true, paths: ["~/.codex/skills"], path_exists: [true], link_count: 1 },
  { id: "cursor", name: "Cursor", builtin: true, app_owned: false, enabled: true, linkable: true, paths: ["~/.cursor/skills"], path_exists: [false], link_count: 0 },
];
