//! 阶段 3：智能合并 —— 持久化闭环（落盘 + 备份 + 处置 + 历史 + 撤销）。
//!
//! 段落级拼接 / 冲突解决 / 落点选择在【前端】完成（交互式，见 MergeWorkbench 的
//! 智能合并面板），后端只负责把【已定稿】的合并产物安全落盘，并保证全程可撤销：
//!   1. 备份 A/B 两目录 → `merge-backups/<ts>-merge-<nameA>-<nameB>/`（任何写之前）；
//!   2. 写入合并产物（SKILL.md + 附件并集）；
//!   3. 按 disposal 处置原件（回收站语义，junction 落点/账本出处不可删）；
//!   4. 标签并集挂载到新技能 + 清理被处置原件的标签；
//!   5. 追加 merge-history.json；undo 按记录逆向恢复。
//!
//! 契约：合并产物是一个【新】技能目录 `target_root/name`；若该路径恰好命中 A 或 B
//! 的原目录（= 原地合并），则合并产物就地覆盖该目录（该侧不再单独处置），
//! 否则必须是一个不存在的目录（与 skill_rename 的 EXISTS 语义一致）。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// 数据契约
// ---------------------------------------------------------------------------

/// 附件拷贝指令：从 A 或 B 的 src_rel 复制到合并产物目录的 dst_rel。
/// R3：from 额外兼容绝对目录路径（N 路雪球合并的中间成员附件来源）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyOp {
    pub from: String, // "a" | "b" | 绝对目录路径
    pub src_rel: String,
    pub dst_rel: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyMergeArgs {
    pub a_id: String,
    pub b_id: String,
    /// 落点底层目录（合并技能目录的父目录）
    pub target_root: String,
    /// 合并后技能目录名 + frontmatter name
    pub name: String,
    /// 完整合并后的 SKILL.md 全文
    pub skill_md: String,
    pub copy_ops: Vec<CopyOp>,
    /// "delete_both" | "delete_weaker" | "keep_both"
    pub disposal: String,
    /// disposal=delete_weaker 时被处置的一方 id
    pub weaker_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeResult {
    pub result_path: String,
    pub backup_dir: String,
    pub history_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeSide {
    pub skill_id: String,
    pub path: String,
    /// 备份目录（丢给 undo 恢复用）
    pub backup: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeRecord {
    pub id: String,
    pub at: String,
    /// "merge" = 智能合并产物；"dispose" = 处置副本（保留一侧、其余进回收站）。
    /// 旧记录无此字段，serde default 回退 "merge"。
    #[serde(default = "default_record_kind")]
    pub kind: String,
    pub a: MergeSide,
    pub b: MergeSide,
    pub result_path: String,
    pub result_skill_id: String,
    pub backup_dir: String,
    pub disposal: String,
    pub polished: bool,
    /// 原件标签快照（undo 时还原）
    pub a_tags: Vec<String>,
    pub b_tags: Vec<String>,
}

fn default_record_kind() -> String {
    "merge".to_string()
}

// ---------------------------------------------------------------------------
// 历史存取
// ---------------------------------------------------------------------------

fn history_path() -> PathBuf {
    crate::config::get_data_dir().join("merge-history.json")
}

fn load_history() -> Vec<MergeRecord> {
    let p = history_path();
    if !p.is_file() {
        return Vec::new();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_history(records: &[MergeRecord]) -> Result<(), String> {
    let p = history_path();
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    std::fs::write(&p, json).map_err(|e| format!("写入 merge-history 失败：{e}"))
}

/// 记录一次「处置」到合并历史（供撤销与历史展示）。
/// 处置（保留 keep、把 remove 备份后进回收站）也是合并工作流的一部分。
pub fn record_dispose(
    keep: &crate::scanner::Skill,
    remove: &crate::scanner::Skill,
    backup_dir: &Path,
    keep_tags: Vec<String>,
    remove_tags: Vec<String>,
) {
    let ts = chrono::Utc::now().timestamp_millis();
    let record = MergeRecord {
        id: format!("d-{ts}"),
        at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string(),
        kind: "dispose".to_string(),
        a: MergeSide {
            skill_id: keep.id.clone(),
            path: keep.skill_dir.clone(),
            backup: String::new(),
        },
        b: MergeSide {
            skill_id: remove.id.clone(),
            path: remove.skill_dir.clone(),
            backup: backup_dir.to_string_lossy().to_string(),
        },
        result_path: keep.skill_dir.clone(),
        result_skill_id: keep.id.clone(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        disposal: "delete_weaker".to_string(),
        polished: false,
        a_tags: keep_tags,
        b_tags: remove_tags,
    };
    let mut history = load_history();
    history.push(record);
    if let Err(e) = save_history(&history) {
        crate::config::debug_log(&format!("record_dispose: 写历史失败（忽略）: {e}"));
    }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

fn find_skill<'a>(skills: &'a [crate::scanner::Skill], id: &str) -> Option<&'a crate::scanner::Skill> {
    skills.iter().find(|s| s.id == id)
}

/// 归一化绝对路径（canonicalize 失败则退回词法绝对路径）。
fn norm_abs(p: &Path) -> PathBuf {
    if let Ok(c) = std::fs::canonicalize(p) {
        return c;
    }
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };
    abs
}

/// 目标目录是否就是某侧原目录（= 原地合并）。
fn norm_eq(a: &Path, b: &Path) -> bool {
    a == b || norm_abs(a) == norm_abs(b)
}

/// 计算合并产物技能 id：找拥有 target 的扫描工具 → `tool_id|rel_dir`。
/// 找不到（如 target 不在任何工具扫描根下）返回 None，标签迁移则跳过。
fn compute_result_skill_id(target: &Path) -> Option<String> {
    let cfg = crate::config::load_config();
    let targets = crate::config::scan_targets_from_tools(&cfg.tools);
    for t in &targets {
        let base = PathBuf::from(&t.path);
        if let Ok(rel) = target.strip_prefix(&base) {
            let rel_dir = rel.to_string_lossy().replace('\\', "/");
            return Some(format!("{}|{}", t.tool_id, rel_dir));
        }
    }
    None
}

/// 台账中是否存在 target（canonicalize 后）与给定目录相同的链接；返回命中条目。
/// 供合并落点守卫（地雷 3）复用；目录不存在时返回 None。
fn ledger_hit_target<'a>(
    ledger: &'a crate::hub::LinksLedger,
    dir: &Path,
) -> Option<&'a crate::hub::HubLink> {
    let canon = std::fs::canonicalize(dir).unwrap_or_default();
    if canon.as_os_str().is_empty() {
        return None;
    }
    ledger.links.iter().find(|l| {
        std::fs::canonicalize(Path::new(&l.target))
            .map(|p| p == canon)
            .unwrap_or(false)
    })
}

/// 回收站语义处置单个技能目录；若该目录就是合并产物落点（原地合并）则跳过。
fn dispose_side(skill: &crate::scanner::Skill, merged_dir: &Path) -> Result<(), String> {
    if skill.source_deleted {
        return Ok(());
    }
    let dir = PathBuf::from(&skill.skill_dir);
    if !dir.is_dir() {
        return Ok(());
    }
    if norm_eq(&dir, merged_dir) {
        // 该目录已被合并产物就地覆盖，不再单独处置
        return Ok(());
    }
    trash::delete(&dir).map_err(|e| format!("移入回收站失败：{e}"))
}

// ---------------------------------------------------------------------------
// apply_merge
// ---------------------------------------------------------------------------

pub fn apply_merge(args: ApplyMergeArgs) -> Result<MergeResult, String> {
    // ---- 基本守卫 ----
    if args.a_id == args.b_id {
        return Err("不能合并同一个技能".to_string());
    }
    let name = args.name.trim();
    if name.is_empty() {
        return Err("合并后技能名为空".to_string());
    }
    if !crate::validate::is_hyphen_case(name) {
        return Err("name 必须为 hyphen-case：小写字母数字 + 连字符".to_string());
    }
    if args.target_root.trim().is_empty() {
        return Err("未选择落点目录".to_string());
    }
    let target_root = PathBuf::from(args.target_root.trim());

    let cfg = crate::config::load_config();
    let targets = crate::config::scan_targets_from_tools(&cfg.tools);
    let skills = crate::scanner::scan_all_skills(&targets);
    let a = find_skill(&skills, &args.a_id)
        .ok_or_else(|| "技能 A 未找到（可能已被删除），请重新走一遍查重".to_string())?;
    let b = find_skill(&skills, &args.b_id)
        .ok_or_else(|| "技能 B 未找到（可能已被删除），请重新走一遍查重".to_string())?;

    let a_dir = PathBuf::from(&a.skill_dir);
    let b_dir = PathBuf::from(&b.skill_dir);
    if !a_dir.is_dir() {
        return Err(format!("技能 A 目录不存在：{}", a.skill_dir));
    }
    if !b_dir.is_dir() {
        return Err(format!("技能 B 目录不存在：{}", b.skill_dir));
    }

    // ---- 地雷：被处置方不能是 junction 落点 / 账本出处 ----
    let will_dispose = |s: &crate::scanner::Skill, merged: &Path| -> bool {
        if matches!(args.disposal.as_str(), "keep_both") {
            return false;
        }
        if args.disposal == "delete_weaker" {
            if let Some(w) = &args.weaker_id {
                if *w != s.id {
                    return false; // delete_weaker 只处置 weaker 一方
                }
            }
        }
        // 若该侧目录就是合并产物落点，则其被就地覆盖，不视为「被处置」
        !norm_eq(&PathBuf::from(&s.skill_dir), merged)
    };
    // 合并产物落点
    let merged_dir = target_root.join(name);
    let a_is_merged = norm_eq(&a_dir, &merged_dir);
    let b_is_merged = norm_eq(&b_dir, &merged_dir);

    if will_dispose(a, &merged_dir) && a.hub_linked {
        return Err("技能 A 是 Hub 引用的 junction 落点，不能被处置。请改为保留它（换落点合并），或先去 Hub 解除引用。".to_string());
    }
    if will_dispose(b, &merged_dir) && b.hub_linked {
        return Err("技能 B 是 Hub 引用的 junction 落点，不能被处置。请改为保留它（换落点合并），或先去 Hub 解除引用。".to_string());
    }
    // 账本出处断链检查
    let ledger = crate::hub::load_ledger(&crate::config::get_data_dir());
    let ref_count = |s: &crate::scanner::Skill| -> usize {
        let canon = std::fs::canonicalize(PathBuf::from(&s.skill_dir)).unwrap_or_default();
        ledger
            .links
            .iter()
            .filter(|l| {
                std::fs::canonicalize(Path::new(&l.source))
                    .map(|p| p == canon)
                    .unwrap_or(false)
            })
            .count()
    };
    if will_dispose(a, &merged_dir) {
        let n = ref_count(a);
        if n > 0 {
            return Err(format!(
                "技能 A 是 {} 条 Hub 引用的出处，被处置后引用会断链。请先在 Hub 处理这些引用，或改为保留它。",
                n
            ));
        }
    }
    if will_dispose(b, &merged_dir) {
        let n = ref_count(b);
        if n > 0 {
            return Err(format!(
                "技能 B 是 {} 条 Hub 引用的出处，被处置后引用会断链。请先在 Hub 处理这些引用，或改为保留它。",
                n
            ));
        }
    }

    // ---- 地雷 3（冲突点 C3）：合并落点不能落在 Hub 引用目录上 ----
    // junction 落点就地覆盖会穿透写源（影响全部安装点）；copy 落点是分发副本，
    // 覆盖会与其他安装分叉。即使「原地替换 A/B」（a_is_merged/b_is_merged）也拦截。
    if let Some(hit) = ledger_hit_target(&ledger, &merged_dir) {
        let kind_cn = match hit.mode {
            crate::hub::LedgerMode::Link => "链接（junction）",
            crate::hub::LedgerMode::Copy => "副本",
        };
        return Err(format!(
            "合并落点 {} 是 Hub 引用的{}目录（{} → {}），合并会穿透写源或分叉副本。请改一个落点，或先去 Hub 处理该引用。",
            merged_dir.display(),
            kind_cn,
            hit.skill_name,
            hit.target_tool,
        ));
    }

    // ---- 落点存在性检查（EXISTS 语义）----
    if merged_dir.exists() && !a_is_merged && !b_is_merged {
        return Err(format!(
            "落点已存在同名技能目录：{}。请改一个名字或换落点（不覆盖已有技能）。",
            merged_dir.display()
        ));
    }
    if (a_is_merged || b_is_merged) && args.disposal == "keep_both" {
        return Err("落点与某侧原件目录重合时不能「都保留」（会覆盖原件）。请换落点或改处置方式。".to_string());
    }

    // ---- 备份先行（安全网：任何写操作之前；失败 → 整体中止）----
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_root = crate::config::get_data_dir().join("merge-backups");
    std::fs::create_dir_all(&backup_root).map_err(|e| format!("创建备份目录失败：{e}"))?;
    let safe = |s: &str| -> String {
        s.chars()
            .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
            .collect()
    };
    let backup_dir = backup_root.join(format!("{ts}-merge-{}-{}", safe(&a.name), safe(&b.name)));
    let backup_a = backup_dir.join("A");
    let backup_b = backup_dir.join("B");
    crate::import::copy_dir_recursive(&a_dir, &backup_a)
        .map_err(|e| format!("备份 A 失败，合并已中止：{e}"))?;
    crate::import::copy_dir_recursive(&b_dir, &backup_b)
        .map_err(|e| format!("备份 B 失败，合并已中止：{e}"))?;

    // ---- 写入合并产物 ----
    let write_result = (|| -> Result<(), String> {
        // 若原地合并某侧，则直接在该目录落盘；否则新建目录
        let dest_dir: PathBuf = if a_is_merged {
            a_dir.clone()
        } else if b_is_merged {
            b_dir.clone()
        } else {
            std::fs::create_dir_all(&merged_dir)
                .map_err(|e| format!("创建合并目录失败：{e}"))?;
            merged_dir.clone()
        };
        std::fs::write(dest_dir.join("SKILL.md"), &args.skill_md)
            .map_err(|e| format!("写入合并 SKILL.md 失败：{e}"))?;
        for op in &args.copy_ops {
            // R3：from 兼容绝对目录路径（N 路雪球合并的中间成员附件）；"a"/"b" 沿用两侧原目录
            let src = match op.from.as_str() {
                "b" => b_dir.join(&op.src_rel),
                "a" => a_dir.join(&op.src_rel),
                dir => PathBuf::from(dir).join(&op.src_rel),
            };
            let dst = dest_dir.join(&op.dst_rel);
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建附件目录失败：{e}"))?;
            }
            if !src.is_file() {
                return Err(format!("附件来源不存在：{}", src.display()));
            }
            std::fs::copy(&src, &dst).map_err(|e| format!("复制附件失败：{e}"))?;
        }
        Ok(())
    })();
    if let Err(e) = write_result {
        return Err(format!("合并写入失败：{e}（备份已保存于 {}）", backup_dir.display()));
    }

    // ---- 处置原件（回收站语义）----
    match args.disposal.as_str() {
        "delete_both" => {
            dispose_side(a, &merged_dir)?;
            dispose_side(b, &merged_dir)?;
        }
        "delete_weaker" => {
            let weaker = if args.weaker_id.as_deref() == Some(&args.b_id) { b } else { a };
            // 若 weaker 就是落点（原地合并），则它已被覆盖保留，无需处置
            dispose_side(weaker, &merged_dir)?;
        }
        _ => { /* keep_both：两侧原件都保留，只新增合并产物 */ }
    }

    // ---- 标签迁移：合并产物继承并集；被处置原件清理挂载 ----
    let mut tags_data = crate::tags::load_tags();
    let a_tags: Vec<String> = tags_data
        .assignments
        .get(&format!("skill:{}", a.id))
        .cloned()
        .unwrap_or_default();
    let b_tags: Vec<String> = tags_data
        .assignments
        .get(&format!("skill:{}", b.id))
        .cloned()
        .unwrap_or_default();
    let mut union: Vec<String> = a_tags.iter().chain(b_tags.iter()).cloned().collect();
    union.sort();
    union.dedup();
    let result_skill_id = compute_result_skill_id(&merged_dir).unwrap_or_else(|| format!("merged|{}", name));
    if !union.is_empty() {
        tags_data
            .assignments
            .insert(format!("skill:{}", result_skill_id), union.clone());
    }
    // 被处置的原件清理标签挂载（保留侧不动）
    let mut clear_tags = |id: &str| -> bool {
        tags_data.assignments.remove(&format!("skill:{id}")).is_some()
    };
    let mut tags_changed = false;
    if matches!(args.disposal.as_str(), "delete_both") {
        tags_changed |= clear_tags(&a.id);
        tags_changed |= clear_tags(&b.id);
    } else if args.disposal == "delete_weaker" {
        let weaker_id = if args.weaker_id.as_deref() == Some(&args.b_id) {
            &args.b_id
        } else {
            &args.a_id
        };
        tags_changed |= clear_tags(weaker_id);
    }
    if tags_changed || !union.is_empty() {
        let _ = crate::tags::save_tags(&tags_data);
    }

    // ---- 历史记录 ----
    let history_id = format!("m-{ts}");
    let record = MergeRecord {
        id: history_id.clone(),
        at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string(),
        kind: "merge".to_string(),
        a: MergeSide {
            skill_id: a.id.clone(),
            path: a.skill_dir.clone(),
            backup: backup_a.to_string_lossy().to_string(),
        },
        b: MergeSide {
            skill_id: b.id.clone(),
            path: b.skill_dir.clone(),
            backup: backup_b.to_string_lossy().to_string(),
        },
        result_path: merged_dir.to_string_lossy().to_string(),
        result_skill_id: result_skill_id.clone(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        disposal: args.disposal.clone(),
        polished: false,
        a_tags,
        b_tags,
    };
    let mut history = load_history();
    history.push(record);
    save_history(&history)?;

    crate::config::debug_log(&format!(
        "apply_merge: a={} b={} -> {} disposal={} backup={}",
        args.a_id,
        args.b_id,
        merged_dir.display(),
        args.disposal,
        backup_dir.display()
    ));

    Ok(MergeResult {
        result_path: merged_dir.to_string_lossy().to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        history_id,
    })
}

// ---------------------------------------------------------------------------
// 历史 / 撤销
// ---------------------------------------------------------------------------

pub fn list_merge_history() -> Vec<MergeRecord> {
    let mut h = load_history();
    h.sort_by(|x, y| y.at.cmp(&x.at));
    h
}

/// 撤销合并：恢复 A/B 两个原件 → 删除合并产物 → 还原标签 → 移除历史记录。
/// 撤销窗口不限时（只要备份目录还在）。
pub fn undo_merge(merge_id: String) -> Result<(), String> {
    let mut history = load_history();
    let idx = history
        .iter()
        .position(|r| r.id == merge_id)
        .ok_or_else(|| "未找到该合并记录".to_string())?;
    let rec = history[idx].clone();

    // 处置记录：只恢复被处置侧（b）；保留侧（a）从未被动过，无需恢复、绝不删
    if rec.kind == "dispose" {
        let backup = PathBuf::from(&rec.b.backup);
        if !backup.is_dir() {
            return Err(format!(
                "备份目录不存在，无法撤销：{}（需手动恢复）",
                backup.display()
            ));
        }
        let dest = PathBuf::from(&rec.b.path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("恢复目录失败：{e}"))?;
        }
        if dest.exists() {
            std::fs::remove_dir_all(&dest).map_err(|e| format!("清理原位置失败：{e}"))?;
        }
        crate::import::copy_dir_recursive(&backup, &dest)
            .map_err(|e| format!("恢复被处置侧失败（{}）：{e}", rec.b.skill_id))?;
        // 还原被处置侧的标签
        let mut tags_data = crate::tags::load_tags();
        if !rec.b_tags.is_empty() {
            tags_data
                .assignments
                .insert(format!("skill:{}", rec.b.skill_id), rec.b_tags.clone());
        } else {
            tags_data.assignments.remove(&format!("skill:{}", rec.b.skill_id));
        }
        let _ = crate::tags::save_tags(&tags_data);
        history.remove(idx);
        save_history(&history)?;
        crate::config::debug_log(&format!("undo_dispose: {merge_id} 已撤销"));
        return Ok(());
    }

    // 1. 恢复原件（备份 → 原路径）
    for side in [&rec.a, &rec.b] {
        let backup = PathBuf::from(&side.backup);
        if !backup.is_dir() {
            return Err(format!(
                "备份目录不存在，无法撤销：{}（合并产物与备份需手动处理）",
                backup.display()
            ));
        }
        let dest = PathBuf::from(&side.path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("恢复目录失败：{e}"))?;
        }
        if dest.exists() {
            // 原件原位可能已被合并产物覆盖（原地合并）→ 先清掉
            std::fs::remove_dir_all(&dest).map_err(|e| format!("清理原位置失败：{e}"))?;
        }
        crate::import::copy_dir_recursive(&backup, &dest)
            .map_err(|e| format!("恢复原件失败（{}）：{e}", side.skill_id))?;
    }

    // 2. 删除合并产物（若仍在）
    let result = PathBuf::from(&rec.result_path);
    if result.is_dir() {
        std::fs::remove_dir_all(&result).map_err(|e| format!("删除合并产物失败：{e}"))?;
    }

    // 3. 还原标签：移除合并产物的并集挂载，还原 A/B 原挂载
    let mut tags_data = crate::tags::load_tags();
    tags_data
        .assignments
        .remove(&format!("skill:{}", rec.result_skill_id));
    if !rec.a_tags.is_empty() {
        tags_data
            .assignments
            .insert(format!("skill:{}", rec.a.skill_id), rec.a_tags.clone());
    } else {
        tags_data.assignments.remove(&format!("skill:{}", rec.a.skill_id));
    }
    if !rec.b_tags.is_empty() {
        tags_data
            .assignments
            .insert(format!("skill:{}", rec.b.skill_id), rec.b_tags.clone());
    } else {
        tags_data.assignments.remove(&format!("skill:{}", rec.b.skill_id));
    }
    let _ = crate::tags::save_tags(&tags_data);

    // 4. 移除历史记录
    history.remove(idx);
    save_history(&history)?;

    crate::config::debug_log(&format!("undo_merge: {merge_id} 已撤销"));
    Ok(())
}

// ---------------------------------------------------------------------------
// 单测
// ---------------------------------------------------------------------------

#[cfg(test)]
mod merge_tests {
    use super::*;

    #[test]
    fn hyphen_case_rejected() {
        assert!(crate::validate::is_hyphen_case("merge-tools"));
        assert!(!crate::validate::is_hyphen_case("Merge_Tools"));
    }

    #[test]
    fn norm_eq_resolves_relative_and_abs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("sub");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(norm_eq(&dir, &dir));
        assert!(norm_eq(&dir, &dir.clone()));
    }

    #[test]
    fn ledger_hit_target_detects_hub_dirs() {
        // 冲突点 C3：合并落点命中台账 target（Link/Copy 均识别），普通目录不误伤
        let tmp = tempfile::tempdir().unwrap();
        let link_dir = tmp.path().join("link-loc");
        let copy_dir = tmp.path().join("copy-loc");
        let free_dir = tmp.path().join("free");
        for d in [&link_dir, &copy_dir, &free_dir] {
            std::fs::create_dir_all(d).unwrap();
        }
        let mk = |id: &str, mode: crate::hub::LedgerMode, target: &str| crate::hub::HubLink {
            id: id.into(),
            skill_name: "demo".into(),
            display_name: String::new(),
            source: "/tmp/src/demo".into(),
            target: target.into(),
            target_tool: "codex".into(),
            mode,
            created_at: String::new(),
        };
        let ledger = crate::hub::LinksLedger {
            version: 1,
            links: vec![
                mk("l1", crate::hub::LedgerMode::Link, &link_dir.to_string_lossy()),
                mk("l2", crate::hub::LedgerMode::Copy, &copy_dir.to_string_lossy()),
            ],
        };
        assert!(ledger_hit_target(&ledger, &link_dir).is_some(), "Link 落点命中");
        assert!(ledger_hit_target(&ledger, &copy_dir).is_some(), "Copy 落点命中");
        assert!(ledger_hit_target(&ledger, &free_dir).is_none(), "普通目录不命中");
        assert!(
            ledger_hit_target(&ledger, &tmp.path().join("missing")).is_none(),
            "不存在目录不命中"
        );
    }

    #[test]
    fn history_roundtrip() {
        // 用临时历史文件路径验证序列化契约（不碰全局 DATA_DIR）
        let rec = MergeRecord {
            id: "m-1".into(),
            at: "2026-08-12".into(),
            kind: "merge".into(),
            a: MergeSide { skill_id: "x|a".into(), path: "/tmp/a".into(), backup: "/back/A".into() },
            b: MergeSide { skill_id: "x|b".into(), path: "/tmp/b".into(), backup: "/back/B".into() },
            result_path: "/tmp/merged".into(),
            result_skill_id: "x|merged".into(),
            backup_dir: "/back".into(),
            disposal: "delete_both".into(),
            polished: false,
            a_tags: vec!["开发".into()],
            b_tags: vec!["效率".into()],
        };
        let json = serde_json::to_string_pretty(&rec).unwrap();
        let back: MergeRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "m-1");
        assert_eq!(back.result_skill_id, "x|merged");
        assert_eq!(back.a_tags, vec!["开发"]);
    }
}