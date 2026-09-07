use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use crate::config;

// ---------------------------------------------------------------------------
// 工作流 S：技能用途速览
//
// 固定模板三段式（何时调用/需要什么输入/最终输出什么），由前端 LLM 解析生成，
// Rust 侧仅持久化（与翻译同架构：LLM 请求在前端，Rust 只存）。
// source_hash = SKILL.md 内容哈希；正文变化 → 前端比对后标「内容已变化」失效。
// ---------------------------------------------------------------------------

pub const SUMMARIES_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    /// 何时调用：用户说什么话/什么场景下触发
    pub when: String,
    /// 需要什么输入：使用前提与必要输入
    pub input: String,
    /// 最终输出什么：执行完的产物与效果
    pub output: String,
    /// 生成时 SKILL.md 的内容哈希（失效检测用）
    #[serde(default)]
    pub source_hash: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SummariesData {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub summaries: HashMap<String, Summary>,
}

fn default_version() -> u32 {
    SUMMARIES_VERSION
}

// ---------------------------------------------------------------------------
// 读写 summaries.json（容错同 tags/translations）
// ---------------------------------------------------------------------------

pub fn load_summaries() -> SummariesData {
    let path = config::summaries_json_path();
    if path.exists() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(data) = serde_json::from_str::<SummariesData>(&text) {
                return data;
            }
        }
        config::debug_log(&format!(
            "summaries.json 损坏或不可解析，回落空数据：{}",
            path.display()
        ));
    }
    SummariesData::default()
}

pub fn save_summaries(data: &SummariesData) -> Result<(), String> {
    let path = config::summaries_json_path();
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// 单条写入（生成/重新生成/失效后重做的统一入口）。
pub fn write_summary(skill_id: &str, summary: Summary) -> Result<(), String> {
    let mut data = load_summaries();
    data.summaries.insert(skill_id.to_string(), summary);
    save_summaries(&data)
}

/// id 漂移迁移（与 tags 同理：skill_rename 后保持速览跟随技能）。
pub fn migrate_summary(old_id: &str, new_id: &str) -> Result<(), String> {
    if old_id == new_id {
        return Ok(());
    }
    let mut data = load_summaries();
    let Some(s) = data.summaries.remove(old_id) else {
        return Ok(());
    };
    data.summaries.insert(new_id.to_string(), s);
    save_summaries(&data)
}

#[cfg(test)]
mod summaries_tests {
    use super::*;

    fn setup() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        config::set_data_dir_for_test(tmp.path().to_path_buf());
        tmp
    }

    fn sample() -> Summary {
        Summary {
            when: "用户要求生成产品图时".to_string(),
            input: "产品名称 + 风格关键词".to_string(),
            output: "一张 1024x1024 的 PNG".to_string(),
            source_hash: "hash-1".to_string(),
            model: "qwen-test".to_string(),
            created_at: "2026-08-12T20:00:00+0800".to_string(),
        }
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let _tmp = setup();
        let data = load_summaries();
        assert!(data.summaries.is_empty());
    }

    #[test]
    fn write_load_roundtrip() {
        let _tmp = setup();
        write_summary("skill-a", sample()).unwrap();
        let loaded = load_summaries();
        let s = &loaded.summaries["skill-a"];
        assert_eq!(s.when, "用户要求生成产品图时");
        assert_eq!(s.source_hash, "hash-1");
    }

    #[test]
    fn corrupted_file_falls_back_to_empty() {
        let tmp = setup();
        fs::write(tmp.path().join("summaries.json"), "oops{").unwrap();
        assert!(load_summaries().summaries.is_empty());
    }

    #[test]
    fn migrate_moves_entry() {
        let _tmp = setup();
        write_summary("old-id", sample()).unwrap();
        migrate_summary("old-id", "new-id").unwrap();
        let loaded = load_summaries();
        assert!(!loaded.summaries.contains_key("old-id"));
        assert!(loaded.summaries.contains_key("new-id"));
    }

    #[test]
    fn migrate_missing_is_noop() {
        let _tmp = setup();
        assert!(migrate_summary("nope", "x").is_ok());
        assert!(load_summaries().summaries.is_empty());
    }
}
