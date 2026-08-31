import { useEffect, useRef, useState } from "react";
import { ThinkingBlock } from "./ThinkingBlock";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/common/Tip";
import { cn } from "@/lib/utils";
import type { InterviewMessage } from "@/lib/creation-state";

interface CreationGuidePanelProps {
  /** 「我的描述」单一输入（PLAN-11 阶段 0：description 即 purpose，无「何时用」）。 */
  description: string;
  bodyEmpty: boolean;
  busy: boolean;
  /** 对话式引导消息（用户想法 + AI 状态回执），状态由工作台持有、跨视图保留。 */
  messages: InterviewMessage[];
  onDescriptionChange: (value: string) => void;
  /** 发送一条想法并触发 AI 生成正文（等价于聊天发送）。 */
  onSend: (text: string) => void;
}

/** 空态趣味表情（黄色人脸系列 + 少量辅助表情） */
const FUN_EMOJIS = [
  "🧐", // 带着单片眼镜，仔细端详
  "🤔", // 思考脸
  "😎", // 酷酷的墨镜
  "😃", // 咧嘴笑
  "🙂", // 微微笑
  "😁", // 露齿笑
  "😌", // 如释重负
  "😏", // 坏笑
  "🤓", // 书呆子眼镜
  "🥳", // 庆祝彩带
  "🤩", // 星星眼
  "😊", // 害羞笑
  "😉", // 眨眼
  "😜", // 吐舌头
  "🤗", // 拥抱
  "🤫", // 嘘
  "🤭", // 捂嘴笑
  "🙃", // 倒立脸
  "😋", // 美味
  "😄", // 大笑
] as const;

/** 空态随机提示语（每次打开随机一条） */
const FUN_TIPS = [
  // 思考启发类
  "今天研究点什么？",
  "有什么新想法，随便聊聊？",
  "灵感来了吗？写下来再说",
  "想到就写，做出来才算",
  "换个角度，也许有惊喜",
  "别急着找答案，先问对问题",

  // 行动鼓励类
  "把重复的工作变成技能",
  "让 AI 成为你的工作方法",
  "给手头的事情做个标准化",
  "先完成，再完美",
  "动手试试，失败也是经验",
  "每天进步 1%，一年就是 37 倍",

  // 轻松逗趣类
  "有空发呆，不如来聊五毛钱的",
  "敲两行代码放松一下？",
  "据说聪明人都喜欢留白",
  "这里空空如也，等你的创意填满",
  "你瞅啥？等着你写点啥呢",

  // 自我对话类
  "你今天想解决什么问题？",
  "把模糊的想法变成清晰的文字",
  "用输出倒逼输入，试试看",
  "写点什么，让思维流动起来",
  "静下心来，和自己对个话",
  "别着急，好想法需要酝酿",

  // 未来展望类
  "未来的你会感谢现在的记录",
  "每一个伟大的项目都从空白页开始",
  "现在就是最好的开始时间",
] as const;

/**
 * 创作引导面板（Chat 版）：仿 shadcn Chat 布局——
 * 上方为可滚动的对话区（空态居中问候 + 用户/AI 气泡），
 * 下方为圆角输入组合框（自适应 textarea + 圆形发送按钮）。
 * 只保留核心引导：输入想法 → 发送生成正文；无正文时由工作台自动升级为对话式访谈。
 */
export function CreationGuidePanel({
  bodyEmpty,
  busy,
  messages,
  onDescriptionChange,
  onSend,
}: CreationGuidePanelProps) {
  // 输入框永远全新：不回显历史描述/已发送内容（历史对话与 description 由消息流承载）
  const [draft, setDraft] = useState("");
  // 每次打开随机一条欢迎语 + 一个黄色人脸表情
  const [welcome] = useState(() => {
    const emoji = FUN_EMOJIS[Math.floor(Math.random() * FUN_EMOJIS.length)];
    const tip = FUN_TIPS[Math.floor(Math.random() * FUN_TIPS.length)];
    return { emoji, tip };
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自适应高度（2 行 ~ 7 行）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // 新消息 / 生成中状态变化时追随到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  const canSend = draft.trim().length > 0 && !busy;

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onDescriptionChange(text);
    onSend(text);
    setDraft(""); // 发送即清空：输入框不回显已发送的 Skill 制作内容
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 对话区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border text-2xl">
              {welcome.emoji}
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {welcome.tip}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              描述你想要的技能，按发送交给 AI 生成正文。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {busy && <TypingIndicator />}
          </div>
        )}
      </div>

      {/* 输入组合框（shadcn Input Group 风格：圆角容器 + 圆形发送钮） */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              onDescriptionChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={
              bodyEmpty ? "描述你的技能想法…" : "补充新的想法，继续完善正文…"
            }
            aria-label="创作想法"
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <Tip side="top" label="Enter 发送 · Shift+Enter 换行">
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              disabled={!canSend}
              onClick={send}
              aria-label={bodyEmpty ? "生成正文" : "补充正文"}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </Tip>
        </div>
      </div>
    </div>
  );
}

/** 消息气泡：用户右对齐实心、AI 左对齐卡片态（shadcn Bubble 风格）。 */
function MessageBubble({ msg }: { msg: InterviewMessage }) {
  if (msg.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {msg.content}
        </span>
      </div>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "anim-jelly-in max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border/60 bg-card text-foreground shadow-sm",
        )}
      >
        <p className="whitespace-pre-line break-words">{msg.content}</p>
      </div>
      {!isUser && msg.reasoning && (
        <div className="max-w-[92%] min-w-[70%]">
          <ThinkingBlock thinking={msg.reasoning} active={false} />
        </div>
      )}
    </div>
  );
}

/** AI 生成中：三点跳动占位（Chat typing indicator）。 */
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border/60 bg-card px-3 py-2.5 shadow-sm">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
