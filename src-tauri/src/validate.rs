//! 模块 C：技能规范校验器（PLAN-06 §3）
//!
//! C1：骨架 + FM 规则组。C2：CL/CX 生态规则组。
//! - 独立模块，不依赖扫描管线：可校验任意目录（含未纳入扫描的草稿目录）。
//! - 双轨模式（§3.6）：Diagnostic 永不 fail（passed 恒 true）；Strict 下 Error 阻断。
//! - 规则表 = 数据 + 检查函数（§3.5）；strict_error 规则在严格模式升 Error。
//! - FM-01..08（§3.5 FM 层）：FM 层只做类型/格式检查，绝不报"未知字段"（CL/CX 层职责，C2）。
//! - CL-01..03 / CX-01..04（C2，§3.5 + R2-d）：白名单按生态分治——CL 七字段
//!   （含 user-invocable / disable-model-invocation），CX 五字段（Codex quick_validate.py
//!   基线）。两字段在 CX 侧报未知属正确行为，由兼容矩阵分流（Claude pass / Codex warn）。
//! - PM-01：SkillsShark 平台元数据使用 `metadata.skills-shark` 命名空间；平台字段不加入
//!   CL/CX 顶层白名单，避免被目标生态误认为原生 frontmatter 字段。
//!
//! 规则来源：两份官方 skill-creator 的 quick_validate.py 差异比对（§3.1）：
//! - name/description 必填、description 无尖括号 = 两家共识（All）
//! - name hyphen-case / name ≤64 / description ≤1024 = Codex 侧规则（Codex）
//! - user-invocable / disable-model-invocation 布尔类型 = Claude 合法字段（Claude）

use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// 数据结构（§3.6 统一输出）
// ---------------------------------------------------------------------------

/// 校验模式（§3.6 双轨）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// 诊断：浏览/创作实时反馈，永不阻断
    Diagnostic,
    /// 严格：发布前闸，Error 阻断
    Strict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warn,
    Info,
}

/// 规则所属生态（决定计入哪侧矩阵）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eco {
    All,
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub rule_id: String,
    pub severity: Severity,
    pub message: String,
    pub path: String,
    pub hint: String,
    /// 矩阵分流用，不下发前端
    #[serde(skip)]
    pub eco: Eco,
}

#[derive(Debug, Clone, Serialize)]
pub struct EcoVerdict {
    pub verdict: Verdict,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Matrix {
    pub claude: EcoVerdict,
    pub codex: EcoVerdict,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    pub mode: Mode,
    pub passed: bool,
    pub issues: Vec<Issue>,
    pub matrix: Matrix,
}

// ---------------------------------------------------------------------------
// 技能文件集（校验输入）
// ---------------------------------------------------------------------------

/// 一个技能目录的校验输入快照。SKILL.md 缺失/损坏也要能表达（FM-01 依赖）。
pub struct SkillFileset {
    /// 技能目录。CL-01 比对目录名；FS 规则组（后续）以其为基准
    pub dir: PathBuf,
    pub skill_md_exists: bool,
    /// frontmatter 解析结果；None = 缺失或解析失败
    pub frontmatter: Option<Mapping>,
    /// frontmatter 缺失/解析失败的原因（供 FM-01 措辞）
    pub fm_error: Option<String>,
    /// 是否存在 agents/ 目录（Codex 产品层约定："Other product-specific config
    /// can also live in the agents/ folder"，官方 references/openai_yaml.md）
    pub agents_dir: bool,
    /// 是否存在 agents/openai.yaml
    pub has_openai_yaml: bool,
    /// agents/openai.yaml 解析出的 interface 层（CX-03/CX-04 输入）；
    /// None = 文件缺失 / 损坏 / 无 interface 段
    pub codex_interface: Option<CodexInterface>,
}

/// openai.yaml 的 `interface:` 段（官方 schema 全部字段位于 interface 之下，R2-a）。
/// 每个字段：None = 未提供（官方视为可选，不报）；Some(Err) = 提供但类型错误。
/// 仅收录 CX-03/CX-04 实际用到的字段；display_name 等无规则约束的字段不解析，
/// 避免 dead_code（官方可选字段，未来加规则时再收录）。
#[derive(Debug, Clone)]
pub struct CodexInterface {
    pub short_description: Option<Result<String, ()>>,
    pub default_prompt: Option<Result<String, ()>>,
}

/// 从目录加载文件集。SKILL.md 不存在时返回 exists=false 的空快照，不报 Err。
pub fn load_fileset(dir: &Path) -> SkillFileset {
    let path = dir.join("SKILL.md");
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => {
            return SkillFileset {
                dir: dir.to_path_buf(),
                skill_md_exists: false,
                frontmatter: None,
                fm_error: None,
                agents_dir: false,
                has_openai_yaml: false,
                codex_interface: None,
            }
        }
    };
    let (fm, fm_error) = match extract_frontmatter(&text) {
        Some(yaml) => match serde_yaml_ng::from_str::<Value>(&yaml) {
            Ok(Value::Mapping(m)) => (Some(m), None),
            Ok(_) => (None, Some("frontmatter 不是键值结构".to_string())),
            Err(e) => (None, Some(format!("YAML 解析失败: {}", e))),
        },
        None => (None, Some("缺少 frontmatter（文件需以 --- 包裹的 YAML 头开始）".to_string())),
    };
    let (agents_dir, has_openai_yaml, codex_interface) = load_codex_layer(dir);
    SkillFileset {
        dir: dir.to_path_buf(),
        skill_md_exists: true,
        frontmatter: fm,
        fm_error,
        agents_dir,
        has_openai_yaml,
        codex_interface,
    }
}

/// 探测 Codex 产品层（openai.yaml）。生态形态由文件集决定：
/// Claude 形态 = 仅 SKILL.md（+资源目录）；Codex 形态 = 带 agents/openai.yaml。
fn load_codex_layer(dir: &Path) -> (bool, bool, Option<CodexInterface>) {
    let agents = dir.join("agents");
    let agents_dir = agents.is_dir();
    let yaml_path = agents.join("openai.yaml");
    match std::fs::read_to_string(&yaml_path) {
        Ok(text) => (agents_dir, true, parse_codex_interface(&text)),
        Err(_) => (agents_dir, false, None),
    }
}

/// 解析 openai.yaml 的 interface 段。文件损坏 / 顶层非映射 / 无 interface 段 → None。
fn parse_codex_interface(text: &str) -> Option<CodexInterface> {
    let root: Value = serde_yaml_ng::from_str(text).ok()?;
    let interface = root.get("interface")?;
    let m = interface.as_mapping()?;
    let field = |key: &str| match m.get(&Value::String(key.to_string())) {
        None => None,
        Some(Value::String(s)) => Some(Ok(s.clone())),
        Some(_) => Some(Err(())),
    };
    Some(CodexInterface {
        short_description: field("short_description"),
        default_prompt: field("default_prompt"),
    })
}

/// 提取 `---` 包裹的 frontmatter YAML 文本。容忍 BOM 与 CRLF。
fn extract_frontmatter(text: &str) -> Option<String> {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    // 首行必须是 ---（允许前导空行）
    loop {
        match lines.next() {
            Some(l) if l.trim().is_empty() => continue,
            Some(l) if l.trim() == "---" => break,
            _ => return None,
        }
    }
    let mut yaml = Vec::new();
    for l in lines {
        if l.trim() == "---" {
            return Some(yaml.join("\n"));
        }
        yaml.push(l);
    }
    None // 没有闭合 ---
}

fn fm_value<'a>(m: &'a Mapping, key: &str) -> Option<&'a Value> {
    m.get(&Value::String(key.to_string()))
}

const PLATFORM_METADATA_NAMESPACE: &str = "skills-shark";
const PLATFORM_TRIGGER_KEYWORDS: &str = "trigger_keywords";

// ---------------------------------------------------------------------------
// 规则表（§3.5 数据 + 检查函数）
// ---------------------------------------------------------------------------

struct RuleSpec {
    id: &'static str,
    base: Severity,
    /// strict 模式下 Warn 升 Error（§3.6：名称规范等卫生类规则严格模式升级）
    strict_error: bool,
    eco: Eco,
    check: fn(&SkillFileset) -> Option<(String, String)>, // (message, hint)
}

pub(crate) fn is_hyphen_case(s: &str) -> bool {
    !s.is_empty()
        && s
            .split('-')
            .all(|seg| !seg.is_empty() && seg.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

fn check_fm01(fs: &SkillFileset) -> Option<(String, String)> {
    if !fs.skill_md_exists {
        return Some((
            "未找到 SKILL.md".to_string(),
            "技能目录必须包含 SKILL.md".to_string(),
        ));
    }
    if fs.frontmatter.is_none() {
        return Some((
            format!("frontmatter 不可用：{}", fs.fm_error.as_deref().unwrap_or("未知原因")),
            "检查文件以 --- 开头与结尾包裹 YAML 头，且语法正确".to_string(),
        ));
    }
    None
}

fn check_required_string(fs: &SkillFileset, key: &'static str) -> Option<(String, String)> {
    let Some(m) = &fs.frontmatter else {
        return None; // FM-01 已报，不连锁
    };
    match fm_value(m, key) {
        None => Some((
            format!("frontmatter 缺少 {} 字段", key),
            format!("{} 为必填字段", key),
        )),
        Some(Value::String(s)) if s.trim().is_empty() => Some((
            format!("{} 不能为空", key),
            format!("请填写有意义的 {}", key),
        )),
        Some(Value::String(_)) => None,
        Some(_) => Some((
            format!("{} 必须是字符串", key),
            format!("将 {} 的值写成带引号的字符串", key),
        )),
    }
}

fn check_fm02(fs: &SkillFileset) -> Option<(String, String)> {
    check_required_string(fs, "name")
}

fn check_fm03(fs: &SkillFileset) -> Option<(String, String)> {
    check_required_string(fs, "description")
}

fn name_str(fs: &SkillFileset) -> Option<String> {
    fs.frontmatter
        .as_ref()
        .and_then(|m| fm_value(m, "name"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
}

fn desc_str(fs: &SkillFileset) -> Option<String> {
    fs.frontmatter
        .as_ref()
        .and_then(|m| fm_value(m, "description"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
}

fn check_fm04(fs: &SkillFileset) -> Option<(String, String)> {
    let name = name_str(fs)?;
    if is_hyphen_case(&name) {
        None
    } else {
        Some((
            format!("name '{}' 不符合 hyphen-case 规范", name),
            "仅小写字母/数字/连字符，不能首尾连字符或连续连字符".to_string(),
        ))
    }
}

fn check_fm05(fs: &SkillFileset) -> Option<(String, String)> {
    let name = name_str(fs)?;
    if name.chars().count() > 64 {
        Some((
            format!("name 长度 {} 超过 64 字符上限", name.chars().count()),
            "缩短 name（Codex 生态上限 64 字符）".to_string(),
        ))
    } else {
        None
    }
}

fn check_fm06(fs: &SkillFileset) -> Option<(String, String)> {
    let desc = desc_str(fs)?;
    if desc.contains('<') || desc.contains('>') {
        Some((
            "description 含有尖括号".to_string(),
            "移除 < > 字符（两家官方校验器均禁止）".to_string(),
        ))
    } else {
        None
    }
}

fn check_fm07(fs: &SkillFileset) -> Option<(String, String)> {
    let desc = desc_str(fs)?;
    if desc.chars().count() > 1024 {
        Some((
            format!("description 长度 {} 超过 1024 字符上限", desc.chars().count()),
            "精简 description（Codex 生态上限 1024 字符）".to_string(),
        ))
    } else {
        None
    }
}

fn check_fm08(fs: &SkillFileset) -> Option<(String, String)> {
    let Some(m) = &fs.frontmatter else {
        return None;
    };
    for key in ["user-invocable", "disable-model-invocation"] {
        if let Some(v) = fm_value(m, key) {
            if !v.is_bool() {
                return Some((
                    format!("字段 '{}' 必须是布尔值", key),
                    "写成 true / false（不加引号）".to_string(),
                ));
            }
        }
    }
    None
}

/// PM-01：校验 SkillsShark 自有元数据的最小结构。
///
/// `metadata` 是 CL/CX 两侧都认可的顶层容器，但其内部仍属于平台私有数据。
/// 只识别 `metadata.skills-shark.trigger_keywords`，不约束其他生态/第三方元数据。
/// 关键词暂只要求为非空字符串列表，不把数量或语义规则写死在生态校验器中。
fn check_platform_metadata(fs: &SkillFileset) -> Option<(String, String)> {
    let Some(frontmatter) = &fs.frontmatter else {
        return None;
    };
    let Some(metadata) = fm_value(frontmatter, "metadata") else {
        return None;
    };
    let Some(metadata) = metadata.as_mapping() else {
        // 保持兼容：没有可访问的命名空间时，不重新定义第三方 metadata 的整体形态。
        return None;
    };
    let Some(platform) = metadata.get(&Value::String(PLATFORM_METADATA_NAMESPACE.to_string()))
    else {
        return None;
    };
    let Some(platform) = platform.as_mapping() else {
        return Some((
            format!(
                "metadata.{} 必须是键值结构",
                PLATFORM_METADATA_NAMESPACE
            ),
            format!(
                "平台元数据请写在 metadata.{} 下的对象中",
                PLATFORM_METADATA_NAMESPACE
            ),
        ));
    };
    let Some(keywords) = platform.get(&Value::String(PLATFORM_TRIGGER_KEYWORDS.to_string()))
    else {
        return None;
    };
    let Some(items) = keywords.as_sequence() else {
        return Some((
            format!(
                "metadata.{}.{} 必须是字符串列表",
                PLATFORM_METADATA_NAMESPACE, PLATFORM_TRIGGER_KEYWORDS
            ),
            "例如：trigger_keywords: [docker, container]".to_string(),
        ));
    };
    if items.is_empty()
        || items.iter().any(|item| {
            !matches!(item, Value::String(value) if !value.trim().is_empty())
        })
    {
        return Some((
            format!(
                "metadata.{}.{} 必须是非空字符串列表",
                PLATFORM_METADATA_NAMESPACE, PLATFORM_TRIGGER_KEYWORDS
            ),
            "列表中的每一项都应是非空触发关键词".to_string(),
        ));
    }
    None
}

// ---- CL：Claude 生态（C2，§3.5 + R2-d）----

/// CL 白名单（R2-d）= Codex 基线五字段 ∪ Claude Code 两个合法布尔字段
const CL_WHITELIST: &[&str] = &[
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
    "user-invocable",
    "disable-model-invocation",
];

/// CX 白名单 = Codex quick_validate.py 基线五字段（R2-d：不收录两布尔字段）
const CX_WHITELIST: &[&str] = &["name", "description", "license", "allowed-tools", "metadata"];

/// 名单外字段列表化（排序保证输出稳定）。非字符串键属 YAML 异常形态，
/// 归 FM-01 语义，不在此重复报
fn unknown_fields(m: &Mapping, whitelist: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = m
        .clone()
        .into_iter()
        .filter_map(|(k, _)| match k {
            Value::String(s) if !whitelist.contains(&s.as_str()) => Some(s),
            _ => None,
        })
        .collect();
    out.sort();
    out
}

/// CL-01：name 与目录名一致（Warn；目录名随安装位置变化，严格模式不升级）
fn check_cl01(fs: &SkillFileset) -> Option<(String, String)> {
    let name = name_str(fs)?;
    let dir_name = fs.dir.file_name()?.to_string_lossy().to_string();
    if name == dir_name {
        None
    } else {
        Some((
            format!("name '{}' 与目录名 '{}' 不一致", name, dir_name),
            "Claude 生态约定文件夹与 name 完全一致；重命名目录或修改 name".to_string(),
        ))
    }
}

/// CL-02：CL 白名单外字段列表化提示（诊断 Warn，严格升 Error）
fn check_cl02(fs: &SkillFileset) -> Option<(String, String)> {
    let m = fs.frontmatter.as_ref()?;
    let unknown = unknown_fields(m, CL_WHITELIST);
    if unknown.is_empty() {
        None
    } else {
        Some((
            format!("Claude 生态未知字段：{}", unknown.join(", ")),
            "Claude 白名单 = name, description, license, allowed-tools, metadata, \
             user-invocable, disable-model-invocation；移除或改名名单外字段"
                .to_string(),
        ))
    }
}

/// CL-03：allowed-tools 字符串形态提示（Claude 官方用列表；字符串形态仍被接受，
/// 属建议级，严格模式不升级）
fn check_cl03(fs: &SkillFileset) -> Option<(String, String)> {
    let m = fs.frontmatter.as_ref()?;
    match fm_value(m, "allowed-tools") {
        Some(Value::String(_)) => Some((
            "allowed-tools 为字符串形态".to_string(),
            "Claude 官方使用列表形态（如 [\"Read\", \"Bash\"]）".to_string(),
        )),
        _ => None,
    }
}

// ---- CX：Codex 生态（C2，§3.5 + R2-d + §3.1 openai.yaml）----

/// CX-01：openai.yaml 存在性（Info）。仅当 agents/ 目录已存在（Codex 产品层意图）
/// 时才提示缺失——纯 Claude 形态（无 agents/）缺席属正常，不打扰
fn check_cx01(fs: &SkillFileset) -> Option<(String, String)> {
    if fs.agents_dir && !fs.has_openai_yaml {
        Some((
            "存在 agents/ 目录但未找到 agents/openai.yaml".to_string(),
            "openai.yaml 为 Codex 界面元数据层；不需要可移除 agents/ 目录".to_string(),
        ))
    } else {
        None
    }
}

/// CX-02：CX 白名单外字段（Codex 五字段基线）。R2-d 核心：
/// user-invocable / disable-model-invocation 在此报未知是正确行为（矩阵分流）
fn check_cx02(fs: &SkillFileset) -> Option<(String, String)> {
    let m = fs.frontmatter.as_ref()?;
    let unknown = unknown_fields(m, CX_WHITELIST);
    if unknown.is_empty() {
        None
    } else {
        Some((
            format!("Codex 生态未知字段：{}", unknown.join(", ")),
            "Codex 白名单 = name, description, license, allowed-tools, metadata\
             （quick_validate.py 基线）；移除或改名名单外字段"
                .to_string(),
        ))
    }
}

/// CX-03：interface.default_prompt 须显式提及 `$skill-name`（官方 references/openai_yaml.md：
/// "It must explicitly mention the skill as $skill-name"）。字段本身可选——官方原件即无此字段，
/// 故仅在场时检查，缺席不报
fn check_cx03(fs: &SkillFileset) -> Option<(String, String)> {
    let itf = fs.codex_interface.as_ref()?;
    match &itf.default_prompt {
        None => None,
        Some(Err(())) => Some((
            "openai.yaml 的 interface.default_prompt 必须是字符串".to_string(),
            "写成带引号的字符串，如 \"Use $skill-name to …\"".to_string(),
        )),
        Some(Ok(p)) if !p.contains("$skill-name") => Some((
            "openai.yaml 的 default_prompt 未包含 $skill-name".to_string(),
            "官方约定 default_prompt 须显式提及技能，如 \"Use $skill-name to …\""
                .to_string(),
        )),
        Some(Ok(_)) => None,
    }
}

/// CX-04：interface.short_description 长度区间。官方 schema 标称 25–64，但官方原件
/// skill-creator 为 24 字符（"Create or update a skill"）——原件与规则冲突时以原件为准，
/// 下限豁免；上限 64 无冲突，照章执行（严格模式升 Error）。字段缺席不报（官方原件无此字段亦合法）
fn check_cx04(fs: &SkillFileset) -> Option<(String, String)> {
    let itf = fs.codex_interface.as_ref()?;
    match &itf.short_description {
        Some(Ok(s)) if s.chars().count() > 64 => Some((
            format!("openai.yaml 的 short_description 长度 {} 超过 64 字符上限", s.chars().count()),
            "精简 short_description（官方建议 25–64 字符）".to_string(),
        )),
        Some(Err(())) => Some((
            "openai.yaml 的 interface.short_description 必须是字符串".to_string(),
            "写成带引号的字符串".to_string(),
        )),
        _ => None,
    }
}

/// FM 规则组（C1）+ CL/CX 规则组（C2）。FS 规则组待后续追加。
/// CL/CX id 分配：§3.6 输出样例将"未知字段"钉在 CX-02，故 CX-01 = openai.yaml 存在性；
/// CL 侧无样例约束，按 §3.5 行文顺序取 CL-01..03（PLAN-06 标 CL-01..05 但仅定义三条语义）
static RULES: &[RuleSpec] = &[
    RuleSpec { id: "FM-01", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm01 },
    RuleSpec { id: "FM-02", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm02 },
    RuleSpec { id: "FM-03", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm03 },
    RuleSpec { id: "FM-04", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_fm04 },
    RuleSpec { id: "FM-05", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_fm05 },
    RuleSpec { id: "FM-06", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm06 },
    RuleSpec { id: "FM-07", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_fm07 },
    RuleSpec { id: "FM-08", base: Severity::Error, strict_error: false, eco: Eco::Claude, check: check_fm08 },
    RuleSpec { id: "PM-01", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_platform_metadata },
    RuleSpec { id: "CL-01", base: Severity::Warn, strict_error: false, eco: Eco::Claude, check: check_cl01 },
    RuleSpec { id: "CL-02", base: Severity::Warn, strict_error: true, eco: Eco::Claude, check: check_cl02 },
    RuleSpec { id: "CL-03", base: Severity::Warn, strict_error: false, eco: Eco::Claude, check: check_cl03 },
    RuleSpec { id: "CX-01", base: Severity::Info, strict_error: false, eco: Eco::Codex, check: check_cx01 },
    RuleSpec { id: "CX-02", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_cx02 },
    RuleSpec { id: "CX-03", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_cx03 },
    RuleSpec { id: "CX-04", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_cx04 },
];

// ---------------------------------------------------------------------------
// 校验入口
// ---------------------------------------------------------------------------

pub fn validate_fileset(fs: &SkillFileset, mode: Mode) -> ValidationReport {
    let mut issues: Vec<Issue> = Vec::new();
    for rule in RULES {
        if let Some((message, hint)) = (rule.check)(fs) {
            let severity = match (mode, rule.base, rule.strict_error) {
                (Mode::Strict, Severity::Warn, true) => Severity::Error,
                _ => rule.base,
            };
            issues.push(Issue {
                rule_id: rule.id.to_string(),
                severity,
                message,
                path: "SKILL.md".to_string(),
                hint,
                eco: rule.eco,
            });
        }
    }
    let passed = match mode {
        Mode::Diagnostic => true, // §3.6：诊断模式永不 fail
        Mode::Strict => !issues.iter().any(|i| i.severity == Severity::Error),
    };
    ValidationReport {
        mode,
        passed,
        matrix: Matrix {
            claude: eco_verdict(&issues, Eco::Claude, mode),
            codex: eco_verdict(&issues, Eco::Codex, mode),
        },
        issues,
    }
}

/// 校验任意技能目录（§3.8：独立可用，创作页实时校验也走它）。
pub fn validate_dir(dir: &Path, mode: Mode) -> ValidationReport {
    validate_fileset(&load_fileset(dir), mode)
}

fn eco_verdict(issues: &[Issue], eco: Eco, mode: Mode) -> EcoVerdict {
    let rel: Vec<&Issue> = issues
        .iter()
        .filter(|i| i.eco == Eco::All || i.eco == eco)
        .collect();
    let notes = rel
        .iter()
        .filter(|i| i.severity != Severity::Info)
        .map(|i| format!("[{}] {}", i.rule_id, i.message))
        .collect();
    let has_error = rel.iter().any(|i| i.severity == Severity::Error);
    let has_warn = rel.iter().any(|i| i.severity == Severity::Warn);
    let verdict = if has_error && mode == Mode::Strict {
        Verdict::Fail
    } else if has_error || has_warn {
        Verdict::Warn
    } else {
        Verdict::Pass
    };
    EcoVerdict { verdict, notes }
}

// ---------------------------------------------------------------------------
// 测试（C1 验收：两份官方原件 fixture + 规则单测）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fileset_from(content: &str) -> (tempfile::TempDir, SkillFileset) {
        fileset_named(frontmatter_name(content).as_deref(), content)
    }

    /// 技能目录语义：目录名取自 frontmatter name（无则给定名），
    /// 默认不制造 CL-01 名字/目录不一致噪声
    fn fileset_named(dir_name: Option<&str>, content: &str) -> (tempfile::TempDir, SkillFileset) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(dir_name.unwrap_or("unnamed-skill"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), content).unwrap();
        let fs = load_fileset(&dir);
        (tmp, fs)
    }

    /// 从 SKILL.md 文本粗提取 frontmatter 的 name 值（测试助手用，容错宽松）
    fn frontmatter_name(content: &str) -> Option<String> {
        let text = content.trim_start_matches('\u{feff}');
        let mut lines = text.lines();
        if lines.next()?.trim() != "---" {
            return None;
        }
        for l in lines {
            let t = l.trim();
            if t == "---" {
                break;
            }
            if let Some(v) = t.strip_prefix("name:") {
                let v = v.trim().trim_matches('"').trim_matches('\'').trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
        None
    }

    /// 带 agents/openai.yaml 的 Codex 形态文件集
    fn fileset_with_openai_yaml(skill_md: &str, openai_yaml: &str) -> (tempfile::TempDir, SkillFileset) {
        let (tmp, _) = fileset_from(skill_md);
        let dir = tmp
            .path()
            .read_dir()
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().is_dir())
            .expect("fileset_from 应创建技能子目录")
            .path();
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        std::fs::write(dir.join("agents").join("openai.yaml"), openai_yaml).unwrap();
        let fs = load_fileset(&dir);
        (tmp, fs)
    }

    fn rule_ids(rep: &ValidationReport) -> Vec<String> {
        rep.issues.iter().map(|i| i.rule_id.clone()).collect()
    }

    // ---- FM-01：SKILL.md 存在性 / frontmatter 可解析 ----

    #[test]
    fn fm01_missing_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let rep = validate_dir(tmp.path(), Mode::Strict);
        assert!(!rep.passed);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_no_frontmatter() {
        let (_t, fs) = fileset_from("# 只有正文没有头\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_broken_yaml() {
        let (_t, fs) = fileset_from("---\nname: [unclosed\n---\nbody\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_unclosed_frontmatter() {
        let (_t, fs) = fileset_from("---\nname: x\n没有闭合线\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_tolerates_bom_and_crlf() {
        let (_t, fs) = fileset_from("\u{feff}---\r\nname: ok-skill\r\ndescription: fine\r\n---\r\nbody\r\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rep.issues.is_empty(), "{:?}", rep.issues);
    }

    // ---- FM-02 / FM-03：必填字段 ----

    #[test]
    fn fm02_missing_name() {
        let (_t, fs) = fileset_from("---\ndescription: has desc\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-02".to_string()));
    }

    #[test]
    fn fm02_non_string_name() {
        let (_t, fs) = fileset_from("---\nname: 123\ndescription: d\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-02".to_string()));
    }

    #[test]
    fn fm03_empty_description() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: \"   \"\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-03".to_string()));
    }

    // ---- FM-04：hyphen-case（Codex 生态） ----

    #[test]
    fn fm04_format_violations() {
        for bad in ["Pdf-Toolkit", "pdf_toolkit", "-pdf", "pdf-", "pdf--x", "pdf toolkit"] {
            let content = format!("---\nname: {}\ndescription: d\n---\n", bad);
            let (_t, fs) = fileset_from(&content);
            let rep = validate_fileset(&fs, Mode::Strict);
            assert!(
                rule_ids(&rep).contains(&"FM-04".to_string()),
                "'{}' 应触发 FM-04",
                bad
            );
            // Codex 侧受影响，Claude 侧必须无感
            assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
            assert_eq!(rep.matrix.codex.verdict, Verdict::Fail);
        }
    }

    #[test]
    fn fm04_valid_names_pass() {
        for ok in ["pdf", "pdf-toolkit", "a1-b2", "gh-address-comments"] {
            let content = format!("---\nname: {}\ndescription: d\n---\n", ok);
            let (_t, fs) = fileset_from(&content);
            let rep = validate_fileset(&fs, Mode::Strict);
            assert!(!rule_ids(&rep).contains(&"FM-04".to_string()), "'{}' 不应触发", ok);
        }
    }

    // ---- FM-05：name ≤ 64 ----

    #[test]
    fn fm05_name_too_long() {
        let long = "a".repeat(65);
        let (_t, fs) = fileset_from(&format!("---\nname: {}\ndescription: d\n---\n", long));
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-05".to_string()));
    }

    // ---- FM-06：description 尖括号（两家共识） ----

    #[test]
    fn fm06_angle_brackets() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: use <b> tags\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-06".to_string()));
        // 两家共识 → 双侧矩阵都计入
        assert_eq!(rep.matrix.claude.verdict, Verdict::Fail);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Fail);
    }

    // ---- FM-07：description ≤ 1024 ----

    #[test]
    fn fm07_description_too_long() {
        let long = "x".repeat(1025);
        let (_t, fs) = fileset_from(&format!("---\nname: ok\ndescription: {}\n---\n", long));
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-07".to_string()));
    }

    // ---- FM-08：Claude 布尔字段类型检查 ----

    #[test]
    fn fm08_boolean_type_check() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: d\nuser-invocable: \"yes\"\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-08".to_string()));
        // Claude 生态字段：claude 侧 FM-08 类型错误 → fail
        assert_eq!(rep.matrix.claude.verdict, Verdict::Fail);
        // C2 后：user-invocable 在 Codex 侧属未知字段（R2-d 正确行为），
        // CX-02 严格模式升 Error → codex fail（诊断模式下为 warn）
        assert_eq!(rep.matrix.codex.verdict, Verdict::Fail);
    }

    #[test]
    fn fm08_boolean_ok() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: d\nuser-invocable: true\ndisable-model-invocation: false\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"FM-08".to_string()));
    }

    // ---- 双轨模式（§3.6） ----

    #[test]
    fn dual_track_diagnostic_never_fails() {
        let (_t, fs) = fileset_from("---\nname: Bad_Name\ndescription: d\n---\n");
        let diag = validate_fileset(&fs, Mode::Diagnostic);
        assert!(diag.passed, "诊断模式 passed 恒 true");
        assert_ne!(diag.matrix.codex.verdict, Verdict::Fail, "诊断模式 verdict 不得 fail");
        // 卫生类规则诊断模式保持 Warn
        let fm04 = diag.issues.iter().find(|i| i.rule_id == "FM-04").unwrap();
        assert_eq!(fm04.severity, Severity::Warn);

        let strict = validate_fileset(&fs, Mode::Strict);
        assert!(!strict.passed, "严格模式必须阻断");
        assert_eq!(strict.matrix.codex.verdict, Verdict::Fail);
        let fm04s = strict.issues.iter().find(|i| i.rule_id == "FM-04").unwrap();
        assert_eq!(fm04s.severity, Severity::Error, "严格模式升级为 Error");
    }

    #[test]
    fn diagnostic_still_reports_structural_errors_but_never_fails() {
        let (_t, fs) = fileset_from("---\ndescription: no name\n---\n");
        let diag = validate_fileset(&fs, Mode::Diagnostic);
        assert!(diag.passed);
        assert!(rule_ids(&diag).contains(&"FM-02".to_string()));
        assert_ne!(diag.matrix.claude.verdict, Verdict::Fail);
    }

    // ---- C1 验收：官方原件 fixture ----

    /// Claude 官方 skill-creator 形态的合规 fixture（本机原件已缺失，用符合
    /// Claude 规范的合成件替代：仅 name/description，格式合规）。
    #[test]
    fn fixture_claude_convention_all_green() {
        let (_t, fs) = fileset_from(
            "---\nname: skill-creator\ndescription: Guide for creating effective Agent Skills. Use when users want to create, update, or validate a skill.\n---\n\n# Skill Creator\n\nBody content.\n",
        );
        for mode in [Mode::Strict, Mode::Diagnostic] {
            let rep = validate_fileset(&fs, mode);
            assert!(rep.issues.is_empty(), "Claude 形态应全绿: {:?}", rep.issues);
            assert!(rep.passed);
            assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
            assert_eq!(rep.matrix.codex.verdict, Verdict::Pass);
        }
    }

    /// Codex 官方 skill-creator 原件（真机环境测试：文件不存在则跳过）。
    /// 验收口径（PLAN-06 §3.1）：FM 层对官方原件应全绿——官方自家校验器的
    /// 并集规则就出自这里。
    /// C2 扩展（PLAN-06 C2 验收「官方原件 fixture 回归全绿」）：原件形态
    /// （frontmatter = name+description+metadata，带 agents/openai.yaml，
    /// 2026-08-05 逐字核实）应全规则零 issue——我们的 CL/CX 规则就提取自
    /// 这些官方件（quick_validate.py / references/openai_yaml.md）。
    /// 原件若演化出未知字段或新 interface 字段，退回 C1 口径只钉 FM 层。
    #[test]
    fn real_codex_skill_creator_original() {
        let Some(home) = dirs::home_dir() else { return };
        let dir = home.join(".codex").join("skills").join(".system").join("skill-creator");
        if !dir.join("SKILL.md").is_file() {
            return; // 无原件环境自动跳过
        }
        let fs = load_fileset(&dir);
        let rep = validate_fileset(&fs, Mode::Strict);
        let fm_issues: Vec<&Issue> = rep
            .issues
            .iter()
            .filter(|i| i.rule_id.starts_with("FM-"))
            .collect();
        assert!(
            fm_issues.is_empty(),
            "Codex 官方 skill-creator 未过 FM 层: {:?}",
            fm_issues
        );
        // C2：已核实形态下全规则零 issue（CL/CX 层回归）
        let keys = fs.frontmatter.as_ref().map(unknown_keys_sorted).unwrap_or_default();
        let shape_verified = keys == ["description", "metadata", "name"]
            && fs.has_openai_yaml
            && fs
                .codex_interface
                .as_ref()
                .is_some_and(|i| matches!(&i.short_description, Some(Ok(s)) if s == "Create or update a skill"));
        if shape_verified {
            assert!(
                rep.issues.is_empty(),
                "官方原件应全规则全绿（CL/CX 规则提取自该原件）: {:?}",
                rep.issues
            );
            assert_eq!(rep.matrix.codex.verdict, Verdict::Pass);
            assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
        }
    }

    /// 原件 frontmatter 键集（排序后），供形态核对
    fn unknown_keys_sorted(m: &Mapping) -> Vec<String> {
        let mut keys: Vec<String> = m
            .clone()
            .into_iter()
            .filter_map(|(k, _)| match k {
                Value::String(s) => Some(s),
                _ => None,
            })
            .collect();
        keys.sort();
        keys
    }

    // ==== C2：CL 生态规则 ====

    #[test]
    fn cl01_name_dirname_mismatch_is_warn() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("other-name");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: real-name\ndescription: d\n---\n",
        )
        .unwrap();
        let fs = load_fileset(&skill);
        let rep = validate_fileset(&fs, Mode::Strict);
        let iss = rep.issues.iter().find(|i| i.rule_id == "CL-01").expect("应触发 CL-01");
        assert_eq!(iss.severity, Severity::Warn, "目录名随安装位置变化，严格模式不升级");
        assert!(rep.passed, "CL-01 不阻断");
        assert_eq!(rep.matrix.claude.verdict, Verdict::Warn);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Pass, "Codex 侧无感");
    }

    #[test]
    fn cl01_name_matches_dirname_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: my-skill\ndescription: d\n---\n",
        )
        .unwrap();
        let rep = validate_dir(&skill, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CL-01".to_string()));
    }

    #[test]
    fn cl02_unknown_fields_dual_track_and_listing() {
        // PLAN-06 C2 验收样本：未知字段 诊断=提示、严格=Error；多字段列表化且排序稳定
        let content = "---\nname: ok-skill\ndescription: d\ncategory: tools\nzebra-extra: 1\n---\n";
        let (_t, fs) = fileset_from(content);
        let diag = validate_fileset(&fs, Mode::Diagnostic);
        let d = diag.issues.iter().find(|i| i.rule_id == "CL-02").expect("诊断应提示 CL-02");
        assert_eq!(d.severity, Severity::Warn);
        assert!(d.message.contains("category") && d.message.contains("zebra-extra"), "名单外字段列表化: {}", d.message);
        assert!(diag.passed, "诊断模式永不阻断");

        let strict = validate_fileset(&fs, Mode::Strict);
        assert!(!strict.passed);
        let s = strict.issues.iter().find(|i| i.rule_id == "CL-02").unwrap();
        assert_eq!(s.severity, Severity::Error, "严格模式未知字段升 Error");
        assert_eq!(strict.matrix.claude.verdict, Verdict::Fail);
    }

    #[test]
    fn cl02_seven_whitelist_fields_all_pass() {
        let content = "---\nname: ok-skill\ndescription: d\nlicense: MIT\nallowed-tools:\n  - Read\nmetadata:\n  author: x\nuser-invocable: true\ndisable-model-invocation: false\n---\n";
        let (_t, fs) = fileset_from(content);
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CL-02".to_string()), "七字段全在白名单: {:?}", rep.issues);
    }

    #[test]
    fn platform_trigger_keywords_namespace_passes_both_ecosystems() {
        let content = "---\nname: ok-skill\ndescription: d\nmetadata:\n  skills-shark:\n    trigger_keywords:\n      - docker\n      - container\n---\n";
        let (_t, fs) = fileset_from(content);
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rep.issues.is_empty(), "平台命名空间不应触发生态未知字段: {:?}", rep.issues);
        assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Pass);
    }

    #[test]
    fn top_level_trigger_keywords_remains_unknown_to_ecosystems() {
        let content = "---\nname: ok-skill\ndescription: d\ntrigger_keywords:\n  - docker\n---\n";
        let (_t, fs) = fileset_from(content);
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"PM-01".to_string()));
        assert!(rule_ids(&rep).contains(&"CL-02".to_string()));
        assert!(rule_ids(&rep).contains(&"CX-02".to_string()));
        assert!(!rep.passed);
    }

    #[test]
    fn platform_trigger_keywords_type_error_uses_dual_track() {
        let content = "---\nname: ok-skill\ndescription: d\nmetadata:\n  skills-shark:\n    trigger_keywords: docker\n---\n";
        let (_t, fs) = fileset_from(content);

        let diagnostic = validate_fileset(&fs, Mode::Diagnostic);
        let diagnostic_issue = diagnostic
            .issues
            .iter()
            .find(|i| i.rule_id == "PM-01")
            .expect("诊断模式应提示平台元数据类型错误");
        assert_eq!(diagnostic_issue.severity, Severity::Error);
        assert!(diagnostic.passed, "诊断模式永不阻断");
        assert_eq!(diagnostic.matrix.claude.verdict, Verdict::Warn);
        assert_eq!(diagnostic.matrix.codex.verdict, Verdict::Warn);

        let strict = validate_fileset(&fs, Mode::Strict);
        let strict_issue = strict.issues.iter().find(|i| i.rule_id == "PM-01").unwrap();
        assert_eq!(strict_issue.severity, Severity::Error);
        assert!(!strict.passed, "严格模式应阻断平台元数据类型错误");
        assert_eq!(strict.matrix.claude.verdict, Verdict::Fail);
        assert_eq!(strict.matrix.codex.verdict, Verdict::Fail);
    }

    #[test]
    fn boolean_fields_matrix_split_claude_pass_codex_warn() {
        // R2-d 核心语义：user-invocable 在 CL 白名单合法（pass），在 CX 侧报未知（正确行为）
        let (_t, fs) = fileset_from("---\nname: ok-skill\ndescription: d\nuser-invocable: true\n---\n");
        let rep = validate_fileset(&fs, Mode::Diagnostic);
        assert!(!rule_ids(&rep).contains(&"CL-02".to_string()), "CL 白名单收录 user-invocable");
        let cx = rep.issues.iter().find(|i| i.rule_id == "CX-02").expect("CX 侧应报未知");
        assert_eq!(cx.severity, Severity::Warn);
        assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Warn);
    }

    #[test]
    fn cl02_skipped_when_frontmatter_broken() {
        let (_t, fs) = fileset_from("---\nname: [unclosed\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CL-02".to_string()), "FM-01 已报，CL-02 不连锁");
    }

    #[test]
    fn cl03_allowed_tools_string_form() {
        let (_t, fs) = fileset_from("---\nname: ok-skill\ndescription: d\nallowed-tools: \"Read, Bash\"\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        let iss = rep.issues.iter().find(|i| i.rule_id == "CL-03").expect("应触发 CL-03");
        assert_eq!(iss.severity, Severity::Warn, "字符串形态仍被接受，建议级不升级");
        assert!(rep.passed);
    }

    #[test]
    fn cl03_allowed_tools_list_ok() {
        let (_t, fs) = fileset_from("---\nname: ok-skill\ndescription: d\nallowed-tools:\n  - Read\n  - Bash\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CL-03".to_string()));
    }

    // ==== C2：CX 生态规则 ====

    #[test]
    fn cx01_agents_dir_without_openai_yaml_info() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("ok-skill");
        std::fs::create_dir_all(skill.join("agents")).unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: ok-skill\ndescription: d\n---\n",
        )
        .unwrap();
        let fs = load_fileset(&skill);
        let rep = validate_fileset(&fs, Mode::Strict);
        let iss = rep.issues.iter().find(|i| i.rule_id == "CX-01").expect("应触发 CX-01");
        assert_eq!(iss.severity, Severity::Info);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Pass, "Info 不进 notes、不影响 verdict");
    }

    #[test]
    fn cx01_silent_for_claude_shape() {
        // 纯 Claude 形态（无 agents/）：缺席 openai.yaml 属正常，不打扰
        let (_t, fs) = fileset_from("---\nname: ok-skill\ndescription: d\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-01".to_string()));
        assert!(rep.issues.is_empty(), "Claude 形态全绿（C1 fixture 回归）: {:?}", rep.issues);
    }

    #[test]
    fn cx01_ok_when_openai_yaml_present() {
        let (_t, fs) = fileset_with_openai_yaml(
            "---\nname: ok-skill\ndescription: d\n---\n",
            "interface:\n  display_name: \"Ok Skill\"\n",
        );
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-01".to_string()));
    }

    #[test]
    fn cx02_unknown_fields_dual_track() {
        let (_t, fs) = fileset_from("---\nname: ok-skill\ndescription: d\ncategory: x\n---\n");
        let diag = validate_fileset(&fs, Mode::Diagnostic);
        let d = diag.issues.iter().find(|i| i.rule_id == "CX-02").expect("诊断应提示 CX-02");
        assert_eq!(d.severity, Severity::Warn);
        assert!(diag.passed);
        let strict = validate_fileset(&fs, Mode::Strict);
        let s = strict.issues.iter().find(|i| i.rule_id == "CX-02").unwrap();
        assert_eq!(s.severity, Severity::Error);
        assert!(!strict.passed);
        assert_eq!(strict.matrix.codex.verdict, Verdict::Fail);
    }

    #[test]
    fn cx02_five_whitelist_fields_pass() {
        let content = "---\nname: ok-skill\ndescription: d\nlicense: MIT\nallowed-tools:\n  - Read\nmetadata:\n  author: x\n---\n";
        let (_t, fs) = fileset_from(content);
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-02".to_string()), "五字段基线: {:?}", rep.issues);
    }

    #[test]
    fn cx03_default_prompt_rules() {
        let fm = "---\nname: ok-skill\ndescription: d\n---\n";
        // 含 $skill-name → 过
        let (_t, fs) = fileset_with_openai_yaml(fm, "interface:\n  default_prompt: \"Use $skill-name to draft a status update.\"\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-03".to_string()));
        // 不含 → 严格模式 Error
        let (_t, fs) = fileset_with_openai_yaml(fm, "interface:\n  default_prompt: \"Use this skill to draft a status update.\"\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        let iss = rep.issues.iter().find(|i| i.rule_id == "CX-03").expect("应触发 CX-03");
        assert_eq!(iss.severity, Severity::Error);
        assert!(!rep.passed);
        // 字段缺席 → 不报（官方 schema 视为可选，官方原件即无此字段）
        let (_t, fs) = fileset_with_openai_yaml(fm, "interface:\n  display_name: \"Ok Skill\"\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-03".to_string()), "缺席不报: {:?}", rep.issues);
    }

    #[test]
    fn cx04_short_description_bounds() {
        let fm = "---\nname: ok-skill\ndescription: d\n---\n";
        // 官方原件 24 字符（下限豁免）→ 不报
        let (_t, fs) = fileset_with_openai_yaml(fm, "interface:\n  short_description: \"Create or update a skill\"\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-04".to_string()), "官方原件 24 字符须通过: {:?}", rep.issues);
        // 上限内（64）→ 不报
        let (_t, fs) = fileset_with_openai_yaml(fm, &format!("interface:\n  short_description: \"{}\"\n", "x".repeat(64)));
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-04".to_string()));
        // 超上限（65）→ 严格 Error
        let (_t, fs) = fileset_with_openai_yaml(fm, &format!("interface:\n  short_description: \"{}\"\n", "x".repeat(65)));
        let rep = validate_fileset(&fs, Mode::Strict);
        let iss = rep.issues.iter().find(|i| i.rule_id == "CX-04").expect("应触发 CX-04");
        assert_eq!(iss.severity, Severity::Error);
        assert!(!rep.passed);
        // 字段缺席 → 不报
        let (_t, fs) = fileset_with_openai_yaml(fm, "interface:\n  display_name: \"Ok Skill\"\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"CX-04".to_string()));
    }

    #[test]
    fn codex_shape_full_clean_fixture() {
        // 仿官方原件形态：五字段内 frontmatter + openai.yaml 三文案字段合规 → 全绿
        let (_t, fs) = fileset_with_openai_yaml(
            "---\nname: ok-skill\ndescription: Does a thing. Use when the user needs the thing done.\nmetadata:\n  short-description: Does the thing\n---\nbody\n",
            "interface:\n  display_name: \"Ok Skill\"\n  short_description: \"Does the thing when the user needs it done\"\n  default_prompt: \"Use $skill-name to do the thing.\"\n",
        );
        for mode in [Mode::Strict, Mode::Diagnostic] {
            let rep = validate_fileset(&fs, mode);
            assert!(rep.issues.is_empty(), "Codex 形态应全绿 ({:?}): {:?}", mode, rep.issues);
            assert!(rep.passed);
            assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
            assert_eq!(rep.matrix.codex.verdict, Verdict::Pass);
        }
    }

    #[test]
    fn real_codex_original_diagnostic_mode() {
        // 诊断模式永不阻断官方原件（含 Info/Warn 也只提示）
        let Some(home) = dirs::home_dir() else { return };
        let dir = home.join(".codex").join("skills").join(".system").join("skill-creator");
        if !dir.join("SKILL.md").is_file() {
            return;
        }
        let rep = validate_dir(&dir, Mode::Diagnostic);
        assert!(rep.passed, "诊断模式 passed 恒 true");
        assert_ne!(rep.matrix.codex.verdict, Verdict::Fail);
    }
}
