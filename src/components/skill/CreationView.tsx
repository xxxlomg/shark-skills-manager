import { useMemo, useState, type CSSProperties } from "react";
import {
  EllipsisVertical,
  Package,
  Pencil,
  ScrollText,
  Sparkles,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHead } from "@/components/common/SectionHead";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { LayoutToggle } from "./LayoutToggle";
import {
  skillRename,
  openaiYamlGenerate,
  claudeMdGenerate,
  type Skill,
} from "@/lib/api";
import type { LayoutMode } from "@/hooks/useSkills";

/**
 * C9 创作页（PLAN-07 W1）：列表态 ↔ 工作台态。
 * 工作台状态由 App 层持有并在 App 层整页渲染（侧栏布局壳切换时 CreationView 会
 * 卸载重挂，若自持工作台状态会丢失）；本组件只负责触发/通知。
 * - 卡片点击 / 新建 → App 打开全页 AuthoringWorkbench（退役 CreationEditDialog）；
 * - 卡片菜单：改名 / 转 Codex / 转 Claude（保留现状，不进工作台）；
 * - HomeView 新建技能 → App 直接打开空工作台。
 */
interface CreationViewProps {
  skills: Skill[];
  refresh: () => void;
  layout: LayoutMode;
  onLayoutChange: (m: LayoutMode) => void;
  /** 打开工作台（skill 为 null 表示新建空工作台） */
  onOpenWorkbench: (skill: Skill | null) => void;
}

/** 一键转换派生 short_description（25–64 字符硬约束自动满足）。 */
function deriveShortDesc(name: string, desc: string): string {
  let s = desc.trim() || `A skill named ${name}; see body for trigger scenarios.`;
  if (s.length > 64) s = s.slice(0, 64);
  const pad = ` Use when the task matches ${name}.`;
  while (s.length < 25) s += pad.slice(0, 25 - s.length);
  return s;
}

export function CreationView({
  skills,
  refresh,
  layout,
  onLayoutChange,
  onOpenWorkbench,
}: CreationViewProps) {
  const authored = useMemo(
    () => skills.filter((s) => s.tool_id === "authored"),
    [skills]
  );
  const [renaming, setRenaming] = useState<Skill | null>(null);
  const [newName, setNewName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [confirmCodex, setConfirmCodex] = useState<Skill | null>(null);
  const [converting, setConverting] = useState("");

  let idx = 0;

  const openRename = (s: Skill) => {
    setRenaming(s);
    setNewName(s.name);
  };

  const submitRename = async () => {
    if (!renaming) return;
    setRenameBusy(true);
    try {
      await skillRename(renaming.skill_dir, newName.trim());
      toast.success(`已重命名为 ${newName.trim()}`);
      setRenaming(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRenameBusy(false);
    }
  };

  /** 转 Codex 兼容：默认拒覆盖，EXISTS → 弹确认（覆盖自动备份 .bak）。 */
  const convertCodex = async (s: Skill, overwrite: boolean) => {
    setConverting(`codex:${s.id}`);
    try {
      const res = await openaiYamlGenerate(
        s.skill_dir,
        {
          display_name: s.name,
          short_description: deriveShortDesc(s.name, s.description),
          default_prompt: `Use $skill-name to ${
            s.description.trim() || `assist with ${s.name} tasks`
          }`,
        },
        overwrite
      );
      toast.success(
        overwrite
          ? `openai.yaml 已覆盖生成（旧文件备份 .bak）：${res.path}`
          : `openai.yaml 已生成：${res.path}`
      );
      setConfirmCodex(null);
      refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw === "EXISTS" && !overwrite) {
        setConfirmCodex(s);
      } else {
        toast.error(raw);
      }
    } finally {
      setConverting("");
    }
  };

  /** 转 Claude 兼容：SKILL.md 缺失才写；已存在 → 提示已是兼容。 */
  const convertClaude = async (s: Skill) => {
    setConverting(`claude:${s.id}`);
    try {
      const res = await claudeMdGenerate(s.skill_dir);
      if (res.created) {
        toast.success(`SKILL.md 已派生：${res.path}`);
        refresh();
      } else {
        toast.info(res.reason ?? "已是 Claude 兼容");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting("");
    }
  };

  // 工作台态由 App 层负责整页渲染（见组件头注释），本组件只渲染列表
  return (
    <div className="relative py-6">
      <SectionHead
        title="创作"
        subtitle={`${authored.length} 个创作技能 · 草稿期建议留在 authored`}
      >
        <button type="button" className="mbtn primary" onClick={() => onOpenWorkbench(null)}>
          <Sparkles className="h-3.5 w-3.5" />
          新建
        </button>
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {authored.map((s) => (
            <AuthoredCard
              key={s.id}
              skill={s}
              index={idx++}
              layout="grid"
              busy={converting}
              onClick={() => onOpenWorkbench(s)}
              onRename={() => openRename(s)}
              onConvertCodex={() => convertCodex(s, false)}
              onConvertClaude={() => convertClaude(s)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {authored.map((s) => (
            <AuthoredCard
              key={s.id}
              skill={s}
              index={idx++}
              layout="list"
              busy={converting}
              onClick={() => onOpenWorkbench(s)}
              onRename={() => openRename(s)}
              onConvertCodex={() => convertCodex(s, false)}
              onConvertClaude={() => convertClaude(s)}
            />
          ))}
        </div>
      )}

      {authored.length === 0 && (
        <EmptyPanel
          icon={<Sparkles className="h-7 w-7" />}
          title="还没有创作技能"
          description="点右上角「新建」进入创作工作台，用 AI 辅助编写并沉淀你的自定义技能。"
        />
      )}

      {/* 重命名小弹窗（菜单项入口） */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              重命名技能
            </DialogTitle>
          </DialogHeader>
          <div className="p-1">
            <div className="mb-1.5 text-xs text-muted-foreground">
              新名称（hyphen-case，如 code-review）
            </div>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!newName.trim() || renameBusy}
              onClick={submitRename}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 覆盖 openai.yaml 确认 */}
      <Dialog open={!!confirmCodex} onOpenChange={(o) => !o && setConfirmCodex(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              openai.yaml 已存在
            </DialogTitle>
          </DialogHeader>
          <p className="p-1 text-xs leading-relaxed text-muted-foreground">
            覆盖生成将把旧文件备份为 openai.yaml.bak，是否继续？
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmCodex(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={converting !== ""}
              onClick={() => confirmCodex && convertCodex(confirmCodex, true)}
            >
              覆盖并备份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 创作卡片：右上角菜单钮（改名/双兼容转换）；卡片点击进工作台。 */
function AuthoredCard({
  skill,
  index,
  layout,
  busy,
  onClick,
  onRename,
  onConvertCodex,
  onConvertClaude,
}: {
  skill: Skill;
  index: number;
  layout: "grid" | "list";
  busy: string;
  onClick: () => void;
  onRename: () => void;
  onConvertCodex: () => void;
  onConvertClaude: () => void;
}) {
  const wrapStyle = { "--i": index } as CSSProperties;
  const isBusy =
    busy === `codex:${skill.id}` || busy === `claude:${skill.id}`;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="技能操作菜单"
          className="relative z-[1] grid h-7 w-7 place-items-center rounded-md border border-stroke bg-glass-2 text-text-secondary hover:text-text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8} onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="h-3.5 w-3.5" />
          修改 skills 名称
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isBusy} onSelect={onConvertCodex}>
          <Package className="h-3.5 w-3.5" />
          转为 Codex 兼容
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isBusy} onSelect={onConvertClaude}>
          <ScrollText className="h-3.5 w-3.5" />
          转为 Claude 兼容
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrapStyle}>
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }}
          className="glass-card glass-card-hover card-glow relative flex w-full cursor-pointer items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left"
        >
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-[22px] leading-none">
            {skill.emoji || "🧩"}
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="truncate font-display text-[15.5px] font-semibold text-text-primary">
              {skill.name}
            </h3>
            <p className="truncate text-[11px] text-text-tertiary">{skill.description}</p>
          </div>
          {menu}
        </div>
      </div>
    );
  }

  return (
    <div className="card-wrap" style={wrapStyle}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="glass-card glass-card-hover card-glow relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-[18px] text-left"
      >
        <div className="relative z-[1] flex items-start justify-between">
          <span className="grid h-[42px] w-[42px] place-items-center rounded-[12px] border border-stroke bg-glass-2 text-[22px] leading-none">
            {skill.emoji || "🧩"}
          </span>
          {menu}
        </div>
        <h3 className="relative z-[1] mt-3 truncate font-display text-[15.5px] font-semibold text-text-primary">
          {skill.name}
        </h3>
        <p className="relative z-[1] mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-tertiary">
          {skill.description}
        </p>
      </div>
    </div>
  );
}
