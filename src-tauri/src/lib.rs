mod commands;
mod db;
mod utils;

use db::DbState;
use std::sync::Mutex;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

// #[cfg_attr(mobile, ...)] is a conditional attribute: it applies the inner attribute
// only when compiling for a mobile target (iOS/Android). On desktop builds this line
// has no effect. tauri::mobile_entry_point marks the function as the app entry point
// for mobile platforms, which use a different startup model than desktop.
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

            // Holds the active folder watcher (see commands/watch.rs). Starts empty —
            // populated below once we know whether a library root is already configured.
            app.manage(commands::watch::WatcherState(Mutex::new(None)));

            // If the user already configured a library root in a previous session, start
            // watching it immediately so the projects list is live as soon as it's shown.
            // No-op (returns Ok without starting anything) if no root is configured yet —
            // that happens instead from `set_library_root` once the user picks one.
            commands::watch::start_library_watcher(&app.handle())
                .expect("could not start library watcher");

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
            commands::cover::set_project_cover,
            commands::cover::fetch_anilist_cover,
            commands::cover::remove_project_cover,
            commands::watch::start_watching_project,
            commands::watch::stop_watching_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
