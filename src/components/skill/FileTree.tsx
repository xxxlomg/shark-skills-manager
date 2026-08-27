import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Plus,
  Quote,
  Save,
  Sparkles,
  StopCircle,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  readSkillFile,
  skillDeleteFile,
  skillImportFile,
  skillListFiles,
  skillWriteFile,
  type FileNode,
  type Skill,
} from "@/lib/api";
import { generateFileAssistStream } from "@/lib/authoring-api";
import { CodeEditor, langOf } from "./CodeEditor";

/**
 * W4 + PLAN-11 阶段 3 + PLAN-12：附带资源文件树（scripts/references/assets 等）。
 * 3.3 新建改「选目录 + 文件名」（标准目录 + 一句话用途，规范性 = 合理默认 + 引导）；
 * 3.4 上传入口（dialog 选文件 → 选目标目录 → skill_import_file）；
 * 3.5 编辑已有文件（文本可存 / 二进制只读）；
 * 3.6 「插入引用」到正文（references/scripts 文案模板，可手改）。
 * PLAN-12：① 树整体放大（可读性）；② 上传可选目标目录；③ 编辑弹窗加「模板」+「AI 帮写」。
 * 后端 skill_list_files / skill_delete_file / skill_write_file / skill_import_file（C6 同闸）。
 */
interface FileTreeProps {
  skill: Skill | null;
  /** 3.6：把引用行追加到 SKILL.md 正文（由 AuthoringWorkbench 提供）；缺省则不显示插入按钮 */
  onInsertReference?: (line: string) => void;
  /**
   * 虚拟附件预览（未保存时）：AI 生成但尚未落盘的文件清单。
   * FileTree 会在内存中渲染这些文件的结构树与内容预览，无需等待保存。
   */
  virtualFiles?: Array<{ path: string; content: string }>;
}

/** 由扁平路径列表构建嵌套 FileNode 树（用于虚拟附件预览）。 */
function buildVirtualTree(files: Array<{ path: string }>): FileNode[] {
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
const STANDARD_DIRS: { dir: string; hint: string }[] = [
  { dir: "scripts", hint: "可执行脚本——模型运行它来完成动作（.py / .sh / .js）" },
  { dir: "references", hint: "参考文档——模型按需查阅的详细资料（.md）" },
  { dir: "assets", hint: "静态资源——模型不直接读取（图片 / 数据等）" },
  { dir: "templates", hint: "模板文件——进阶，供模型套用生成（可选）" },
  { dir: "examples", hint: "示例——进阶，演示用法（可选）" },
];

/** PLAN-12 ③：starter 模板（按目录/扩展名），让小白有起点可改。 */
interface StarterTpl {
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
function templatesFor(rel: string): StarterTpl[] {
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
function isBinaryName(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return BIN_EXT.has(name.slice(i).toLowerCase());
}

/** 3.6 引用文案模板：按顶层目录给出起点，用户可在弹窗里手改。 */
function refTemplate(rel: string): string {
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

function NodeRow({
  node,
  depth,
  collapsed,
  canInsertRef,
  onToggle,
  onView,
  onDelete,
  onInsertRef,
}: {
  node: FileNode;
  depth: number;
  collapsed: Set<string>;
  canInsertRef: boolean;
  onToggle: (rel: string) => void;
  onView: (rel: string) => void;
  onDelete: (rel: string) => void;
  onInsertRef: (rel: string) => void;
}) {
  // PLAN-12 ①：缩进加宽，行更高，字更大
  const pad = { paddingLeft: `${10 + depth * 16}px` };
  if (node.is_dir) {
    const open = !collapsed.has(node.rel);
    return (
      <>
        <button
          type="button"
          style={pad}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-glass-1"
          onClick={() => onToggle(node.rel)}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          {open ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-primary/70" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-primary/70" />
          )}
          <span className="truncate">{node.name}/</span>
          <span className="flex-1" />
          <Trash2
            className="h-3.5 w-3.5 shrink-0 text-text-tertiary hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.rel);
            }}
          />
        </button>
        {open &&
          node.children.map((c) => (
            <NodeRow
              key={c.rel}
              node={c}
              depth={depth + 1}
              collapsed={collapsed}
              canInsertRef={canInsertRef}
              onToggle={onToggle}
              onView={onView}
              onDelete={onDelete}
              onInsertRef={onInsertRef}
            />
          ))}
      </>
    );
  }
  const isSkillMd = node.name.toLowerCase() === "skill.md";
  return (
    <div
      style={pad}
      className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-text-secondary hover:bg-glass-1"
    >
      <span className="w-4 shrink-0" />
      <FileIcon className="h-4 w-4 shrink-0 text-text-tertiary" />
      <button
        type="button"
        className="truncate hover:text-text-primary hover:underline"
        onClick={() => onView(node.rel)}
      >
        {node.name}
      </button>
      <span className="flex-1" />
      {/* 3.6 插入引用：SKILL.md 自身不引用自己 */}
      {canInsertRef && !isSkillMd && (
        /* lucide-react 新版 LucideProps 不再透传 title，包一层 span 承载提示 */
        <span
          title="插入引用到正文"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Quote
            className="h-3.5 w-3.5 cursor-pointer text-text-tertiary hover:text-primary"
            onClick={() => onInsertRef(node.rel)}
          />
        </span>
      )}
      {!isSkillMd && (
        <Trash2
          className="h-3.5 w-3.5 shrink-0 text-text-tertiary hover:text-red-400"
          onClick={() => onDelete(node.rel)}
        />
      )}
    </div>
  );
}

export function FileTree({ skill, onInsertReference, virtualFiles }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [delRel, setDelRel] = useState<string | null>(null);
  // 新建（3.3 选目录 + 文件名）
  const [newOpen, setNewOpen] = useState(false);
  const [newDir, setNewDir] = useState("scripts");
  const [newName, setNewName] = useState("");
  // 上传（3.4 + PLAN-12 ② 选目标目录）
  const [uploadPicked, setUploadPicked] = useState<string | null>(null);
  const [uploadDir, setUploadDir] = useState("assets");
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  // 查看 / 编辑（3.5 双态）
  const [openRel, setOpenRel] = useState<string | null>(null);
  const [openBinary, setOpenBinary] = useState(false);
  const [openDraft, setOpenDraft] = useState("");
  const [openSaving, setOpenSaving] = useState(false);
  // PLAN-12 ③：模板 + AI 帮写
  const [tplKey, setTplKey] = useState<string>("");
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistIdea, setAssistIdea] = useState("");
  const [assisting, setAssisting] = useState(false);
  const assistAbortRef = useRef<AbortController | null>(null);
  // 覆盖确认（模板 / AI 帮写写入前，若已有内容）
  const [overwriteAction, setOverwriteAction] = useState<(() => void) | null>(null);
  // 插入引用（3.6）
  const [refRel, setRefRel] = useState<string | null>(null);
  const [refText, setRefText] = useState("");

  const load = useCallback(() => {
    if (!skill) return;
    skillListFiles(skill.skill_dir)
      .then(setTree)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, [skill]);

  useEffect(() => {
    load();
  }, [load]);

  // 虚拟附件（未保存预览）：内存树 + 内容映射
  const virtualTree = useMemo(
    () => (virtualFiles?.length ? buildVirtualTree(virtualFiles) : []),
    [virtualFiles],
  );
  const virtualMap = useMemo(
    () => new Map((virtualFiles ?? []).map((f) => [f.path, f.content])),
    [virtualFiles],
  );
  // 合并：磁盘树 + 尚未落盘的虚拟节点
  const mergedTree = useMemo(() => {
    if (!virtualTree.length) return tree;
    if (!tree.length) return virtualTree;
    const diskRels = new Set(tree.map((n) => n.rel));
    return [...tree, ...virtualTree.filter((v) => !diskRels.has(v.rel))];
  }, [tree, virtualTree]);

  // 切换文件时重置 AI 帮写 / 模板状态
  useEffect(() => {
    setAssistOpen(false);
    setAssistIdea("");
    setAssisting(false);
    setTplKey("");
    assistAbortRef.current?.abort();
  }, [openRel]);

  if (!skill && virtualTree.length === 0) {
    return (
      <div className="grid flex-1 place-items-center rounded-md border border-dashed border-border/50 text-sm text-text-tertiary">
        首存创建技能后，可在这里管理附带资源
      </div>
    );
  }

  const newDirHint = STANDARD_DIRS.find((d) => d.dir === newDir)?.hint ?? "";
  const uploadDirHint = STANDARD_DIRS.find((d) => d.dir === uploadDir)?.hint ?? "";

  // 3.5 打开文件：虚拟附件直接从内存预览；二进制只读；文本读入可编辑
  const view = (rel: string) => {
    if (virtualMap.has(rel)) {
      setOpenRel(rel);
      setOpenBinary(false);
      setOpenDraft(virtualMap.get(rel) ?? "");
      return;
    }
    if (!skill) return;
    if (isBinaryName(rel)) {
      setOpenRel(rel);
      setOpenBinary(true);
      setOpenDraft("");
      return;
    }
    readSkillFile(`${skill.skill_dir}/${rel}`)
      .then((c) => {
        setOpenRel(rel);
        setOpenBinary(false);
        setOpenDraft(c);
      })
      .catch(() => toast.error("读取失败"));
  };

  const doSave = async () => {
    if (!openRel) return;
    if (!skill) {
      toast.info("技能尚未保存——请先点右上角「保存」创建技能，附件将一并落盘");
      return;
    }
    setOpenSaving(true);
    try {
      await skillWriteFile(skill.skill_dir, openRel, openDraft);
      toast.success(`已保存 ${openRel}`);
      setOpenRel(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpenSaving(false);
    }
  };

  const doDelete = async () => {
    if (!delRel) return;
    if (!skill) {
      toast.info("技能尚未保存，无法删除");
      setDelRel(null);
      return;
    }
    try {
      await skillDeleteFile(skill.skill_dir, delRel);
      toast.success(`已删除 ${delRel}`);
      setDelRel(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // 3.3 新建：选目录 + 文件名（规范性 = 合理默认 + 引导）
  const doNew = async () => {
    const name = newName.trim();
    if (!name || !newDir) return;
    if (!skill) {
      toast.info("技能尚未保存——请先点右上角「保存」");
      return;
    }
    if (/[\\/]/.test(name) || name.includes("..")) {
      toast.error("文件名不能含路径分隔符或 ..");
      return;
    }
    const rel = `${newDir}/${name}`;
    try {
      await skillWriteFile(skill.skill_dir, rel, "");
      toast.success(`已创建 ${rel}`);
      setNewOpen(false);
      setNewName("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // 3.4 + PLAN-12 ②：上传 = 选文件 → 选目标目录/文件名 → 确认导入
  const pickUpload = async () => {
    if (uploading) return;
    try {
      const picked = await openFileDialog({ multiple: false });
      if (!picked || typeof picked !== "string") return; // 取消
      const base = picked.split(/[\\/]/).pop() ?? "file";
      setUploadPicked(picked);
      setUploadName(base);
      setUploadDir("assets");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doUpload = async () => {
    if (!uploadPicked || uploading) return;
    if (!skill) {
      toast.info("技能尚未保存——请先点右上角「保存」");
      return;
    }
    const name = uploadName.trim();
    if (!name || !uploadDir) return;
    setUploading(true);
    const targetRel = `${uploadDir}/${name}`;
    try {
      await skillImportFile(skill.skill_dir, uploadPicked, targetRel);
      toast.success(`已上传到 ${targetRel}`);
      setUploadPicked(null);
      setUploadName("");
      load();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      toast.error(
        raw === "EXISTS" ? `${uploadDir}/ 下已有同名文件，请先改名或删除后再传` : raw,
      );
    } finally {
      setUploading(false);
    }
  };

  // PLAN-12 ③：套用模板（若已有内容先确认覆盖）
  const applyTemplate = (key: string) => {
    setTplKey(key);
    const tpl = templatesFor(openRel ?? "").find((t) => t.label === key);
    if (!tpl) return;
    if (openDraft.trim()) {
      setOverwriteAction(() => () => setOpenDraft(tpl.content));
    } else {
      setOpenDraft(tpl.content);
      toast.success(`已套用模板「${tpl.label}」（点保存才落盘）`);
    }
  };

  // PLAN-12 ③：AI 帮写——读 SKILL.md 上下文 → 流式直写编辑框
  const runAssist = async () => {
    if (!openRel || assisting) return;
    if (!skill) {
      toast.info("技能尚未保存——请先点右上角「保存」创建技能，AI 才能结合技能上下文帮写");
      return;
    }
    const idea = assistIdea.trim();
    if (!idea) {
      toast.error("先写一句你的想法");
      return;
    }
    // 捕获非空 skill 的本地快照：闭包内直接使用「可能为 null」的 prop 会丢失收窄
    const skillDir = skill.skill_dir;
    const skillName = skill.name;
    const skillDescription = skill.description;
    const start = async () => {
      setAssisting(true);
      const ctrl = new AbortController();
      assistAbortRef.current = ctrl;
      let acc = "";
      try {
        // 读取当前 skill 上下文（name/description 来自 skill，正文读 SKILL.md）
        let body = "";
        try {
          body = await readSkillFile(`${skillDir}/SKILL.md`);
        } catch {
          body = "";
        }
        await generateFileAssistStream(
          {
            idea,
            fileRel: openRel,
            skillName,
            skillDescription,
            skillBody: body,
          },
          (d) => {
            acc += d;
            setOpenDraft(acc);
          },
          ctrl.signal,
        );
        toast.success("AI 帮写完成——检查后点保存落盘");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          toast.info("已停止 AI 帮写——已生成部分保留在编辑框");
        } else {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setAssisting(false);
        assistAbortRef.current = null;
      }
    };
    if (openDraft.trim()) {
      setOverwriteAction(() => () => void start());
    } else {
      await start();
    }
  };

  const stopAssist = () => {
    assistAbortRef.current?.abort();
  };

  // 3.6 插入引用：弹窗预填模板，可手改后确认
  const startInsertRef = (rel: string) => {
    setRefRel(rel);
    setRefText(refTemplate(rel));
  };

  const confirmInsertRef = () => {
    const line = refText.trim();
    if (!line || !onInsertReference) return;
    onInsertReference(line);
    setRefRel(null);
  };

  const assistDisabled = !assistIdea.trim() || assisting;

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* 左：文件树列 */}
      <div className="flex w-[264px] shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          className="h-8 text-sm"
          disabled={uploading}
          onClick={() => void pickUpload()}
          title="从本地选文件，上传到指定目录"
        >
          <Upload className="h-4 w-4" />
          上传
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 text-sm"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="h-4 w-4" />
          新建文件
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1/60 p-2">
        {mergedTree.length === 0 ? (
          <p className="p-3 text-center text-xs text-text-tertiary">（空目录）</p>
        ) : (
          mergedTree.map((n) => (
            <NodeRow
              key={n.rel}
              node={n}
              depth={0}
              collapsed={collapsed}
              canInsertRef={!!onInsertReference}
              onToggle={(rel) =>
                setCollapsed((s) => {
                  const next = new Set(s);
                  if (next.has(rel)) next.delete(rel);
                  else next.add(rel);
                  return next;
                })
              }
              onView={view}
              onDelete={setDelRel}
              onInsertRef={startInsertRef}
            />
          ))
        )}
      </div>
      </div>

      {/* 右：内联编辑器列（PLAN-12 ④ 重设计：告别小弹窗，IDE 式左树右编辑） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {openRel === null ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/50 text-sm text-text-tertiary">
            选择左侧文件开始编辑
          </div>
        ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/40 bg-glass-1/60">
          {/* 文件头 */}
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
            <FileIcon className="h-4 w-4 text-text-tertiary" />
            <span className="font-mono text-sm">{openRel}</span>
            <span className="flex-1" />
            {!openBinary && (
              <Button size="sm" disabled={openSaving} onClick={() => void doSave()}>
                <Save className="h-3 w-3" />
                保存
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpenRel(null)} title="关闭文件">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {openBinary ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-text-tertiary">
              二进制文件（图片 / 压缩包 / 可执行等），不支持在线编辑。
            </div>
          ) : (
            <>
              {/* 工具条：模板 + AI 帮写 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
                <Select value={tplKey} onValueChange={applyTemplate}>
                  <SelectTrigger size="sm" className="h-8 w-44 text-sm">
                    <SelectValue placeholder="套用模板…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templatesFor(openRel ?? "").map((t) => (
                      <SelectItem key={t.label} value={t.label}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-sm"
                  onClick={() => setAssistOpen((v) => !v)}
                  title="有想法但写不出？让 AI 根据技能内容帮你写"
                >
                  <Wand2 className="h-4 w-4" />
                  AI 帮写
                </Button>
                <span className="text-xs text-text-tertiary">
                  模板 / AI 结果写入下方编辑区，点保存才落盘
                </span>
              </div>
              {/* AI 帮写面板（独立呼吸空间） */}
              {assistOpen && (
                <div className="flex flex-col gap-2 border-b border-border/40 bg-primary/10 p-4">
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Sparkles className="h-4 w-4 text-primary" />
                    用一句话描述你想让这个文件做什么，AI 结合当前技能帮你写
                  </div>
                  <textarea
                    value={assistIdea}
                    onChange={(e) => setAssistIdea(e.target.value)}
                    readOnly={assisting}
                    placeholder="例：统计当前目录图片数量并输出；或：写一份该技能的安装参考"
                    className="min-h-[72px] w-full resize-y rounded-md border border-input bg-transparent p-3 text-sm leading-relaxed"
                    spellCheck={false}
                  />
                  <div className="flex items-center gap-2">
                    {assisting ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-sm !border-red-400/60 !text-red-500 hover:!bg-red-500/10"
                        onClick={stopAssist}
                      >
                        <StopCircle className="h-4 w-4" />
                        停止
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 text-sm"
                        disabled={assistDisabled}
                        onClick={() => void runAssist()}
                      >
                        <Sparkles className="h-4 w-4" />
                        生成
                      </Button>
                    )}
                    <span className="text-xs text-text-tertiary">
                      生成会写入编辑区{openDraft.trim() ? "（已有内容将先确认覆盖）" : ""}
                    </span>
                  </div>
                </div>
              )}
              {/* 编辑区：CodeEditor（行号 + 语法高亮，PLAN-12 ⑤） */}
              <CodeEditor
                value={openDraft}
                onChange={setOpenDraft}
                lang={langOf(openRel ?? "")}
              />
            </>
          )}
        </div>
        )}
      </div>

      {/* PLAN-12 ③：覆盖确认（模板 / AI 帮写写入前） */}
      <Dialog open={overwriteAction !== null} onOpenChange={(o) => !o && setOverwriteAction(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>覆盖当前编辑内容？</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-sm text-muted-foreground">
            编辑框已有内容，套用模板 / AI 帮写会替换它（未保存部分将丢失）。
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOverwriteAction(null)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                overwriteAction?.();
                setOverwriteAction(null);
              }}
            >
              覆盖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PLAN-12 ②：上传目标目录 + 文件名 */}
      <Dialog open={uploadPicked !== null} onOpenChange={(o) => !o && setUploadPicked(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>上传到…</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">目标目录</span>
              <Select value={uploadDir} onValueChange={setUploadDir}>
                <SelectTrigger size="sm" className="w-full font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STANDARD_DIRS.map((d) => (
                    <SelectItem key={d.dir} value={d.dir}>
                      {d.dir}/
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {uploadDirHint && (
                <p className="text-xs leading-snug text-text-tertiary">{uploadDirHint}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">文件名</span>
              <Input
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs text-text-tertiary">
              将上传为{" "}
              <span className="font-mono">
                {uploadDir}/{uploadName.trim() || "…"}
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setUploadPicked(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={uploading || !uploadName.trim()}
              onClick={() => void doUpload()}
            >
              <Upload className="h-3 w-3" />
              上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={delRel !== null} onOpenChange={(o) => !o && setDelRel(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>删除 {delRel}？</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-sm text-muted-foreground">目录将递归删除，不可恢复。</p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDelRel(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void doDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3.3 新建：选目录 + 文件名 */}
      <Dialog open={newOpen} onOpenChange={(o) => !o && setNewOpen(false)}>
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>新建附带文件</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">选择目录</span>
              <Select value={newDir} onValueChange={setNewDir}>
                <SelectTrigger size="sm" className="w-full font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STANDARD_DIRS.map((d) => (
                    <SelectItem key={d.dir} value={d.dir}>
                      {d.dir}/
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {newDirHint && (
                <p className="text-xs leading-snug text-text-tertiary">{newDirHint}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">文件名</span>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  newDir === "scripts"
                    ? "例：run.py"
                    : newDir === "references"
                      ? "例：guide.md"
                      : "例：logo.png"
                }
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs text-text-tertiary">
              将创建为{" "}
              <span className="font-mono">
                {newDir}/{newName.trim() || "…"}
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={!newName.trim()} onClick={() => void doNew()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3.6 插入引用：模板可手改 */}
      <Dialog open={refRel !== null} onOpenChange={(o) => !o && setRefRel(null)}>
        <DialogContent className="max-w-md border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>插入引用到正文</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-text-tertiary">
            引用 <span className="font-mono">{refRel}</span>——文案可手改，确认后追加到
            SKILL.md 正文末尾，让模型按需加载该附件。
          </p>
          <textarea
            value={refText}
            onChange={(e) => setRefText(e.target.value)}
            className="min-h-[72px] w-full resize-y rounded-md border border-input bg-transparent p-2.5 font-mono text-sm leading-relaxed"
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRefRel(null)}>
              取消
            </Button>
            <Button size="sm" disabled={!refText.trim()} onClick={confirmInsertRef}>
              <Quote className="h-3 w-3" />
              插入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}