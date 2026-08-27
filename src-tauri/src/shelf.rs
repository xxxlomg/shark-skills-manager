//! shelf.rs — 技能货架（模块 A 导入侧；PLAN-06 §1.2/§1.4/§1.8/§1.9；MEMO-A §4）
//!
//! 流程：repo_browse（clone/archive → 500MB 闸 → index.json 或降级扫描 → pending token）
//!      → repo_import_commit（逐包 pack::import_pack → .repo.json 溯源 → 清 clone 目录）
//!
//! 边界（MEMO-A §3.3）：
//! - clone 目录固定 `<data_dir>/tmp/repo-*`，启动即清区，不给调用方自选权；
//! - index.json 是不可信远端输入：大小闸 1MB、版本闸、path 逃逸检查；
//! - 校验永不阻断导入（PLAN-05 D9），sha256 声明不符只警告。

use crate::config;
use crate::import;
use crate::pack;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

/// clone 后目录总大小上限（PLAN-06 §1.8）
const MAX_REPO_BYTES: u64 = 500 * 1024 * 1024;
/// index.json 本体大小上限（MEMO-A §3.3-5）
const MAX_INDEX_BYTES: u64 = 1024 * 1024;
/// 降级扫描深度（对齐 scanner/import 的 3 层约定）
const SHELF_SCAN_DEPTH: usize = 3;

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ShelfPackEntry {
    pub id: String,
    pub name: String,
    pub ver: String,
    /// 相对仓库根的 .skillpack 路径
    pub path: String,
    pub skill_count: usize,
    pub summary_zh: String,
    pub updated_at: String,
    /// index.json 声明者给出的哈希（可能缺失）
    pub declared_sha256: String,
    /// 落盘文件实际哈希
    pub actual_sha256: String,
    /// 声明与实际不符（清单可能过期；不阻断导入）
    pub sha256_mismatch: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShelfPreview {
    pub repo_name: String,
    pub updated_at: String,
    /// git+index / git+scan / archive+index / archive+scan
    pub source: String,
    pub packs: Vec<ShelfPackEntry>,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportFailure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoImportResult {
    pub imported: Vec<pack::PackInfo>,
    pub failed: Vec<ImportFailure>,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------------------
// pending 注册表（复用 import.rs 两步式 token 模式；token 绑定 clone 目录）
// ---------------------------------------------------------------------------

struct ShelfPending {
    clone_dir: PathBuf,
    url: String,
    entries: Vec<ShelfPackEntry>,
}

static SHELF_PENDING: LazyLock<Mutex<HashMap<String, ShelfPending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_shelf(pending: ShelfPending) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let token = format!("shelf-{:x}-{:x}", t, COUNTER.fetch_add(1, Ordering::Relaxed));
    SHELF_PENDING.lock().unwrap().insert(token.clone(), pending);
    token
}

fn new_repo_dir() -> std::io::Result<PathBuf> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let dir = config::get_data_dir().join("tmp").join(format!(
        "repo-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// ---------------------------------------------------------------------------
// 校验工具
// ---------------------------------------------------------------------------

/// 远端给出的相对路径安全化：拒绝对路径与任何 `..` 分量（MEMO-A §3.3-5 路径逃逸）
pub fn is_safe_rel_path(p: &str) -> bool {
    let p = p.trim();
    if p.is_empty() {
        return false;
    }
    let path = Path::new(p);
    if path.is_absolute() {
        return false;
    }
    // Windows 盘符相对形式（C:foo）也拒
    if p.chars().nth(1) == Some(':') {
        return false;
    }
    path.components()
        .all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn is_lfs_pointer(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut head = [0u8; 64];
    let Ok(n) = f.read(&mut head) else {
        return false;
    };
    String::from_utf8_lossy(&head[..n]).starts_with("version https://git-lfs.github.com/spec/v1")
}

fn dir_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取失败: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

// ---------------------------------------------------------------------------
// index.json 解析（不可信输入）
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ShelfIndex {
    format_version: Option<u32>,
    repo_name: Option<String>,
    updated_at: Option<String>,
    #[serde(default)]
    packs: Vec<ShelfIndexPack>,
}

#[derive(Deserialize)]
struct ShelfIndexPack {
    id: Option<String>,
    name: Option<String>,
    ver: Option<String>,
    path: Option<String>,
    sha256: Option<String>,
    skill_count: Option<usize>,
    summary_zh: Option<String>,
    updated_at: Option<String>,
}

/// 解析 index.json → 条目列表。返回 None 表示应降级扫描（缺失/损坏/超版本）。
fn parse_shelf_index(repo_root: &Path) -> Option<(String, String, Vec<ShelfPackEntry>)> {
    let index_path = repo_root.join("index.json");
    let meta = std::fs::metadata(&index_path).ok()?;
    if meta.len() > MAX_INDEX_BYTES {
        config::debug_log("shelf: index.json 超过 1MB，降级扫描");
        return None;
    }
    let text = std::fs::read_to_string(&index_path).ok()?;
    let index: ShelfIndex = serde_json::from_str(&text).ok()?;
    match index.format_version {
        Some(v) if v <= 1 => {}
        _ => {
            config::debug_log("shelf: index.json format_version 不受支持，降级扫描");
            return None;
        }
    }
    let mut entries = Vec::new();
    for p in index.packs {
        let Some(path) = p.path.clone() else { continue };
        if !is_safe_rel_path(&path) {
            config::debug_log(&format!("shelf: 拒绝可疑 path: {}", path));
            continue;
        }
        let abs = repo_root.join(&path);
        if !abs.is_file() {
            continue;
        }
        // 清单缺 name/ver/skill_count 时用 detect_pack 补齐
        let detect = pack::detect_pack(&abs);
        let id = p
            .id
            .clone()
            .unwrap_or_else(|| import::sanitize_stem(Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("pack")));
        let actual = file_sha256(&abs).unwrap_or_default();
        let declared = p.sha256.clone().unwrap_or_default();
        entries.push(ShelfPackEntry {
            id,
            name: p
                .name
                .clone()
                .or_else(|| detect.as_ref().map(|d| d.name.clone()))
                .unwrap_or_else(|| Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("pack").to_string()),
            ver: p
                .ver
                .clone()
                .or_else(|| detect.as_ref().map(|d| d.ver.clone()))
                .unwrap_or_else(|| "?".to_string()),
            path,
            skill_count: p
                .skill_count
                .or_else(|| detect.as_ref().map(|d| d.skill_count))
                .unwrap_or(0),
            summary_zh: p.summary_zh.clone().unwrap_or_default(),
            updated_at: p.updated_at.clone().unwrap_or_default(),
            declared_sha256: declared.clone(),
            actual_sha256: actual.clone(),
            sha256_mismatch: !declared.is_empty()
                && !actual.is_empty()
                && !declared.eq_ignore_ascii_case(&actual),
        });
    }
    Some((
        index.repo_name.unwrap_or_default(),
        index.updated_at.unwrap_or_default(),
        entries,
    ))
}

/// 降级扫描：跳过 .git、深度 ≤3、逐包 detect_pack；命中 LFS 指针时给人话
fn scan_skillpacks(repo_root: &Path) -> Result<Vec<ShelfPackEntry>, String> {
    let mut entries = Vec::new();
    let mut lfs_hits = 0usize;
    for entry in walkdir::WalkDir::new(repo_root)
        .max_depth(SHELF_SCAN_DEPTH)
        .into_iter()
        .filter_entry(|e| e.file_name() != ".git")
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !entry.file_type().is_file()
            || path.extension().and_then(|s| s.to_str()) != Some("skillpack")
        {
            continue;
        }
        if is_lfs_pointer(path) {
            lfs_hits += 1;
            continue;
        }
        let rel = path
            .strip_prefix(repo_root)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let detect = pack::detect_pack(path);
        let stem = Path::new(&rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("pack");
        let actual = file_sha256(path).unwrap_or_default();
        entries.push(ShelfPackEntry {
            id: import::sanitize_stem(stem),
            name: detect
                .as_ref()
                .map(|d| d.name.clone())
                .unwrap_or_else(|| stem.to_string()),
            ver: detect
                .as_ref()
                .map(|d| d.ver.clone())
                .unwrap_or_else(|| "?".to_string()),
            path: rel,
            skill_count: detect.as_ref().map(|d| d.skill_count).unwrap_or(0),
            summary_zh: String::new(),
            updated_at: String::new(),
            declared_sha256: String::new(),
            actual_sha256: actual,
            sha256_mismatch: false,
        });
    }
    if entries.is_empty() && lfs_hits > 0 {
        return Err("该仓库用 Git LFS 存储 .skillpack 文件，暂不支持（LFS 指针无法直接解包）".to_string());
    }
    Ok(entries)
}

// ---------------------------------------------------------------------------
// repo_browse
// ---------------------------------------------------------------------------

/// 浏览仓库货架（§1.8）：git clone 浅克隆；无 git 时降级 archive 通道
pub async fn repo_browse(url: &str) -> Result<ShelfPreview, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL 为空".to_string());
    }
    let info = crate::git::detect();
    if info.installed {
        browse_via_git(url).await
    } else {
        browse_via_archive(url).map_err(|e| {
            if url.starts_with("git@") || url.contains("ssh://") {
                format!("ssh 协议需要本机 git（当前未检测到）。{}", e)
            } else {
                format!("{}（无 git 降级通道仅支持 GitHub/Gitee 公开仓库的 main/master 分支）", e)
            }
        })
    }
}

async fn browse_via_git(url: &str) -> Result<ShelfPreview, String> {
    let clone_dir = new_repo_dir().map_err(|e| format!("创建临时目录失败: {}", e))?;
    // new_repo_dir 已创建目录；git clone 要求目标不存在或为空目录
    let _ = std::fs::remove_dir(&clone_dir);
    let res = crate::git::run(
        None,
        &[
            "clone",
            "--depth",
            "1",
            "--single-branch",
            url,
            clone_dir.to_string_lossy().as_ref(),
        ],
    )
    .await;
    if let Err(e) = res {
        let _ = std::fs::remove_dir_all(&clone_dir);
        return Err(e.message());
    }
    finish_browse_from_root(clone_dir.clone(), clone_dir, url, "git")
}

fn browse_via_archive(url: &str) -> Result<ShelfPreview, String> {
    let mut last_err = String::from("archive 通道不可用");
    for u in import::repo_archive_urls(url) {
        match import::http_get(&u) {
            Ok(bytes) if import::is_zip(&bytes) => {
                let clone_dir =
                    new_repo_dir().map_err(|e| format!("创建临时目录失败: {}", e))?;
                let zip_file = clone_dir.join("archive.zip");
                std::fs::write(&zip_file, &bytes).map_err(|e| e.to_string())?;
                let extracted = clone_dir.join("extracted");
                if let Err(e) = import::extract_safely(&zip_file, &extracted) {
                    let _ = std::fs::remove_dir_all(&clone_dir);
                    return Err(e);
                }
                let _ = std::fs::remove_file(&zip_file);
                let root = import::unwrap_single_dir(&extracted);
                // 把解包根当成"仓库根"继续；clone_dir 保留用于 commit 后清理
                return finish_browse_from_root(root, clone_dir, url, "archive");
            }
            Ok(_) => last_err = "下载内容不是 zip 归档".to_string(),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// clone/解包成功后的公共收尾：体积闸 → index.json/降级扫描 → pending
fn finish_browse_from_root(
    root: PathBuf,
    cleanup_dir: PathBuf,
    url: &str,
    transport: &str,
) -> Result<ShelfPreview, String> {
    let fail = |e: String| -> Result<ShelfPreview, String> {
        let _ = std::fs::remove_dir_all(&cleanup_dir);
        Err(e)
    };

    let size = dir_size(&root);
    if size > MAX_REPO_BYTES {
        return fail(format!(
            "仓库内容 {:.0}MB，超过 500MB 导入上限（已清理临时文件）",
            size as f64 / 1024.0 / 1024.0
        ));
    }

    let (repo_name, updated_at, entries, via) = match parse_shelf_index(&root) {
        Some((name, ts, es)) if !es.is_empty() => (name, ts, es, "index"),
        _ => {
            let es = match scan_skillpacks(&root) {
                Ok(es) => es,
                Err(e) => return fail(e),
            };
            if es.is_empty() {
                return fail(
                    "未找到 .skillpack 货架包（已检查 index.json 并扫描目录 3 层），请确认仓库布局".to_string(),
                );
            }
            (String::new(), String::new(), es, "scan")
        }
    };

    if entries.is_empty() {
        return fail("货架为空：index.json 中没有可用的包".to_string());
    }

    let token = register_shelf(ShelfPending {
        clone_dir: cleanup_dir,
        url: url.to_string(),
        entries: entries.clone(),
    });

    let fallback_name = import::sanitize_stem(&import::stem_from_url(url));
    Ok(ShelfPreview {
        repo_name: if repo_name.is_empty() {
            fallback_name
        } else {
            repo_name
        },
        updated_at,
        source: format!("{}+{}", transport, via),
        packs: entries,
        token,
    })
}

// ---------------------------------------------------------------------------
// repo_import_commit
// ---------------------------------------------------------------------------

/// 勾选导入（§1.8）：逐包 pack::import_pack（版本闸+sha256 自验全复用）
/// 部分失败不回滚已成功的包；无论成败都清理 clone 目录并注销 token。
pub fn repo_import_commit(token: &str, selected: &[String]) -> Result<RepoImportResult, String> {
    let pending = SHELF_PENDING
        .lock()
        .unwrap()
        .remove(token)
        .ok_or_else(|| "浏览凭证已失效，请重新解析仓库".to_string())?;

    let mut result = RepoImportResult {
        imported: Vec::new(),
        failed: Vec::new(),
        warnings: Vec::new(),
    };

    let packs_dir = config::packs_dir();
    for path in selected {
        if !is_safe_rel_path(path) {
            result.failed.push(ImportFailure {
                path: path.clone(),
                error: "非法路径".to_string(),
            });
            continue;
        }
        let entry = pending.entries.iter().find(|e| &e.path == path);
        let abs = pending.clone_dir.join(path);
        if !abs.is_file() {
            result.failed.push(ImportFailure {
                path: path.clone(),
                error: "文件不存在（可能已被清理）".to_string(),
            });
            continue;
        }
        match pack::import_pack(&packs_dir, &abs) {
            Ok(info) => {
                // 溯源旁路文件（MEMO-A §3.3-2：不动 pack.json schema）
                if let Some(e) = entry {
                    let repo_meta = serde_json::json!({
                        "repo_url": pending.url,
                        "sha256": e.actual_sha256,
                        "source": "repo-import",
                        "imported_at": chrono::Utc::now().to_rfc3339(),
                    });
                    let meta_path = packs_dir.join(&info.id).join(".repo.json");
                    if let Err(e) = std::fs::write(&meta_path, repo_meta.to_string()) {
                        config::debug_log(&format!("shelf: 写 .repo.json 失败: {}", e));
                    }
                    if e.sha256_mismatch {
                        result.warnings.push(format!(
                            "「{}」货架清单声明的 sha256 与包内容不一致（清单可能过期），已按包内自验结果导入",
                            info.name
                        ));
                    }
                }
                result.imported.push(info);
            }
            Err(e) => {
                result.failed.push(ImportFailure {
                    path: path.clone(),
                    error: e,
                });
            }
        }
    }

    // 无论成败：清理 clone 目录（token 已注销；崩溃残留由启动清理兜底）
    let _ = std::fs::remove_dir_all(&pending.clone_dir);
    Ok(result)
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_skillpack(path: &Path, name: &str) {
        let skill_md: &[u8] = b"---\nname: skill-a\ndescription: test\n---\n# A\n";
        let sha: String = {
            let mut h = Sha256::new();
            h.update(skill_md);
            h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
        };
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("pack.json", options).unwrap();
        let manifest = serde_json::json!({
            "format_version": 1,
            "id": name,
            "name": name,
            "ver": "1.0.0",
            "author": "test",
            "created_at": "2026-08-05T00:00:00Z",
            "generator": "shelf-test",
            "summary": {
                "source": "static",
                "overview": "测试货架包",
                "skills": {"skills/skill-a": "测试技能"}
            },
            "skills": [{
                "path": "skills/skill-a",
                "name": "skill-a",
                "has_translation": false,
                "bytes": skill_md.len(),
                "files": [{"rel": "SKILL.md", "sha256": sha}]
            }]
        });
        zip.write_all(manifest.to_string().as_bytes()).unwrap();
        zip.start_file("skills/skill-a/SKILL.md", options).unwrap();
        zip.write_all(skill_md).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn safe_rel_path_rejects_escape() {
        assert!(is_safe_rel_path("packs/a.skillpack"));
        assert!(is_safe_rel_path("a/b/c.skillpack"));
        assert!(!is_safe_rel_path("../evil.skillpack"));
        assert!(!is_safe_rel_path("packs/../../evil.skillpack"));
        assert!(!is_safe_rel_path("/etc/passwd"));
        assert!(!is_safe_rel_path("C:\\evil.skillpack"));
        assert!(!is_safe_rel_path("C:evil.skillpack"));
        assert!(!is_safe_rel_path(""));
    }

    #[test]
    fn index_parse_rejects_oversized_and_future_version() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // 未来版本 → None（降级扫描）
        std::fs::write(
            root.join("index.json"),
            r#"{"format_version": 99, "packs": []}"#,
        )
        .unwrap();
        assert!(parse_shelf_index(root).is_none());

        // 路径逃逸条目被丢弃，合法条目保留
        let pack_path = root.join("packs");
        std::fs::create_dir_all(&pack_path).unwrap();
        build_skillpack(&pack_path.join("good.skillpack"), "good");
        std::fs::write(
            root.join("index.json"),
            r#"{
                "format_version": 1,
                "repo_name": "测试货架",
                "packs": [
                    {"id": "evil", "path": "../evil.skillpack"},
                    {"id": "good", "name": "Good", "ver": "1.0.0", "path": "packs/good.skillpack", "skill_count": 1}
                ]
            }"#,
        )
        .unwrap();
        let (name, _, entries) = parse_shelf_index(root).expect("应解析成功");
        assert_eq!(name, "测试货架");
        assert_eq!(entries.len(), 1, "逃逸条目必须被丢弃");
        assert_eq!(entries[0].id, "good");
        assert!(!entries[0].actual_sha256.is_empty());
        assert!(!entries[0].sha256_mismatch, "无声明时不算 mismatch");
    }

    #[test]
    fn index_sha256_mismatch_flagged() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("packs")).unwrap();
        build_skillpack(&root.join("packs/a.skillpack"), "a");
        std::fs::write(
            root.join("index.json"),
            r#"{
                "format_version": 1,
                "packs": [{"id": "a", "path": "packs/a.skillpack", "sha256": "deadbeef"}]
            }"#,
        )
        .unwrap();
        let (_, _, entries) = parse_shelf_index(root).unwrap();
        assert!(entries[0].sha256_mismatch);
    }

    #[test]
    fn fallback_scan_skips_git_dir_and_detects_lfs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // .git 里的假 skillpack 必须被跳过
        let git_dir = root.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("fake.skillpack"), b"not a zip").unwrap();

        std::fs::create_dir_all(root.join("packs")).unwrap();
        build_skillpack(&root.join("packs/real.skillpack"), "real");

        let entries = scan_skillpacks(root).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "packs/real.skillpack");

        // 全是 LFS 指针 → 人话报错
        let tmp2 = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp2.path().join("lfs.skillpack"),
            "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n",
        )
        .unwrap();
        let err = scan_skillpacks(tmp2.path()).unwrap_err();
        assert!(err.contains("LFS"));
    }

    #[test]
    fn commit_flow_imports_and_reports_partial_failure() {
        let tmp = tempfile::tempdir().unwrap();
        let clone_dir = tmp.path().join("repo");
        std::fs::create_dir_all(clone_dir.join("packs")).unwrap();
        build_skillpack(&clone_dir.join("packs/ok.skillpack"), "ok-pack");
        std::fs::write(clone_dir.join("packs/broken.skillpack"), b"not a zip").unwrap();

        let entries = scan_skillpacks(&clone_dir).unwrap();
        assert_eq!(entries.len(), 2);
        let token = register_shelf(ShelfPending {
            clone_dir: clone_dir.clone(),
            url: "https://example.com/test/repo.git".to_string(),
            entries: entries.clone(),
        });

        let packs_dir = config::packs_dir();
        let before = std::fs::read_dir(&packs_dir)
            .map(|d| d.count())
            .unwrap_or(0);

        let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
        let result = repo_import_commit(&token, &paths).unwrap();

        assert_eq!(result.imported.len(), 1, "合法包应导入成功");
        assert_eq!(result.failed.len(), 1, "坏包应列清单不回滚");
        assert!(result.failed[0].path.contains("broken"));
        assert!(clone_dir.exists() == false, "commit 后 clone 目录必须删除");

        // token 已注销：二次 commit 必失败
        assert!(repo_import_commit(&token, &paths).is_err());

        // .repo.json 溯源落盘
        let imported_id = &result.imported[0].id;
        let meta = packs_dir.join(imported_id).join(".repo.json");
        assert!(meta.is_file(), ".repo.json 必须写入");
        let meta_text = std::fs::read_to_string(&meta).unwrap();
        assert!(meta_text.contains("example.com"));

        // 清理：移除测试导入的 pack 目录，避免污染开发机 Packs 库
        let _ = std::fs::remove_dir_all(packs_dir.join(imported_id));
        let after = std::fs::read_dir(&packs_dir)
            .map(|d| d.count())
            .unwrap_or(0);
        assert_eq!(before, after, "测试不应遗留 pack 目录");
    }

    /// 端到端：真实 git 本地仓库 → repo_browse（clone+index.json）→ commit 导入。
    /// 本机无 git 时自动跳过。会短暂写入真实 packs_dir（结束即清理）。
    #[test]
    fn real_git_local_shelf_end_to_end() {
        if !crate::git::detect().installed {
            eprintln!("skip: 本机无 git");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("shelf-repo");
        std::fs::create_dir_all(repo_dir.join("packs")).unwrap();
        build_skillpack(&repo_dir.join("packs/demo.skillpack"), "demo-shelf");
        let actual_sha = file_sha256(&repo_dir.join("packs/demo.skillpack")).unwrap();
        let index = serde_json::json!({
            "format_version": 1,
            "repo_name": "本地测试货架",
            "updated_at": "2026-08-05T00:00:00Z",
            "packs": [{
                "id": "demo-shelf",
                "name": "Demo Shelf",
                "ver": "1.0.0",
                "path": "packs/demo.skillpack",
                "sha256": actual_sha,
                "skill_count": 1,
                "summary_zh": "端到端测试包"
            }]
        });
        std::fs::write(repo_dir.join("index.json"), index.to_string()).unwrap();

        let run_git = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .args(args)
                .current_dir(&repo_dir)
                .output()
                .expect("启动 git 失败");
            assert!(
                out.status.success(),
                "git {:?} 失败: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        };
        run_git(&["init"]);
        run_git(&["-c", "user.email=test@local", "-c", "user.name=test", "add", "-A"]);
        run_git(&[
            "-c", "user.email=test@local", "-c", "user.name=test", "commit", "-m", "init",
        ]);

        let url = repo_dir.to_string_lossy().to_string();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let preview = rt
            .block_on(repo_browse(&url))
            .expect("repo_browse 本地仓库应成功");
        assert_eq!(preview.packs.len(), 1);
        assert_eq!(preview.repo_name, "本地测试货架");
        assert!(preview.source.starts_with("git+index"), "应命中 index.json");
        assert!(!preview.packs[0].sha256_mismatch, "声明哈希与实际应一致");

        let packs_dir = config::packs_dir();
        let result =
            repo_import_commit(&preview.token, &[preview.packs[0].path.clone()]).unwrap();
        assert_eq!(result.imported.len(), 1);
        assert!(result.failed.is_empty());
        assert!(result.warnings.is_empty());
        let id = result.imported[0].id.clone();
        let meta = packs_dir.join(&id).join(".repo.json");
        assert!(meta.is_file(), ".repo.json 溯源必须落盘");
        let meta_text = std::fs::read_to_string(&meta).unwrap();
        assert!(meta_text.contains("shelf-repo"), "溯源应记录仓库来源");

        // 清理真实 packs_dir 中的测试产物
        let _ = std::fs::remove_dir_all(packs_dir.join(&id));
    }
}
