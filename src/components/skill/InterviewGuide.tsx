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
  type AgentAction,
  type InterviewMessage,
  type InterviewOption,
} from "@/lib/interview-engine";
import { interviewAgentTurn } from "@/lib/authoring-api";
import { skillCreatorInfo, skillCreatorRead } from "@/lib/api";

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

export function InterviewGuide({
  description,
  onComplete,
  onSkip,
  busy,
}: InterviewGuideProps) {
  const engineRef = useRef<InterviewEngine | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [currentQ, setCurrentQ] = useState<CurrentQ | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const [readingFile, setReadingFile] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // 渐进披露知识库：SKILL.md（基础）+ AI 按需读取的 references
  const knowledgeRef = useRef<string>("");
  const referencesRef = useRef<Array<{ rel_path: string; title: string }>>([]);

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
    (async () => {
      try {
        const info = await skillCreatorInfo();
        if (info) {
          knowledgeRef.current = info.skill_md;
          referencesRef.current = info.references.map((r) => ({ rel_path: r.rel_path, title: r.title }));
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
        .map((r) => `- ${r.rel_path}（${r.title}）`)
        .join("\n") || "（无）",
      // 已问过的主题（最近几条 AI 问题），供 prompt 防重复
      askedTopics: e.messages
        .filter((m) => m.role === "assistant")
        .slice(-6)
        .map((m) => m.content)
        .join(" | "),
      duplicateHint,
    };
  }, [description]);

  /** Agentic 主循环：read→回注→ask→去重→done */
  const agentLoop = useCallback(async (duplicateHint?: string, dupRetry = 0) => {
    const e = engineRef.current;
    if (!e) return;
    setThinking(true);
    try {
      let reads = 0;
      let hint = duplicateHint;
      // 内层循环处理连续的 read 动作（渐进披露）
      for (;;) {
        const act: AgentAction = await interviewAgentTurn(buildOpts(hint));

        if (act.action === "read" && act.path && reads < MAX_READS_PER_TURN && !e.loadedFiles.has(act.path)) {
          reads++;
          setReadingFile(act.path);
          try {
            const content = await skillCreatorRead(act.path);
            knowledgeRef.current += `\n\n【${act.path}】\n${content}`;
            e.loadedFiles.add(act.path);
            e.pushSystem(`已加载规范：${act.path}`);
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
          {thinking && !readingFile && (
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
            {currentQ.options.map((opt) => (
              <button
                key={opt.label}
                type="button"
                disabled={busy || thinking}
                onClick={() => submitAnswer(opt.label)}
                className={cn(
                  "rounded-md border border-border/50 bg-glass-1 px-2.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-text-primary",
                  opt.recommended && "border-primary/30 bg-primary/5",
                )}
              >
                {opt.label}
                {opt.recommended && <span className="ml-1 text-[9px] text-primary">推荐</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && inputValue.trim()) submitAnswer(inputValue.trim()); }}
            placeholder="用自然语言回答…"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-[12px] outline-none placeholder:text-text-tertiary/70 focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          <Button type="button" size="sm" className="h-8 w-8 shrink-0 p-0" disabled={!inputValue.trim() || thinking || busy} onClick={() => submitAnswer(inputValue.trim())}>
            <Send className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[11px] text-text-tertiary" disabled={thinking || busy} onClick={handleSkip} title="跳过此问题">
            <SkipForward className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">AI 按 shark-skill-creator 规范动态提问</span>
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
      <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed", isAI ? "bg-glass-1 text-text-primary" : "bg-primary/10 text-text-primary")}>
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
