import { cloneElement, isValidElement, type ReactNode, type ReactElement, type FocusEvent } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TipProps {
  /** 提示内容：字符串或多行节点（如路径对） */
  label: ReactNode;
  children: ReactNode;
  /** 气泡相对子元素的位置，默认下方（卡片顶部空间常被 tab 占用） */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * 仅鼠标悬停触发（P3）：focus 不弹气泡。
   * 抽屉/弹层打开或收起时焦点可能落到触发元素（如首焦的 ? 按钮），
   * 默认 Radix Tooltip 对 hover 与 focus 都响应 → 表现为「进页面就弹、开合也弹」。
   * 开启后：onFocus preventDefault 拦截 Radix 内部 onFocus→onOpen，只留 pointer 触发。
   */
  hoverOnly?: boolean;
}

/**
 * 主题化悬浮提示：玻璃材质气泡，替代原生 title 的白底字条。
 *
 * 基于 Radix Tooltip 的 Portal 渲染到 body：
 * 卡片带 backdrop-filter（独立层叠上下文）且 overflow-hidden，
 * 卡内绝对定位气泡会被兄弟卡片遮挡、被卡片裁切；
 * Portal + z-50 一次性 escape 两者（网格/列表态均适用）。
 */
export function Tip({ label, children, side = "bottom", hoverOnly = false }: TipProps) {
  const trigger =
    hoverOnly && isValidElement(children)
      ? cloneElement(children as ReactElement<{ onFocus?: (e: FocusEvent) => void }>, {
          onFocus: (e: FocusEvent) => {
            // 保留子元素原有 onFocus（如有），再 preventDefault 挡住 Radix 的 focus 触发
            const original = (children as ReactElement<{ onFocus?: (ev: FocusEvent) => void }>).props
              ?.onFocus;
            original?.(e);
            if (!e.defaultPrevented) e.preventDefault();
          },
        })
      : children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="tip-bubble max-w-[340px] rounded-[10px] border-0 px-[10px] py-[5px] text-[11px] leading-snug"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
