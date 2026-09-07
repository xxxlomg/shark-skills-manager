import type { TagsData } from "@/lib/api";

/**
 * mock 标签数据（工作流 T，?mock=1 预览用）。
 * 内置四标签（开发/生图/媒体/效率）+ 一个自定义标签示例；
 * 挂载示例落在 builtin 两个演示技能上。
 */
export const MOCK_TAGS: TagsData = {
  version: 1,
  tags: {
    "t-dev": { name: "开发", builtin: true },
    "t-image": { name: "生图", builtin: true },
    "t-media": { name: "媒体", builtin: true },
    "t-eff": { name: "效率", builtin: true },
    "t-demo1": { name: "演示专用", builtin: false },
  },
  assignments: {
    "skill:b1": ["t-eff", "t-demo1"],
    "skill:b2": ["t-eff"],
  },
};
