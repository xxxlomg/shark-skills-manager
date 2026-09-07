/**
 * Agentic 对话式访谈引擎（shark-skill-creator 协议，v3）。
 *
 * 设计哲学（与 v2 的根本区别）：
 * - 引擎不再持有任何"问题模板"。问题 100% 由 LLM 基于内置规范动态生成。
 * - 引擎只负责：消息流、已收集的结构化信息、已问主题去重、上下文组装。
 * - 渐进披露：LLM 可通过 action=read 请求读取后端 references 文件，
 *   前端代为读取并回注，使 AI 像 Qoder 使用 skills 一样按需加载规范。
 *
 * 状态机（由 AI 驱动推进，非固定序列）：
 *   discover → scope → model → design → ready
 */

// ---------------------------------------------------------------------------
// 数据类型
// ---------------------------------------------------------------------------

export type InterviewStage = "discover" | "scope" | "model" | "design" | "ready";

/**
 * 访谈硬性轮数上限（边界控制）：无论 LLM 是否输出 done，
 * 达到该轮数后前端强制收敛进入生成，杜绝无限追问。
 */
export const MAX_INTERVIEW_TURNS = 7;

/** 规范要求的最低核心维度（skill-state-model：完成度由字段覆盖度计算） */
export const CORE_DIMENSIONS = ["goal", "workflow", "inputs", "outputs"] as const;

export const STAGE_LABELS: Record<InterviewStage, string> = {
  discover: "发现需求",
  scope: "定义边界",
  model: "结构化建模",
  design: "设计结构",
  ready: "信息充分",
};

export interface InterviewOption {
  /** 显示文本 = 提交值（统一中文语义） */
  label: string;
  recommended?: boolean;
}

export interface InterviewMessage {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  /** AI 本轮思考过程，随对应 assistant 消息保留，避免下一轮覆盖。 */
  reasoning?: string;
  options?: InterviewOption[];
  stage: InterviewStage;
  timestamp: number;
}

/** LLM 单轮返回的动作（Agentic 协议） */
export interface AgentAction {
  /** read=请求读取规范文件；ask=向用户提问；done=信息充分可生成 */
  action: "read" | "ask" | "done";
  /** action=read 时的目标 rel_path（references/ 或 scripts/ 下） */
  path?: string;
  /** action=ask 时的问题文本 */
  question?: string;
  /** action=ask 时的选项（中文 label） */
  options?: InterviewOption[];
  /** action=ask 时该回答映射到的 state 字段（可选） */
  field?: string;
  /** action=ask 时 AI 的简短分析（展示为 AI 的推理，非模板） */
  analysis?: string;
  /** 当前阶段 */
  stage?: InterviewStage;
}

// ---------------------------------------------------------------------------
// 引擎：纯状态容器 + 去重 + 上下文组装（无问题模板）
// ---------------------------------------------------------------------------

export class InterviewEngine {
  /** 用户初始描述 */
  readonly description: string;
  /** 对话消息流 */
  messages: InterviewMessage[] = [];
  /** 已收集的结构化信息（field → 用户回答） */
  collected: Record<string, string> = {};
  /** 自由补充信息（未映射到 field 的回答） */
  notes: string[] = [];
  /** 已问过的主题（问题文本归一化），用于前端去重防重复 */
  private askedTopics: Set<string> = new Set();
  /** 已读取的规范文件，避免重复 read */
  readonly loadedFiles: Set<string> = new Set();
  /** 当前待回答的问题 */
  currentQuestion: { question: string; options?: InterviewOption[]; field?: string; stage: InterviewStage } | null = null;
  private msgCounter = 0;

  constructor(description: string) {
    this.description = description.trim();
  }

  private nextMsgId(): string {
    return `m${++this.msgCounter}-${Date.now()}`;
  }

  pushAssistant(
    content: string,
    options?: InterviewOption[],
    stage: InterviewStage = "discover",
    reasoning?: string,
  ): InterviewMessage {
    const message: InterviewMessage = {
      id: this.nextMsgId(),
      role: "assistant",
      content,
      reasoning: reasoning?.trim() || undefined,
      options,
      stage,
      timestamp: Date.now(),
    };
    this.messages.push(message);
    return message;
  }

  pushUser(content: string, stage: InterviewStage = "discover"): void {
    this.messages.push({ id: this.nextMsgId(), role: "user", content, stage, timestamp: Date.now() });
  }

  pushSystem(content: string): void {
    this.messages.push({ id: this.nextMsgId(), role: "system", content, stage: "ready", timestamp: Date.now() });
  }

  /** 问题文本归一化（去标点/空白），用于去重 */
  private normalize(q: string): string {
    return q.replace(/[？?！!。.，,\s]/g, "").slice(0, 40);
  }

  /** 是否已问过相同主题 */
  isDuplicate(question: string): boolean {
    return this.askedTopics.has(this.normalize(question));
  }

  /** 记录一个已问问题 */
  markAsked(question: string): void {
    this.askedTopics.add(this.normalize(question));
  }

  /** 已问问题数量 */
  get askedCount(): number {
    return this.askedTopics.size;
  }

  /** 已完成的问答轮数（用户回复数） */
  get turnCount(): number {
    return this.messages.filter((m) => m.role === "user").length;
  }

  /** 详尽回答数（长度>60 的用户回复，视为单条覆盖多维度） */
  private get richAnswerCount(): number {
    return this.messages.filter((m) => m.role === "user" && m.content.trim().length > 60).length;
  }

  /**
   * 信息充分性检查（规范：完成度由字段覆盖度计算，不以 AI 返回成功为准）。
   * 满足任一即视为充分：
   *  1. 核心四要素（goal/workflow/inputs/outputs）全部覆盖；
   *  2. 核心≥2 且存在≥1 条详尽回答且轮数≥3（单条详答覆盖多维度）。
   */
  isSufficient(): boolean {
    const haveCore = CORE_DIMENSIONS.filter((f) => !!this.collected[f]).length;
    if (haveCore >= CORE_DIMENSIONS.length) return true;
    if (haveCore >= 2 && this.richAnswerCount >= 1 && this.turnCount >= 3) return true;
    return false;
  }

  /** 终止判定：信息充分 或 达到硬性轮数上限 → 必须收敛 */
  shouldTerminate(): boolean {
    return this.isSufficient() || this.turnCount >= MAX_INTERVIEW_TURNS;
  }

  /** 记录用户回答：映射到 field 或归入 notes */
  recordAnswer(answer: string, field?: string): void {
    if (field && field.trim()) {
      this.collected[field.trim()] = answer;
    } else {
      this.notes.push(answer);
    }
  }

  /** 用户最新一条回复（Agentic 循环的核心输入：AI 据此决定下一个问题） */
  latestUserReply(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") return this.messages[i].content;
    }
    return "";
  }

  /** 完整对话转录（AI/用户交替），供 LLM 全量上下文与结束时综合正文 */
  fullTranscript(): string {
    return this.messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "assistant" ? "AI" : "用户"}：${m.content}`)
      .join("\n");
  }

  /** 组装注入生成 Prompt 的结构化上下文 */
  buildStructuredContext(): string {
    const parts: string[] = [];
    if (this.description) parts.push(`用户初始描述：${this.description}`);
    for (const [k, v] of Object.entries(this.collected)) {
      parts.push(`${k}：${v}`);
    }
    if (this.notes.length) parts.push(`补充信息：${this.notes.join("；")}`);
    return parts.join("\n");
  }

  /** 收集进度（已收集字段数 → 百分比，用于 UI） */
  get progress(): number {
    const target = 6; // 目标收集维度数（goal/scope/workflow/inputs/outputs/guardrails）
    const got = Math.min(Object.keys(this.collected).length + (this.notes.length ? 1 : 0), target);
    return Math.round((got / target) * 100);
  }

  /** 已收集维度的可视化摘要 */
  get summary(): Array<{ label: string; done: boolean }> {
    const has = (f: string) => !!this.collected[f];
    return [
      { label: "目标", done: has("goal") || !!this.description },
      { label: "范围", done: has("scope") },
      { label: "工作流", done: has("workflow") },
      { label: "输入", done: has("inputs") },
      { label: "输出", done: has("outputs") },
      { label: "护栏", done: has("guardrails") },
    ];
  }
}
