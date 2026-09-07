/**
 * 工作流 S：技能用途速览卡片（DetailSheet 内嵌）。
 * 固定模板三段式：⚡何时调用 / 📥需要什么输入 / 📤最终输出什么。
 *
 * 状态机：无速览（生成入口）→ 生成中（流式原文）→ 有速览（三段展示）。
 * 失效检测：SKILL.md 内容哈希变化 → 黄标「内容已变化」+ 一键重新生成。
 * 未配 LLM Key：入口置灰 + 引导进设置（与翻译行为一致）。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { readSkillFile } from "@/lib/api";
import type { Skill } from "@/hooks/useSkills";
import { sha256Hex } from "@/lib/translate-api";
import { loadLLMConfig } from "@/lib/llm-config";
import type { UseSummariesApi } from "@/hooks/useSummaries";

interface SummaryCardProps {
  skill: Skill;
  summaries: UseSummariesApi;
  onSettingsOpen?: () => void;
}

const ROWS = [
  { key: "when", icon: "⚡", label: "何时调用" },
  { key: "input", icon: "📥", label: "需要什么输入" },
  { key: "output", icon: "📤", label: "最终输出什么" },
] as const;

export function SummaryCard({ skill, summaries, onSettingsOpen }: SummaryCardProps) {
  const summary = summaries.get(skill.id);
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [stale, setStale] = useState(false);
  const [hasLLMKey, setHasLLMKey] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 手动编辑（Boss：用户想自行编写三段式速览，不只靠 AI）
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ when: "", input: "", output: "" });

  const startEdit = useCallback(() => {
    setDraft({
      when: summary?.when ?? "",
      input: summary?.input ?? "",
      output: summary?.output ?? "",
    });
    setEditing(true);
  }, [summary]);

  const saveEdit = useCallback(async () => {
    try {
      // 手动保存时按当前正文哈希写入，避免立即误报「内容已变化」
      const raw = await readSkillFile(skill.source_path);
      const hash = await sha256Hex(raw);
      await summaries.save(
        skill.id,
        draft.when.trim(),
        draft.input.trim(),
        draft.output.trim(),
        hash
      );
      toast.success("用途速览已保存");
      setEditing(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [skill.id, skill.source_path, draft, summaries]);

  // 失效检测：当前正文哈希 vs 速览记录的 source_hash
  useEffect(() => {
    if (!summary) {
      setStale(false);
      return;
    }
    let cancelled = false;
    readSkillFile(skill.source_path)
      .then((text) => sha256Hex(text))
      .then((hash) => {
        if (!cancelled) setStale(hash !== summary.source_hash);
      })
      .catch(() => {
        /* 读不到正文不阻塞展示，按未失效处理 */
      });
    return () => {
      cancelled = true;
    };
  }, [skill.id, skill.source_path, summary]);

  // LLM Key 状态（仅无速览时影响入口可用性）
  useEffect(() => {
    loadLLMConfig()
      .then((c) => setHasLLMKey(c.hasKey))
      .catch(() => setHasLLMKey(false));
  }, [skill.id]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    let cfg = { hasKey: false };
    try {
      cfg = await loadLLMConfig();
    } catch {
      /* 按未配置处理 */
    }
    if (!cfg.hasKey) {
      toast.error("请先在设置中配置 API Key");
      onSettingsOpen?.();
      return;
    }
    setGenerating(true);
    setStreamText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const raw = await readSkillFile(skill.source_path);
      await summaries.generate(skill.id, raw, (delta) => {
        setStreamText((prev) => prev + delta);
      }, controller.signal);
      toast.success("用途速览已生成");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.info("已停止生成速览");
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setGenerating(false);
      setStreamText("");
      abortRef.current = null;
    }
  }, [generating, skill.id, skill.source_path, summaries, onSettingsOpen]);

  // ---- 手动编辑：三段文本框 + 保存 / 取消 ----
  if (editing) {
    return (
      <div className="mb-5 rounded-[12px] border border-stroke bg-glass p-4">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-text-primary">
            ✏️ 编辑用途速览
          </span>
          <span className="text-[10.5px] text-text-tertiary">（手动填写，不依赖 AI）</span>
        </div>
        <div className="space-y-2">
          {ROWS.map(({ key, icon, label }) => (
            <div key={key}>
              <div className="mb-0.5 text-[11px] text-text-secondary">
                {icon} <span className="text-text-secondary">{label}</span>
              </div>
              <textarea
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                rows={2}
                placeholder={`填写「${label}」…`}
                className="w-full resize-y rounded-md border border-stroke bg-glass-2 px-2 py-1.5 text-[12px] leading-relaxed text-text-primary outline-none transition-colors focus:border-stroke-hi"
              />
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button type="button" className="mbtn" onClick={() => setEditing(false)}>
            取消
          </button>
          <button type="button" className="mbtn primary" onClick={saveEdit}>
            保存
          </button>
        </div>
      </div>
    );
  }

  // ---- 生成中：流式展示原始输出 ----
  if (generating) {
    return (
      <div className="mb-5 rounded-[12px] border border-stroke bg-glass p-4">
        <div className="flex items-center gap-2 text-[12.5px] text-text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
          正在解析用途速览…
        </div>
        {streamText && (
          <pre className="mt-2 max-h-[120px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-tertiary">
            {streamText}
          </pre>
        )}
      </div>
    );
  }

  // ---- 有速览：三段式展示 ----
  if (summary) {
    return (
      <div className="mb-5 rounded-[12px] border border-stroke bg-glass p-4">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-text-primary">
            🧭 用途速览
          </span>
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber/50 bg-amber/10 px-2 py-px text-[10.5px] text-amber">
              ⚠️ 内容已变化，速览可能过时
            </span>
          )}
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-tertiary transition-colors hover:text-text-primary"
            title="手动编辑速览"
          >
            <Pencil className="h-3 w-3" />
            编辑
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-tertiary transition-colors hover:text-text-primary"
            title="重新生成速览"
          >
            <RefreshCw className="h-3 w-3" />
            重新生成
          </button>
        </div>
        <div className="space-y-1.5">
          {ROWS.map(({ key, icon, label }) => (
            <div key={key} className="flex gap-2 text-[12.5px] leading-relaxed">
              <span className="shrink-0 text-text-tertiary">
                {icon} <span className="text-text-secondary">{label}</span>
              </span>
              <span className="min-w-0 flex-1 text-text-primary">
                {summary[key] || "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- 无速览：生成入口 ----
  const disabled = hasLLMKey === false;
  return (
    <div className="mb-5 flex items-center gap-3 rounded-[12px] border border-dashed border-stroke bg-glass px-4 py-3">
      <Sparkles className="h-4 w-4 shrink-0 text-text-tertiary" />
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-text-tertiary">
        {disabled
          ? "配置 LLM Key 后可一键生成，也可以直接手动填写三段式速览"
          : "AI 解析 SKILL.md 生成三段式用途速览，也可以直接手动填写"}
      </p>
      <button
        type="button"
        className="mbtn shrink-0"
        onClick={startEdit}
        title="手动填写或编辑速览"
      >
        <Pencil className="h-3.5 w-3.5" />
        手动填写
      </button>
      <button
        type="button"
        className="mbtn shrink-0"
        onClick={disabled ? onSettingsOpen : handleGenerate}
      >
        {disabled ? "去配置" : "生成速览"}
      </button>
    </div>
  );
}
