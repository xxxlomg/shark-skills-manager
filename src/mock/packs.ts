import type { PackInfo } from "@/lib/api";

export const MOCK_PACKS: PackInfo[] = [
  {
    id: "mock-pack-1",
    name: "OpenCode Essentials",
    ver: "1.0.0",
    author: "ruanzh",
    created_at: "2026-08-03T00:00:00Z",
    skill_count: 3,
    translated: 2,
    overview: "浏览器连接、技能沉淀与定时任务三件套，开箱即用的 OpenCode 增强包。",
    summary_source: "static",
    skill_names: ["browser-cdp", "make-skill", "cron-job"],
  },
];

/**
 * Mock 安装记录：deploy_root → 已部署的 skill folder 列表。
 * 用于模拟 D2 同名冲突（同目标二次安装 → 全部冲突）与覆盖/跳过流程。
 */
export const MOCK_INSTALLS = new Map<string, string[]>();
