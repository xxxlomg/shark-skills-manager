/**
 * 全局统一路径显示样式（Windows 反斜杠）。
 * 本应用面向 Windows 桌面端：所有在 UI 中展示的路径一律转成 `\` 分隔，
 * 避免 `D:\Desktop/test/skills` 这类混用分隔符的观感。
 * 仅用于【显示】；传给后端 / 文件系统操作仍用原始路径。
 */
export function winPath(p: string | null | undefined): string {
  if (!p) return "";
  return p.replace(/\//g, "\\");
}

/** 给路径补一个统一的 Windows 风格子路径（避免混用分隔符） */
export function winJoin(root: string, child: string): string {
  const r = root.replace(/[\\/]+$/, "").replace(/\//g, "\\");
  const c = child.replace(/^[\\/]+/, "").replace(/\//g, "\\");
  return c ? `${r}\\${c}` : r;
}