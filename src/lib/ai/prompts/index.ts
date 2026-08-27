/**
 * prompt 统一出口：所有模块的 AI prompt 都在 @/lib/ai/prompts/ 下集中管理。
 * 新增模块 → 在此加类型化导出即可。
 */
export {
  buildTranslatePrompt,
  TRANSLATE_CHUNK_SIZE,
} from "./translate";
export {
  buildAuthoringPrompt,
  buildDescOptimizePrompt,
  buildDescRefineAnalyzePrompt,
  buildDescRefineApplyPrompt,
  buildContinueBodyPrompt,
  buildFileAssistPrompt,
  buildSkillReviewPrompt,
  buildSkillFixPrompt,
  buildInterviewNextQuestionPrompt,
  buildInterviewAgentPrompt,
} from "./authoring";
export { buildSkillSummaryPrompt, SUMMARY_INPUT_CAP } from "./summary";
export { buildMergePolishPrompt, MERGE_POLISH_INPUT_CAP } from "./merge";
