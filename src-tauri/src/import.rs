//! Zip 导入管线（PLAN-04 §3，Phase 1）。
//! URL 导入（Phase 2）下载落盘后复用本模块的 preview/commit。

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::scanner;

// 安全上限：防 zip 炸弹
const MAX_ENTRIES: usize = 2000;
const MAX_TOTAL_BYTES: u64 = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SCAN_DEPTH: usize = 3;

#[derive(Debug, Clone, Serialize)]
pub struct ImportCandidate {
    /// 相对解压根的路径；"" 表示 zip 根目录本身是 skill
    pub rel: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportPreview {
    pub default_stem: String,
    pub candidates: Vec<ImportCandidate>,
    /// URL 导入的 pending 凭证（zip 本地导入为 None）
    pub token: Option<String>,
    /// zip 内含 pack.json 时的探测结果（PLAN-05：前端据此分流到 Pack 导入）
    pub pack: Option<crate::pack::PackDetect>,
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

pub(crate) fn sanitize_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "imported".to_string()
    } else {
        trimmed
    }
}

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let entries = fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let s = entry.path();
        let d = dst.join(entry.file_name());
        if s.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else if s.is_file() {
            fs::copy(&s, &d).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 安全解压：enclosed_name 拒绝绝对路径与 .. 段（zip-slip 防御），
/// 条目数/总量/单条目体积上限。
pub(crate) fn extract_safely(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("无法打开文件: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("zip 解析失败: {}", e))?;
    if archive.len() > MAX_ENTRIES {
        return Err(format!("zip 条目数超过上限 {}", MAX_ENTRIES));
    }
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let rel = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => {
                return Err(format!(
                    "zip 含非法路径（zip-slip 防御拦截）: {}",
                    entry.name()
                ))
            }
        };
        if entry.is_dir() {
            fs::create_dir_all(dest.join(&rel)).map_err(|e| e.to_string())?;
            continue;
        }
        if entry.size() > MAX_ENTRY_BYTES {
            return Err(format!("单条目超过上限: {}", entry.name()));
        }
        total += entry.size();
        if total > MAX_TOTAL_BYTES {
            return Err("解压总量超过上限 200MB".to_string());
        }
        let target = dest.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&target, &buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 探测
// ---------------------------------------------------------------------------

fn candidate_from(dir: &Path, rel: &str) -> ImportCandidate {
    let text = fs::read_to_string(dir.join("SKILL.md")).unwrap_or_default();
    let fm = scanner::parse_frontmatter(&text);
    let name = fm.get("name").cloned().unwrap_or_else(|| {
        dir.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    });
    ImportCandidate {
        rel: rel.to_string(),
        name,
        description: fm.get("description").cloned().unwrap_or_default(),
    }
}

fn walk(dir: &Path, depth: usize, root: &Path, out: &mut Vec<ImportCandidate>) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut dirs: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());
    for d in dirs {
        let p = d.path();
        if p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with('.')).unwrap_or(false) {
            continue;
        }
        if p.join("SKILL.md").is_file() {
            let rel = p
                .strip_prefix(root)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push(candidate_from(&p, &rel));
        } else {
            walk(&p, depth + 1, root, out);
        }
    }
}

fn detect_skills(root: &Path) -> Vec<ImportCandidate> {
    let mut out = Vec::new();
    if root.join("SKILL.md").is_file() {
        // zip 根即 skill，不再探测嵌套
        out.push(candidate_from(root, ""));
        return out;
    }
    walk(root, 1, root, &mut out);
    out
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

pub fn preview_zip(zip_path: &Path) -> Result<ImportPreview, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    extract_safely(zip_path, tmp.path())?;
    let root = unwrap_single_dir(tmp.path());
    let candidates = detect_skills(&root);
    let pack = crate::pack::detect_pack(zip_path);
    if candidates.is_empty() && pack.is_none() {
        return Err("zip 中未找到 SKILL.md（搜索深度 3 层）".to_string());
    }
    let stem = zip_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "imported".to_string());
    Ok(ImportPreview {
        default_stem: sanitize_stem(&stem),
        candidates,
        token: None,
        pack,
    })
}

/// 提交导入。target_base 由调用方传 config::imported_dir()（便于测试注入）。
/// 目标 stem 已存在且 replace=false 时返回 Err("EXISTS")。
pub fn commit_zip_import(
    zip_path: &Path,
    stem: &str,
    selected: &[String],
    replace: bool,
    target_base: &Path,
) -> Result<usize, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    extract_safely(zip_path, tmp.path())?;
    let root = unwrap_single_dir(tmp.path());
    let source = zip_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    commit_from_dir(&root, stem, selected, replace, target_base, &source, "zip")
}

/// 从已解压/已 clone 的源目录提交（zip 与 URL 共用，PLAN-04 §3.4）
fn commit_from_dir(
    src_root: &Path,
    stem: &str,
    selected: &[String],
    replace: bool,
    target_base: &Path,
    source_name: &str,
    kind: &str,
) -> Result<usize, String> {
    if selected.is_empty() {
        return Err("未选择任何技能".to_string());
    }
    let stem = sanitize_stem(stem);
    let target = target_base.join(&stem);
    if target.exists() {
        if !replace {
            return Err("EXISTS".to_string());
        }
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }

    // 拍平落盘：选中项直接放 stem 一层（预览即契约）；
    // 同名时确定性地改名为 <父目录>-<名字>；先排序保证改名结果与选择顺序无关。
    let mut rels: Vec<&String> = selected.iter().collect();
    rels.sort();
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut records: Vec<serde_json::Value> = Vec::new();

    for rel in rels {
        let src = if rel.is_empty() {
            src_root.to_path_buf()
        } else {
            src_root.join(rel)
        };
        if !src.join("SKILL.md").is_file() {
            return Err(format!("选择项不存在或非 skill: {}", rel));
        }
        let folder = if rel.is_empty() {
            String::new()
        } else {
            let segs: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
            let base = segs.last().copied().unwrap_or_default().to_string();
            let mut folder = base.clone();
            if used.contains(&folder) {
                let parent = if segs.len() >= 2 {
                    segs[segs.len() - 2].to_string()
                } else {
                    "dup".to_string()
                };
                folder = format!("{}-{}", parent, base);
                let mut n = 2;
                while used.contains(&folder) {
                    folder = format!("{}-{}-{}", parent, base, n);
                    n += 1;
                }
            }
            folder
        };
        let dst = if folder.is_empty() {
            target.clone()
        } else {
            target.join(&folder)
        };
        used.insert(folder.clone());
        copy_dir_recursive(&src, &dst)?;
        records.push(serde_json::json!({ "rel": rel, "folder": folder }));
    }

    let prov = serde_json::json!({
        "source": source_name,
        "kind": kind,
        "imported_at": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string(),
        "skills": records,
    });
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    fs::write(
        target.join(".import.json"),
        serde_json::to_string_pretty(&prov).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(selected.len())
}

// ---------------------------------------------------------------------------
// URL 导入（PLAN-04 §3.4，Phase 2：archive 优先，git clone 兜底）
// ---------------------------------------------------------------------------

enum PendingSource {
    Zip(PathBuf, tempfile::TempDir, String),
    Dir(tempfile::TempDir, String),
}

static PENDING: LazyLock<Mutex<HashMap<String, PendingSource>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_token(src: PendingSource) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let token = format!("{:x}-{:x}", t, COUNTER.fetch_add(1, Ordering::Relaxed));
    PENDING.lock().unwrap().insert(token.clone(), src);
    token
}

pub(crate) fn is_zip(bytes: &[u8]) -> bool {
    bytes.len() > 4 && &bytes[0..4] == b"PK\x03\x04"
}

const MAX_DOWNLOAD_BYTES: usize = 200 * 1024 * 1024;

pub(crate) fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .header("User-Agent", "skills-shark/0.2")
        .call()
        .map_err(|e| format!("下载失败: {}", e))?;
    if resp.status() != 200 {
        return Err(format!("下载失败 HTTP {}", resp.status()));
    }
    if let Some(cl) = resp.headers().get("content-length") {
        if let Ok(s) = cl.to_str() {
            if let Ok(n) = s.trim().parse::<u64>() {
                if n as usize > MAX_DOWNLOAD_BYTES {
                    return Err("超过 200MB 下载上限".to_string());
                }
            }
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    resp.into_body()
        .into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取响应体失败: {}", e))?;
    if buf.len() > MAX_DOWNLOAD_BYTES {
        return Err("超过 200MB 下载上限".to_string());
    }
    Ok(buf)
}

/// GitHub/Gitee 仓库页地址 → archive zip 候选地址
pub(crate) fn repo_archive_urls(url: &str) -> Vec<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let without_scheme = trimmed.split("://").last().unwrap_or(trimmed);
    let parts: Vec<&str> = without_scheme.split('/').collect();
    if parts.len() < 3 {
        return Vec::new();
    }
    let owner = parts[1];
    let repo = parts[2].trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return Vec::new();
    }
    match parts[0] {
        "github.com" | "www.github.com" => vec![
            format!("https://github.com/{}/{}/archive/refs/heads/main.zip", owner, repo),
            format!("https://github.com/{}/{}/archive/refs/heads/master.zip", owner, repo),
        ],
        "gitee.com" | "www.gitee.com" => vec![
            format!("https://gitee.com/{}/{}/repository/archive/main.zip", owner, repo),
            format!("https://gitee.com/{}/{}/repository/archive/master.zip", owner, repo),
        ],
        _ => Vec::new(),
    }
}

pub(crate) fn stem_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let path = trimmed.split("://").last().unwrap_or(trimmed);
    let seg = path
        .split('/')
        .last()
        .unwrap_or_default()
        .trim_end_matches(".git");
    let stem = seg
        .rsplit_once('.')
        .map(|(base, ext)| {
            if ext.eq_ignore_ascii_case("zip") {
                base.to_string()
            } else {
                seg.to_string()
            }
        })
        .unwrap_or_else(|| seg.to_string());
    sanitize_stem(&stem)
}

fn preview_dir(root: &Path, stem_hint: &str) -> Result<ImportPreview, String> {
    let candidates = detect_skills(root);
    if candidates.is_empty() {
        return Err("仓库中未找到 SKILL.md（搜索深度 3 层）".to_string());
    }
    Ok(ImportPreview {
        default_stem: sanitize_stem(stem_hint),
        candidates,
        token: None,
        pack: None,
    })
}

/// 解包 github archive 的单层包裹目录（repo-main/）
pub(crate) fn unwrap_single_dir(root: &Path) -> PathBuf {
    if root.join("SKILL.md").is_file() {
        return root.to_path_buf();
    }
    let Ok(entries) = fs::read_dir(root) else {
        return root.to_path_buf();
    };
    let dirs: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    if dirs.len() == 1 {
        dirs[0].path()
    } else {
        root.to_path_buf()
    }
}

pub async fn preview_url(url: &str) -> Result<ImportPreview, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL 为空".to_string());
    }
    let looks_zip = url
        .to_lowercase()
        .split('?')
        .next()
        .unwrap_or("")
        .ends_with(".zip");

    let mut try_urls: Vec<String> = Vec::new();
    if looks_zip {
        try_urls.push(url.to_string());
        try_urls.extend(repo_archive_urls(url));
    } else {
        try_urls.extend(repo_archive_urls(url));
        try_urls.push(url.to_string());
    }

    // archive 尝试走阻塞线程（ureq 同步 IO），clone 兜底走 git.rs 异步层
    let original = url.to_string();
    let archive_result = tokio::task::spawn_blocking(move || {
        try_archive_urls(&try_urls, &original)
    })
    .await
    .map_err(|e| format!("内部错误: {}", e))?;

    match archive_result {
        Ok(preview) => Ok(preview),
        Err(last_err) => preview_via_clone(url, &last_err).await,
    }
}

fn try_archive_urls(try_urls: &[String], original_url: &str) -> Result<ImportPreview, String> {
    let mut last_err = String::new();
    for u in try_urls {
        match http_get(u) {
            Ok(bytes) if is_zip(&bytes) => {
                let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
                let zip_file = tmp.path().join("download.zip");
                fs::write(&zip_file, &bytes).map_err(|e| e.to_string())?;
                let mut preview = preview_zip(&zip_file)?;
                preview.default_stem = stem_from_url(original_url);
                preview.token = Some(register_token(PendingSource::Zip(
                    zip_file,
                    tmp,
                    original_url.to_string(),
                )));
                return Ok(preview);
            }
            Ok(_) => last_err = "下载内容不是 zip 归档".to_string(),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// archive 全失败 → git clone 兜底（D4；模块 A 起统一走 git.rs 封装层）
async fn preview_via_clone(url: &str, archive_err: &str) -> Result<ImportPreview, String> {
    if !crate::git::detect().installed {
        return Err(format!("{}；且本机无 git 可兜底", archive_err));
    }
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let clone_dir = tmp.path().join("repo");
    if let Err(e) = crate::git::run(
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
    .await
    {
        return Err(format!("{}；git clone 亦失败: {}", archive_err, e.message()));
    }
    let root = unwrap_single_dir(&clone_dir);
    let mut preview = preview_dir(&root, &stem_from_url(url))?;
    preview.token = Some(register_token(PendingSource::Dir(tmp, url.to_string())));
    Ok(preview)
}

pub fn commit_url_import(
    token: &str,
    stem: &str,
    selected: &[String],
    replace: bool,
    target_base: &Path,
) -> Result<usize, String> {
    let pending = PENDING
        .lock()
        .unwrap()
        .remove(token)
        .ok_or_else(|| "预览凭证已失效，请重新解析".to_string())?;
    match pending {
        PendingSource::Zip(zip, tmp, url) => {
            let extracted = tmp.path().join("extracted");
            extract_safely(&zip, &extracted)?;
            let root = unwrap_single_dir(&extracted);
            commit_from_dir(&root, stem, selected, replace, target_base, &url, "url-zip")
        }
        PendingSource::Dir(tmp, url) => {
            let root = unwrap_single_dir(&tmp.path().join("repo"));
            commit_from_dir(&root, stem, selected, replace, target_base, &url, "url-git")
        }
    }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_zip(path: &Path, entries: &[(&str, &str)]) {
        let file = fs::File::create(path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, content) in entries {
            zw.start_file(name, opts).unwrap();
            zw.write_all(content.as_bytes()).unwrap();
        }
        zw.finish().unwrap();
    }

    const SKILL_A: &str = "---\nname: skill-a\ndescription: 测试技能甲\n---\n# A\n";
    const SKILL_B: &str = "---\nname: skill-b\ndescription: 测试技能乙\n---\n# B\n";

    #[test]
    fn preview_and_commit_flow() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("my-pack.zip");
        build_zip(
            &zip_path,
            &[
                ("skill-a/SKILL.md", SKILL_A),
                ("col/skill-b/SKILL.md", SKILL_B),
                ("readme.txt", "junk"),
            ],
        );

        let preview = preview_zip(&zip_path).unwrap();
        assert_eq!(preview.default_stem, "my-pack");
        assert_eq!(preview.candidates.len(), 2);
        assert!(preview.candidates.iter().any(|c| c.rel == "skill-a" && c.name == "skill-a"));
        assert!(preview.candidates.iter().any(|c| c.rel == "col/skill-b"));

        let target_base = tmp.path().join("imported");
        let rels: Vec<String> = preview.candidates.iter().map(|c| c.rel.clone()).collect();

        // 首次导入
        let n = commit_zip_import(&zip_path, "my-pack", &rels, false, &target_base).unwrap();
        assert_eq!(n, 2);
        // 拍平：col/skill-b 落在 stem 一层
        assert!(target_base.join("my-pack/skill-a/SKILL.md").is_file());
        assert!(target_base.join("my-pack/skill-b/SKILL.md").is_file());
        assert!(!target_base.join("my-pack/col").exists());
        assert!(target_base.join("my-pack/.import.json").is_file());

        // 重名拦截
        let err = commit_zip_import(&zip_path, "my-pack", &rels, false, &target_base).unwrap_err();
        assert_eq!(err, "EXISTS");

        // 替换更新
        let n = commit_zip_import(&zip_path, "my-pack", &rels, true, &target_base).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn root_skill_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("root.zip");
        build_zip(&zip_path, &[("SKILL.md", SKILL_A), ("extra.md", "x")]);

        let preview = preview_zip(&zip_path).unwrap();
        assert_eq!(preview.candidates.len(), 1);
        assert_eq!(preview.candidates[0].rel, "");

        let target_base = tmp.path().join("imported");
        commit_zip_import(&zip_path, "root-skill", &["".to_string()], false, &target_base)
            .unwrap();
        assert!(target_base.join("root-skill/SKILL.md").is_file());
        assert!(target_base.join("root-skill/extra.md").is_file());
    }

    #[test]
    fn zip_slip_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("evil.zip");
        build_zip(&zip_path, &[("../evil.txt", "boom"), ("ok/SKILL.md", SKILL_A)]);
        assert!(preview_zip(&zip_path).is_err());
    }

    #[test]
    fn flatten_and_collision() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("mix.zip");
        build_zip(
            &zip_path,
            &[
                ("a/skill-x/SKILL.md", SKILL_A),
                ("b/skill-x/SKILL.md", SKILL_B),
                ("wrap/skills/skill-y/SKILL.md", SKILL_A),
            ],
        );
        let preview = preview_zip(&zip_path).unwrap();
        assert_eq!(preview.candidates.len(), 3);
        let rels: Vec<String> = preview.candidates.iter().map(|c| c.rel.clone()).collect();

        let target_base = tmp.path().join("imported");
        commit_zip_import(&zip_path, "mix", &rels, false, &target_base).unwrap();
        // a/skill-x 先（排序）得 skill-x；b/skill-x 同名 → b-skill-x
        assert!(target_base.join("mix/skill-x/SKILL.md").is_file());
        assert!(target_base.join("mix/b-skill-x/SKILL.md").is_file());
        assert!(target_base.join("mix/skill-y/SKILL.md").is_file());
        assert!(!target_base.join("mix/a").exists());
        assert!(!target_base.join("mix/wrap").exists());
    }

    #[test]
    fn unwrap_single_wrapper() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("w.zip");
        build_zip(
            &zip_path,
            &[
                ("repo-main/skills/s1/SKILL.md", SKILL_A),
                ("repo-main/README.md", "x"),
            ],
        );
        let preview = preview_zip(&zip_path).unwrap();
        assert_eq!(preview.candidates.len(), 1);
        // 单层包裹目录被解包，rel 不再带 repo-main 前缀
        assert_eq!(preview.candidates[0].rel, "skills/s1");
    }
}
