/**
 * 创作状态机测试（src/lib/creation-state.ts）。
 * 锁定旧草稿迁移与七阶段完成度计算——状态机是无 UI 事故的最后防线。
 */
import { describe, expect, it } from "vitest";
import {
  createDefaultCreationState,
  CreationStage,
  getCreationProgress,
  getCurrentStage,
  isSkillCreationState,
  migrateWbDraftToCreationState,
} from "../creation-state";

describe("migrateWbDraftToCreationState：旧草稿无损迁移", () => {
  it("旧字段映射到新模型对应域", () => {
    const s = migrateWbDraftToCreationState({
      name: "pdf-tool",
      desc: "处理 PDF",
      purpose: "把 PDF 转文本",
      triggerKeywords: ["pdf", "转换"],
      emoji: "📄",
      body: "# pdf-tool\n\n正文",
    });
    expect(s.identity.name).toBe("pdf-tool");
    expect(s.identity.description).toBe("处理 PDF");
    expect(s.identity.emoji).toBe("📄");
    expect(s.problem.userProblem).toBe("把 PDF 转文本");
    expect(s.model.trigger.phrases).toEqual(["pdf", "转换"]);
    expect(s.artifact.body).toBe("# pdf-tool\n\n正文");
    expect(s.artifact.generated).toBe(true);
  });

  it("缺失字段补默认，不抛错", () => {
    const s = migrateWbDraftToCreationState({ name: "x" });
    expect(s.schemaVersion).toBe(1);
    expect(s.identity.emoji).toBe("🧩");
    expect(s.interview.messages).toEqual([]);
  });
});

describe("阶段完成度与当前阶段", () => {
  it("空状态停在第 0 阶段 Discover 且未完成", () => {
    const s = createDefaultCreationState({});
    expect(getCurrentStage(s)).toBe(CreationStage.Discover);
    expect(getCreationProgress(s).completed).toBe(0);
  });

  it("填写 problem 后推进到 Scope", () => {
    const s = createDefaultCreationState({});
    s.problem.userProblem = "想做一个技能";
    expect(getCurrentStage(s)).toBe(CreationStage.Scope);
  });

  it("填满 Discover~Generate 后进入 Evaluate", () => {
    const s = createDefaultCreationState({});
    s.problem.userProblem = "p";
    s.scope.goals = ["g"];
    s.scope.inScope = ["i"];
    s.model.trigger.phrases = ["t"];
    s.model.inputs.required = ["in"];
    s.model.outputs.format = "md";
    s.workflow.steps = ["w"];
    s.knowledge.references = ["references/guide.md"];
    s.guardrails.must = ["m"];
    s.identity.name = "demo";
    s.identity.description = "d";
    s.artifact.body = "b";
    expect(getCurrentStage(s)).toBe(CreationStage.Evaluate);
  });

  it("全阶段完成时回落 Package", () => {
    const s = createDefaultCreationState({});
    s.problem.userProblem = "p";
    s.scope.goals = ["g"];
    s.scope.inScope = ["i"];
    s.model.trigger.phrases = ["t"];
    s.model.inputs.required = ["in"];
    s.model.outputs.format = "md";
    s.workflow.steps = ["w"];
    s.knowledge.references = ["references/guide.md"];
    s.guardrails.must = ["m"];
    s.identity.name = "demo";
    s.identity.description = "d";
    s.artifact.body = "b";
    s.evaluation.cases = [
      { id: "c1", name: "happy", kind: "happy-path", input: "x", expectedBehavior: "y", actualOutput: "", result: "pass", notes: "" },
    ];
    s.evaluation.completed = true;
    s.packaging.ready = true;
    s.validation = {
      mode: "strict",
      verdict: "pass",
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      issueCount: 0,
      checkedAt: null,
    };
    expect(getCurrentStage(s)).toBe(CreationStage.Package);
    expect(getCreationProgress(s).completed).toBe(7);
  });
});

describe("isSkillCreationState：持久化守卫", () => {
  it("合法状态通过", () => {
    expect(isSkillCreationState(createDefaultCreationState({}))).toBe(true);
  });
  it("版本不符 / 缺核心字段拒绝", () => {
    const s = createDefaultCreationState({}) as unknown as Record<string, unknown>;
    expect(isSkillCreationState({ ...s, schemaVersion: 99 })).toBe(false);
    expect(isSkillCreationState({ ...s, identity: undefined })).toBe(false);
    expect(isSkillCreationState(null)).toBe(false);
    expect(isSkillCreationState("nope")).toBe(false);
  });
});