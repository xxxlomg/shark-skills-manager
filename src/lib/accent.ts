/**
 * 主题色预设：与 index.css 的 [data-accent] 块一一对应（色值以 CSS 为真相）。
 * 色相分布：珊瑚橙(默认) → 苔绿 → 霁青 → 湖蓝 → 黛紫 → 胭脂；
 * 暗色档统一为「深石板底 + 柔和亮色」同一色温，亮色档统一压到同明度深调。
 */
export const ACCENTS = [
  { id: "coral", name: "珊瑚橙", dark: "#ff6a45", light: "#ff6a45" },
  { id: "moss", name: "苔绿", dark: "#a8c686", light: "#55763c" },
  { id: "teal", name: "霁青", dark: "#5eead4", light: "#0f766e" },
  { id: "azure", name: "湖蓝", dark: "#38bdf8", light: "#0369a1" },
  { id: "violet", name: "黛紫", dark: "#a78bfa", light: "#7c3aed" },
  { id: "rose", name: "胭脂", dark: "#fda4af", light: "#be123c" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

const KEY = "skillbox-accent";

export function getAccent(): AccentId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && ACCENTS.some((a) => a.id === v)) return v as AccentId;
  } catch {
    /* localStorage 不可用时静默回退默认 */
  }
  return "coral";
}

/** 立即生效（写属性 + 持久化），无需重启。 */
export function setAccent(id: AccentId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 忽略持久化失败，本次会话仍生效 */
  }
  document.documentElement.setAttribute("data-accent", id);
}
