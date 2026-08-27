/**
 * 背景：瑞士国际主义 — 纯色基底 + 极淡 8pt 网格线
 * 无漂移光晕、无噪点（瑞士风：克制动效，网格定义结构而非装饰）。
 * 视觉规范：website/design/spec.css
 */
export function BackgroundFX() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: "var(--bg-0)" }}
    >
      {/* 网格线 40×40，极淡，径向遮罩淡出 */}
      <div
        className="absolute -inset-0.5"
        style={{
          backgroundImage:
            "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(120% 100% at 50% 20%, #000 35%, transparent 85%)",
          WebkitMaskImage:
            "radial-gradient(120% 100% at 50% 20%, #000 35%, transparent 85%)",
        }}
      />
    </div>
  );
}