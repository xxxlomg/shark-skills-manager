import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { Skill } from "@/hooks/useSkills";
import type { LibTreeNode, LibraryTreeRoot } from "@/lib/api";

/**
 * PLAN-10 P2：侧栏技能库目录树。
 *
 * 数据源 = scan_library_tree 的 `LibraryTreeRoot[]`，与主视图 LibraryExplorer
 * 完全同源，保证侧栏树层级与顶栏/主视图逐层下钻的磁盘真实层级一致：
 *  - 工具 = 扫描根（root.label）
 *  - 目录 / 技能包（含子技能）= 可展开节点，点击下钻到对应目录视图
 *  - 技能叶子（无子技能）= 直接打开详情抽屉
 *
 * 点击直达：
 *  - 工具节点 → 该工具分类视图（path=null）
 *  - 目录节点 → 该目录下钻视图（path=相对扫描根的目录段）
 *  - 技能节点 → 直接打开详情抽屉
 *
 * 展开状态持久化到 localStorage（sm:tree-open），当前所在分支自动强制展开。
 */

const TREE_OPEN_KEY = "sm:tree-open";

interface SkillTreeProps {
  /** 每个启用扫描根一棵的目录树（与主视图 LibraryExplorer 同源） */
  roots: LibraryTreeRoot[];
  /** 技能 id → Skill 映射（技能叶子渲染 emoji/中文名与打开抽屉用） */
  skillsById: Map<string, Skill>;
  /** 当前分类视图的工具（scan_label） */
  currentLabel: string | null;
  /** 当前分类视图的下钻路径段（相对扫描根；null = 整工具根） */
  currentPath: string[] | null;
  selectedSkillId: string | null;
  onOpenCollection: (label: string, path: string[] | null) => void;
  onOpenSkill: (skill: Skill) => void;
}

function readOpen(): Set<string> {
  try {
    const v = localStorage.getItem(TREE_OPEN_KEY);
    if (!v) return new Set();
    return new Set(v.split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** 供父组件（侧栏头部）调用的一键展开/收起句柄 */
export interface SkillTreeHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

export const SkillTree = forwardRef<SkillTreeHandle, SkillTreeProps>(
  function SkillTree(
    { roots, skillsById, currentLabel, currentPath, selectedSkillId, onOpenCollection, onOpenSkill },
    ref
  ) {
    const [open, setOpen] = useState<Set<string>>(readOpen);

    const toolKey = useCallback((label: string) => `tool:${label}`, []);
    const nodeKey = useCallback(
      (label: string, rel: string) => `node:${label}\u241f${rel}`,
      []
    );

    const persist = useCallback((next: Set<string>) => {
      try {
        localStorage.setItem(TREE_OPEN_KEY, [...next].join(","));
      } catch {
        /* ignore */
      }
    }, []);

    const toggle = useCallback(
      (key: string) => {
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          persist(next);
          return next;
        });
      },
      [persist]
    );

    // 点击工具/目录名时确保展开（即使已在该分支、useEffect 不再触发，也能重新展开）
    const openBranch = useCallback(
      (key: string) => {
        setOpen((prev) => {
          if (prev.has(key)) return prev;
          const next = new Set(prev).add(key);
          persist(next);
          return next;
        });
      },
      [persist]
    );

    // 收集所有可展开 key：工具节点 + 所有含 children 的目录/技能包节点
    const allExpandableKeys = useMemo(() => {
      const keys: string[] = [];
      const walk = (node: LibTreeNode, label: string) => {
        if (node.children.length > 0) keys.push(nodeKey(label, node.rel));
        for (const c of node.children) walk(c, label);
      };
      for (const r of roots) {
        keys.push(toolKey(r.label));
        walk(r.root, r.label);
      }
      return keys;
    }, [roots, toolKey, nodeKey]);

    /** 一键展开全部 */
    const expandAll = useCallback(() => {
      const next = new Set(allExpandableKeys);
      setOpen(next);
      persist(next);
    }, [allExpandableKeys, persist]);

    /** 一键收起全部 */
    const collapseAll = useCallback(() => {
      setOpen(new Set());
      persist(new Set());
    }, [persist]);

    useImperativeHandle(ref, () => ({ expandAll, collapseAll }), [expandAll, collapseAll]);

    // 导航到某分支时把「工具 → … → 当前目录」路径上的节点加进 open 集
    // （仅在被导航的那次生效，不覆盖后续手动折叠）。
    useEffect(() => {
      if (!currentLabel) return;
      setOpen((prev) => {
        const next = new Set(prev);
        next.add(toolKey(currentLabel));
        const root = roots.find((r) => r.label === currentLabel);
        if (root && currentPath && currentPath.length > 0) {
          let cur = root.root;
          for (const seg of currentPath) {
            const child = cur.children.find((c) => c.name === seg);
            if (!child) break;
            next.add(nodeKey(currentLabel, child.rel));
            cur = child;
          }
        }
        persist(next);
        return next;
      });
    }, [currentLabel, currentPath, roots, toolKey, nodeKey, persist]);

    const isOpen = (key: string) => open.has(key);

    const renderSkillLeaf = (skill: Skill) => {
      const active = skill.id === selectedSkillId;
      return (
        <button
          key={`s:${skill.id}`}
          type="button"
          onClick={() => onOpenSkill(skill)}
          className={`flex w-full min-w-0 items-center gap-1.5 rounded-md py-[3px] pl-2 pr-1.5 text-left text-[14px] transition-colors ${
            active
              ? "bg-glass-2 font-medium text-text-primary"
              : "text-text-secondary hover:bg-glass-2 hover:text-text-primary"
          }`}
        >
          <span className="w-[14px] shrink-0 text-center text-[11px]">
            {skill.emoji || "🧩"}
          </span>
          <span className="truncate">{skill.title_zh || skill.name}</span>
        </button>
      );
    };

    /**
     * 递归渲染目录节点：
     *  - 技能叶子（is_skill 且无子技能）→ 技能入口（开抽屉）
     *  - 目录 / 技能包（有 children 或空目录）→ 文件夹节点，点击下钻
     */
    const renderNode = (node: LibTreeNode, label: string, pathSegs: string[]): ReactNode => {
      const skill = node.is_skill && node.skill_id ? skillsById.get(node.skill_id) : undefined;
      const hasChildren = node.children.length > 0;

      // 叶子技能（无子技能）：直接打开详情抽屉
      if (node.is_skill && !hasChildren && skill) {
        return renderSkillLeaf(skill);
      }

      const key = nodeKey(label, node.rel);
      const openNode = hasChildren && isOpen(key);
      const active =
        currentLabel === label && (currentPath ?? []).join("/") === pathSegs.join("/");

      return (
        <div key={key}>
          <div
            className={`flex items-center gap-0.5 rounded-md transition-colors ${
              active ? "bg-glass-2" : "hover:bg-glass-2"
            }`}
          >
            <button
              type="button"
              aria-label={openNode ? "收起" : "展开"}
              onClick={() => toggle(key)}
              className="grid h-[22px] w-[18px] shrink-0 place-items-center text-text-tertiary transition-colors hover:text-text-primary"
            >
              {hasChildren &&
                (openNode ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                ))}
            </button>
            <button
              type="button"
              onClick={() => {
                if (hasChildren) openBranch(key);
                onOpenCollection(label, pathSegs);
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1.5 text-left"
            >
              {openNode ? (
                <FolderOpen
                  className={`h-3.5 w-3.5 shrink-0 ${
                    active ? "text-text-primary" : "text-text-tertiary"
                  }`}
                />
              ) : (
                <Folder
                  className={`h-3.5 w-3.5 shrink-0 ${
                    active ? "text-text-primary" : "text-text-tertiary"
                  }`}
                />
              )}
              <span
                className={`truncate text-[13px] ${
                  active ? "font-medium text-text-primary" : "text-text-secondary"
                }`}
              >
                {node.skill_name ?? node.name}
              </span>
              {hasChildren && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-text-tertiary">
                  {node.children.length}
                </span>
              )}
            </button>
          </div>
          {openNode && hasChildren && (
            <div className="ml-[9px] space-y-0.5 border-l border-stroke/50 pl-[7px]">
              {node.children.map((c) => renderNode(c, label, [...pathSegs, c.name]))}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-0.5">
        {roots.map((root) => {
          const key = toolKey(root.label);
          const openTool = isOpen(key);
          const toolActive = currentLabel === root.label;
          const hasChildren = root.root.children.length > 0;

          return (
            <div key={key}>
              {/* 工具节点 */}
              <div
                className={`flex items-center gap-0.5 rounded-md transition-colors ${
                  toolActive ? "bg-glass-2" : "hover:bg-glass-2"
                }`}
              >
                <button
                  type="button"
                  aria-label={openTool ? "收起" : "展开"}
                  onClick={() => toggle(key)}
                  className="grid h-[22px] w-[18px] shrink-0 place-items-center text-text-tertiary transition-colors hover:text-text-primary"
                >
                  {openTool ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openBranch(key);
                    onOpenCollection(root.label, null);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1.5 text-left"
                >
                  <Folder
                    className={`h-3.5 w-3.5 shrink-0 ${
                      toolActive ? "text-text-primary" : "text-text-tertiary"
                    }`}
                  />
                  <span
                    className={`truncate text-[14px] ${
                      toolActive
                        ? "font-medium text-text-primary"
                        : "font-medium text-text-secondary"
                    }`}
                  >
                    {root.label}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-text-tertiary">
                    {root.root.children.length}
                  </span>
                </button>
              </div>

              {/* 子节点：真实磁盘层级 */}
              {openTool && hasChildren && (
                <div className="ml-[9px] space-y-0.5 border-l border-stroke/50 pl-[7px]">
                  {root.root.children.map((c) => renderNode(c, root.label, [c.name]))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
);