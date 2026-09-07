import { useRef, useState } from "react";
import {
  RefreshCw,
  Sun,
  Moon,
  Settings,
  MoreHorizontal,
  BookOpen,
  ExternalLink,
  Boxes,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTheme } from "next-themes";
import finLight from "@/assets/brand/fin-light.png";
import finDark from "@/assets/brand/fin-dark.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LINKS } from "@/lib/links";
import { VIEW_REGISTRY, type ViewId } from "@/lib/view-registry";
import { SkillTree, type SkillTreeHandle } from "./SkillTree";
import { ExpandCollapseAll } from "@/components/common/ExpandCollapseAll";
import type { Skill } from "@/hooks/useSkills";
import type { LibraryTreeRoot } from "@/lib/api";

/**
 * 侧栏重构（全高传统侧栏）
 *
 * 顶栏模式隐藏全局 Topbar 后，把顶栏的功能全部收进侧栏：
 *  - 顶部固定：品牌区（含折叠按钮）
 *  - 中部：主导航（技能库 / Packs / Hub / 创作）
 *  - 可滚动区：技能库目录树（仅 lib tab）
 *  - 底部固定：用户栏式单菜单按钮（同步/主题/设置/手册/关于）
 *  - 折叠为图标栏（w-[60px]），导航/用户栏仅保留图标
 *
 * 搜索不再提供侧栏入口：全局搜索统一由 Ctrl+K 触发（居中弹层），
 * 避免一个误导性的假输入框。
 *
 * 侧栏树区与主内容区各自独立滚动（见 App.tsx 布局壳），页面级不滚。
 * 沉浸态（创作工作台 wbActive）由 App 层隐藏本组件。
 */

interface SidebarProps {
  activeTab: ViewId;
  onChangeTab: (tab: ViewId) => void;
  /** 技能库目录树（scan_library_tree，与主视图 LibraryExplorer 同源） */
  tree: LibraryTreeRoot[];
  /** 技能 id → Skill（目录树技能节点渲染/打开详情用） */
  skillsById: Map<string, Skill>;
  currentLabel: string | null;
  currentPath: string[] | null;
  selectedSkillId: string | null;
  onOpenCollection: (label: string, path: string[] | null) => void;
  onOpenSkill: (skill: Skill) => void;
  // 顶栏功能收编（侧栏重构）
  syncing?: boolean;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenManual: () => void;
}

export function Sidebar({
  activeTab,
  onChangeTab,
  tree,
  skillsById,
  currentLabel,
  currentPath,
  selectedSkillId,
  onOpenCollection,
  onOpenSkill,
  syncing,
  onSync,
  onOpenSettings,
  onOpenManual,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme !== "light";

  // 折叠态：收窄为图标栏（存 localStorage，跨会话记忆）
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sm:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapse = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sm:sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  // 目录树展开/收起句柄：头部紧凑控件经此调用 SkillTree 内部方法
  const treeRef = useRef<SkillTreeHandle>(null);

  return (
    <aside
      className={`glass-sidebar flex h-full shrink-0 flex-col transition-[width] duration-200 ${
        collapsed ? "w-[60px]" : "w-[252px]"
      }`}
    >
      {/* ===== 顶部固定：品牌区（含折叠按钮） ===== */}
      <div
        className={`flex shrink-0 items-center pt-4 pb-3 ${
          collapsed ? "flex-col gap-2 px-0" : "gap-[11px] px-4"
        }`}
      >
        <img
          src={isDark ? finDark : finLight}
          alt=""
          aria-hidden
          draggable={false}
          className={collapsed ? "h-[26px] w-auto" : "h-[30px] w-auto"}
        />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[15px] font-semibold leading-none tracking-[0.2px] text-text-primary">
              shark skills
            </h1>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          className="iconbtn shrink-0"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* ===== 主导航 ===== */}
      <nav
        className={`shrink-0 space-y-0.5 py-1 ${
          collapsed ? "flex flex-col items-center px-0" : "px-2.5"
        }`}
        aria-label="主导航"
      >
        {VIEW_REGISTRY.map((v) => {
          const Icon = v.icon;
          const active = activeTab === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onChangeTab(v.id)}
              aria-label={collapsed ? v.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg py-2 text-[14px] font-medium transition-colors ${
                collapsed ? "w-10 justify-center px-0" : "w-full px-3"
              } ${
                active
                  ? "bg-glass-2 text-text-primary"
                  : "text-text-secondary hover:bg-glass-2 hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && v.label}
            </button>
          );
        })}
      </nav>

      <div
        className={`my-1 shrink-0 border-t border-stroke/70 ${
          collapsed ? "mx-auto w-8" : "mx-2.5"
        }`}
      />

      {/* ===== 可滚动区：技能库目录树（折叠态隐藏，但保留占位撑满高度）。
          目录树始终显示（不随主菜单切换隐藏）——无论当前在哪个视图都能一眼看到树，
          点击树节点即跳回技能库对应分支。===== */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {!collapsed && (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-1.5 px-1">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-tertiary">
                <Boxes className="h-[15px] w-[15px]" />
                技能库目录
              </h2>
              <ExpandCollapseAll
                onExpandAll={() => treeRef.current?.expandAll()}
                onCollapseAll={() => treeRef.current?.collapseAll()}
              />
            </div>
            <SkillTree
              ref={treeRef}
              roots={tree}
              skillsById={skillsById}
              currentLabel={currentLabel}
              currentPath={currentPath}
              selectedSkillId={selectedSkillId}
              onOpenCollection={onOpenCollection}
              onOpenSkill={onOpenSkill}
            />
          </>
        )}
      </div>

      {/* ===== 底部固定：单菜单按钮（⋯），钉在底部右侧 =====
           无用户概念：去掉头像与用户名栏，仅保留操作菜单；
           统计卡片仅在顶栏布局展示（见 Topbar），侧栏不再展示。折叠态居中仅图标。 */}
      <div className="shrink-0 border-t border-stroke/70 px-2.5 pb-3 pt-2">
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-end"}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="打开菜单" className="iconbtn">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-[300px]">
              <DropdownMenuItem onSelect={onSync}>
                <RefreshCw className={syncing ? "animate-spin" : ""} />
                刷新同步
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
                {isDark ? <Sun /> : <Moon />}
                {isDark ? "切换亮色" : "切换暗色"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenSettings}>
                <Settings />
                设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenManual}>
                <BookOpen />
                使用手册
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={LINKS.site} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  关于我们
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

    </aside>
  );
}
