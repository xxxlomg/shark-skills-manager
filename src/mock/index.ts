/**
 * Mock 数据统一出口（约定：前端所有 mock 数据只存在于本文件夹）。
 *
 * - mode.ts         开关（?mock=1）
 * - skills.ts       技能列表（MOCK_SKILLS）
 * - packs.ts        技能包（MOCK_PACKS）
 * - tools.ts        工具注册表（MOCK_TOOLS，可变数组支撑 CRUD 闭环）
 * - links.ts        引用台账（MOCK_LINKS，可变数组）
 * - translations.ts 原文/译文/双语样本
 * - shelf.ts        模块 A 货架浏览样本（MOCK_SHELF）
 * - validation.ts   C3 校验矩阵样本（mockValidationReport）
 * - files.ts        W4 附带资源文件树（内存态）
 * - tags.ts         T 标签数据（MOCK_TAGS）
 * - summaries.ts    S 用途速览（MOCK_SUMMARIES）
 * - dupdemo.ts      M 阶段 2 查重演示（MOCK_DUP_GROUPS + dupDemoFile）
 * - creator.ts      内置 shark-skill-creator 定义样本（MOCK_CREATOR_INFO + MOCK_CREATOR_DOCS）
 *
 * 新增 mock 数据一律落本文件夹，禁止散落在组件或 hooks 里。
 * 后端 mock/测试 fixture 归 frontend/src-tauri/mock/，与本目录互不引用。
 */
export { isMockMode } from "./mode";
export { MOCK_SKILLS } from "./skills";
export { MOCK_PACKS, MOCK_INSTALLS } from "./packs";
export { MOCK_TOOLS } from "./tools";
export { MOCK_LINKS, MOCK_LINKS_DEMO } from "./links";
export { MOCK_RAW, MOCK_TRANS, MOCK_BILINGUAL } from "./translations";
export { MOCK_SHELF } from "./shelf";
export { mockValidationReport } from "./validation";
export {
  mockFileTree,
  mockDeleteFile,
  mockWriteToTree,
  mockImportFile,
} from "./files";
export { MOCK_TAGS } from "./tags";
export { MOCK_SUMMARIES } from "./summaries";
export { MOCK_DUP_GROUPS, dupDemoFile } from "./dupdemo";
export { MOCK_CREATOR_INFO, MOCK_CREATOR_DOCS } from "./creator";
