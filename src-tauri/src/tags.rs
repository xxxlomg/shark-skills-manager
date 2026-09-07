use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use crate::config;

// ---------------------------------------------------------------------------
// 工作流 T：标签系统
//
// 设计要点：
// - 标签是纯管理层元数据，不进 SKILL.md frontmatter（避免 CL 白名单 warn）；
// - assignments 用复合键 `<对象类型>:<对象id>`：skill:<skill_id> / hublink:<link_id>；
// - skill_id = `{tool_id}|{rel_dir}`（v0.2 稳定键），rename 改 rel → id 漂移
//   → migrate_assignment 钩子（authoring::skill_rename 接线）；
// - 内置标签（开发/生图/媒体/效率）可改名不可删；自定义标签可删并级联清理。
// ---------------------------------------------------------------------------

pub const TAGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDef {
    pub name: String,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagsData {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub tags: HashMap<String, TagDef>,
    #[serde(default)]
    pub assignments: HashMap<String, Vec<String>>,
}

fn default_version() -> u32 {
    TAGS_VERSION
}

impl Default for TagsData {
    fn default() -> Self {
        Self {
            version: TAGS_VERSION,
            tags: builtin_tags(),
            assignments: HashMap::new(),
        }
    }
}

/// 内置标签表（Boss 定稿：开发/生图/媒体/效率 四个，其余用户自建）。
pub fn builtin_tags() -> HashMap<String, TagDef> {
    let mut m = HashMap::new();
    m.insert(
        "t-dev".to_string(),
        TagDef { name: "开发".to_string(), builtin: true },
    );
    m.insert(
        "t-image".to_string(),
        TagDef { name: "生图".to_string(), builtin: true },
    );
    m.insert(
        "t-media".to_string(),
        TagDef { name: "媒体".to_string(), builtin: true },
    );
    m.insert(
        "t-eff".to_string(),
        TagDef { name: "效率".to_string(), builtin: true },
    );
    m
}

// ---------------------------------------------------------------------------
// 读写 tags.json（容错模式同 translations：缺失/损坏 → 兜底数据，绝不 panic）
// ---------------------------------------------------------------------------

pub fn load_tags() -> TagsData {
    let path = config::tags_json_path();
    if path.exists() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(mut data) = serde_json::from_str::<TagsData>(&text) {
                ensure_builtins(&mut data);
                return data;
            }
        }
        config::debug_log(&format!(
            "tags.json 损坏或不可解析，回落默认内置标签：{}",
            path.display()
        ));
    }
    TagsData::default()
}

/// 旧文件可能缺新增的内置标签——补齐（只补缺失键，不覆盖用户改名）。
fn ensure_builtins(data: &mut TagsData) {
    for (id, def) in builtin_tags() {
        data.tags.entry(id).or_insert(def);
    }
}

pub fn save_tags(data: &TagsData) -> Result<(), String> {
    let path = config::tags_json_path();
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 复合键助手
// ---------------------------------------------------------------------------

pub fn skill_key(skill_id: &str) -> String {
    format!("skill:{}", skill_id)
}

/// Hub 引用挂载键（阶段 1 HubView 接线时使用）。
#[allow(dead_code)]
pub fn hublink_key(link_id: &str) -> String {
    format!("hublink:{}", link_id)
}

// ---------------------------------------------------------------------------
// id 漂移迁移：skill_rename 成功后调用。
// 旧 key 不存在时 no-op，幂等；新 key 已有挂载时合并去重。
// ---------------------------------------------------------------------------

pub fn migrate_assignment(old_key: &str, new_key: &str) -> Result<(), String> {
    if old_key == new_key {
        return Ok(());
    }
    let mut data = load_tags();
    let Some(tags) = data.assignments.remove(old_key) else {
        return Ok(());
    };
    let entry = data.assignments.entry(new_key.to_string()).or_default();
    for t in tags {
        if !entry.contains(&t) {
            entry.push(t);
        }
    }
    save_tags(&data)
}

// ---------------------------------------------------------------------------
// 删除标签级联（删自定义标签时清理所有挂载引用）
// ---------------------------------------------------------------------------

/// 删除自定义标签时的级联清理（当前由前端在 save_tags 前执行；
/// 保留 Rust 侧实现供后续命令化与测试锚定）。
#[allow(dead_code)]
pub fn remove_tag_cascade(data: &mut TagsData, tag_id: &str) {
    data.tags.remove(tag_id);
    for tags in data.assignments.values_mut() {
        tags.retain(|t| t != tag_id);
    }
    data.assignments.retain(|_, tags| !tags.is_empty());
}

#[cfg(test)]
mod tags_tests {
    use super::*;

    fn setup() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        config::set_data_dir_for_test(tmp.path().to_path_buf());
        tmp
    }

    #[test]
    fn load_missing_file_returns_builtins() {
        let _tmp = setup();
        let data = load_tags();
        assert_eq!(data.tags.len(), 4);
        assert!(data.tags.contains_key("t-dev"));
        assert!(data.tags.contains_key("t-image"));
        assert!(data.tags.contains_key("t-media"));
        assert!(data.tags.contains_key("t-eff"));
        assert!(data.assignments.is_empty());
    }

    #[test]
    fn save_load_roundtrip() {
        let _tmp = setup();
        let mut data = TagsData::default();
        data.tags.insert(
            "t-custom".to_string(),
            TagDef { name: "XX项目专用".to_string(), builtin: false },
        );
        data.assignments
            .insert(skill_key("abc123"), vec!["t-dev".to_string(), "t-custom".to_string()]);
        data.assignments
            .insert(hublink_key("link-1"), vec!["t-eff".to_string()]);
        save_tags(&data).unwrap();

        let loaded = load_tags();
        assert_eq!(loaded.tags.len(), 5);
        assert_eq!(loaded.assignments[&skill_key("abc123")].len(), 2);
        assert_eq!(loaded.assignments[&hublink_key("link-1")], vec!["t-eff".to_string()]);
    }

    #[test]
    fn corrupted_file_falls_back_to_defaults() {
        let tmp = setup();
        fs::write(tmp.path().join("tags.json"), "{not json").unwrap();
        let data = load_tags();
        assert_eq!(data.tags.len(), 4);
        assert!(data.assignments.is_empty());
    }

    #[test]
    fn ensure_builtins_adds_missing_without_overwrite() {
        let tmp = setup();
        // 模拟旧文件：只有一个内置标签且被改名
        let old = r#"{"version":1,"tags":{"t-dev":{"name":"开发(改)","builtin":true}},"assignments":{}}"#;
        fs::write(tmp.path().join("tags.json"), old).unwrap();
        let data = load_tags();
        assert_eq!(data.tags.len(), 4);
        assert_eq!(data.tags["t-dev"].name, "开发(改)", "用户改名不应被覆盖");
        assert!(data.tags.contains_key("t-media"));
    }

    #[test]
    fn migrate_moves_assignments_and_merges() {
        let _tmp = setup();
        let mut data = TagsData::default();
        data.assignments
            .insert(skill_key("old-id"), vec!["t-dev".to_string(), "t-eff".to_string()]);
        data.assignments
            .insert(skill_key("new-id"), vec!["t-dev".to_string()]);
        save_tags(&data).unwrap();

        migrate_assignment(&skill_key("old-id"), &skill_key("new-id")).unwrap();

        let loaded = load_tags();
        assert!(!loaded.assignments.contains_key(&skill_key("old-id")));
        let mut got = loaded.assignments[&skill_key("new-id")].clone();
        got.sort();
        assert_eq!(got, vec!["t-dev".to_string(), "t-eff".to_string()]);
    }

    #[test]
    fn migrate_missing_old_key_is_noop() {
        let _tmp = setup();
        assert!(migrate_assignment("skill:nope", "skill:x").is_ok());
        assert!(load_tags().assignments.is_empty());
    }

    #[test]
    fn remove_tag_cascades_assignments() {
        let _tmp = setup();
        let mut data = TagsData::default();
        data.tags.insert(
            "t-custom".to_string(),
            TagDef { name: "临时".to_string(), builtin: false },
        );
        data.assignments
            .insert(skill_key("s1"), vec!["t-custom".to_string(), "t-dev".to_string()]);
        data.assignments
            .insert(skill_key("s2"), vec!["t-custom".to_string()]);

        remove_tag_cascade(&mut data, "t-custom");

        assert!(!data.tags.contains_key("t-custom"));
        assert_eq!(data.assignments[&skill_key("s1")], vec!["t-dev".to_string()]);
        assert!(!data.assignments.contains_key(&skill_key("s2")), "空挂载应被清理");
    }
}
