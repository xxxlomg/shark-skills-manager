import { useState } from "react";
import {
  Search,
  RefreshCw,
  Sun,
  Moon,
  Settings,
  CircleHelp,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { useTheme } from "next-themes";
import finLight from "@/assets/brand/fin-light.png";
import finDark from "@/assets/brand/fin-dark.png";
import { Tip } from "@/components/common/Tip";
import { StatsCard, type StatsData } from "./StatsCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LINKS } from "@/lib/links";
import { APP_VERSION } from "@/lib/version";

interface TopbarProps {
  stats: StatsData;
  syncing?: boolean;
  onSearchClick: () => void;
  onSync: () => void;
  onOpenSettings: () => void;
  /** 打开使用手册白皮书面（P1） */
  onOpenManual: () => void;
}

/**
 * 玻璃顶栏（替代旧 Header）。
 * 统计抽离为悬停卡：紧凑显示「技能数 · 已翻译」，悬停展开 StatsCard（含按工具分布）。
 */
export function Topbar({
  stats,
  syncing,
  onSearchClick,
  onSync,
  onOpenSettings,
  onOpenManual,
}: TopbarProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme !== "light";
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <header className="glass-topbar sticky top-0 z-40 flex items-center gap-4 px-[26px] py-3">
      {/* 品牌区 */}
      <div className="flex shrink-0 items-center gap-[11px]">
        {/* shark skills mark：鳍+浪，深浅自适应（瑞士风极简，无光晕） */}
        <img
          src={isDark ? finDark : finLight}
          alt=""
          aria-hidden
          draggable={false}
          className="h-[30px] w-auto"
        />
        <div>
          <h1 className="font-display text-[17px] font-semibold leading-none tracking-[0.2px] text-text-primary">
            shark skills
          </h1>
        </div>
      </div>

      {/* 搜索触发器（模拟输入框，点击唤起 CmdK） */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSearchClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSearchClick();
        }}
        className="mx-auto flex max-w-[440px] flex-1 cursor-text items-center gap-[9px] rounded-md border border-stroke bg-glass px-[14px] py-[9px] text-[13.5px] text-text-tertiary transition-colors duration-200 hover:border-stroke-hi hover:text-text-secondary"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="truncate">搜索技能、分类、Pack…</span>
        <span className="kbd ml-auto shrink-0">Ctrl K</span>
      </div>

      {/* 右侧操作区 */}
      <div className="flex shrink-0 items-center gap-2">
        {/* 统计悬停卡：紧凑技能数 + 悬停展开按工具分布 */}
        <div
          className="relative shrink-0"
          onMouseEnter={() => setStatsOpen(true)}
          onMouseLeave={() => setStatsOpen(false)}
        >
          <button
            type="button"
            aria-label="技能统计（悬停查看按工具分布）"
            className="flex items-center gap-[7px] rounded-md border border-stroke bg-glass px-[13px] py-[7px] text-[12.5px] font-medium text-text-secondary transition-colors hover:border-stroke-hi hover:text-text-primary"
          >
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--accent)" }}
              aria-hidden
            />
            <span className="tabular-nums text-text-primary">{stats.total}</span>
            <span>技能</span>
            <span className="text-text-tertiary">·</span>
            <span className="tabular-nums text-text-primary">{stats.translated}</span>
            <span>已译</span>
          </button>

          {statsOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-[320px] rounded-lg border border-stroke bg-glass p-4 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.35)]">
              <StatsCard {...stats} />
            </div>
          )}
        </div>

        {/* 同步 */}
        <Tip label="同步">
          <button
            type="button"
            className="iconbtn"
            onClick={onSync}
            disabled={syncing}
            aria-label="同步技能列表"
          >
            <RefreshCw className={`h-[18px] w-[18px] ${syncing ? "animate-spin" : ""}`} />
          </button>
        </Tip>

        {/* 主题切换 */}
        <Tip label={isDark ? "切换亮色" : "切换暗色"}>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label="切换主题"
          >
            {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
        </Tip>

        {/* 设置 */}
        <Tip label="设置">
          <button
            type="button"
            className="iconbtn"
            onClick={onOpenSettings}
            aria-label="打开设置"
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </Tip>

        {/* 关于 / 帮助（P1）：版本、仓库链接、使用手册 */}
        <DropdownMenu>
          <Tip label="关于 shark skills">
            <DropdownMenuTrigger asChild>
              <button type="button" className="iconbtn" aria-label="关于 shark skills">
                <CircleHelp className="h-[18px] w-[18px]" />
              </button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              shark skills{" "}
              <span className="font-mono text-text-tertiary">v{APP_VERSION}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={LINKS.githubRepo} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                GitHub 仓库
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={LINKS.giteeRepo} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Gitee 仓库
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenManual}>
              <BookOpen />
              使用手册
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
