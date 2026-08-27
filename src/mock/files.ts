/**
 * W4 mock：附带资源文件树（内存态，按 skill_dir 键）。
 * 约束：mock 数据集中 src/mock/，不内联。
 */
import type { FileNode } from "@/lib/api";

const trees = new Map<string, FileNode[]>();

function defaultTree(): FileNode[] {
  return [
    { rel: "SKILL.md", name: "SKILL.md", is_dir: false, children: [] },
    {
      rel: "scripts",
      name: "scripts",
      is_dir: true,
      children: [{ rel: "scripts/setup.sh", name: "setup.sh", is_dir: false, children: [] }],
    },
    {
      rel: "references",
      name: "references",
      is_dir: true,
      children: [
        { rel: "references/guide.md", name: "guide.md", is_dir: false, children: [] },
      ],
    },
  ];
}

export function mockFileTree(skillDir: string): FileNode[] {
  if (!trees.has(skillDir)) trees.set(skillDir, defaultTree());
  // 返回新引用触发 React 重渲染
  return JSON.parse(JSON.stringify(trees.get(skillDir))) as FileNode[];
}

export function mockDeleteFile(skillDir: string, rel: string): void {
  const norm = rel.replace(/\\/g, "/");
  if (norm.toLowerCase() === "skill.md") throw new Error("SKILL.md 不可删除");
  if (norm.includes("..")) throw new Error("rel_path 不允许 .. 逃逸");
  const tree = trees.get(skillDir) ?? defaultTree();
  const parts = norm.split("/");
  let list = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const dir = list.find((n) => n.is_dir && n.name === parts[i]);
    if (!dir) throw new Error("目标不存在");
    list = dir.children;
  }
  const idx = list.findIndex((n) => n.name === parts[parts.length - 1]);
  if (idx < 0) throw new Error("目标不存在");
  list.splice(idx, 1);
  trees.set(skillDir, tree);
}

export function mockImportFile(skillDir: string, rel: string): void {
  const norm = rel.replace(/\\/g, "/");
  if (norm.includes("..")) throw new Error("rel_path 不允许 .. 逃逸");
  const tree = trees.get(skillDir) ?? defaultTree();
  const parts = norm.split("/");
  let list = tree;
  let exists = true;
  for (let i = 0; i < parts.length; i++) {
    const node = list.find((n) => n.name === parts[i]);
    if (!node) {
      exists = false;
      break;
    }
    if (i === parts.length - 1) {
      exists = !node.is_dir;
      break;
    }
    if (!node.is_dir) {
      exists = false;
      break;
    }
    list = node.children;
  }
  if (exists) throw new Error("EXISTS");
  mockWriteToTree(skillDir, norm);
}

export function mockWriteToTree(skillDir: string, rel: string): void {
  const norm = rel.replace(/\\/g, "/");
  const tree = trees.get(skillDir) ?? defaultTree();
  const parts = norm.split("/");
  let list = tree;
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    const isLast = i === parts.length - 1;
    let node = list.find((n) => n.name === parts[i]);
    if (!node) {
      node = { rel: acc, name: parts[i], is_dir: !isLast, children: [] };
      list.push(node);
    }
    if (!isLast) list = node.children;
  }
  trees.set(skillDir, tree);
}
