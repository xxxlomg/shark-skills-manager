use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use crate::config;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationMeta {
    pub source_path: String,
    #[serde(default)]
    pub scan_label: String,
    #[serde(default)]
    pub source_hash: String,
    #[serde(default)]
    pub translated_at: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub title_zh: String,
    #[serde(default)]
    pub source_deleted: bool,
}

// ---------------------------------------------------------------------------
// 读写 translations.json
// ---------------------------------------------------------------------------

pub fn load_all_meta() -> HashMap<String, TranslationMeta> {
    let path = config::translations_json_path();
    if path.exists() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, TranslationMeta>>(&text) {
                return map;
            }
        }
    }
    HashMap::new()
}

fn save_all_meta(meta: &HashMap<String, TranslationMeta>) -> Result<(), String> {
    let path = config::translations_json_path();
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 单条操作
// ---------------------------------------------------------------------------

pub fn save_translation(
    skill_id: &str,
    bilingual_text: &str,
    source_path: &str,
    scan_label: &str,
    source_hash: &str,
    model: &str,
    title_zh: &str,
) -> Result<(), String> {
    // 写 .md 文件
    let dir = config::translations_dir();
    let _ = fs::create_dir_all(&dir);
    let md_path = dir.join(md_filename(skill_id));
    fs::write(&md_path, bilingual_text).map_err(|e| e.to_string())?;

    // 更新 index
    let mut index = load_all_meta();
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string();
    index.insert(
        skill_id.to_string(),
        TranslationMeta {
            source_path: source_path.to_string(),
            scan_label: scan_label.to_string(),
            source_hash: source_hash.to_string(),
            translated_at: now,
            model: model.to_string(),
            title_zh: title_zh.to_string(),
            source_deleted: false,
        },
    );
    save_all_meta(&index)
}

/// skill_id 含 Windows 文件名非法字符（`|` `/` `:` 等，os error 123 的根因）。
/// 落盘名做 percent-encode：安全字符 [A-Za-z0-9._-] 原样，其余 %XX。
/// 单射且稳定；旧哈希 id 无非法字符，编码后不变，天然兼容。
pub fn md_filename(id: &str) -> String {
    let safe = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_');
    let mut out = String::with_capacity(id.len() + 4);
    for &b in id.as_bytes() {
        if safe(b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out.push_str(".md");
    out
}

/// 旧名 md 改新名。rename 失败（跨卷/占用）回退内容复制并保留旧文件。
/// 返回操作后新名 md 是否可用。旧文件不存在或新文件已存在 → false（no-op）。
pub fn repair_rename(old_id: &str, new_id: &str) -> bool {
    let dir = config::translations_dir();
    let old_f = dir.join(md_filename(old_id));
    let new_f = dir.join(md_filename(new_id));
    if !old_f.exists() || new_f.exists() {
        return false;
    }
    if fs::rename(&old_f, &new_f).is_ok() {
        return true;
    }
    fs::read_to_string(&old_f)
        .map(|c| fs::write(&new_f, c).is_ok())
        .unwrap_or(false)
}

/// id 迁移换键（PLAN-04 §2.3）：md 文件改名 + meta 换键回写。
/// 旧键不存在时 no-op，幂等。rename 失败回退复制，杜绝「meta 新键 + md 旧名」残留。
pub fn rekey(old_id: &str, new_id: &str) -> Result<(), String> {
    let mut index = load_all_meta();
    let Some(meta) = index.remove(old_id) else {
        return Ok(());
    };
    repair_rename(old_id, new_id);
    index.insert(new_id.to_string(), meta);
    save_all_meta(&index)
}

pub fn read_translated_content(skill_id: &str) -> Option<String> {
    let md_path = config::translations_dir().join(md_filename(skill_id));
    fs::read_to_string(&md_path).ok()
}

/// 彻底移除译文记录（meta + 译文 md）。幂等：不存在时 no-op。
/// 调用方需自行保证已备份内容（如写入 merge-backups）后再调用。
pub fn remove_translation(skill_id: &str) -> Result<(), String> {
    let mut index = load_all_meta();
    if index.remove(skill_id).is_none() {
        return Ok(());
    }
    save_all_meta(&index)?;
    // md 删除失败不阻断（meta 已清，孤儿 md 不再被扫描复活）
    let md_path = config::translations_dir().join(md_filename(skill_id));
    if md_path.exists() {
        let _ = fs::remove_file(&md_path);
    }
    Ok(())
}

/// P10b：导入 Pack 时恢复译文 —— 按导入后的新 skill_id 落盘双语内容，
/// 并把标题/描述等 meta 合并进 translations.json（导入方立即可看译文）。
/// bilingual 为空时仅写 index（兼容仅有 meta 无内容的极端情况）。
pub fn restore_imported(
    skill_id: &str,
    bilingual: &str,
    title_zh: &str,
    source_path: &str,
    scan_label: &str,
    source_hash: &str,
    model: &str,
    translated_at: &str,
) -> Result<(), String> {
    let dir = config::translations_dir();
    let _ = fs::create_dir_all(&dir);
    if !bilingual.trim().is_empty() {
        fs::write(dir.join(md_filename(skill_id)), bilingual).map_err(|e| e.to_string())?;
    }
    let mut index = load_all_meta();
    index.insert(
        skill_id.to_string(),
        TranslationMeta {
            source_path: source_path.to_string(),
            scan_label: scan_label.to_string(),
            source_hash: source_hash.to_string(),
            translated_at: translated_at.to_string(),
            model: model.to_string(),
            title_zh: title_zh.to_string(),
            source_deleted: false,
        },
    );
    save_all_meta(&index)
}

pub fn sync_deleted_status(current_ids: &[String]) -> Result<(), String> {
    let mut index = load_all_meta();
    let current_set: std::collections::HashSet<&str> =
        current_ids.iter().map(|s| s.as_str()).collect();
    let mut changed = false;

    for (sid, meta) in index.iter_mut() {
        if current_set.contains(sid.as_str()) {
            if meta.source_deleted {
                meta.source_deleted = false;
                changed = true;
            }
        } else if !meta.source_deleted {
            meta.source_deleted = true;
            changed = true;
        }
    }

    if changed {
        save_all_meta(&index)?;
    }
    Ok(())
}
