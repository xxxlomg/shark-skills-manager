/**
 * FileTree 纯函数/模板常量（从 FileTree.tsx 拆出，无 React 依赖）。
 * 职责：虚拟树构建 / 标准目录引导 / starter 模板 / 二进制判定 / 引用文案。
 */
import type { FileNode } from "./api";

/** 由扁平路径列表构建嵌套 FileNode 树（用于虚拟附件预览）。 */
export function buildVirtualTree(files: Array<{ path: string }>): FileNode[] {
  const root: FileNode[] = [];
  const findChild = (list: FileNode[], name: string) => list.find((n) => n.name === name);
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let level = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const isLast = i === parts.length - 1;
      let node = findChild(level, parts[i]);
      if (!node) {
        node = { rel: acc, name: parts[i], is_dir: !isLast, children: [] };
        level.push(node);
      }
      if (!isLast) level = node.children;
    }
  }
  return root;
}

/** 3.3 标准目录：选项 + 一句话用途说明（规范性靠引导，不靠拦截）。 */
export const STANDARD_DIRS: { dir: string; hint: string }[] = [
  { dir: "scripts", hint: "可执行脚本——模型运行它来完成动作（.py / .sh / .js）" },
  { dir: "references", hint: "参考文档——模型按需查阅的详细资料（.md）" },
  { dir: "assets", hint: "静态资源——模型不直接读取（图片 / 数据等）" },
  { dir: "templates", hint: "模板文件——进阶，供模型套用生成（可选）" },
  { dir: "examples", hint: "示例——进阶，演示用法（可选）" },
];

/** ③：starter 模板（按目录/扩展名），让小白有起点可改。 */
export interface StarterTpl {
  label: string;
  content: string;
}
const TPL_PY: StarterTpl = {
  label: "Python 脚本骨架",
  content: `#!/usr/bin/env python3
"""一句话说明这个脚本做什么。"""
import sys


def main() -> int:
    # TODO: 在这里实现你的逻辑
    print("hello from script")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`,
};
const TPL_SH: StarterTpl = {
  label: "Shell 脚本骨架",
  content: `#!/usr/bin/env bash
# 一句话说明这个脚本做什么。
set -euo pipefail

# TODO: 在这里实现你的逻辑
echo "hello from script"
`,
};
const TPL_JS: StarterTpl = {
  label: "Node.js 脚本骨架",
  content: `#!/usr/bin/env node
// 一句话说明这个脚本做什么。
"use strict";

function main() {
  // TODO: 在这里实现你的逻辑
  console.log("hello from script");
}

main();
`,
};
const TPL_MD: StarterTpl = {
  label: "参考文档结构",
  content: `# 标题

> 一句话说明这份文档的用途。

## 要点

- 要点一
- 要点二

## 示例

\`\`\`
示例内容
\`\`\`
`,
};

/** 按文件路径给出适配的模板列表。 */
export function templatesFor(rel: string): StarterTpl[] {
  const top = rel.split("/")[0];
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  if (top === "scripts" || ["py", "sh", "bash", "js", "mjs"].includes(ext)) {
    return [TPL_PY, TPL_SH, TPL_JS];
  }
  return [TPL_MD];
}

/** 3.5 二进制判定（按扩展名）：命中即只读，不做在线编辑。 */
const BIN_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".bin", ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pyc", ".class", ".wasm",
]);
export function isBinaryName(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return BIN_EXT.has(name.slice(i).toLowerCase());
}

/** 3.6 引用文案模板：按顶层目录给出起点，用户可在弹窗里手改。 */
export function refTemplate(rel: string): string {
  const top = rel.split("/")[0];
  switch (top) {
    case "references":
      return `参考 ${rel} 获取详细说明`;
    case "scripts":
      return `运行 \`${rel}\` 以执行相关操作`;
    case "templates":
      return `套用模板 ${rel}`;
    case "examples":
      return `示例参见 ${rel}`;
    default:
      return `参考 ${rel}`;
  }
}