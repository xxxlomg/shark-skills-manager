import type { Skill } from "@/hooks/useSkills";

/** mock 技能工厂：对齐真实扫描结果的数据形态。 */
const mk = (
  id: string,
  name: string,
  emoji: string,
  desc: string,
  scan: string,
  opts: {
    zh?: string;
    dz?: string;
    trans?: boolean;
    otherSources?: string[];
    hubLinked?: boolean;
  } = {}
): Skill => ({
  id,
  name,
  folder_name: name,
  description: desc,
  emoji,
  scan_label: scan,
  source_path: `/mock/${scan}/${name}/SKILL.md`,
  skill_dir: `/mock/${scan}/${name}`,
  tool_id: scan === "builtin" ? "builtin" : scan.toLowerCase(),
  is_representative: true,
  other_sources: opts.otherSources ?? [],
  hub_linked: opts.hubLinked ?? false,
  hub_link_id: null,
  has_translation: opts.trans ?? false,
  translation_lost: false,
  title_zh: opts.zh ?? "",
  description_zh: opts.dz ?? "",
  source_deleted: false,
  parent_collection: null,
});

/**
 * mock 技能清单（?mock=1 预览用）。
 * 约定：只保留 builtin 两份「产品使用介绍与演示」技能，与真实 skills/ 目录对齐；
 * 其余工具的真实技能由扫描产生，不做 mock 演示，避免误导。
 */
export const MOCK_SKILLS: Skill[] = [
  mk(
    "b1",
    "skills-shark-quickstart",
    "🦈",
    "First-run guide for shark skills: configure scan sources, browse and search skills, set up an LLM, and produce bilingual (EN/ZH) translations.",
    "builtin",
    { zh: "快速上手", dz: "shark skills 首跑指南：配置扫描源、浏览检索技能、配置 LLM 并生成双语翻译。", trans: true, otherSources: ["claude-code", "codex"] }
  ),
  mk(
    "b2",
    "skills-shark-packs",
    "📦",
    "Create, export and share Skill Packs: bundle translated skills into a portable pack for teammates.",
    "builtin",
    { zh: "技能包分享", dz: "创建、导出并分享技能包：把已翻译技能打包，便捷分发给团队。", trans: true, otherSources: ["claude-code"] }
  ),
];
