import type { ReactNode } from "react";

interface SectionHeadProps {
  title: string;
  subtitle?: ReactNode;
  /** 右侧操作区 */
  children?: ReactNode;
}

/** 区块头：标题（渐变下划线）+ 副标题 + 右侧操作区 */
export function SectionHead({ title, subtitle, children }: SectionHeadProps) {
  return (
    <div className="sec-head">
      <div>
        <h2 className="sec-title">{title}</h2>
        {subtitle && <p className="sec-sub">{subtitle}</p>}
      </div>
      {children != null && <div className="sec-acts">{children}</div>}
    </div>
  );
}
