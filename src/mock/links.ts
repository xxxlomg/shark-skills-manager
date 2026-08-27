import type { LinkStatus } from "@/lib/api";

/**
 * mock 引用台账（Hub 页）。
 * 约定：外部工具不做 mock 演示后，引用台账默认为空，展示 Hub 空状态；
 * 真实引用由后端 ledger 提供。
 *
 * 演示模式（?mock=1 + /hub）下用 MOCK_LINKS_DEMO 填充，覆盖：
 * - 设置了中文显示名（网格/行都要显示中文）+ 未设置（回落英文）两种形态
 * - 正常 / 落点缺失 两种健康状态
 */
export const MOCK_LINKS_DEMO: LinkStatus[] = [
  {
    id: "mock-link-1",
    skill_name: "imagegen-frontend-web",
    display_name: "图像生成前端",
    source: "D:\\vault\\skills\\imagegen-frontend-web",
    target: "C:\\Users\\demo\\.claude\\skills\\imagegen-frontend-web",
    target_tool: "claude-code",
    mode: "link",
    health: "normal",
    detail: "",
    created_at: "2026-08-01T10:00:00Z",
  },
  {
    id: "mock-link-2",
    skill_name: "docx",
    display_name: "",
    source: "D:\\vault\\skills\\docx",
    target: "C:\\Users\\demo\\.agents\\skills\\docx",
    target_tool: "codex",
    mode: "copy",
    health: "normal",
    detail: "",
    created_at: "2026-08-02T11:30:00Z",
  },
  {
    id: "mock-link-3",
    skill_name: "pdf",
    display_name: "PDF 处理助手",
    source: "D:\\vault\\skills\\pdf",
    target: "C:\\Users\\demo\\.opencode\\skills\\pdf",
    target_tool: "opencode",
    mode: "link",
    health: "missing",
    detail: "落点目录已被删除",
    created_at: "2026-08-03T09:00:00Z",
  },
];

export const MOCK_LINKS: LinkStatus[] = [];