mod commands;
mod db;

use db::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("could not get app data dir");
            std::fs::create_dir_all(&app_dir)?;

            let db_path = app_dir.join("fukuro.db");
            let conn = rusqlite::Connection::open(&db_path).expect("could not open database");
            db::initialize(&conn).expect("could not initialize database");

            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::delete_project,
            commands::projects::get_project_chapters,
            commands::chapters::reorder_chapters,
            commands::chapters::rename_chapter,
            commands::images::get_chapter_images,
            commands::images::toggle_exclusion,
            commands::images::hard_delete_image,
            commands::export::create_cbz,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
