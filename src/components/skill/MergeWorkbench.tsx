/**
 * PLAN-13 工作流 M 阶段 2：对比/合并工作台（手动路径，全屏沉浸态）。
 *
 * 布局（§4.3）：顶栏（返回 / A↔B / 类型徽标+理由）→ git 式按行 diff →
 * 附件对比条（同名/仅A/仅B，同名可点开单文件 diff）→ 底部「保存左边/保存右边」。
 *
 * 阶段 2 语义：「保存某边」= 保留该技能，另一份**备份后进回收站**；
 * junction 落点 / 账本出处由后端地雷排查拦截（§4.5），前端同步禁用。
 * 智能合并（段落拼接/AI 润色/落点选择）属阶段 3，本阶段不出现。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  FileText,
  Save,
  Sparkles,
} from "lucide-react";
import {
  readSkillFile,
  readFileBase64,
  skillListFiles,
  dupResolve,
  type DupGroup,
  type DupMember,
  type FileNode,
} from "@/lib/api";
import { isImageRel } from "@/lib/utils";
import { LineDiff } from "@/components/common/LineDiff";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { buildVariants } from "@/lib/variants";
import { toast } from "sonner";

interface MergeWorkbenchProps {
  a: DupMember;
  b: DupMember;
  group: DupGroup;
  /** 返回查重面板 */
  onBack: () => void;
  /** 处置成功：App 刷新技能列表并收尾 */
  onResolved: () => void;
  /** PLAN-16 阶段 5：点「智能合并」→ 打开统一合并工作台（V==2 分支） */
  onMerge: (group: DupGroup, baseId: string) => void;
}

/** 拍平文件树为相对路径列表（跳过目录节点本身） */
function flattenFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.is_dir) flattenFiles(n.children, out);
    else out.push(n.rel.replace(/\\/g, "/"));
  }
  return out;
}

/** F4 文件导航项：正文与附件统一列表条目（状态徽标 + 激活高亮） */
function FileItem({
  active,
  label,
  badge,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  badge: string;
  tone: "neutral" | "conflict" | "same" | "onlyA" | "onlyB";
  onClick: () => void;
}) {
  const idle =
    tone === "conflict"
      ? "text-amber-600 hover:bg-amber-500/10"
      : tone === "onlyA"
        ? "text-red-500 hover:bg-red-500/10"
        : tone === "onlyB"
          ? "text-emerald-600 hover:bg-emerald-500/10"
          : "text-text-secondary hover:bg-glass-2";
  const badgeIdle =
    tone === "conflict"
      ? "text-amber-600"
      : tone === "same"
        ? "text-emerald-600"
        : tone === "onlyA"
          ? "text-red-400"
          : tone === "onlyB"
            ? "text-emerald-500"
            : "text-text-tertiary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
        active ? "bg-brand text-white" : idle
      }`}
    >
      {tone === "conflict" ? (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      ) : (
        <FileText className="h-3 w-3 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`shrink-0 text-[9.5px] ${active ? "text-white/70" : badgeIdle}`}>{badge}</span>
    </button>
  );
}

export function MergeWorkbench({ a, b, group, onBack, onResolved, onMerge }: MergeWorkbenchProps) {
  const [mdA, setMdA] = useState<string | null>(null);
  const [mdB, setMdB] = useState<string | null>(null);
  const [filesA, setFilesA] = useState<string[] | null>(null);
  const [filesB, setFilesB] = useState<string[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // F4 单内容视口：null = SKILL.md 正文；字符串 = 附件 rel。
  // 正文与附件统一在同一个固定视口展示，点文件列表切换，不再多处内联漂移。
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // 附件内容缓存（rel → A/B 两侧文本），避免重复读取
  const [fileCache, setFileCache] = useState<Record<string, { left: string; right: string }>>({});
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  // F1 同名附件内容冲突判定：rel → true=内容不同（冲突）/ false=内容相同
  const [attachDiff, setAttachDiff] = useState<Record<string, boolean> | null>(null);
  // 图片附件预览缓存（rel → A/B 两侧 data URL）
  const [imgCache, setImgCache] = useState<Record<string, { left: string; right: string }>>({});

  // 处置确认
  const [pending, setPending] = useState<"keepA" | "keepB" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadErr(null);
    Promise.all([
      readSkillFile(a.source_path),
      readSkillFile(b.source_path),
      skillListFiles(a.skill_dir),
      skillListFiles(b.skill_dir),
    ])
      .then(([ta, tb, fa, fb]) => {
        setMdA(ta);
        setMdB(tb);
        // SKILL.md 已在主 diff 区呈现，附件对齐时排除
        const skip = (rel: string) => rel.toLowerCase() === "skill.md";
        setFilesA(flattenFiles(fa).filter((r) => !skip(r)));
        setFilesB(flattenFiles(fb).filter((r) => !skip(r)));
      })
      .catch((e) => setLoadErr(String(e instanceof Error ? e.message : e)));
  }, [a, b]);

  useEffect(() => {
    load();
  }, [load]);

  // F1：同名附件读内容比对，细分「同名同内容」与「同名不同内容（冲突）」——
  // 冲突判定下沉到总览页，不再漏报。
  useEffect(() => {
    if (!filesA || !filesB) return;
    const setB = new Set(filesB);
    const sameNames = filesA.filter((r) => setB.has(r));
    if (sameNames.length === 0) {
      setAttachDiff({});
      return;
    }
    let alive = true;
    (async () => {
      const out: Record<string, boolean> = {};
      await Promise.all(
        sameNames.map(async (rel) => {
          // 图片/二进制附件不做文本比对：一律判定「相同」，改走图片渲染预览与
          // 合并时的基底优先（否则 read_to_string 读二进制失败会被误判成冲突）
          if (isImageRel(rel)) return;
          try {
            const [ac, bc] = await Promise.all([
              readSkillFile(`${a.skill_dir}/${rel}`),
              readSkillFile(`${b.skill_dir}/${rel}`),
            ]);
            out[rel] = ac !== bc;
          } catch {
            out[rel] = true; // 读不全 → 按冲突提示，交智能合并细判
          }
        })
      );
      if (alive) setAttachDiff(out);
    })();
    return () => {
      alive = false;
    };
  }, [filesA, filesB, a.skill_dir, b.skill_dir]);

  // 附件对齐：同名同内容 / 同名冲突 / 仅A / 仅B
  const attach = useMemo(() => {
    if (!filesA || !filesB) return null;
    const setB = new Set(filesB);
    const setA = new Set(filesA);
    const sameNames = filesA.filter((r) => setB.has(r));
    return {
      same: attachDiff ? sameNames.filter((r) => !attachDiff[r]) : sameNames,
      conflictSame: attachDiff ? sameNames.filter((r) => attachDiff[r]) : [],
      onlyA: filesA.filter((r) => !setB.has(r)),
      onlyB: filesB.filter((r) => !setA.has(r)),
      diffReady: attachDiff !== null,
    };
  }, [filesA, filesB, attachDiff]);

  // F4：点击文件列表项 → 切换单内容视口（再点已激活项 → 回到 SKILL.md 正文）
  const openFile = async (rel: string) => {
    if (activeFile === rel) {
      setActiveFile(null);
      return;
    }
    setActiveFile(rel);
    if (fileCache[rel]) return;
    setFileBusy(rel);
    try {
      // 图片：读二进制 data URL 供 <img> 渲染（不做文本比对）
      if (isImageRel(rel)) {
        if (!imgCache[rel]) {
          const [left, right] = await Promise.all([
            readFileBase64(`${a.skill_dir}/${rel}`).catch(() => ""),
            readFileBase64(`${b.skill_dir}/${rel}`).catch(() => ""),
          ]);
          setImgCache((c) => ({ ...c, [rel]: { left, right } }));
        }
        return;
      }
      const [left, right] = await Promise.all([
        readSkillFile(`${a.skill_dir}/${rel}`).catch(() => ""),
        readSkillFile(`${b.skill_dir}/${rel}`).catch(() => ""),
      ]);
      setFileCache((c) => ({ ...c, [rel]: { left, right } }));
    } finally {
      setFileBusy(null);
    }
  };

  /** pending 对应的保留方 / 被处置方 */
  const pair = pending === "keepA" ? { keep: a, remove: b } : { keep: b, remove: a };

  const doResolve = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await dupResolve(pair.keep.skill_id, pair.remove.skill_id);
      // 成功不弹成功/备份位置提示（成功由面板刷新体现，用户不会误以为失败）；
      // 仅失败时下方 catch 弹警告。Boss 反馈。
      onResolved();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const loading = mdA === null || mdB === null || !attach;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ===== header：顶栏 / 路径 / 地雷警告（PLAN-15 §2 骨架）===== */}
      <header className="shrink-0 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="mbtn"
          aria-label="返回查重面板"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-text-primary">
            {a.emoji ?? "🧩"} {a.name}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-text-tertiary">↔</span>
          <span className="truncate text-[14px] font-semibold text-text-primary">
            {b.emoji ?? "🧩"} {b.name}
          </span>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-px text-[10.5px] font-medium ${
            group.kind === "identical"
              ? "border-red-500/40 bg-red-500/10 text-red-500"
              : "border-amber-500/40 bg-amber-500/10 text-amber-600"
          }`}
        >
          {group.kind === "identical" ? "内容全等" : "同名"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-tertiary" title={group.reason}>
          {group.reason}
        </span>
      </div>

      {/* 完整文件路径（Boss：用户需要知道重复文件在哪） */}
      <div className="mt-2 flex min-w-0 items-center gap-1.5 pl-1 font-mono text-[10.5px] text-text-tertiary">
        <span className="shrink-0 text-[10px] font-medium text-text-tertiary">A</span>
        <span className="min-w-0 flex-1 truncate" title={`A 完整路径：${a.source_path}\n点击复制`}>
          {a.source_path}
        </span>
        <span className="shrink-0 text-text-tertiary">↔</span>
        <span className="shrink-0 text-[10px] font-medium text-text-tertiary">B</span>
        <span className="min-w-0 flex-1 truncate" title={`B 完整路径：${b.source_path}\n点击复制`}>
          {b.source_path}
        </span>
      </div>

      {/* ===== 地雷警告条（§4.5）：junction 落点不可被处置（PLAN-15 §7：3px 左色条）===== */}
      {(a.hub_linked || b.hub_linked) && (
        <div className="mt-3 flex items-start gap-2 border-l-[3px] border-amber-500 bg-amber-500/[.06] px-3 py-2 text-[12px] leading-relaxed text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {[a, b]
              .filter((m) => m.hub_linked)
              .map((m) => `「${m.name}」`)
              .join("、")}
            是 Hub 引用的 junction 落点，不能被处置（保留它，或先去 Hub 解除引用）。
          </span>
        </div>
      )}
      </header>

      {/* ===== main：文件导航 + 单内容视口（F1+F4：正文与附件统一展示，Git changed-files 范式）===== */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3 lg:flex-row">
        {loadErr ? (
          <div className="flex flex-1 flex-col items-center gap-3 p-10 text-[13px] text-text-secondary">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            加载失败：{loadErr}
            <button type="button" onClick={load} className="mbtn">
              重试
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-12 text-[13px] text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取两份技能…
          </div>
        ) : (
          <>
            {/* 文件导航：SKILL.md + 附件同一列表，状态徽标一目了然（Git changed-files） */}
            <nav className="shrink-0 border-b border-stroke/60 pb-2 lg:w-[236px] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:pb-0 lg:pr-2">
              <div className="px-2 pb-1 pt-1 font-mono text-[10px] text-text-tertiary">
                文件 {attach ? 1 + attach.same.length + attach.conflictSame.length + attach.onlyA.length + attach.onlyB.length : 1}
                {attach && attach.conflictSame.length > 0
                  ? ` · ${attach.conflictSame.length} 处同名冲突`
                  : attach && !attach.diffReady
                    ? " · 比对中…"
                    : ""}
              </div>
              <div className="flex flex-wrap gap-1 px-1 lg:flex-col lg:gap-0.5">
                <FileItem
                  active={activeFile === null}
                  label="SKILL.md"
                  badge="正文"
                  tone="neutral"
                  onClick={() => setActiveFile(null)}
                />
                {(attach?.conflictSame ?? []).map((rel) => (
                  <FileItem
                    key={`c-${rel}`}
                    active={activeFile === rel}
                    label={rel}
                    badge="冲突"
                    tone="conflict"
                    onClick={() => openFile(rel)}
                  />
                ))}
                {(attach?.same ?? []).map((rel) => (
                  <FileItem
                    key={`s-${rel}`}
                    active={activeFile === rel}
                    label={rel}
                    badge="相同"
                    tone="same"
                    onClick={() => openFile(rel)}
                  />
                ))}
                {(attach?.onlyA ?? []).map((rel) => (
                  <FileItem
                    key={`a-${rel}`}
                    active={activeFile === rel}
                    label={rel}
                    badge="仅 A"
                    tone="onlyA"
                    onClick={() => openFile(rel)}
                  />
                ))}
                {(attach?.onlyB ?? []).map((rel) => (
                  <FileItem
                    key={`b-${rel}`}
                    active={activeFile === rel}
                    label={rel}
                    badge="仅 B"
                    tone="onlyB"
                    onClick={() => openFile(rel)}
                  />
                ))}
              </div>
            </nav>

            {/* 单内容视口：正文与任意附件都在此固定区域展示，点击文件切换 */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 lg:min-w-0">
              {activeFile === null ? (
                <LineDiff
                  left={mdA ?? ""}
                  right={mdB ?? ""}
                  leftLabel={`A · ${a.name}（${a.scan_label}）`}
                  rightLabel={`B · ${b.name}（${b.scan_label}）`}
                />
              ) : fileBusy === activeFile ? (
                <div className="flex items-center justify-center gap-2 p-12 text-[13px] text-text-tertiary">
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在读取 {activeFile}…
                </div>
              ) : activeFile && isImageRel(activeFile) ? (
                imgCache[activeFile] ? (
                  <div className="flex flex-col gap-3 p-2">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-mono text-[10px] text-text-tertiary">A · {a.name} · {activeFile}</span>
                        <img src={imgCache[activeFile].left} alt={`A · ${activeFile}`} className="max-h-[45vh] max-w-full rounded-lg border border-stroke bg-glass-2 object-contain" />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-mono text-[10px] text-text-tertiary">B · {b.name} · {activeFile}</span>
                        <img src={imgCache[activeFile].right} alt={`B · ${activeFile}`} className="max-h-[45vh] max-w-full rounded-lg border border-stroke bg-glass-2 object-contain" />
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-text-tertiary">
                      同名图片判定为「相同」：合并时默认保留基底（A）版本；如需换成 B 版，请在「智能合并」中选择。
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 p-12 text-[13px] text-text-tertiary">
                    <Loader2 className="h-4 w-4 animate-spin" /> 正在读取图片…
                  </div>
                )
              ) : fileCache[activeFile] ? (
                <LineDiff
                  left={fileCache[activeFile].left}
                  right={fileCache[activeFile].right}
                  leftLabel={`A · ${a.name} · ${activeFile}`}
                  rightLabel={`B · ${b.name} · ${activeFile}`}
                />
              ) : (
                <div className="p-10 text-[12px] text-text-tertiary">
                  无法预览该文件（可能是二进制），可在智能合并中处理。
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ===== footer：保存左边 / 保存右边 / 智能合并入口（常驻可见，PLAN-15 §2） ===== */}
      <footer className="shrink-0 border-t border-stroke/70 py-3">
        <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-text-tertiary">
          只读对比：先看差异；要合并点「智能合并」进统一工作台。
        </span>
        <button
          type="button"
          className="mbtn primary"
          disabled={loading}
          title="统一合并工作台（选基底 + 折入其余，台内可切基准）+ 落点 + 处置 + AI 润色（全程可撤销）"
          onClick={() => onMerge(group, buildVariants(group)[0]?.rep.skill_id ?? a.skill_id)}
        >
          <Sparkles className="h-3.5 w-3.5" />
          智能合并
        </button>
        <button
          type="button"
          className="mbtn"
          disabled={busy || b.hub_linked || loading}
          title={b.hub_linked ? "B 是 Hub junction 落点，不可被处置" : undefined}
          onClick={() => setPending("keepA")}
        >
          <Save className="h-3.5 w-3.5" />
          保存左边（处置 B）
        </button>
        <button
          type="button"
          className="mbtn primary"
          disabled={busy || a.hub_linked || loading}
          title={a.hub_linked ? "A 是 Hub junction 落点，不可被处置" : undefined}
          onClick={() => setPending("keepB")}
        >
          <Save className="h-3.5 w-3.5" />
          保存右边（处置 A）
        </button>
        </div>
      </footer>

      {/* ===== 处置确认 ===== */}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && !busy && setPending(null)}
        title={pending ? `保留「${pair.keep.name}」，处置「${pair.remove.name}」？` : ""}
        description={
          pending
            ? `「${pair.remove.name}」将先完整备份到 merge-backups，再移入系统回收站（绝不物理删除，可恢复）。\n它的标签挂载会一并清理；译文与速览随原件失效。`
            : ""
        }
        confirmText="备份并处置"
        variant="destructive"
        loading={busy}
        onConfirm={doResolve}
      />
    </div>
  );
}
