/**
 * Mock 模式开关。
 * URL 加 `?mock=1` 启用：纯 vite dev 无 Tauri 后端时预览 UI。
 */
export function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("mock") === "1";
  } catch {
    return false;
  }
}
