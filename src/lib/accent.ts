/** 主题色预设：与 index.css 的 [data-accent] 块一一对应。 */
export const ACCENTS = [
  { id: "coral", name: "珊瑚橙", dark: "#ff6a45", light: "#ff6a45" },
  { id: "moss", name: "苔绿", dark: "#a8c686", light: "#55763c" },
  { id: "violet", name: "黛紫", dark: "#a78bfa", light: "#7c3aed" },
  { id: "azure", name: "湖蓝", dark: "#7dd3fc", light: "#0369a1" },
  { id: "amber", name: "枫橙", dark: "#fdba74", light: "#c2410c" },
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
