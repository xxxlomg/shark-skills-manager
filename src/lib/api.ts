/**
 * 统一 API 封装 — 全部走 Tauri invoke
 * 不再使用 fetch / HTTP
 */

import { invoke } from "@tauri-apps/api/core";
import {
  isMockMode,
  MOCK_PACKS,
  MOCK_INSTALLS,
  MOCK_RAW,
  MOCK_TOOLS,
  MOCK_LINKS,
  MOCK_LINKS_DEMO,
  MOCK_SHELF,
  MOCK_SKILLS,
  MOCK_SUMMARIES,
  MOCK_TAGS,
  MOCK_DUP_GROUPS,
  MOCK_CREATOR_INFO,
  MOCK_CREATOR_DOCS,
  dupDemoFile,
  mockDeleteFile,
  mockFileTree,
  mockImportFile,
  mockValidationReport,
  mockWriteToTree,
} from "@/mock";

// ---------------------------------------------------------------------------
// 类型（与 Rust 端对齐）
// ---------------------------------------------------------------------------

export interface Skill {
  id: string;
  name: string;
  folder_name: string;
  description: string;
  emoji: string | null;
  scan_label: string;
  source_path: string;
  /** v0.2（B4）：实际扫描到的技能目录（junction 落点不穿透，hub 操作锚点） */
  skill_dir: string;
  /** 来源工具注册表 id（builtin / imported / custom-xxx / claude-code 等） */
  tool_id: string;
  /** 同名组代表卡片（B4 代表选取：tools 顺序即优先级） */
  is_representative: boolean;
  /** 其他持有同名技能的工具 id 列表（扫描聚合元数据，不直接用于卡片展示） */
  other_sources: string[];
  /** 该目录是 junction（hub link 落点） */
  hub_linked: boolean;
  /** 账本中对应的 link id（供解除引用/转副本） */
  hub_link_id: string | null;
  has_translation: boolean;
  /** 元数据在但译文 .md 丢失/为空（状态已降级为待翻译，此标记驱动丢失提示） */
  translation_lost: boolean;
  title_zh: string;
  description_zh: string;
  source_deleted: boolean;
  parent_collection: string | null;
}

export interface MaskedLLM {
  api_key: string;
  base_url: string;
  model: string;
  /** 思考模式 enabled/disabled（非敏感，脱敏配置中原样透出） */
  thinking: string;
  /** 思考强度 low/high/max */
  reasoning_effort: string;
}

export interface MaskedConfig {
  llm: MaskedLLM;
  _has_key: boolean;
  /** 发布仓库配置（未设置为 null） */
  publish_repo: { local_path: string; remote_url: string } | null;
  /** 当前生效的下载/导入目录 */
  download_dir: string;
  /** AI 引导是否已永久关闭（点过一次 AI 创作后不再弹） */
  ai_hint_dismissed: boolean;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** 扫描所有 enabled 路径，返回 skill 列表 */
export function scanSkills(): Promise<Skill[]> {
  if (isMockMode()) return Promise.resolve([...MOCK_SKILLS]);
  return invoke<Skill[]>("scan_skills");
}

/**
 * 技能库层级结构树文本：扫描根 → 技能单元/技能包 → 子技能 → 资源文件及类型。
 * 供「层级结构」视图校验扫描映射是否与磁盘真实结构一致。
 */
export function scanSkillsTree(): Promise<string> {
  if (isMockMode()) {
    return Promise.resolve(
      [
        "C:\\mock\\builtin  (示例技能 / builtin)",
        "├─ skills-shark-packs\\  [技能 · skills-shark-packs]",
        "│  ├─ SKILL.md  [技能说明]",
        "│  └─ scripts\\  [集合]",
        "│     └─ pack-helper.py  [脚本]",
        "└─ skills-shark-quickstart\\  [技能 · skills-shark-quickstart]",
        "   ├─ SKILL.md  [技能说明]",
        "   └─ references\\  [集合]",
        "      └─ quickstart-guide.md  [文档]",
        "",
      ].join("\n")
    );
  }
  return invoke<string>("scan_skills_tree");
}

// ---------------------------------------------------------------------------
// 技能库文件管理器树：与 Rust ScanTreeFile/ScanTreeNode/LibraryTreeRoot 对齐
// ---------------------------------------------------------------------------

export interface LibTreeFile {
  name: string;
  rel: string;
  kind: string;
  abs_path: string;
}

export interface LibTreeNode {
  name: string;
  rel: string;
  is_skill: boolean;
  is_pack: boolean;
  skill_id: string | null;
  skill_name: string | null;
  description: string | null;
  files: LibTreeFile[];
  children: LibTreeNode[];
}

export interface LibraryTreeRoot {
  label: string;
  tool_id: string;
  path: string;
  root: LibTreeNode;
}

function mockLibNode(
  name: string,
  rel: string,
  isSkill: boolean,
  children: LibTreeNode[] = [],
  files: LibTreeFile[] = []
): LibTreeNode {
  return {
    name,
    rel,
    is_skill: isSkill,
    is_pack: isSkill && children.some((c) => c.is_skill),
    skill_id: isSkill ? `builtin|${rel}` : null,
    skill_name: isSkill ? name : null,
    description: null,
    files,
    children,
  };
}

/** 技能库文件管理器树：每个启用扫描根一棵，供 LibraryExplorer 逐层渲染。
 *  `force` 为 true 时忽略后端进程内缓存重新扫描（手动刷新）。 */
export function scanLibraryTree(force = false): Promise<LibraryTreeRoot[]> {
  if (isMockMode()) {
    const pack = mockLibNode("shark-dsh", "shark-dsh", true, [
      mockLibNode("shark-browser", "shark-dsh/shark-browser", true, [], [
        { name: "SKILL.md", rel: "shark-dsh/shark-browser/SKILL.md", kind: "skill-doc", abs_path: "/mock/shark-dsh/shark-browser/SKILL.md" },
      ]),
    ], [
      { name: "SKILL.md", rel: "shark-dsh/SKILL.md", kind: "skill-doc", abs_path: "/mock/shark-dsh/SKILL.md" },
      { name: "helper.py", rel: "shark-dsh/scripts/helper.py", kind: "script", abs_path: "/mock/shark-dsh/scripts/helper.py" },
    ]);
    const quick = mockLibNode("skills-shark-quickstart", "skills-shark-quickstart", true, [], [
      { name: "SKILL.md", rel: "skills-shark-quickstart/SKILL.md", kind: "skill-doc", abs_path: "/mock/skills-shark-quickstart/SKILL.md" },
    ]);
    return Promise.resolve([
      {
        label: "示例技能",
        tool_id: "builtin",
        path: "C:\\mock\\builtin",
        root: { ...mockLibNode("builtin", "", false, [pack, quick]), rel: "" },
      },
    ]);
  }
  return invoke<LibraryTreeRoot[]>("scan_library_tree", { force });
}

/** 读取指定路径的文件内容 */
export function readSkillFile(path: string): Promise<string> {
  if (isMockMode()) {
    // 查重演示目录走专属样本文本（A/B 有真实差异）；其余路径维持 MOCK_RAW
    const demo = dupDemoFile(path);
    return Promise.resolve(demo ?? MOCK_RAW);
  }
  return invoke<string>("read_skill_file", { path });
}

/** 读取任意文件为 data URL（base64，按扩展名给 mime）——渲染二进制附件（png 等） */
export function readFileBase64(path: string): Promise<string> {
  return invoke<string>("read_file_base64", { path });
}

/** 写入译文 + 更新 translations.json */
export function writeTranslation(params: {
  skillId: string;
  bilingualText: string;
  sourcePath: string;
  scanLabel: string;
  sourceHash: string;
  model: string;
  titleZh: string;
}): Promise<void> {
  return invoke("write_translation", {
    skillId: params.skillId,
    bilingualText: params.bilingualText,
    sourcePath: params.sourcePath,
    scanLabel: params.scanLabel,
    sourceHash: params.sourceHash,
    model: params.model,
    titleZh: params.titleZh,
  });
}

/** 加载脱敏配置 */
export function loadConfig(): Promise<MaskedConfig> {
  return invoke<MaskedConfig>("load_config");
}

/** 读取当前生效的下载/导入目录 */
export function getDownloadDir(): Promise<string> {
  return invoke<string>("get_download_dir");
}

/** 保存自定义下载/导入目录（空串 = 恢复默认） */
export function setDownloadDir(dir: string): Promise<void> {
  return invoke("set_download_dir", { dir });
}

/** 持久化「AI 引导已永久关闭」（点过一次 AI 创作后不再弹提示） */
export function setAiHintDismissed(dismissed: boolean): Promise<void> {
  if (isMockMode()) return Promise.resolve();
  return invoke("set_ai_hint_dismissed", { dismissed });
}

/** 保存 LLM 配置（v0.2 B5 收尾：tools 走 hub_*_tool 命令，不再经此通道） */
export function saveConfig(params: {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
}): Promise<void> {
  return invoke("save_config", {
    llmApiKey: params.llmApiKey,
    llmBaseUrl: params.llmBaseUrl,
    llmModel: params.llmModel,
  });
}

/** 同步删除状态 + 返回完整列表 */
export function syncDeleted(currentIds: string[]): Promise<Skill[]> {
  return invoke<Skill[]>("sync_deleted", { currentIds });
}

// ---------------------------------------------------------------------------
// Hub 引用层（模块 B / B5 接线）
// ---------------------------------------------------------------------------

/** 用户操作语义（Rust serde lowercase） */
export type LinkMode = "link" | "copy" | "move";
/** 账本记录语义（Move 归一为 copy：原件已进回收站，无引用关系） */
export type LedgerMode = "link" | "copy";
/** 单条引用健康状态：正常 / 落点缺失 / 孤儿（悬空或被替换） */
export type LinkHealth = "normal" | "missing" | "orphaned";

/** linkable 目标工具（引用对话框下拉源；app_owned 已被后端排除） */
export interface LinkableTool {
  id: string;
  name: string;
  enabled: boolean;
  /** 候选目录是否已存在（false 时 UI 提示「将新建目录」） */
  has_existing_dir: boolean;
}

/** 账本条目（links.json） */
export interface HubLink {
  id: string;
  skill_name: string;
  /** H：用户自定义显示名（中文别名；空串 = 未设置，UI 回落 skill_name）。仅展示层，不改 junction 文件夹名 */
  display_name?: string;
  /** 出处目录（Move 模式记录原件原路径，供溯源） */
  source: string;
  /** 磁盘上实际存在的技能目录（junction 或副本实体），绝对路径 */
  target: string;
  /** 引用目标工具 id */
  target_tool: string;
  mode: LedgerMode;
  created_at: string;
}

/** 账本条目 + 对账结果（Rust 端 #[serde(flatten)]，字段平铺） */
export interface LinkStatus extends HubLink {
  health: LinkHealth;
  /** 人类可读诊断（health != normal 时给出原因） */
  detail: string;
}

/** linkable 目标工具清单 */
export function hubLinkableTools(): Promise<LinkableTool[]> {
  if (isMockMode()) {
    return Promise.resolve(
      MOCK_TOOLS.filter((t) => !t.app_owned && t.linkable && t.enabled).map(
        (t) => ({
          id: t.id,
          name: t.name,
          enabled: t.enabled,
          has_existing_dir: t.path_exists.some(Boolean),
        }),
      ),
    );
  }
  return invoke<LinkableTool[]>("hub_linkable_tools");
}

/** 建链/建副本/移动：source 必须是含 SKILL.md 的技能目录 */
export function hubLinkSkill(params: {
  sourcePath: string;
  targetToolId: string;
  mode: LinkMode;
}): Promise<HubLink> {
  if (isMockMode()) {
    const tool = MOCK_TOOLS.find((t) => t.id === params.targetToolId);
    if (!tool) return Promise.reject(new Error("目标工具不存在"));
    const name = params.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "skill";
    const ledgerMode: LedgerMode = params.mode === "link" ? "link" : "copy";
    const link: LinkStatus = {
      id: `mock-link-${Date.now()}`,
      skill_name: name,
      source: params.sourcePath,
      target: `C:\\Users\\mock\\${tool.id}\\skills\\${name}`,
      target_tool: tool.id,
      mode: ledgerMode,
      created_at: new Date().toISOString(),
      health: "normal",
      detail: "",
    };
    MOCK_LINKS.push(link);
    tool.link_count += 1;
    return Promise.resolve(link);
  }
  return invoke<HubLink>("hub_link_skill", params);
}

/** 解除引用：link → 只移除 junction 本体；copy → 只清账本 */
export function hubUnlinkSkill(linkId: string): Promise<HubLink> {
  if (isMockMode()) {
    const i = MOCK_LINKS.findIndex((l) => l.id === linkId);
    if (i < 0) return Promise.reject(new Error("引用记录不存在"));
    const [link] = MOCK_LINKS.splice(i, 1);
    const tool = MOCK_TOOLS.find((t) => t.id === link.target_tool);
    if (tool && tool.link_count > 0) tool.link_count -= 1;
    return Promise.resolve(link);
  }
  return invoke<HubLink>("hub_unlink_skill", { linkId });
}

/** link → copy 转换：复制实体替换 junction（删原件前救命通道） */
export function hubConvertToCopy(linkId: string): Promise<HubLink> {
  if (isMockMode()) {
    const link = MOCK_LINKS.find((l) => l.id === linkId);
    if (!link) return Promise.reject(new Error("引用记录不存在"));
    link.mode = "copy";
    return Promise.resolve(link);
  }
  return invoke<HubLink>("hub_convert_to_copy", { linkId });
}

/** 全量诊断：账本逐条对账（normal/missing/orphaned） */
export function hubLinksStatus(): Promise<LinkStatus[]> {
  if (isMockMode()) return Promise.resolve([...MOCK_LINKS_DEMO]);
  return invoke<LinkStatus[]>("hub_links_status");
}

/** link/unlink 后刷新技能列表（等价 scan_skills，含账本 join） */
export function hubRescan(): Promise<Skill[]> {
  return invoke<Skill[]>("hub_rescan");
}

// ---------------------------------------------------------------------------
// 工具管理（B5 收尾）：设置页「工具」面板
// ---------------------------------------------------------------------------

/** 工具全量信息（与 Rust ToolInfo 对齐） */
export interface ToolInfo {
  id: string;
  name: string;
  /** 注册表/应用自有工具：名称路径不可改，只能禁用 */
  builtin: boolean;
  /** 应用自有来源（builtin/imported/authored）：不可作引用落点 */
  app_owned: boolean;
  enabled: boolean;
  linkable: boolean;
  /** 候选路径原样（含 ~ / $VAR 模板） */
  paths: string[];
  /** 各候选展开后是否存在（与 paths 一一对应） */
  path_exists: boolean[];
  /** 名下引用记录数（links.json 台账） */
  link_count: number;
}

/** 全量工具列表（含 app_owned / 禁用项，供设置页管理）。
 *  后端可能因多扫描路径返回同 id 重复项（如两个 codex），
 *  此处按 id 去重（保留首个），避免 React 列表 key 冲突。 */
export function hubListTools(): Promise<ToolInfo[]> {
  if (isMockMode()) return Promise.resolve(dedupTools([...MOCK_TOOLS]));
  return invoke<ToolInfo[]>("hub_list_tools").then(dedupTools);
}

function dedupTools(tools: ToolInfo[]): ToolInfo[] {
  const seen = new Set<string>();
  return tools.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/** 新增自定义工具（builtin=false / linkable=true） */
export function hubAddTool(params: {
  name: string;
  paths: string[];
}): Promise<ToolInfo> {
  if (isMockMode()) {
    const name = params.name.trim();
    if (!name) return Promise.reject(new Error("工具名称不能为空"));
    if (MOCK_TOOLS.some((t) => t.name === name)) {
      return Promise.reject(new Error(`已存在同名工具：${name}`));
    }
    const paths = params.paths.map((p) => p.trim()).filter(Boolean);
    if (paths.length === 0) {
      return Promise.reject(new Error("至少需要一个扫描路径"));
    }
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tool";
    let id = `custom-${slug}`;
    let n = 2;
    while (MOCK_TOOLS.some((t) => t.id === id)) {
      id = `custom-${slug}-${n}`;
      n += 1;
    }
    const tool: ToolInfo = {
      id,
      name,
      builtin: false,
      app_owned: false,
      enabled: true,
      linkable: true,
      paths,
      path_exists: paths.map(() => true),
      link_count: 0,
    };
    MOCK_TOOLS.push(tool);
    return Promise.resolve(tool);
  }
  return invoke<ToolInfo>("hub_add_tool", params);
}

/** 更新工具：自定义可改 name/paths；任意可改 enabled（未传的字段不变） */
export function hubUpdateTool(params: {
  id: string;
  name?: string;
  paths?: string[];
  enabled?: boolean;
}): Promise<ToolInfo> {
  if (isMockMode()) {
    const tool = MOCK_TOOLS.find((t) => t.id === params.id);
    if (!tool) return Promise.reject(new Error(`工具不存在：${params.id}`));
    if (params.name !== undefined && !tool.builtin) {
      const n = params.name.trim();
      if (!n) return Promise.reject(new Error("工具名称不能为空"));
      tool.name = n;
    }
    if (params.paths !== undefined && !tool.app_owned) {
      tool.paths = params.paths;
      tool.path_exists = params.paths.map(() => true);
    }
    if (params.enabled !== undefined) tool.enabled = params.enabled;
    return Promise.resolve(tool);
  }
  const args: Record<string, unknown> = { id: params.id };
  if (params.name !== undefined) args.name = params.name;
  if (params.paths !== undefined) args.paths = params.paths;
  if (params.enabled !== undefined) args.enabled = params.enabled;
  return invoke<ToolInfo>("hub_update_tool", args);
}

/** 删除自定义工具；force=true 时连带移除名下账本记录 */
export function hubRemoveTool(params: {
  id: string;
  force: boolean;
}): Promise<void> {
  if (isMockMode()) {
    const i = MOCK_TOOLS.findIndex((t) => t.id === params.id);
    if (i < 0) return Promise.reject(new Error(`工具不存在：${params.id}`));
    const tool = MOCK_TOOLS[i];
    if (tool.builtin || tool.app_owned) {
      return Promise.reject(new Error("内置工具不能删除，只能禁用"));
    }
    if (tool.link_count > 0 && !params.force) {
      return Promise.reject(
        new Error(
          `该工具名下还有 ${tool.link_count} 条引用记录，请先在 Hub 页解除引用，或确认「一并移除记录」后重试`,
        ),
      );
    }
    if (tool.link_count > 0) {
      for (let j = MOCK_LINKS.length - 1; j >= 0; j--) {
        if (MOCK_LINKS[j].target_tool === params.id) MOCK_LINKS.splice(j, 1);
      }
    }
    MOCK_TOOLS.splice(i, 1);
    return Promise.resolve();
  }
  return invoke("hub_remove_tool", params);
}

/** 工具包目录探测结果（同步自 Rust 端 probe_tool_dir） */
export interface ToolDirProbe {
  /** 选中的根目录（展开后） */
  base_path: string;
  /** 根目录名（导入工具名候选） */
  name: string;
  /** 根目录是否存在 */
  base_exists: boolean;
  /** 根目录下是否存在 skills 子文件夹（工具包有效性判定） */
  has_skills: boolean;
  /** skills 子文件夹绝对路径（has_skills 为 true 时作为导入扫描路径） */
  skills_path: string;
}

/** 探测目录是否为有效工具包（含 skills 子文件夹）；设置页导入交互用，选中后立即调用 */
export function probeToolDir(dir: string): Promise<ToolDirProbe> {
  if (isMockMode()) {
    // mock 无文件系统：按路径末段启发式模拟——末段名为 skills 视为有效
    const base = dir.trim().replace(/[\\/]+$/, "");
    const segs = base.split(/[\\/]/).filter(Boolean);
    const last = segs[segs.length - 1] ?? "";
    const isSkills = /^skills$/i.test(last);
    const name = isSkills ? (segs[segs.length - 2] ?? "工具") : last || "工具";
    return Promise.resolve({
      base_path: base,
      name,
      base_exists: true,
      has_skills: isSkills,
      skills_path: base,
    });
  }
  return invoke<ToolDirProbe>("probe_tool_dir", { dir });
}

// ---------------------------------------------------------------------------
// 标签（T）/ Hub 显示名（H）/ 用途速览（S）
// ---------------------------------------------------------------------------

export interface TagDef {
  name: string;
  builtin: boolean;
}

export interface TagsData {
  version: number;
  /** tag_id → 定义 */
  tags: Record<string, TagDef>;
  /** 复合键 `skill:<skill_id>` / `hublink:<link_id>` → tag_id 列表 */
  assignments: Record<string, string[]>;
}

export interface Summary {
  /** 何时调用 */
  when: string;
  /** 需要什么输入 */
  input: string;
  /** 最终输出什么 */
  output: string;
  /** 生成时 SKILL.md 内容哈希（正文变化 → 失效提示） */
  source_hash: string;
  model: string;
  created_at: string;
}

export interface SummariesData {
  version: number;
  summaries: Record<string, Summary>;
}

/** 复合键助手：技能挂载键 */
export function tagKeySkill(skillId: string): string {
  return `skill:${skillId}`;
}

/** 复合键助手：Hub 引用挂载键 */
export function tagKeyHubLink(linkId: string): string {
  return `hublink:${linkId}`;
}

/** T：加载标签数据（缺失/损坏时后端回落内置四标签） */
export function loadTags(): Promise<TagsData> {
  if (isMockMode()) return Promise.resolve(structuredClone(MOCK_TAGS));
  return invoke<TagsData>("load_tags");
}

/** T：整体保存标签数据（前端持有全量，改完整存） */
export function saveTags(data: TagsData): Promise<void> {
  if (isMockMode()) return Promise.resolve();
  return invoke("save_tags", { data });
}

/** H：设置 Hub 引用显示名（中文别名；空串 = 清除，仅改账本） */
export function hubSetDisplayName(linkId: string, name: string): Promise<void> {
  if (isMockMode()) return Promise.resolve();
  return invoke("hub_set_display_name", { linkId, name });
}

/** S：加载用途速览 */
export function loadSummaries(): Promise<SummariesData> {
  if (isMockMode()) return Promise.resolve(structuredClone(MOCK_SUMMARIES));
  return invoke<SummariesData>("load_summaries");
}

/** S：写入单条用途速览（LLM 生成在前端，Rust 仅持久化） */
export function writeSummary(params: {
  skillId: string;
  when: string;
  input: string;
  output: string;
  sourceHash: string;
  model: string;
}): Promise<void> {
  if (isMockMode()) return Promise.resolve();
  return invoke("write_summary", {
    skillId: params.skillId,
    when: params.when,
    input: params.input,
    output: params.output,
    sourceHash: params.sourceHash,
    model: params.model,
  });
}

// ---------------------------------------------------------------------------
// 工作流 M 阶段 2：查重检测 + 手动处置
// ---------------------------------------------------------------------------

/** 疑似重复组的成员快照（后端 dedup.rs 对齐） */
export interface DupMember {
  skill_id: string;
  name: string;
  title_zh: string;
  emoji: string | null;
  scan_label: string;
  tool_id: string;
  skill_dir: string;
  /** canonical SKILL.md 文件路径（junction 穿透后 = 出处文件） */
  source_path: string;
  hub_linked: boolean;
  has_translation: boolean;
  /** R4：归一化正文 SHA-256；null=读失败/空正文（前端按它聚合内容变体） */
  body_hash: string | null;
  /** R4：正文字符数 */
  body_len: number;
  /** R4：SKILL.md 修改时间（epoch 秒） */
  mtime: number;
}

/** 疑似重复组（kind: identical=内容全等 / similar=名称·描述近似） */
export interface DupGroup {
  id: string;
  kind: "identical" | "same_name";
  /** 0..1；identical 恒为 1.0 */
  score: number;
  reason: string;
  members: DupMember[];
}

/** 查重检测：本地快路径（正文哈希全等 + 名称/描述相似度），无需 LLM */
export function detectDuplicates(): Promise<DupGroup[]> {
  if (isMockMode()) {
    return Promise.resolve(structuredClone(MOCK_DUP_GROUPS));
  }
  return invoke<DupGroup[]>("detect_duplicates");
}

/**
 * 手动处置：保留 keep、remove 备份后进回收站（「保存左边/保存右边」）。
 * 返回备份目录路径。junction 落点 / 账本出处会被后端拦截。
 */
export function dupResolve(keepId: string, removeId: string): Promise<string> {
  if (isMockMode()) {
    return Promise.resolve(`/mock/merge-backups/20260812-120000-dup-${removeId}`);
  }
  return invoke<string>("dup_resolve", { keepId, removeId });
}

/** 批量处置：保留 keepId，其余 removeIds 逐个备份后进回收站。返回备份目录列表。 */
export function dupResolveMany(keepId: string, removeIds: string[]): Promise<string[]> {
  if (isMockMode()) {
    return Promise.resolve(
      removeIds.map((id) => `/mock/merge-backups/20260812-120000-dup-${id}`)
    );
  }
  return invoke<string[]>("dup_resolve_many", { keepId, removeIds });
}

// ---------------------------------------------------------------------------
// 技能库批量删除（回收站语义 + Hub 引用保护）
// ---------------------------------------------------------------------------

/** 删除预检单项：弹窗按它分类「将移入回收站 / 将解除引用 / 无法删除」 */
export interface BatchDeleteCheckItem {
  id: string;
  name: string;
  /** 作为账本出处被引用的条目数 */
  referenced_count: number;
  /** 作为 copy 落点的账本条目数（解除后实体保留，需二次删除） */
  copy_targets: number;
  /** 该技能本身是 junction 落点 */
  as_junction: boolean;
  link_id: string | null;
  source_deleted: boolean;
  /** 磁盘目录已不存在（无需处理，直接跳过） */
  missing_dir: boolean;
  /** 是否仍有译文记录（translations.json meta）——幽灵条目可执行「清理记录」 */
  translation_record: boolean;
}

export interface BatchDeleteTrashedItem {
  id: string;
  name: string;
  /** 备份目录路径（可手动恢复） */
  backup: string;
}

export interface BatchDeleteUnlinkedItem {
  id: string;
  name: string;
  /** 实际移除的账本条目数 */
  links_removed: number;
}

export interface BatchDeleteFailItem {
  id: string;
  name: string;
  reason: string;
}

export interface BatchDeleteResult {
  trashed: BatchDeleteTrashedItem[];
  unlinked: BatchDeleteUnlinkedItem[];
  /** 已清理的「源已删除」译文记录（backup = 译文备份路径，无译文时为空串） */
  cleaned: BatchDeleteTrashedItem[];
  skipped: BatchDeleteFailItem[];
  errors: BatchDeleteFailItem[];
}

/** 批量删除预检（纯读）：返回每个技能的引用分类，供确认弹窗展示。 */
export function skillBatchDeleteCheck(ids: string[]): Promise<BatchDeleteCheckItem[]> {
  if (isMockMode()) {
    return Promise.resolve(
      ids.map((id) => {
        const s = MOCK_SKILLS.find((x) => x.id === id);
        if (!s) {
          return {
            id,
            name: "",
            referenced_count: 0,
            copy_targets: 0,
            as_junction: false,
            link_id: null,
            source_deleted: true,
            missing_dir: true,
            translation_record: false,
          };
        }
        const refs = MOCK_LINKS.filter((l) => l.source === s.skill_dir);
        const copies = MOCK_LINKS.filter(
          (l) => l.mode === "copy" && l.target === s.skill_dir
        );
        return {
          id,
          name: s.name,
          referenced_count: refs.length,
          copy_targets: copies.length,
          as_junction: s.hub_linked,
          link_id: s.hub_link_id,
          source_deleted: s.source_deleted,
          missing_dir: false,
          translation_record: true,
        };
      })
    );
  }
  return invoke<BatchDeleteCheckItem[]>("skill_batch_delete_check", { ids });
}

/** 批量删除执行：引用 → 解除引用；无引用 → 备份后回收站；源已删 → 清理译文记录。逐条容错返回明细。 */
export function skillBatchDeleteApply(ids: string[]): Promise<BatchDeleteResult> {
  if (isMockMode()) {
    const trashed: BatchDeleteTrashedItem[] = [];
    const unlinked: BatchDeleteUnlinkedItem[] = [];
    const cleaned: BatchDeleteTrashedItem[] = [];
    const skipped: BatchDeleteFailItem[] = [];
    for (const id of ids) {
      const s = MOCK_SKILLS.find((x) => x.id === id);
      if (!s) {
        skipped.push({ id, name: "", reason: "源目录已不存在，无需处理" });
        continue;
      }
      if (s.source_deleted) {
        const i = MOCK_SKILLS.indexOf(s);
        if (i >= 0) MOCK_SKILLS.splice(i, 1);
        cleaned.push({ id, name: s.name, backup: "" });
        continue;
      }
      const refs = MOCK_LINKS.filter((l) => l.source === s.skill_dir);
      const copies = MOCK_LINKS.filter(
        (l) => l.mode === "copy" && l.target === s.skill_dir
      );
      const junction = MOCK_LINKS.filter(
        (l) => s.hub_linked && s.hub_link_id === l.id
      );
      const targets = [...refs, ...copies, ...junction];
      if (targets.length > 0) {
        for (const l of targets) {
          const i = MOCK_LINKS.indexOf(l);
          if (i >= 0) MOCK_LINKS.splice(i, 1);
        }
        unlinked.push({ id, name: s.name, links_removed: targets.length });
      } else {
        // 与真实后端移入回收站后的下一次扫描保持一致：源技能不再出现在 mock 列表。
        const i = MOCK_SKILLS.indexOf(s);
        if (i >= 0) MOCK_SKILLS.splice(i, 1);
        trashed.push({
          id,
          name: s.name,
          backup: `/mock/merge-backups/20260826-120000-del-${s.folder_name}`,
        });
      }
    }
    return Promise.resolve({ trashed, unlinked, cleaned, skipped, errors: [] });
  }
  return invoke<BatchDeleteResult>("skill_batch_delete_apply", { ids });
}

// ---------------------------------------------------------------------------
// 工作流 M 阶段 3：智能合并（段落拼接/冲突解决在前端，落盘在后端）
// ---------------------------------------------------------------------------

/** 附件拷贝指令：从 A/B 的 src_rel 复制到合并产物 dst_rel */
export interface CopyOp {
  /** "a" | "b" | 绝对目录路径（R3 N 路雪球合并的中间成员附件来源） */
  from: string;
  src_rel: string;
  dst_rel: string;
}

export interface ApplyMergeArgs {
  a_id: string;
  b_id: string;
  /** 落点底层目录（合并技能目录的父目录） */
  target_root: string;
  /** 合并后技能目录名 + frontmatter name */
  name: string;
  /** 完整合并后的 SKILL.md 全文 */
  skill_md: string;
  copy_ops: CopyOp[];
  /** "delete_both" | "delete_weaker" | "keep_both" */
  disposal: "delete_both" | "delete_weaker" | "keep_both";
  /** disposal=delete_weaker 时被处置的一方 id */
  weaker_id: string | null;
}

export interface MergeResult {
  result_path: string;
  backup_dir: string;
  history_id: string;
}

export interface MergeSide {
  skill_id: string;
  path: string;
  backup: string;
}

export interface MergeRecord {
  id: string;
  at: string;
  /** "merge" = 智能合并产物；"dispose" = 处置副本（保留一侧、其余进回收站） */
  kind: "merge" | "dispose";
  a: MergeSide;
  b: MergeSide;
  result_path: string;
  result_skill_id: string;
  backup_dir: string;
  disposal: "delete_both" | "delete_weaker" | "keep_both";
  polished: boolean;
  a_tags: string[];
  b_tags: string[];
}

/** 智能合并落盘（后端负责备份/写产物/处置原件/标签迁移/历史）。 */
export function smartMergeApply(args: ApplyMergeArgs): Promise<MergeResult> {
  if (isMockMode()) {
    return Promise.resolve({
      result_path: `/mock/merged/${args.name}`,
      backup_dir: `/mock/merge-backups/20260812-120000-merge-mock`,
      history_id: `m-20260812-120000`,
    });
  }
  return invoke<MergeResult>("smart_merge_apply", { args });
}

export function listMergeHistory(): Promise<MergeRecord[]> {
  if (isMockMode()) {
    return Promise.resolve(
      structuredClone([
        {
          id: "m-20260812-120000",
          at: "2026-08-12T12:00:00+0800",
          kind: "merge",
          a: { skill_id: "claude-code|docker-ps", path: "/mock/claude-code/docker-ps", backup: "/mock/merge-backups/x/A" },
          b: { skill_id: "claude-code|docker-list", path: "/mock/claude-code/docker-list", backup: "/mock/merge-backups/x/B" },
          result_path: "/mock/claude-code/docker-tools",
          result_skill_id: "claude-code|docker-tools",
          backup_dir: "/mock/merge-backups/20260812-120000-merge-x",
          disposal: "delete_both",
          polished: false,
          a_tags: ["开发"],
          b_tags: ["效率"],
        },
      ])
    );
  }
  return invoke<MergeRecord[]>("list_merge_history");
}

export function undoMerge(mergeId: string): Promise<void> {
  if (isMockMode()) {
    return Promise.resolve();
  }
  return invoke<void>("undo_merge", { mergeId });
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

export interface ImportCandidate {
  /** 相对解压根的路径；"" 表示 zip 根目录本身是 skill */
  rel: string;
  name: string;
  description: string;
}

export interface ImportPreview {
  default_stem: string;
  candidates: ImportCandidate[];
  /** URL 导入的 pending 凭证（zip 本地导入为 null） */
  token: string | null;
  /** zip 内含 pack.json 时的探测结果（分流到 Pack 导入） */
  pack: PackDetect | null;
}

// ---------------------------------------------------------------------------
// Skill Packs（P1）
// ---------------------------------------------------------------------------

/** zip 内 pack.json 探测摘要 */
export interface PackDetect {
  name: string;
  ver: string;
  author: string;
  skill_count: number;
  format_version: number;
}

/** Pack 库条目（← packs/<id>/pack.json） */
export interface PackInfo {
  id: string;
  name: string;
  ver: string;
  author: string;
  created_at: string;
  skill_count: number;
  translated: number;
  overview: string;
  /** ai / static */
  summary_source: string;
  skill_names: string[];
}

/** 打包输入：source_path = SKILL.md 绝对路径 */
export interface PackSkillInput {
  source_path: string;
  /** 扫描结果的虚拟 skill_id（P10b 打包带译文时后端据此查译文） */
  skill_id: string;
  name: string;
  description: string;
  description_zh: string;
  has_translation: boolean;
}

export function packsList(): Promise<PackInfo[]> {
  if (isMockMode()) return Promise.resolve(MOCK_PACKS);
  return invoke<PackInfo[]>("packs_list");
}

/** C4：pack_create 校验门的结构化失败清单条目 */
export interface SkillValidationFailure {
  skill_path: string;
  name: string;
  issues: ValidationIssue[];
}

/** C4：pack_create 结构化错误（不再是字符串，catch 需按 kind 分流） */
export type PackCreateError =
  | { kind: "validation_failed"; message: string; failed: SkillValidationFailure[] }
  | { kind: "message"; message: string };

export function isPackCreateError(e: unknown): e is PackCreateError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as PackCreateError).message === "string"
  );
}

/** 任意 pack 错误 → 人话文本（防 [object Object]） */
export function packErrorText(e: unknown): string {
  if (isPackCreateError(e)) return e.message;
  return String(e);
}

export function packCreate(params: {
  name: string;
  ver: string;
  author: string;
  skills: PackSkillInput[];
  /** C4 逃生门：带错强行打包，warnings 记入 pack.json */
  force?: boolean;
}): Promise<PackInfo> {
  if (isMockMode()) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        // 模拟 C4 校验门：包名含 "bad" → 严格校验拒绝（force 可过）
        if (/bad/i.test(params.name) && !params.force) {
          const sample = params.skills.slice(0, 2);
          reject({
            kind: "validation_failed",
            message: `${sample.length} 个技能未通过严格校验，已拒绝打包`,
            failed: sample.map((s) => ({
              skill_path: s.source_path,
              name: s.name,
              issues: [
                {
                  rule_id: "FM-02",
                  severity: "error",
                  message: "description 为空（mock 校验门）",
                  path: "SKILL.md",
                  hint: "",
                },
              ],
            })),
          } satisfies PackCreateError);
          return;
        }
        const info: PackInfo = {
          id: `mock-pack-${Date.now().toString(16)}`,
          name: params.name,
          ver: params.ver,
          author: params.author,
          created_at: new Date().toISOString(),
          skill_count: params.skills.length,
          translated: params.skills.filter((s) => s.has_translation).length,
          overview: `Mock 打包：${params.name}`,
          summary_source: "static",
          skill_names: params.skills.map((s) => s.name),
        };
        MOCK_PACKS.push(info);
        resolve(info);
      }, 600);
    });
  }
  return invoke<PackInfo>("pack_create", params);
}

/** 导出 .skillpack；返回文件字节数 */
export function packExport(id: string, dest: string): Promise<number> {
  return invoke<number>("pack_export", { id, dest });
}

export function packImport(path: string): Promise<PackInfo> {
  return invoke<PackInfo>("pack_import", { path });
}

/** 新建【全新】文件夹位置：创建目录并注册为自定义根，返回工具 id。 */
export function addFolderRoot(path: string): Promise<string> {
  if (isMockMode()) {
    const clean = path.trim();
    if (!clean) return Promise.reject(new Error("路径为空"));
    return Promise.resolve(`custom-${clean.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`);
  }
  return invoke<string>("add_folder_root", { path });
}

/** 安装部署预览结果（D6：deploy_root = <target>/skills） */
export interface InstallPreview {
  deploy_root: string;
  skill_folders: string[];
  conflicts: string[];
  is_new_tool: boolean;
}

/** 安装预览：解析 pack + 冲突清单，不落盘（D2/D6） */
export function packInstallPreview(id: string, targetDir: string): Promise<InstallPreview> {
  if (isMockMode()) {
    const pack = MOCK_PACKS.find((p) => p.id === id);
    if (!pack) return Promise.reject(new Error(`Pack 不存在：${id}`));
    const deploy_root = `${targetDir.replace(/[\\/]+$/, "")}/skills`;
    const fold = (Array.isArray(pack.skill_names) ? pack.skill_names : []);
    const existing = MOCK_INSTALLS.get(deploy_root) ?? [];
    return Promise.resolve({
      deploy_root,
      skill_folders: fold,
      conflicts: fold.filter((f) => existing.includes(f)),
      is_new_tool: !existing.length,
    });
  }
  return invoke<InstallPreview>("pack_install_preview", { id, targetDir });
}

/** 安装提交：overwrite = 用户确认覆盖的同名 folder；其余冲突跳过。 */
export function packInstallCommit(
  id: string,
  targetDir: string,
  overwrite: string[]
): Promise<number> {
  if (isMockMode()) {
    const pack = MOCK_PACKS.find((p) => p.id === id);
    if (!pack) return Promise.reject(new Error(`Pack 不存在：${id}`));
    const deploy_root = `${targetDir.replace(/[\\/]+$/, "")}/skills`;
    const fold = (Array.isArray(pack.skill_names) ? pack.skill_names : []);
    const existing = MOCK_INSTALLS.get(deploy_root) ?? [];
    const deployable = fold.filter(
      (f) => !existing.includes(f) || overwrite.includes(f)
    );
    MOCK_INSTALLS.set(deploy_root, Array.from(new Set([...existing, ...deployable])));
    return Promise.resolve(deployable.length);
  }
  return invoke<number>("pack_install_commit", { id, targetDir, overwrite });
}

export function packDelete(id: string): Promise<void> {
  return invoke("pack_delete", { id });
}

/** 重命名 Pack；返回更新后的信息 */
export function packRename(id: string, name: string): Promise<PackInfo> {
  if (isMockMode()) {
    const info = MOCK_PACKS.find((p) => p.id === id);
    if (!info) return Promise.reject(new Error(`Pack 不存在：${id}`));
    info.name = name.trim();
    return Promise.resolve(info);
  }
  return invoke<PackInfo>("pack_rename", { id, name });
}

// ---------------------------------------------------------------------------
// 模块 A：Git 仓库货架导入
// ---------------------------------------------------------------------------

export interface GitStatusInfo {
  installed: boolean;
  version: string;
  /** 是否已在设置中配置「我的技能仓库」 */
  repo_configured: boolean;
  repo_path: string;
  /** 配置路径是否存在且是 git 仓库 */
  repo_exists: boolean;
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
}

/** 货架条目（index.json 或降级扫描产出） */
export interface ShelfPackEntry {
  id: string;
  name: string;
  ver: string;
  path: string;
  skill_count: number;
  summary_zh: string;
  updated_at: string;
  declared_sha256: string;
  actual_sha256: string;
  /** 清单声明与包内容不一致（可能清单过期；不阻断导入） */
  sha256_mismatch: boolean;
}

export interface ShelfPreview {
  repo_name: string;
  updated_at: string;
  /** git+index / git+scan / archive+index / archive+scan */
  source: string;
  packs: ShelfPackEntry[];
  token: string;
}

export interface ImportFailure {
  path: string;
  error: string;
}

export interface RepoImportResult {
  imported: PackInfo[];
  failed: ImportFailure[];
  warnings: string[];
}

export function gitStatus(): Promise<GitStatusInfo> {
  if (isMockMode()) {
    return Promise.resolve({
      installed: true,
      version: "git version 2.47.0.windows.1 (mock)",
      repo_configured: true,
      repo_path: "D:\\mock\\my-skill-repo",
      repo_exists: true,
      branch: "main",
      clean: true,
      ahead: 0,
      behind: 0,
    });
  }
  return invoke<GitStatusInfo>("git_status");
}

/** 浏览仓库货架：浅克隆 → 500MB 闸 → index.json/降级扫描。无 git 自动降级 archive 通道。 */
export function repoBrowse(url: string): Promise<ShelfPreview> {
  if (isMockMode()) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (/fail/i.test(url)) {
          reject(new Error("未找到 .skillpack 货架包（已检查 index.json 并扫描目录 3 层），请确认仓库布局"));
          return;
        }
        resolve({
          ...MOCK_SHELF,
          packs: MOCK_SHELF.packs.map((p) => ({ ...p })),
          token: `shelf-mock-${Date.now().toString(16)}`,
        });
      }, 1200);
    });
  }
  return invoke<ShelfPreview>("repo_browse", { url });
}

/** 勾选导入：逐包 pack_import；部分失败不回滚；完成后清理临时目录。 */
export function repoImportCommit(params: {
  token: string;
  selected: string[];
}): Promise<RepoImportResult> {
  if (isMockMode()) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        const selected = new Set(params.selected);
        const chosen = MOCK_SHELF.packs.filter((p) => selected.has(p.path));
        const imported: PackInfo[] = chosen.map((p) => {
          const info: PackInfo = {
            id: p.id,
            name: p.name,
            ver: p.ver,
            author: "mock-shelf",
            created_at: new Date().toISOString(),
            skill_count: p.skill_count,
            translated: 0,
            overview: p.summary_zh || "Mock 货架包",
            summary_source: "static",
            skill_names: Array.from(
              { length: Math.min(p.skill_count, 3) },
              (_, i) => `skill-${i + 1}`
            ),
          };
          MOCK_PACKS.push(info);
          return info;
        });
        const warnings = chosen
          .filter((p) => p.sha256_mismatch)
          .map((p) => `「${p.name}」货架清单声明的 sha256 与包内容不一致（清单可能过期），已按包内自验结果导入`);
        resolve({ imported, failed: [], warnings });
      }, 800);
    });
  }
  return invoke<RepoImportResult>("repo_import_commit", params);
}

// ---------------------------------------------------------------------------
// 模块 A 发布侧
// ---------------------------------------------------------------------------

export interface RepoInfo {
  local_path: string;
  remote_url: string;
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
}

export interface PublishResult {
  repo_url: string;
  pack_path: string;
  commit_msg: string;
  pushed: boolean;
  rebase_retried: boolean;
}

/** repo_setup：空目录 git init + 设 remote + 初始 commit；已有仓库校验/补 remote */
export function repoSetup(params: {
  localPath: string;
  remoteUrl: string;
  initIfMissing: boolean;
}): Promise<RepoInfo> {
  if (isMockMode()) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (/fail/i.test(params.remoteUrl)) {
          reject(new Error("仓库已有不同的 origin（https://example.com/other.git）——App 不覆盖现有远端，请手动处理或更换本地路径"));
          return;
        }
        resolve({
          local_path: params.localPath,
          remote_url: params.remoteUrl,
          branch: "main",
          clean: true,
          ahead: 0,
          behind: 0,
        });
      }, 900);
    });
  }
  return invoke<RepoInfo>("repo_setup", {
    localPath: params.localPath,
    remoteUrl: params.remoteUrl,
    initIfMissing: params.initIfMissing,
  });
}

/** publish_pack：事务（校验闸→备份→export→index 合并→commit→push，rebase 重试一次） */
export function publishPack(params: {
  packId: string;
  message?: string;
}): Promise<PublishResult> {
  if (isMockMode()) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (/fail/i.test(params.packId)) {
          reject(new Error("本地已提交但推送失败：推送被拒：远端有新提交，需要先同步，请手动处理后重试（commit 已保留）"));
          return;
        }
        resolve({
          repo_url: "https://github.com/mock/my-skill-repo",
          pack_path: `packs/${params.packId}.skillpack`,
          commit_msg: `publish: ${params.packId} v1.0.0`,
          pushed: true,
          rebase_retried: false,
        });
      }, 1500);
    });
  }
  return invoke<PublishResult>("publish_pack", params);
}

/** 保存/清除发布仓库配置（空串 = 清除）；不含 git 操作 */
export function savePublishRepo(localPath: string, remoteUrl: string): Promise<void> {
  if (isMockMode()) {
    return Promise.resolve();
  }
  return invoke("save_publish_repo", { localPath, remoteUrl });
}

// ---------------------------------------------------------------------------
// 模块 C：规范校验
// ---------------------------------------------------------------------------

export type ValidateMode = "strict" | "diagnostic";
export type ValidateSeverity = "error" | "warn" | "info";
export type ValidateVerdict = "pass" | "warn" | "fail";

export interface ValidationIssue {
  rule_id: string;
  severity: ValidateSeverity;
  message: string;
  path: string;
  hint: string;
}

export interface ValidationReport {
  mode: ValidateMode;
  passed: boolean;
  issues: ValidationIssue[];
  matrix: {
    claude: { verdict: ValidateVerdict; notes: string[] };
    codex: { verdict: ValidateVerdict; notes: string[] };
  };
}

/** 校验任意技能目录；diagnostic 永不阻断，strict 为发布前闸 */
export function skillValidate(
  path: string,
  mode: ValidateMode = "diagnostic"
): Promise<ValidationReport> {
  if (isMockMode()) {
    // mock 路径形如 /mock/<scan>/<name>，末段即技能名；样本按名命中，未命中走全绿
    const byName: Record<string, string> = {
      "code-review": "c1",
      "commit-msg": "c2",
      docx: "o3",
      "git-flow": "x2",
    };
    const seg = path.replace(/\\/g, "/").split("/").filter(Boolean);
    const name = seg.length > 0 ? seg[seg.length - 1] : "";
    return Promise.resolve(
      mockValidationReport(byName[name] ?? "default", mode)
    );
  }
  return invoke<ValidationReport>("skill_validate", { path, mode });
}

/** C5：新建技能（模板模式，落点 authored 自有源）。
 *  同名已存在 → reject Error("EXISTS")。
 *  scaffoldResources：shark-skill-creator 规范层结构补全（references/scripts/assets），
 *  选择后预置引导 README 并在 SKILL.md 模板追加资源导航段。 */
export function skillNew(params: {
  name: string;
  description: string;
  emoji?: string;
  scaffoldResources?: string[];
}): Promise<{ skill_dir: string; source_path: string }> {
  if (isMockMode()) {
    const name = params.name.trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      return Promise.reject(
        new Error("name 必须为 hyphen-case：小写字母数字 + 连字符，不首尾连字符、不双连字符")
      );
    }
    if (MOCK_SKILLS.some((s) => s.tool_id === "authored" && s.name === name)) {
      return Promise.reject(new Error("EXISTS"));
    }
    const skill: Skill = {
      id: `authored|${name}`,
      name,
      folder_name: name,
      description: params.description.trim(),
      emoji: params.emoji ?? "✍️",
      scan_label: "创作",
      source_path: `/mock/authored/${name}/SKILL.md`,
      skill_dir: `/mock/authored/${name}`,
      tool_id: "authored",
      is_representative: true,
      other_sources: [],
      hub_linked: false,
      hub_link_id: null,
      has_translation: false,
      translation_lost: false,
      title_zh: "",
      description_zh: "",
      source_deleted: false,
      parent_collection: null,
    };
    MOCK_SKILLS.push(skill);
    return Promise.resolve({
      skill_dir: skill.skill_dir,
      source_path: skill.source_path,
    });
  }
  return invoke("skill_new", {
    name: params.name,
    description: params.description,
    scaffold_resources: params.scaffoldResources ?? [],
  });
}

/** C6/C9：草稿落盘（AI 链路复用；模板模式双落点也走这里，body 空 = 骨架）。 */
export function skillCommitDraft(
  location: string,
  draft: {
    name: string;
    description: string;
    emoji?: string | null;
    body?: string;
    references?: { rel_path: string; content: string }[];
    scaffold_resources?: string[];
  }
): Promise<{ skill_dir: string; validation: ValidationReport }> {
  if (isMockMode()) {
    const name = draft.name.trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      return Promise.reject(new Error("name 必须为 hyphen-case"));
    }
    if (MOCK_SKILLS.some((s) => s.name === name)) {
      return Promise.reject(new Error("EXISTS"));
    }
    const label = location === "authored" ? "创作" : (MOCK_TOOLS.find((t) => t.id === location)?.name ?? location);
    const dir = location === "authored" ? `/mock/authored/${name}` : `/mock/${location}/${name}`;
    MOCK_SKILLS.push({
      id: `${location}|${name}`,
      name,
      folder_name: name,
      description: draft.description.trim(),
      emoji: draft.emoji ?? (location === "authored" ? "✍️" : null),
      scan_label: label,
      source_path: `${dir}/SKILL.md`,
      skill_dir: dir,
      tool_id: location,
      is_representative: true,
      other_sources: [],
      hub_linked: false,
      hub_link_id: null,
      has_translation: false,
      translation_lost: false,
      title_zh: "",
      description_zh: "",
      source_deleted: false,
      parent_collection: null,
    });
    return Promise.resolve({
      skill_dir: dir,
      validation: mockValidationReport("default", "diagnostic"),
    });
  }
  return invoke("skill_commit_draft", { location, draft });
}

// ---------------------------------------------------------------------------
// shark-skill-creator 集成（创作工作台加载内置规范定义）
// ---------------------------------------------------------------------------

/** 内置 creator 资源条目元数据（渐进披露：只带 rel_path/标题/用途/大小，正文按需读） */
export interface CreatorAsset {
  rel_path: string;
  title: string;
  /** 一句话用途（渐进披露索引，供 AI 决定是否读取全文） */
  purpose?: string;
  size: number;
}

/** 内置 shark-skill-creator 定义：压缩骨架 + SKILL.md 全文（指令模板）+ references/scripts 清单 */
export interface CreatorInfo {
  name: string;
  description: string;
  /** 压缩骨架（面向创作 AI 的首轮知识库；渐进披露入口） */
  summary?: string;
  skill_md: string;
  references: CreatorAsset[];
  scripts: CreatorAsset[];
}

/** 创作工作台加载内置 shark-skill-creator 定义。目录缺失 → null（优雅降级）。 */
export function skillCreatorInfo(): Promise<CreatorInfo | null> {
  if (isMockMode()) {
    return Promise.resolve(MOCK_CREATOR_INFO);
  }
  return invoke<CreatorInfo | null>("skill_creator_info");
}

/** 按需读取内置 creator 资源全文（references/scripts 内，禁路径逃逸）。 */
export function skillCreatorRead(relPath: string): Promise<string> {
  if (isMockMode()) {
    const doc = MOCK_CREATOR_DOCS[relPath];
    return doc
      ? Promise.resolve(doc)
      : Promise.reject(new Error(`未找到规范资源：${relPath}`));
  }
  return invoke<string>("skill_creator_read", { relPath });
}

/** C10：frontmatter 行级外科手术编辑（未知字段字节级保留）。 */
export function skillEditFrontmatter(
  skillDir: string,
  edits: { key: string; op: "set" | "delete"; value?: string }[]
): Promise<{ validation: ValidationReport }> {
  if (isMockMode()) {
    const skill = MOCK_SKILLS.find((s) => s.skill_dir === skillDir);
    for (const e of edits) {
      if (!skill || e.op !== "set") continue;
      if (e.key === "name") skill.name = e.value ?? "";
      if (e.key === "description") skill.description = e.value ?? "";
      if (e.key === "emoji") skill.emoji = e.value ?? null;
    }
    return Promise.resolve({ validation: mockValidationReport("default", "diagnostic") });
  }
  return invoke("skill_edit_frontmatter", { skillDir, edits });
}

/** 重命名 authored 技能（目录名 + frontmatter 同步；有 Hub 引用拒）。 */
export function skillRename(
  skillDir: string,
  newName: string
): Promise<{ skill_dir: string }> {
  if (isMockMode()) {
    const skill = MOCK_SKILLS.find((s) => s.skill_dir === skillDir);
    if (skill) {
      skill.name = newName;
      skill.skill_dir = `${skillDir.slice(0, skillDir.lastIndexOf("/"))}/${newName}`;
    }
    return Promise.resolve({ skill_dir: skill?.skill_dir ?? skillDir });
  }
  return invoke("skill_rename", { skillDir, newName });
}

/** C6：编辑器整文件写（rel_path 禁 .. / 绝对路径，后端归属闸）。 */
export function skillWriteFile(
  skillDir: string,
  relPath: string,
  content: string
): Promise<void> {
  if (isMockMode()) {
    // mock 不落盘；rel 安全语义前端同步模拟（.. 拒绝）
    if (relPath.includes("..")) return Promise.reject(new Error("rel_path 不允许 .. 逃逸"));
    mockWriteToTree(skillDir, relPath);
    return Promise.resolve();
  }
  return invoke("skill_write_file", { skillDir, relPath, content });
}

/** W4：附带资源文件树（深度 ≤3，跳 .git/node_modules，后端归属闸）。 */
export interface FileNode {
  rel: string;
  name: string;
  is_dir: boolean;
  children: FileNode[];
}

export function skillListFiles(skillDir: string): Promise<FileNode[]> {
  if (isMockMode()) return Promise.resolve(mockFileTree(skillDir));
  return invoke<FileNode[]>("skill_list_files", { skillDir });
}

/** W4：删除附带文件（同闸；SKILL.md 拒删）。 */
export function skillDeleteFile(skillDir: string, rel: string): Promise<void> {
  if (isMockMode()) {
    try {
      mockDeleteFile(skillDir, rel);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  return invoke("skill_delete_file", { skillDir, rel });
}

/** 导入外部文件（dialog 选源 → 二进制安全 fs::copy，后端归属闸 + rel 安全）。
 * 目标已存在 → Err("EXISTS")。返回落盘后的 rel 与绝对路径。 */
export function skillImportFile(
  skillDir: string,
  sourcePath: string,
  targetRel: string
): Promise<{ rel: string; path: string }> {
  if (isMockMode()) {
    try {
      mockImportFile(skillDir, targetRel);
      return Promise.resolve({ rel: targetRel, path: `${skillDir}/${targetRel}` });
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  return invoke("skill_import_file", { skillDir, sourcePath, targetRel });
}

/** C8：生成 agents/openai.yaml（默认拒覆盖；overwrite 备份 .bak）。 */
export function openaiYamlGenerate(
  skillDir: string,
  fields: {
    display_name: string;
    short_description: string;
    default_prompt: string;
    icon_small?: string;
    icon_large?: string;
    brand_color?: string;
  },
  overwrite: boolean
): Promise<{ path: string; warnings: string[] }> {
  if (isMockMode()) {
    if (!fields.default_prompt.includes("$skill-name")) {
      return Promise.reject(new Error("default_prompt 必须包含 $skill-name（官方硬规则）"));
    }
    const len = [...fields.short_description].length;
    if (len < 25 || len > 64) {
      return Promise.reject(new Error(`short_description 须 25–64 字符（当前 ${len}）`));
    }
    return Promise.resolve({
      path: `${skillDir}/agents/openai.yaml`,
      warnings: fields.icon_small ? ["icon_small 资源不存在（不阻断）"] : [],
    });
  }
  return invoke("openai_yaml_generate", { skillDir, fields, overwrite });
}

/** 转 Claude 兼容：从 agents/openai.yaml 派生 SKILL.md（仅缺失时写，已存在 → created=false）。 */
export function claudeMdGenerate(
  skillDir: string
): Promise<{ created: boolean; path: string; reason?: string }> {
  if (isMockMode()) {
    return Promise.resolve({
      created: false,
      path: `${skillDir}/SKILL.md`,
      reason: "SKILL.md 已存在，已是 Claude 兼容（mock）",
    });
  }
  return invoke("claude_md_generate", { skillDir });
}

export type ImportSource =
  | { kind: "zip"; path: string }
  | { kind: "url"; url: string; token: string; preload: ImportPreview };

/** 预览 zip：安全解压 + 探测 SKILL.md */
export function previewZipImport(path: string): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_zip_import", { path });
}

/** 提交导入到 imported 库；同名已存在且 replace=false 时后端返回 Err("EXISTS") */
export function commitZipImport(params: {
  path: string;
  stem: string;
  selected: string[];
  replace: boolean;
}): Promise<number> {
  return invoke<number>("commit_zip_import", params);
}

/** 解析 URL：archive zip 优先，git clone 兜底（后端下载/clone） */
export function previewUrlImport(url: string): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_url_import", { url });
}

export function commitUrlImport(params: {
  token: string;
  stem: string;
  selected: string[];
  replace: boolean;
}): Promise<number> {
  return invoke<number>("commit_url_import", params);
}
