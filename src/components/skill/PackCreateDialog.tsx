import { useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
  Loader2,
  PackagePlus,
  Search,
} from "lucide-react";
import { ExpandCollapseAll } from "@/components/common/ExpandCollapseAll";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { packCreate, type PackInfo, type PackSkillInput } from "@/lib/api";
import {
  isPackCreateError,
  packErrorText,
  type SkillValidationFailure,
} from "@/lib/api";
import type { Skill } from "@/hooks/useSkills";

interface PackCreateDialogProps {
  skills: Skill[];
  onClose: () => void;
  onCreated: (info: PackInfo) => void;
  /** 预选技能 id（从技能库批量勾选打包进入时携入） */
  initialSelectedIds?: string[];
}

/** P10a：树节点分组结果 —— 工具 →（可选）合集 → 技能 */
interface ToolGroup {
  key: string;
  label: string;
  collections: { key: string; label: string; skills: Skill[] }[];
  loose: Skill[];
}

/** 复选小方块（跨层联动共用）。stopPropagation：避免嵌套在可点击行内时冒泡到行触发二次 toggle。 */
function TreeCheckbox({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      aria-label="选择"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-border"
      }`}
    >
      {on && <Check className="h-3 w-3" />}
    </button>
  );
}

/** 单个技能行（单行可读布局）：checkbox + emoji + 译名（突出）+ 已翻译徽标 + 原文件名（右侧弱化 mono）。
 *  外层用 div（role=button）而非 button：避免与内嵌 TreeCheckbox 形成嵌套 button，
 *  否则点击 checkbox 会冒泡到行再次 toggle（一次点击两次取反 → 勾选失效）。 */
function SkillRow({
  s,
  on,
  onToggle,
}: {
  s: Skill;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
    >
      <TreeCheckbox on={on} onChange={onToggle} />
      {s.emoji && <span className="shrink-0 text-base leading-none">{s.emoji}</span>}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {s.title_zh || s.name}
      </span>
      {s.has_translation && (
        <span className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1 py-px text-[10px] font-medium text-brand">
          已翻译
        </span>
      )}
      <span className="max-w-[45%] shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
        {s.folder_name}
      </span>
    </div>
  );
}

/** 新建 Pack 对话框（P1）：挑选技能 + 元信息 → 静态总结打包。
 *  P10a 升级：清单改为三层树（工具 → 合集 → 技能），主译名 + 原名恒显 + 已翻译徽标，
 *  支持「仅已翻译」筛选与跨层联动勾选。 */
export function PackCreateDialog({ skills, onClose, onCreated, initialSelectedIds }: PackCreateDialogProps) {
  const [name, setName] = useState("");
  const [ver, setVer] = useState("1.0.0");
  const [author, setAuthor] = useState("");
  const [query, setQuery] = useState("");
  const [onlyTranslated, setOnlyTranslated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? [])
  );
  // 收起的 key 集合（默认全部收起：工具 + 合集全部进 collapsed）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    for (const s of skills ?? []) {
      if (s.source_deleted || s.tool_id === "imported") continue;
      const key = s.scan_label || "未分类";
      keys.add(key); // 工具 key
      if (s.parent_collection) keys.add(`${key}::${s.parent_collection}`); // 合集 key
    }
    return keys;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // C4：校验门拒绝清单（force 逃生门的展示依据）
  const [failures, setFailures] = useState<SkillValidationFailure[] | null>(null);

  // 源文件已删除的孤儿条目不可打包；D4：import/（导入库）内容也不进打包可选源
  const packable = useMemo(
    () => skills.filter((s) => !s.source_deleted && s.tool_id !== "imported"),
    [skills]
  );

  const filtered = useMemo(() => {
    const base = packable.filter((s) => !onlyTranslated || s.has_translation);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.title_zh.toLowerCase().includes(q) ||
        s.folder_name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.description_zh.toLowerCase().includes(q) ||
        s.scan_label.toLowerCase().includes(q)
    );
  }, [packable, query, onlyTranslated]);

  // 三层树：工具 →（合集）→ 技能（无合集省略合集层）
  const tree = useMemo(() => {
    const toolMap = new Map<string, Skill[]>();
    for (const s of filtered) {
      const key = s.scan_label || "未分类";
      const arr = toolMap.get(key) ?? [];
      arr.push(s);
      toolMap.set(key, arr);
    }
    const groups: ToolGroup[] = [];
    for (const [key, skillsInTool] of toolMap) {
      const collMap = new Map<string, Skill[]>();
      const loose: Skill[] = [];
      for (const s of skillsInTool) {
        if (s.parent_collection) {
          const arr = collMap.get(s.parent_collection) ?? [];
          arr.push(s);
          collMap.set(s.parent_collection, arr);
        } else {
          loose.push(s);
        }
      }
      groups.push({
        key,
        label: key,
        collections: [...collMap.entries()].map(([ckey, wield]) => ({
          key: `${key}::${ckey}`,
          label: ckey,
          skills: wield,
        })),
        loose,
      });
    }
    return groups;
  }, [filtered]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 跨层联动：整组勾选/取消（工具或合集共用） */
  const toggleList = (list: Skill[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = list.length > 0 && list.every((s) => selected.has(s.id));
      for (const s of list) {
        if (all) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((s) => next.delete(s.id));
      else filtered.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 一键展开全部（清空 collapsed 集）
  const expandAllTree = useCallback(() => setCollapsed(new Set()), []);

  // 一键收起全部（工具 + 合集全进 collapsed 集）
  const collapseAllTree = useCallback(() => {
    const keys = new Set<string>();
    for (const t of tree) {
      keys.add(t.key);
      for (const c of t.collections) keys.add(c.key);
    }
    setCollapsed(keys);
  }, [tree]);

  // 已选技能中是否含译文 → 提示「包将携带译文」
  const selectedHasTranslation = useMemo(
    () => packable.some((s) => selected.has(s.id) && s.has_translation),
    [packable, selected]
  );

  const handleCreate = async (force = false) => {
    setBusy(true);
    setError("");
    if (!force) setFailures(null);
    try {
      const inputs: PackSkillInput[] = packable
        .filter((s) => selected.has(s.id))
        .map((s) => ({
          source_path: s.source_path,
          skill_id: s.id,
          name: s.name,
          description: s.description,
          description_zh: s.description_zh,
          has_translation: s.has_translation,
        }));
      const info = await packCreate({
        name: name.trim(),
        ver: ver.trim(),
        author: author.trim(),
        skills: inputs,
        force,
      });
      onCreated(info);
      onClose();
    } catch (e) {
      if (isPackCreateError(e) && e.kind === "validation_failed") {
        setFailures(e.failed);
        setError(e.message);
      } else {
        setFailures(null);
        setError(packErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[min(760px,90vh)] flex-col overflow-hidden border-border/60 bg-card sm:max-w-4xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-primary" />
            新建 Skill Pack
          </DialogTitle>
          <DialogDescription>
            挑选技能打包为 .skillpack，可在平台内分享流通
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-3">
          {/* 左栏：基本信息 + 筛选（px-1 给 input 焦点环留出不被裁剪的空间） */}
          <div className="flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto px-1">
            <div className="grid shrink-0 grid-cols-2 gap-2">
              <div className="col-span-2">
                <div className="mb-1 text-xs text-muted-foreground">名称 *</div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：OpenCode Essentials"
                  className="h-8"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">版本</div>
                <Input
                  value={ver}
                  onChange={(e) => setVer(e.target.value)}
                  placeholder="1.0.0"
                  className="h-8"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">作者</div>
                <Input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="可选"
                  className="h-8"
                />
              </div>
            </div>

            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索技能…"
                className="h-8 pl-8"
              />
            </div>

            <div className="flex shrink-0 flex-col gap-y-1.5 text-xs text-muted-foreground">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-[var(--brand)]"
                />
                全选当前列表
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyTranslated}
                  onChange={(e) => setOnlyTranslated(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--brand)]"
                />
                仅已翻译
              </label>
              <span className="mt-1 text-[11px]">
                已选 <span className="text-text-primary">{selected.size}</span> / {packable.length}
              </span>
            </div>

            {selectedHasTranslation && (
              <p className="flex shrink-0 items-center gap-1.5 text-[11px] text-brand">
                <Check className="h-3 w-3" />
                已选技能中含译文，打包将自动携带
              </p>
            )}

            {failures && failures.length > 0 && (
              <div className="shrink-0 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {failures.length} 个技能未通过严格校验，已拒绝打包：
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-700/90 dark:text-amber-300/90">
                  {failures.map((f) => (
                    <li key={f.skill_path}>
                      <span className="font-mono font-medium">{f.name}</span>
                      <ul className="ml-3 list-disc space-y-0.5">
                        {f.issues.map((iss, i) => (
                          <li key={i}>
                            [{iss.rule_id}] {iss.message}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-text-tertiary">
                    修复后再打包；或强行打包（警告将记入 pack.json）
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => handleCreate(true)}
                  >
                    {busy ? "打包中…" : "仍要打包"}
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* 右栏：三层技能树 */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/50">
            <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-text-tertiary">技能清单</span>
              <ExpandCollapseAll
                onExpandAll={expandAllTree}
                onCollapseAll={collapseAllTree}
              />
            </div>
            {tree.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  没有匹配的技能
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
                {tree.map((tool) => {
                  const toolSkills = [
                    ...tool.collections.flatMap((c) => c.skills),
                    ...tool.loose,
                  ];
                  const toolOn =
                    toolSkills.length > 0 &&
                    toolSkills.every((s) => selected.has(s.id));
                  const toolSome = toolSkills.some((s) => selected.has(s.id));
                  const toolCollapsed = collapsed.has(tool.key);
                  return (
                    <div key={tool.key}>
                      {/* 工具行（P6：可收起，默认展开，与 Hub 建链树一致） */}
                      <div className="flex items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent/40">
                        <button
                          type="button"
                          onClick={() => toggleCollapse(tool.key)}
                          aria-label={toolCollapsed ? "展开" : "收起"}
                          className="shrink-0 text-muted-foreground hover:text-text-primary"
                        >
                          {toolCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <TreeCheckbox on={toolOn} onChange={() => toggleList(toolSkills)} />
                        <FolderTree
                          className={`h-3.5 w-3.5 shrink-0 ${toolSome ? "text-brand" : "text-muted-foreground"}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {tool.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {toolSkills.length}
                        </span>
                      </div>
                      {!toolCollapsed && (
                      <div className="ml-5 space-y-0.5 border-l border-border/40 pl-2">
                        {tool.collections.map((coll) => {
                          const collOn =
                            coll.skills.length > 0 &&
                            coll.skills.every((s) => selected.has(s.id));
                          const collSome = coll.skills.some((s) => selected.has(s.id));
                          const isCollapsed = collapsed.has(coll.key);
                          return (
                            <div key={coll.key}>
                              {/* 合集行 */}
                              <div className="flex items-center gap-1.5 rounded px-1 py-1 transition-colors hover:bg-accent/40">
                                <button
                                  type="button"
                                  onClick={() => toggleCollapse(coll.key)}
                                  aria-label={isCollapsed ? "展开" : "收起"}
                                  className="shrink-0 text-muted-foreground hover:text-text-primary"
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <TreeCheckbox on={collOn} onChange={() => toggleList(coll.skills)} />
                                <Folder
                                  className={`h-3.5 w-3.5 shrink-0 ${collSome ? "text-brand" : "text-muted-foreground"}`}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                  {coll.label}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {coll.skills.length}
                                </span>
                              </div>
                              {!isCollapsed && (
                                <div className="ml-5 space-y-0.5">
                                  {coll.skills.map((s) => (
                                    <SkillRow
                                      key={s.id}
                                      s={s}
                                      on={selected.has(s.id)}
                                      onToggle={() => toggle(s.id)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {tool.loose.map((s) => (
                          <SkillRow
                            key={s.id}
                            s={s}
                            on={selected.has(s.id)}
                            onToggle={() => toggle(s.id)}
                          />
                        ))}
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          {selected.size > 0 && !name.trim() && (
            <span className="mr-auto text-xs text-amber-500">
              填写名称后即可打包
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || selected.size === 0 || busy}
            onClick={() => handleCreate(false)}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            打包 {selected.size > 0 ? `${selected.size} 项` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}