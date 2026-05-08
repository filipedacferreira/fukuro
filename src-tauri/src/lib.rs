mod commands;
mod db;
mod utils;

use db::DbState;
use std::sync::Mutex;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Tauri plugins: file opener (open URLs, paths) and native file dialogs.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Resolve the platform-specific app data directory:
            // macOS → ~/Library/Application Support/io.fukuro/
            // Windows → %APPDATA%\io.fukuro\
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("could not get app data dir");

            // Create the directory if it doesn't exist yet (first launch).
            std::fs::create_dir_all(&app_dir)?;

            // Open (or create) the SQLite database file, then run schema migrations.
            let db_path = app_dir.join("fukuro.db");
            let conn = rusqlite::Connection::open(&db_path).expect("could not open database");
            db::initialize(&conn).expect("could not initialize database");

            // Register the DB connection as managed state.
            // Wrapping in Mutex makes it safe to share across threads.
            // Any command that declares `state: tauri::State<DbState>` gets this injected.
            app.manage(DbState(Mutex::new(conn)));

            // Build the native OS menu bar.
            let menu = MenuBuilder::new(app)
                .item(
                    &SubmenuBuilder::new(app, "Fukurō")
                        // PredefinedMenuItem handles platform-specific behaviour automatically
                        // (e.g. About on macOS shows the system About panel).
                        .item(&PredefinedMenuItem::about(app, None, None)?)
                        .separator()
                        .item(&PredefinedMenuItem::quit(app, None)?)
                        .build()?,
                )
                .item(
                    &SubmenuBuilder::new(app, "Edit")
                        .item(&PredefinedMenuItem::undo(app, None)?)
                        .item(&PredefinedMenuItem::redo(app, None)?)
                        .separator()
                        .item(&PredefinedMenuItem::cut(app, None)?)
                        .item(&PredefinedMenuItem::copy(app, None)?)
                        .item(&PredefinedMenuItem::paste(app, None)?)
                        .item(&PredefinedMenuItem::select_all(app, None)?)
                        .build()?,
                )
                .item(
                    &SubmenuBuilder::new(app, "Tools")
                        // MenuItemBuilder::with_id gives this item a string ID so we can
                        // match it in on_menu_event below.
                        .item(
                            &MenuItemBuilder::with_id("clear_cache", "Clear Thumbnail Cache")
                                .build(app)?,
                        )
                        .build()?,
                )
                .build()?;

            app.set_menu(menu)?;

            Ok(())
        })
        // Called on the main thread whenever the user clicks a menu item.
        .on_menu_event(|app, event| {
            if event.id() == "clear_cache" {
                let app = app.clone();
                // Spawn a background thread so the main thread isn't blocked
                // while we delete files.
                std::thread::spawn(move || {
                    if let Ok(data_dir) = app.path().app_data_dir() {
                        let thumb_dir = data_dir.join("thumbnails");
                        if thumb_dir.exists() {
                            // remove_dir_all deletes the folder and everything inside it.
                            let _ = std::fs::remove_dir_all(&thumb_dir);
                        }
                    }
                });
            }
        })
        // Register every Rust function that the frontend can call via invoke().
        // Both this registration AND the #[tauri::command] attribute on each function
        // are required — one without the other won't work.
        .invoke_handler(tauri::generate_handler![
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::delete_project,
            commands::projects::rename_project,
            commands::projects::get_project_chapters,
            commands::chapters::reorder_chapters,
            commands::chapters::rename_chapter,
            commands::images::get_chapter_images,
            commands::thumbnails::generate_chapter_thumbnails_stream,
            commands::thumbnails::clear_thumbnail_cache,
            commands::images::toggle_exclusion,
            commands::images::hard_delete_image,
            commands::export::create_cbz,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
