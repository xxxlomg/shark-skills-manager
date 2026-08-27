use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::config::{self, ScanTarget};
use crate::hub::clean_path_str;
use crate::translations;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    /// v0.2（B4）：`tool_id|rel_dir` 稳定键，跨构建形态/路径漂移不变。
    /// v0.1 键（hex8 虚拟 id / 路径哈希）在扫描时精确回退并 rekey 落盘。
    pub id: String,
    pub name: String,
    pub folder_name: String,
    pub description: String,
    pub emoji: Option<String>,
    pub scan_label: String,
    pub source_path: String,
    /// 实际扫描到的技能目录（junction 落点时不穿透——hub 操作锚点；
    /// 与 source_path 的 canonical 值互补：后者透过 junction 指向出处文件）
    #[serde(default)]
    pub skill_dir: String,
    /// 来源工具注册表 id（builtin/imported/custom-*/claude-code/...）
    #[serde(default)]
    pub tool_id: String,
    /// 是否为同名组的代表卡片（B4 代表选取：tools 顺序即优先级）
    #[serde(default = "default_true_bool")]
    pub is_representative: bool,
    /// 其他持有同名技能的工具 id 列表（UI 徽标/切换用）
    #[serde(default)]
    pub other_sources: Vec<String>,
    /// 该目录是 junction（hub link 落点）
    #[serde(default)]
    pub hub_linked: bool,
    /// 账本中对应的 link id（commands 层 join 填充；scanner 不读账本）
    #[serde(default)]
    pub hub_link_id: Option<String>,
    pub has_translation: bool,
    /// 元数据记录存在且源未删除，但译文 .md 丢失/为空。
    /// 卡片状态如实降级为「待翻译」+ 此标记驱动「译文丢失」提示。
    #[serde(default)]
    pub translation_lost: bool,
    pub title_zh: String,
    /// 译文中 frontmatter description 的中文版本（扫描时从译文文件派生，
    /// 无译文时为空串）。卡片/详情描述优先展示它。
    #[serde(default)]
    pub description_zh: String,
    pub source_deleted: bool,
    /// 所属合集的中间路径（相对 scan_path  base 之下）。
    /// 一级 skill 为 None；嵌套 skill 为 Some("collection") 或 Some("a/b")。
    #[serde(default)]
    pub parent_collection: Option<String>,
}

fn default_true_bool() -> bool {
    true
}

// ---------------------------------------------------------------------------
// ID 生成
// ---------------------------------------------------------------------------

pub fn make_skill_id(abs_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(abs_path.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8]) // 16 hex chars
}

// 简易 hex 编码（避免引入 hex crate）
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

// ---------------------------------------------------------------------------
// 虚拟 id（v0.1 遗留键，B4 起仅用于译文回退 rekey）
// ---------------------------------------------------------------------------

fn make_virtual_id(token: &str, rel_dir: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}\x00{}", token, rel_dir).as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8])
}

/// junction/symlink 目录探测（hub link 落点标记用）。
/// junction::exists 只查 reparse point，不穿透目标，悬空链接也能识别。
fn is_reparse_dir(p: &Path) -> bool {
    #[cfg(windows)]
    {
        junction::exists(p).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        fs::symlink_metadata(p)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }
}

fn rel_dir_slashed(child: &Path, base: &Path) -> String {
    child
        .strip_prefix(base)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// 导入库拍平迁移：新 rel 形如 stem/folder，从 stem/.import.json 的
/// skills[{rel, folder}] 映射反查导入前嵌套 rel，派生旧虚拟 id。
/// 文件缺失/格式不符（旧版字符串数组）返回 None——旧版未拍平，id 本就直 hit。
fn imported_old_id(base: &Path, rel: &str) -> Option<String> {
    let mut segs = rel.splitn(2, '/');
    let stem = segs.next()?;
    let folder = segs.next()?;
    let json_path = base.join(stem).join(".import.json");
    let text = fs::read_to_string(json_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let old_rel = v["skills"]
        .as_array()?
        .iter()
        .find(|r| r["folder"].as_str() == Some(folder))
        .and_then(|r| r["rel"].as_str())?;
    Some(make_virtual_id("imported", &format!("{}/{}", stem, old_rel)))
}

// ---------------------------------------------------------------------------
// Frontmatter 解析
// ---------------------------------------------------------------------------

pub fn parse_frontmatter(text: &str) -> HashMap<String, String> {
    let mut meta = HashMap::new();
    // 匹配 --- ... --- 块
    let re = Regex::new(r"(?s)\A---\r?\n(.*?)\r?\n---").unwrap();
    if let Some(caps) = re.captures(text) {
        let fm = &caps[1];
        let line_re = Regex::new(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$").unwrap();
        for line in fm.lines() {
            if let Some(caps) = line_re.captures(line) {
                let key = caps[1].to_string();
                let mut val = caps[2].trim().to_string();
                // 去引号
                if val.len() >= 2 {
                    let bytes = val.as_bytes();
                    if (bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
                        || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\'')
                    {
                        val = val[1..val.len() - 1].to_string();
                    }
                }
                meta.insert(key, val);
            }
        }
    }
    meta
}

/// 从译文 .md 的 translated 段提取 frontmatter description（中文）。
/// 译文格式：`<!-- anchor:original -->\n<原文>\n<!-- anchor:translated -->\n<译文>`。
/// 翻译 prompt 要求保留 Markdown/frontmatter 结构，故译文段首行仍为
/// `description: <中文>`；取单行值，缺失则返回空串。
fn extract_description_zh(skill_id: &str) -> String {
    let text = match translations::read_translated_content(skill_id) {
        Some(t) => t,
        None => return String::new(),
    };
    let translated = match text.split("<!-- anchor:translated -->").nth(1) {
        Some(t) => t,
        None => return String::new(),
    };
    let re = Regex::new(r"(?m)^description:\s*(.+)$").unwrap();
    re.captures(translated)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default()
}

fn extract_emoji(text: &str) -> Option<String> {
    let re = Regex::new(r#"emoji:\s*["']?([^"'\n]+)"#).unwrap();
    // 按字节截断可能落在多字节 UTF-8 字符中间（中文内容）→ 用字符边界安全截断，避免 panic
    let limited = &text[..text.floor_char_boundary(2000.min(text.len()))];
    re.captures(limited)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// 递归扫描（max_depth=3，有 SKILL.md 即停）
// ---------------------------------------------------------------------------

const MAX_SCAN_DEPTH: usize = 3;

/// 归一化绝对路径（best-effort canonicalize，失败回退原路径）。
/// 用于 disjoint：扫描根与遍历节点统一到同一形式再比较。
fn norm_abs(p: &Path) -> std::path::PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| {
        // Windows 下统一斜杠，避免大小写/尾斜杠差异
        let s = p.to_string_lossy().replace('\\', "/");
        std::path::PathBuf::from(s.trim_end_matches('/'))
    })
}

/// 探测 dir 的直接子目录中是否存在含 SKILL.md 的技能目录。
/// 用于识别「混合容器」（技能包）：目录自身有 SKILL.md 兼作子技能容器，
/// 此时需继续下钻；纯技能目录（references/scripts/node_modules 等无技能）
/// 则停止，避免无谓遍历依赖树。
fn has_skill_children(dir: &Path) -> bool {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .any(|e| e.path().join("SKILL.md").is_file())
}

/// 递归扫描目录，收集含 SKILL.md 的子目录。
///
/// - `depth` 从 1 开始（base 的直接子目录 = depth 1）。
/// - `collection` 表示「当前 dir 作为合集容器时的中间路径」。
///   base 调用时为 None；进入一个无 SKILL.md 的子目录后，该子目录名成为合集名。
/// - `skip_roots` = 全局扫描根本集合（disjoint, D7）。当某个合集容器本身就是
///   另一条扫描根时，祖先根不再下钻（该子树由内根独立扫描），避免双身份。
fn scan_dir_recursive(
    dir: &Path,
    depth: usize,
    base: &Path,
    scan_label: &str,
    tool_id: &str,
    collection: Option<String>,
    translation_meta: &HashMap<String, translations::TranslationMeta>,
    skip_roots: &std::collections::HashSet<std::path::PathBuf>,
    skills: &mut Vec<Skill>,
    seen_ids: &mut std::collections::HashSet<String>,
    rekeys: &mut Vec<(String, String)>,
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut dirs: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());

    for entry in dirs {
        let child = entry.path();
        let skill_md = child.join("SKILL.md");
        let folder_name = child
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // 内置内部技能（纯内部资源，仅创作工作台隐式调用）：整棵子树跳过，
        // 不注册为可见技能（PLAN-17）。白名单 + 内置目录双重判定，不误伤用户同名技能。
        if crate::config::is_internal_skill_dir(&child) {
            continue;
        }

        if skill_md.is_file() {
            // 有 SKILL.md → 记为 skill，归属当前 collection
            register_skill(
                &child,
                &skill_md,
                base,
                scan_label,
                tool_id,
                collection.clone(),
                translation_meta,
                skills,
                seen_ids,
                rekeys,
            );
            // 混合容器（技能包）：自身含 SKILL.md 且直接子目录含技能 → 继续下钻，
            // 子技能以当前目录名作为 collection 前缀注册。
            // 纯技能目录（references/scripts/node_modules 等无技能）探测不通过 → 停止。
            if !has_skill_children(&child) {
                continue;
            }
            // disjoint(D7)：若该容器本身是另一条扫描根，则祖先根不再下钻，
            // 该子树由内根独立扫描（避免双身份）。
            if skip_roots.contains(&norm_abs(&child)) {
                continue;
            }
        } else {
            // 无 SKILL.md → 该目录是合集容器，递归下一层。
            // disjoint(D7)：若该容器本身是另一条扫描根，则祖先根不再下钻，
            // 该子树由内根独立扫描（避免双身份）。
            if skip_roots.contains(&norm_abs(&child)) {
                continue;
            }
        }
        let next_collection = match &collection {
            None => Some(folder_name),
            Some(c) => Some(format!("{}/{}", c, folder_name)),
        };
        scan_dir_recursive(
            &child,
            depth + 1,
            base,
            scan_label,
            tool_id,
            next_collection,
            translation_meta,
            skip_roots,
            skills,
            seen_ids,
            rekeys,
        );
    }
}

/// 将一个含 SKILL.md 的目录注册为 Skill。
/// id = `tool_id|rel_dir`（v0.2 稳定键）；译文关联未命中时按序精确回退 v0.1
/// 旧键并排队 rekey（①导入库拍平映射 ②虚拟 id/路径哈希 ③source_path 兜底）。
#[allow(clippy::too_many_arguments)]
fn register_skill(
    child: &Path,
    skill_md: &Path,
    base: &Path,
    scan_label: &str,
    tool_id: &str,
    collection: Option<String>,
    translation_meta: &HashMap<String, translations::TranslationMeta>,
    skills: &mut Vec<Skill>,
    seen_ids: &mut std::collections::HashSet<String>,
    rekeys: &mut Vec<(String, String)>,
) {
    // canonicalize 在 Windows 会返回 `\\?\C:\…` 扩展前缀，剥离后再当展示路径
    // （Boss 实测：重复扫描里路径前面多了 `\\?\`）。
    let abs_path = match fs::canonicalize(skill_md) {
        Ok(p) => clean_path_str(&p),
        Err(_) => clean_path_str(skill_md),
    };

    let rel = rel_dir_slashed(child, base);
    let skill_id = format!("{}|{}", tool_id, rel);
    if seen_ids.contains(&skill_id) {
        return;
    }
    seen_ids.insert(skill_id.clone());

    let text = match fs::read_to_string(skill_md) {
        Ok(t) => t,
        Err(_) => return,
    };

    let fm = parse_frontmatter(&text);
    let emoji = extract_emoji(&text);
    let folder_name = child
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // v0.1 遗留键候选：app 自有源 = 虚拟 id；外部工具 = 路径哈希。
    // 注意：junction 落点副本的 canonicalize 穿透回源文件，其 v0.1 路径哈希
    // 与源技能旧键相同——按扫描顺序（tools 顺序，确定性）先者认领。
    let legacy_virtual = if tool_id == config::TOOL_ID_BUILTIN || tool_id == config::TOOL_ID_IMPORTED
    {
        Some(make_virtual_id(tool_id, &rel))
    } else {
        None
    };
    let legacy_path = make_skill_id(&abs_path);

    let mut migrated_from: Option<String> = None;
    let tmeta = translation_meta.get(&skill_id).cloned().or_else(|| {
        // ① 导入库拍平迁移：按 .import.json 的 rel→folder 映射精确认领旧虚拟 id，
        //    不做 basename 猜测（避免跨 stem 同名互偷）。
        if tool_id == config::TOOL_ID_IMPORTED {
            if let Some(old_id) = imported_old_id(base, &rel) {
                if old_id != skill_id {
                    if let Some(m) = translation_meta.get(&old_id) {
                        rekeys.push((old_id.clone(), skill_id.clone()));
                        migrated_from = Some(old_id);
                        return Some(m.clone());
                    }
                }
            }
        }
        // ② v0.1 键直取
        if let Some(lv) = &legacy_virtual {
            if let Some(m) = translation_meta.get(lv) {
                rekeys.push((lv.clone(), skill_id.clone()));
                migrated_from = Some(lv.clone());
                return Some(m.clone());
            }
        }
        if let Some(m) = translation_meta.get(&legacy_path) {
            rekeys.push((legacy_path.clone(), skill_id.clone()));
            migrated_from = Some(legacy_path.clone());
            return Some(m.clone());
        }
        // ③ 兜底仅限 app 自有源（对齐 v0.1 语义）：外部工具的旧键是路径哈希，
        //    ②已精确覆盖；若放开 source_path 模糊匹配，junction 穿透造成的
        //    canonical 同址会在多工具间按 HashMap 随机序互偷译文。
        if tool_id != config::TOOL_ID_BUILTIN && tool_id != config::TOOL_ID_IMPORTED {
            return None;
        }
        let rel_md = format!("{}/SKILL.md", rel);
        translation_meta
            .iter()
            .find(|(k, m)| {
                k.as_str() != skill_id.as_str()
                    && (m.source_path == abs_path
                        || (m.scan_label == "builtin"
                            && (m.source_path.ends_with(&format!("/{}", rel_md))
                                || m.source_path.ends_with(&format!("\\{}", rel_md)))))
            })
            .map(|(k, m)| {
                rekeys.push((k.clone(), skill_id.clone()));
                migrated_from = Some(k.clone());
                m.clone()
            })
    });
    // 历史残留自愈：meta 已是新键（直取命中）但 md 仍旧名——过去 rekey 的
    // rename 失败被吞所致。正向重算 v0.1 旧键候选，旧名 md 存在即改名修复，
    // 本次扫描随后用新 id 直接命中。真丢失（旧名也不在）则落入 lost 判定。
    if migrated_from.is_none()
        && tmeta.is_some()
        && translations::read_translated_content(&skill_id)
            .map(|t| t.trim().is_empty())
            .unwrap_or(true)
    {
        let mut candidates: Vec<String> = Vec::new();
        if let Some(old) = imported_old_id(base, &rel) {
            candidates.push(old);
        }
        if let Some(lv) = &legacy_virtual {
            candidates.push(lv.clone());
        }
        candidates.push(legacy_path.clone());
        for old in candidates {
            if old != skill_id && translations::repair_rename(&old, &skill_id) {
                config::debug_log(&format!("translation md repaired: {} -> {}", old, skill_id));
                break;
            }
        }
    }

    // 状态以译文内容实际存在为准：meta 在但 .md 丢失/为空 → lost（卡片不再谎报「已翻译」）。
    // 迁移当次 md 文件还是旧名，用旧 id 读；rekey 落盘后下次自然用新 id。
    let read_id = migrated_from.as_ref().unwrap_or(&skill_id);
    let translation_lost = tmeta
        .as_ref()
        .map(|m| {
            !m.source_deleted
                && translations::read_translated_content(read_id)
                    .map(|t| t.trim().is_empty())
                    .unwrap_or(true)
        })
        .unwrap_or(false);
    let has_translation = tmeta.as_ref().map(|m| !m.source_deleted).unwrap_or(false)
        && !translation_lost;
    let title_zh = tmeta
        .map(|m| m.title_zh.clone())
        .unwrap_or_default();
    let description_zh = if has_translation {
        extract_description_zh(read_id)
    } else {
        String::new()
    };

    skills.push(Skill {
        id: skill_id,
        name: fm.get("name").cloned().unwrap_or_else(|| folder_name.clone()),
        folder_name,
        description: fm.get("description").cloned().unwrap_or_default(),
        emoji,
        scan_label: scan_label.to_string(),
        source_path: abs_path,
        skill_dir: child.to_string_lossy().to_string(),
        tool_id: tool_id.to_string(),
        is_representative: true, // 代表选取 pass 精化
        other_sources: vec![],
        hub_linked: is_reparse_dir(child),
        hub_link_id: None, // commands 层 join 账本填充
        has_translation,
        translation_lost,
        title_zh,
        description_zh,
        source_deleted: false,
        parent_collection: collection,
    });
}

// ---------------------------------------------------------------------------
// 测试（B4 验收：稳定 rekey / 代表选取优先级 / junction 感知）
// 注意：scanner 会只读加载真实 translations.json；下列用例的临时技能名与
// 真实译文不可能碰撞，rekey 队列恒空 → 不产生任何写副作用。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ScanTarget;

    fn tmp_root(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("sk-b4-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn make_skill(root: &Path, name: &str) {
        let d = root.join(name);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("SKILL.md"),
            format!("---\nname: {}\ndescription: test skill\n---\nbody", name),
        )
        .unwrap();
    }

    fn target(path: &Path, tool_id: &str, label: &str) -> ScanTarget {
        ScanTarget {
            path: path.to_string_lossy().to_string(),
            label: label.to_string(),
            tool_id: tool_id.to_string(),
        }
    }

    /// 过滤孤儿条目（scanner 会附带真实 translations.json 的孤儿，与本测试无关）
    fn live(skills: Vec<Skill>) -> Vec<Skill> {
        skills.into_iter().filter(|s| !s.source_deleted).collect()
    }

    #[test]
    fn stable_rekey_format_and_nesting() {
        let root = tmp_root("rekey");
        let tool_a = root.join("a");
        make_skill(&tool_a, "solo-a");
        // 嵌套合集：pack/solo-b
        let nested = tool_a.join("pack").join("solo-b");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("SKILL.md"),
            "---\nname: solo-b\ndescription: nested\n---\nbody",
        )
        .unwrap();

        let skills = live(scan_all_skills(&[target(&tool_a, "claude-code", "Claude Code")]));
        assert_eq!(skills.len(), 2);
        let flat = skills.iter().find(|s| s.folder_name == "solo-a").unwrap();
        assert_eq!(flat.id, "claude-code|solo-a", "顶层 id = tool_id|name");
        assert_eq!(flat.tool_id, "claude-code");
        assert_eq!(flat.parent_collection, None);
        let nest = skills.iter().find(|s| s.folder_name == "solo-b").unwrap();
        assert_eq!(nest.id, "claude-code|pack/solo-b", "嵌套 rel 消歧");
        assert_eq!(nest.parent_collection.as_deref(), Some("pack"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn representative_selection_cross_tool_priority() {
        let root = tmp_root("rep");
        let tool_a = root.join("a");
        let tool_b = root.join("b");
        make_skill(&tool_a, "pdf-toolkit");
        make_skill(&tool_a, "only-a");
        make_skill(&tool_b, "pdf-toolkit"); // 同名真实副本（如 Hub copy 落点）
        make_skill(&tool_b, "only-b");

        let skills = live(scan_all_skills(&[
            target(&tool_a, "claude-code", "Claude Code"),
            target(&tool_b, "codex", "Codex CLI"),
        ]));
        assert_eq!(skills.len(), 4);

        // 真实目录恒为代表：两工具的 pdf-toolkit 各自可见（不被同名折叠），
        // 保证 Hub copy 分发的独立副本在目标工具分组里可被看到与查重。
        let a_skill = skills
            .iter()
            .find(|s| s.id == "claude-code|pdf-toolkit")
            .unwrap();
        assert!(a_skill.is_representative, "真实技能恒为代表");
        assert_eq!(a_skill.other_sources, vec!["codex".to_string()]);

        let b_skill = skills.iter().find(|s| s.id == "codex|pdf-toolkit").unwrap();
        assert!(b_skill.is_representative, "真实副本也可见（不被折叠）");
        assert_eq!(b_skill.other_sources, vec!["claude-code".to_string()]);

        // 无同名者不受影响
        let solo = skills.iter().find(|s| s.id == "claude-code|only-a").unwrap();
        assert!(solo.is_representative && solo.other_sources.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn same_tool_collection_namesakes_not_collapsed() {
        let root = tmp_root("same-tool");
        let tool_a = root.join("a");
        for coll in ["x", "y"] {
            let d = tool_a.join(coll).join("dup");
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("SKILL.md"), "---\nname: dup\ndescription: d\n---\nb").unwrap();
        }
        let skills = live(scan_all_skills(&[target(&tool_a, "claude-code", "Claude Code")]));
        assert_eq!(skills.len(), 2);
        // 同工具内不同合集的同名目录 = 不同技能，均为代表
        assert!(skills.iter().all(|s| s.is_representative));
        assert!(skills.iter().all(|s| s.other_sources.is_empty()));
        let _ = fs::remove_dir_all(&root);
    }

    /// D7 disjoint：嵌套扫描根不双身份。祖先根遍历到嵌套根边界停止下钻，
    /// 内根独立扫描 → 内容只归最内层根，归属 = 用户选定的最内层模块。
    #[test]
    fn nested_scan_roots_are_disjoint() {
        let root = tmp_root("disjoint");
        let outer = root.join("skills"); // 工具 b
        let inner = outer.join("c").join("skills"); // 工具 c（嵌套于 outer 下）
        make_skill(&outer, "outer-only");
        let inner_skill = inner.join("some-skill");
        fs::create_dir_all(&inner_skill).unwrap();
        fs::write(
            inner_skill.join("SKILL.md"),
            "---\nname: some-skill\ndescription: nested\n---\nb",
        )
        .unwrap();

        let skills = live(scan_all_skills(&[
            target(&outer, "b", "B"),
            target(&inner, "c", "C"),
        ]));
        // outer-only 归 b；some-skill 只归最内层 c，不产生 b|c/skills/some-skill
        assert!(skills.iter().any(|s| s.id == "b|outer-only"));
        assert!(
            skills.iter().any(|s| s.id == "c|some-skill"),
            "内根独立产出 some-skill: {:?}",
            skills.iter().map(|s| &s.id).collect::<Vec<_>>()
        );
        assert!(
            !skills.iter().any(|s| s.id == "b|c/skills/some-skill"),
            "祖先根不得下钻进嵌套根: {:?}",
            skills.iter().map(|s| &s.id).collect::<Vec<_>>()
        );
        // some-skill 归属最内层 c，parent_collection 为空
        let inner_skill_rec = skills.iter().find(|s| s.id == "c|some-skill").unwrap();
        assert_eq!(inner_skill_rec.parent_collection, None);
        assert!(inner_skill_rec.is_representative);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hub_linked_junction_detected_and_repped() {
        let root = tmp_root("junction");
        let src_tool = root.join("claude"); // 出处工具
        let tgt_tool = root.join("codex"); // 引用落点工具
        fs::create_dir_all(&src_tool).unwrap();
        fs::create_dir_all(&tgt_tool).unwrap();
        make_skill(&src_tool, "shared-skill");
        make_skill(&tgt_tool, "native-skill");

        // 经 hub 层创建 junction（账本写 root/data，不碰真实数据目录）
        let link = crate::hub::link_skill_to_dir(
            &root.join("data"),
            &src_tool.join("shared-skill"),
            &tgt_tool,
            "codex",
            crate::hub::LinkMode::Link,
        )
        .unwrap();

        let skills = live(scan_all_skills(&[
            target(&src_tool, "claude-code", "Claude Code"),
            target(&tgt_tool, "codex", "Codex CLI"),
        ]));
        // claude: shared-skill；codex: native-skill + junction 副本
        assert_eq!(skills.len(), 3);
        let linked = skills.iter().find(|s| s.id == "codex|shared-skill").unwrap();
        assert!(linked.hub_linked, "junction 落点必须被识别");
        assert!(linked.skill_dir.ends_with("shared-skill"));
        assert!(
            linked.source_path.contains("claude"),
            "canonicalize 穿透 junction 指向出处: {}",
            linked.source_path
        );
        // 同名跨工具 → 出处（扫描顺序在前）为代表
        let origin = skills.iter().find(|s| s.id == "claude-code|shared-skill").unwrap();
        assert!(origin.is_representative);
        assert!(!linked.is_representative);
        let _ = junction::delete(tgt_tool.join("shared-skill"));
        let _ = fs::remove_dir_all(&root);
        assert!(!link.id.is_empty());
    }

    /// 混合容器（技能包）：目录自身有 SKILL.md 兼作子技能容器。
    /// 修复前「有 SKILL.md 即停」导致子技能全部丢失；
    /// 修复后自身注册为技能，且子技能以 parent_collection 归属继续下钻。
    #[test]
    fn mixed_pack_dir_registers_self_and_children() {
        let root = tmp_root("pack-mixed");
        let tool = root.join("t");
        let pack = tool.join("shark-dsh");
        fs::create_dir_all(&pack).unwrap();
        // 包容器自身的 SKILL.md
        fs::write(
            pack.join("SKILL.md"),
            "---\nname: shark-dsh\ndescription: pack\n---\nb",
        )
        .unwrap();
        for sub in ["shark-browser", "shark-task-plan"] {
            make_skill(&pack, sub);
        }
        // 纯技能目录（有 SKILL.md，子目录 references 无技能）→ 不误下钻
        make_skill(&tool, "plain-skill");
        fs::create_dir_all(tool.join("plain-skill").join("references")).unwrap();
        fs::write(
            tool.join("plain-skill").join("references").join("notes.md"),
            "x",
        )
        .unwrap();

        let skills = live(scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]));
        assert_eq!(skills.len(), 4, "包自身 + 2 子技能 + 纯技能: {:?}", skills.iter().map(|s| &s.id).collect::<Vec<_>>());
        let pack_self = skills
            .iter()
            .find(|s| s.id == "claude-code|shark-dsh")
            .unwrap();
        assert_eq!(pack_self.parent_collection, None, "包自身是根级技能");
        // 包级 SKILL.md 是全局说明：其 frontmatter 元数据须绑定到包 skill_id。
        assert_eq!(pack_self.name, "shark-dsh", "包名须取自包根 SKILL.md");
        assert_eq!(pack_self.description, "pack", "包级描述须绑定到包 skill_id");
        let child = skills
            .iter()
            .find(|s| s.id == "claude-code|shark-dsh/shark-browser")
            .unwrap();
        assert_eq!(
            child.parent_collection.as_deref(),
            Some("shark-dsh"),
            "子技能必须归属包容器"
        );
        assert!(
            !skills.iter().any(|s| s.id.ends_with("plain-skill/references")),
            "纯技能目录的子目录不得被当作合集下钻"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// P8 反向场景：源工具在扫描序后面（codex 真源 + claude junction 落点）。
    /// 旧逻辑按扫描序取首个为代表，claude junction 会抢占代表位导致 codex 真源被隐藏。
    /// 修复后 junction 落点恒不为代表，真源保留。
    #[test]
    fn hub_linked_rep_priority_reverse_source_later() {
        let root = tmp_root("junction-rev");
        let tgt_tool = root.join("claude"); // 落点工具（扫描序前）
        let src_tool = root.join("codex"); // 出处工具（扫描序后）
        fs::create_dir_all(&src_tool).unwrap();
        fs::create_dir_all(&tgt_tool).unwrap();
        make_skill(&src_tool, "image-gen");
        make_skill(&tgt_tool, "native-skill");

        // 在 claude 侧建 junction，指向 codex 真源 image-gen
        let link = crate::hub::link_skill_to_dir(
            &root.join("data"),
            &src_tool.join("image-gen"),
            &tgt_tool,
            "claude-code",
            crate::hub::LinkMode::Link,
        )
        .unwrap();

        // 扫描顺序：claude（junction 落点）在前，codex（真源）在后 —— 反向场景
        let skills = live(scan_all_skills(&[
            target(&tgt_tool, "claude-code", "Claude Code"),
            target(&src_tool, "codex", "Codex CLI"),
        ]));
        assert_eq!(skills.len(), 3);

        let junction = skills
            .iter()
            .find(|s| s.id == "claude-code|image-gen")
            .unwrap();
        assert!(junction.hub_linked, "claude 侧 junction 落点必须被识别");
        assert!(
            !junction.is_representative,
            "junction 落点恒不为代表，即使扫描序在前"
        );

        let origin = skills
            .iter()
            .find(|s| s.id == "codex|image-gen")
            .unwrap();
        assert!(
            origin.is_representative,
            "真源（codex）必须为代表，技能库不被折叠"
        );
        assert_eq!(
            origin.other_sources,
            vec!["claude-code".to_string()],
            "落点作为 other_sources 跟随真源"
        );

        let _ = junction::delete(tgt_tool.join("image-gen"));
        let _ = fs::remove_dir_all(&root);
        assert!(!link.id.is_empty());
    }

    /// 内置内部技能（如 shark-skill-creator）不得出现在任何扫描结果里：
    /// builtin 来源扫描排除；用户自有同名目录（不在内置目录下）不受影响。
    #[test]
    fn internal_skill_dirs_hidden_from_scan() {
        let bu = crate::config::builtin_skills_dir();
        assert!(
            crate::config::is_internal_skill_dir(&bu.join("shark-skill-creator")),
            "内置目录下的内部技能必须被识别"
        );
        assert!(
            !crate::config::is_internal_skill_dir(&bu.join("skills-shark-packs")),
            "白名单外的内置技能不受影响"
        );

        // 用户自有同名目录（不在内置目录下）照常注册
        let root = tmp_root("internal");
        let tool = root.join("claude");
        fs::create_dir_all(&tool).unwrap();
        make_skill(&tool, "shark-skill-creator");
        let skills = live(scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]));
        assert!(
            skills.iter().any(|s| s.folder_name == "shark-skill-creator"),
            "用户自有同名技能必须照常可见"
        );
        let _ = fs::remove_dir_all(&root);

        // builtin 来源整体扫描：内部技能不可见、公开技能可见
        let bu_skills = live(scan_all_skills(&[ScanTarget {
            path: bu.to_string_lossy().to_string(),
            label: "示例技能".to_string(),
            tool_id: "builtin".to_string(),
        }]));
        assert!(
            !bu_skills.iter().any(|s| s.folder_name == "shark-skill-creator"),
            "builtin 扫描不得包含内部技能"
        );
        assert!(
            bu_skills.iter().any(|s| s.folder_name == "skills-shark-quickstart"),
            "内置公开技能保持可见（quickstart 是现役内置示例）: {:?}",
            bu_skills.iter().map(|s| &s.folder_name).collect::<Vec<_>>()
        );
    }

    /// 历史残留自愈：meta 已是新键但 md 仍旧名（过去 rekey rename 失败被吞）→
    /// 扫描时正向重算旧键并改名，状态恢复「已翻译」。
    #[test]
    fn repair_legacy_md_under_new_meta_key() {
        // 独立临时数据目录，绝不碰真实用户数据
        let data = tmp_root("repair-data");
        crate::config::set_data_dir_for_test(data.clone());
        let tdir = data.join("translations");
        fs::create_dir_all(&tdir).unwrap();

        let root = tmp_root("repair");
        let tool = root.join("t");
        make_skill(&tool, "repair-me");

        // 先扫一次拿新 id 与 legacy 路径哈希（此时 meta 为空，无副作用）
        let first = scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]);
        let sk = first.iter().find(|s| s.folder_name == "repair-me").unwrap();
        let new_id = sk.id.clone();
        let legacy = make_skill_id(&sk.source_path);
        let src_json = sk.source_path.replace('\\', "\\\\");

        // 构造残留态：meta 新键 + md 旧名
        fs::write(
            data.join("translations.json"),
            format!(
                "{{\"{}\":{{\"source_path\":\"{}\",\"scan_label\":\"Claude Code\",\"source_hash\":\"h\",\"translated_at\":\"t\",\"model\":\"m\",\"title_zh\":\"修\",\"source_deleted\":false}}}}",
                new_id, src_json
            ),
        )
        .unwrap();
        fs::write(
            tdir.join(format!("{}.md", legacy)),
            "<!-- anchor:original -->\nx\n<!-- anchor:translated -->\n修复译文",
        )
        .unwrap();

        let skills = live(scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]));
        let sk = skills.iter().find(|s| s.folder_name == "repair-me").unwrap();
        assert!(sk.has_translation, "repair pass 应恢复已翻译状态");
        assert!(!sk.translation_lost);
        assert!(
            tdir.join(translations::md_filename(&new_id)).exists(),
            "md 应改名到新键（percent-encode 文件名）"
        );

        let _ = fs::remove_dir_all(&root);
    }

    /// 层级结构树：技能包 -> 子技能 -> 附属资源，逐层与磁盘结构一一对应。
    #[test]
    fn scan_tree_reflects_pack_hierarchy() {
        let root = tmp_root("tree");
        let tool = root.join("t");
        let pack = tool.join("shark-dsh");
        fs::create_dir_all(&pack).unwrap();
        fs::write(
            pack.join("SKILL.md"),
            "---\nname: shark-dsh\ndescription: 全局说明\n---\nbody",
        )
        .unwrap();
        for sub in ["shark-browser", "shark-task-plan"] {
            make_skill(&pack, sub);
            fs::create_dir_all(pack.join(sub).join("references")).unwrap();
            fs::write(pack.join(sub).join("references").join("notes.md"), "x").unwrap();
        }
        fs::create_dir_all(pack.join("scripts")).unwrap();
        fs::write(pack.join("scripts").join("helper.py"), "print(1)").unwrap();

        let text = scan_tree_text(&[target(&tool, "claude-code", "Claude Code")]);
        assert!(text.contains("shark-dsh"), "根级技能包必须出现: {text}");
        assert!(text.contains("技能包"), "父级包须标注技能包: {text}");
        assert!(text.contains("shark-browser"), "子技能必须归属包下: {text}");
        assert!(text.contains("shark-task-plan"), "子技能必须归属包下: {text}");
        assert!(text.contains("SKILL.md"), "技能说明文件必须列出: {text}");
        assert!(text.contains("helper.py"), "脚本资源必须列出: {text}");
        assert!(text.contains("notes.md"), "引用文档必须列出: {text}");

        // PLAN-19：结构化树 skill_id 须与 scan_all_skills 的 id 对拍，文件 abs_path 须真实存在。
        let trees = scan_library_tree(&[target(&tool, "claude-code", "Claude Code")]);
        assert_eq!(trees.len(), 1);
        let ids = live(scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]))
            .into_iter()
            .map(|s| s.id)
            .collect::<std::collections::HashSet<_>>();
        let pack_node = trees[0]
            .root
            .children
            .iter()
            .find(|c| c.name == "shark-dsh")
            .unwrap();
        assert_eq!(pack_node.skill_id.as_deref(), Some("claude-code|shark-dsh"));
        assert!(
            ids.contains(pack_node.skill_id.as_ref().unwrap()),
            "包 skill_id 须与 skills 列表一致"
        );
        let sub = pack_node
            .children
            .iter()
            .find(|c| c.name == "shark-browser")
            .unwrap();
        assert_eq!(
            sub.skill_id.as_deref(),
            Some("claude-code|shark-dsh/shark-browser")
        );
        assert!(ids.contains(sub.skill_id.as_ref().unwrap()));
        let skill_md_file = pack_node.files.iter().find(|f| f.name == "SKILL.md").unwrap();
        assert!(
            std::path::Path::new(&skill_md_file.abs_path).is_file(),
            "abs_path 须真实存在"
        );

        let _ = fs::remove_dir_all(&root);
    }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

pub fn scan_all_skills(targets: &[ScanTarget]) -> Vec<Skill> {
    let mut translation_meta = translations::load_all_meta();
    let mut skills: Vec<Skill> = Vec::new();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rekeys: Vec<(String, String)> = Vec::new();

    // disjoint 扫描根集合：所有扫描根（跨工具）的归一化绝对路径。
    // 祖先根遍历到某条嵌套根边界时停止下钻（scan_dir_recursive 内跳过）。
    let skip_roots: std::collections::HashSet<std::path::PathBuf> = targets
        .iter()
        .map(|t| norm_abs(Path::new(&t.path)))
        .collect();

    for t in targets {
        let base = Path::new(&t.path);
        if !base.is_dir() {
            continue;
        }

        // 从 depth=1、collection=None 开始递归
        scan_dir_recursive(
            base,
            1,
            base,
            &t.label,
            &t.tool_id,
            None,
            &translation_meta,
            &skip_roots,
            &mut skills,
            &mut seen_ids,
            &mut rekeys,
        );
    }

    // id 迁移换键落盘，重读 meta 再跑孤儿 pass，避免旧键造成假孤儿
    if !rekeys.is_empty() {
        for (old, new) in &rekeys {
            let _ = translations::rekey(old, new);
        }
        config::debug_log(&format!("id migration rekeys: {:?}", rekeys));
        translation_meta = translations::load_all_meta();
    }

    // B4 代表选取：同工具内不同合集的同名目录是不同技能，不折叠。
    //
    // P8 修正：hub junction（重解析点）落点是「引用指针」，不是真正出处。
    // junction 落点恒不为代表（只要同组跨工具存在非 junction 真源），
    // 避免落点抢占代表位导致真源被折叠隐藏。
    //
    // 副本可见性：真实目录（非 junction）恒为代表——每个工具磁盘上真实存在的
    // 技能都应在该工具分组里可见。Hub copy 模式分发的独立副本是真实文件，
    // 若按「同名取首个为代表」折叠，副本会从技能库与查重中完全消失
    // （表现：复制分发后扫描不到）。故非 junction 一律 is_representative=true；
    // 仅 junction 引用按 P8 规则折叠。
    for i in 0..skills.len() {
        let mut earlier_real_rep: Option<usize> = None;
        let mut others: Vec<String> = Vec::new();
        let mut has_real_source = false; // 同组跨工具是否存在非 junction 真源
        for j in 0..skills.len() {
            if j == i || skills[j].folder_name != skills[i].folder_name {
                continue;
            }
            if skills[j].tool_id != skills[i].tool_id {
                // junction 落点不占代表位、也不计为真源
                if !skills[j].hub_linked && j < i && earlier_real_rep.is_none() {
                    earlier_real_rep = Some(j);
                }
                if !skills[j].hub_linked {
                    has_real_source = true;
                }
                others.push(skills[j].tool_id.clone());
            }
        }
        let rep = if skills[i].hub_linked {
            earlier_real_rep.is_none() && !has_real_source
        } else {
            // 真实目录恒为代表（见上方「副本可见性」注释）：不因同名折叠
            true
        };
        skills[i].is_representative = rep;
        skills[i].other_sources = others;
    }

    // 加入已翻译但源文件已删除的孤儿记录
    for (sid, tmeta) in &translation_meta {
        if !seen_ids.contains(sid) {
            // 内置内部技能的历史记录不进入孤儿列表（纯内部资源，PLAN-17）
            if let Some(parent) = Path::new(&tmeta.source_path).parent() {
                if crate::config::is_internal_skill_dir(parent) {
                    continue;
                }
            }
            let folder = tmeta
                .source_path
                .rsplit(['/', '\\'])
                .nth(1)
                .unwrap_or(sid)
                .to_string();
            skills.push(Skill {
                id: sid.clone(),
                name: folder.clone(),
                folder_name: folder,
                description: String::new(),
                emoji: None,
                scan_label: tmeta.scan_label.clone(),
                source_path: tmeta.source_path.clone(),
                skill_dir: tmeta.source_path.clone(),
                tool_id: sid.split('|').next().unwrap_or("").to_string(),
                is_representative: true,
                other_sources: vec![],
                hub_linked: false,
                hub_link_id: None,
                has_translation: translations::read_translated_content(sid)
                    .map(|t| !t.trim().is_empty())
                    .unwrap_or(false),
                translation_lost: translations::read_translated_content(sid)
                    .map(|t| t.trim().is_empty())
                    .unwrap_or(true),
                title_zh: tmeta.title_zh.clone(),
                description_zh: extract_description_zh(sid),
                source_deleted: true,
                parent_collection: None,
            });
        }
    }

    skills
}

// ---------------------------------------------------------------------------
// 技能库层级结构树（扫描可视化：完整还原真实文件系统层级）
// 与 scan_dir_recursive 的「注册」职责解耦：本树无条件（限深）下钻，
// 呈现「扫描根 → 技能包/合集 → 子技能 → 资源文件及类型」。
// 「有 SKILL.md 即停」语义不适用：目标是让用户逐层比对磁盘真实结构。
// ---------------------------------------------------------------------------

/// 树最大下钻深度（目录层级；.git / node_modules 已跳过，限深避免深依赖树拖慢）。
const TREE_MAX_DEPTH: usize = 8;
/// 树遍历跳过的目录名（与 authoring 的 SKIP_DIRS 对齐）。
const TREE_SKIP_DIRS: [&str; 2] = [".git", "node_modules"];

/// 技能单元直属资源文件的类型归类。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanTreeFile {
    /// 文件名（不含路径）
    pub name: String,
    /// 相对扫描根的完整相对路径（`/` 分隔）
    pub rel: String,
    /// 类型：skill-doc / markdown / script / resource / other
    pub kind: String,
    /// 文件绝对路径（供前端读取/写盘定位）
    pub abs_path: String,
}

/// 一个目录节点：技能单元、技能包、或集合容器。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanTreeNode {
    /// 目录名（相对父级）
    pub name: String,
    /// 相对扫描根的路径（根节点为空串）
    pub rel: String,
    /// 目录自身含 SKILL.md（技能单元）
    pub is_skill: bool,
    /// 技能包容器：自身是技能且直接子目录含技能
    pub is_pack: bool,
    /// 技能单元稳定 id（is_skill 时，规则同 register_skill：`tool_id|rel`），供前端映射回 Skill
    pub skill_id: Option<String>,
    /// SKILL.md frontmatter `name`（is_skill 时）
    pub skill_name: Option<String>,
    /// SKILL.md frontmatter `description`（包级全局说明）
    pub description: Option<String>,
    /// 该单元直属文件（不含子目录）
    pub files: Vec<ScanTreeFile>,
    /// 子目录（子技能 / 普通集合容器）
    pub children: Vec<ScanTreeNode>,
}

fn classify_file_kind(rel: &str) -> &'static str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    if name.eq_ignore_ascii_case("SKILL.md") {
        return "skill-doc";
    }
    let lower = rel.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        return "markdown";
    }
    let ext = name
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "py" | "sh" | "bash" | "zsh" | "js" | "mjs" | "cjs" | "ts" | "mts" | "cts"
        | "ps1" | "rb" | "go" | "rs" | "pl" | "lua" | "php" | "bat" | "cmd" => "script",
        _ => "resource",
    }
}

fn build_tree_recursive(
    dir: &Path,
    rel: String,
    depth: usize,
    tool_id: &str,
    skip_roots: &std::collections::HashSet<std::path::PathBuf>,
) -> ScanTreeNode {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| rel.clone());

    let skill_md = dir.join("SKILL.md");
    let is_skill = skill_md.is_file();
    // 技能包：自身是技能且直接子目录也含技能（与被记忆实践同源的一级前瞻探测）。
    let is_pack = is_skill && has_skill_children(dir);
    // 技能单元稳定 id（与 register_skill 的 `tool_id|rel` 同源，保证与 skills 列表对拍）。
    let skill_id = if is_skill && !rel.is_empty() {
        Some(format!("{}|{}", tool_id, rel))
    } else {
        None
    };
    let dir_abs = clean_path_str(dir);
    let (skill_name, description) = if is_skill {
        match fs::read_to_string(&skill_md) {
            Ok(text) => {
                let fm = parse_frontmatter(&text);
                (fm.get("name").cloned(), fm.get("description").cloned())
            }
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    let mut files: Vec<ScanTreeFile> = Vec::new();
    let mut dirs: Vec<(std::path::PathBuf, String)> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                dirs.push((path, fname));
            } else {
                let file_rel = if rel.is_empty() {
                    fname.clone()
                } else {
                    format!("{}/{}", rel, fname)
                };
                files.push(ScanTreeFile {
                    name: fname.clone(),
                    rel: file_rel.clone(),
                    kind: classify_file_kind(&file_rel).to_string(),
                    abs_path: format!("{}/{}", dir_abs, fname),
                });
            }
        }
    }
    files.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    dirs.sort_by(|a, b| a.1.to_ascii_lowercase().cmp(&b.1.to_ascii_lowercase()));

    let mut children = Vec::new();
    if depth < TREE_MAX_DEPTH {
        for (path, fname) in dirs {
            if TREE_SKIP_DIRS.contains(&fname.as_str()) {
                continue;
            }
            if crate::config::is_internal_skill_dir(&path) {
                continue;
            }
            // disjoint(D7)：嵌套扫描根不重复下钻，子树由内根独立呈现。
            if skip_roots.contains(&norm_abs(&path)) {
                continue;
            }
            let child_rel = if rel.is_empty() {
                fname.clone()
            } else {
                format!("{}/{}", rel, fname)
            };
            children.push(build_tree_recursive(&path, child_rel, depth + 1, tool_id, skip_roots));
        }
    }

    ScanTreeNode {
        name,
        rel,
        is_skill,
        is_pack,
        skill_id,
        skill_name,
        description,
        files,
        children,
    }
}

fn kind_label_cn(kind: &str) -> &'static str {
    match kind {
        "skill-doc" => "技能说明",
        "markdown" => "文档",
        "script" => "脚本",
        "resource" => "资源",
        _ => "文件",
    }
}

fn node_annotation(node: &ScanTreeNode) -> String {
    if node.is_skill {
        let unit = node.skill_name.as_deref().unwrap_or(&node.name);
        if node.is_pack {
            format!("技能包 · {unit}")
        } else {
            format!("技能 · {unit}")
        }
    } else {
        "集合".to_string()
    }
}

enum TreeItem<'a> {
    File(&'a ScanTreeFile),
    Dir(&'a ScanTreeNode),
}

impl<'a> TreeItem<'a> {
    fn label(&self) -> &str {
        match self {
            TreeItem::File(f) => &f.name,
            TreeItem::Dir(d) => &d.name,
        }
    }
}

fn print_dir_subtree(out: &mut String, node: &ScanTreeNode, prefix: &str, is_last: bool) {
    let connector = if is_last { "└─ " } else { "├─ " };
    out.push_str(&format!(
        "{prefix}{connector}{}\\  [{}]",
        node.name,
        node_annotation(node)
    ));
    if let Some(d) = &node.description {
        let trimmed = d.trim();
        if !trimmed.is_empty() {
            let count = trimmed.chars().count();
            let short: String = trimmed.chars().take(60).collect();
            if count > 60 {
                out.push_str(&format!(" — {short}…"));
            } else {
                out.push_str(&format!(" — {short}"));
            }
        }
    }
    out.push('\n');

    let child_prefix = format!("{prefix}{}", if is_last { "   " } else { "│  " });
    render_children(out, node, &child_prefix);
}

fn render_children(out: &mut String, node: &ScanTreeNode, prefix: &str) {
    let mut items: Vec<TreeItem> = Vec::with_capacity(node.files.len() + node.children.len());
    items.extend(node.files.iter().map(TreeItem::File));
    items.extend(node.children.iter().map(TreeItem::Dir));
    items.sort_by(|a, b| a.label().to_ascii_lowercase().cmp(&b.label().to_ascii_lowercase()));

    let last_idx = items.len().saturating_sub(1);
    for (i, item) in items.iter().enumerate() {
        let is_last = i == last_idx;
        match item {
            TreeItem::File(f) => {
                let connector = if is_last { "└─ " } else { "├─ " };
                out.push_str(&format!(
                    "{prefix}{connector}{}  [{}]",
                    f.name,
                    kind_label_cn(&f.kind)
                ));
                out.push('\n');
            }
            TreeItem::Dir(d) => print_dir_subtree(out, d, prefix, is_last),
        }
    }
}

/// 生成技能库层级结构树文本（供前端展示 / 日志校验磁盘映射）。
pub fn scan_tree_text(targets: &[ScanTarget]) -> String {
    let skip_roots: std::collections::HashSet<std::path::PathBuf> = targets
        .iter()
        .map(|t| norm_abs(Path::new(&t.path)))
        .collect();

    let mut out = String::new();
    for t in targets {
        let base = Path::new(&t.path);
        if !base.is_dir() {
            continue;
        }
        out.push_str(&format!(
            "{}  ({} / {})\n",
            clean_path_str(base),
            t.label,
            t.tool_id
        ));
        let root = build_tree_recursive(base, String::new(), 0, &t.tool_id, &skip_roots);
        render_children(&mut out, &root, "");
        out.push('\n');
    }
    out
}

/// 文件管理器浏览器（PLAN-19）单个扫描根的结构化树包装。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryTreeRoot {
    /// 扫描根显示名（工具 label）
    pub label: String,
    /// 工具注册表 id
    pub tool_id: String,
    /// 扫描根绝对路径
    pub path: String,
    /// 该扫描根的目录树
    pub root: ScanTreeNode,
}

/// 生成技能库文件管理器树（每个启用扫描根一棵），供 LibraryExplorer 渲染。
pub fn scan_library_tree(targets: &[ScanTarget]) -> Vec<LibraryTreeRoot> {
    let skip_roots: std::collections::HashSet<std::path::PathBuf> = targets
        .iter()
        .map(|t| norm_abs(Path::new(&t.path)))
        .collect();

    let mut out = Vec::new();
    for t in targets {
        let base = Path::new(&t.path);
        if !base.is_dir() {
            continue;
        }
        let root = build_tree_recursive(base, String::new(), 0, &t.tool_id, &skip_roots);
        out.push(LibraryTreeRoot {
            label: t.label.clone(),
            tool_id: t.tool_id.clone(),
            path: clean_path_str(base),
            root,
        });
    }
    out
}
