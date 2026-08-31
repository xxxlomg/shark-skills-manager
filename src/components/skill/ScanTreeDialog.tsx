import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, ListTree, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { scanSkillsTree } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ScanTreeDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 技能库层级结构树（扫描可视化）：扫描根 → 技能单元/技能包 → 子技能 → 资源文件及类型。
 *
 * 样式对齐瑞士风主题：内凹井用 --bg-1（明暗两档都比卡片深/冷一档）、发丝线 --stroke 描边，
 * 不再用硬编码 bg-black（浅主题下发灰、与主题色脱节）；
 * 结构感知着色只借主题色 --accent 一个色相（根 + 技能标注），其余走文字三级灰阶。
 */
export function ScanTreeDialog({ open, onClose }: ScanTreeDialogProps) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setText(await scanSkillsTree());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // open 变化时重新扫描，避免缓存旧结构
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制层级结构");
    } catch {
      toast.error("复制失败");
    }
  };

  const stats = useMemo(() => countTree(text), [text]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[860px] border-stroke bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-brand/30 bg-brand/10">
              <ListTree className="h-4 w-4 text-brand" />
            </span>
            技能库层级结构
          </DialogTitle>
          <DialogDescription>
            扫描根 → 技能单元 / 技能包 → 子技能 → 资源文件及类型，与磁盘真实结构逐一对应。
          </DialogDescription>
        </DialogHeader>

        {/* 结构面板：内凹井（--bg-1）+ 发丝线，顶部统计条随主题色 */}
        <div className="min-h-0 overflow-hidden rounded-lg border border-stroke bg-bg-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stroke px-3 py-2 text-[11px] text-text-tertiary">
            <Stat label="扫描根" value={stats.roots} />
            <span className="h-3 w-px bg-stroke" aria-hidden />
            <Stat label="技能" value={stats.skills} />
            <span className="h-3 w-px bg-stroke" aria-hidden />
            <Stat label="资源" value={stats.resources} />
            <div className="flex-1" />
            {loading ? (
              <span className="flex items-center gap-1.5 text-brand">
                <Loader2 className="h-3 w-3 animate-spin" />
                正在扫描…
              </span>
            ) : (
              <span>只读视图 · 不进任何写操作</span>
            )}
          </div>

          {error ? (
            <div className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          ) : loading && !text ? (
            <TreeSkeleton />
          ) : !text.trim() ? (
            <p className="px-3 py-10 text-center text-[12px] text-text-tertiary">
              未发现任何扫描根——请先在「设置 → 工具」里启用至少一个 skills 目录。
            </p>
          ) : (
            <div className="diff-scroll max-h-[52vh] overflow-auto px-2.5 py-2 font-mono text-[12px] leading-[1.75]">
              {text.split("\n").map((line, i) => (
                <TreeLine key={i} line={line} />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
          <Button size="sm" onClick={copy} disabled={!text || !!error}>
            <Copy className="h-3.5 w-3.5" />
            复制
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      {label}
      <span className="ml-1 font-semibold tabular-nums text-brand">{value}</span>
    </span>
  );
}

/* ==================== 树文本结构感知渲染 ==================== */

/** 缩进与连接线（Rust scanner 输出：│  / 空格 / ├─ / └─）。 */
const INDENT_RE = /^[│├└─\s]*/;
/** 扫描根行：`路径  (label / tool_id)`。 */
const ROOT_RE = /^(\S.*?)\s{2}\((.+?)\s\/\s(.+?)\)$/;
/** 目录 / 文件行：`名称[\  [标注]] — 描述`。 */
const NODE_RE = /^(\S.*?)\s{2}\[([^\]]+)\](?:\s—\s(.*))?$/;

/** 标注着色：只有「技能/技能包」用主题色，其余走灰阶（瑞士风单强调色）。 */
function annotationClass(ann: string): string {
  if (ann.startsWith("技能包") || ann.startsWith("技能 ·")) return "text-brand";
  if (ann === "技能说明") return "text-brand/70";
  return "text-text-tertiary";
}

function TreeLine({ line }: { line: string }) {
  if (!line.trim()) return <div className="h-2.5" aria-hidden />;

  const indentMatch = INDENT_RE.exec(line);
  const indent = indentMatch?.[0] ?? "";
  const body = line.slice(indent.length);

  // 扫描根：主题色左标尺 + 极淡同色底，作为分组起点
  if (!indent) {
    const root = ROOT_RE.exec(body);
    if (root) {
      return (
        <div className="mt-2.5 -mx-1 rounded-r-md border-l-2 border-brand bg-brand/[0.08] px-2 py-0.5 first:mt-0">
          <span className="text-text-primary">{root[1]}</span>
          <span className="text-text-tertiary">  (</span>
          <span className="text-brand">{root[2]}</span>
          <span className="text-text-tertiary"> / </span>
          <span className="text-brand/80">{root[3]}</span>
          <span className="text-text-tertiary">)</span>
        </div>
      );
    }
  }

  const node = NODE_RE.exec(body);
  if (!node) {
    return <div className="whitespace-pre px-2 text-text-secondary">{line}</div>;
  }
  const [, name, ann, desc] = node;
  const isDir = name.endsWith("\\");
  return (
    <div className="whitespace-pre rounded px-2 py-px transition-colors hover:bg-stroke/50">
      <span className="text-text-tertiary/45">{indent}</span>
      <span className={isDir ? "text-text-primary" : "text-text-secondary"}>
        {name}
      </span>
      <span className="text-text-tertiary/45">{"  ["}</span>
      <span className={annotationClass(ann)}>{ann}</span>
      <span className="text-text-tertiary/45">{"]"}</span>
      {desc && <span className="text-text-tertiary">{" — "}{desc}</span>}
    </div>
  );
}

/** 扫描中占位：假树行骨架（保持与真实内容同样的行高，避免加载完跳动）。 */
function TreeSkeleton() {
  const widths = [58, 40, 30, 44, 34, 48, 28, 42];
  return (
    <div className="px-2.5 py-2">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2 py-[3px]">
          <span
            className="h-2.5 animate-pulse rounded-sm bg-stroke"
            style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

/** 统计条数据：根 / 技能 / 资源三类计数（与渲染同一套解析规则）。 */
function countTree(text: string) {
  let roots = 0;
  let skills = 0;
  let resources = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const indent = INDENT_RE.exec(line)?.[0] ?? "";
    const body = line.slice(indent.length);
    if (!indent && ROOT_RE.test(body)) {
      roots += 1;
      continue;
    }
    const ann = NODE_RE.exec(body)?.[2];
    if (!ann) continue;
    if (ann.startsWith("技能包") || ann.startsWith("技能 ·")) skills += 1;
    else if (ann !== "集合") resources += 1;
  }
  return { roots, skills, resources };
}
