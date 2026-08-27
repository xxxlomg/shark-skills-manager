use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use crate::config::{self, AppConfig, MaskedConfig};
use crate::dedup;
use crate::hub;
use crate::import;
use crate::pack;
use crate::scanner::{self, Skill};
use crate::shelf;
use crate::summaries;
use crate::tags;
use crate::translations;

// ---------------------------------------------------------------------------
// scan_skills — 扫描所有 enabled 路径
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn scan_skills() -> Vec<Skill> {
    let start = std::time::Instant::now();
    let cfg = config::load_config();
    let targets = config::scan_targets_from_tools(&cfg.tools);
    let paths: Vec<String> = targets
        .iter()
        .map(|t| format!("{} ({})", t.path, t.label))
        .collect();
    let mut result = scanner::scan_all_skills(&targets);
    // hub 账本 join：junction 落点标记补充 link id（供 UI 解除引用/转副本）
    let ledger = hub::load_ledger(&config::get_data_dir());
    if !ledger.links.is_empty() {
        let by_target: std::collections::HashMap<String, String> = ledger
            .links
            .iter()
            .map(|l| {
                (
                    config::norm_for_compare(std::path::Path::new(&l.target)),
                    l.id.clone(),
                )
            })
            .collect();
        for skill in result.iter_mut() {
            if skill.hub_linked {
                let key = config::norm_for_compare(std::path::Path::new(&skill.skill_dir));
                if let Some(id) = by_target.get(&key) {
                    skill.hub_link_id = Some(id.clone());
                }
            }
        }
    }
    // 诊断辅助：junction 落点清单（排查「列表可见但删除提示不存在」类问题）
    let junctions: Vec<&str> = result
        .iter()
        .filter(|s| s.hub_linked)
        .map(|s| s.skill_dir.as_str())
        .collect();
    if !junctions.is_empty() {
        config::debug_log(&format!("scan_skills: junctions=[{}]", junctions.join(" | ")));
    }
    config::debug_log(&format!(
        "scan_skills: paths=[{}] found={} elapsed={}ms",
        paths.join(" | "),
        result.len(),
        start.elapsed().as_millis()
    ));
    result
}

/// 技能库层级结构树（扫描可视化）：完整还原磁盘文件层级 + 技能单元 + 子技能 + 资源类型。
/// 返回树状文本，供前端展示，让用户直观校验层级映射是否与磁盘实际结构一致。
#[tauri::command]
pub fn scan_skills_tree() -> Result<String, String> {
    let cfg = config::load_config();
    let targets = config::scan_targets_from_tools(&cfg.tools);
    Ok(scanner::scan_tree_text(&targets))
}

/// 技能库文件管理器树缓存：进程内按「扫描目标集合」缓存，路径变化自动失效；
/// 手动刷新经 `force` 强制重建。
struct LibraryTreeCacheEntry {
    key: String,
    roots: Vec<scanner::LibraryTreeRoot>,
}

fn library_tree_cache() -> &'static Mutex<Option<LibraryTreeCacheEntry>> {
    static CACHE: OnceLock<Mutex<Option<LibraryTreeCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn library_tree_cache_key(targets: &[config::ScanTarget]) -> String {
    let mut parts: Vec<String> = targets
        .iter()
        .map(|t| format!("{}|{}|{}", t.path, t.label, t.tool_id))
        .collect();
    parts.sort();
    parts.join("\n")
}

/// 技能库文件管理器树（PLAN-19）：每个启用扫描根一棵结构化目录树，
/// 供 LibraryExplorer 以「文件管理器」方式逐层渲染（目录/技能/资源）。
/// 带进程内缓存：目标集合不变时直接复用，避免反复遍历磁盘 + 读 SKILL.md。
#[tauri::command]
pub fn scan_library_tree(force: Option<bool>) -> Result<Vec<scanner::LibraryTreeRoot>, String> {
    let cfg = config::load_config();
    let targets = config::scan_targets_from_tools(&cfg.tools);
    let key = library_tree_cache_key(&targets);

    {
        let cache = library_tree_cache();
        let guard = cache.lock().map_err(|e| format!("目录树缓存锁失败: {e}"))?;
        if !force.unwrap_or(false) {
            if let Some(entry) = guard.as_ref() {
                if entry.key == key {
                    return Ok(entry.roots.clone());
                }
            }
        }
    }

    let roots = scanner::scan_library_tree(&targets);
    {
        let cache = library_tree_cache();
        let mut guard = cache.lock().map_err(|e| format!("目录树缓存锁失败: {e}"))?;
        *guard = Some(LibraryTreeCacheEntry {
            key,
            roots: roots.clone(),
        });
    }
    Ok(roots)
}

// ---------------------------------------------------------------------------
// read_translation — 读取译文内容
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_translation(skill_id: String) -> Result<String, String> {
    translations::read_translated_content(&skill_id)
        .ok_or_else(|| format!("译文不存在: {}", skill_id))
}

// ---------------------------------------------------------------------------
// read_skill_file — 读取指定路径的文件内容
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_skill_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {}", e))
}

/// 读取任意文件为 data URL（base64，按扩展名给 mime）。
/// 用于合并工作台渲染二进制附件（png/jpg 等）——`read_skill_file` 按 UTF-8
/// 文本读二进制会失败，前端据此把同名附件误判为「冲突」，这里补一条二进制通道。
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    let bytes = fs::read(p).map_err(|e| format!("读取失败: {}", e))?;
    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

/// 极简 base64 编码（无第三方依赖）：二进制 → data URL 渲染用。
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ---------------------------------------------------------------------------
// write_translation — 写入译文 + 更新 index
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn write_translation(
    skill_id: String,
    bilingual_text: String,
    source_path: String,
    scan_label: String,
    source_hash: String,
    model: String,
    title_zh: String,
) -> Result<(), String> {
    translations::save_translation(
        &skill_id,
        &bilingual_text,
        &source_path,
        &scan_label,
        &source_hash,
        &model,
        &title_zh,
    )
}

// ---------------------------------------------------------------------------
// load_config — 返回脱敏配置
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_config() -> MaskedConfig {
    config::load_masked_config()
}

// ---------------------------------------------------------------------------
// get_llm_api_key — 返回明文 API Key（仅供前端发起 LLM 请求）
//
// load_config 返回的是脱敏 key，不能用于实际请求（否则 401）。
// Tauri 为本地同进程应用，明文 key 留在前端内存无安全风险，
// 设置页用 password 输入框遮罩显示即可。
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_llm_api_key() -> String {
    config::load_config().llm.api_key
}

// ---------------------------------------------------------------------------
// save_config — 仅保存 LLM 配置（如果 api_key 含 **** 则保留原值）。
// v0.2（B5 收尾）：tools 不再经此命令改动——工具增删改走 hub_*_tool 命令，
// 前端 scan_paths 桥接已拆除（PLAN-06 §2.6）。
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_config(
    llm_api_key: String,
    llm_base_url: String,
    llm_model: String,
) -> Result<(), String> {
    config::debug_log(&format!(
        "save_config CALLED: api_key_len={} base_url={} model={}",
        llm_api_key.len(),
        llm_base_url,
        llm_model
    ));
    let old = config::load_config();
    let final_key = if llm_api_key.contains("****") && !old.llm.api_key.is_empty() {
        old.llm.api_key.clone()
    } else {
        llm_api_key
    };

    let new_config = AppConfig {
        tools: old.tools,
        llm: config::LLMConfig {
            api_key: final_key,
            base_url: llm_base_url,
            model: llm_model,
        },
        publish_repo: old.publish_repo,
        download_dir: old.download_dir,
        ai_hint_dismissed: old.ai_hint_dismissed,
    };
    match config::save_config(&new_config) {
        Ok(()) => {
            config::debug_log("save_config OK: llm written, tools untouched");
            Ok(())
        }
        Err(e) => {
            config::debug_log(&format!("save_config ERROR: {}", e));
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// P5 下载/导入目录（PLAN-09 P5）：URL 下载、Pack 安装、zip/目录导入统一归口
// config::imported_dir()，此处仅提供读取/保存命令。
// ---------------------------------------------------------------------------

/// 返回当前生效的下载/导入目录（含自定义配置展开后的实际路径）
#[tauri::command]
pub fn get_download_dir() -> String {
    config::imported_dir().to_string_lossy().to_string()
}

/// 保存自定义下载/导入目录（空串 = 恢复默认）
#[tauri::command]
pub fn set_download_dir(dir: String) -> Result<(), String> {
    config::set_download_dir(Some(dir))
}

/// PLAN-12：持久化「AI 引导已永久关闭」——点过一次 AI 创作后不再弹「没灵感」提示
#[tauri::command]
pub fn set_ai_hint_dismissed(dismissed: bool) -> Result<(), String> {
    config::set_ai_hint_dismissed(dismissed)
}

// ---------------------------------------------------------------------------
// Hub 引用层（PLAN-06 §2.7，B5 接线）
// ---------------------------------------------------------------------------

/// linkable 目标工具清单（引用对话框的下拉源）：注册表外部工具，
/// 排除 app_owned（builtin/imported/authored 不可作落点）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct LinkableTool {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// 当前是否有候选目录已存在（供 UI 提示「将新建目录」）
    pub has_existing_dir: bool,
}

#[tauri::command]
pub fn hub_linkable_tools() -> Vec<LinkableTool> {
    let cfg = config::load_config();
    cfg.tools
        .iter()
        .filter(|t| !t.app_owned && t.linkable)
        .map(|t| LinkableTool {
            has_existing_dir: t.paths.iter().any(|c| {
                config::expand_path(c).map(|p| p.is_dir()).unwrap_or(false)
            }),
            id: t.id.clone(),
            name: t.name.clone(),
            enabled: t.enabled,
        })
        .collect()
}

#[tauri::command]
pub fn hub_link_skill(
    source_path: String,
    target_tool_id: String,
    mode: hub::LinkMode,
) -> Result<hub::HubLink, String> {
    hub::link_skill(
        &config::get_data_dir(),
        Path::new(&source_path),
        &target_tool_id,
        mode,
    )
}

#[tauri::command]
pub fn hub_unlink_skill(link_id: String) -> Result<hub::HubLink, String> {
    hub::unlink_skill(&config::get_data_dir(), &link_id)
}

#[tauri::command]
pub fn hub_convert_to_copy(link_id: String) -> Result<hub::HubLink, String> {
    hub::convert_to_copy(&config::get_data_dir(), &link_id)
}

#[tauri::command]
pub fn hub_links_status() -> Vec<hub::LinkStatus> {
    hub::links_status(&config::get_data_dir())
}

/// 触发一次扫描以刷新 junction 落点后的技能列表（前端 link/unlink 后调用）。
/// 复用 scan_skills 逻辑，含账本 join。
#[tauri::command]
pub fn hub_rescan() -> Vec<Skill> {
    scan_skills()
}

// ---------------------------------------------------------------------------
// 工具管理（PLAN-06 §2.6/§2.10，B5 收尾）：设置页「工具」面板数据源。
// 桥接命令 detect_paths 已退役：注册表工具恒在配置中，禁用/启用走 update。
// ---------------------------------------------------------------------------

/// 工具全量信息（设置页工具管理渲染用）
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolInfo {
    pub id: String,
    pub name: String,
    /// 注册表/应用自有工具：名称路径不可改，只能禁用
    pub builtin: bool,
    /// 应用自有来源（builtin/imported/authored）：不可作引用落点
    pub app_owned: bool,
    pub enabled: bool,
    pub linkable: bool,
    /// 候选路径原样（含 `~` / `$VAR` 模板）
    pub paths: Vec<String>,
    /// 各候选展开后是否存在（与 paths 一一对应）
    pub path_exists: Vec<bool>,
    /// 名下引用记录数（links.json 台账）
    pub link_count: usize,
}

fn tool_info(t: &config::ToolEntry, link_count: usize) -> ToolInfo {
    ToolInfo {
        id: t.id.clone(),
        name: t.name.clone(),
        builtin: t.builtin,
        app_owned: t.app_owned,
        enabled: t.enabled,
        linkable: t.linkable,
        paths: t.paths.clone(),
        path_exists: t
            .paths
            .iter()
            .map(|c| config::expand_path(c).map(|p| p.is_dir()).unwrap_or(false))
            .collect(),
        link_count,
    }
}

fn link_counts_by_tool() -> std::collections::HashMap<String, usize> {
    let ledger = hub::load_ledger(&config::get_data_dir());
    let mut m: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for l in &ledger.links {
        *m.entry(l.target_tool.clone()).or_insert(0) += 1;
    }
    m
}

#[tauri::command]
pub fn hub_list_tools() -> Vec<ToolInfo> {
    let cfg = config::load_config();
    let counts = link_counts_by_tool();
    cfg.tools
        .iter()
        .map(|t| tool_info(t, counts.get(&t.id).copied().unwrap_or(0)))
        .collect()
}

#[tauri::command]
pub fn hub_add_tool(name: String, paths: Vec<String>) -> Result<ToolInfo, String> {
    let mut cfg = config::load_config();
    let entry = config::add_tool(&mut cfg.tools, &name, &paths)?;
    config::save_config(&cfg)?;
    config::debug_log(&format!("hub_add_tool: {} -> {}", entry.name, entry.id));
    Ok(tool_info(&entry, 0))
}

/// 工具包目录探测（设置页导入交互）：校验选中目录是否为有效工具包——
/// 要求目录下存在 `skills` 子文件夹。只读无副作用，前端据此决定是否允许导入。
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolDirProbe {
    /// 用户选中的根目录（展开后）
    pub base_path: String,
    /// 根目录名（导入工具名候选）
    pub name: String,
    /// 根目录是否存在
    pub base_exists: bool,
    /// 根目录下是否存在 skills 子文件夹（工具包有效性判定）
    pub has_skills: bool,
    /// skills 子文件夹绝对路径（has_skills 为 true 时作为导入扫描路径）
    pub skills_path: String,
}

#[tauri::command]
pub fn probe_tool_dir(dir: String) -> Result<ToolDirProbe, String> {
    let raw = dir.trim();
    if raw.is_empty() {
        return Err("路径为空".to_string());
    }
    let base = config::expand_path(raw)
        .ok_or_else(|| "无法解析路径（路径为空或环境变量未定义）".to_string())?;
    let base_exists = base.is_dir();
    let skills_dir = base.join("skills");
    Ok(ToolDirProbe {
        base_path: base.to_string_lossy().to_string(),
        name: base
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "工具".to_string()),
        base_exists,
        has_skills: skills_dir.is_dir(),
        skills_path: skills_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn hub_update_tool(
    id: String,
    name: Option<String>,
    paths: Option<Vec<String>>,
    enabled: Option<bool>,
) -> Result<ToolInfo, String> {
    let mut cfg = config::load_config();
    let entry = config::update_tool(
        &mut cfg.tools,
        &id,
        name.as_deref(),
        paths.as_deref(),
        enabled,
    )?;
    config::save_config(&cfg)?;
    let counts = link_counts_by_tool();
    Ok(tool_info(&entry, counts.get(&id).copied().unwrap_or(0)))
}

#[tauri::command]
pub fn hub_remove_tool(id: String, force: bool) -> Result<(), String> {
    let mut cfg = config::load_config();
    let counts = link_counts_by_tool();
    let n = counts.get(&id).copied().unwrap_or(0);
    if n > 0 && !force {
        return Err(format!(
            "该工具名下还有 {} 条引用记录，请先在 Hub 页解除引用，或确认「一并移除记录」后重试",
            n
        ));
    }
    config::remove_tool(&mut cfg.tools, &id)?;
    config::save_config(&cfg)?;
    if n > 0 {
        let dropped = hub::drop_links_for_tool(&config::get_data_dir(), &id)?;
        config::debug_log(&format!(
            "hub_remove_tool: {} 已删除，连带清理 {} 条账本记录",
            id, dropped
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 导入（PLAN-04 §3，Phase 1：zip）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn preview_zip_import(path: String) -> Result<import::ImportPreview, String> {
    import::preview_zip(Path::new(&path))
}

#[tauri::command]
pub fn commit_zip_import(
    path: String,
    stem: String,
    selected: Vec<String>,
    replace: bool,
) -> Result<usize, String> {
    let n = import::commit_zip_import(
        Path::new(&path),
        &stem,
        &selected,
        replace,
        &config::imported_dir(),
    )?;
    config::ensure_imported_scan_path();
    config::debug_log(&format!(
        "commit_zip_import: path={} stem={} selected={} replace={}",
        path,
        stem,
        n,
        replace
    ));
    Ok(n)
}

// ---------------------------------------------------------------------------
// 导入（PLAN-04 §3.4，Phase 2：URL）
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn preview_url_import(url: String) -> Result<import::ImportPreview, String> {
    config::debug_log(&format!("preview_url_import: {}", url));
    import::preview_url(&url).await
}

#[tauri::command]
pub fn commit_url_import(
    token: String,
    stem: String,
    selected: Vec<String>,
    replace: bool,
) -> Result<usize, String> {
    let n = import::commit_url_import(&token, &stem, &selected, replace, &config::imported_dir())?;
    config::ensure_imported_scan_path();
    config::debug_log(&format!(
        "commit_url_import: stem={} imported={} replace={}",
        stem, n, replace
    ));
    Ok(n)
}

// ---------------------------------------------------------------------------
// sync_deleted — 同步删除状态 + 返回完整列表
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn sync_deleted(current_ids: Vec<String>) -> Vec<Skill> {
    let _ = translations::sync_deleted_status(&current_ids);
    let cfg = config::load_config();
    let targets = config::scan_targets_from_tools(&cfg.tools);
    scanner::scan_all_skills(&targets)
}

// ---------------------------------------------------------------------------
// Skill Packs（PLAN-05 P1）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn packs_list() -> Vec<pack::PackInfo> {
    pack::list_packs(&config::packs_dir())
}

/// 创建 Skill Pack（C4：打包前强制校验，PLAN-06 §3.7）。
/// force: 逃生门，缺省 false（旧前端调用不传即为 false，serde Option 缺参 → None）。
/// 校验失败返回 `pack::PackCreateError::ValidationFailed`（结构化清单），
/// 经 tauri `impl<T: Serialize> From<T> for InvokeError` 原样下发前端。
#[tauri::command]
pub fn pack_create(
    name: String,
    ver: String,
    author: String,
    skills: Vec<pack::PackSkillInput>,
    force: Option<bool>,
) -> Result<pack::PackInfo, pack::PackCreateError> {
    pack::create_pack(
        &config::packs_dir(),
        &name,
        &ver,
        &author,
        &skills,
        force.unwrap_or(false),
    )
}

#[tauri::command]
pub fn pack_export(id: String, dest: String) -> Result<u64, String> {
    pack::export_pack(&config::packs_dir(), &id, Path::new(&dest))
}

#[tauri::command]
pub fn pack_import(path: String) -> Result<pack::PackInfo, String> {
    pack::import_pack(&config::packs_dir(), Path::new(&path))
}

#[tauri::command]
pub fn pack_install_preview(id: String, target_dir: String) -> Result<pack::InstallPreview, String> {
    let deploy_root = std::path::Path::new(&target_dir).join("skills");
    pack::install_pack_preview(&config::packs_dir(), &deploy_root, &id)
}

#[tauri::command]
pub fn pack_install_commit(
    id: String,
    target_dir: String,
    overwrite: Vec<String>,
) -> Result<usize, String> {
    let deploy_root = std::path::Path::new(&target_dir).join("skills");
    // D8：命中现有工具根 → 复用；D7：否则新建扫描根自定义工具
    let (tool_id, scan_label) = match config::find_tool_for_scan_path(&deploy_root) {
        Some((tid, label)) => (tid, label),
        None => config::add_scan_root_tool(&deploy_root)?,
    };
    let n = pack::install_pack_commit(
        &config::packs_dir(),
        &deploy_root,
        &id,
        &overwrite,
        &tool_id,
        &scan_label,
    )?;
    Ok(n)
}

/// 在技能库目录树中新建一个文件夹（合集）。
/// tool 按 id 或显示名定位；name 为要新建的文件夹名（会做安全清洗）。
/// 在工具首个可写扫描目录下创建 `name` 子目录，返回创建后的绝对路径。
#[tauri::command]
pub fn create_skill_folder(tool: String, name: String) -> Result<String, String> {
    let cfg = config::load_config();
    let entry = cfg
        .tools
        .iter()
        .find(|t| t.id == tool || t.name == tool)
        .ok_or_else(|| format!("工具不存在：{tool}"))?;
    let base = config::scan_targets_from_tools(std::slice::from_ref(entry))
        .into_iter()
        .next()
        .map(|t| std::path::PathBuf::from(t.path))
        .ok_or_else(|| format!("工具「{}」没有可写的扫描目录", entry.name))?;
    // 安全清洗：去掉路径分隔符与非法字符，取首段
    let clean: String = name
        .trim()
        .chars()
        .take(64)
        .map(|c| if c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|' { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        return Err("文件夹名为空".to_string());
    }
    let dest = base.join(&clean);
    if dest.is_dir() {
        return Ok(dest.to_string_lossy().to_string());
    }
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("新建文件夹失败：{e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 新建一个【全新】的文件夹位置：创建目录并注册为自定义工具根（出现在目录树）。
/// 用于"未选中树节点"时通过 Windows 目录选择器挑出的全新路径。
/// 唯一性：文件路径是唯一判定标准——若该路径已是某工具的扫描路径，直接拒绝，
/// 不再生成 testSkills-2/-3 之类的编号副本。
#[tauri::command]
pub fn add_folder_root(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    let mut cfg = config::load_config();
    if let Some(owner) = config::path_taken_by(&cfg.tools, trimmed, None) {
        return Err(format!("该目录已是「{}」的扫描路径，无需重复添加：{}", owner, trimmed));
    }
    let p = std::path::PathBuf::from(trimmed);
    std::fs::create_dir_all(&p).map_err(|e| format!("创建目录失败：{e}"))?;
    let name0 = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "skills".to_string());
    let mut name = name0.clone();
    let mut k = 2;
    while cfg.tools.iter().any(|t| t.name == name) {
        name = format!("{}-{}", name0, k);
        k += 1;
    }
    let entry = config::add_tool(&mut cfg.tools, &name, &[trimmed.to_string()])?;
    let _ = config::save_config(&cfg);
    Ok(entry.id)
}

#[tauri::command]
pub fn pack_delete(id: String) -> Result<(), String> {
    pack::delete_pack(&config::packs_dir(), &id)
}

#[tauri::command]
pub fn pack_rename(id: String, name: String) -> Result<pack::PackInfo, String> {
    pack::rename_pack(&config::packs_dir(), &id, &name)
}

// ---------------------------------------------------------------------------
// 模块 A：Git 仓库货架导入（PLAN-06 §1.8/§1.9/§1.11；MEMO-A）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusInfo {
    pub installed: bool,
    pub version: String,
    /// 是否已在设置中配置「我的技能仓库」
    pub repo_configured: bool,
    /// 配置的本地路径（未配置为空串）
    pub repo_path: String,
    /// 配置的路径是否存在且是 git 仓库
    pub repo_exists: bool,
    /// 当前分支（未知为空串）
    pub branch: String,
    /// 工作区是否干净（未配置/不存在时 false）
    pub clean: bool,
    pub ahead: u32,
    pub behind: u32,
}

/// git 可用性 + 发布仓库健康度（设置页与发布按钮的使能依据，§1.11）
#[tauri::command]
pub async fn git_status() -> GitStatusInfo {
    let info = crate::git::detect();
    let cfg = config::load_config();
    let (repo_configured, repo_path) = match cfg.publish_repo.as_ref() {
        Some(r) => (true, r.local_path.clone()),
        None => (false, String::new()),
    };
    let mut out = GitStatusInfo {
        installed: info.installed,
        version: info.version,
        repo_configured,
        repo_path: repo_path.clone(),
        repo_exists: false,
        branch: String::new(),
        clean: false,
        ahead: 0,
        behind: 0,
    };
    if info.installed && repo_configured {
        let repo = std::path::Path::new(&repo_path);
        if repo.exists() && crate::git::is_repo(repo).await {
            out.repo_exists = true;
            out.branch = crate::git::current_branch(repo).await.unwrap_or_default();
            out.clean = crate::git::status_clean(repo).await.unwrap_or(false);
            if let Ok((a, b)) = crate::git::ahead_behind(repo).await {
                out.ahead = a;
                out.behind = b;
            }
        }
    }
    out
}

/// repo_setup（§1.11）：空目录 git init + 设 remote + 初始 commit；已有仓库校验/补 remote。
#[tauri::command]
pub async fn repo_setup(
    local_path: String,
    remote_url: String,
    init_if_missing: bool,
) -> Result<crate::publish::RepoInfo, String> {
    config::debug_log(&format!(
        "repo_setup: {} -> {} (init={})",
        local_path, remote_url, init_if_missing
    ));
    crate::publish::repo_setup(&local_path, &remote_url, init_if_missing).await
}

/// publish_pack（§1.7 全流程）：校验闸 → 备份 → export → index 合并 → commit → push。
#[tauri::command]
pub async fn publish_pack(
    pack_id: String,
    message: Option<String>,
) -> Result<crate::publish::PublishResult, String> {
    config::debug_log(&format!("publish_pack: {}", pack_id));
    crate::publish::publish_pack(&pack_id, message).await
}

/// 保存/清除发布仓库配置（空串 = 清除）。不含 git 操作——初始化走 repo_setup。
#[tauri::command]
pub fn save_publish_repo(local_path: String, remote_url: String) -> Result<(), String> {
    let mut cfg = config::load_config();
    cfg.publish_repo = if local_path.trim().is_empty() && remote_url.trim().is_empty() {
        None
    } else {
        Some(config::PublishRepo {
            local_path: local_path.trim().to_string(),
            remote_url: remote_url.trim().to_string(),
        })
    };
    config::save_config(&cfg)
}

/// 浏览仓库货架：浅克隆（无 git 时降级 archive 通道）→ 500MB 闸
/// → index.json 或降级扫描 → pending token。async（clone 可能分钟级）。
#[tauri::command]
pub async fn repo_browse(url: String) -> Result<shelf::ShelfPreview, String> {
    config::debug_log(&format!("repo_browse: {}", url));
    shelf::repo_browse(&url).await
}

/// 勾选导入：逐包 pack::import_pack；部分失败不回滚；完成后清理 clone 目录。
#[tauri::command]
pub fn repo_import_commit(
    token: String,
    selected: Vec<String>,
) -> Result<shelf::RepoImportResult, String> {
    config::debug_log(&format!("repo_import_commit: {} 个包", selected.len()));
    shelf::repo_import_commit(&token, &selected)
}

// ---------------------------------------------------------------------------
// skill_validate — 模块 C 校验器（PLAN-06 §3.8）
// ---------------------------------------------------------------------------

/// 校验任意技能目录。mode: "strict"（发布前闸）| "diagnostic"（默认，永不阻断）。
#[tauri::command]
pub fn skill_validate(path: String, mode: Option<String>) -> Result<crate::validate::ValidationReport, String> {
    let mode = match mode.as_deref() {
        Some("strict") => crate::validate::Mode::Strict,
        _ => crate::validate::Mode::Diagnostic,
    };
    Ok(crate::validate::validate_dir(Path::new(&path), mode))
}

/// C5（PLAN-06 §3.13）：新建技能（模板模式）。落点固定 authored 自有源
/// （双落点选择 C9 接）。name 走 hyphen-case（FM-04 同语义）+ ≤64；
/// description 可空——空则补占位符（创作习惯：先命名后补描述，UI 反馈 2026-08-05）。
/// scaffold_resources：shark-skill-creator 规范层结构补全（references/scripts/assets，
/// 可选；选择后预置引导 README，并在 SKILL.md 模板追加资源导航段）。
/// 同名目录已存在 → Err("EXISTS")。
#[tauri::command]
pub fn skill_new(
    name: String,
    description: String,
    scaffold_resources: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let desc = if description.trim().is_empty() {
        crate::authoring::DESC_PLACEHOLDER.to_string()
    } else {
        description
    };
    let scaffold = scaffold_resources.unwrap_or_default();
    let dir = create_skill_template_with_scaffold(
        &crate::config::authored_dir(),
        &name,
        &desc,
        &scaffold,
    )?;
    Ok(serde_json::json!({
        "skill_dir": dir.to_string_lossy(),
        "source_path": dir.join("SKILL.md").to_string_lossy(),
    }))
}

/// name 规则（FM-04 同语义）：hyphen-case + ≤64。skill_new / skill_rename 共用。
pub(crate) fn validate_skill_name(name: &str) -> Result<(), String> {
    if !crate::validate::is_hyphen_case(name) {
        return Err(
            "name 必须为 hyphen-case：小写字母数字 + 连字符，不首尾连字符、不双连字符"
                .to_string(),
        );
    }
    if name.len() > 64 {
        return Err("name 不得超过 64 字符".to_string());
    }
    Ok(())
}

/// C5 核心（纯函数，base_dir 参数化以便单测不碰全局 DATA_DIR）：
/// 在 base 下创建 `<name>/SKILL.md` 模板。校验 name/description；
/// 同名已存在 → Err("EXISTS")；写失败回滚半成品目录。
/// 无结构补全版本（历史契约，测试/调用方不变）。
/// 仅测试与兼容使用——生产路径走 with_scaffold 版本。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn create_skill_template(
    base: &std::path::Path,
    name: &str,
    description: &str,
) -> Result<std::path::PathBuf, String> {
    create_skill_template_with_scaffold(base, name, description, &[])
}

/// C5 核心 + shark-skill-creator 规范层结构补全：
/// 勾选的资源目录（references/scripts/assets）各预置引导 README.md，
/// 并在 SKILL.md 模板追加资源导航段（先全部落盘成功，再统一回滚）。
pub(crate) fn create_skill_template_with_scaffold(
    base: &std::path::Path,
    name: &str,
    description: &str,
    scaffold_resources: &[String],
) -> Result<std::path::PathBuf, String> {
    let name = name.trim();
    validate_skill_name(name)?;
    let desc = description.trim();
    if desc.is_empty() {
        return Err("description 不能空——它是模型决定是否使用该技能的唯一依据".to_string());
    }
    // 结构补全只接受规范层三个目录（shark-skill-creator SKILL.md 标准结构）
    for res in scaffold_resources {
        if !crate::authoring::is_scaffold_resource(res) {
            return Err(format!("不支持的结构补全目录：{res}"));
        }
    }
    let dir = base.join(name);
    if dir.exists() {
        return Err("EXISTS".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{e}"))?;
    // 资源导航段：只有勾选补全的目录才出现在 SKILL.md 里（不臆造未创建的结构）
    let mut nav = String::new();
    if !scaffold_resources.is_empty() {
        nav.push_str("\n## Resources\n\n");
        for res in scaffold_resources {
            nav.push_str(&format!("- `{res}/` {}\n", crate::authoring::scaffold_purpose(res)));
        }
    }
    let md = format!(
        "---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n\n{desc}\n\n## When to use\n\n- （补充触发场景；祈使句书写）\n\n## Instructions\n\n- （正文祈使句，不用第二人称）\n{nav}"
    );
    std::fs::write(dir.join("SKILL.md"), md).map_err(|e| {
        // 回滚：写失败清掉半成品目录，不留脏状态
        let _ = std::fs::remove_dir_all(&dir);
        format!("写入 SKILL.md 失败：{e}")
    })?;
    // 结构补全：创建目录 + 引导 README（任一步失败 → 整体回滚）
    if let Err(e) = (|| -> Result<(), String> {
        for res in scaffold_resources {
            let res_dir = dir.join(res);
            std::fs::create_dir_all(&res_dir)
                .map_err(|err| format!("创建 {res}/ 失败：{err}"))?;
            let readme = crate::authoring::scaffold_readme(res);
            std::fs::write(res_dir.join("README.md"), readme)
                .map_err(|err| format!("写入 {res}/README.md 失败：{err}"))?;
        }
        Ok(())
    })() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(dir)
}

// ---------------------------------------------------------------------------
// PLAN-13 工作流 T：标签系统（tags.json）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_tags() -> tags::TagsData {
    tags::load_tags()
}

#[tauri::command]
pub fn save_tags(data: tags::TagsData) -> Result<(), String> {
    tags::save_tags(&data)
}

// ---------------------------------------------------------------------------
// PLAN-13 工作流 H：Hub 显示名（中文别名，仅账本字段）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn hub_set_display_name(link_id: String, name: String) -> Result<(), String> {
    hub::set_display_name(&config::get_data_dir(), &link_id, &name)
}

// ---------------------------------------------------------------------------
// PLAN-13 工作流 S：技能用途速览（summaries.json；LLM 生成在前端）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_summaries() -> summaries::SummariesData {
    summaries::load_summaries()
}

#[tauri::command]
pub fn write_summary(
    skill_id: String,
    when: String,
    input: String,
    output: String,
    source_hash: String,
    model: String,
) -> Result<(), String> {
    let summary = summaries::Summary {
        when,
        input,
        output,
        source_hash,
        model,
        created_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string(),
    };
    summaries::write_summary(&skill_id, summary)
}

// ---------------------------------------------------------------------------
// PLAN-13 工作流 M 阶段 2：查重检测 + 手动处置（备份 + 回收站）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn detect_duplicates() -> Vec<dedup::DupGroup> {
    let start = std::time::Instant::now();
    let cfg = config::load_config();
    let targets = config::scan_targets_from_tools(&cfg.tools);
    let skills = scanner::scan_all_skills(&targets);
    let groups = dedup::detect(&skills);
    config::debug_log(&format!(
        "detect_duplicates: skills={} groups={} elapsed={}ms",
        skills.len(),
        groups.len(),
        start.elapsed().as_millis()
    ));
    groups
}

#[tauri::command]
pub fn dup_resolve(keep_id: String, remove_id: String) -> Result<String, String> {
    dedup::resolve_keep(&keep_id, &remove_id)
}

#[tauri::command]
pub fn dup_resolve_many(keep_id: String, remove_ids: Vec<String>) -> Result<Vec<String>, String> {
    dedup::resolve_keep_many(&keep_id, remove_ids)
}

// ---------------------------------------------------------------------------
// PLAN-13 工作流 M 阶段 3：智能合并（段落拼接/冲突解决在前端，落盘在后端）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn smart_merge_apply(args: crate::merge::ApplyMergeArgs) -> Result<crate::merge::MergeResult, String> {
    crate::merge::apply_merge(args)
}

#[tauri::command]
pub fn list_merge_history() -> Vec<crate::merge::MergeRecord> {
    crate::merge::list_merge_history()
}

#[tauri::command]
pub fn undo_merge(merge_id: String) -> Result<(), String> {
    crate::merge::undo_merge(merge_id)
}

// ---------------------------------------------------------------------------
// C5 单测：skill_new 模板模式（不碰全局 DATA_DIR）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c5_tests {
    use super::create_skill_template;
    use super::create_skill_template_with_scaffold;

    #[test]
    fn creates_template_skill_and_validates_clean() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = create_skill_template(tmp.path(), "my-new-skill", "Do X when Y happens").unwrap();
        let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
        assert!(md.starts_with("---\nname: my-new-skill\ndescription: Do X when Y happens\n---"));
        // 模板产物必须通过自家严格校验（不引入 FM 级 Error）
        let rep = crate::validate::validate_dir(&dir, crate::validate::Mode::Strict);
        assert!(
            rep.issues.iter().all(|i| i.severity != crate::validate::Severity::Error),
            "模板产物不应带 Error：{:?}",
            rep.issues
        );
    }

    #[test]
    fn rejects_bad_name_and_empty_desc() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(create_skill_template(tmp.path(), "Bad_Name", "d").is_err());
        assert!(create_skill_template(tmp.path(), "ok-name", "  ").is_err());
        assert!(
            create_skill_template(tmp.path(), &"a".repeat(65), "d").is_err(),
            "65 字符 name 应拒"
        );
    }

    #[test]
    fn rejects_duplicate_name() {
        let tmp = tempfile::tempdir().unwrap();
        create_skill_template(tmp.path(), "dup-skill", "d").unwrap();
        let err = create_skill_template(tmp.path(), "dup-skill", "d").unwrap_err();
        assert_eq!(err, "EXISTS");
    }

    // ---- shark-skill-creator 结构补全 ----
    #[test]
    fn scaffold_creates_standard_structure_and_validates() {
        let tmp = tempfile::tempdir().unwrap();
        let scaffold = vec!["references".to_string(), "scripts".to_string(), "assets".to_string()];
        let dir = create_skill_template_with_scaffold(
            tmp.path(),
            "scaffold-demo",
            "Do X when Y",
            &scaffold,
        )
        .unwrap();
        // 三个规范层目录各自预置引导 README
        for res in ["references", "scripts", "assets"] {
            assert!(dir.join(res).is_dir(), "{res}/ 应存在");
            assert!(
                dir.join(res).join("README.md").is_file(),
                "{res}/README.md 应预置"
            );
        }
        // SKILL.md 模板包含资源导航段，且只列出勾选的目录
        let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
        assert!(md.contains("## Resources"), "应追加资源导航段");
        for res in ["references", "scripts", "assets"] {
            assert!(md.contains(&format!("- `{res}/`")), "导航应列出 {res}");
        }
        // 模板产物必须仍通过自家严格校验
        let report = crate::validate::validate_dir(&dir, crate::validate::Mode::Diagnostic);
        assert!(
            !report.issues.iter().any(|i| i.severity == crate::validate::Severity::Error),
            "scaffold 产物不应引入 FM 级 Error: {:?}",
            report.issues
        );
    }

    #[test]
    fn scaffold_without_resources_keeps_plain_template() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = create_skill_template_with_scaffold(tmp.path(), "plain-skill", "d", &[]).unwrap();
        let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
        assert!(!md.contains("## Resources"), "未勾选时不臆造资源导航");
        assert!(!dir.join("references").exists());
    }

    #[test]
    fn scaffold_rejects_unknown_resource() {
        let tmp = tempfile::tempdir().unwrap();
        let err = create_skill_template_with_scaffold(
            tmp.path(),
            "bad-skill",
            "d",
            &["docs".to_string()],
        )
        .unwrap_err();
        assert!(err.contains("不支持的结构补全目录"), "非法目录应拒绝: {err}");
        assert!(
            !tmp.path().join("bad-skill").exists(),
            "校验失败不应留下半成品目录"
        );
    }

    // ---- probe_tool_dir：工具包目录有效性探测 ----

    #[test]
    fn probe_detects_skills_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("my-tool");
        std::fs::create_dir_all(root.join("skills")).unwrap();
        let out = super::probe_tool_dir(root.to_string_lossy().to_string()).unwrap();
        assert!(out.base_exists);
        assert!(out.has_skills, "含 skills 子目录应判有效");
        assert_eq!(out.name, "my-tool");
        assert_eq!(out.skills_path, root.join("skills").to_string_lossy());
    }

    #[test]
    fn probe_rejects_dir_without_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("plain-dir");
        std::fs::create_dir_all(&root).unwrap();
        let out = super::probe_tool_dir(root.to_string_lossy().to_string()).unwrap();
        assert!(out.base_exists);
        assert!(!out.has_skills, "无 skills 子目录应判无效");
    }

    #[test]
    fn probe_missing_dir_reports_not_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("no-such-dir");
        let out = super::probe_tool_dir(missing.to_string_lossy().to_string()).unwrap();
        assert!(!out.base_exists);
        assert!(!out.has_skills);
    }

    #[test]
    fn probe_rejects_empty_path() {
        assert!(super::probe_tool_dir("   ".to_string()).is_err());
    }
}
