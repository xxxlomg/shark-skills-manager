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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_skills,
            commands::scan_skills_tree,
            commands::scan_library_tree,
            commands::read_skill_file,
            commands::read_file_base64,
            commands::read_translation,
            commands::write_translation,
            commands::load_config,
            commands::get_llm_api_key,
            commands::save_config,
            commands::get_download_dir,
            commands::set_download_dir,
            commands::set_ai_hint_dismissed,
            commands::sync_deleted,
            commands::hub_linkable_tools,
            commands::hub_link_skill,
            commands::hub_unlink_skill,
            commands::hub_convert_to_copy,
            commands::hub_links_status,
            commands::hub_set_display_name,
            commands::load_tags,
            commands::save_tags,
            commands::load_summaries,
            commands::write_summary,
            commands::detect_duplicates,
            commands::dup_resolve,
            commands::dup_resolve_many,
            commands::smart_merge_apply,
            commands::list_merge_history,
            commands::undo_merge,
            commands::hub_rescan,
            commands::hub_list_tools,
            commands::probe_tool_dir,
            commands::hub_add_tool,
            commands::hub_update_tool,
            commands::hub_remove_tool,
            commands::preview_zip_import,
            commands::commit_zip_import,
            commands::preview_url_import,
            commands::commit_url_import,
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
            commands::skill_validate,
            commands::skill_new,
            lib_delete::skill_batch_delete_check,
            lib_delete::skill_batch_delete_apply,
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
            commands::git_status,
            commands::repo_browse,
            commands::repo_import_commit,
            commands::repo_setup,
            commands::publish_pack,
            commands::save_publish_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
