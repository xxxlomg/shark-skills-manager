/**
 * 轻量 emoji 选择器（零依赖）。
 * 预设一屏常用 emoji + 自定义输入框（可粘贴任意 emoji），
 * 让小白用户不用自己去别处复制。
 */
import { useState } from "react";

// 用 code point 生成 40 个互不相同的有效 emoji（避免字面量传输丢失/重复 key）
const PRESETS = [
  0x1f9e9, 0x1f6e0, 0x2699, 0x1f527, 0x1f9f0, 0x1f4bb, 0x1f916, 0x1f4e6, 0x1f5c2, 0x1f4c4,
  0x1f4dd, 0x270d, 0x1f4da, 0x1f516, 0x1f50d, 0x1f9ed, 0x1f4ca, 0x1f4c8, 0x1f4c5, 0x23f0,
  0x1f3a8, 0x1f5bc, 0x1f3ad, 0x1f4f7, 0x1f3ac, 0x1f3b5, 0x1f3ae, 0x1f3b2, 0x1f4a1, 0x1f9e0,
  0x1f4b0, 0x2728, 0x2b50, 0x2764, 0x1f3af, 0x2705, 0x23f1, 0x1f512, 0x1f310, 0x1f30d,
].map((cp) => String.fromCodePoint(cp));

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  /**
   * block = 默认宽条（图标方块 + 提示文案）；
   * square = 仅一个与输入框等高的方形图标钮（合并基本信息「身份行」用，
   * 图标即按钮本身，不再额外占一列宽度）。
   */
  variant?: "block" | "square";
}

export function EmojiPicker({ value, onChange, variant = "block" }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          variant === "square"
            ? "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md border border-stroke bg-card text-[17px] outline-none transition-colors hover:border-brand/50 focus:border-brand/60"
            : "flex w-full items-center gap-2 rounded-md border border-stroke bg-card px-2.5 py-1.5 text-[14px] outline-none focus:border-brand/60"
        }
        title="点击选择表情图标"
      >
        {variant === "square" ? (
          <span className="grid h-6 w-6 place-items-center text-[17px]">{value || "＋"}</span>
        ) : (
          <>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded border border-stroke/60 bg-glass-2 text-[15px]">
              {value || "＋"}
            </span>
            <span className="truncate text-[11.5px] text-text-tertiary">
              {value ? "点击更换" : "点击选择"}
            </span>
          </>
        )}
      </button>

      {open && (
        <>
          {/* 透明遮罩：点外面收起 */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-[232px] rounded-[12px] border border-stroke bg-card p-2 shadow-xl">
            <div className="grid grid-cols-8 gap-0.5">
              {PRESETS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onChange(e);
                    setOpen(false);
                  }}
                  className={`grid h-6 w-6 place-items-center rounded text-[15px] transition-colors hover:bg-glass-2 ${
                    value === e ? "bg-brand/15 ring-1 ring-brand/50" : ""
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-stroke/60 pt-2">
              <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="或粘贴任意 emoji"
                className="min-w-0 flex-1 rounded-md border border-stroke bg-glass-2 px-2 py-1 text-[12px] outline-none focus:border-brand/60"
              />
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="shrink-0 rounded-md border border-stroke bg-glass-2 px-2 py-1 text-[11px] text-text-secondary hover:border-brand/50"
              >
                清除
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
