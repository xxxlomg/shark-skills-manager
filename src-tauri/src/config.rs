//! 配置管理（v0.2 数据模型，PLAN-06 §2.6 / B1）
//!
//! 配置文件：<Roaming>\shark\shark-skills-manager\config.json
//!
//! 数据源从 v0.1 扁平 `scan_paths` 升级为 `tools` 注册表：
//! - 外部工具（注册表内置 10 家）：多候选路径，支持 `~` / `$VAR` 展开（expand_path）；
//! - 应用自有来源（builtin/imported，C5 起加 authored）：app_owned=true，路径运行时
//!   动态解析（dev↔prod 漂移免疫，取代 v0.1 的 label/path 猜测式自愈），linkable=false。
//!
//! v0.1 `scan_paths` 读兼容一版：仅当 `tools` 缺失时作为迁移输入
//! （migrate_scan_paths_to_tools，幂等），写时丢弃。前端过渡期契约不变：
//! MaskedConfig.scan_paths 由 tools 派生（config_view_from_tools），save_config
//! 收到的 scan_paths 反向合并回 tools（apply_scan_paths_edit）；B5 前端改造后拆除桥接。

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::cell::RefCell;

/// 追加写调试日志到数据目录 debug.log（release 也能查）
pub fn debug_log(msg: &str) {
    let path = get_data_dir().join("debug.log");
    let line = format!(
        "[{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        msg
    );
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

// ---------------------------------------------------------------------------
// 数据目录（PLAN-04 §1：外部化、单一目录）
// ---------------------------------------------------------------------------

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

// 单测线程局部覆盖：cargo test 每个 #[test] 跑在独立线程，各自 set 到自己的
// 临时目录，互不污染（此前用全局 OnceLock，并行测试共享一个槽位，谁先设谁赢，
// 导致数据目录相关测试互相踩踏——PLAN-09 P10b 新增数据目录测试时实锤）。
// 生产代码从不 set 这个线程局部值，get_data_dir() 照常回落 OnceLock。
thread_local! {
    static TEST_DATA_DIR: RefCell<Option<PathBuf>> = RefCell::new(None);
}

/// 项目根（frontend/src-tauri 上两级 = skills-shark/）
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 旧版数据目录（项目 _data/）。仅作 init 前兜底与一次性迁移源。
fn legacy_data_dir() -> PathBuf {
    project_root().join("_data")
}

/// shark 产品线根目录：多产品（A/B/C…）在 %APPDATA% 下共用这一层。
const PRODUCT_LINE_DIR: &str = "shark";

/// 本产品数据目录名（shark 产品线下的子目录，目录名=产品名）。
const DATA_DIR_NAME: &str = "shark-skills-manager";

/// 初始化数据/资源目录，lib.rs setup 调一次。
/// 解析优先级：SKILLS_SHARK_DATA env（portable 口子）>
/// Roaming\shark\shark-skills-manager（D1）> 旧版兜底。dev/prod 同机同目录（D5 不隔离）。
pub fn init_data_dir(app: &tauri::AppHandle) {
    let dir = match std::env::var("SKILLS_SHARK_DATA") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => resolve_data_dir(app),
    };
    let _ = DATA_DIR.set(dir.clone());
    if let Ok(rd) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(rd);
    }
    migrate_legacy_data(&dir);
    debug_log(&format!("data_dir initialized: {}", dir.display()));
}

/// 数据目录解析。直接用 dirs::data_dir()——OS 标准用户数据目录
/// （Windows = %APPDATA% = Roaming），不经过 tauri path API：
/// tauri v2 的 data_dir() 返回**裸 Roaming**（不拼 identifier），
/// app_data_dir() 才拼 identifier；早期代码误以为 data_dir() 带
/// identifier 并「上提一级」，把 Roaming 提成 AppData 的孤儿目录（2026-08-04 实锤）。
/// 目录结构：<Roaming>\<产品线根>\<产品数据目录> =
///   %APPDATA%\shark\shark-skills-manager（多产品共享 shark 产品线层）。
fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Some(d) = dirs::data_dir() {
        return d.join(PRODUCT_LINE_DIR).join(DATA_DIR_NAME);
    }
    // 兜底：app_data_dir = <data_dir>/<identifier>，上提一级回到 <data_dir>，
    // 再拼产品线 + 产品目录，与上面分支行为一致。
    match app.path().app_data_dir() {
        Ok(d) => d
            .parent()
            .map(|p| p.join(PRODUCT_LINE_DIR).join(DATA_DIR_NAME))
            .unwrap_or_else(|| d.join(PRODUCT_LINE_DIR).join(DATA_DIR_NAME)),
        Err(_) => legacy_data_dir(),
    }
}

/// 一次性迁移：新目录新鲜（无 config/translations.json）且旧项目 _data
/// 有内容时拷贝。旧目录原样保留作备份，不删。
fn migrate_legacy_data(target: &PathBuf) {
    let legacy = legacy_data_dir();
    if legacy == *target || !legacy.is_dir() {
        return;
    }
    if target.join("config.json").exists() || target.join("translations.json").exists() {
        return;
    }
    let _ = fs::create_dir_all(target.join("translations"));
    let mut copied: Vec<String> = Vec::new();
    for name in ["config.json", "translations.json"] {
        let src = legacy.join(name);
        if src.is_file() && fs::copy(&src, target.join(name)).is_ok() {
            copied.push(name.to_string());
        }
    }
    if let Ok(entries) = fs::read_dir(legacy.join("translations")) {
        for e in entries.filter_map(|e| e.ok()) {
            let src = e.path();
            let dst = target.join("translations").join(e.file_name());
            if src.is_file() && !dst.exists() && fs::copy(&src, &dst).is_ok() {
                copied.push(format!("translations/{}", e.file_name().to_string_lossy()));
            }
        }
    }
    if !copied.is_empty() {
        debug_log(&format!("migrated from legacy _data: {}", copied.join(", ")));
    }
}

/// 获取数据目录。init 前回退旧版项目 _data（保持旧行为不崩）。
pub fn get_data_dir() -> PathBuf {
    TEST_DATA_DIR
        .with(|d| d.borrow().clone())
        .unwrap_or_else(|| DATA_DIR.get().cloned().unwrap_or_else(legacy_data_dir))
}

/// 单测专用：把当前测试线程的数据目录指到临时目录，避免触碰真实用户数据。
/// 线程局部覆盖 → 并行测试各自隔离，不再共享全局竞态。
#[cfg(test)]
pub fn set_data_dir_for_test(p: PathBuf) {
    TEST_DATA_DIR.with(|d| *d.borrow_mut() = Some(p));
}

/// 导入 skills 存放目录（PLAN-04 §3，Phase 1 接入扫描与 UI）
/// PLAN-09 P5：若配置了自定义下载/导入目录则优先使用，否则沿用默认。
pub fn imported_dir() -> PathBuf {
    effective_import_path(&load_config())
}

/// 由配置计算生效的下载/导入目录（自定义路径走 expand_path 展开，失败回退默认）
fn effective_import_path(cfg: &AppConfig) -> PathBuf {
    let default = get_data_dir().join("imported");
    match cfg.download_dir.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => expand_path(s).unwrap_or(default),
        _ => default,
    }
}

/// PLAN-09 P5：保存自定义下载/导入目录（空串/None = 恢复默认）
pub fn set_download_dir(dir: Option<String>) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.download_dir = dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    save_config(&cfg)
}

/// PLAN-12：持久化「AI 引导已永久关闭」标记（点过一次 AI 创作后不再弹提示）
pub fn set_ai_hint_dismissed(v: bool) -> Result<(), String> {
    let mut cfg = load_config();
    if cfg.ai_hint_dismissed == v {
        return Ok(()); // 幂等：值未变不落盘
    }
    cfg.ai_hint_dismissed = v;
    save_config(&cfg)
}

/// C5（PLAN-06 §3.13）：创作 skills 存放目录（skill_new 模板模式落点）
pub fn authored_dir() -> PathBuf {
    get_data_dir().join("authored")
}

/// Skill Pack canonical 存储目录（PLAN-05 §2.4：packs/<id>/）
pub fn packs_dir() -> PathBuf {
    get_data_dir().join("packs")
}

fn config_path() -> PathBuf {
    get_data_dir().join("config.json")
}

pub fn translations_dir() -> PathBuf {
    get_data_dir().join("translations")
}

pub fn translations_json_path() -> PathBuf {
    get_data_dir().join("translations.json")
}

/// PLAN-13 工作流 T：标签数据（tags.json），与 config.json/translations.json 平级。
pub fn tags_json_path() -> PathBuf {
    get_data_dir().join("tags.json")
}

/// PLAN-13 工作流 S：技能用途速览（summaries.json）。
pub fn summaries_json_path() -> PathBuf {
    get_data_dir().join("summaries.json")
}

fn ensure_data_dir() {
    let dir = get_data_dir();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::create_dir_all(translations_dir());
}

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanPathItem {
    pub path: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMConfig {
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_base_url() -> String {
    "https://api.deepseek.com".to_string()
}

fn default_model() -> String {
    "deepseek-v4-flash".to_string()
}

/// v0.2 工具注册表条目（PLAN-06 §2.6）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolEntry {
    /// 稳定 id：注册表工具（claude-code/codex/...）或 custom-<slug> / builtin / imported
    pub id: String,
    /// 显示名，同时作为扫描结果的 scan_label（「导入」/「builtin」两个名字是
    /// scanner/translations 的硬契约，勿改）
    pub name: String,
    /// 候选路径，可含 `~` / `$VAR` 模板；app_owned 条目此字段被忽略（动态解析）
    #[serde(default)]
    pub paths: Vec<String>,
    /// true = app 内置（注册表工具或应用自有来源），不可被前端删除只能禁用
    #[serde(default)]
    pub builtin: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 能否成为 Hub 引用（link/copy）落点；app_owned 来源恒 false
    #[serde(default = "default_true")]
    pub linkable: bool,
    /// 应用自有来源（builtin/imported/authored）：路径动态解析 + 虚拟 id 语义
    #[serde(default)]
    pub app_owned: bool,
}

/// 应用自有来源 id（scanner/translations 依赖其 name 契约）
pub const TOOL_ID_BUILTIN: &str = "builtin";
pub const TOOL_ID_IMPORTED: &str = "imported";
/// C5（PLAN-06 §3.13）：创作自有源——skill_new 模板模式的唯一落点
pub const TOOL_ID_AUTHORED: &str = "authored";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub tools: Vec<ToolEntry>,
    #[serde(default = "default_llm")]
    pub llm: LLMConfig,
    /// 模块 A 发布侧：「我的技能仓库」本地路径 + remote（PLAN-06 §1.3）
    #[serde(default)]
    pub publish_repo: Option<PublishRepo>,
    /// PLAN-09 P5：技能下载/导入目录（None = 沿用默认 %APPDATA%\shark\shark-skills-manager\imported）
    #[serde(default)]
    pub download_dir: Option<String>,
    /// PLAN-12：创作台 AI 引导已永久关闭（点过一次 AI 创作后不再弹「没灵感」提示）
    #[serde(default)]
    pub ai_hint_dismissed: bool,
}

/// 发布用技能仓库配置（无敏感字段：凭据完全走用户 git 环境，§1.3）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublishRepo {
    pub local_path: String,
    pub remote_url: String,
}

/// 读兼容解析结构：区分「字段缺失」与「显式空数组」
#[derive(Deserialize)]
struct RawConfig {
    tools: Option<Vec<ToolEntry>>,
    /// v0.1 遗留：仅在 tools 缺失时作为迁移输入
    scan_paths: Option<Vec<ScanPathItem>>,
    #[serde(default)]
    llm: Option<LLMConfig>,
    #[serde(default)]
    publish_repo: Option<PublishRepo>,
    /// PLAN-09 P5：自定义下载/导入目录（缺失 = 沿用默认）
    #[serde(default)]
    download_dir: Option<String>,
    /// PLAN-12：AI 引导永久关闭标记（缺失 = false）
    #[serde(default)]
    ai_hint_dismissed: bool,
}

fn default_llm() -> LLMConfig {
    LLMConfig {
        api_key: String::new(),
        base_url: default_base_url(),
        model: default_model(),
    }
}

/// 内置但不对用户暴露的内部技能（纯内部资源，仅创作工作台隐式调用）。
/// 这些目录位于内置 skills/ 下，不注册为可见技能（扫描排除，PLAN-17）。
pub const INTERNAL_SKILL_DIRS: [&str; 1] = ["shark-skill-creator"];

/// 判断路径是否为内置内部技能目录：
/// 目录名命中白名单且位于 builtin_skills_dir() 之下（含自身）。
/// 大小写不敏感前缀 + 路径边界检查，避免误伤用户自有同名技能。
pub fn is_internal_skill_dir(p: &Path) -> bool {
    let name = match p.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    if !INTERNAL_SKILL_DIRS.contains(&name) {
        return false;
    }
    let norm = |d: &Path| {
        d.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    let child = norm(p);
    let base = norm(&builtin_skills_dir());
    child.starts_with(&base) && (child.len() == base.len() || child[base.len()..].starts_with('/'))
}

/// builtin skills 目录（dev: 项目 skills/；release: 资源目录 skills/，
/// 经 bundle.resources 打包，见 tauri.conf.json）
pub(crate) fn builtin_skills_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        project_root().join("skills")
    } else {
        RESOURCE_DIR.get().map(|r| r.join("skills")).unwrap_or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
                .join("skills")
        })
    }
}

/// v0.2 内置工具注册表（PLAN-06 §2.2 逐家核实过的真实目录）。
/// 注册表是静态数据：目录出现即被扫描（v0.1 是首装探测后冻结，此为有意升级）。
struct RegistryTool {
    id: &'static str,
    name: &'static str,
    paths: &'static [&'static str],
}

const TOOL_REGISTRY: &[RegistryTool] = &[
    RegistryTool { id: "claude-code", name: "Claude Code", paths: &["~/.claude/skills"] },
    // $CODEX_HOME 优先（镜像 Codex CLI 自身解析序）；展开失败自动落到后续候选
    RegistryTool { id: "codex", name: "Codex CLI", paths: &["$CODEX_HOME/skills", "~/.codex/skills", "~/.agents/skills"] },
    RegistryTool { id: "cursor", name: "Cursor", paths: &["~/.cursor/skills"] },
    RegistryTool { id: "opencode", name: "OpenCode", paths: &["~/.opencode/skills", "~/.config/opencode/skills"] },
    RegistryTool { id: "openclaw", name: "OpenClaw", paths: &["~/.openclaw/skills"] },
    RegistryTool { id: "windsurf", name: "Windsurf", paths: &["~/.codeium/windsurf/skills"] },
    RegistryTool { id: "copilot", name: "Copilot", paths: &["~/.copilot/skills"] },
    RegistryTool { id: "cline", name: "Cline", paths: &["~/.cline/skills"] },
    RegistryTool { id: "continue", name: "Continue", paths: &["~/.continue/skills"] },
    RegistryTool { id: "aider", name: "Aider", paths: &["~/.aider/skills"] },
];

/// v0.1 label → 注册表 id（迁移/反向合并用）
fn registry_id_by_legacy_label(label: &str) -> Option<&'static str> {
    match label {
        "Claude" => Some("claude-code"),
        "Codex" => Some("codex"),
        "Cursor" => Some("cursor"),
        "OpenCode" => Some("opencode"),
        "OpenClaw" => Some("openclaw"),
        "Windsurf" => Some("windsurf"),
        "Copilot" => Some("copilot"),
        "Cline" => Some("cline"),
        "Continue" => Some("continue"),
        "Aider" => Some("aider"),
        _ => None,
    }
}

fn registry_entry(reg: &RegistryTool, enabled: bool) -> ToolEntry {
    ToolEntry {
        id: reg.id.to_string(),
        name: reg.name.to_string(),
        paths: reg.paths.iter().map(|s| s.to_string()).collect(),
        builtin: true,
        enabled,
        linkable: true,
        app_owned: false,
    }
}

fn app_owned_tool(id: &str, name: &str) -> ToolEntry {
    ToolEntry {
        id: id.to_string(),
        name: name.to_string(),
        paths: vec![],
        builtin: true,
        enabled: true,
        linkable: false,
        app_owned: true,
    }
}

/// 应用自有来源的运行时路径（不存配置，dev↔prod 漂移免疫）
pub fn app_owned_path(tool_id: &str) -> Option<PathBuf> {
    match tool_id {
        TOOL_ID_BUILTIN => Some(builtin_skills_dir()),
        TOOL_ID_IMPORTED => Some(imported_dir()),
        TOOL_ID_AUTHORED => Some(authored_dir()),
        _ => None,
    }
}

/// 路径展开：`~` → home；`$VAR` / `$VAR/rest` → 环境变量（未设置/为空 → None，
/// 候选自动失效）；其余原样。
pub fn expand_path(s: &str) -> Option<PathBuf> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if t == "~" {
        return dirs::home_dir();
    }
    if let Some(rest) = t.strip_prefix("~/").or_else(|| t.strip_prefix("~\\")) {
        return dirs::home_dir().map(|h| h.join(rest));
    }
    if let Some(body) = t.strip_prefix('$') {
        let (var, rest) = match body.find(['/', '\\']) {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (body, ""),
        };
        if var.is_empty() {
            return None;
        }
        let val = std::env::var(var).ok().filter(|v| !v.trim().is_empty())?;
        let mut p = PathBuf::from(val);
        if !rest.is_empty() {
            p = p.join(rest.trim_start_matches(['/', '\\']));
        }
        return Some(p);
    }
    Some(PathBuf::from(t))
}

/// 大小写折叠 + 分隔符统一 + 去尾部分隔符（Windows 路径比较用）。
/// 实测边界：用户配置中同目录可能以 `\` 与混合 `/` 两种形态并存，
/// 不统一分隔符会导致重复候选 → 重复扫描。
pub(crate) fn norm_for_compare(p: &std::path::Path) -> String {
    let mut s = p.to_string_lossy().to_lowercase();
    if cfg!(windows) {
        s = s.replace('/', "\\");
    }
    s.trim_end_matches(['/', '\\']).to_string()
}

/// 去重追加候选路径（按展开后语义比较；展开失败的模板按原文比较）
fn push_path_if_new(paths: &mut Vec<String>, candidate: &str) {
    let c = candidate.trim();
    if c.is_empty() {
        return;
    }
    let c_norm = expand_path(c).map(|p| norm_for_compare(&p));
    for existing in paths.iter() {
        let e_norm = expand_path(existing).map(|p| norm_for_compare(&p));
        match (&e_norm, &c_norm) {
            (Some(a), Some(b)) if a == b => return,
            (None, None) if existing.trim() == c => return,
            _ => {}
        }
    }
    paths.push(c.to_string());
}

/// 某路径是否已被任一工具注册为扫描路径（按展开后语义比较；展开失败按原文比较）。
/// 返回占用该路径的工具名。文件路径是扫描根的唯一判定标准（D7：扫描根互不相交）。
/// `exclude_id`：排除某工具自身（更新自己 paths 时不应把自己算作冲突）。
pub fn path_taken_by(tools: &[ToolEntry], path: &str, exclude_id: Option<&str>) -> Option<String> {
    let c = path.trim();
    if c.is_empty() {
        return None;
    }
    let c_norm = expand_path(c).map(|p| norm_for_compare(&p));
    for t in tools {
        if Some(t.id.as_str()) == exclude_id {
            continue;
        }
        for cand in t.paths.iter() {
            let e_norm = expand_path(cand).map(|p| norm_for_compare(&p));
            let hit = match (&c_norm, &e_norm) {
                (Some(a), Some(b)) => a == b,
                (None, None) => c == cand.trim(),
                _ => false,
            };
            if hit {
                return Some(t.name.clone());
            }
        }
    }
    None
}

/// 新鲜安装默认：builtin 自有源 + 全量注册表（enabled；扫描时过滤不存在的目录）
pub fn default_tools() -> Vec<ToolEntry> {
    let mut tools = vec![app_owned_tool(TOOL_ID_BUILTIN, "builtin")];
    tools.extend(TOOL_REGISTRY.iter().map(|r| registry_entry(r, true)));
    tools.push(app_owned_tool(TOOL_ID_IMPORTED, "导入"));
    tools.push(app_owned_tool(TOOL_ID_AUTHORED, "创作"));
    tools
}

/// 保证应用自有来源条目存在（entry 恒在，enabled 可由用户控制）。
/// v0.2 中 app 自有源是应用不变量，不再是可删的扫描路径。
fn ensure_app_owned_entries(tools: &mut Vec<ToolEntry>) {
    if !tools.iter().any(|t| t.id == TOOL_ID_BUILTIN) {
        tools.insert(0, app_owned_tool(TOOL_ID_BUILTIN, "builtin"));
    }
    if !tools.iter().any(|t| t.id == TOOL_ID_IMPORTED) {
        tools.push(app_owned_tool(TOOL_ID_IMPORTED, "导入"));
    }
    if !tools.iter().any(|t| t.id == TOOL_ID_AUTHORED) {
        tools.push(app_owned_tool(TOOL_ID_AUTHORED, "创作"));
    }
}

// ---------------------------------------------------------------------------
// v0.2（B5 收尾）工具 CRUD：自定义工具增删改（PLAN-06 §2.6）
// 链接检查（删除前名下台账）在 commands 层做——config 不依赖 hub。
// ---------------------------------------------------------------------------

/// 自定义工具 id：`custom-<slug>`；slug 为空落 `custom-tool`；碰撞追加 -2/-3
fn custom_tool_id(tools: &[ToolEntry], name: &str) -> String {
    let slug = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base = if slug.is_empty() { "tool".to_string() } else { slug };
    let mut id = format!("custom-{}", base);
    let mut n = 2;
    while tools.iter().any(|t| t.id == id) {
        id = format!("custom-{}-{}", base, n);
        n += 1;
    }
    id
}

fn validate_tool_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let cleaned: Vec<String> = paths
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if cleaned.is_empty() {
        return Err("至少需要一个扫描路径".to_string());
    }
    Ok(cleaned)
}

/// 新增自定义工具（builtin=false / linkable=true / enabled=true）
pub fn add_tool(
    tools: &mut Vec<ToolEntry>,
    name: &str,
    paths: &[String],
) -> Result<ToolEntry, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("工具名称不能为空".to_string());
    }
    if tools.iter().any(|t| t.name == name) {
        return Err(format!("已存在同名工具：{}", name));
    }
    let cleaned = validate_tool_paths(paths)?;
    for p in &cleaned {
        if let Some(owner) = path_taken_by(tools, p, None) {
            return Err(format!("扫描路径已被「{}」占用：{}", owner, p));
        }
    }
    let entry = ToolEntry {
        id: custom_tool_id(tools, name),
        name: name.to_string(),
        paths: cleaned,
        builtin: false,
        enabled: true,
        linkable: true,
        app_owned: false,
    };
    tools.push(entry.clone());
    Ok(entry)
}

/// 更新工具：自定义工具可改 name/paths；任意工具可改 enabled。
/// builtin/app_owned 的 name/paths 修改请求被静默忽略（注册表与自有源不可改）。
pub fn update_tool(
    tools: &mut Vec<ToolEntry>,
    id: &str,
    name: Option<&str>,
    paths: Option<&[String]>,
    enabled: Option<bool>,
) -> Result<ToolEntry, String> {
    let pos = tools
        .iter()
        .position(|t| t.id == id)
        .ok_or_else(|| format!("工具不存在：{}", id))?;
    if let Some(n) = name {
        if !tools[pos].builtin {
            let n = n.trim();
            if n.is_empty() {
                return Err("工具名称不能为空".to_string());
            }
            if tools.iter().any(|t| t.id != id && t.name == n) {
                return Err(format!("已存在同名工具：{}", n));
            }
            tools[pos].name = n.to_string();
        }
    }
    if let Some(p) = paths {
        if !tools[pos].app_owned {
            let cleaned = validate_tool_paths(p)?;
            for cand in &cleaned {
                if let Some(owner) = path_taken_by(tools, cand, Some(&id)) {
                    return Err(format!("扫描路径已被「{}」占用：{}", owner, cand));
                }
            }
            tools[pos].paths = cleaned;
        }
    }
    if let Some(e) = enabled {
        tools[pos].enabled = e;
    }
    Ok(tools[pos].clone())
}

/// 删除自定义工具；builtin/app_owned 一律拒绝（只能禁用）
pub fn remove_tool(tools: &mut Vec<ToolEntry>, id: &str) -> Result<ToolEntry, String> {
    let pos = tools
        .iter()
        .position(|t| t.id == id)
        .ok_or_else(|| format!("工具不存在：{}", id))?;
    if tools[pos].builtin || tools[pos].app_owned {
        return Err("内置工具不能删除，只能禁用".to_string());
    }
    Ok(tools.remove(pos))
}

/// 启动即清私有暂存区（PLAN-06 §7.2：tmp/ 不放任何持久数据）
pub fn cleanup_tmp_dir() {
    let dir = get_data_dir().join("tmp");
    if dir.is_dir() {
        match fs::remove_dir_all(&dir) {
            Ok(()) => debug_log(&format!("startup: 已清空 tmp 目录 {}", dir.display())),
            Err(e) => debug_log(&format!(
                "startup: 清空 tmp 目录失败 {}: {}",
                dir.display(),
                e
            )),
        }
    }
}

/// v0.1 scan_paths → v0.2 tools 迁移（幂等：load 侧仅在 tools 缺失时调用）。
/// 语义：同 label 多行合并为一个 tool（候选级开关坍缩为工具级，OR 语义）；
/// 已知 label 的非标准路径作为附加候选保留（不丢用户自定义落点）。
pub fn migrate_scan_paths_to_tools(items: &[ScanPathItem]) -> Vec<ToolEntry> {
    let mut tools: Vec<ToolEntry> = Vec::new();
    for sp in items {
        if sp.label == "builtin" || sp.label == "导入" {
            let id = if sp.label == "builtin" { TOOL_ID_BUILTIN } else { TOOL_ID_IMPORTED };
            match tools.iter_mut().find(|t| t.id == id) {
                Some(t) => t.enabled = t.enabled || sp.enabled,
                None => {
                    let mut t = app_owned_tool(id, &sp.label);
                    t.enabled = sp.enabled;
                    tools.push(t);
                }
            }
            continue;
        }
        if let Some(reg_id) = registry_id_by_legacy_label(&sp.label) {
            let reg = TOOL_REGISTRY.iter().find(|r| r.id == reg_id).expect("registry invariant");
            match tools.iter_mut().find(|t| t.id == reg_id) {
                Some(t) => {
                    t.enabled = t.enabled || sp.enabled;
                    push_path_if_new(&mut t.paths, &sp.path);
                }
                None => {
                    let mut t = registry_entry(reg, sp.enabled);
                    push_path_if_new(&mut t.paths, &sp.path);
                    tools.push(t);
                }
            }
            continue;
        }
        // 自定义来源：按 label 合并
        let slug = slugify_label(&sp.label);
        let id = if slug.is_empty() {
            format!("custom-{}", short_hash(&sp.path))
        } else {
            format!("custom-{}", slug)
        };
        match tools.iter_mut().find(|t| t.id == id) {
            Some(t) => {
                t.enabled = t.enabled || sp.enabled;
                push_path_if_new(&mut t.paths, &sp.path);
            }
            None => tools.push(ToolEntry {
                id,
                name: if sp.label.trim().is_empty() { sp.path.clone() } else { sp.label.clone() },
                paths: vec![sp.path.clone()],
                builtin: false,
                enabled: sp.enabled,
                linkable: true,
                app_owned: false,
            }),
        }
    }
    tools
}

fn slugify_label(label: &str) -> String {
    let s: String = label
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    s.trim_matches('-').to_string()
}

/// 短哈希（自定义源无 label 时的 id 兜底，非安全用途）
fn short_hash(s: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

/// 扫描目标（B4 起 scanner 的输入）：enabled 工具 → 实际要扫的目录。
/// app_owned 动态解析；外部工具展开候选后取存在者（与 v0.1「存在的配置
/// 路径全扫」行为一致）。携带 tool_id 供 scanner 做稳定 rekey（§2.4）。
#[derive(Debug, Clone, Serialize)]
pub struct ScanTarget {
    pub path: String,
    /// 工具显示名（扫描结果的 scan_label）
    pub label: String,
    pub tool_id: String,
}

pub fn scan_targets_from_tools(tools: &[ToolEntry]) -> Vec<ScanTarget> {
    let mut out = Vec::new();
    for tool in tools.iter().filter(|t| t.enabled) {
        let dirs: Vec<PathBuf> = if tool.app_owned {
            app_owned_path(&tool.id).into_iter().filter(|p| p.is_dir()).collect()
        } else {
            let mut seen = std::collections::HashSet::new();
            tool.paths
                .iter()
                .filter_map(|c| expand_path(c))
                .filter(|p| p.is_dir())
                .filter(|p| seen.insert(norm_for_compare(p)))
                .collect()
        };
        for d in dirs {
            out.push(ScanTarget {
                path: d.to_string_lossy().to_string(),
                label: tool.name.clone(),
                tool_id: tool.id.clone(),
            });
        }
    }
    out
}

// v0.2（B5 收尾）：scan_paths 前端桥接（config_view_from_tools /
// apply_scan_paths_edit / detect_unconfigured_paths）已按计划拆除——
// 设置页改走 hub_list_tools + 工具 CRUD 命令（PLAN-06 §2.6/§2.10）。
// config.json 的旧 scan_paths 字段仍由 RawConfig 读兼容（迁移后写时丢弃）。

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

pub fn load_config() -> AppConfig {
    ensure_data_dir();
    let path = config_path();
    let raw: Option<RawConfig> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<RawConfig>(&text).ok())
    } else {
        None
    };

    // tools 已存在 → 直接用（幂等）；否则按 v0.1 scan_paths 迁移；都没有 → 新鲜默认。
    // 注意区分「scan_paths 字段缺失」（旧式全新安装 → 默认）与「显式空数组」
    // （用户清空过 → 仍走迁移，随后 ensure_app_owned_entries 补回应用自有源）。
    let has_tools = raw
        .as_ref()
        .and_then(|r| r.tools.as_ref())
        .map(|t| !t.is_empty())
        .unwrap_or(false);
    let (mut tools, migrated) = if has_tools {
        (raw.as_ref().and_then(|r| r.tools.clone()).unwrap(), false)
    } else if let Some(sp) = raw.as_ref().and_then(|r| r.scan_paths.clone()) {
        let t = migrate_scan_paths_to_tools(&sp);
        debug_log(&format!(
            "config migrate: v0.1 scan_paths({}) -> v0.2 tools({})",
            sp.len(),
            t.len()
        ));
        (t, true)
    } else {
        (default_tools(), true)
    };

    ensure_app_owned_entries(&mut tools);
    let publish_repo = raw.as_ref().and_then(|r| r.publish_repo.clone());
    let download_dir = raw.as_ref().and_then(|r| r.download_dir.clone());
    let ai_hint_dismissed = raw.as_ref().map(|r| r.ai_hint_dismissed).unwrap_or(false);
    let llm = raw
        .and_then(|r| r.llm)
        .unwrap_or_else(default_llm);
    let cfg = AppConfig { tools, llm, publish_repo, download_dir, ai_hint_dismissed };
    if migrated {
        let _ = save_config(&cfg); // 落盘固化迁移结果，下次启动走幂等路径
    }
    cfg
}

/// 确保「导入」源在 tools 中且启用（首次导入时调，PLAN-04 §3.1）
pub fn ensure_imported_scan_path() {
    let mut cfg = load_config();
    match cfg.tools.iter_mut().find(|t| t.id == TOOL_ID_IMPORTED) {
        Some(t) if !t.enabled => {
            t.enabled = true;
            let _ = save_config(&cfg);
        }
        Some(_) => {}
        None => {
            cfg.tools.push(app_owned_tool(TOOL_ID_IMPORTED, "导入"));
            let _ = save_config(&cfg);
        }
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    ensure_data_dir();
    let path = config_path();
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// D8：若 deploy_root 已等于某个 enabled 工具的扫描根，返回 (tool_id, label)。
/// 命中 → 归属该工具模块（扩现有根），不新建根。例：装到 ~/.codex/skills → codex。
pub fn find_tool_for_scan_path(deploy_root: &std::path::Path) -> Option<(String, String)> {
    let cfg = load_config();
    let norm = norm_for_compare(deploy_root);
    for t in scan_targets_from_tools(&cfg.tools) {
        if norm_for_compare(std::path::Path::new(&t.path)) == norm {
            return Some((t.tool_id.clone(), t.label.clone()));
        }
    }
    None
}

/// D7：为 deploy_root 新建自定义工具并持久化（auto-name 去重，从父目录名派生）。
/// 返回 (tool_id, name)。仅在 install 提交阶段调用（preview 不写配置）。
pub fn add_scan_root_tool(deploy_root: &std::path::Path) -> Result<(String, String), String> {
    let mut cfg = load_config();
    // 工具名 = 选定安装目录的末段（模块名）；skills 目录的父目录即选定目录
    let name0 = deploy_root
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "skills".to_string());
    let mut name = name0.clone();
    let mut k = 2;
    while cfg.tools.iter().any(|t| t.name == name) {
        name = format!("{}-{}", name0, k);
        k += 1;
    }
    let paths = vec![deploy_root.to_string_lossy().to_string()];
    let entry = add_tool(&mut cfg.tools, &name, &paths)?;
    let _ = save_config(&cfg);
    Ok((entry.id.clone(), entry.name.clone()))
}

/// 返回脱敏后的配置（供前端展示；工具清单走 hub_list_tools）
#[derive(Debug, Clone, Serialize)]
pub struct MaskedConfig {
    pub llm: MaskedLLM,
    pub _has_key: bool,
    /// 发布仓库配置（路径+URL，无敏感内容，原样返回）
    pub publish_repo: Option<PublishRepo>,
    /// PLAN-09 P5：当前生效的下载/导入目录
    pub download_dir: String,
    /// PLAN-12：AI 引导是否已永久关闭
    pub ai_hint_dismissed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MaskedLLM {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

pub fn load_masked_config() -> MaskedConfig {
    let cfg = load_config();
    let key = &cfg.llm.api_key;
    let masked_key = if key.len() > 8 {
        format!("{}****{}", &key[..4], &key[key.len() - 4..])
    } else if !key.is_empty() {
        "****".to_string()
    } else {
        String::new()
    };
    let download_dir = effective_import_path(&cfg).to_string_lossy().to_string();
    MaskedConfig {
        llm: MaskedLLM {
            api_key: masked_key,
            base_url: cfg.llm.base_url,
            model: cfg.llm.model,
        },
        _has_key: !cfg.llm.api_key.is_empty(),
        publish_repo: cfg.publish_repo,
        download_dir,
        ai_hint_dismissed: cfg.ai_hint_dismissed,
    }
}

// ---------------------------------------------------------------------------
// 测试（B1 验收：迁移不丢自定义路径 / $VAR~ 展开 / 注册表全量识别 / 幂等）
// 仅测纯函数；load_config/save_config 触碰真实数据目录，不在单测覆盖内。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sp(path: &str, label: &str, enabled: bool) -> ScanPathItem {
        ScanPathItem { path: path.into(), label: label.into(), enabled }
    }

    // ---- expand_path ----

    #[test]
    fn expand_absolute_passthrough() {
        let p = expand_path(r"C:\Users\x\.claude\skills").unwrap();
        assert_eq!(p, PathBuf::from(r"C:\Users\x\.claude\skills"));
    }

    #[test]
    fn expand_home_tilde() {
        let home = dirs::home_dir().expect("home");
        assert_eq!(expand_path("~/.claude/skills").unwrap(), home.join(".claude/skills"));
        assert_eq!(expand_path("~").unwrap(), home);
    }

    #[test]
    fn expand_env_var() {
        std::env::set_var("SK_TEST_HOME", r"C:\fake-codex");
        assert_eq!(
            expand_path("$SK_TEST_HOME/skills").unwrap(),
            PathBuf::from(r"C:\fake-codex\skills")
        );
        assert_eq!(expand_path("$SK_TEST_HOME").unwrap(), PathBuf::from(r"C:\fake-codex"));
        std::env::remove_var("SK_TEST_HOME");
        assert!(expand_path("$SK_TEST_HOME/skills").is_none()); // 未设置 → 候选失效
    }

    // ---- effective_import_path（P5 下载/导入目录）----

    fn cfg_with_download(dir: Option<String>) -> AppConfig {
        AppConfig {
            tools: vec![],
            llm: default_llm(),
            publish_repo: None,
            download_dir: dir,
            ai_hint_dismissed: false,
        }
    }

    #[test]
    fn effective_import_path_default_and_custom() {
        // None → 默认 %DATA%\imported
        assert_eq!(
            effective_import_path(&cfg_with_download(None)),
            get_data_dir().join("imported")
        );
        // 空串/纯空白 → 默认
        assert_eq!(
            effective_import_path(&cfg_with_download(Some("  ".to_string()))),
            get_data_dir().join("imported")
        );
        // 自定义绝对路径 → 原样使用
        assert_eq!(
            effective_import_path(&cfg_with_download(Some(r"D:\vault\skills".to_string()))),
            PathBuf::from(r"D:\vault\skills")
        );
        // 带 ~ → 展开为 home 下路径
        let home = dirs::home_dir().expect("home");
        assert_eq!(
            effective_import_path(&cfg_with_download(Some("~/downloads/skills".to_string()))),
            home.join("downloads/skills")
        );
    }

    #[test]
    fn expand_empty_or_bare_dollar() {
        assert!(expand_path("").is_none());
        assert!(expand_path("  ").is_none());
        assert!(expand_path("$/skills").is_none());
    }

    // ---- migrate_scan_paths_to_tools ----

    #[test]
    fn migrate_preserves_order_labels_and_custom_paths() {
        let items = vec![
            sp(r"C:\proj\skills", "builtin", true),
            sp(r"C:\Users\x\.claude\skills", "Claude", true),
            sp(r"D:\my\tools", "MyTools", true),
            sp(r"D:\my\tools2", "MyTools", false), // 同 label 合并
            sp(r"C:\data\imported", "导入", true),
        ];
        let tools = migrate_scan_paths_to_tools(&items);
        let ids: Vec<&str> = tools.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["builtin", "claude-code", "custom-mytools", "imported"]);

        let my = &tools[2];
        assert_eq!(my.paths.len(), 2, "同 label 两行合并为一个 tool 两条候选");
        assert!(my.enabled, "候选级开关坍缩为工具级 OR 语义");
        assert!(!my.builtin && my.linkable && !my.app_owned);

        let builtin = &tools[0];
        assert!(builtin.app_owned && !builtin.linkable && builtin.paths.is_empty());
    }

    #[test]
    fn migrate_known_label_custom_location_becomes_candidate() {
        // label 是已知工具但路径非标准（用户自定义 Codex 落点）→ 吸收为附加候选，不丢
        let items = vec![sp(r"D:\custom\codex-skills", "Codex", true)];
        let tools = migrate_scan_paths_to_tools(&items);
        assert_eq!(tools.len(), 1);
        let codex = &tools[0];
        assert_eq!(codex.id, "codex");
        assert!(codex.paths.iter().any(|p| p.contains("custom\\codex-skills") || p.contains("custom/codex-skills")));
        assert!(codex.paths.len() >= 4, "注册表模板 3 条 + 自定义 1 条");
    }

    #[test]
    fn migrate_empty_respects_user_intent() {
        assert!(migrate_scan_paths_to_tools(&[]).is_empty());
    }

    #[test]
    fn migrate_unlabeled_custom_uses_hash_id() {
        let items = vec![sp(r"D:\x\skills", "", true)];
        let tools = migrate_scan_paths_to_tools(&items);
        assert_eq!(tools.len(), 1);
        assert!(tools[0].id.starts_with("custom-"));
        assert_eq!(tools[0].name, r"D:\x\skills", "无 label 时以路径为名");
    }

    // ---- default_tools / ensure ----

    #[test]
    fn default_tools_full_registry_recognized() {
        let tools = default_tools();
        // builtin + 10 注册表 + 导入 + 创作（C5）
        assert_eq!(tools.len(), 13);
        assert_eq!(tools[0].id, "builtin");
        assert!(tools.iter().all(|t| t.enabled));
        let codex = tools.iter().find(|t| t.id == "codex").unwrap();
        assert_eq!(codex.paths.len(), 3);
        assert!(codex.paths[0].starts_with("$CODEX_HOME"));
        // 注册表工具全部 linkable，app_owned 全部不 linkable
        assert!(tools.iter().filter(|t| !t.app_owned).all(|t| t.linkable));
        assert!(tools.iter().filter(|t| t.app_owned).all(|t| !t.linkable));
    }

    #[test]
    fn ensure_app_owned_idempotent() {
        let mut tools = vec![];
        ensure_app_owned_entries(&mut tools);
        assert_eq!(tools.len(), 3);
        ensure_app_owned_entries(&mut tools);
        assert_eq!(tools.len(), 3, "重复调用不重复插入");
        assert_eq!(tools[0].id, "builtin", "builtin 恒在首位（扫描顺序锚点，B4 代表选取依赖）");
    }

    // ---- 工具 CRUD（B5 收尾，PLAN-06 §2.6）----

    #[test]
    fn add_tool_creates_linkable_custom_entry() {
        let mut tools = default_tools();
        let before = tools.len();
        let t = add_tool(&mut tools, "My Lab", &[r"D:\lab\skills".to_string()]).unwrap();
        assert_eq!(tools.len(), before + 1);
        assert_eq!(t.id, "custom-my-lab");
        assert!(!t.builtin && !t.app_owned && t.linkable && t.enabled);
        assert_eq!(t.paths, vec![r"D:\lab\skills".to_string()]);
    }

    #[test]
    fn add_tool_rejects_empty_name_or_paths() {
        let mut tools = default_tools();
        assert!(add_tool(&mut tools, "  ", &["D:\\x".to_string()]).is_err());
        assert!(add_tool(&mut tools, "X", &[]).is_err());
        assert!(add_tool(&mut tools, "X", &["   ".to_string()]).is_err());
        assert!(add_tool(&mut tools, "Claude Code", &["D:\\x".to_string()]).is_err(), "同名拒绝");
    }

    #[test]
    fn add_tool_slug_collision_gets_suffix() {
        let mut tools = default_tools();
        let a = add_tool(&mut tools, "My Lab", &["D:\\a".to_string()]).unwrap();
        let b = add_tool(&mut tools, "my-lab", &["D:\\b".to_string()]).unwrap();
        assert_eq!(a.id, "custom-my-lab");
        assert_eq!(b.id, "custom-my-lab-2", "slug 碰撞追加序号");
    }

    #[test]
    fn update_tool_enabled_paths_and_rename() {
        let mut tools = default_tools();
        add_tool(&mut tools, "Lab", &["D:\\a".to_string()]).unwrap();
        let t = update_tool(
            &mut tools,
            "custom-lab",
            Some("Lab2"),
            Some(&["D:\\b".to_string()]),
            Some(false),
        )
        .unwrap();
        assert_eq!(t.name, "Lab2");
        assert_eq!(t.paths, vec![r"D:\b".to_string()]);
        assert!(!t.enabled);
        // builtin 工具只允许改 enabled
        let claude = update_tool(&mut tools, "claude-code", Some("Hack"), None, Some(false)).unwrap();
        assert_eq!(claude.name, "Claude Code", "builtin 名称不可改");
        assert!(!claude.enabled);
    }

    #[test]
    fn update_tool_missing_id_errors() {
        let mut tools = default_tools();
        assert!(update_tool(&mut tools, "nope", None, None, Some(true)).is_err());
    }

    #[test]
    fn remove_tool_rejects_builtin_keeps_custom() {
        let mut tools = default_tools();
        assert!(remove_tool(&mut tools, "builtin").is_err());
        assert!(remove_tool(&mut tools, "claude-code").is_err());
        assert!(remove_tool(&mut tools, "imported").is_err());
        add_tool(&mut tools, "Lab", &["D:\\a".to_string()]).unwrap();
        let removed = remove_tool(&mut tools, "custom-lab").unwrap();
        assert_eq!(removed.id, "custom-lab");
        assert!(remove_tool(&mut tools, "custom-lab").is_err(), "二次删除报错");
    }

    #[test]
    fn migrate_mixed_separator_duplicates_deduped() {
        // 真实配置实测边界：同目录以反斜杠与混合分隔符两种形态出现（Claude/OpenCode
        // 各有两行）→ 必须坍缩为单一候选，否则重复扫描产生重复卡片
        let home = dirs::home_dir().unwrap();
        let bs = home.join(".claude\\skills").to_string_lossy().to_string();
        let mixed = home.join(".claude/skills").to_string_lossy().to_string();
        let items = vec![sp(&bs, "Claude", true), sp(&mixed, "Claude", true)];
        let tools = migrate_scan_paths_to_tools(&items);
        assert_eq!(tools.len(), 1);
        let claude = &tools[0];
        let home_variants = claude
            .paths
            .iter()
            .filter(|p| p.contains(".claude"))
            .count();
        assert_eq!(home_variants, 1, "分隔符变体必须去重: {:?}", claude.paths);
    }

    #[test]
    fn scan_targets_dedup_separator_variants() {
        let tmp = std::env::temp_dir().join(format!("sk-b1-dedup-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let bs = tmp.to_string_lossy().to_string();
        let mixed = bs.replace('\\', "/");
        let tool = ToolEntry {
            id: "t".into(),
            name: "T".into(),
            paths: vec![bs.clone(), mixed],
            builtin: false,
            enabled: true,
            linkable: true,
            app_owned: false,
        };
        let items = scan_targets_from_tools(&[tool]);
        assert_eq!(items.len(), 1, "同目录两种分隔符形态只扫一次");
        assert_eq!(items[0].tool_id, "t");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ---- serde round-trip（tools 字段缺失/存在的读兼容）----

    #[test]
    fn raw_config_distinguishes_absent_vs_empty_scan_paths() {
        // 旧格式（有 scan_paths 键）
        let old = r#"{"scan_paths":[{"path":"D:\\a","label":"MyTools","enabled":true}]}"#;
        let raw: RawConfig = serde_json::from_str(old).unwrap();
        assert!(raw.tools.is_none());
        assert_eq!(raw.scan_paths.as_ref().unwrap().len(), 1);

        // 显式空数组 ≠ 缺失
        let empty = r#"{"scan_paths":[]}"#;
        let raw: RawConfig = serde_json::from_str(empty).unwrap();
        assert_eq!(raw.scan_paths.as_ref().unwrap().len(), 0);

        // 新格式
        let new = r#"{"tools":[{"id":"builtin","name":"builtin","builtin":true,"enabled":true,"linkable":false,"app_owned":true}]}"#;
        let raw: RawConfig = serde_json::from_str(new).unwrap();
        assert!(raw.tools.is_some());
        assert!(raw.scan_paths.is_none());
    }

    #[test]
    fn tool_entry_serde_defaults() {
        // 手写最小 JSON：缺省字段取默认值（enabled/linkable 默认 true）
        let minimal = r#"{"id":"x","name":"X"}"#;
        let t: ToolEntry = serde_json::from_str(minimal).unwrap();
        assert!(t.enabled && t.linkable && !t.builtin && !t.app_owned && t.paths.is_empty());
    }
}
