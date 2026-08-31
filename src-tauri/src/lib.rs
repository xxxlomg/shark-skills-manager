mod authoring;
mod commands;
mod config;
mod dedup;
mod git;
mod hub;
mod import;
mod lib_delete;
mod merge;
mod pack;
mod publish;
mod scanner;
mod shelf;
mod summaries;
mod tags;
mod translations;
mod validate;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // PLAN-04：数据目录外部化（AppData）+ 旧 _data 一次性迁移
            config::init_data_dir(app.handle());
            // PLAN-06 §7.2：tmp/ 是 App 私有启动即清区，不放任何持久数据
            config::cleanup_tmp_dir();
            // 会话事件日志保留策略：启动清理超过 30 天的旧会话（活跃会话不受影响）
            config::cleanup_stale_sessions(30);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ---- 扫描 / 读取（数据基础） ----
            commands::scan_skills,
            commands::scan_skills_tree,
            commands::scan_library_tree,
            commands::read_skill_file,
            commands::read_file_base64,
            commands::read_translation,
            commands::write_translation,
            // ---- 配置 ----
            commands::load_config,
            commands::get_llm_api_key,
            commands::save_config,
            commands::get_download_dir,
            commands::set_download_dir,
            commands::set_ai_hint_dismissed,
            commands::sync_deleted,
            // ---- Hub 引用（模块 B；PLAN-06 §2.10） ----
            commands::hub_linkable_tools,
            commands::hub_link_skill,
            // 注：PLAN-06 文档命令名 hub_unlink，实现名按语义注册为 hub_unlink_skill
            commands::hub_unlink_skill,
            commands::hub_convert_to_copy,
            commands::hub_links_status,
            commands::hub_set_display_name,
            commands::hub_rescan,
            commands::hub_list_tools,
            commands::probe_tool_dir,
            commands::hub_add_tool,
            commands::hub_update_tool,
            commands::hub_remove_tool,
            // ---- 标签 / 用途速览（PLAN-13） ----
            commands::load_tags,
            commands::save_tags,
            commands::load_summaries,
            commands::write_summary,
            // ---- 查重 / 合并（PLAN-13 M；PLAN-15/16） ----
            commands::detect_duplicates,
            commands::dup_resolve,
            commands::dup_resolve_many,
            commands::smart_merge_apply,
            commands::list_merge_history,
            commands::undo_merge,
            // ---- URL / Zip 导入（PLAN-04） ----
            commands::preview_zip_import,
            commands::commit_zip_import,
            commands::preview_url_import,
            commands::commit_url_import,
            // ---- Pack 管线（PLAN-05） ----
            commands::packs_list,
            commands::pack_create,
            commands::pack_export,
            commands::pack_import,
            commands::pack_install_preview,
            commands::pack_install_commit,
            commands::create_skill_folder,
            commands::add_folder_root,
            commands::pack_delete,
            commands::pack_rename,
            // ---- 校验 / 创作（模块 C；PLAN-06 §3 / PLAN-07/17） ----
            commands::skill_validate,
            commands::skill_new,
            authoring::skill_creator_info,
            authoring::skill_creator_read,
            authoring::skill_write_file,
            authoring::skill_commit_draft,
            authoring::openai_yaml_generate,
            authoring::claude_md_generate,
            authoring::skill_edit_frontmatter,
            authoring::skill_rename,
            authoring::skill_list_files,
            authoring::skill_delete_file,
            authoring::skill_import_file,
            // ---- 批量删除 / 解除引用（PLAN-18） ----
            lib_delete::skill_batch_delete_check,
            lib_delete::skill_batch_delete_apply,
            // ---- Git 分发（模块 A；PLAN-06 §1） ----
            // 注：repo_browse / repo_import_commit 的实现实体在 shelf.rs（仓库导入侧）
            commands::git_status,
            commands::repo_browse,
            commands::repo_import_commit,
            commands::repo_setup,
            commands::publish_pack,
            commands::save_publish_repo,
            // ---- 会话事件溯源（PLAN-17） ----
            commands::session_append,
            commands::session_load,
            commands::session_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
