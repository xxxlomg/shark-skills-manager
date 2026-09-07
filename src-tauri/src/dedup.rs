//! 工作流 M 阶段 2：查重检测（本地快路径，无 LLM）+ 手动处置（备份 + 回收站）。
//!
//! 检测算法（简化版）：
//! 1. 全等检测：SKILL.md 正文（剥 frontmatter）SHA-256 全等但 id 不同 → 「内容全等」组；
//! 2. 同名检测：归一化名称相等（docker-ps / Docker_PS → dockerps）→ 「同名」组；
//!    不再做编辑距离/描述重叠的加权相似度，也不展示百分比（Boss：同名即相似）。
//! 3. 并查集聚组；junction 落点与其出处（canonical source_path 相同）永不组对；
//! 4. Hub copy 落点（台账 kind=Copy 的 target）从查重候选排除——副本安装不是「重复技能」，
//!    查重与 Hub 分发的语义边界（冲突点 C1）；技能库可见性不受影响（scanner 代表选取不变）。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::scanner::Skill;

/// 疑似重复组的成员快照（DupPanel/MergeWorkbench 渲染所需的最小集）。
#[derive(Debug, Clone, Serialize)]
pub struct DupMember {
    pub skill_id: String,
    pub name: String,
    pub title_zh: String,
    pub emoji: Option<String>,
    pub scan_label: String,
    pub tool_id: String,
    pub skill_dir: String,
    /// canonical SKILL.md 文件路径（junction 穿透后 = 出处文件）
    pub source_path: String,
    pub hub_linked: bool,
    pub has_translation: bool,
    /// R4：归一化正文 SHA-256（hex）；读失败/空正文为 None——前端按它聚合「内容变体」
    pub body_hash: Option<String>,
    /// R4：正文（剥 frontmatter、行尾归一）字符数
    pub body_len: usize,
    /// R4：SKILL.md 修改时间（epoch 秒）；读失败为 0
    pub mtime: i64,
}

/// 疑似重复组（kind: "identical"=内容全等 / "same_name"=同名）。
#[derive(Debug, Clone, Serialize)]
pub struct DupGroup {
    pub id: String,
    pub kind: String,
    /// 仅用于排序：identical=1.0，same_name=0.5；前端不展示百分比
    pub score: f32,
    /// 人话理由（规则模板生成）
    pub reason: String,
    pub members: Vec<DupMember>,
}

// ---------------------------------------------------------------------------
// 文本相似度原语
// ---------------------------------------------------------------------------

/// 名称归一化：小写 + 去 `-_.` 与空白（docker-ps / Docker_PS → dockerps）
fn normalize_name(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, '-' | '_' | '.' | ' ' | '\t'))
        .flat_map(|c| c.to_lowercase())
        .collect()
}



/// 剥 frontmatter 后的正文（trim）；无 frontmatter 则全文。
fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    if let Some(rest) = trimmed.strip_prefix("---") {
        // 找结束围栏（行首 ---）
        if let Some(pos) = rest.find("\n---") {
            let after = &rest[pos + 4..];
            let after = after.strip_prefix('\r').unwrap_or(after);
            return after.trim();
        }
    }
    trimmed.trim_end()
}

/// 行尾/BOM 归一化：CRLF/CR → LF、去 BOM。
/// 修复（Boss 实测）：导入 zip（LF）与本地工具目录（CRLF）是同一份技能，
/// 不归一化则 strip_frontmatter 找不到 \r\n--- 围栏、hash 也不同 →
/// 本应「内容全等」被降级成「相近」，前端 diff 整篇全红。
fn normalize_newlines(content: &str) -> String {
    let t = content.strip_prefix('\u{feff}').unwrap_or(content);
    t.replace("\r\n", "\n").replace('\r', "\n")
}

/// 正文 SHA-256（hex）；空正文返回 None（避免两个空壳技能误判全等）
fn hash_body(content: &str) -> Option<String> {
    let normalized = normalize_newlines(content);
    let body = strip_frontmatter(&normalized);
    if body.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(body.as_bytes());
    Some(hex::encode(&hasher.finalize()))
}

/// 正文字符数（剥 frontmatter + 行尾归一，与 hash_body 同口径）。
fn body_len(content: &str) -> usize {
    strip_frontmatter(&normalize_newlines(content)).chars().count()
}

/// SKILL.md 修改时间（epoch 秒）；读失败为 0。
fn mtime_of(path: &str) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 简易 hex 编码（与 scanner 内实现同款，避免引 crate）
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

// ---------------------------------------------------------------------------
// 正文哈希增量缓存（弱主机收益：重复查重跳过未变化文件的读取）
// ---------------------------------------------------------------------------

type BodyCache = HashMap<String, BodyCacheEntry>;

#[derive(Serialize, Deserialize, Clone)]
struct BodyCacheEntry {
    mtime: i64,
    body_hash: Option<String>,
    body_len: usize,
}

#[cfg(not(test))]
fn body_cache_path() -> PathBuf {
    crate::config::get_data_dir().join("dedup-cache.json")
}

#[cfg(not(test))]
fn load_body_cache() -> BodyCache {
    let p = body_cache_path();
    if !p.is_file() {
        return BodyCache::default();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg(test)]
fn load_body_cache() -> BodyCache {
    BodyCache::default()
}

#[cfg(not(test))]
fn save_body_cache(cache: &BodyCache) {
    if let Ok(json) = serde_json::to_string(cache) {
        let _ = std::fs::write(body_cache_path(), json);
    }
}

#[cfg(test)]
fn save_body_cache(_cache: &BodyCache) {}

// ---------------------------------------------------------------------------
// 并查集
// ---------------------------------------------------------------------------

struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
        }
    }
    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.parent[rb] = ra;
        }
    }
}

// ---------------------------------------------------------------------------
// 检测主入口
// ---------------------------------------------------------------------------

/// 查重检测。输入为一次全量扫描结果；仅对代表卡且源未删除的技能做比对。
/// 复杂度从 O(n²) 降为 O(n)（平均）：正文哈希/归一化名一次性预计算，
/// 按 body_hash / 归一化名分桶，桶内做小规模并查集聚组；正文哈希带 mtime 增量缓存。
pub fn detect(skills: &[Skill]) -> Vec<DupGroup> {
    let cands: Vec<&Skill> = skills
        .iter()
        .filter(|s| s.is_representative && !s.source_deleted && !s.skill_dir.is_empty())
        .collect();
    let n = cands.len();
    if n < 2 {
        return Vec::new();
    }

    // 1) 一次 O(n)：读正文 + 哈希 + 长度 + 归一化名 + mtime；mtime 命中缓存则跳过读。
    let mut cache = load_body_cache();
    let mut body_hashes: Vec<Option<String>> = Vec::with_capacity(n);
    let mut body_lens: Vec<usize> = Vec::with_capacity(n);
    let mut norm_names: Vec<String> = Vec::with_capacity(n);
    let mut mtimes: Vec<i64> = Vec::with_capacity(n);
    for s in &cands {
        let mtime = mtime_of(&s.source_path);
        mtimes.push(mtime);
        let hit = cache.get(&s.source_path).filter(|e| e.mtime == mtime);
        if let Some(e) = hit {
            body_hashes.push(e.body_hash.clone());
            body_lens.push(e.body_len);
        } else {
            let c = std::fs::read_to_string(&s.source_path).ok();
            match &c {
                Some(text) => {
                    let h = hash_body(text);
                    let l = body_len(text);
                    body_hashes.push(h.clone());
                    body_lens.push(l);
                    cache.insert(
                        s.source_path.clone(),
                        BodyCacheEntry { mtime, body_hash: h, body_len: l },
                    );
                }
                None => {
                    body_hashes.push(None);
                    body_lens.push(0);
                }
            }
        }
        norm_names.push(normalize_name(&s.name));
    }
    save_body_cache(&cache);

    let mut uf = UnionFind::new(n);
    let mut identical_pairs: HashSet<(usize, usize)> = HashSet::new();

    // 2) 全等分桶（body_hash → 索引），桶内并查集 union；跳过 junction/出处同源
    let mut by_hash: HashMap<&str, Vec<usize>> = HashMap::new();
    for i in 0..n {
        if let Some(h) = &body_hashes[i] {
            by_hash.entry(h.as_str()).or_default().push(i);
        }
    }
    for bucket in by_hash.values() {
        for a in 0..bucket.len() {
            for b in (a + 1)..bucket.len() {
                let (i, j) = (bucket[a], bucket[b]);
                if cands[i].source_path == cands[j].source_path {
                    continue;
                }
                uf.union(i, j);
                identical_pairs.insert((i.min(j), i.max(j)));
            }
        }
    }

    // 3) 同名分桶（归一化名 → 索引），桶内 union；跳过已全等对与同源
    let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
    for i in 0..n {
        by_name.entry(norm_names[i].as_str()).or_default().push(i);
    }
    for bucket in by_name.values() {
        for a in 0..bucket.len() {
            for b in (a + 1)..bucket.len() {
                let (i, j) = (bucket[a], bucket[b]);
                if cands[i].source_path == cands[j].source_path {
                    continue;
                }
                if identical_pairs.contains(&(i.min(j), i.max(j))) {
                    continue;
                }
                uf.union(i, j);
            }
        }
    }

    // 4) 聚组
    let mut by_root: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = uf.find(i);
        by_root.entry(r).or_default().push(i);
    }

    let mut groups: Vec<DupGroup> = Vec::new();
    for (_, member_idx) in by_root {
        if member_idx.len() < 2 {
            continue;
        }
        let idx_set: HashSet<usize> = member_idx.iter().copied().collect();
        let has_identical = identical_pairs
            .iter()
            .any(|(a, b)| idx_set.contains(a) && idx_set.contains(b));

        let kind = if has_identical { "identical" } else { "same_name" };
        let score = if has_identical { 1.0 } else { 0.5 };
        let reason = if has_identical {
            "SKILL.md 正文完全相同（frontmatter 可能微差）——疑似同一份技能散落在多处。".to_string()
        } else {
            "同名技能出现在不同目录——可能是同一技能的副本或微调版本，请对比后处理。".to_string()
        };

        let mut members: Vec<DupMember> = member_idx
            .iter()
            .map(|&i| DupMember {
                skill_id: cands[i].id.clone(),
                name: cands[i].name.clone(),
                title_zh: cands[i].title_zh.clone(),
                emoji: cands[i].emoji.clone(),
                scan_label: cands[i].scan_label.clone(),
                tool_id: cands[i].tool_id.clone(),
                skill_dir: cands[i].skill_dir.clone(),
                source_path: cands[i].source_path.clone(),
                hub_linked: cands[i].hub_linked,
                has_translation: cands[i].has_translation,
                body_hash: body_hashes[i].clone(),
                body_len: body_lens[i],
                mtime: mtimes[i],
            })
            .collect();
        members.sort_by(|a, b| a.skill_id.cmp(&b.skill_id));

        groups.push(DupGroup {
            id: String::new(), // 排序后统一编号
            kind: kind.to_string(),
            score,
            reason,
            members,
        });
    }

    // 5) 排序：全等优先，其次分数降序、成员数降序
    groups.sort_by(|a, b| {
        let ka = if a.kind == "identical" { 0 } else { 1 };
        let kb = if b.kind == "identical" { 0 } else { 1 };
        ka.cmp(&kb)
            .then(b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal))
            .then(b.members.len().cmp(&a.members.len()))
    });
    for (i, g) in groups.iter_mut().enumerate() {
        g.id = format!("g-{:04}", i + 1);
    }
    groups
}

// ---------------------------------------------------------------------------
// Hub 台账感知（冲突点 C1：copy 落点不是「重复技能」）
// ---------------------------------------------------------------------------

/// 判段某技能目录是否为 Hub 账本中的 copy 落点（kind=Copy 的 target）。
///
/// canonicalize 归一（UNC 前缀/大小写/符号链接穿透）后与台账 target 比对，
/// 风格与 resolve_keep 的出处比对一致；目录不存在时返回 false（不误伤）。
/// Move 模式在账本中归一为 Copy（hub.rs 的 Move 记账语义），同样命中。
pub fn is_ledger_copy_target(skill_dir: &str, ledger: &crate::hub::LinksLedger) -> bool {
    let canon = std::fs::canonicalize(Path::new(skill_dir)).unwrap_or_default();
    if canon.as_os_str().is_empty() {
        return false;
    }
    ledger.links.iter().any(|l| {
        l.mode == crate::hub::LedgerMode::Copy
            && std::fs::canonicalize(Path::new(&l.target))
                .map(|p| p == canon)
                .unwrap_or(false)
    })
}

// ---------------------------------------------------------------------------
// 手动处置：保留一份，另一份备份后进回收站（阶段 2「保存左边/保存右边」）
// ---------------------------------------------------------------------------

/// 保留 keep_id、处置 remove_id（备份 → 回收站 → 清标签挂载）。
/// 返回备份目录路径。任何守卫失败都在破坏性操作之前中止。
pub fn resolve_keep(keep_id: &str, remove_id: &str) -> Result<String, String> {
    if keep_id == remove_id {
        return Err("不能对同一个技能做处置".to_string());
    }
    let cfg = crate::config::load_config();
    let targets = crate::config::scan_targets_from_tools(&cfg.tools);
    let skills = crate::scanner::scan_all_skills(&targets);
    let keep = skills
        .iter()
        .find(|s| s.id == keep_id)
        .ok_or_else(|| "要保留的技能未找到（可能已被删除），请重新查重".to_string())?;
    let remove = skills
        .iter()
        .find(|s| s.id == remove_id)
        .ok_or_else(|| "要删除的技能未找到（可能已被删除），请重新查重".to_string())?;

    if remove.source_deleted {
        return Err("要删除的技能源目录已不存在，无需处理".to_string());
    }
    let remove_dir = PathBuf::from(&remove.skill_dir);
    if !remove_dir.is_dir() {
        return Err(format!("要删除的技能目录不存在：{}", remove.skill_dir));
    }

    // 地雷 1：junction 落点禁止进回收站
    if remove.hub_linked {
        return Err("该技能是 Hub 引用的 junction 落点，不能直接进回收站。请先在 Hub 解除引用，或改为保留它、处置另一侧。".to_string());
    }
    // 地雷 2：作为账本引用出处的技能删除会让引用断链
    let ledger = crate::hub::load_ledger(&crate::config::get_data_dir());
    let remove_canon = std::fs::canonicalize(&remove_dir).unwrap_or_else(|_| remove_dir.clone());
    let referencing = ledger
        .links
        .iter()
        .filter(|l| {
            std::fs::canonicalize(Path::new(&l.source))
                .map(|p| p == remove_canon)
                .unwrap_or(false)
        })
        .count();
    if referencing > 0 {
        return Err(format!(
            "该技能是 {} 条 Hub 引用的出处，删除后引用会断链。请先在 Hub 处理这些引用，或改为保留它。",
            referencing
        ));
    }

    // 备份先行（安全网：任何写操作之前完成；失败 → 整体中止）
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_root = crate::config::get_data_dir().join("merge-backups");
    std::fs::create_dir_all(&backup_root)
        .map_err(|e| format!("创建备份目录失败：{e}"))?;
    let safe_name: String = remove
        .folder_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
        .collect();
    let backup_dir = backup_root.join(format!("{ts}-dup-{safe_name}"));
    crate::import::copy_dir_recursive(&remove_dir, &backup_dir)
        .map_err(|e| format!("备份失败，处置已中止：{e}"))?;

    // 回收站语义（绝不物理删除；失败 → 备份已在，明确报错）
    trash::delete(&remove_dir).map_err(|e| {
        format!(
            "移入回收站失败：{e}（备份已保存于 {}，可手动恢复）",
            backup_dir.display()
        )
    })?;

    // 标签：先快照（供历史撤销还原），再清被处置侧挂载（孤儿摘要不 GC）
    let mut tags_data = crate::tags::load_tags();
    let keep_tags = tags_data
        .assignments
        .get(&format!("skill:{keep_id}"))
        .cloned()
        .unwrap_or_default();
    let remove_tags = tags_data
        .assignments
        .get(&format!("skill:{remove_id}"))
        .cloned()
        .unwrap_or_default();
    if tags_data
        .assignments
        .remove(&format!("skill:{remove_id}"))
        .is_some()
    {
        let _ = crate::tags::save_tags(&tags_data);
    }

    // 追加合并历史：处置也是合并工作流的一部分，需可撤销（写失败忽略，不阻断处置）
    crate::merge::record_dispose(keep, remove, &backup_dir, keep_tags, remove_tags);

    crate::config::debug_log(&format!(
        "dup_resolve: keep={keep_id} remove={remove_id} backup={}",
        backup_dir.display()
    ));
    Ok(backup_dir.to_string_lossy().to_string())
}

/// 批量处置（N 个重复的「保留基准 + 其余处置」）：保留 keep_id，逐个把 remove_ids
/// 备份后进回收站并清标签挂载。任一失败即中止（已处置的仍保留在回收站，可恢复）。
/// 返回各备份目录路径（与 remove_ids 同序）。
pub fn resolve_keep_many(keep_id: &str, remove_ids: Vec<String>) -> Result<Vec<String>, String> {
    if remove_ids.is_empty() {
        return Err("没有要处置的技能".to_string());
    }
    if remove_ids.iter().any(|id| id.as_str() == keep_id) {
        return Err("不能处置保留基准本身".to_string());
    }
    let mut backups = Vec::with_capacity(remove_ids.len());
    for remove_id in &remove_ids {
        let backup = resolve_keep(keep_id, remove_id)?;
        backups.push(backup);
    }
    crate::config::debug_log(&format!(
        "dup_resolve_many: keep={keep_id} removed={}",
        remove_ids.len()
    ));
    Ok(backups)
}

// ---------------------------------------------------------------------------
// 单测
// ---------------------------------------------------------------------------

#[cfg(test)]
mod dedup_tests {
    use super::*;
    use crate::scanner::Skill;

    fn skill(id: &str, name: &str, title_zh: &str, desc: &str) -> Skill {
        Skill {
            id: id.to_string(),
            name: name.to_string(),
            folder_name: name.to_string(),
            description: desc.to_string(),
            emoji: None,
            scan_label: "test".to_string(),
            source_path: format!("/tmp/{id}/SKILL.md"),
            skill_dir: format!("/tmp/{id}"),
            tool_id: "test".to_string(),
            is_representative: true,
            other_sources: vec![],
            hub_linked: false,
            hub_link_id: None,
            has_translation: false,
            translation_lost: false,
            title_zh: title_zh.to_string(),
            description_zh: String::new(),
            source_deleted: false,
            parent_collection: None,
        }
    }

    #[test]
    fn normalize_name_strips_separators_and_case() {
        assert_eq!(normalize_name("docker-ps"), normalize_name("Docker_PS"));
        assert_ne!(normalize_name("docker-ps"), normalize_name("docker-list"));
    }

    #[test]
    fn strip_frontmatter_and_hash() {
        let a = "---\nname: x\ndescription: d\n---\nbody text";
        let b = "---\nname: y\ndescription: other\n---\nbody text";
        assert_eq!(hash_body(a), hash_body(b), "frontmatter 微差不影响正文哈希");
        assert!(hash_body("---\nname: x\n---\n   ").is_none(), "空正文不成组");
        assert_ne!(hash_body(a), hash_body("---\nname: x\n---\nbody text 2"));
    }

    #[test]
    fn crlf_lf_same_content_hashes_equal() {
        // Boss 实测场景：导入 zip（LF）vs 本地工具目录（CRLF）同一份技能
        let lf = "---\nname: x\ndescription: d\n---\nbody line\n\nmore";
        let crlf = lf.replace('\n', "\r\n");
        assert_eq!(
            hash_body(&crlf),
            hash_body(lf),
            "CRLF/LF 同内容必须全等（行尾归一 + 围栏识别）"
        );
        let bom = format!("{}{lf}", char::from_u32(0xfeff).unwrap());
        assert_eq!(hash_body(&bom), hash_body(lf), "BOM 不影响哈希");
    }

    #[test]
    fn same_name_pair_grouped() {
        // 同名（归一化后相等）即成组；不同名（docker-ps-v2）不再成组。
        let skills = vec![
            skill("t|docker-ps", "docker-ps", "容器列表", "list docker containers with status"),
            skill("u|docker_ps_copy", "Docker_PS", "容器列表副本", "a different description entirely"),
            skill("t|docker_ps_v2", "docker-ps-v2", "容器列表查询", "list docker containers with status and ports"),
            skill("t|translator", "translator", "翻译", "translate text between languages"),
        ];
        let groups = detect(&skills);
        assert_eq!(groups.len(), 1, "只有同名 docker 对成组");
        let g = &groups[0];
        assert_eq!(g.kind, "same_name");
        assert_eq!(g.members.len(), 2);
        assert!(!g.reason.contains('%'), "同名理由不展示百分比");
        assert!(g.id.starts_with("g-"));
    }

    #[test]
    fn junction_source_pair_skipped() {
        // canonical source_path 相同 = junction 落点与其出处，绝不组对
        let mut a = skill("t|origin", "shared", "", "same body");
        let mut b = skill("u|linked", "shared", "", "same body");
        a.source_path = "/tmp/origin/SKILL.md".to_string();
        b.source_path = "/tmp/origin/SKILL.md".to_string(); // junction 穿透后同值
        b.hub_linked = true;
        let groups = detect(&[a, b]);
        assert!(groups.is_empty(), "junction 与出处不是重复");
    }

    #[test]
    fn copy_target_filtered_from_ledger() {
        // 冲突点 C1：台账 kind=Copy 的 target（分发副本）命中；Link 落点与不存在目录不命中
        let tmp = tempfile::tempdir().unwrap();
        let copy_dir = tmp.path().join("copy-loc");
        let other_dir = tmp.path().join("other");
        std::fs::create_dir_all(&copy_dir).unwrap();
        std::fs::create_dir_all(&other_dir).unwrap();
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
                mk("l1", crate::hub::LedgerMode::Copy, &copy_dir.to_string_lossy()),
                mk("l2", crate::hub::LedgerMode::Link, &other_dir.to_string_lossy()),
            ],
        };
        assert!(
            is_ledger_copy_target(&copy_dir.to_string_lossy(), &ledger),
            "Copy 落点必须命中"
        );
        assert!(
            !is_ledger_copy_target(&other_dir.to_string_lossy(), &ledger),
            "Link 落点不算 copy 副本"
        );
        assert!(
            !is_ledger_copy_target("/nonexistent/definitely-missing", &ledger),
            "不存在目录不误伤"
        );
    }

    #[test]
    fn non_representative_and_deleted_excluded() {
        let mut a = skill("t|a", "same-name", "同一个技能", "same description text");
        let mut b = skill("u|b", "same-name", "同一个技能", "same description text");
        b.is_representative = false;
        let mut c = skill("v|c", "same-name", "同一个技能", "same description text");
        c.source_deleted = true;
        let groups = detect(&[a.clone(), b, c]);
        assert!(groups.is_empty(), "非代表/源删除不参与");
        a.id = "w|d".to_string(); // 防 unused warning
        let _ = a;
    }

    #[test]
    fn identical_content_groups_via_disk() {
        // 真实落盘验证全等检测：两个目录同正文不同 frontmatter
        let tmp = tempfile::tempdir().unwrap();
        let da = tmp.path().join("a");
        let db = tmp.path().join("b");
        std::fs::create_dir_all(&da).unwrap();
        std::fs::create_dir_all(&db).unwrap();
        std::fs::write(
            da.join("SKILL.md"),
            "---\nname: a\ndescription: one\n---\nshared body content",
        )
        .unwrap();
        std::fs::write(
            db.join("SKILL.md"),
            "---\nname: b\ndescription: two\n---\nshared body content",
        )
        .unwrap();

        let mut a = skill("t|a", "alpha", "", "");
        let mut b = skill("t|b", "beta", "", "");
        a.source_path = da.join("SKILL.md").to_string_lossy().to_string();
        b.source_path = db.join("SKILL.md").to_string_lossy().to_string();
        let groups = detect(&[a, b]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].kind, "identical");
        assert!((groups[0].score - 1.0).abs() < 1e-6);
        assert!(groups[0].reason.contains("完全相同"));
    }

    #[test]
    fn same_name_different_body_not_identical() {
        // 同名但正文不同 → same_name（不是 identical），且理由不含百分比。
        let tmp = tempfile::tempdir().unwrap();
        let da = tmp.path().join("a");
        let db = tmp.path().join("b");
        std::fs::create_dir_all(&da).unwrap();
        std::fs::create_dir_all(&db).unwrap();
        std::fs::write(
            da.join("SKILL.md"),
            "---\nname: same-name\ndescription: 完全相同的描述\n---\nbody A 内容不同",
        )
        .unwrap();
        std::fs::write(
            db.join("SKILL.md"),
            "---\nname: same-name\ndescription: 完全相同的描述\n---\nbody B 内容不同",
        )
        .unwrap();

        let mut a = skill("t|a", "same-name", "相同的标题", "完全相同的描述");
        let mut b = skill("t|b", "same-name", "相同的标题", "完全相同的描述");
        a.source_path = da.join("SKILL.md").to_string_lossy().to_string();
        b.source_path = db.join("SKILL.md").to_string_lossy().to_string();
        let groups = detect(&[a, b]);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert_eq!(g.kind, "same_name", "正文不同 → 同名组，不是全等");
        assert!(!g.reason.contains('%'), "同名理由不展示百分比：{}", g.reason);
    }
}
