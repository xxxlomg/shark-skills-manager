/**
 * Pure domain model for the Skill Creator workflow.
 *
 * This module deliberately has no React, storage, Tauri, or LLM dependency.
 * It is safe to use from persistence adapters, prompts, and UI selectors.
 */

export const CREATION_STATE_VERSION = 1 as const;

/** Seven stages from discovery through package delivery. */
export const CreationStage = {
  Discover: "discover",
  Scope: "scope",
  Model: "model",
  Design: "design",
  Generate: "generate",
  Evaluate: "evaluate",
  Package: "package",
} as const;

export type CreationStage = (typeof CreationStage)[keyof typeof CreationStage];

export const CREATION_STAGE_ORDER = [
  CreationStage.Discover,
  CreationStage.Scope,
  CreationStage.Model,
  CreationStage.Design,
  CreationStage.Generate,
  CreationStage.Evaluate,
  CreationStage.Package,
] as const satisfies readonly CreationStage[];

export type CreationStateStatus =
  | "draft"
  | "interviewing"
  | "generating"
  | "evaluating"
  | "ready"
  | "packaged";

export type InterviewRole = "user" | "assistant" | "system";

export interface InterviewMessage {
  id: string;
  role: InterviewRole;
  content: string;
}

/** Conversation state is kept separate from the structured artifact state. */
export interface Interview {
  messages: InterviewMessage[];
  currentQuestion: string;
  pendingStage: CreationStage | null;
  lastRecommendation: string;
}

export interface SkillIdentity {
  name: string;
  description: string;
  version: string;
  emoji: string;
}

export interface SkillProblem {
  userProblem: string;
  desiredOutcome: string;
  whySkillExists: string;
}

export interface SkillScope {
  goals: string[];
  inScope: string[];
  outOfScope: string[];
  escalationConditions: string[];
}

export interface SkillTrigger {
  phrases: string[];
  conditions: string[];
  negativeConditions: string[];
}

export interface SkillInputs {
  required: string[];
  optional: string[];
  followUpQuestions: string[];
}

export interface SkillOutputs {
  format: string;
  requiredSections: string[];
  validationRules: string[];
}

export interface SkillWorkflow {
  steps: string[];
  decisionPoints: string[];
  fallback: string[];
  escalation: string[];
}

export interface SkillModel {
  trigger: SkillTrigger;
  inputs: SkillInputs;
  outputs: SkillOutputs;
}

export interface SkillKnowledge {
  references: string[];
  knowledgeGaps: string[];
}

export interface SkillTools {
  mcp: string[];
  localTools: string[];
}

export interface SkillScripts {
  executableProcedures: string[];
  usageRules: string[];
}

export interface SkillAssets {
  resources: string[];
  templates: string[];
}

export interface SkillGuardrails {
  must: string[];
  mustNot: string[];
  uncertaintyPolicy: string;
}

export interface SkillExamples {
  good: string[];
  failure: string[];
}

export type EvaluationCaseKind =
  | "happy-path"
  | "edge-case"
  | "missing-information"
  | "failure-case"
  | "custom";

export type EvaluationResult = "pending" | "pass" | "fail" | "skipped";

export interface EvaluationCase {
  id: string;
  name: string;
  kind: EvaluationCaseKind;
  input: string;
  expectedBehavior: string;
  actualOutput: string;
  result: EvaluationResult;
  notes: string;
}

export type ValidationMode = "diagnostic" | "strict";
export type ValidationVerdict = "pass" | "warn" | "fail" | "unknown";

/** A normalized summary; individual rule payloads remain owned by validate.rs. */
export interface ValidationSummary {
  mode: ValidationMode;
  verdict: ValidationVerdict;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issueCount: number;
  checkedAt: string | null;
}

export interface SkillEvaluation {
  cases: EvaluationCase[];
  score: number | null;
  completed: boolean;
  notes: string;
}

export interface SkillArtifact {
  body: string;
  files: string[];
  generated: boolean;
}

export interface SkillPackaging {
  targetLocation: string;
  version: string;
  ready: boolean;
}

/**
 * Versioned, serializable state for the Skill Creator.
 * Empty arrays/strings are intentional: absence of user input must remain
 * distinguishable from an AI-inferred value.
 */
export interface SkillCreationState {
  schemaVersion: typeof CREATION_STATE_VERSION;
  id: string | null;
  status: CreationStateStatus;
  stage: CreationStage;
  identity: SkillIdentity;
  problem: SkillProblem;
  scope: SkillScope;
  model: SkillModel;
  workflow: SkillWorkflow;
  knowledge: SkillKnowledge;
  tools: SkillTools;
  scripts: SkillScripts;
  assets: SkillAssets;
  guardrails: SkillGuardrails;
  examples: SkillExamples;
  artifact: SkillArtifact;
  evaluation: SkillEvaluation;
  validation: ValidationSummary | null;
  packaging: SkillPackaging;
  interview: Interview;
}

export interface StageCompletion {
  stage: CreationStage;
  completed: number;
  total: number;
  ratio: number;
  complete: boolean;
}

export interface CreationProgress {
  stages: Record<CreationStage, StageCompletion>;
  completed: number;
  total: number;
  ratio: number;
}

export interface LegacyWbDraft {
  name?: string;
  desc?: string;
  purpose?: string;
  triggerKeywords?: string[];
  emoji?: string;
  body?: string;
}

export interface WbDraftMigrationOptions {
  id?: string | null;
  targetLocation?: string;
  version?: string;
}

/** Human-readable labels are kept out of the state so the persisted shape stays stable. */
export const CREATION_STAGE_LABELS: Record<CreationStage, string> = {
  [CreationStage.Discover]: "发现需求",
  [CreationStage.Scope]: "定义边界",
  [CreationStage.Model]: "结构化建模",
  [CreationStage.Design]: "设计 Skill",
  [CreationStage.Generate]: "生成产物",
  [CreationStage.Evaluate]: "评估质量",
  [CreationStage.Package]: "打包发布",
};

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

const hasText = (value: string): boolean => text(value).length > 0;
const hasItems = (value: readonly string[]): boolean => value.some(hasText);

const emptyValidation = (): ValidationSummary | null => null;

const emptyInterview = (): Interview => ({
  messages: [],
  currentQuestion: "",
  pendingStage: null,
  lastRecommendation: "",
});

/** Create a new state without carrying any assumptions from a previous draft. */
export function createDefaultCreationState(
  options: WbDraftMigrationOptions = {},
): SkillCreationState {
  const version = text(options.version) || "0.1.0";
  return {
    schemaVersion: CREATION_STATE_VERSION,
    id: options.id ?? null,
    status: "draft",
    stage: CreationStage.Discover,
    identity: {
      name: "",
      description: "",
      version,
      emoji: "🧩",
    },
    problem: {
      userProblem: "",
      desiredOutcome: "",
      whySkillExists: "",
    },
    scope: {
      goals: [],
      inScope: [],
      outOfScope: [],
      escalationConditions: [],
    },
    model: {
      trigger: {
        phrases: [],
        conditions: [],
        negativeConditions: [],
      },
      inputs: {
        required: [],
        optional: [],
        followUpQuestions: [],
      },
      outputs: {
        format: "",
        requiredSections: [],
        validationRules: [],
      },
    },
    workflow: {
      steps: [],
      decisionPoints: [],
      fallback: [],
      escalation: [],
    },
    knowledge: {
      references: [],
      knowledgeGaps: [],
    },
    tools: {
      mcp: [],
      localTools: [],
    },
    scripts: {
      executableProcedures: [],
      usageRules: [],
    },
    assets: {
      resources: [],
      templates: [],
    },
    guardrails: {
      must: [],
      mustNot: [],
      uncertaintyPolicy: "",
    },
    examples: {
      good: [],
      failure: [],
    },
    artifact: {
      body: "",
      files: [],
      generated: false,
    },
    evaluation: {
      cases: [],
      score: null,
      completed: false,
      notes: "",
    },
    validation: emptyValidation(),
    packaging: {
      targetLocation: text(options.targetLocation) || "authored",
      version,
      ready: false,
    },
    interview: emptyInterview(),
  };
}

/**
 * Migrate the current WbDraft shape into the structured state.
 *
 * This is intentionally a one-way, lossless-enough mapping for the fields the
 * old workbench actually owns. Unknown future fields are not guessed.
 */
export function migrateWbDraftToCreationState(
  draft: LegacyWbDraft,
  options: WbDraftMigrationOptions = {},
): SkillCreationState {
  const state = createDefaultCreationState(options);
  const name = text(draft.name);
  const description = text(draft.desc) || text(draft.purpose);
  const purpose = text(draft.purpose) || description;
  const body = typeof draft.body === "string" ? draft.body : "";
  const triggerKeywords = stringList(draft.triggerKeywords);

  state.identity.name = name;
  state.identity.description = description;
  state.identity.emoji = text(draft.emoji) || state.identity.emoji;
  state.problem.userProblem = purpose;
  state.scope.goals = purpose ? [purpose] : [];
  state.model.trigger.phrases = triggerKeywords;
  state.artifact.body = body;
  state.artifact.generated = hasText(body);

  state.stage = getCurrentStage(state);
  state.status = state.stage === CreationStage.Package ? "packaged" : "draft";
  return state;
}

/** Guard persisted JSON before allowing it to drive the Creator UI. */
export function isSkillCreationState(value: unknown): value is SkillCreationState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SkillCreationState>;
  const isRecord = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object";
  const hasArray = (parent: unknown, key: string): boolean =>
    isRecord(parent) && Array.isArray(parent[key]);
  const hasString = (parent: unknown, key: string): boolean =>
    isRecord(parent) && typeof parent[key] === "string";
  return (
    candidate.schemaVersion === CREATION_STATE_VERSION &&
    CREATION_STAGE_ORDER.includes(candidate.stage as CreationStage) &&
    isRecord(candidate.identity) &&
    hasString(candidate.identity, "name") &&
    hasString(candidate.identity, "description") &&
    isRecord(candidate.problem) &&
    hasString(candidate.problem, "userProblem") &&
    isRecord(candidate.scope) &&
    hasArray(candidate.scope, "goals") &&
    hasArray(candidate.scope, "inScope") &&
    hasArray(candidate.scope, "outOfScope") &&
    isRecord(candidate.model) &&
    isRecord(candidate.model.trigger) &&
    hasArray(candidate.model.trigger, "phrases") &&
    isRecord(candidate.artifact) &&
    hasString(candidate.artifact, "body") &&
    isRecord(candidate.evaluation) &&
    hasArray(candidate.evaluation, "cases") &&
    isRecord(candidate.interview) &&
    hasArray(candidate.interview, "messages")
  );
}

/**
 * Merge the editor's legacy-shaped draft into an existing structured state.
 * Interview/evaluation/validation data survives ordinary text edits; only the
 * artifact fields owned by the editor are refreshed.
 */
export function mergeWbDraftIntoCreationState(
  state: SkillCreationState,
  draft: LegacyWbDraft,
  options: WbDraftMigrationOptions = {},
): SkillCreationState {
  const migrated = migrateWbDraftToCreationState(draft, options);
  return {
    ...state,
    schemaVersion: CREATION_STATE_VERSION,
    id: state.id ?? migrated.id,
    identity: {
      ...state.identity,
      name: migrated.identity.name,
      description: migrated.identity.description,
      emoji: migrated.identity.emoji,
    },
    problem: {
      ...state.problem,
      userProblem: migrated.problem.userProblem,
    },
    scope: {
      ...state.scope,
      goals: migrated.scope.goals,
    },
    model: {
      ...state.model,
      trigger: {
        ...state.model.trigger,
        phrases: migrated.model.trigger.phrases,
      },
    },
    artifact: {
      ...state.artifact,
      body: migrated.artifact.body,
      generated: migrated.artifact.generated,
    },
    status: state.status === "packaged" ? "draft" : state.status,
    stage: state.stage,
    packaging: {
      ...state.packaging,
      targetLocation:
        options.targetLocation?.trim() || state.packaging.targetLocation,
      version: state.packaging.version || migrated.packaging.version,
    },
  };
}

type StageCheck = (state: SkillCreationState) => boolean;

const stageChecks: Record<CreationStage, readonly StageCheck[]> = {
  [CreationStage.Discover]: [
    (state) => hasText(state.problem.userProblem),
  ],
  [CreationStage.Scope]: [
    (state) => hasItems(state.scope.goals),
    (state) => hasItems(state.scope.inScope) || hasItems(state.scope.outOfScope),
  ],
  [CreationStage.Model]: [
    (state) =>
      hasItems(state.model.trigger.phrases) ||
      hasItems(state.model.trigger.conditions),
    (state) =>
      hasItems(state.model.inputs.required) ||
      hasItems(state.model.inputs.optional),
    (state) =>
      hasText(state.model.outputs.format) ||
      hasItems(state.model.outputs.requiredSections),
  ],
  [CreationStage.Design]: [
    (state) => hasItems(state.workflow.steps),
    (state) =>
      hasItems(state.knowledge.references) ||
      hasItems(state.scripts.executableProcedures) ||
      hasItems(state.assets.resources) ||
      hasItems(state.tools.mcp) ||
      hasItems(state.tools.localTools),
    (state) =>
      hasItems(state.guardrails.must) ||
      hasItems(state.guardrails.mustNot) ||
      hasText(state.guardrails.uncertaintyPolicy),
  ],
  [CreationStage.Generate]: [
    (state) => hasText(state.identity.name),
    (state) => hasText(state.identity.description),
    (state) => hasText(state.artifact.body),
  ],
  [CreationStage.Evaluate]: [
    (state) => state.evaluation.cases.length > 0,
    (state) => state.evaluation.completed,
  ],
  [CreationStage.Package]: [
    (state) => state.packaging.ready,
    (state) => state.validation?.verdict === "pass",
  ],
};

function completionFor(state: SkillCreationState, stage: CreationStage): StageCompletion {
  const checks = stageChecks[stage];
  const completed = checks.reduce(
    (count, check) => count + (check(state) ? 1 : 0),
    0,
  );
  const total = checks.length;
  return {
    stage,
    completed,
    total,
    ratio: total === 0 ? 0 : completed / total,
    complete: completed === total,
  };
}

export function getStageCompletion(
  state: SkillCreationState,
  stage: CreationStage,
): StageCompletion {
  return completionFor(state, stage);
}

export function isStageComplete(
  state: SkillCreationState,
  stage: CreationStage,
): boolean {
  return getStageCompletion(state, stage).complete;
}

export function getCreationProgress(state: SkillCreationState): CreationProgress {
  const stages = {} as Record<CreationStage, StageCompletion>;
  for (const stage of CREATION_STAGE_ORDER) {
    stages[stage] = completionFor(state, stage);
  }
  const completed = CREATION_STAGE_ORDER.reduce(
    (count, stage) => count + (stages[stage].complete ? 1 : 0),
    0,
  );
  return {
    stages,
    completed,
    total: CREATION_STAGE_ORDER.length,
    ratio: completed / CREATION_STAGE_ORDER.length,
  };
}

/** Return the first incomplete stage, or Package when all stages are complete. */
export function getCurrentStage(state: SkillCreationState): CreationStage {
  return (
    CREATION_STAGE_ORDER.find((stage) => !isStageComplete(state, stage)) ??
    CreationStage.Package
  );
}
