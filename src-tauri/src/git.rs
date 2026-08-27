//! git.rs — 全模块唯一 git 封装层（PLAN-06 §1.6；MEMO-A §3.1 五条纪律）
//!
//! 1. detect 缓存于会话内（shim 下 git --version 可能数百毫秒，别每帧 fork）；
//! 2. Windows 固定注入 CREATE_NO_WINDOW（GUI 进程拉 git.exe 会闪控制台）；
//! 3. 120s 软超时，超时杀**进程树**（git clone 派生 git-remote-https，只杀父=假取消）；
//! 4. stderr 关键词分类，匹配不上落 Other(截断透传)，绝不猜；
//! 5. 固定注入 GIT_TERMINAL_PROMPT=0（https 无凭据快速失败而非挂起）+ LC_ALL=C。

use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

/// clone/push 软超时（PLAN-06 §1.6）
pub const GIT_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitInfo {
    pub installed: bool,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GitError {
    NotInstalled,
    AuthFailed(String),
    NonFastForward,
    DirtyWorktree,
    Timeout,
    Other(String),
}

impl GitError {
    /// 用户可见的人话错误
    pub fn message(&self) -> String {
        match self {
            GitError::NotInstalled => {
                "未检测到系统 git。请安装 git 后重试；若已安装，请在终端执行 `where git`（Windows）或 `which git` 确认其在系统 PATH 中——从开始菜单启动的应用可能看不到 shell profile 追加的路径".to_string()
            }
            GitError::AuthFailed(detail) => format!(
                "需要仓库访问权限（私有仓库请确认已配置凭据）或请检查 URL。{}",
                detail
            ),
            GitError::NonFastForward => "推送被拒：远端有新提交，需要先同步".to_string(),
            GitError::DirtyWorktree => "请先处理你仓库里的未提交改动（App 不代你 stash）".to_string(),
            GitError::Timeout => format!("git 操作超时（{}s），已终止", GIT_TIMEOUT_SECS),
            GitError::Other(detail) => detail.clone(),
        }
    }
}

fn truncate_stderr(stderr: &str) -> String {
    stderr.trim().chars().take(300).collect()
}

/// stderr 关键词 → GitError 分类（§1.6：匹配不上原样透传，不猜）
pub fn classify_stderr(stderr: &str) -> GitError {
    let lower = stderr.to_lowercase();
    let auth_keywords = [
        "authentication",
        "could not read username",
        "invalid username or password",
        "permission denied",
        "repository not found",
        "could not read from remote repository",
        "access denied",
        "403",
    ];
    if auth_keywords.iter().any(|k| lower.contains(k)) {
        return GitError::AuthFailed(truncate_stderr(stderr));
    }
    if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        return GitError::NonFastForward;
    }
    if lower.contains("you have unstaged") || lower.contains("your local changes") {
        return GitError::DirtyWorktree;
    }
    GitError::Other(truncate_stderr(stderr))
}

static DETECT_CACHE: OnceLock<GitInfo> = OnceLock::new();

/// 会话内缓存的 git 探测（纪律 5）
pub fn detect() -> GitInfo {
    DETECT_CACHE
        .get_or_init(|| {
            let out = std::process::Command::new("git")
                .arg("--version")
                .stderr(Stdio::null())
                .output();
            match out {
                Ok(o) if o.status.success() => GitInfo {
                    installed: true,
                    version: String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                },
                _ => GitInfo {
                    installed: false,
                    version: String::new(),
                },
            }
        })
        .clone()
}

#[cfg(windows)]
fn apply_no_window(cmd: &mut tokio::process::Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_no_window(_cmd: &mut tokio::process::Command) {}

/// 杀进程树。Windows: taskkill /T /F；unix: 杀父进程（v1 简化，桌面主场景是 Windows）
fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

/// 在 `cwd`（None = 进程当前目录）执行 git 子命令，返回 stdout。
/// 固定注入 GIT_TERMINAL_PROMPT=0 + LC_ALL=C；Windows 无闪窗；超时杀进程树。
pub async fn run(cwd: Option<&Path>, args: &[&str]) -> Result<String, GitError> {
    if !detect().installed {
        return Err(GitError::NotInstalled);
    }
    let mut cmd = tokio::process::Command::new("git");
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    apply_no_window(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| GitError::Other(format!("无法启动 git: {}", e)))?;
    let pid = child.id();

    let output = tokio::select! {
        res = child.wait_with_output() => res,
        _ = tokio::time::sleep(Duration::from_secs(GIT_TIMEOUT_SECS)) => {
            kill_tree(pid);
            return Err(GitError::Timeout);
        }
    };

    let output = output.map_err(|e| GitError::Other(format!("git 进程异常: {}", e)))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(classify_stderr(&stderr))
}

// ---------------------------------------------------------------------------
// porcelain 状态探针（发布侧 §1.11：git_status 的仓库健康度字段）
// 只信退出码与 --porcelain 机器格式（§1.6 纪律）
// ---------------------------------------------------------------------------

/// 工作区是否干净（`status --porcelain` 输出为空）
pub async fn status_clean(repo: &Path) -> Result<bool, GitError> {
    let out = run(Some(repo), &["status", "--porcelain"]).await?;
    Ok(out.trim().is_empty())
}

/// 当前分支名；detached HEAD 时返回 "HEAD"
pub async fn current_branch(repo: &Path) -> Result<String, GitError> {
    let out = run(Some(repo), &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    Ok(out.trim().to_string())
}

/// origin 远端 URL；未配置 origin 返回 None
pub async fn remote_get_url(repo: &Path) -> Result<Option<String>, GitError> {
    match run(Some(repo), &["remote", "get-url", "origin"]).await {
        Ok(out) => Ok(Some(out.trim().to_string())),
        Err(GitError::Other(_)) => Ok(None), // 无 origin 时 git 非零退出，归为"未配置"
        Err(e) => Err(e),
    }
}

/// HEAD 相对上游的 ahead/behind；无上游时 (0, 0)
pub async fn ahead_behind(repo: &Path) -> Result<(u32, u32), GitError> {
    match run(
        Some(repo),
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .await
    {
        Ok(out) => {
            let mut parts = out.split_whitespace();
            let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            Ok((ahead, behind))
        }
        Err(GitError::Other(_)) => Ok((0, 0)), // 无上游分支
        Err(e) => Err(e),
    }
}

/// 目录是否为 git 仓库
pub async fn is_repo(dir: &Path) -> bool {
    run(
        Some(dir),
        &["rev-parse", "--is-inside-work-tree"],
    )
    .await
    .map(|o| o.trim() == "true")
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// 测试（纯函数部分：stderr 分类）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_auth_https() {
        let err = classify_stderr(
            "fatal: Authentication failed for 'https://github.com/x/y.git/'",
        );
        assert!(matches!(err, GitError::AuthFailed(_)));
    }

    #[test]
    fn classify_auth_ssh() {
        let err = classify_stderr(
            "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
        );
        assert!(matches!(err, GitError::AuthFailed(_)));
    }

    #[test]
    fn classify_non_fast_forward() {
        let err = classify_stderr(
            "error: failed to push some refs to 'origin'\nhint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use 'git pull' before pushing again.",
        );
        // 真实 git 输出含 "fetch first" 或 non-fast-forward 字样
        assert!(matches!(
            err,
            GitError::NonFastForward | GitError::Other(_)
        ));
        let err2 = classify_stderr("! [rejected] main -> main (non-fast-forward)");
        assert_eq!(err2, GitError::NonFastForward);
    }

    #[test]
    fn classify_unknown_falls_to_other_with_truncation() {
        let long = "x".repeat(1000);
        let err = classify_stderr(&long);
        match err {
            GitError::Other(s) => assert_eq!(s.chars().count(), 300),
            _ => panic!("应为 Other"),
        }
    }

    #[test]
    fn message_not_installed_mentions_path_check() {
        let msg = GitError::NotInstalled.message();
        assert!(msg.contains("where git") || msg.contains("which git"));
    }
}
