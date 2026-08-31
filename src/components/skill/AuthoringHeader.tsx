/**
 * 创作工作台顶栏（从 AuthoringWorkbench 拆出）。
 * X1 沉浸顶：返回 / emoji 快选 / 名称 / 落点 / dirty 圆点 / 面板开关 / 设置 / 保存。
 * 编辑态名称只读（改名回创作列表）；新建态支持落点下拉。
 */
import { useState } from "react";
import { ArrowLeft, Columns2, Loader2, PanelLeft, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tip } from "@/components/common/Tip";
import { COMMON_EMOJI } from "@/lib/authoring-utils";
import type { ToolInfo } from "@/lib/api";
import type { WbDraft } from "@/lib/wb-draft";

interface AuthoringHeaderProps {
  /** 编辑态技能名（只读展示）；undefined = 新建态 */
  editingName?: string;
  emoji: string;
  name: string;
  nameInvalid: boolean;
  onPatch: (patch: Partial<WbDraft>) => void;
  /** 新建态保存落点（工具 id / "authored"） */
  location?: string;
  onLocationChange?: (value: string) => void;
  tools: ToolInfo[];
  dirty: boolean;
  descOpen: boolean;
  onToggleDesc: () => void;
  editorOpen: boolean;
  onToggleEditor: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  busy: boolean;
  onSave: () => void;
}

export function AuthoringHeader({
  editingName,
  emoji,
  name,
  nameInvalid,
  onPatch,
  location,
  onLocationChange,
  tools,
  dirty,
  descOpen,
  onToggleDesc,
  editorOpen,
  onToggleEditor,
  onBack,
  onOpenSettings,
  busy,
  onSave,
}: AuthoringHeaderProps) {
  return (
    <div className="sticky top-0 z-40 grid shrink-0 gap-3 rounded-lg border border-border/50 bg-[var(--bg-0)]/95 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-3 lg:flex-nowrap">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onBack}
          aria-label="返回创作列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <EmojiPicker emoji={emoji} onPatch={onPatch} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 lg:flex-nowrap">
          {editingName ? (
            <Tip label="编辑态名称只读，返回创作列表后可改名">
              <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-text-primary">
                {editingName}
              </h1>
            </Tip>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder="给这个 skill 起个名称"
                className="h-9 w-52 max-w-full font-mono text-[13px]"
              />
              {nameInvalid && (
                <span className="text-[11px] text-red-400">
                  需使用小写字母、数字和连字符
                </span>
              )}
            </div>
          )}
          {!editingName && location !== undefined && onLocationChange && (
            <Select value={location} onValueChange={onLocationChange}>
              <SelectTrigger
                size="sm"
                className="h-8 w-fit min-w-36 border-0 px-0 text-[11px] text-text-tertiary shadow-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="authored">保存到创作库</SelectItem>
                {tools.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    保存到 {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-start gap-1.5 lg:flex-nowrap lg:justify-end lg:whitespace-nowrap">
        {dirty && (
          <Tip label="有未保存改动，草稿已自动保存">
            <span className="mr-1 h-2 w-2 rounded-full bg-amber-400" />
          </Tip>
        )}
        <Button
          size="sm"
          variant={descOpen ? "secondary" : "ghost"}
          aria-pressed={descOpen}
          onClick={onToggleDesc}
        >
          <PanelLeft className="h-3.5 w-3.5" />
          <span>创作引导</span>
        </Button>
        <Button
          size="sm"
          variant={editorOpen ? "secondary" : "ghost"}
          aria-pressed={editorOpen}
          onClick={onToggleEditor}
        >
          <Columns2 className="h-3.5 w-3.5" />
          <span>编辑区</span>
        </Button>
        {/* 继续对话即增量完善：在「创作引导」发送新想法即可基于会话上下文优化正文（无独立按钮） */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="设置"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" disabled={busy || nameInvalid} onClick={onSave}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          <Save className="h-3 w-3" />
          保存
        </Button>
      </div>
    </div>
  );
}

/** emoji 快选 + 自由输入（X5；校验从宽，落盘时走 yq 安全引号） */
function EmojiPicker({
  emoji,
  onPatch,
}: {
  emoji: string;
  onPatch: (patch: Partial<WbDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="选择技能图标"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-input bg-transparent text-lg leading-none hover:bg-glass-2"
        >
          {emoji || "🧩"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60">
        <div className="grid grid-cols-8 gap-1">
          {COMMON_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              className="grid h-7 w-7 place-items-center rounded text-base hover:bg-glass-2"
              onClick={() => {
                onPatch({ emoji: e });
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <Input
          value={emoji}
          onChange={(e) => onPatch({ emoji: e.target.value })}
          className="mt-2 h-7 text-center text-sm"
          maxLength={10}
          placeholder="或输入图标"
        />
      </PopoverContent>
    </Popover>
  );
}