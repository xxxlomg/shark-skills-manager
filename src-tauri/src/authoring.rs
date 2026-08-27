//! 模块 C 创作后端（PLAN-06 §3.10/§3.13 C6）：
//! - `skill_write_file`：编辑器整文件写（rel_path 禁 `..`/绝对路径 + 归属检查）；
//! - `skill_commit_draft`：AI 模式落盘入口（归属检查 + 写 SKILL.md/references + 诊断校验）；
//! - 路径归属安全基线 `assert_path_owned_with_roots`：所有写入口必过，
//!   落点必须落在 authored/ 或已启用 tools 展开路径或 builtin/imported 自有源之下。
//!
//! 安全核心函数全部 roots 参数化——单测不碰全局 DATA_DIR / 真实注册表。

use std::fs;
use std::path::{Component, Path, PathBuf};

/// 创作习惯占位符（UI 反馈 2026-08-05：先命名后补描述）。
/// 命令层空 description 补此值；纯函数核心仍硬校验非空。
pub const DESC_PLACEHOLDER: &str = "TODO：补充「做什么 + 何时用」——模型只凭它决定是否使用";

/// 词法规范化（不碰文件系统）：解析 `.`/`..`，用于尚不存在目录的归属判定。
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 大小写不敏感前缀比较（Windows 盘符/目录大小写不敏感）。
fn owned_by(child: &Path, root: &Path) -> bool {
    let c = child.to_string_lossy().to_lowercase();
    let r = root.to_string_lossy().to_lowercase();
    let with_sep = |s: &str| format!("{s}\\") ;
    c == r || c.starts_with(&with_sep(&r)) || c.starts_with(&format!("{r}/"))
}

/// 当前生效的写归属根集合：authored + builtin + imported + 已启用 tools 的展开路径。
pub(crate) fn owned_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        crate::config::authored_dir(),
        crate::config::builtin_skills_dir(),
        crate::config::imported_dir(),
    ];
    let cfg = crate::config::load_config();
    for t in &cfg.tools {
        if !t.enabled {
            continue;
        }
        for p in &t.paths {
            if let Some(exp) = crate::config::expand_path(p) {
                roots.push(exp);
            }
        }
    }
    roots
}

/// 路径归属检查（C6 安全基线）。违反 → Err("PATH_ESCAPE:<normalized>")。
pub(crate) fn assert_path_owned_with_roots(path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    let norm = normalize(path);
    for r in roots {
        if owned_by(&norm, &normalize(r)) {
            return Ok(());
        }
    }
    Err(format!("PATH_ESCAPE:{}", norm.display()))
}

/// rel_path 安全检查：禁 `..` 组件、禁绝对路径（C6 验收硬标准）。
fn assert_rel_safe(rel: &str) -> Result<(), String> {
    let p = Path::new(rel);
    if p.is_absolute() {
        return Err("rel_path 不允许绝对路径".to_string());
    }
    if p.components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("rel_path 不允许 .. 逃逸".to_string());
    }
    Ok(())
}

/// 编辑器整文件写核心（roots 参数化）。
pub(crate) fn write_file_checked(
    skill_dir: &Path,
    rel_path: &str,
    content: &str,
    roots: &[PathBuf],
) -> Result<PathBuf, String> {
    assert_rel_safe(rel_path)?;
    assert_path_owned_with_roots(skill_dir, roots)?;
    let target = skill_dir.join(rel_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&target, content).map_err(|e| format!("写入失败：{e}"))?;
    Ok(target)
}

/// 编辑器保存用（整文件写）。frontmatter 表单编辑不走这里（走 C10 skill_edit_frontmatter）。
#[tauri::command]
pub fn skill_write_file(
    skill_dir: String,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    write_file_checked(Path::new(&skill_dir), &rel_path, &content, &owned_roots())?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct DraftFile {
    pub rel_path: String,
    pub content: String,
}

#[derive(serde::Deserialize)]
pub struct SkillDraft {
    pub name: String,
    pub description: String,
    /// 正文（空则用模板骨架）
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub references: Vec<DraftFile>,
    /// shark-skill-creator 规范层结构补全（references/scripts/assets）
    #[serde(default)]
    pub scaffold_resources: Vec<String>,
}

/// AI 模式落盘入口（§3.11）。location = "authored" 或 tool_id（§3.9 双落点）。
/// 写完跑诊断校验一并返回。
#[tauri::command]
pub fn skill_commit_draft(
    location: String,
    draft: SkillDraft,
) -> Result<serde_json::Value, String> {
    let roots = owned_roots();
    let base = if location == crate::config::TOOL_ID_AUTHORED {
        crate::config::authored_dir()
    } else {
        resolve_tool_base(&location)?
    };
    // SKILL.md 走模板核心（name/desc 校验 + EXISTS 拒）；空描述补占位符
    let desc = if draft.description.trim().is_empty() {
        DESC_PLACEHOLDER.to_string()
    } else {
        draft.description.clone()
    };
    let dir = crate::commands::create_skill_template_with_scaffold(
        &base,
        &draft.name,
        &desc,
        &draft.scaffold_resources,
    )?;
    // 正文覆盖模板骨架
    if !draft.body.trim().is_empty() {
        let md = format!(
            "---\nname: {}\ndescription: {}\n---\n\n{}",
            draft.name.trim(),
            draft.description.trim(),
            draft.body
        );
        std::fs::write(dir.join("SKILL.md"), md)
            .map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;
    }
    // references 逐个过安全检查
    for f in &draft.references {
        write_file_checked(&dir, &f.rel_path, &f.content, &roots)?;
    }
    let report = crate::validate::validate_dir(&dir, crate::validate::Mode::Diagnostic);
    Ok(serde_json::json!({
        "skill_dir": dir.to_string_lossy(),
        "validation": report,
    }))
}

/// §3.9 工具落点：第一个存在的展开路径；都不存在则创建 paths[0]。
fn resolve_tool_base(tool_id: &str) -> Result<PathBuf, String> {
    let cfg = crate::config::load_config();
    let tool = cfg
        .tools
        .iter()
        .find(|t| t.id == tool_id && !t.app_owned)
        .ok_or_else(|| format!("未知或不可写工具：{tool_id}"))?;
    for p in &tool.paths {
        if let Some(exp) = crate::config::expand_path(p) {
            if exp.is_dir() {
                return Ok(exp);
            }
        }
    }
    let first = tool
        .paths
        .first()
        .and_then(|p| crate::config::expand_path(p))
        .ok_or_else(|| format!("工具 {tool_id} 无可用路径"))?;
    std::fs::create_dir_all(&first).map_err(|e| format!("创建工具目录失败：{e}"))?;
    Ok(first)
}

// ---------------------------------------------------------------------------
// shark-skill-creator 集成（PLAN：内置 Skill Creator Pro 规范）
// ---------------------------------------------------------------------------

/// 规范层可补全的资源目录（与内置 shark-skill-creator SKILL.md 标准结构一致）
pub const SCAFFOLD_RESOURCES: [&str; 3] = ["references", "scripts", "assets"];

pub fn is_scaffold_resource(res: &str) -> bool {
    SCAFFOLD_RESOURCES.contains(&res)
}

/// 每个资源目录在 SKILL.md 资源导航段里的一句话用途
pub fn scaffold_purpose(res: &str) -> &'static str {
    match res {
        "references" => "领域知识、官方文档摘要、规范、最佳实践（按需加载）",
        "scripts" => "确定性、可重复的辅助程序（不该靠 LLM 猜的工作）",
        "assets" => "模板、示例素材、logo",
        _ => "",
    }
}

/// 资源目录预置的引导 README（告诉后来者这个目录按规范放什么）
pub fn scaffold_readme(res: &str) -> &'static str {
    match res {
        "references" => {
            "# references/ —— 领域知识（按需加载）\n\n按 Skill Creator Pro 规范：SKILL.md 只保留核心流程与编排，深层知识外置到本目录。\n\n- 放什么：领域知识、官方文档摘要、规范、最佳实践\n- 命名：<topic>.md（如 progressive-disclosure.md）\n- 在 SKILL.md 的「资源导航」中登记每个文件的一句话用途\n"
        }
        "scripts" => {
            "# scripts/ —— 确定性辅助程序\n\n按 Skill Creator Pro 规范：确定性、可重复的操作不应该靠 LLM 猜，写成本目录脚本。\n\n- 放什么：解析、校验、脚手架生成等可执行程序\n- 命名：<verb>_<target>.mjs / .py（如 init_skill.mjs）\n- 在 SKILL.md 中说明运行方式与前置环境\n"
        }
        "assets" => {
            "# assets/ —— 模板与素材\n\n按 Skill Creator Pro 规范：工作模板、示例、logo 等素材放本目录。\n\n- 放什么：模板文件、示例输入/输出、logo、图片\n- 在 SKILL.md 中说明每个资源的用途\n"
        }
        _ => "",
    }
}

/// 内置 shark-skill-creator 技能目录（builtin 资源，dev=项目 skills/，release=打包资源）
#[allow(dead_code)]
pub(crate) fn creator_dir() -> PathBuf {
    crate::config::builtin_skills_dir().join("shark-skill-creator")
}

// ---------------------------------------------------------------------------
// 编译期嵌入的 shark-skill-creator（用户不可见/不可删改）
// 通过 include_str! 将完整规范烧入二进制，skill_creator_info/read 优先从
// 嵌入表服务；磁盘 creator_dir() 仅作历史兼容回退。
// ---------------------------------------------------------------------------
mod embedded_creator {
    pub const SKILL_MD: &str = include_str!("../builtin/shark-skill-creator/SKILL.md");
    /// (rel_path, 全文)——references/
    pub const REFERENCES: &[(&str, &str)] = &[
        ("references/common-mistakes.md", include_str!("../builtin/shark-skill-creator/references/common-mistakes.md")),
        ("references/evaluation-and-quality.md", include_str!("../builtin/shark-skill-creator/references/evaluation-and-quality.md")),
        ("references/interview-protocol.md", include_str!("../builtin/shark-skill-creator/references/interview-protocol.md")),
        ("references/progressive-disclosure.md", include_str!("../builtin/shark-skill-creator/references/progressive-disclosure.md")),
        ("references/skill-specification.md", include_str!("../builtin/shark-skill-creator/references/skill-specification.md")),
        ("references/skill-state-model.md", include_str!("../builtin/shark-skill-creator/references/skill-state-model.md")),
    ];
    /// (rel_path, 全文)——scripts/
    pub const SCRIPTS: &[(&str, &str)] = &[
        ("scripts/init_skill.mjs", include_str!("../builtin/shark-skill-creator/scripts/init_skill.mjs")),
        ("scripts/init_skill.py", include_str!("../builtin/shark-skill-creator/scripts/init_skill.py")),
        ("scripts/validate_skill.mjs", include_str!("../builtin/shark-skill-creator/scripts/validate_skill.mjs")),
        ("scripts/validate_skill.py", include_str!("../builtin/shark-skill-creator/scripts/validate_skill.py")),
    ];

    pub fn find(rel: &str) -> Option<&'static str> {
        REFERENCES.iter().chain(SCRIPTS.iter()).find(|(p, _)| *p == rel).map(|(_, c)| *c)
    }

    /// 首行标题（去 # 前缀）
    pub fn title(content: &str) -> String {
        content
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(|l| l.trim_start_matches('#').trim().to_string())
            .unwrap_or_default()
    }
}

/// 资源条目元数据（渐进披露：只带 rel_path/标题/大小，正文按需读）
#[derive(Debug, Clone, serde::Serialize)]
pub struct CreatorAsset {
    pub rel_path: String,
    /// 首行标题（去 `#` 前缀与空白）
    pub title: String,
    pub size: u64,
}

#[allow(dead_code)]
fn asset_meta(root: &Path, rel: &str) -> Option<CreatorAsset> {
    let p = root.join(rel);
    let text = fs::read_to_string(&p).ok()?;
    let title = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .unwrap_or_else(|| rel.to_string());
    let size = p.metadata().ok().map(|m| m.len()).unwrap_or(0);
    Some(CreatorAsset {
        rel_path: rel.to_string(),
        title,
        size,
    })
}

/// 创作工作台加载内置 shark-skill-creator 定义：
/// 优先从编译期嵌入表服务（用户不可见/不可删改），保证始终可用。
/// 返回 SKILL.md 全文 + references/scripts 清单。
#[tauri::command]
pub fn skill_creator_info() -> Option<serde_json::Value> {
    let skill_md = embedded_creator::SKILL_MD;
    // frontmatter description 摘录（首行简介）
    let description = skill_md
        .strip_prefix("---")
        .and_then(|rest| rest.split("\n---").next())
        .and_then(|fm| {
            fm.lines()
                .find(|l| l.trim_start().starts_with("description:"))
                .map(|l| l.trim_start().trim_start_matches("description:").trim().to_string())
        })
        .unwrap_or_default();
    let references: Vec<serde_json::Value> = embedded_creator::REFERENCES
        .iter()
        .map(|(rel, content)| {
            serde_json::json!({
                "rel_path": rel,
                "title": embedded_creator::title(content),
                "size": content.len() as u64,
            })
        })
        .collect();
    let scripts: Vec<serde_json::Value> = embedded_creator::SCRIPTS
        .iter()
        .map(|(rel, content)| {
            serde_json::json!({
                "rel_path": rel,
                "title": embedded_creator::title(content),
                "size": content.len() as u64,
            })
        })
        .collect();
    serde_json::json!({
        "name": "shark-skill-creator",
        "description": description,
        "skill_md": skill_md,
        "references": references,
        "scripts": scripts,
    })
    .into()
}

/// 按需读取内置 creator 资源全文（references/scripts 内）。
/// 优先嵌入表；rel_path 必须在白名单内（防逃逸）。
#[tauri::command]
pub fn skill_creator_read(rel_path: String) -> Result<String, String> {
    assert_rel_safe(&rel_path)?;
    embedded_creator::find(&rel_path)
        .map(|c| c.to_string())
        .ok_or_else(|| format!("PATH_ESCAPE:{rel_path}"))
}

// ---------------------------------------------------------------------------
// C8：openai.yaml emitter + 约束校验（PLAN-06 §3.12，官方 schema 锚点：
// mock/skills/codex-skill-creator/references/openai_yaml.md）
// 六字段全在 interface: 下；字符串一律引号包裹、键不引号、2 空格缩进。
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize, Default, Clone)]
pub struct OpenaiFields {
    pub display_name: String,
    pub short_description: String,
    pub default_prompt: String,
    pub icon_small: Option<String>,
    pub icon_large: Option<String>,
    pub brand_color: Option<String>,
}

/// YAML 字符串引号包裹 + 标准转义（`"` `\` `\n`）。
fn yq(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
    )
}

/// 裸文件名归一为 `./assets/<file>`（§3.12 约束 4）。
fn normalize_asset(p: &str) -> String {
    let t = p.trim().replace('\\', "/");
    if t.starts_with("./") || t.starts_with('/') {
        t
    } else {
        let file = t.rsplit('/').next().unwrap_or(&t);
        format!("./assets/{file}")
    }
}

/// C8 emitter：字段顺序镜像官方示例（display_name → short_description →
/// icon_small → icon_large → brand_color → default_prompt）；
/// icon/brand_color 仅在提供时写入（官方原则：可选字段不得臆造）。
pub(crate) fn emit_openai_yaml(f: &OpenaiFields) -> String {
    let mut out = String::from("interface:\n");
    out.push_str(&format!("  display_name: {}\n", yq(&f.display_name)));
    out.push_str(&format!("  short_description: {}\n", yq(&f.short_description)));
    if let Some(v) = &f.icon_small {
        out.push_str(&format!("  icon_small: {}\n", yq(v)));
    }
    if let Some(v) = &f.icon_large {
        out.push_str(&format!("  icon_large: {}\n", yq(v)));
    }
    if let Some(v) = &f.brand_color {
        out.push_str(&format!("  brand_color: {}\n", yq(v)));
    }
    out.push_str(&format!("  default_prompt: {}\n", yq(&f.default_prompt)));
    out
}

/// §3.12 约束校验：返回 (severity, message) 列表。error 阻断写入。
fn check_openai_fields(f: &OpenaiFields, skill_dir: &Path) -> Vec<(&'static str, String)> {
    let mut issues: Vec<(&'static str, String)> = vec![];
    if !f.default_prompt.contains("$skill-name") {
        issues.push((
            "error",
            "default_prompt 必须包含 $skill-name（官方硬规则）".to_string(),
        ));
    }
    let chars = f.short_description.chars().count();
    if !(25..=64).contains(&chars) {
        issues.push((
            "error",
            format!("short_description 须 25–64 字符（当前 {chars}）"),
        ));
    }
    for (key, val) in [
        ("icon_small", &f.icon_small),
        ("icon_large", &f.icon_large),
    ] {
        if let Some(p) = val {
            if !skill_dir.join(p).exists() {
                issues.push((
                    "warn",
                    format!("{key} 资源 {p} 不存在（不阻断，文件可能后补）"),
                ));
            }
        }
    }
    issues
}

/// 生成 `agents/openai.yaml`。已存在默认拒（EXISTS）；overwrite=true 先备份 .bak。
/// error 级约束违例拒写；warn 随结果返回。
pub(crate) fn generate_openai_yaml_checked(
    skill_dir: &Path,
    mut fields: OpenaiFields,
    overwrite: bool,
    roots: &[PathBuf],
) -> Result<serde_json::Value, String> {
    assert_path_owned_with_roots(skill_dir, roots)?;
    fields.icon_small = fields.icon_small.map(|p| normalize_asset(&p));
    fields.icon_large = fields.icon_large.map(|p| normalize_asset(&p));

    let issues = check_openai_fields(&fields, skill_dir);
    let errors: Vec<String> = issues
        .iter()
        .filter(|(s, _)| *s == "error")
        .map(|(_, m)| m.clone())
        .collect();
    if !errors.is_empty() {
        return Err(errors.join("；"));
    }

    let target = skill_dir.join("agents").join("openai.yaml");
    if target.exists() {
        if !overwrite {
            return Err("EXISTS".to_string());
        }
        let bak = skill_dir.join("agents").join("openai.yaml.bak");
        std::fs::copy(&target, &bak).map_err(|e| format!("备份失败：{e}"))?;
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&target, emit_openai_yaml(&fields))
        .map_err(|e| format!("写入 openai.yaml 失败：{e}"))?;

    let warnings: Vec<String> = issues
        .iter()
        .filter(|(s, _)| *s == "warn")
        .map(|(_, m)| m.clone())
        .collect();
    Ok(serde_json::json!({
        "path": target.to_string_lossy(),
        "warnings": warnings,
    }))
}

#[tauri::command]
pub fn openai_yaml_generate(
    skill_dir: String,
    fields: OpenaiFields,
    overwrite: Option<bool>,
) -> Result<serde_json::Value, String> {
    generate_openai_yaml_checked(
        Path::new(&skill_dir),
        fields,
        overwrite.unwrap_or(false),
        &owned_roots(),
    )
}

// ---------------------------------------------------------------------------
// C8 反向：转 Claude 兼容——从 agents/openai.yaml 派生 SKILL.md。
// 仅当 SKILL.md 缺失时写入（已存在 → created=false，绝不覆盖用户正文）。
// ---------------------------------------------------------------------------

/// 从 openai.yaml 派生 SKILL.md 核心（roots 参数化）。
pub(crate) fn generate_claude_md_checked(
    skill_dir: &Path,
    roots: &[PathBuf],
) -> Result<serde_json::Value, String> {
    assert_path_owned_with_roots(skill_dir, roots)?;
    let skill_md = skill_dir.join("SKILL.md");
    if skill_md.exists() {
        return Ok(serde_json::json!({
            "created": false,
            "path": skill_md.to_string_lossy(),
            "reason": "SKILL.md 已存在，已是 Claude 兼容"
        }));
    }
    let yaml_path = skill_dir.join("agents").join("openai.yaml");
    if !yaml_path.exists() {
        return Err("未找到 agents/openai.yaml，无法转为 Claude 兼容".to_string());
    }
    let raw =
        std::fs::read_to_string(&yaml_path).map_err(|e| format!("读取 openai.yaml 失败：{e}"))?;
    let v: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(&raw).map_err(|e| format!("openai.yaml 解析失败：{e}"))?;
    let iface = v.get("interface");
    let get = |k: &str| {
        iface
            .and_then(|i| i.get(k))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };
    let display = get("display_name");
    let short = get("short_description");
    let prompt = get("default_prompt");
    if short.is_empty() && prompt.is_empty() {
        return Err("openai.yaml 缺 short_description / default_prompt，无法派生 SKILL.md"
            .to_string());
    }
    let name = skill_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".to_string());
    let desc = if short.is_empty() { prompt.clone() } else { short };
    let title = if display.is_empty() { name.clone() } else { display };
    let body = if prompt.is_empty() { desc.clone() } else { prompt };
    let mut md = format!("---\nname: {name}\ndescription: {desc}\n---\n\n# {title}\n\n{body}\n");
    if !md.ends_with('\n') {
        md.push('\n');
    }
    std::fs::write(&skill_md, md).map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;
    Ok(serde_json::json!({
        "created": true,
        "path": skill_md.to_string_lossy()
    }))
}

#[tauri::command]
pub fn claude_md_generate(skill_dir: String) -> Result<serde_json::Value, String> {
    generate_claude_md_checked(Path::new(&skill_dir), &owned_roots())
}

// ---------------------------------------------------------------------------
// C6 单测：路径逃逸全拒（验收硬标准）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c6_tests {
    use super::*;

    fn roots_with(tmp: &Path) -> Vec<PathBuf> {
        vec![tmp.to_path_buf()]
    }

    #[test]
    fn rejects_dotdot_rel() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let err = write_file_checked(&skill, "../evil.md", "x", &roots_with(tmp.path()))
            .unwrap_err();
        assert!(err.contains(".."), "{err}");
    }

    #[test]
    fn rejects_absolute_rel() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        let err = write_file_checked(&skill, r"C:\Windows\evil.md", "x", &roots_with(tmp.path()))
            .unwrap_err();
        assert!(err.contains("绝对路径"), "{err}");
    }

    #[test]
    fn rejects_unregistered_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let skill = outside.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let err = write_file_checked(&skill, "a.md", "x", &roots_with(tmp.path())).unwrap_err();
        assert!(err.starts_with("PATH_ESCAPE"), "{err}");
    }

    #[test]
    fn rejects_sneaky_dotdot_into_sibling() {
        // rel 里 .. 解析后逃出 skill_dir 但仍在 root 下——归属过但 rel 安全闸先拒
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        assert!(write_file_checked(&skill, "sub/../../x.md", "x", &roots_with(tmp.path()))
            .is_err());
    }

    #[test]
    fn allows_nested_rel_under_owned_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let written =
            write_file_checked(&skill, "references/guide.md", "hello", &roots_with(tmp.path()))
                .unwrap();
        assert!(written.exists());
        assert_eq!(std::fs::read_to_string(written).unwrap(), "hello");
    }

    #[test]
    fn normalize_resolves_dotdot_lexically() {
        let p = normalize(Path::new(r"C:\a\b\..\c"));
        assert_eq!(p, PathBuf::from(r"C:\a\c"));
    }
}

// ---------------------------------------------------------------------------
// C8 单测：emitter 格式快照 + 约束校验 + 覆盖备份
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c8_tests {
    use super::*;

    fn valid_fields() -> OpenaiFields {
        OpenaiFields {
            display_name: "My Skill".into(),
            short_description: "A UI blurb of proper length here".into(), // 33 chars
            default_prompt: "Use $skill-name to do the thing".into(),
            icon_small: None,
            icon_large: None,
            brand_color: None,
        }
    }

    #[test]
    fn emitter_snapshot_order_quotes_indent() {
        let mut f = valid_fields();
        f.icon_small = Some("./assets/s.png".into());
        f.brand_color = Some("#3B82F6".into());
        let y = emit_openai_yaml(&f);
        assert_eq!(
            y,
            "interface:\n  display_name: \"My Skill\"\n  short_description: \"A UI blurb of proper length here\"\n  icon_small: \"./assets/s.png\"\n  brand_color: \"#3B82F6\"\n  default_prompt: \"Use $skill-name to do the thing\"\n",
            "字段顺序/引号/2 空格缩进必须镜像官方示例"
        );
    }

    #[test]
    fn emitter_escapes_quotes_backslash_newline() {
        let mut f = valid_fields();
        f.display_name = "Say \"hi\" \\ \n".into();
        let y = emit_openai_yaml(&f);
        assert!(y.contains("display_name: \"Say \\\"hi\\\" \\\\ \\n\""), "{y}");
    }

    #[test]
    fn rejects_missing_skill_name_token() {
        let tmp = tempfile::tempdir().unwrap();
        let mut f = valid_fields();
        f.default_prompt = "Do the thing".into();
        let err = generate_openai_yaml_checked(tmp.path(), f, false, &[tmp.path().to_path_buf()])
            .unwrap_err();
        assert!(err.contains("$skill-name"), "{err}");
    }

    #[test]
    fn rejects_short_desc_out_of_range() {
        let tmp = tempfile::tempdir().unwrap();
        let mut f = valid_fields();
        f.short_description = "too short".into();
        assert!(generate_openai_yaml_checked(tmp.path(), f.clone(), false, &[tmp.path().to_path_buf()])
            .unwrap_err()
            .contains("25"));
        let mut f2 = valid_fields();
        f2.short_description = "x".repeat(65);
        assert!(generate_openai_yaml_checked(tmp.path(), f2, false, &[tmp.path().to_path_buf()])
            .is_err());
    }

    #[test]
    fn overwrite_backs_up_bak_and_bare_icon_normalized() {
        let tmp = tempfile::tempdir().unwrap();
        let roots = vec![tmp.path().to_path_buf()];
        let f = valid_fields();
        let first = generate_openai_yaml_checked(tmp.path(), f.clone(), false, &roots).unwrap();
        assert!(first["path"].as_str().unwrap().contains("openai.yaml"));
        // 已存在 → 默认拒
        assert_eq!(
            generate_openai_yaml_checked(tmp.path(), f.clone(), false, &roots).unwrap_err(),
            "EXISTS"
        );
        // overwrite → .bak 出现
        let mut f3 = f.clone();
        f3.icon_small = Some("logo.png".into()); // 裸文件名 → ./assets/logo.png（资源不存在 → warn 不阻断）
        let res = generate_openai_yaml_checked(tmp.path(), f3, true, &roots).unwrap();
        let warns = res["warnings"].as_array().unwrap();
        assert!(warns.iter().any(|w| w.as_str().unwrap().contains("icon_small")), "{res}");
        assert!(tmp.path().join("agents/openai.yaml.bak").exists());
        let content = std::fs::read_to_string(tmp.path().join("agents/openai.yaml")).unwrap();
        assert!(content.contains("icon_small: \"./assets/logo.png\""), "{content}");
    }

    #[test]
    fn rejects_unowned_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = generate_openai_yaml_checked(
            outside.path(),
            valid_fields(),
            false,
            &[tmp.path().to_path_buf()],
        )
        .unwrap_err();
        assert!(err.starts_with("PATH_ESCAPE"), "{err}");
    }
}

// ---------------------------------------------------------------------------
// C10：结构化编辑——frontmatter 行级外科手术（PLAN-06 §3.14）
// 策略：不解析重序列化。行式扫描顶层 key，只动被编辑 key 的行范围；
// 未知字段/注释/多行块字节级保留（验收硬标准）。零新依赖。
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct FrontmatterEdit {
    pub key: String,
    /// "set" | "delete"
    pub op: String,
    #[serde(default)]
    pub value: Option<String>,
}

fn fm_yaml_quote(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
    )
}

fn is_top_level(line: &str) -> bool {
    let t = line.trim_end_matches('\r');
    !t.is_empty()
        && !t.starts_with(' ')
        && !t.starts_with('\t')
        && !t.starts_with('#')
        && t.contains(':')
}

fn is_top_level_key(line: &str, key: &str) -> bool {
    is_top_level(line)
        && line.trim_end_matches('\r').split(':').next().unwrap_or("").trim() == key
}

/// 顶层 key 的行范围 [start, end)：key 行 → 下一个顶层 key 之前。
fn key_span(lines: &[String], key: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| is_top_level_key(l, key))?;
    let end = lines[start + 1..]
        .iter()
        .position(|l| is_top_level(l))
        .map(|p| start + 1 + p)
        .unwrap_or(lines.len());
    Some((start, end))
}

/// frontmatter 行级编辑核心。返回新全文（frontmatter 之外的字节原样）。
pub(crate) fn edit_frontmatter_checked(
    md_content: &str,
    edits: &[FrontmatterEdit],
) -> Result<String, String> {
    let stripped = md_content.strip_prefix("---").ok_or("SKILL.md 无 frontmatter")?;
    let end_pos = stripped
        .find("\n---")
        .ok_or("frontmatter 未闭合")?;
    let fm = &stripped[..end_pos];
    let body = &stripped[end_pos..]; // 含 "\n---..." 前缀，原样保留
    let mut lines: Vec<String> = fm.split('\n').map(String::from).collect();

    for edit in edits {
        match edit.op.as_str() {
            "set" => {
                let value = edit.value.as_deref().ok_or("set 操作必须带 value")?;
                let new_line = format!("{}: {}", edit.key, fm_yaml_quote(value));
                if let Some((s, e)) = key_span(&lines, &edit.key) {
                    lines.splice(s..e, [new_line]);
                } else {
                    lines.push(new_line);
                }
            }
            "delete" => {
                if let Some((s, e)) = key_span(&lines, &edit.key) {
                    lines.splice(s..e, []);
                }
            }
            other => return Err(format!("未知编辑操作：{other}")),
        }
    }
    // body 含 "\n---..." 前缀（原样保留）；fm 与 body 拼接即还原分隔线
    Ok(format!("---{}{}", lines.join("\n"), body))
}

/// 结构化编辑命令：行级改写 SKILL.md frontmatter，写后跑诊断校验。
/// frontmatter 表单编辑专用——禁止用 skill_write_file 全量重写（丢未知字段）。
#[tauri::command]
pub fn skill_edit_frontmatter(
    skill_dir: String,
    edits: Vec<FrontmatterEdit>,
) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&skill_dir);
    assert_path_owned_with_roots(&dir, &owned_roots())?;
    let md = dir.join("SKILL.md");
    let content =
        std::fs::read_to_string(&md).map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    let new_content = edit_frontmatter_checked(&content, &edits)?;
    std::fs::write(&md, new_content).map_err(|e| format!("写入失败：{e}"))?;
    let report = crate::validate::validate_dir(&dir, crate::validate::Mode::Diagnostic);
    Ok(serde_json::json!({ "validation": report }))
}

/// 重命名 authored 技能（UI 反馈 2026-08-05）：目录名 + frontmatter name 同步改。
/// 仅允许 authored 根下；目标名已存在 → Err("EXISTS")；
/// 台账有引用指向该目录 → 拒（junction source 会失效，先解除再改名）。
/// frontmatter 改写失败回滚目录名，不留半成品。
#[tauri::command]
pub fn skill_rename(skill_dir: String, new_name: String) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&skill_dir);
    let ledger = crate::hub::load_ledger(&crate::config::get_data_dir());
    let sources: Vec<String> = ledger.links.iter().map(|l| l.source.clone()).collect();
    let new_dir = rename_skill_core(
        &dir,
        &new_name,
        &crate::config::authored_dir(),
        &sources,
    )?;
    // 同步 frontmatter name；失败回滚目录名
    let edit = FrontmatterEdit {
        key: "name".into(),
        op: "set".into(),
        value: Some(new_name.trim().to_string()),
    };
    if let Err(e) = skill_edit_frontmatter(new_dir.to_string_lossy().to_string(), vec![edit]) {
        let _ = std::fs::rename(&new_dir, &dir);
        return Err(e);
    }
    // PLAN-13 §2.4：skill_id = `authored|rel_dir`（v0.2 稳定键），rename 改变 rel →
    // id 漂移。把标签挂载与用途速览从旧 id 迁到新 id。迁移失败不阻断 rename（仅日志）。
    let rel = |p: &PathBuf| {
        p.strip_prefix(crate::config::authored_dir())
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    };
    let old_id = format!("{}|{}", crate::config::TOOL_ID_AUTHORED, rel(&dir));
    let new_id = format!("{}|{}", crate::config::TOOL_ID_AUTHORED, rel(&new_dir));
    if let Err(e) = crate::tags::migrate_assignment(
        &crate::tags::skill_key(&old_id),
        &crate::tags::skill_key(&new_id),
    ) {
        crate::config::debug_log(&format!("skill_rename: 标签迁移失败 {e}"));
    }
    if let Err(e) = crate::summaries::migrate_summary(&old_id, &new_id) {
        crate::config::debug_log(&format!("skill_rename: 速览迁移失败 {e}"));
    }
    Ok(serde_json::json!({ "skill_dir": new_dir.to_string_lossy() }))
}

/// 重命名纯核心（参数化以便单测）：name 校验 + authored 归属 + EXISTS + 引用拒 + 目录改名。
pub(crate) fn rename_skill_core(
    dir: &Path,
    new_name: &str,
    authored_root: &Path,
    ledger_sources: &[String],
) -> Result<PathBuf, String> {
    let name = new_name.trim();
    crate::commands::validate_skill_name(name)?;
    assert_path_owned_with_roots(dir, &[authored_root.to_path_buf()])?;
    if !dir.is_dir() {
        return Err("技能目录不存在".into());
    }
    let parent = dir
        .parent()
        .ok_or_else(|| "无法取父目录".to_string())?;
    let new_dir = parent.join(name);
    if new_dir.exists() {
        return Err("EXISTS".into());
    }
    // 台账引用检查：source 等于该目录或其子路径 → 拒
    let dir_clean = crate::hub::clean_path_str(dir);
    let prefix = format!("{dir_clean}\\");
    if ledger_sources
        .iter()
        .any(|s| *s == dir_clean || s.starts_with(&prefix))
    {
        return Err("该技能有 Hub 引用，先解除引用再重命名".into());
    }
    std::fs::rename(dir, &new_dir).map_err(|e| format!("目录改名失败：{e}"))?;
    Ok(new_dir)
}

// ---------------------------------------------------------------------------
// W4（PLAN-07 §5）：附带资源文件树 + 删除
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Debug)]
pub struct FileNode {
    /// 相对 skill_dir 的斜杠路径
    pub rel: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

const SKIP_DIRS: [&str; 2] = [".git", "node_modules"];
const MAX_DEPTH: u32 = 3;

fn walk_dir(root: &Path, dir: &Path, depth: u32) -> Result<Vec<FileNode>, String> {
    if depth >= MAX_DEPTH {
        return Ok(vec![]);
    }
    let rd = std::fs::read_dir(dir).map_err(|e| format!("读目录失败：{e}"))?;
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    let mut nodes = Vec::new();
    for e in entries {
        let name = e.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let path = e.path();
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "内部错误：rel 计算失败".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let is_dir = path.is_dir();
        let children = if is_dir {
            walk_dir(root, &path, depth + 1)?
        } else {
            Vec::new()
        };
        nodes.push(FileNode { rel, name, is_dir, children });
    }
    Ok(nodes)
}

/// 文件树核心（roots 参数化）：归属闸 + 深度 ≤3 + 跳 .git/node_modules。
pub(crate) fn list_files_checked(
    skill_dir: &Path,
    roots: &[PathBuf],
) -> Result<Vec<FileNode>, String> {
    assert_path_owned_with_roots(skill_dir, roots)?;
    if !skill_dir.is_dir() {
        return Err("技能目录不存在".into());
    }
    walk_dir(skill_dir, skill_dir, 0)
}

#[tauri::command]
pub fn skill_list_files(skill_dir: String) -> Result<Vec<FileNode>, String> {
    list_files_checked(Path::new(&skill_dir), &owned_roots())
}

/// 删除附带文件核心：同闸；SKILL.md 绝不删；目录递归删。
pub(crate) fn delete_file_checked(
    skill_dir: &Path,
    rel: &str,
    roots: &[PathBuf],
) -> Result<(), String> {
    assert_rel_safe(rel)?;
    assert_path_owned_with_roots(skill_dir, roots)?;
    if rel.replace('\\', "/").eq_ignore_ascii_case("SKILL.md") {
        return Err("SKILL.md 不可删除".into());
    }
    let target = skill_dir.join(rel);
    if !target.exists() {
        return Err("目标不存在".into());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("删目录失败：{e}"))?;
    } else {
        std::fs::remove_file(&target).map_err(|e| format!("删文件失败：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn skill_delete_file(skill_dir: String, rel: String) -> Result<(), String> {
    delete_file_checked(Path::new(&skill_dir), &rel, &owned_roots())
}

/// PLAN-11 3.1：导入外部文件到 skill 目录（二进制安全 `fs::copy`）。
/// 归属闸(skill_dir) + rel 安全闸(target_rel)；源文件由用户经 dialog 选定，须存在。
/// 目标已存在 → 拒（EXISTS），避免静默覆盖用户附件。
pub(crate) fn import_file_checked(
    skill_dir: &Path,
    source_path: &Path,
    target_rel: &str,
    roots: &[PathBuf],
) -> Result<PathBuf, String> {
    assert_rel_safe(target_rel)?;
    assert_path_owned_with_roots(skill_dir, roots)?;
    if !source_path.is_file() {
        return Err("源文件不存在".to_string());
    }
    let target = skill_dir.join(target_rel);
    if target.exists() {
        return Err("EXISTS".to_string());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::copy(source_path, &target).map_err(|e| format!("复制失败：{e}"))?;
    Ok(target)
}

#[tauri::command]
pub fn skill_import_file(
    skill_dir: String,
    source_path: String,
    target_rel: String,
) -> Result<serde_json::Value, String> {
    let target = import_file_checked(
        Path::new(&skill_dir),
        Path::new(&source_path),
        &target_rel,
        &owned_roots(),
    )?;
    Ok(serde_json::json!({
        "rel": target_rel,
        "path": target.to_string_lossy(),
    }))
}

// ---------------------------------------------------------------------------
// C10 单测：字节级保留（验收硬标准）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c10_tests {
    use super::*;

    /// 含未知字段（metadata 嵌套）+ 注释 + 多行块标量的第三方 SKILL.md fixture
    const FIXTURE: &str = "---\nname: old-name\ndescription: Old description\n# third-party comment\nmetadata:\n  author: someone\n  version: 2\ndescription_block: |\n  line1\n  line2\n---\n\n# Body\n\nKeep me.\n";

    #[test]
    fn set_preserves_unknown_fields_byte_level() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "name".into(),
                op: "set".into(),
                value: Some("new-name".into()),
            }],
        )
        .unwrap();
        // 除 name 行外逐字节一致
        let expect = FIXTURE.replacen(
            "name: old-name",
            "name: \"new-name\"",
            1,
        );
        assert_eq!(out, expect, "未知字段/注释/多行块必须字节级保留");
        assert!(out.contains("metadata:\n  author: someone\n  version: 2"));
        assert!(out.contains("description_block: |\n  line1\n  line2"));
        assert!(out.contains("# third-party comment"));
        assert!(out.ends_with("\n\n# Body\n\nKeep me.\n"));
    }

    #[test]
    fn set_replaces_multiline_block_range() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "description_block".into(),
                op: "set".into(),
                value: Some("flat now".into()),
            }],
        )
        .unwrap();
        assert!(out.contains("description_block: \"flat now\"\n---"));
        assert!(!out.contains("line1"), "块标量续行必须随整段移除");
    }

    #[test]
    fn delete_removes_key_only() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "metadata".into(),
                op: "delete".into(),
                value: None,
            }],
        )
        .unwrap();
        assert!(!out.contains("metadata:"));
        assert!(!out.contains("author: someone"));
        assert!(out.contains("name: old-name"));
        assert!(out.contains("# Body"), "正文不受影响");
    }

    #[test]
    fn set_appends_unknown_key() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "allowed-tools".into(),
                op: "set".into(),
                value: Some("Read,Grep".into()),
            }],
        )
        .unwrap();
        assert!(out.contains("description_block: |\n  line1\n  line2\nallowed-tools: \"Read,Grep\"\n---"));
    }

    #[test]
    fn rejects_no_frontmatter_and_unclosed() {
        assert!(edit_frontmatter_checked("# just body", &[]).is_err());
        assert!(edit_frontmatter_checked("---\nname: x\nno close", &[]).is_err());
    }
}

// ---------------------------------------------------------------------------
// 重命名纯核心单测（UI 反馈 2026-08-05）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod rename_tests {
    use super::rename_skill_core;

    #[test]
    fn renames_dir_under_authored_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("authored");
        let dir = root.join("old-name");
        std::fs::create_dir_all(&dir).unwrap();
        let new_dir = rename_skill_core(&dir, "new-name", &root, &[]).unwrap();
        assert!(new_dir.is_dir());
        assert!(!dir.exists());
        assert!(new_dir.ends_with("new-name"));
    }

    #[test]
    fn rejects_exists_and_bad_name_and_outside_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("authored");
        let dir = root.join("a-skill");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(root.join("taken")).unwrap();
        // EXISTS
        assert_eq!(
            rename_skill_core(&dir, "taken", &root, &[]).unwrap_err(),
            "EXISTS"
        );
        // 非法 name
        assert!(rename_skill_core(&dir, "Bad_Name", &root, &[]).is_err());
        // 非 authored 根下
        let outside = tmp.path().join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(rename_skill_core(&outside, "ok-name", &root, &[]).is_err());
    }

    #[test]
    fn rejects_when_ledger_references_source() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("authored");
        let dir = root.join("linked-skill");
        std::fs::create_dir_all(&dir).unwrap();
        let clean = crate::hub::clean_path_str(&dir);
        // 精确匹配与子路径匹配都拒
        assert!(rename_skill_core(&dir, "x-name", &root, &[clean.clone()]).is_err());
        assert!(rename_skill_core(&dir, "x-name", &root, &[format!("{clean}\\agents")])
            .is_err());
        // 无关引用放行
        assert!(dir.exists());
        assert!(rename_skill_core(&dir, "free-name", &root, &["C:\\other\\skill".into()])
            .is_ok());
    }
}

// ---------------------------------------------------------------------------
// C8 反向单测：openai.yaml → SKILL.md（UI 反馈 2026-08-05 菜单转换）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c8_reverse_tests {
    use super::*;

    fn roots_with(tmp: &Path) -> Vec<PathBuf> {
        vec![tmp.to_path_buf()]
    }

    fn write_yaml(skill: &Path) {
        std::fs::create_dir_all(skill.join("agents")).unwrap();
        let f = OpenaiFields {
            display_name: "My Skill".into(),
            short_description: "A UI blurb of proper length here".into(),
            default_prompt: "Use $skill-name to do the thing".into(),
            icon_small: None,
            icon_large: None,
            brand_color: None,
        };
        std::fs::write(skill.join("agents").join("openai.yaml"), emit_openai_yaml(&f)).unwrap();
    }

    #[test]
    fn derives_skill_md_from_openai_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("codex-only");
        write_yaml(&skill);
        let res = generate_claude_md_checked(&skill, &roots_with(tmp.path())).unwrap();
        assert_eq!(res["created"], true);
        let md = std::fs::read_to_string(skill.join("SKILL.md")).unwrap();
        assert!(md.contains("name: codex-only"));
        assert!(md.contains("description: A UI blurb of proper length here"));
        assert!(md.contains("# My Skill"));
        assert!(md.contains("Use $skill-name to do the thing"));
    }

    #[test]
    fn refuses_when_skill_md_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("both");
        write_yaml(&skill);
        std::fs::write(skill.join("SKILL.md"), "---\nname: both\ndescription: x y z\n---\norig\n").unwrap();
        let res = generate_claude_md_checked(&skill, &roots_with(tmp.path())).unwrap();
        assert_eq!(res["created"], false);
        let md = std::fs::read_to_string(skill.join("SKILL.md")).unwrap();
        assert!(md.contains("orig"), "已有正文绝不被覆盖");
    }

    #[test]
    fn errs_when_yaml_missing_or_outside_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("no-yaml");
        std::fs::create_dir_all(&skill).unwrap();
        assert!(generate_claude_md_checked(&skill, &roots_with(tmp.path())).is_err());
        // 路径逃逸拒
        let outside = tempfile::tempdir().unwrap();
        let evil = outside.path().join("evil");
        std::fs::create_dir_all(&evil).unwrap();
        let err = generate_claude_md_checked(&evil, &roots_with(tmp.path())).unwrap_err();
        assert!(err.starts_with("PATH_ESCAPE"), "{err}");
    }
}

// ---------------------------------------------------------------------------
// W4 单测：文件树形状 / 逃逸拒 / SKILL.md 保护 / 删除
// ---------------------------------------------------------------------------
#[cfg(test)]
mod w4_tests {
    use super::*;

    fn seed(tmp: &Path) -> PathBuf {
        let skill = tmp.join("my-skill");
        std::fs::create_dir_all(skill.join("scripts")).unwrap();
        std::fs::create_dir_all(skill.join("references")).unwrap();
        std::fs::create_dir_all(skill.join(".git")).unwrap();
        std::fs::create_dir_all(skill.join("a/b/c/d")).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: my-skill\ndescription: x y z\n---\n").unwrap();
        std::fs::write(skill.join("scripts/run.py"), "print(1)").unwrap();
        std::fs::write(skill.join("references/note.md"), "note").unwrap();
        std::fs::write(skill.join(".git/HEAD"), "ref").unwrap();
        std::fs::write(skill.join("a/b/c/d/deep.txt"), "deep").unwrap();
        skill
    }

    #[test]
    fn tree_shape_depth_and_skip() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = seed(tmp.path());
        let tree = list_files_checked(&skill, &[tmp.path().to_path_buf()]).unwrap();
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"SKILL.md"));
        assert!(names.contains(&"scripts"));
        assert!(!names.contains(&".git"), ".git 必须跳过");
        let a = tree.iter().find(|n| n.name == "a").unwrap();
        let b = &a.children[0];
        let c = &b.children[0];
        assert_eq!(c.name, "c");
        assert!(c.children.is_empty(), "深度 >3 必须截断（d 不出现）");
    }

    #[test]
    fn list_rejects_outside_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = list_files_checked(outside.path(), &[tmp.path().to_path_buf()]).unwrap_err();
        assert!(err.starts_with("PATH_ESCAPE"), "{err}");
    }

    #[test]
    fn delete_protects_skill_md_and_rel_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = seed(tmp.path());
        let roots = vec![tmp.path().to_path_buf()];
        assert_eq!(
            delete_file_checked(&skill, "SKILL.md", &roots).unwrap_err(),
            "SKILL.md 不可删除"
        );
        assert!(delete_file_checked(&skill, "../x.txt", &roots).is_err());
        assert!(delete_file_checked(&skill, "scripts/../../evil", &roots).is_err());
        assert!(skill.join("SKILL.md").exists());
    }

    #[test]
    fn delete_file_and_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = seed(tmp.path());
        let roots = vec![tmp.path().to_path_buf()];
        delete_file_checked(&skill, "references/note.md", &roots).unwrap();
        assert!(!skill.join("references/note.md").exists());
        delete_file_checked(&skill, "scripts", &roots).unwrap();
        assert!(!skill.join("scripts").exists());
        assert!(skill.join("SKILL.md").exists());
    }
}

// ---------------------------------------------------------------------------
// PLAN-11 3.1 单测：skill_import_file 二进制安全 + 安全闸 + EXISTS
// ---------------------------------------------------------------------------
#[cfg(test)]
mod import_tests {
    use super::*;

    #[test]
    fn copies_binary_file_into_assets_byte_level() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let src = tmp.path().join("src.bin");
        let bytes: Vec<u8> = vec![0, 255, 1, 2, 3, 0];
        std::fs::write(&src, &bytes).unwrap();
        let roots = vec![tmp.path().to_path_buf()];
        let target = import_file_checked(&skill, &src, "assets/src.bin", &roots).unwrap();
        assert!(target.exists());
        assert_eq!(std::fs::read(target).unwrap(), bytes, "二进制须字节级一致");
    }

    #[test]
    fn rejects_rel_escape_missing_source_outside_root() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let src = tmp.path().join("src.txt");
        std::fs::write(&src, "x").unwrap();
        let roots = vec![tmp.path().to_path_buf()];
        // rel 逃逸
        assert!(import_file_checked(&skill, &src, "../evil", &roots).is_err());
        // 源不存在
        assert!(
            import_file_checked(&skill, &tmp.path().join("nope.txt"), "a.txt", &roots).is_err()
        );
        // 非归属目录
        let outside = tempfile::tempdir().unwrap();
        assert!(import_file_checked(outside.path(), &src, "a.txt", &roots).is_err());
    }

    #[test]
    fn rejects_overwrite_existing_target() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill.join("assets")).unwrap();
        std::fs::write(skill.join("assets/a.txt"), "old").unwrap();
        let src = tmp.path().join("src.txt");
        std::fs::write(&src, "new").unwrap();
        let roots = vec![tmp.path().to_path_buf()];
        assert_eq!(
            import_file_checked(&skill, &src, "assets/a.txt", &roots).unwrap_err(),
            "EXISTS"
        );
        assert_eq!(
            std::fs::read_to_string(skill.join("assets/a.txt")).unwrap(),
            "old",
            "已有附件绝不被静默覆盖"
        );
    }
}

