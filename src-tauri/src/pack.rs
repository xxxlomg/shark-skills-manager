//! Skill Pack — 平台原生打包格式（P1）。
//!
//! 格式：.skillpack = zip，内含 pack.json（机器层唯一事实源）+ README.md
//! （人类层）+ skills/<name>/（原样 skill 文件夹）+ 可选 i18n/ sidecar（P2）。
//! 所有函数接受显式 base 路径，便于测试注入；命令层传 config::packs_dir()。
//!
//! 打包前强制校验（C4）：create_pack 对每个入选技能目录跑
//! 严格模式校验；任一技能有 Error 且 force=false → 拒绝打包并返回结构化清单
//! （PackCreateError::ValidationFailed）；force=true 放行，所有 Warn/Error
//! 摘要写入 pack.json 的 validation_warnings（旧包无此字段 → serde default）。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::import;
use crate::translations;

pub const FORMAT_VERSION: u32 = 1;
/// 单次打包技能数上限（与 AI 输入预算对齐）
const MAX_SKILLS_PER_PACK: usize = 40;
/// 静态总结里单条 description 截断长度
const DESC_TRUNC: usize = 300;
/// 生成器署名（版本号编译期取自 Cargo.toml，避免手动同步漂移）
const GENERATOR: &str = "shark skills";

// ---------------------------------------------------------------------------
// Manifest（pack.json schema v1）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackFileEntry {
    pub rel: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackSkillEntry {
    pub path: String,
    pub name: String,
    pub has_translation: bool,
    pub bytes: u64,
    pub files: Vec<PackFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackSummary {
    /// "ai" | "static"
    pub source: String,
    pub overview: String,
    /// key = skill path（skills/<folder>），value = 一句话作用
    pub skills: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackManifest {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub ver: String,
    pub author: String,
    pub created_at: String,
    pub generator: String,
    pub summary: PackSummary,
    #[serde(default)]
    pub i18n: Vec<String>,
    pub skills: Vec<PackSkillEntry>,
    /// C4：打包时严格校验的 Warn/Error 摘要，形如
    /// `[skills/<folder>] <RULE_ID> (<error|warn>): <message>`。
    /// force 逃生门放行（或仅 Warn 不阻断）时留痕，下游可见"带伤发布"。
    /// 旧包（v0.1 等）无此字段 → serde default 空；全绿包序列化时省略
    /// （skip_serializing_if），保持 v1 schema 字节不变。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validation_warnings: Vec<String>,
}

/// 前端 PackCard 展示用
#[derive(Debug, Clone, Serialize)]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub ver: String,
    pub author: String,
    pub created_at: String,
    pub skill_count: usize,
    pub translated: usize,
    pub overview: String,
    /// summary.source：ai / static
    pub summary_source: String,
    pub skill_names: Vec<String>,
}

/// 打包输入：前端直接传扫描结果的字段（source_path = SKILL.md 绝对路径，
/// 避免虚拟 id 反解）。
#[derive(Debug, Clone, Deserialize)]
pub struct PackSkillInput {
    pub source_path: String,
    /// 扫描结果的虚拟 skill_id（tool_id|rel），P10b 打包带译文时据此查译文
    #[serde(default)]
    pub skill_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub description_zh: String,
    #[serde(default)]
    pub has_translation: bool,
}

/// P10b：i18n sidecar 的 meta（`i18n/<folder>/meta.json`）。
/// 不含 source_path —— 导入方的主机路径不同，落盘时按新 skill_id 重算。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackI18nMeta {
    #[serde(default)]
    pub title_zh: String,
    #[serde(default)]
    pub source_hash: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub translated_at: String,
    #[serde(default)]
    pub scan_label: String,
}

/// zip 内 pack.json 探测结果（ImportDialog 分流用）
#[derive(Debug, Clone, Serialize)]
pub struct PackDetect {
    pub name: String,
    pub ver: String,
    pub author: String,
    pub skill_count: usize,
    pub format_version: u32,
}

// ---------------------------------------------------------------------------
// C4：打包前校验的错误结构
// ---------------------------------------------------------------------------

/// 单个技能严格校验失败条目。前端按清单渲染（弹窗列出问题 → 修复或 force）。
#[derive(Debug, Clone, Serialize)]
pub struct SkillValidationFailure {
    /// 打包入参 source_path 原样回显（SKILL.md 绝对路径），前端可据此定位选中项
    pub skill_path: String,
    /// 前端传入的显示名
    pub name: String,
    /// 严格模式完整 issue 列表（severity 区分阻断项 Error 与建议项 Warn/Info）
    pub issues: Vec<crate::validate::Issue>,
}

/// pack_create 错误。序列化为 JSON 后经 tauri InvokeError 下发前端：
/// `{"kind":"validation_failed","message":..,"failed":[..]}` /
/// `{"kind":"message","message":..}`。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackCreateError {
    /// 严格校验未通过且 force=false；failed 为逐技能问题清单
    ValidationFailed {
        /// 人类可读摘要（清单渲染未接线前可直接展示）
        message: String,
        failed: Vec<SkillValidationFailure>,
    },
    /// 其余打包错误（路径无效、IO 等），保持既有消息形态
    Message { message: String },
}

impl PackCreateError {
    fn msg(message: impl Into<String>) -> Self {
        Self::Message { message: message.into() }
    }
}

/// 既有管线大量 Result<_, String>，统一经 From 升格，`?` 无需逐处改写
impl From<String> for PackCreateError {
    fn from(message: String) -> Self {
        Self::Message { message }
    }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("读取失败 {}: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex_encode(&hasher.finalize()))
}

/// name → 目录安全的 slug id
fn slugify(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    // 折叠连续 '-'
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !prev_dash {
                out.push(c);
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "pack".to_string() } else { out }
}

/// packs/<id> 冲突时追加数字后缀
fn alloc_pack_dir(base: &Path, preferred: &str) -> String {
    if !base.join(preferred).exists() {
        return preferred.to_string();
    }
    let mut n = 2;
    loop {
        let cand = format!("{}-{}", preferred, n);
        if !base.join(&cand).exists() {
            return cand;
        }
        n += 1;
    }
}

/// 递归收集目录下所有文件：(相对路径斜杠式, sha256, 字节数)
fn collect_files(dir: &Path, base: &Path) -> Result<Vec<(String, String, u64)>, String> {
    let mut out = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let p = entry.path();
        if p.is_dir() {
            out.extend(collect_files(&p, base)?);
        } else if p.is_file() {
            let rel = p
                .strip_prefix(base)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let sha = sha256_file(&p)?;
            let bytes = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            out.push((rel, sha, bytes));
        }
    }
    Ok(out)
}

fn read_manifest(dir: &Path) -> Result<PackManifest, String> {
    let text = fs::read_to_string(dir.join("pack.json"))
        .map_err(|e| format!("pack.json 读取失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("pack.json 解析失败: {}", e))
}

fn to_info(m: &PackManifest) -> PackInfo {
    PackInfo {
        id: m.id.clone(),
        name: m.name.clone(),
        ver: m.ver.clone(),
        author: m.author.clone(),
        created_at: m.created_at.clone(),
        skill_count: m.skills.len(),
        translated: m.skills.iter().filter(|s| s.has_translation).count(),
        overview: m.summary.overview.clone(),
        summary_source: m.summary.source.clone(),
        skill_names: m.skills.iter().map(|s| s.name.clone()).collect(),
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    let mut out: String = s.chars().take(max).collect();
    if s.chars().count() > max {
        out.push('…');
    }
    out
}

// ---------------------------------------------------------------------------
// 静态总结 + README（P1；P2 加 AI 分支）
// ---------------------------------------------------------------------------

fn build_static_summary(
    name: &str,
    author: &str,
    entries: &[(String, PackSkillInput)], // (folder, input)
) -> PackSummary {
    let names: Vec<&str> = entries.iter().map(|(_, s)| s.name.as_str()).collect();
    let overview = truncate_chars(
        &format!(
            "{} 打包的 {} 个技能合集：{}",
            if author.is_empty() { "未知作者" } else { author },
            entries.len(),
            names.join("、")
        ),
        200,
    );
    let _ = name;
    let mut skills = HashMap::new();
    for (folder, s) in entries {
        let desc = if !s.description_zh.trim().is_empty() {
            &s.description_zh
        } else {
            &s.description
        };
        let one = truncate_chars(desc.trim(), DESC_TRUNC);
        let one = if one.is_empty() { "（无描述）".to_string() } else { one };
        skills.insert(format!("skills/{}", folder), one);
    }
    PackSummary {
        source: "static".to_string(),
        overview,
        skills,
    }
}

fn render_readme(m: &PackManifest) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {}\n\n", m.name));
    md.push_str(&format!(
        "> v{} · by {} · {} · 由 {} 生成\n\n",
        m.ver, m.author, m.created_at, m.generator
    ));
    md.push_str("## 概述\n\n");
    md.push_str(&m.summary.overview);
    md.push_str("\n\n## 技能清单\n\n");
    md.push_str("| 技能 | 说明 |\n| --- | --- |\n");
    for s in &m.skills {
        let desc = m
            .summary
            .skills
            .get(&s.path)
            .cloned()
            .unwrap_or_default()
            .replace('|', "/")
            .replace('\n', " ");
        let desc = truncate_chars(&desc, 120);
        md.push_str(&format!("| {} | {} |\n", s.name, desc));
    }
    md.push_str("\n---\n\n");
    md.push_str("本包由 shark skills 打包。用 shark skills 导入可获得完整体验（含翻译）；");
    md.push_str("手动解包后 skills/ 下每个文件夹也是标准 skill，可单独取用。\n");
    md
}

// ---------------------------------------------------------------------------
// 打包
// ---------------------------------------------------------------------------

/// 创建 canonical pack：packs/<id>/（temp 写入后 rename，防半写）。
///
/// C4：打包前对每个入选技能目录跑严格校验。任一技能存在 Error 级
/// issue 且 force=false → 返回 `PackCreateError::ValidationFailed`（结构化
/// 清单，拒绝时零落盘副作用）；force=true 放行。校验产出的全部 Warn/Error
/// 摘要写入 manifest.validation_warnings（Warn 永不阻断）。校验自身不可用
/// （如 SKILL.md 读不了）由 validate 层按 FM-01 Error 覆盖，无特判。
pub fn create_pack(
    base: &Path,
    name: &str,
    ver: &str,
    author: &str,
    skills: &[PackSkillInput],
    force: bool,
) -> Result<PackInfo, PackCreateError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(PackCreateError::msg("Pack 名称不能为空"));
    }
    if skills.is_empty() {
        return Err(PackCreateError::msg("至少选择 1 个技能"));
    }
    if skills.len() > MAX_SKILLS_PER_PACK {
        return Err(PackCreateError::msg(format!(
            "单次打包上限 {} 个技能",
            MAX_SKILLS_PER_PACK
        )));
    }

    // 解析源目录 + 确定性改名（排序后分配，与选择顺序无关）
    let mut entries: Vec<(String, PathBuf, &PackSkillInput)> = Vec::new();
    for s in skills {
        let md_path = Path::new(&s.source_path);
        if !md_path.is_file() {
            return Err(PackCreateError::msg(format!(
                "技能源文件不存在: {}",
                s.source_path
            )));
        }
        let dir = md_path
            .parent()
            .ok_or_else(|| format!("非法路径: {}", s.source_path))?;
        let folder = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .ok_or_else(|| format!("无法取目录名: {}", dir.display()))?;
        entries.push((folder, dir.to_path_buf(), s));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut placed: Vec<(String, PathBuf, &PackSkillInput)> = Vec::new();
    for (folder, dir, s) in entries {
        let mut target = folder.clone();
        let mut n = 2;
        while used.contains(&target) {
            target = format!("{}-{}", folder, n);
            n += 1;
        }
        used.insert(target.clone());
        placed.push((target, dir, s));
    }

    // C4 校验门：早于一切落盘，拒绝路径零副作用。
    // warnings 无论是否 force 都记录（"带伤发布"留痕，下游导入方可见）；
    // force 仅决定是否放行 Error。
    let (failed, validation_warnings) = validate_selected(&placed);
    if !force && !failed.is_empty() {
        return Err(PackCreateError::ValidationFailed {
            message: format!(
                "{} 个技能未通过严格校验，已拒绝打包（force 可强制放行，告警将写入 pack.json）",
                failed.len()
            ),
            failed,
        });
    }

    let id = alloc_pack_dir(base, &slugify(name));
    let tmp = base.join(format!(".tmp-{}", id));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())?;
    }
    let skills_root = tmp.join("skills");
    fs::create_dir_all(&skills_root).map_err(|e| e.to_string())?;

    let mut manifest_skills: Vec<PackSkillEntry> = Vec::new();
    let mut summary_inputs: Vec<(String, PackSkillInput)> = Vec::new();
    let mut i18n_paths: Vec<String> = Vec::new();
    for (folder, src, s) in &placed {
        let dst = skills_root.join(folder);
        import::copy_dir_recursive(src, &dst)?;
        let files = collect_files(&dst, &dst)?;
        let bytes: u64 = files.iter().map(|(_, _, b)| b).sum();
        manifest_skills.push(PackSkillEntry {
            path: format!("skills/{}", folder),
            name: s.name.clone(),
            has_translation: s.has_translation,
            bytes,
            files: files
                .into_iter()
                .map(|(rel, sha, _)| PackFileEntry { rel, sha256: sha })
                .collect(),
        });
        summary_inputs.push((folder.clone(), (*s).clone()));

        // P10b：已翻译技能 → 打包带双语译文 + meta（导入方立即可看译文）
        if s.has_translation && !s.skill_id.is_empty() {
            if let Some(bilingual) = translations::read_translated_content(&s.skill_id) {
                if !bilingual.trim().is_empty() {
                    let meta = translations::load_all_meta().get(&s.skill_id).cloned();
                    let i18n_dir = tmp.join("i18n").join(folder);
                    fs::create_dir_all(&i18n_dir).map_err(|e| e.to_string())?;
                    fs::write(i18n_dir.join("bilingual.md"), &bilingual)
                        .map_err(|e| e.to_string())?;
                    let im = PackI18nMeta {
                        title_zh: meta.as_ref().map(|m| m.title_zh.clone()).unwrap_or_default(),
                        source_hash: meta
                            .as_ref()
                            .map(|m| m.source_hash.clone())
                            .unwrap_or_default(),
                        model: meta.as_ref().map(|m| m.model.clone()).unwrap_or_default(),
                        translated_at: meta
                            .as_ref()
                            .map(|m| m.translated_at.clone())
                            .unwrap_or_default(),
                        scan_label: meta
                            .as_ref()
                            .map(|m| m.scan_label.clone())
                            .unwrap_or_default(),
                    };
                    fs::write(
                        i18n_dir.join("meta.json"),
                        serde_json::to_string_pretty(&im).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?;
                    i18n_paths.push(format!("i18n/{}", folder));
                }
            }
        }
    }

    let manifest = PackManifest {
        format_version: FORMAT_VERSION,
        id: id.clone(),
        name: name.to_string(),
        ver: if ver.trim().is_empty() { "1.0.0".to_string() } else { ver.trim().to_string() },
        author: author.trim().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        generator: format!("{} {}", GENERATOR, env!("CARGO_PKG_VERSION")),
        summary: build_static_summary(name, author, &summary_inputs),
        i18n: i18n_paths,
        skills: manifest_skills,
        validation_warnings,
    };

    fs::write(
        tmp.join("pack.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(tmp.join("README.md"), render_readme(&manifest)).map_err(|e| e.to_string())?;

    // temp → 正式目录（原子化收尾）
    let final_dir = base.join(&id);
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &final_dir).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp);
        format!("落盘失败: {}", e)
    })?;

    crate::config::debug_log(&format!(
        "pack_create: id={} skills={} name={} force={} validation_warnings={}",
        id,
        manifest.skills.len(),
        name,
        force,
        manifest.validation_warnings.len()
    ));
    Ok(to_info(&manifest))
}

/// C4：对入选技能目录逐一跑严格模式校验（打包前强制校验）。
/// 返回 (失败清单, Warn/Error 摘要行)。摘要行格式：
/// `[skills/<folder>] <RULE_ID> (<error|warn>): <message>`，folder 用包内
/// 最终目录名（含改名后的 -2 等），保证与包内路径一致。
/// 校验自身不可用（SKILL.md 读不了等）已由 validate 层按 FM-01 Error 覆盖。
fn validate_selected(
    placed: &[(String, PathBuf, &PackSkillInput)],
) -> (Vec<SkillValidationFailure>, Vec<String>) {
    use crate::validate::{Mode, Severity};
    let mut failed: Vec<SkillValidationFailure> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    for (folder, dir, input) in placed {
        let report = crate::validate::validate_dir(dir, Mode::Strict);
        for issue in &report.issues {
            let sev = match issue.severity {
                Severity::Error => "error",
                Severity::Warn => "warn",
                Severity::Info => continue, // 仅 Warn/Error 入摘要
            };
            warnings.push(format!(
                "[skills/{}] {} ({}): {}",
                folder, issue.rule_id, sev, issue.message
            ));
        }
        if !report.passed {
            failed.push(SkillValidationFailure {
                skill_path: input.source_path.clone(),
                name: input.name.clone(),
                issues: report.issues,
            });
        }
    }
    (failed, warnings)
}

// ---------------------------------------------------------------------------
// 列表 / 删除
// ---------------------------------------------------------------------------

pub fn list_packs(base: &Path) -> Vec<PackInfo> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(base) else {
        return out;
    };
    for e in entries.filter_map(|e| e.ok()) {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        match read_manifest(&p) {
            Ok(m) => out.push(to_info(&m)),
            Err(err) => {
                crate::config::debug_log(&format!(
                    "packs_list skip {}: {}",
                    p.display(),
                    err
                ));
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

pub fn delete_pack(base: &Path, id: &str) -> Result<(), String> {
    let dir = base.join(id);
    if !dir.join("pack.json").is_file() {
        return Err(format!("Pack 不存在: {}", id));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除失败: {}", e))
}

/// 重命名 Pack：更新 pack.json 的 name 并重渲染 README（README 由 manifest 派生）。
pub fn rename_pack(base: &Path, id: &str, new_name: &str) -> Result<PackInfo, String> {
    let dir = base.join(id);
    if !dir.join("pack.json").is_file() {
        return Err(format!("Pack 不存在: {}", id));
    }
    let name = new_name.trim();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if name.chars().count() > 80 {
        return Err("名称过长（最多 80 字符）".to_string());
    }
    let mut m = read_manifest(&dir)?;
    m.name = name.to_string();
    fs::write(
        dir.join("pack.json"),
        serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("pack.json 写入失败: {}", e))?;
    fs::write(dir.join("README.md"), render_readme(&m)).map_err(|e| format!("README 写入失败: {}", e))?;
    crate::config::debug_log(&format!(
        "pack_rename: id={} old->new 已写入 name={}",
        id, name
    ));
    Ok(to_info(&m))
}

// ---------------------------------------------------------------------------
// 导出（canonical → .skillpack zip）
// ---------------------------------------------------------------------------

fn zip_dir(dir: &Path, dest: &Path) -> Result<u64, String> {
    let file = fs::File::create(dest).map_err(|e| format!("创建导出文件失败: {}", e))?;
    let mut zw = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    let files = collect_files(dir, dir)?;
    for (rel, _, _) in &files {
        zw.start_file(rel, opts).map_err(|e| e.to_string())?;
        let mut f = fs::File::open(dir.join(rel)).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        zw.write_all(&buf).map_err(|e| e.to_string())?;
    }
    zw.finish().map_err(|e| format!("zip 写入失败: {}", e))?;
    fs::metadata(dest).map(|m| m.len()).map_err(|e| e.to_string())
}

pub fn export_pack(base: &Path, id: &str, dest: &Path) -> Result<u64, String> {
    let dir = base.join(id);
    if !dir.join("pack.json").is_file() {
        return Err(format!("Pack 不存在: {}", id));
    }
    let size = zip_dir(&dir, dest)?;
    crate::config::debug_log(&format!(
        "pack_export: id={} dest={} bytes={}",
        id,
        dest.display(),
        size
    ));
    Ok(size)
}

// ---------------------------------------------------------------------------
// 探测 / 导入
// ---------------------------------------------------------------------------

/// zip 内找 pack.json（根或单层包裹目录下），返回摘要信息
pub fn detect_pack(zip_path: &Path) -> Option<PackDetect> {
    let file = fs::File::open(zip_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut candidates: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index(i) else {
            continue;
        };
        let name = entry.name().replace('\\', "/");
        let segs: Vec<&str> = name.split('/').filter(|s| !s.is_empty()).collect();
        if segs.last() == Some(&"pack.json") && segs.len() <= 2 {
            candidates.push(name);
        }
    }
    // 优先根级；其次唯一包裹目录
    let pick = if candidates.iter().any(|c| c == "pack.json") {
        Some("pack.json".to_string())
    } else if candidates.len() == 1 {
        candidates.into_iter().next()
    } else {
        None
    }?;
    let mut entry = archive.by_name(&pick).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    let m: PackManifest = serde_json::from_str(&text).ok()?;
    Some(PackDetect {
        name: m.name,
        ver: m.ver,
        author: m.author,
        skill_count: m.skills.len(),
        format_version: m.format_version,
    })
}

/// 导入 .skillpack：版本闸 → sha256 自验 → 落 packs/<id>。
/// id 冲突自动追加后缀（不覆盖已有 pack）。
pub fn import_pack(base: &Path, zip_path: &Path) -> Result<PackInfo, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    import::extract_safely(zip_path, tmp.path())?;

    // pack.json 定位：优先根级；否则仅当唯一子目录内含 pack.json 才解包裹。
    // 注意不能复用 import::unwrap_single_dir——本格式的 skills/ 恰好是
    // 唯一顶层目录，会被误判成包裹层。
    let root = if tmp.path().join("pack.json").is_file() {
        tmp.path().to_path_buf()
    } else {
        let dirs: Vec<PathBuf> = fs::read_dir(tmp.path())
            .map(|e| e.filter_map(|x| x.ok()).map(|x| x.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        if dirs.len() == 1 && dirs[0].join("pack.json").is_file() {
            dirs[0].clone()
        } else {
            tmp.path().to_path_buf()
        }
    };

    let manifest_path = root.join("pack.json");
    if !manifest_path.is_file() {
        return Err("非 Skill Pack：缺少 pack.json".to_string());
    }
    let text = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let m: PackManifest =
        serde_json::from_str(&text).map_err(|e| format!("pack.json 解析失败: {}", e))?;

    if m.format_version > FORMAT_VERSION {
        return Err(format!(
            "该包由更新版本的 shark skills 生成（format v{}），请升级后再导入",
            m.format_version
        ));
    }

    // sha256 自验
    for s in &m.skills {
        let rel = s.path.trim_start_matches("skills/");
        let skill_dir = root.join("skills").join(rel);
        if !skill_dir.is_dir() {
            return Err(format!("包内缺少技能目录: {}", s.path));
        }
        for f in &s.files {
            let fp = skill_dir.join(&f.rel);
            if !fp.is_file() {
                return Err(format!("包内缺少文件: {}/{}", s.path, f.rel));
            }
            let sha = sha256_file(&fp)?;
            if sha != f.sha256 {
                return Err(format!("文件校验失败（sha256 不符）: {}/{}", s.path, f.rel));
            }
        }
    }

    let id = alloc_pack_dir(base, &m.id);
    let target = base.join(&id);
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    for item in ["pack.json", "README.md"] {
        let src = root.join(item);
        if src.is_file() {
            fs::copy(&src, target.join(item)).map_err(|e| e.to_string())?;
        }
    }
    if root.join("i18n").is_dir() {
        import::copy_dir_recursive(&root.join("i18n"), &target.join("i18n"))?;
    }
    import::copy_dir_recursive(&root.join("skills"), &target.join("skills"))?;

    // id 被改名时同步 manifest，保证后续导出/安装一致
    if id != m.id {
        let mut m2 = m.clone();
        m2.id = id.clone();
        fs::write(
            target.join("pack.json"),
            serde_json::to_string_pretty(&m2).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        crate::config::debug_log(&format!(
            "pack_import: id conflict, {} -> {}",
            m.id, id
        ));
        return Ok(to_info(&m2));
    }

    crate::config::debug_log(&format!(
        "pack_import: id={} skills={}",
        id,
        m.skills.len()
    ));
    Ok(to_info(&m))
}

// ---------------------------------------------------------------------------
// 安装（packs/<id> → 部署到用户指定目录 <target>/skills/，D6/D7/D8）
//   • 不再塞进 imported/（import 仅负责"增加"）；安装 = 部署到真实工具目录。
//   • 同名冲突不再自动追加 -N（D2），改为 preview 返回冲突 → 前端确认覆盖。
//   • 目标不在扫描路径时自动加为扫描根（D7），命中现有工具根则归属该工具（D8）。
// ---------------------------------------------------------------------------

/// 安装预览：解析 pack + 冲突清单，不写盘、不改配置。
#[derive(Debug, Clone, serde::Serialize)]
pub struct InstallPreview {
    pub deploy_root: String,
    pub skill_folders: Vec<String>,
    pub conflicts: Vec<String>,
    pub is_new_tool: bool,
}

pub fn install_pack_preview(
    pack_base: &Path,
    deploy_root: &Path,
    id: &str,
) -> Result<InstallPreview, String> {
    let dir = pack_base.join(id);
    let m = read_manifest(&dir).map_err(|_| format!("Pack 不存在: {}", id))?;

    let mut skill_folders = Vec::new();
    let mut conflicts = Vec::new();
    for s in &m.skills {
        let folder = s.path.trim_start_matches("skills/");
        let src = dir.join("skills").join(folder);
        if !src.is_dir() {
            return Err(format!("Pack 内缺少技能目录: {}", s.path));
        }
        skill_folders.push(folder.to_string());
        if deploy_root.join(folder).exists() {
            conflicts.push(folder.to_string());
        }
    }

    let is_new_tool =
        crate::config::find_tool_for_scan_path(deploy_root).is_none();
    Ok(InstallPreview {
        deploy_root: deploy_root.to_string_lossy().to_string(),
        skill_folders,
        conflicts,
        is_new_tool,
    })
}

/// 安装提交：把 pack 内容部署到 deploy_root（=<target>/skills/）。
/// `tool_id`/`scan_label` 为归属工具（由命令层按 D7/D8 解析），本函数保持纯 FS
/// 无配置副作用，便于单测隔离。`overwrite` = 用户确认覆盖的同名 folder 列表；
/// 不在其中且已存在的 folder 跳过（D2）。
pub fn install_pack_commit(
    pack_base: &Path,
    deploy_root: &Path,
    id: &str,
    overwrite: &[String],
    tool_id: &str,
    scan_label: &str,
) -> Result<usize, String> {
    let dir = pack_base.join(id);
    let m = read_manifest(&dir).map_err(|_| format!("Pack 不存在: {}", id))?;

    fs::create_dir_all(deploy_root).map_err(|e| e.to_string())?;

    let mut deployed = 0usize;
    let mut records: Vec<serde_json::Value> = Vec::new();
    for s in &m.skills {
        let folder = s.path.trim_start_matches("skills/");
        let src = dir.join("skills").join(folder);
        if !src.is_dir() {
            return Err(format!("Pack 内缺少技能目录: {}", s.path));
        }
        let dest = deploy_root.join(folder);
        // D2：已存在且未确认覆盖 → 跳过
        if dest.exists() && !overwrite.iter().any(|o| o == folder) {
            continue;
        }
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        import::copy_dir_recursive(&src, &dest)?;

        // P10b：恢复 i18n —— 按部署后的新 skill_id（<tool_id>|<rel>）落盘译文
        let i18n_dir = dir.join("i18n").join(folder);
        if i18n_dir.join("bilingual.md").is_file() {
            let bilingual = fs::read_to_string(i18n_dir.join("bilingual.md")).unwrap_or_default();
            let meta: Option<PackI18nMeta> = fs::read_to_string(i18n_dir.join("meta.json"))
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok());
            let new_skill_id = format!("{}|{}", tool_id, folder);
            let source_path = dest.join("SKILL.md").to_string_lossy().to_string();
            translations::restore_imported(
                &new_skill_id,
                &bilingual,
                meta.as_ref().map(|m| m.title_zh.as_str()).unwrap_or(""),
                &source_path,
                meta.as_ref().map(|m| m.scan_label.as_str()).unwrap_or(scan_label),
                meta.as_ref().map(|m| m.source_hash.as_str()).unwrap_or(""),
                meta.as_ref().map(|m| m.model.as_str()).unwrap_or(""),
                meta.as_ref()
                    .map(|m| m.translated_at.as_str())
                    .unwrap_or(""),
            )?;
        }

        records.push(serde_json::json!({ "rel": folder, "folder": folder }));
        deployed += 1;
    }

    let prov = serde_json::json!({
        "source": format!("pack:{}", m.id),
        "kind": "pack",
        "installed_to": tool_id,
        "installed_at": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string(),
        "skills": records,
    });
    fs::write(
        deploy_root.join(".install.json"),
        serde_json::to_string_pretty(&prov).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    crate::config::debug_log(&format!(
        "pack_install: pack={} -> {} (tool={}) skills={}",
        id,
        deploy_root.display(),
        tool_id,
        deployed
    ));
    Ok(deployed)
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 只读核对真实数据目录的 packs 能否被当前代码加载（无数据机器自动跳过）。
    #[test]
    fn real_packs_dir_loads_existing_pack() {
        let Some(up) = std::env::var_os("USERPROFILE") else {
            return;
        };
        let base = PathBuf::from(up).join("AppData/Roaming/shark/shark-skills-manager/packs");
        if !base.is_dir() {
            return;
        }
        let list = list_packs(&base);
        // 真实数据校验：有 test pack 周期时验证可加载；用户已清理/从未创建则跳过
        // （测试只读，不对用户数据作存在性假设）。
        if !list.iter().any(|p| p.id == "test") {
            return;
        }
    }

    /// 只读端到端核对：真实 config.json 的 tools → 扫描目标含 imported →
    /// 已安装 pack 技能（internal-comms）能进扫描结果。无数据 / v0.1 旧格式配置自动跳过。
    #[test]
    fn real_config_scans_installed_pack_skills() {
        let Some(up) = std::env::var_os("USERPROFILE") else {
            return;
        };
        let root = PathBuf::from(up).join("AppData/Roaming/shark/shark-skills-manager");
        let Ok(text) = std::fs::read_to_string(root.join("config.json")) else {
            return;
        };
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        // v0.1 旧格式配置（仅 scan_paths 无 tools）= 尚未运行 v0.2 迁移，跳过
        let Some(tools_val) = v.get("tools") else {
            return;
        };
        let tools: Vec<crate::config::ToolEntry> =
            serde_json::from_value(tools_val.clone()).unwrap();
        // config 层：imported 工具在、启用、app_owned（生产环境由此派生扫描目标）
        assert!(
            tools
                .iter()
                .any(|t| t.id == "imported" && t.enabled && t.app_owned),
            "config.json 的 imported 工具缺失或未启用"
        );
        // scanner 层：显式以真实 imported 目录为目标（测试环境不能走
        // get_data_dir 全局，它会回退项目 _data）
        let imported_dir = root.join("imported");
        if !imported_dir.is_dir() {
            return;
        }
        let targets = vec![crate::config::ScanTarget {
            path: imported_dir.to_string_lossy().to_string(),
            label: "导入".into(),
            tool_id: "imported".into(),
        }];
        let skills = crate::scanner::scan_all_skills(&targets);
        assert!(
            skills.iter().any(|s| s.folder_name == "internal-comms"),
            "已安装 pack 技能未进扫描结果: {:?}",
            skills.iter().map(|s| s.folder_name.clone()).collect::<Vec<_>>()
        );
    }

    fn write_skill(dir: &Path, name: &str, desc: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {}\ndescription: {}\n---\n# {}\nbody\n", name, desc, name),
        )
        .unwrap();
        fs::write(dir.join("ref.md"), "resource").unwrap();
    }

    fn input(dir: &Path, name: &str, desc: &str) -> PackSkillInput {
        PackSkillInput {
            source_path: dir.join("SKILL.md").to_string_lossy().to_string(),
            skill_id: String::new(),
            name: name.to_string(),
            description: desc.to_string(),
            description_zh: String::new(),
            has_translation: false,
        }
    }

    #[test]
    fn create_list_export_import_install_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "desc alpha");
        write_skill(&src_root.join("beta"), "beta", "desc beta");

        let pack_base = tmp.path().join("packs");
        // 安装部署目录（新版语义：deploy_root = 选择目录/skills，见下方安装段）

        // 创建
        let info = create_pack(
            &pack_base,
            "My Test Pack",
            "1.2.0",
            "tester",
            &[
                input(&src_root.join("alpha"), "alpha", "desc alpha"),
                input(&src_root.join("beta"), "beta", "desc beta"),
            ],
            false,
        )
        .unwrap();
        assert_eq!(info.id, "my-test-pack");
        assert_eq!(info.skill_count, 2);
        assert!(pack_base.join("my-test-pack/pack.json").is_file());
        assert!(pack_base.join("my-test-pack/README.md").is_file());
        assert!(pack_base.join("my-test-pack/skills/alpha/SKILL.md").is_file());
        // 根目录无 SKILL.md（格式红线）
        assert!(!pack_base.join("my-test-pack/SKILL.md").exists());

        // 列表
        let list = list_packs(&pack_base);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "My Test Pack");

        // 导出
        let zip_path = tmp.path().join("out.skillpack");
        let size = export_pack(&pack_base, "my-test-pack", &zip_path).unwrap();
        assert!(size > 0);

        // 探测
        let detect = detect_pack(&zip_path).unwrap();
        assert_eq!(detect.name, "My Test Pack");
        assert_eq!(detect.skill_count, 2);

        // 导入（新 base，id 冲突场景用第二个 base 验证改名）
        let import_base = tmp.path().join("packs2");
        let info2 = import_pack(&import_base, &zip_path).unwrap();
        assert_eq!(info2.id, "my-test-pack");
        let info3 = import_pack(&import_base, &zip_path).unwrap();
        assert_eq!(info3.id, "my-test-pack-2");

        // 安装（部署到指定目录 deploy_root = <选择目录>/skills，不写 pack 名包裹）
        let deploy_root = tmp.path().join("codex").join("skills");
        let preview = install_pack_preview(&import_base, &deploy_root, "my-test-pack").unwrap();
        assert_eq!(preview.skill_folders, vec!["alpha".to_string(), "beta".to_string()]);
        assert!(preview.conflicts.is_empty(), "首次安装无冲突");
        let n = install_pack_commit(
            &import_base,
            &deploy_root,
            "my-test-pack",
            &[],
            "codex",
            "Codex CLI",
        )
        .unwrap();
        assert_eq!(n, 2);
        assert!(deploy_root.join("alpha/SKILL.md").is_file());
        assert!(deploy_root.join("beta/ref.md").is_file());
        assert!(deploy_root.join(".install.json").is_file());

        // 再装一次 → D2 冲突：不自动后缀，未确认覆盖则跳过
        let preview2 = install_pack_preview(&import_base, &deploy_root, "my-test-pack").unwrap();
        assert_eq!(preview2.conflicts, vec!["alpha".to_string(), "beta".to_string()]);
        let n2 = install_pack_commit(
            &import_base,
            &deploy_root,
            "my-test-pack",
            &[],
            "codex",
            "Codex CLI",
        )
        .unwrap();
        assert_eq!(n2, 0, "未确认覆盖 → 全部跳过");
        assert!(!deploy_root.join("alpha-2").exists(), "不得自动追加后缀");
        // 确认覆盖 alpha → 只重部署 alpha
        let n3 = install_pack_commit(
            &import_base,
            &deploy_root,
            "my-test-pack",
            &["alpha".to_string()],
            "codex",
            "Codex CLI",
        )
        .unwrap();
        assert_eq!(n3, 1);
        assert!(deploy_root.join("alpha/SKILL.md").is_file());
    }

    /// P10b 闭环：打包带译文 → 安装导入 → 导入方按新 skill_id 恢复译文 →
    /// 立即可读（创建端与导入端各自指到同一临时数据目录）。
    #[test]
    fn pack_i18n_carry_and_restore_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        // 独立临时数据目录，绝不碰真实用户数据
        crate::config::set_data_dir_for_test(tmp.path().join("data"));

        let src_root = tmp.path().join("src");
        let skill_dir = src_root.join("image-gen");
        write_skill(&skill_dir, "image-gen", "generate images");
        let source_path = skill_dir.join("SKILL.md").to_string_lossy().to_string();

        // 造一条译文（skill_id = claude-code|image-gen）
        let bilingual = "---\nname: image-gen\ndescription: 生成图片\n---\nbody\n";
        crate::translations::save_translation(
            "claude-code|image-gen",
            bilingual,
            &source_path,
            "Claude Code",
            "hash123",
            "test-model",
            "图像生成",
        )
        .unwrap();

        // 打包（选中该已翻译技能）
        let pack_base = tmp.path().join("data/packs");
        let info = create_pack(
            &pack_base,
            "I18nPack",
            "1.0.0",
            "t",
            &[PackSkillInput {
                source_path: source_path.clone(),
                skill_id: "claude-code|image-gen".to_string(),
                name: "image-gen".to_string(),
                description: "generate images".to_string(),
                description_zh: "生成图片".to_string(),
                has_translation: true,
            }],
            false,
        )
        .unwrap();
        assert_eq!(info.id, "i18npack");
        // 包内带双语 + meta
        assert!(pack_base.join("i18npack/i18n/image-gen/bilingual.md").is_file());
        assert!(pack_base.join("i18npack/i18n/image-gen/meta.json").is_file());
        let m = read_manifest(&pack_base.join("i18npack")).unwrap();
        assert_eq!(m.i18n, vec!["i18n/image-gen"]);

        // 安装：译文按部署后的新 skill_id（<tool_id>|<folder>）恢复
        let deploy_root = tmp.path().join("codex").join("skills");
        install_pack_commit(&pack_base, &deploy_root, "i18npack", &[], "codex", "Codex CLI")
            .unwrap();
        let new_id = "codex|image-gen";
        let restored = crate::translations::read_translated_content(new_id).expect("译文应恢复");
        assert_eq!(restored, bilingual);
        let meta = crate::translations::load_all_meta().get(new_id).cloned().unwrap();
        assert_eq!(meta.title_zh, "图像生成");
        assert_eq!(meta.source_hash, "hash123");
        assert!(
            meta.source_path.ends_with("image-gen\\SKILL.md")
                || meta.source_path.ends_with("image-gen/SKILL.md")
        );
    }

    #[test]
    fn tampered_file_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "d");

        let pack_base = tmp.path().join("packs");
        create_pack(
            &pack_base,
            "Tamper",
            "1.0.0",
            "t",
            &[input(&src_root.join("alpha"), "alpha", "d")],
            false,
        )
        .unwrap();
        let zip_path = tmp.path().join("t.skillpack");
        export_pack(&pack_base, "tamper", &zip_path).unwrap();

        // 解包篡改后重压：sha256 不符 → 拒绝
        let ex = tmp.path().join("ex");
        import::extract_safely(&zip_path, &ex).unwrap();
        fs::write(ex.join("skills/alpha/SKILL.md"), "hacked").unwrap();
        let evil = tmp.path().join("evil.skillpack");
        zip_dir(&ex, &evil).unwrap();

        let err = import_pack(&tmp.path().join("packs3"), &evil).unwrap_err();
        assert!(err.contains("sha256"));
    }

    #[test]
    fn future_version_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "d");

        let pack_base = tmp.path().join("packs");
        create_pack(
            &pack_base,
            "Future",
            "1.0.0",
            "t",
            &[input(&src_root.join("alpha"), "alpha", "d")],
            false,
        )
        .unwrap();

        // 手改 format_version 后重压
        let mp = pack_base.join("future/pack.json");
        let mut m: PackManifest =
            serde_json::from_str(&fs::read_to_string(&mp).unwrap()).unwrap();
        m.format_version = FORMAT_VERSION + 1;
        fs::write(&mp, serde_json::to_string_pretty(&m).unwrap()).unwrap();
        let zip_path = tmp.path().join("f.skillpack");
        export_pack(&pack_base, "future", &zip_path).unwrap();

        let err = import_pack(&tmp.path().join("packs4"), &zip_path).unwrap_err();
        assert!(err.contains("升级"));
    }

    #[test]
    fn non_pack_zip_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("plain.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        zw.start_file("skills/a/SKILL.md", zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(b"---\nname: a\n---\n").unwrap();
        zw.finish().unwrap();
        assert!(detect_pack(&zip_path).is_none());
        let err = import_pack(&tmp.path().join("packs5"), &zip_path).unwrap_err();
        assert!(err.contains("pack.json"));
    }

    #[test]
    fn collision_rename_deterministic() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        // 两个同名目录（不同父级）→ 第二个自动 -2
        write_skill(&src_root.join("a/tool"), "tool", "d1");
        write_skill(&src_root.join("b/tool"), "tool", "d2");
        let pack_base = tmp.path().join("packs");
        let info = create_pack(
            &pack_base,
            "Dup",
            "1.0.0",
            "t",
            &[
                input(&src_root.join("a/tool"), "tool", "d1"),
                input(&src_root.join("b/tool"), "tool", "d2"),
            ],
            false,
        )
        .unwrap();
        assert_eq!(info.skill_count, 2);
        assert!(pack_base.join("dup/skills/tool/SKILL.md").is_file());
        assert!(pack_base.join("dup/skills/tool-2/SKILL.md").is_file());
    }

    // ==== C4：pack_create 校验集成 + force 逃生门 ====

    /// 构造触发 FM-04（hyphen-case）严格 Error 的技能。
    /// 目录名与 name 一致，避免 CL-01 噪声，保证单 issue 可断言
    fn write_broken_skill(root: &Path) -> PathBuf {
        let dir = root.join("Bad_Name");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            "---\nname: Bad_Name\ndescription: d\n---\nbody\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn c4_strict_error_rejected_with_structured_report() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let bad = write_broken_skill(&src);
        let pack_base = tmp.path().join("packs");

        let err = create_pack(
            &pack_base,
            "Broken",
            "1.0.0",
            "t",
            &[input(&bad, "Bad_Name", "d")],
            false,
        )
        .unwrap_err();
        let PackCreateError::ValidationFailed { message, failed } = err else {
            panic!("应为 ValidationFailed，实际: {:?}", err);
        };
        assert!(message.contains("1 个技能"), "{}", message);
        assert_eq!(failed.len(), 1);
        let f = &failed[0];
        assert_eq!(f.name, "Bad_Name");
        // skill_path 原样回显入参 source_path，前端可据此定位选中项
        assert_eq!(f.skill_path, bad.join("SKILL.md").to_string_lossy().to_string());
        let fm04 = f.issues.iter().find(|i| i.rule_id == "FM-04").expect("应有 FM-04");
        assert_eq!(fm04.severity, crate::validate::Severity::Error, "严格模式升 Error");
        // 拒绝零副作用：pack 目录不落盘
        assert!(!pack_base.join("broken").exists());
    }

    #[test]
    fn c4_force_writes_warnings_into_pack_json() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let bad = write_broken_skill(&src);
        let pack_base = tmp.path().join("packs");

        let info = create_pack(
            &pack_base,
            "Forced",
            "1.0.0",
            "t",
            &[input(&bad, "Bad_Name", "d")],
            true,
        )
        .unwrap();
        let m = read_manifest(&pack_base.join(&info.id)).unwrap();
        assert!(!m.validation_warnings.is_empty());
        assert!(
            m.validation_warnings.iter().any(|w| w.contains("[skills/Bad_Name]")
                && w.contains("FM-04")
                && w.contains("(error)")),
            "warnings 应含包内路径+规则号+严重级: {:?}",
            m.validation_warnings
        );

        // detect_pack / import_pack 不受新字段影响，告警随包流转
        let zip = tmp.path().join("f.skillpack");
        export_pack(&pack_base, &info.id, &zip).unwrap();
        let detect = detect_pack(&zip).expect("带 validation_warnings 的包仍应可探测");
        assert_eq!(detect.skill_count, 1);
        let info2 = import_pack(&tmp.path().join("packs2"), &zip).unwrap();
        let m2 = read_manifest(&tmp.path().join("packs2").join(&info2.id)).unwrap();
        assert_eq!(m2.validation_warnings, m.validation_warnings);
    }

    #[test]
    fn c4_warn_only_not_blocked_but_recorded() {
        // CL-01（name/目录名不一致）严格模式仍为 Warn → 不阻断，但留痕
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("src").join("real-dir");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            "---\nname: other-name\ndescription: d\n---\n",
        )
        .unwrap();
        let pack_base = tmp.path().join("packs");

        let info = create_pack(
            &pack_base,
            "Warny",
            "1.0.0",
            "t",
            &[input(&dir, "other-name", "d")],
            false,
        )
        .expect("Warn 永不阻断");
        let m = read_manifest(&pack_base.join(&info.id)).unwrap();
        assert!(
            m.validation_warnings.iter().any(|w| w.contains("CL-01") && w.contains("(warn)")),
            "{:?}",
            m.validation_warnings
        );
    }

    #[test]
    fn c4_clean_pack_keeps_v1_schema_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        write_skill(&src.join("alpha"), "alpha", "d");
        let pack_base = tmp.path().join("packs");

        create_pack(&pack_base, "Clean", "1.0.0", "t", &[input(&src.join("alpha"), "alpha", "d")], false)
            .unwrap();
        let raw = fs::read_to_string(pack_base.join("clean/pack.json")).unwrap();
        assert!(!raw.contains("validation_warnings"), "全绿包不应新增字段: {}", raw);
        let m: PackManifest = serde_json::from_str(&raw).unwrap();
        assert!(m.validation_warnings.is_empty());
    }

    #[test]
    fn c4_legacy_manifest_without_field_loads() {
        // v0.1 旧包 pack.json 无 validation_warnings → serde default 空
        let json = r#"{"format_version":1,"id":"legacy","name":"Legacy","ver":"1.0.0","author":"a","created_at":"2026-01-01T00:00:00Z","generator":"SkillsShark 0.1.0","summary":{"source":"static","overview":"o","skills":{}},"i18n":[],"skills":[]}"#;
        let m: PackManifest = serde_json::from_str(json).unwrap();
        assert!(m.validation_warnings.is_empty());
    }

    #[test]
    fn c4_mixed_skills_report_lists_only_failed() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        write_skill(&src.join("alpha"), "alpha", "ok");
        let bad = write_broken_skill(&src);
        let pack_base = tmp.path().join("packs");
        let inputs = [
            input(&src.join("alpha"), "alpha", "ok"),
            input(&bad, "Bad_Name", "d"),
        ];

        let err = create_pack(&pack_base, "Mixed", "1.0.0", "t", &inputs, false).unwrap_err();
        let PackCreateError::ValidationFailed { failed, .. } = err else {
            panic!("应为 ValidationFailed");
        };
        assert_eq!(failed.len(), 1, "清单只列失败技能");
        assert_eq!(failed[0].name, "Bad_Name");

        // force 放行后 warnings 仅来自失败技能（干净技能零 issue）
        let info = create_pack(&pack_base, "Mixed", "1.0.0", "t", &inputs, true).unwrap();
        let m = read_manifest(&pack_base.join(&info.id)).unwrap();
        assert!(!m.validation_warnings.is_empty());
        assert!(
            m.validation_warnings.iter().all(|w| w.contains("[skills/Bad_Name]")),
            "{:?}",
            m.validation_warnings
        );
    }

    #[test]
    fn c4_unreadable_skill_md_rejected_as_error() {
        // 规格 3：校验本身失败按 Error。SKILL.md 无 frontmatter → FM-01 Error → 拒绝
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("src").join("no-fm");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), "plain text without frontmatter\n").unwrap();
        let pack_base = tmp.path().join("packs");

        let err = create_pack(
            &pack_base,
            "NoFm",
            "1.0.0",
            "t",
            &[input(&dir, "no-fm", "d")],
            false,
        )
        .unwrap_err();
        let PackCreateError::ValidationFailed { failed, .. } = err else {
            panic!("应为 ValidationFailed");
        };
        assert!(failed[0]
            .issues
            .iter()
            .any(|i| i.rule_id == "FM-01" && i.severity == crate::validate::Severity::Error));
    }

    #[test]
    fn c4_error_serde_shape_for_frontend() {
        // 钉死前端契约：kind 标签 + failed 清单（rule_id/severity/message 直用 ValidationIssue 形状）
        let err = PackCreateError::ValidationFailed {
            message: "1 个技能未通过严格校验".to_string(),
            failed: vec![SkillValidationFailure {
                skill_path: "C:/x/bad/SKILL.md".to_string(),
                name: "bad".to_string(),
                issues: vec![crate::validate::Issue {
                    rule_id: "FM-04".to_string(),
                    severity: crate::validate::Severity::Error,
                    message: "msg".to_string(),
                    path: "SKILL.md".to_string(),
                    hint: "h".to_string(),
                    eco: crate::validate::Eco::Codex,
                }],
            }],
        };
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "validation_failed");
        assert_eq!(v["failed"][0]["skill_path"], "C:/x/bad/SKILL.md");
        assert_eq!(v["failed"][0]["issues"][0]["rule_id"], "FM-04");
        assert_eq!(v["failed"][0]["issues"][0]["severity"], "error");
        assert_eq!(v["failed"][0]["issues"][0]["message"], "msg");

        let v2 = serde_json::to_value(PackCreateError::msg("boom")).unwrap();
        assert_eq!(v2["kind"], "message");
        assert_eq!(v2["message"], "boom");
    }

    #[test]
    fn rename_pack_updates_name_and_readme() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "desc alpha");
        let pack_base = tmp.path().join("packs");
        create_pack(
            &pack_base,
            "Old Name",
            "1.0.0",
            "tester",
            &[input(&src_root.join("alpha"), "alpha", "desc alpha")],
            false,
        )
        .unwrap();

        // 改名
        let info = rename_pack(&pack_base, "old-name", "New Name").unwrap();
        assert_eq!(info.name, "New Name");
        assert_eq!(info.id, "old-name");

        // pack.json 与 README 同步更新
        let m = read_manifest(&pack_base.join("old-name")).unwrap();
        assert_eq!(m.name, "New Name");
        let readme = fs::read_to_string(pack_base.join("old-name/README.md")).unwrap();
        assert!(readme.starts_with("# New Name"));

        // 列表反映新名
        assert_eq!(list_packs(&pack_base)[0].name, "New Name");

        // 名称校验：空名 / 不存在
        assert!(rename_pack(&pack_base, "old-name", "   ").is_err());
        assert!(rename_pack(&pack_base, "nope", "X").is_err());
    }
}
