import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Send,
  SkipForward,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  InterviewEngine,
  STAGE_LABELS,
  type InterviewMessage,
  type InterviewOption,
} from "@/lib/interview-engine";
import { interviewAgentTurn, resetInterviewAgentState } from "@/lib/authoring-api";
import { skillCreatorInfo, skillCreatorRead } from "@/lib/api";
import type { SessionEvent } from "@/lib/session-store";
import { ThinkingBlock } from "./ThinkingBlock";

/**
 * Agentic 对话式访谈组件（shark-skill-creator 协议，v3）。
 *
 * 与 v2 的根本区别：
 * - 无固定问题模板。问题 100% 由 LLM 基于用户描述动态生成。
 * - 渐进披露：AI 可 action=read 读取后端 references，前端回注后继续推理。
 * - 前端去重：相同主题不重复提问（isDuplicate + duplicateHint 重试）。
 * - 严格一问一答；选项 + 自由输入双通道。
 */

interface InterviewGuideProps {
  description: string;
  onComplete: (structuredContext: string) => void;
  onSkip: () => void;
  busy?: boolean;
  /** 会话事件回写（事件溯源：访谈消息落盘；不传则不记录） */
  onRecord?: (ev: SessionEvent) => void;
  /** 历史对话（会话恢复）：预填引擎消息，AI 基于既有上下文继续 */
  initialMessages?: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}

const MAX_READS_PER_TURN = 4; // 单轮最多读取文件数，防死循环
const MAX_DUP_RETRY = 2; // 重复问题最多重试次数

interface CurrentQ {
  question: string;
  options?: InterviewOption[];
  field?: string;
  stage: InterviewMessage["stage"];
  analysis?: string;
}

/**
 * 剥离选项末尾的 UI 提示标签（如「（推荐）」）：发送与展示都不携带冗余标识，
 * 保证对话气泡、会话持久化与回溯内容干净。
 */
function stripRecommendTag(label: string): string {
  return label.replace(/[（(]\s*推荐\s*[）)]\s*$/g, "").trim();
}

/**
 * 自由输入引导项判定：「其他 / 其它 / 自定义」类选项是提示去输入框手动输入的，
 * 不作为消息直接发送（避免把引导语全文送进对话历史）。
 */
function isFreeformOption(label: string): boolean {
  return /(其他|其它|自定义)/.test(label);
}

export function InterviewGuide({
  description,
  onComplete,
  onSkip,
  busy,
  onRecord,
  initialMessages,
}: InterviewGuideProps) {
  const engineRef = useRef<InterviewEngine | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [currentQ, setCurrentQ] = useState<CurrentQ | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputPlaceholder, setInputPlaceholder] = useState("用自然语言回答…");
  const [thinking, setThinking] = useState(false);
  const [reasoningText, setReasoningText] = useState("");
  const [reasoningDone, setReasoningDone] = useState(false);
  // 本轮思考全文 ref（onThinking 逐块累积；pushAssistant 时随 assistant_msg 事件持久化）
  const reasoningRef = useRef("");
  const [readingFile, setReadingFile] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  /** 降级提示只播一次（本轮会话内） */
  const degradedNotifiedRef = useRef(false);

  // 渐进披露知识库：骨架（summary）+ AI 按需读取的 references 全文
  const knowledgeRef = useRef<string>("");
  const referencesRef = useRef<Array<{ rel_path: string; title: string; purpose?: string }>>([]);

  const sync = () => {
    const e = engineRef.current;
    if (e) {
      setMessages([...e.messages]);
      setProgress(e.progress);
    }
  };

  // 初始化：加载 SKILL.md + 参考清单，启动 Agent 循环
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const engine = new InterviewEngine(description);
    engineRef.current = engine;
    // 会话恢复：预填历史对话消息（AI 基于既有上下文继续；思考过程已在面板侧随消息展示）
    for (const im of initialMessages ?? []) {
      if (im.role === "user") engine.pushUser(im.content);
      else if (im.role === "assistant") engine.pushAssistant(im.content, undefined, "discover");
    }
    // 每场访谈重置连续失败计数：不把上一场的失败带过来（防永久降级）
    resetInterviewAgentState();
    (async () => {
      try {
        const info = await skillCreatorInfo();
        if (info) {
          // 首轮只注入压缩骨架（规范全文按需 read 回注，渐进披露）
          knowledgeRef.current = info.summary?.trim() || info.skill_md;
          referencesRef.current = info.references.map((r) => ({
            rel_path: r.rel_path,
            title: r.title,
            purpose: r.purpose,
          }));
        }
      } catch { /* 规范缺失时降级 */ }
      void agentLoop();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, readingFile]);

  const buildOpts = useCallback((duplicateHint?: string) => {
    const e = engineRef.current!;
    return {
      description,
      // 全量对话转录（Agentic 循环的完整上下文）
      history: e.fullTranscript(),
      // 用户最新回复：AI 据此生成跟进问题（动态追问的核心）
      latestReply: e.latestUserReply(),
      // 已完成的问答轮数
      turnCount: e.messages.filter((m) => m.role === "user").length,
      collectedJson: JSON.stringify(e.collected),
      loadedKnowledge: knowledgeRef.current,
      availableReferences: referencesRef.current
        .map((r) => `- ${r.rel_path}${r.purpose ? `（${r.purpose}）` : ""}`)
        .join("\n") || "（无）",
      // 已问过的主题（最近几条 AI 问题），供 prompt 防重复
      askedTopics: e.messages
        .filter((m) => m.role === "assistant")
        .slice(-6)
        .map((m) => m.content)
        .join(" | "),
      // T4：会话真实消息数组（结构化多轮，system 层外置）
      llmMessages: e.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        })),
      duplicateHint,
    };
  }, [description]);

  /** Agentic 主循环：read→回注→ask→去重→done */
  const agentLoop = useCallback(async (duplicateHint?: string, dupRetry = 0) => {
    const e = engineRef.current;
    if (!e) return;
    setThinking(true);
    // 每轮开始：清空上一轮思考视觉（仅内存，不持久化）
    setReasoningText("");
    setReasoningDone(false);
    reasoningRef.current = "";
    try {
      let reads = 0;
      let hint = duplicateHint;
      // 内层循环处理连续的 read 动作（渐进披露）
      for (;;) {
        const res = await interviewAgentTurn({
          ...buildOpts(hint),
          onThinking: (d) => {
            reasoningRef.current += d;
            setReasoningText((s) => s + d);
          },
        });
        const act = res.action;
        // 本轮回合并结束：思考自动收起（ThinkingBlock 响应 active 变化）
        setReasoningDone(true);

        // 降级明示：连续失败已切换本地引导（仅提示一次）
        if (res.degraded && !degradedNotifiedRef.current) {
          degradedNotifiedRef.current = true;
          e.pushSystem("⚠️ AI 暂不可用（连续失败），已切换本地引导。可在设置页检查 LLM 连接。");
          sync();
        }

        if (act.action === "read" && act.path && reads < MAX_READS_PER_TURN && !e.loadedFiles.has(act.path)) {
          reads++;
          setReadingFile(act.path);
          try {
            const content = await skillCreatorRead(act.path);
            knowledgeRef.current += `\n\n【${act.path}】\n${content}`;
            e.loadedFiles.add(act.path);
            e.pushSystem(`已加载规范：${act.path}`);
            onRecord?.({ kind: "tool_read", content, extra: { file: act.path } });
            sync();
          } catch {
            e.loadedFiles.add(act.path); // 读取失败也标记，避免反复尝试
          }
          setReadingFile(null);
          hint = undefined;
          continue; // 回注后让 AI 继续推理
        }

        if (act.action === "done") {
          handleReady();
          return;
        }

        // 边界控制：即使 LLM 仍想追问，只要信息充分或达到轮数上限就强制收敛
        if (e.shouldTerminate()) {
          handleReady();
          return;
        }

        // action === ask
        const question = (act.question || "").trim();
        if (!question) { handleReady(); return; }

        // 前端去重：重复则要求 AI 换主题（有限次）
        if (e.isDuplicate(question) && dupRetry < MAX_DUP_RETRY) {
          hint = "上一个问题与已问主题重复，请换一个新的维度提问。";
          dupRetry++;
          continue;
        }

        e.markAsked(question);
        e.pushAssistant(question, act.options, act.stage || "discover");
        // 新问题就位：输入框提示词复位（上轮「自由输入」引导已失效）
        setInputPlaceholder("用自然语言回答…");
        // 思考过程持久化：作为 assistant 消息的 reasoning 附注进会话事件日志
        // （res.thinking 与 reasoningRef 双源，任一非空即记录）
        const reasoning = reasoningRef.current || res.thinking || "";
        onRecord?.({
          kind: "assistant_msg",
          content: question,
          extra: reasoning ? { reasoning } : undefined,
        });
        e.currentQuestion = { question, options: act.options, field: act.field, stage: act.stage || "discover" };
        setCurrentQ({ question, options: act.options, field: act.field, stage: act.stage || "discover", analysis: act.analysis });
        sync();
        return;
      }
    } catch {
      // AI 调用失败：提示并允许重试，不输出固定模板
      e.pushSystem("AI 响应异常，请点击下方输入框自由补充，或跳过。");
      sync();
    } finally {
      setThinking(false);
      setReadingFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildOpts]);

  const handleReady = () => {
    const e = engineRef.current;
    if (!e) return;
    e.pushSystem("信息收集完成，正在综合全部对话生成技能正文…");
    sync();
    setCurrentQ(null);
    // 综合结构化信息 + 完整对话转录，供生成 Prompt 全量参考
    const context = `${e.buildStructuredContext()}\n\n【完整访谈记录】\n${e.fullTranscript()}`;
    setTimeout(() => onComplete(context), 500);
  };

  /** 用户提交回答 → 记录 → 再次进入 Agent 循环 */
  const submitAnswer = (answer: string) => {
    const e = engineRef.current;
    if (!e || !currentQ || thinking) return;
    setInputValue("");
    e.pushUser(answer, currentQ.stage);
    e.recordAnswer(answer, currentQ.field);
    onRecord?.({ kind: "user_msg", content: answer });
    setCurrentQ(null);
    sync();
    void agentLoop();
  };

  /** 跳过当前问题 */
  const handleSkip = () => {
    const e = engineRef.current;
    if (!e || thinking) return;
    if (currentQ) {
      e.markAsked(currentQ.question);
      e.pushSystem("（已跳过）");
    }
    setCurrentQ(null);
    sync();
    void agentLoop();
  };

  const summary = engineRef.current?.summary ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部：阶段 + 进度 */}
      <div className="shrink-0 border-b border-border/30 px-4 py-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
            <Bot className="h-3.5 w-3.5 text-primary" />
            {currentQ ? STAGE_LABELS[currentQ.stage] : "AI 解析意图中…"}
          </span>
          <span className="font-mono text-[10px] text-text-tertiary">{progress}%</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-glass-2">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(progress, 5)}%` }} />
        </div>
      </div>

      {/* 对话区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {readingFile && (
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
              <FileText className="h-3 w-3 text-primary" />
              正在读取规范：{readingFile}…
            </div>
          )}
          <ThinkingBlock thinking={reasoningText} active={thinking && !reasoningDone} />
          {thinking && !readingFile && (!reasoningText) && (
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI 正在分析你的描述…
            </div>
          )}
        </div>
      </div>

      {/* 当前问题选项 */}
      {currentQ && !thinking && currentQ.options && currentQ.options.length > 0 && (
        <div className="shrink-0 border-t border-border/30 px-4 py-2">
          <div className="flex flex-wrap gap-1.5">
            {currentQ.options.map((opt) => {
              const clean = stripRecommendTag(opt.label);
              const isFree = isFreeformOption(clean);
              return (
                <button
                  key={opt.label}
                  type="button"
                  disabled={busy || thinking}
                  onClick={() => {
                    if (isFree) {
                      // 自由输入引导：不发送，聚焦输入框等待用户手动输入
                      setInputValue("");
                      setInputPlaceholder("请输入你的自定义场景描述...");
                      requestAnimationFrame(() => inputRef.current?.focus());
                      return;
                    }
                    submitAnswer(clean);
                  }}
                  className={cn(
                    "rounded-md border border-border/50 bg-glass-1 px-2.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-text-primary",
                    opt.recommended && "border-primary/30 bg-primary/5",
                  )}
                >
                  {clean}
                  {opt.recommended && <span className="ml-1 text-[9px] text-primary">推荐</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && inputValue.trim()) submitAnswer(inputValue.trim()); }}
            placeholder={inputPlaceholder}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-[12px] outline-none placeholder:text-text-tertiary/70 focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          <Button type="button" size="sm" className="h-8 w-8 shrink-0 p-0" disabled={!inputValue.trim() || thinking || busy} onClick={() => submitAnswer(inputValue.trim())}>
            <Send className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[11px] text-text-tertiary" disabled={thinking || busy} onClick={handleSkip} title="跳过此问题">
            <SkipForward className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-end">
          <button type="button" className="text-[10px] text-text-tertiary underline hover:text-text-secondary" onClick={onSkip}>
            跳过全部，直接生成
          </button>
        </div>
      </div>

      {/* 已收集维度 */}
      {summary.some((s) => s.done) && (
        <div className="shrink-0 border-t border-border/30 px-4 py-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {summary.filter((s) => s.done).map((s) => (
              <span key={s.label} className="flex items-center gap-1 text-[10px] text-text-tertiary">
                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 消息气泡（纯文本，无模板推荐区） */
function MessageBubble({ msg }: { msg: InterviewMessage }) {
  if (msg.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-glass-2 px-3 py-1 text-[10px] text-text-tertiary">{msg.content}</span>
      </div>
    );
  }
  const isAI = msg.role === "assistant";
  return (
    <div className={cn("flex gap-2", isAI ? "justify-start" : "justify-end")}>
      {isAI && (
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10">
          <Bot className="h-3 w-3 text-primary" />
        </span>
      )}
      <div className={cn("anim-jelly-in max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed", isAI ? "bg-glass-1 text-text-primary" : "bg-primary/10 text-text-primary")}>
        <p className="whitespace-pre-line">{msg.content}</p>
      </div>
      {!isAI && (
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-glass-2">
          <User className="h-3 w-3 text-text-tertiary" />
        </span>
      )}
    </div>
  );
}
