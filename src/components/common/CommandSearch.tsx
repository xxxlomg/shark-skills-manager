import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Search, Folder, GitBranch, Plus, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { skillStatus, STATUS_TEXT, type Skill, type SkillGroup } from "@/hooks/useSkills";

type CmdItem =
  | { kind: "skill"; key: string; emoji: string | null; icon?: undefined; title: string; sub: string; tag: string; skill: Skill }
  | { kind: "cat"; key: string; emoji?: undefined; icon: LucideIcon; title: string; sub: string; tag: string; label: string }
  | { kind: "act"; key: string; emoji?: undefined; icon: LucideIcon; title: string; sub: string; tag: string; act: "git" | "newpack" | "settings" };

interface CommandSearchProps {
  open: boolean;
  onClose: () => void;
  groups: SkillGroup[];
  onSkillSelect: (skill: Skill) => void;
  onCategorySelect: (label: string) => void;
  onGitImport: () => void;
  onCreatePack: () => void;
  onOpenSettings: () => void;
}

/**
 * 全局搜索（Cmd/Ctrl + K）。玻璃面板 + 分组结果 + 键盘导航。
 * 视觉来源：docs/style.css .cmdk / .cmdk-panel / .cmdk-i
 */
export function CommandSearch({
  open,
  onClose,
  groups,
  onSkillSelect,
  onCategorySelect,
  onGitImport,
  onCreatePack,
  onOpenSettings,
}: CommandSearchProps) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全量条目（技能 / 分类 / 操作）
  const allItems = useMemo<CmdItem[]>(() => {
    const skills: CmdItem[] = groups.flatMap((g) =>
      g.skills.map((s) => ({
        kind: "skill" as const,
        key: `skill:${s.id}`,
        emoji: s.emoji,
        title: s.title_zh || s.name,
        sub: `${s.name} · ${g.label}`,
        tag: STATUS_TEXT[skillStatus(s)],
        skill: s,
      }))
    );
    const cats: CmdItem[] = groups.map((g) => ({
      kind: "cat" as const,
      key: `cat:${g.label}`,
      icon: Folder,
      title: g.label,
      sub: `${g.skills.length} 个技能`,
      tag: "分类",
      label: g.label,
    }));
    const acts: CmdItem[] = [
      { kind: "act", key: "act:git", icon: GitBranch, title: "从 Git 仓库导入…", sub: "GitHub / Gitee 地址", tag: "操作", act: "git" },
      { kind: "act", key: "act:newpack", icon: Plus, title: "创建新 Skill Pack", sub: "组合打包技能", tag: "操作", act: "newpack" },
      { kind: "act", key: "act:settings", icon: Settings, title: "打开设置", sub: "扫描路径 / LLM 配置", tag: "操作", act: "settings" },
    ];
    return [...skills, ...cats, ...acts];
  }, [groups]);

  // 按 query 过滤
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((it) =>
      `${it.title} ${it.sub}`.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  // 分组（保持 技能 / 分类 / 操作 顺序）
  const grouped = useMemo(() => {
    const order: { title: string; items: CmdItem[] }[] = [
      { title: "技能", items: [] },
      { title: "分类", items: [] },
      { title: "操作", items: [] },
    ];
    for (const it of filtered) {
      if (it.kind === "skill") order[0].items.push(it);
      else if (it.kind === "cat") order[1].items.push(it);
      else order[2].items.push(it);
    }
    return order.filter((g) => g.items.length > 0);
  }, [filtered]);

  // 打开时重置 + 聚焦
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // 选中项滚动到可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-sel="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const runItem = useCallback(
    (it: CmdItem) => {
      onClose();
      if (it.kind === "skill") onSkillSelect(it.skill);
      else if (it.kind === "cat") onCategorySelect(it.label);
      else if (it.act === "git") onGitImport();
      else if (it.act === "newpack") onCreatePack();
      else onOpenSettings();
    },
    [onClose, onSkillSelect, onCategorySelect, onGitImport, onCreatePack, onOpenSettings]
  );

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = filtered[sel];
        if (it) runItem(it);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, sel, runItem, onClose]
  );

  if (!open) return null;

  // 扁平索引 → 用于高亮
  let flatIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh]"
      style={{
        background: "var(--overlay-cmdk)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="全局搜索"
    >
      <div
        className="glass flex max-h-[70vh] w-[min(92vw,620px)] flex-col overflow-hidden rounded-[18px]"
        style={{ animation: "tin 0.22s cubic-bezier(0.4,0,0.2,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 输入区 */}
        <div className="flex items-center gap-3 border-b border-stroke px-[18px] py-[15px]">
          <Search className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索技能、分类、Pack，或粘贴 Git 仓库地址…"
            autoComplete="off"
            className="flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <span className="kbd shrink-0">ESC</span>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-[8px]">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-text-tertiary">
              没有匹配「{query}」的结果
            </div>
          ) : (
            grouped.map((g) => (
              <div key={g.title}>
                <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.7px] text-text-tertiary">
                  {g.title}
                </div>
                {g.items.map((it) => {
                  flatIdx += 1;
                  const idx = flatIdx; // 快照：闭包必须捕获每行自己的索引，而非共享变量的终值
                  const selected = idx === sel;
                  const Icon = it.icon;
                  return (
                    <div
                      key={it.key}
                      data-sel={selected || undefined}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => runItem(it)}
                      className={`flex cursor-pointer items-center gap-3 rounded-[11px] px-3 py-[10px] transition-colors ${
                        selected ? "bg-glass-2" : ""
                      }`}
                      style={selected ? { boxShadow: "inset 2px 0 0 var(--accent)" } : undefined}
                    >
                      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-stroke bg-glass-2 text-[15px]">
                        {it.emoji ?? (Icon ? <Icon className="h-[15px] w-[15px] text-text-secondary" /> : null)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13.5px] font-medium text-text-primary">
                          {it.title}
                        </b>
                        <small className="block truncate text-[11.5px] text-text-tertiary">
                          {it.sub}
                        </small>
                      </span>
                      <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-2 py-[2px] text-[10.5px] text-text-tertiary">
                        {it.tag}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
