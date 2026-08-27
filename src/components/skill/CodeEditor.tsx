/**
 * PLAN-12 ⑤：轻量代码编辑器（零依赖）。
 * 行号槽 + 语法高亮层（pre）+ 编辑层（textarea）三层同步滚动，
 * 让附带脚本/文档拥有「真·代码编辑器」质感，而非透明裸板。
 *
 * 实现要点：pre 与 textarea 字体度量完全一致（同 font/size/leading/padding、
 * white-space:pre、wrap=off），textarea 文字透明、光标可见，高亮由 pre 呈现。
 */
import { useMemo, useRef } from "react";

export type CodeLang = "py" | "sh" | "js" | "md" | "txt";

/** 由扩展名推断语言 */
export function langOf(rel: string): CodeLang {
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  if (ext === "py") return "py";
  if (ext === "sh" || ext === "bash") return "sh";
  if (ext === "js" || ext === "mjs" || ext === "ts") return "js";
  if (ext === "md" || ext === "markdown") return "md";
  return "txt";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Tok = [src: string, cls: string];

function langTokens(lang: CodeLang): Tok[] {
  if (lang === "md") {
    return [
      ["^#{1,6}[^\\n]*", "tok-h"], // 标题
      ["```[^\\n]*", "tok-c"], // 代码围栏标记
      ["`[^`\\n]*`", "tok-s"], // 行内代码
      ["\\*\\*[^*\\n]+\\*\\*", "tok-k"], // 加粗
    ];
  }
  const isJs = lang === "js";
  const comment = isJs
    ? "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/"
    : "#[^\\n]*";
  const kw = isJs
    ? "\\b(?:function|return|if|else|for|while|const|let|var|import|from|export|async|await|try|catch|throw|new|class|require|console|main|process)\\b"
    : lang === "sh"
      ? "\\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|echo|exit|return|set|local|export|read|source)\\b"
      : "\\b(?:def|return|if|elif|else|for|while|import|from|as|with|try|except|finally|class|lambda|pass|break|continue|and|or|not|in|is|None|True|False|print|raise|yield|assert|global|main|sys|self)\\b";
  return [
    [comment, "tok-c"],
    ["\"[^\"\\n]*\"|'[^'\\n]*'|`[^`\\n]*`", "tok-s"],
    [kw, "tok-k"],
    ["\\b\\d+(?:\\.\\d+)?\\b", "tok-n"],
  ];
}

/** 生成高亮后的 HTML（先转义再包裹 span） */
function highlight(code: string, lang: CodeLang): string {
  if (lang === "txt") return esc(code);
  const toks = langTokens(lang);
  const combined = new RegExp(
    toks.map(([s]) => `(${s})`).join("|"),
    "gm"
  );
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  combined.lastIndex = 0;
  while ((m = combined.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    // 找到命中的分组索引 → 对应 class
    let cls = "";
    for (let g = 0; g < toks.length; g++) {
      if (m[g + 1] !== undefined) {
        cls = toks[g][1];
        break;
      }
    }
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) combined.lastIndex++;
  }
  out += esc(code.slice(last));
  return out;
}

export function CodeEditor({
  value,
  onChange,
  lang,
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: CodeLang;
  readOnly?: boolean;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => highlight(value, lang), [value, lang]);
  const lineCount = useMemo(() => value.split("\n").length, [value]);

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-card font-mono text-sm leading-6">
      {/* 行号槽 */}
      <div className="relative w-12 shrink-0 select-none overflow-hidden border-r border-border/40 bg-glass-1/60 py-4">
        <div ref={gutterRef} className="will-change-transform">
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className="h-6 pr-2 text-right text-xs leading-6 text-text-tertiary"
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* 高亮层 + 编辑层 */}
      <div className="relative min-w-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre p-4 text-text-primary"
          dangerouslySetInnerHTML={{ __html: html + "\n" }}
        />
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          readOnly={readOnly}
          wrap="off"
          spellCheck={false}
          style={{ caretColor: "var(--color-text-primary)" }}
          className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent p-4 text-transparent outline-none selection:bg-primary/30"
        />
      </div>
    </div>
  );
}
