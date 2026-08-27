import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 附件是否为图片类型（合并工作台据此走二进制渲染，而不是文本比对判冲突） */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);
export function isImageRel(rel: string): boolean {
  const dot = rel.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(rel.slice(dot + 1).toLowerCase());
}
