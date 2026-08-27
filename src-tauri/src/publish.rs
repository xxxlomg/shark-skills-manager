//! publish.rs — 模块 A 发布侧（PLAN-06 §1.3/§1.7/§1.11；MEMO-A §3.2/§3.4）
//!
//! 事务边界（§1.7 要点）：**回滚划在 commit 之前**。
//! - commit 前任一步失败 → 删 temp pack + index.json 从备份还原，零残留；
//! - commit 后（push）失败 → 保留本地 commit 只报人话，绝不代用户 reset。
//!
//! 凭据立场（§1.3）：git 操作全部 shell out，凭据完全走用户自己的 git 环境，
//! App 不碰任何凭据。

use crate::config;
use crate::git;
use crate::pack;
use crate::validate;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct RepoInfo {
    pub local_path: String,
    pub remote_url: String,
    pub branch: String,
    pub clean: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishResult {
    /// remote URL（供 build-in-public 复制）
    pub repo_url: String,
    /// 仓库内相对路径：packs/<id>.skillpack
    pub pack_path: String,
    pub commit_msg: String,
    pub pushed: bool,
    pub rebase_retried: bool,
}

/// 发布前置校验的失败清单（§3.7：严格模式，Error 阻断并列清单）
#[derive(Debug, Clone, Serialize)]
pub struct PublishValidationFailure {
    pub skill: String,
    pub issues: Vec<String>,
}

fn index_skeleton(repo_name: &str) -> serde_json::Value {
    serde_json::json!({
        "format_version": 1,
        "repo_name": repo_name,
        "updated_at": chrono::Utc::now().to_rfc3339(),
        "generator": concat!("shark skills ", env!("CARGO_PKG_VERSION")),
        "packs": []
    })
}

async fn probe_repo(local_path: &str, remote_url: &str) -> Result<RepoInfo, String> {
    let repo = Path::new(local_path);
    let branch = git::current_branch(repo)
        .await
        .map_err(|e| e.message())?;
    let clean = git::status_clean(repo).await.map_err(|e| e.message())?;
    let (ahead, behind) = git::ahead_behind(repo).await.map_err(|e| e.message())?;
    Ok(RepoInfo {
        local_path: local_path.to_string(),
        remote_url: remote_url.to_string(),
        branch,
        clean,
        ahead,
        behind,
    })
}

/// repo_setup（§1.11）：空目录 git init + 设 remote + 初始 commit；已有仓库校验/补 remote。
pub async fn repo_setup(
    local_path: &str,
    remote_url: &str,
    init_if_missing: bool,
) -> Result<RepoInfo, String> {
    let local_path = local_path.trim();
    let remote_url = remote_url.trim();
    if local_path.is_empty() || remote_url.is_empty() {
        return Err("本地路径与远端 URL 均不能为空".to_string());
    }
    if !crate::git::detect().installed {
        return Err(git::GitError::NotInstalled.message());
    }

    let repo = PathBuf::from(local_path);
    let exists = repo.exists();
    if !exists {
        if !init_if_missing {
            return Err("目录不存在（勾选初始化可自动创建）".to_string());
        }
        std::fs::create_dir_all(&repo).map_err(|e| format!("创建目录失败: {}", e))?;
    } else if repo.join("packs").exists() == false
        && std::fs::read_dir(&repo).map(|mut d| d.next().is_some()).unwrap_or(false)
        && !git::is_repo(&repo).await
    {
        return Err("目录非空且不是 git 仓库——请换一个目录，或先自行处理".to_string());
    }

    if !git::is_repo(&repo).await {
        // 初始化：git init → 货架骨架 → 初始 commit
        git::run(Some(&repo), &["init"])
            .await
            .map_err(|e| e.message())?;
        let index_path = repo.join("index.json");
        if !index_path.exists() {
            let stem = repo
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("my-skill-repo");
            std::fs::write(
                &index_path,
                serde_json::to_string_pretty(&index_skeleton(stem)).unwrap_or_default(),
            )
            .map_err(|e| format!("写 index.json 骨架失败: {}", e))?;
        }
        std::fs::create_dir_all(repo.join("packs"))
            .map_err(|e| format!("创建 packs/ 失败: {}", e))?;
        git::run(Some(&repo), &["add", "-A"])
            .await
            .map_err(|e| e.message())?;
        git::run(
            Some(&repo),
            &["commit", "-m", "init: 技能货架（shark skills 自动初始化）"],
        )
        .await
        .map_err(|e| format!("初始提交失败（请确认 git 已配置 user.name/user.email）: {}", e.message()))?;
    }

    // remote：缺失则补；已有且不同 → 不覆盖，报人话
    match git::remote_get_url(&repo).await.map_err(|e| e.message())? {
        None => {
            git::run(Some(&repo), &["remote", "add", "origin", remote_url])
                .await
                .map_err(|e| e.message())?;
        }
        Some(existing) if existing != remote_url => {
            return Err(format!(
                "仓库已有不同的 origin（{}）——App 不覆盖现有远端，请手动处理或更换本地路径",
                existing
            ));
        }
        Some(_) => {}
    }

    // 持久化交给 save_publish_repo（前端 setup 成功后显式保存）——
    // repo_setup 只做 git 工作，保持无副作用、可单测。
    probe_repo(local_path, remote_url).await
}

/// §3.7 发布前置校验：包内技能严格模式，任一 Error → 拒绝并列清单
fn validate_pack_skills(pack_dir: &Path) -> Result<(), Vec<PublishValidationFailure>> {
    let skills_dir = pack_dir.join("skills");
    if !skills_dir.is_dir() {
        return Ok(());
    }
    let mut failures = Vec::new();
    let entries = match std::fs::read_dir(&skills_dir) {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let report = validate::validate_dir(&path, validate::Mode::Strict);
        if report.passed {
            continue;
        }
        let issues = report
            .issues
            .iter()
            .filter(|i| i.severity == validate::Severity::Error)
            .map(|i| format!("[{}] {}", i.rule_id, i.message))
            .collect::<Vec<_>>();
        if !issues.is_empty() {
            failures.push(PublishValidationFailure {
                skill: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .to_string(),
                issues,
            });
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures)
    }
}

fn file_sha256(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path).map_err(|e| format!("读取失败: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

/// publish_pack（§1.7 全流程）。async：clone/push 可能分钟级。
pub async fn publish_pack(
    pack_id: &str,
    message: Option<String>,
) -> Result<PublishResult, String> {
    let cfg = config::load_config();
    let repo_cfg = cfg
        .publish_repo
        .as_ref()
        .ok_or_else(|| "尚未配置「我的技能仓库」——请先在设置中配置".to_string())?
        .clone();
    publish_pack_to(&repo_cfg, &config::packs_dir(), pack_id, message).await
}

/// 可测核心：仓库配置与 packs 目录由调用方注入（不读全局 config）。
pub async fn publish_pack_to(
    repo_cfg: &config::PublishRepo,
    packs_dir: &Path,
    pack_id: &str,
    message: Option<String>,
) -> Result<PublishResult, String> {
    // ---- 步骤 0：前置检查 -----------------------------------------------
    if !git::detect().installed {
        return Err(git::GitError::NotInstalled.message());
    }
    let repo = PathBuf::from(&repo_cfg.local_path);
    if !repo.exists() || !git::is_repo(&repo).await {
        return Err("配置的仓库路径不存在或不是 git 仓库——请在设置中重新初始化".to_string());
    }
    if !git::status_clean(&repo).await.map_err(|e| e.message())? {
        return Err(git::GitError::DirtyWorktree.message());
    }

    // §3.7：严格校验，带错技能拒绝发布
    let pack_dir = packs_dir.join(pack_id);
    if !pack_dir.join("pack.json").is_file() {
        return Err(format!("Pack 不存在: {}", pack_id));
    }
    if let Err(failures) = validate_pack_skills(&pack_dir) {
        let mut msg = String::from("包内技能未通过严格校验，已拒绝发布：\n");
        for f in &failures {
            msg.push_str(&format!("· {}：{}\n", f.skill, f.issues.join("；")));
        }
        msg.push_str("修复后重试（或在创作页查看校验详情）");
        return Err(msg);
    }

    // 当前分支（push/rebase 目标）
    let branch = git::current_branch(&repo)
        .await
        .map_err(|e| e.message())?;

    // ---- 步骤 1：备份 index.json ----------------------------------------
    let tmp_dir = config::get_data_dir().join("tmp");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("创建暂存目录失败: {}", e))?;
    let bak = tmp_dir.join("index.json.bak");
    let index_path = repo.join("index.json");
    let index_existed = index_path.exists();
    if index_existed {
        std::fs::copy(&index_path, &bak).map_err(|e| format!("备份 index.json 失败: {}", e))?;
    }

    // 回滚账本（commit 前任一步失败 → 还原；参数显式传入，无可变状态）
    let rollback = |temp_pack: Option<PathBuf>, index_written: bool| {
        if let Some(tp) = temp_pack {
            let _ = std::fs::remove_file(tp);
        }
        if index_written {
            if index_existed {
                let _ = std::fs::copy(&bak, &index_path);
            } else {
                let _ = std::fs::remove_file(&index_path);
            }
        }
        let _ = std::fs::remove_file(&bak);
    };

    // ---- 步骤 2：export_pack → temp 文件 ---------------------------------
    let packs_repo_dir = repo.join("packs");
    std::fs::create_dir_all(&packs_repo_dir)
        .map_err(|e| format!("创建仓库 packs/ 失败: {}", e))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = packs_repo_dir.join(format!(".tmp-{}-{}.skillpack", pack_id, nanos));
    if let Err(e) = pack::export_pack(&packs_dir, pack_id, &temp_path) {
        rollback(None, false);
        return Err(format!("导出 Pack 失败: {}", e));
    }
    let temp_pack = temp_path.clone();

    // ---- 步骤 3：读-改-写 index.json --------------------------------------
    let mut index: serde_json::Value = if index_existed {
        let text = match std::fs::read_to_string(&index_path) {
            Ok(t) => t,
            Err(e) => {
                rollback(Some(temp_pack.clone()), false);
                return Err(format!("读取 index.json 失败: {}", e));
            }
        };
        match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => {
                rollback(Some(temp_pack.clone()), false);
                return Err("index.json 无法解析，请手工检查（App 绝不覆盖用户手写内容）".to_string());
            }
        }
    } else {
        let stem = repo
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("my-skill-repo");
        index_skeleton(stem)
    };

    let sha256 = match file_sha256(&temp_path) {
        Ok(s) => s,
        Err(e) => {
            rollback(Some(temp_pack.clone()), false);
            return Err(e);
        }
    };
    let detect = pack::detect_pack(&temp_path);
    // summary_zh 取 pack.json 的 overview（§1.2）
    let summary_zh = std::fs::read_to_string(pack_dir.join("pack.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<pack::PackManifest>(&t).ok())
        .map(|m| m.summary.overview)
        .unwrap_or_default();
    let now = chrono::Utc::now().to_rfc3339();
    let rel_path = format!("packs/{}.skillpack", pack_id);

    let entry = serde_json::json!({
        "id": pack_id,
        "name": detect.as_ref().map(|d| d.name.clone()).unwrap_or_else(|| pack_id.to_string()),
        "ver": detect.as_ref().map(|d| d.ver.clone()).unwrap_or_else(|| "?".to_string()),
        "path": rel_path,
        "sha256": sha256,
        "skill_count": detect.as_ref().map(|d| d.skill_count).unwrap_or(0),
        "summary_zh": summary_zh,
        "updated_at": now,
    });

    let packs_arr = index
        .get_mut("packs")
        .and_then(|v| v.as_array_mut());
    match packs_arr {
        Some(arr) => {
            if let Some(existing) = arr.iter_mut().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(pack_id)) {
                *existing = entry;
            } else {
                arr.push(entry);
            }
        }
        None => {
            rollback(Some(temp_pack.clone()), false);
            return Err("index.json 结构异常（缺少 packs 数组），请手工检查".to_string());
        }
    }
    index["updated_at"] = serde_json::Value::String(chrono::Utc::now().to_rfc3339());

    let index_json = match serde_json::to_string_pretty(&index) {
        Ok(s) => s,
        Err(e) => {
            rollback(Some(temp_pack.clone()), false);
            return Err(format!("序列化 index.json 失败: {}", e));
        }
    };
    let tmp_index = repo.join("index.json.tmp");
    if let Err(e) = std::fs::write(&tmp_index, index_json) {
        rollback(Some(temp_pack.clone()), false);
        return Err(format!("写 index.json 失败: {}", e));
    }
    if let Err(e) = std::fs::rename(&tmp_index, &index_path) {
        let _ = std::fs::remove_file(&tmp_index);
        rollback(Some(temp_pack.clone()), false);
        return Err(format!("替换 index.json 失败: {}", e));
    }
    // index.json 已落盘；此后回滚需从 bak 还原

    // ---- 步骤 4：rename temp pack → 正式名 --------------------------------
    let final_path = packs_repo_dir.join(format!("{}.skillpack", pack_id));
    if let Err(e) = std::fs::rename(&temp_path, &final_path) {
        rollback(Some(temp_pack.clone()), true);
        return Err(format!("落地 .skillpack 失败: {}", e));
    }
    // temp pack 已转正；此后回滚不再涉及它

    // ---- 步骤 5：commit ---------------------------------------------------
    if let Err(e) = git::run(Some(&repo), &["add", "-A", "--", "packs/", "index.json"]).await {
        rollback(None, true);
        // temp pack 已 rename，rollback 账本不含它 → 手动删正式文件还原
        let _ = std::fs::remove_file(&final_path);
        return Err(format!("git add 失败: {}", e.message()));
    }
    let name = detect.as_ref().map(|d| d.name.clone()).unwrap_or_else(|| pack_id.to_string());
    let ver = detect.as_ref().map(|d| d.ver.clone()).unwrap_or_default();
    let commit_msg = message
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| format!("publish: {} v{}", name, ver));
    if let Err(e) = git::run(Some(&repo), &["commit", "-m", &commit_msg]).await {
        rollback(None, true);
        let _ = std::fs::remove_file(&final_path);
        return Err(format!("git commit 失败: {}", e.message()));
    }

    // ---- 步骤 6：push（NonFastForward → pull --rebase 重试一次）-----------
    let push_result = git::run(Some(&repo), &["push", "origin", "HEAD"]).await;
    match push_result {
        Ok(_) => {
            let _ = std::fs::remove_file(&bak);
            Ok(PublishResult {
                repo_url: repo_cfg.remote_url.clone(),
                pack_path: rel_path,
                commit_msg,
                pushed: true,
                rebase_retried: false,
            })
        }
        Err(git::GitError::NonFastForward) => {
            // rebase 重试一次；失败保留本地 commit（§1.7：历史操作交还用户）
            let rebase = git::run(Some(&repo), &["pull", "--rebase", "origin", &branch]).await;
            if rebase.is_err() {
                // rebase 失败可能留下中间态 → abort 还原到 commit 后的干净状态
                let _ = git::run(Some(&repo), &["rebase", "--abort"]).await;
                return Err(format!(
                    "本地已提交但推送失败：远端有新提交且自动 rebase 未成功，请手动处理后重试（commit 已保留）"
                ));
            }
            match git::run(Some(&repo), &["push", "origin", "HEAD"]).await {
                Ok(_) => {
                    let _ = std::fs::remove_file(&bak);
                    Ok(PublishResult {
                        repo_url: repo_cfg.remote_url.clone(),
                        pack_path: rel_path,
                        commit_msg,
                        pushed: true,
                        rebase_retried: true,
                    })
                }
                Err(e) => Err(format!(
                    "本地已提交但推送失败：{}，请手动处理后重试（commit 已保留）",
                    e.message()
                )),
            }
        }
        Err(e) => Err(format!(
            "本地已提交但推送失败：{}，请手动处理后重试（commit 已保留）",
            e.message()
        )),
    }
}

// ---------------------------------------------------------------------------
// 测试：真机 git 事务（本地裸仓库当 remote）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn run_git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("启动 git 失败");
        assert!(
            out.status.success(),
            "git {:?} 失败: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn skip_without_git() -> bool {
        if crate::git::detect().installed {
            false
        } else {
            eprintln!("skip: 本机无 git");
            true
        }
    }

    /// 事务回滚：index.json 损坏 → publish 前置中止，仓库零改动。
    /// （不经过 config 的 publish_repo，直接测可单测的部分：校验+index 解析）
    #[test]
    fn corrupted_index_json_blocks_publish() {
        if skip_without_git() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("shelf");
        std::fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init"]);
        std::fs::write(repo.join("index.json"), "{ 这不是合法 JSON").unwrap();
        run_git(&repo, &["add", "-A"]);
        run_git(&repo, &[
            "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init",
        ]);

        // 直接调用 index 解析逻辑验证中止行为
        let text = std::fs::read_to_string(repo.join("index.json")).unwrap();
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&text);
        assert!(parsed.is_err(), "损坏 index.json 必须解析失败 → 中止");

        // 仓库内容零改动
        let out = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).trim().is_empty());
    }

    /// repo_setup：空目录初始化 + remote 补配 + 冲突拒覆盖
    #[test]
    fn repo_setup_init_and_remote_conflict() {
        if skip_without_git() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("new-shelf");
        let url = "https://example.com/me/shelf.git";

        // init_if_missing=false 且目录不存在 → 拒绝
        let err = rt
            .block_on(repo_setup(repo_dir.to_str().unwrap(), url, false))
            .unwrap_err();
        assert!(err.contains("不存在"));

        // init_if_missing=true → 初始化成功
        let info = rt
            .block_on(repo_setup(repo_dir.to_str().unwrap(), url, true))
            .expect("repo_setup 应成功");
        assert!(repo_dir.join("index.json").is_file());
        assert!(repo_dir.join("packs").is_dir());
        assert_eq!(info.remote_url, url);
        assert!(info.clean);

        // 已配置同 URL → 幂等
        let _ = rt
            .block_on(repo_setup(repo_dir.to_str().unwrap(), url, false))
            .expect("幂等 setup 应成功");

        // 不同 URL → 拒绝覆盖
        let err = rt
            .block_on(repo_setup(
                repo_dir.to_str().unwrap(),
                "https://example.com/other/repo.git",
                false,
            ))
            .unwrap_err();
        assert!(err.contains("不同的 origin"));
        // repo_setup 无配置副作用（持久化走 save_publish_repo），无需清理
    }

    /// 测试 pack fixture：pack.json + skills/<name>/SKILL.md（严格校验可过）
    fn make_test_pack(packs_dir: &Path, id: &str) {
        let pack_dir = packs_dir.join(id);
        let skill_dir = pack_dir.join("skills").join("hello");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: hello\ndescription: Say hello when the user greets you. Use for greeting scenarios.\n---\n\n# Hello\n\nSay hello.\n",
        )
        .unwrap();
        let manifest = serde_json::json!({
            "format_version": 1,
            "id": id,
            "name": format!("Test {}", id),
            "ver": "1.0.0",
            "author": "t",
            "created_at": "2026-08-05T00:00:00Z",
            "generator": "test",
            "summary": {
                "source": "static",
                "overview": "测试包",
                "skills": { "skills/hello": "打招呼" }
            },
            "i18n": [],
            "skills": [{
                "path": "skills/hello",
                "name": "hello",
                "has_translation": false,
                "bytes": 0,
                "files": []
            }]
        });
        std::fs::write(
            pack_dir.join("pack.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    /// A3 验收真机全流程：裸仓库当 remote；首次发布直推；
    /// 第三方 clone 抢先 push 后第二次发布 → non-fast-forward → rebase 重试成功。
    #[test]
    fn publish_full_flow_with_rebase_retry() {
        if skip_without_git() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // 1. bare remote + clone 出本地货架
        let remote = root.join("remote.git");
        std::fs::create_dir_all(&remote).unwrap();
        run_git(&remote, &["init", "--bare"]);
        let shelf = root.join("shelf");
        run_git(
            root,
            &["clone", &remote.to_string_lossy(), "shelf"],
        );
        run_git(&shelf, &["config", "user.email", "t@t"]);
        run_git(&shelf, &["config", "user.name", "t"]);
        std::fs::write(
            shelf.join("index.json"),
            serde_json::to_string_pretty(&index_skeleton("test-shelf")).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(shelf.join("packs")).unwrap();
        run_git(&shelf, &["add", "-A"]);
        run_git(&shelf, &["commit", "-m", "init"]);
        run_git(&shelf, &["push", "origin", "HEAD"]);

        let repo_cfg = config::PublishRepo {
            local_path: shelf.to_string_lossy().to_string(),
            remote_url: remote.to_string_lossy().to_string(),
        };
        let packs_dir = root.join("packs-store");

        // 2. 首次发布 → 直推成功
        make_test_pack(&packs_dir, "pack-a");
        let r = rt
            .block_on(publish_pack_to(&repo_cfg, &packs_dir, "pack-a", None))
            .expect("首次发布应成功");
        assert!(r.pushed && !r.rebase_retried);
        assert!(shelf.join("packs").join("pack-a.skillpack").is_file());
        let idx: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(shelf.join("index.json")).unwrap())
                .unwrap();
        assert_eq!(idx["packs"].as_array().unwrap().len(), 1);

        // 3. 第三方 clone 抢先 push → 远端前进
        let collab = root.join("collab");
        run_git(root, &["clone", &remote.to_string_lossy(), "collab"]);
        run_git(&collab, &["config", "user.email", "c@c"]);
        run_git(&collab, &["config", "user.name", "c"]);
        std::fs::write(collab.join("COLLAB.md"), "collab change").unwrap();
        run_git(&collab, &["add", "-A"]);
        run_git(&collab, &["commit", "-m", "collab"]);
        run_git(&collab, &["push", "origin", "HEAD"]);

        // 4. 第二次发布 → NonFastForward → pull --rebase 重试 → 成功
        make_test_pack(&packs_dir, "pack-b");
        let r2 = rt
            .block_on(publish_pack_to(&repo_cfg, &packs_dir, "pack-b", None))
            .expect("rebase 重试后应成功");
        assert!(r2.pushed, "第二次发布应推送成功");
        assert!(r2.rebase_retried, "必须走过一次 rebase 重试");
        assert!(shelf.join("packs").join("pack-b.skillpack").is_file());
        assert!(shelf.join("COLLAB.md").is_file(), "rebase 后应包含协作者提交");
        let idx: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(shelf.join("index.json")).unwrap())
                .unwrap();
        assert_eq!(idx["packs"].as_array().unwrap().len(), 2);

        // 5. 脏工作区 → 拒绝（DirtyWorktree）
        std::fs::write(shelf.join("DIRTY.md"), "untracked junk").unwrap();
        let err = rt
            .block_on(publish_pack_to(&repo_cfg, &packs_dir, "pack-a", None))
            .unwrap_err();
        assert!(err.contains("未提交"), "脏工作区应报人话：{}", err);
    }
}
