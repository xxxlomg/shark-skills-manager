//! 技能库批量删除（回收站语义 + Hub 引用保护）。
//!
//! 两条命令：
//! - `skill_batch_delete_check`：纯读预检，返回每个技能在 Hub 账本中的引用分类，
//!   供前端确认弹窗展示「将移入回收站 / 将解除引用 / 无法删除」；
//! - `skill_batch_delete_apply`：执行删除，策略（Boss 拍板）：
//!   1. 无任何引用（账本出处 / copy 落点 / junction 落点）→ 完整备份到
//!      merge-backups 后移入系统回收站（绝不物理删除），并清标签挂载；
//!   2. 存在引用 → 只执行解除引用（hub::unlink_skill），不物理删除、不进回收站。
//!      解除后技能本体仍在库中，用户再次勾选删除才会进回收站（二段式删除）。
//! 单删不写 merge-history（无 keep 侧）；恢复依赖系统回收站 + 备份双通道。

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::scanner::Skill;

// ---------------------------------------------------------------------------
// 输出模型（与前端 api.ts 对齐：snake_case）
// ---------------------------------------------------------------------------

/// 预检单项：弹窗按它分类「将移入回收站 / 将解除引用 / 无法删除」。
#[derive(Debug, Clone, Serialize)]
pub struct BatchDeleteCheckItem {
    pub id: String,
    pub name: String,
    /// 该技能作为账本出处被引用的条目数
    pub referenced_count: usize,
    /// 该技能作为 copy 落点的账本条目数（解除后实体保留，需二次删除）
    pub copy_targets: usize,
    /// 该技能本身是 junction 落点（hub_linked）
    pub as_junction: bool,
    pub link_id: Option<String>,
    pub source_deleted: bool,
    /// 磁盘目录已不存在（无需处理，直接跳过）
    pub missing_dir: bool,
    /// 是否仍有译文记录（translations.json meta）——幽灵条目可执行「清理记录」
    pub translation_record: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchDeleteTrashedItem {
    pub id: String,
    pub name: String,
    /// 备份目录路径（可手动恢复）
    pub backup: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchDeleteUnlinkedItem {
    pub id: String,
    pub name: String,
    /// 实际移除的账本条目数
    pub links_removed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchDeleteFailItem {
    pub id: String,
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchDeleteResult {
    pub trashed: Vec<BatchDeleteTrashedItem>,
    pub unlinked: Vec<BatchDeleteUnlinkedItem>,
    /// 已清理的「源已删除」译文记录（backup = 译文备份路径，无译文时为空串）
    pub cleaned: Vec<BatchDeleteTrashedItem>,
    pub skipped: Vec<BatchDeleteFailItem>,
    pub errors: Vec<BatchDeleteFailItem>,
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/// 扫描全部技能（id → Skill 定位）。
fn all_skills() -> Vec<Skill> {
    let cfg = crate::config::load_config();
    let targets = crate::config::scan_targets_from_tools(&cfg.tools);
    crate::scanner::scan_all_skills(&targets)
}

/// 归一化绝对路径（canonicalize 失败退回原值），与 dedup.rs 地雷 2 的比对口径一致。
fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// 账本条目路径与技能目录是否同一实体。
fn same_path(a: &str, dir_canon: &Path) -> bool {
    canon(Path::new(a)) == *dir_canon
}

/// 单个技能的引用分类（check 与 apply 共用；apply 用它做二次校验防 TOCTOU）。
struct RefClass {
    /// 作为出处被引用的账本条目 id
    source_links: Vec<String>,
    /// 作为 copy 落点的账本条目 id（不太可能是 link：link 落点是 junction，
    /// 以 skill.hub_linked + hub_link_id 单独处理）
    copy_target_links: Vec<String>,
}

fn classify(skill: &Skill, ledger: &crate::hub::LinksLedger) -> RefClass {
    let dir_canon = canon(Path::new(&skill.skill_dir));
    let mut source_links = Vec::new();
    let mut copy_target_links = Vec::new();
    for l in &ledger.links {
        if same_path(&l.source, &dir_canon) {
            source_links.push(l.id.clone());
        } else if l.mode == crate::hub::LedgerMode::Copy && same_path(&l.target, &dir_canon) {
            copy_target_links.push(l.id.clone());
        }
    }
    RefClass {
        source_links,
        copy_target_links,
    }
}

fn fail(id: &str, name: &str, reason: &str) -> BatchDeleteFailItem {
    BatchDeleteFailItem {
        id: id.to_string(),
        name: name.to_string(),
        reason: reason.to_string(),
    }
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/// 批量删除预检：返回每个技能的引用分类（纯读，不改任何状态）。
#[tauri::command]
pub fn skill_batch_delete_check(ids: Vec<String>) -> Vec<BatchDeleteCheckItem> {
    let skills = all_skills();
    let ledger = crate::hub::load_ledger(&crate::config::get_data_dir());
    let meta = crate::translations::load_all_meta();
    crate::config::debug_log(&format!(
        "lib_delete check: ids=[{}] scanned={}",
        ids.join(", "),
        skills.len()
    ));
    ids.into_iter()
        .map(|id| match skills.iter().find(|s| s.id == id) {
            Some(s) => {
                let cls = classify(s, &ledger);
                BatchDeleteCheckItem {
                    id: s.id.clone(),
                    name: s.name.clone(),
                    referenced_count: cls.source_links.len(),
                    copy_targets: cls.copy_target_links.len(),
                    as_junction: s.hub_linked,
                    link_id: s.hub_link_id.clone(),
                    source_deleted: s.source_deleted,
                    missing_dir: !Path::new(&s.skill_dir).is_dir(),
                    translation_record: meta.contains_key(&s.id),
                }
            }
            None => {
                crate::config::debug_log(&format!(
                    "lib_delete check: id {id} not in scan ({} skills scanned)",
                    skills.len()
                ));
                BatchDeleteCheckItem {
                    id,
                    name: String::new(),
                    referenced_count: 0,
                    copy_targets: 0,
                    as_junction: false,
                    link_id: None,
                    source_deleted: true,
                    missing_dir: true,
                    translation_record: false,
                }
            }
        })
        .collect()
}

/// 批量删除执行：引用 → 解除引用；无引用 → 备份后回收站。逐条容错，返回分类明细。
#[tauri::command]
pub fn skill_batch_delete_apply(ids: Vec<String>) -> BatchDeleteResult {
    let mut result = BatchDeleteResult {
        trashed: Vec::new(),
        unlinked: Vec::new(),
        cleaned: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };
    if ids.is_empty() {
        return result;
    }

    let skills = all_skills();
    let base = crate::config::get_data_dir();
    let ledger = crate::hub::load_ledger(&base);

    for id in &ids {
        let Some(skill) = skills.iter().find(|s| &s.id == id) else {
            crate::config::debug_log(&format!(
                "lib_delete apply: id {id} not in scan ({} skills scanned)",
                skills.len()
            ));
            result
                .errors
                .push(fail(id, "", "技能未找到（可能已被删除），已跳过"));
            continue;
        };
        // 幽灵条目（源文件早已删除，仅剩译文记录）→ 备份译文并清理记录。
        // 修复「列表每次扫描复活、删除却提示不存在」的死循环：清理后不再复活。
        if skill.source_deleted {
            match cleanup_orphan(skill) {
                Ok(backup) => result.cleaned.push(BatchDeleteTrashedItem {
                    id: id.clone(),
                    name: skill.name.clone(),
                    backup,
                }),
                Err(e) => result.errors.push(fail(id, &skill.name, &e)),
            }
            continue;
        }
        if !Path::new(&skill.skill_dir).is_dir() {
            // 复核：is_dir 对个别特殊目录（junction/尾空格等）可能假阴性；
            // canonicalize 成功说明目录真实存在，照常走分类处置。
            let canon_ok = std::fs::canonicalize(Path::new(&skill.skill_dir)).is_ok();
            if canon_ok {
                crate::config::debug_log(&format!(
                    "lib_delete apply: {id} is_dir=false but canonicalize ok, proceed (dir={})",
                    skill.skill_dir
                ));
            } else {
                crate::config::debug_log(&format!(
                    "lib_delete apply: {id} skip missing dir (is_dir={}, canonical={}, source_deleted={}, dir={})",
                    Path::new(&skill.skill_dir).is_dir(),
                    canon_ok,
                    skill.source_deleted,
                    skill.skill_dir
                ));
                result
                    .skipped
                    .push(fail(id, &skill.name, "源目录已不存在，无需处理"));
                continue;
            }
        }

        // ---- TOCTOU 二次校验：按当前账本重新分类 ----
        let cls = classify(skill, &ledger);
        let junction_link = match (skill.hub_linked, &skill.hub_link_id) {
            (true, Some(lid)) => Some(lid.clone()),
            _ => None,
        };
        let has_refs = !cls.source_links.is_empty()
            || !cls.copy_target_links.is_empty()
            || junction_link.is_some();

        if has_refs {
            // ---- 解除引用：绝不物理删除、不进回收站 ----
            let mut removed = 0usize;
            let mut err: Option<String> = None;
            // 先解「出处 / copy 落点」的引用，再解自身 junction（避免留脏账本）
            for lid in cls
                .source_links
                .iter()
                .chain(cls.copy_target_links.iter())
            {
                if junction_link.as_deref() == Some(lid.as_str()) {
                    continue;
                }
                match crate::hub::unlink_skill(&base, lid) {
                    Ok(_) => removed += 1,
                    Err(e) => err = Some(e),
                }
            }
            if let Some(lid) = &junction_link {
                if !cls.source_links.contains(lid) && !cls.copy_target_links.contains(lid) {
                    match crate::hub::unlink_skill(&base, lid) {
                        Ok(_) => removed += 1,
                        Err(e) => err = Some(e),
                    }
                }
            }
            if removed > 0 {
                result.unlinked.push(BatchDeleteUnlinkedItem {
                    id: id.clone(),
                    name: skill.name.clone(),
                    links_removed: removed,
                });
            }
            if let Some(e) = err {
                result.errors.push(fail(
                    id,
                    &skill.name,
                    &format!("部分引用解除失败：{e}"),
                ));
            }
        } else {
            // ---- 备份先行 → 系统回收站 → 清标签 ----
            match dispose_single(skill) {
                Ok(backup) => result.trashed.push(BatchDeleteTrashedItem {
                    id: id.clone(),
                    name: skill.name.clone(),
                    backup,
                }),
                Err(e) => result.errors.push(fail(id, &skill.name, &e)),
            }
        }
    }

    crate::config::debug_log(&format!(
        "lib_delete: ids={} trashed={} unlinked={} cleaned={} skipped={} errors={}",
        ids.len(),
        result.trashed.len(),
        result.unlinked.len(),
        result.cleaned.len(),
        result.skipped.len(),
        result.errors.len()
    ));
    result
}

/// 清理「源已删除」幽灵技能的译文记录：有译文先备份到 merge-backups，
/// 再移除 translations meta + 译文 md（扫描器的孤儿 pass 不再复活它）。
/// 返回译文备份文件路径（无译文内容时为空串）。
fn cleanup_orphan(skill: &Skill) -> Result<String, String> {
    let content = crate::translations::read_translated_content(&skill.id)
        .filter(|t| !t.trim().is_empty());
    let mut backup = String::new();
    if let Some(text) = content {
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let backup_root = crate::config::get_data_dir().join("merge-backups");
        std::fs::create_dir_all(&backup_root).map_err(|e| format!("创建备份目录失败：{e}"))?;
        let safe_name: String = skill
            .folder_name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
            .collect();
        let mut path = backup_root.join(format!("{ts}-del-{safe_name}-translation.md"));
        // 同批同秒同名兜底：已存在则追加序号（绝不覆盖既有备份）
        let mut n = 2;
        while path.exists() {
            path = backup_root.join(format!("{ts}-del-{safe_name}-translation-{n}.md"));
            n += 1;
        }
        std::fs::write(&path, text).map_err(|e| format!("备份译文失败：{e}"))?;
        backup = path.to_string_lossy().to_string();
    }

    crate::translations::remove_translation(&skill.id)
        .map_err(|e| format!("清理译文记录失败：{e}"))?;
    crate::config::debug_log(&format!(
        "lib_delete: cleaned orphan record id={} backup={}",
        skill.id,
        if backup.is_empty() { "(none)" } else { &backup }
    ));
    Ok(backup)
}

/// 回收站语义处置单个技能目录：备份 → trash → 清标签挂载。
/// 与 dedup.rs 处置口径一致：备份先行，trash 失败时备份仍在可手动恢复。
fn dispose_single(skill: &Skill) -> Result<String, String> {
    let dir = PathBuf::from(&skill.skill_dir);
    // is_dir 假阴性兜底：canonicalize 成功即视为存在（copy/trash 均用原路径）
    let dir_present = dir.is_dir() || std::fs::canonicalize(&dir).is_ok();
    if !dir_present {
        return Err("目录不存在，无法删除".to_string());
    }

    // 备份先行（任何破坏性写操作之前完成；失败 → 中止）
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_root = crate::config::get_data_dir().join("merge-backups");
    std::fs::create_dir_all(&backup_root).map_err(|e| format!("创建备份目录失败：{e}"))?;
    let safe_name: String = skill
        .folder_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
        .collect();
    let stem = format!("{ts}-del-{safe_name}");
    let mut backup_dir = backup_root.join(&stem);
    // 同批同秒同名兜底：已存在则追加序号（绝不覆盖既有备份）
    let mut n = 2;
    while backup_dir.exists() {
        backup_dir = backup_root.join(format!("{stem}-{n}"));
        n += 1;
    }
    crate::import::copy_dir_recursive(&dir, &backup_dir)
        .map_err(|e| format!("备份失败，删除已中止：{e}"))?;

    // 回收站语义（绝不物理删除；失败 → 备份已在，报错给出备份路径）
    trash::delete(&dir).map_err(|e| {
        format!(
            "移入回收站失败：{e}（备份已保存于 {}，可手动恢复）",
            backup_dir.display()
        )
    })?;

    // 清标签挂载（先快照后摘除；写失败不阻断）
    let mut tags_data = crate::tags::load_tags();
    if tags_data
        .assignments
        .remove(&format!("skill:{}", skill.id))
        .is_some()
    {
        let _ = crate::tags::save_tags(&tags_data);
    }

    crate::config::debug_log(&format!(
        "lib_delete: trashed={} backup={}",
        skill.id,
        backup_dir.display()
    ));
    Ok(backup_dir.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// 单测
// ---------------------------------------------------------------------------

#[cfg(test)]
mod lib_delete_tests {
    use super::*;
    use std::fs;

    /// 真实临时目录（canonicalize 需实体存在）
    fn tmp_skill_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("libdel-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mk_skill(id: &str, dir: &Path) -> Skill {
        Skill {
            id: id.to_string(),
            name: id.to_string(),
            folder_name: id.to_string(),
            description: String::new(),
            emoji: None,
            scan_label: "test".to_string(),
            source_path: dir.join("SKILL.md").to_string_lossy().to_string(),
            skill_dir: dir.to_string_lossy().to_string(),
            tool_id: "test".to_string(),
            is_representative: true,
            other_sources: vec![],
            hub_linked: false,
            hub_link_id: None,
            has_translation: false,
            translation_lost: false,
            title_zh: String::new(),
            description_zh: String::new(),
            source_deleted: false,
            parent_collection: None,
        }
    }

    fn link(id: &str, source: &str, target: &str, mode: crate::hub::LedgerMode) -> crate::hub::HubLink {
        crate::hub::HubLink {
            id: id.to_string(),
            skill_name: "x".to_string(),
            display_name: String::new(),
            source: source.to_string(),
            target: target.to_string(),
            target_tool: "codex".to_string(),
            mode,
            created_at: "now".to_string(),
        }
    }

    #[test]
    fn classify_separates_source_and_copy_target() {
        let dir = tmp_skill_dir("classify");
        let skill = mk_skill("t|x", &dir);
        let mut ledger = crate::hub::LinksLedger::default();
        ledger.links.push(link(
            "l-src",
            &dir.to_string_lossy(),
            "D:\\other\\x",
            crate::hub::LedgerMode::Link,
        ));
        ledger.links.push(link(
            "l-copy",
            "D:\\src\\x",
            &dir.to_string_lossy(),
            crate::hub::LedgerMode::Copy,
        ));
        let cls = classify(&skill, &ledger);
        assert_eq!(cls.source_links, vec!["l-src".to_string()]);
        assert_eq!(cls.copy_target_links, vec!["l-copy".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn link_mode_target_is_not_copy_target() {
        // mode=link 的落点是 junction，由 skill.hub_linked + hub_link_id 处理，不归 copy_targets
        let dir = tmp_skill_dir("linkmode");
        let skill = mk_skill("t|x", &dir);
        let mut ledger = crate::hub::LinksLedger::default();
        ledger.links.push(link(
            "l-link",
            "D:\\src\\x",
            &dir.to_string_lossy(),
            crate::hub::LedgerMode::Link,
        ));
        let cls = classify(&skill, &ledger);
        assert!(cls.copy_target_links.is_empty());
        assert!(cls.source_links.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}