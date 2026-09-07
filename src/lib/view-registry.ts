import { Boxes, Link2, Package, PenLine, type LucideIcon } from "lucide-react";

/**
 * 视图注册表（导航结构插槽）
 *
 * 约束（修订 R2-c）：
 * - 导航项一律数据驱动：id + 标题 + 图标 + 排序权重，不硬编码 Tab 数量与顺序；
 * - TabNav/顶栏只消费本注册表，不感知具体业务视图；
 * - 新视图（创作页等）在此登记一条即可接入导航，不重写导航组件。
 *
 * 渲染分发在 App.tsx 的 composition root（按 id 查 RENDERERS 表），
 * 入口位置（Tab / 顶栏按钮 / 详情页内）对视图实现透明。
 *
 * P1：使用手册移出 Tab，改为右上角「关于」菜单入口的白皮书全屏页。
 */

export type ViewId = "lib" | "packs" | "create" | "hub";

export interface ViewDef {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  /** 排序权重：升序排列。新视图插空用（间隔 10，方便后续插入） */
  weight: number;
}

const REGISTRY: readonly ViewDef[] = [
  { id: "lib", label: "技能库", icon: Boxes, weight: 0 },
  { id: "packs", label: "Packs", icon: Package, weight: 10 },
  { id: "hub", label: "Hub", icon: Link2, weight: 20 },
  { id: "create", label: "创作", icon: PenLine, weight: 30 },
] as const satisfies readonly ViewDef[];

export const VIEW_REGISTRY: ViewDef[] = [...REGISTRY].sort(
  (a, b) => a.weight - b.weight
);

/** 默认落地视图 */
export const DEFAULT_VIEW: ViewId = "lib";
