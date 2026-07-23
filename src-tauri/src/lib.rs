mod adb;
mod export;
mod logcat;

use tauri::{Manager, WebviewWindowBuilder};

fn ensure_main_window(app: &mut tauri::App) -> tauri::Result<()> {
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            let Some(config) = app.config().app.windows.iter().find(|window| window.label == "main") else {
                return Ok(());
            };
            WebviewWindowBuilder::from_config(app.handle(), config)?.build()?
        }
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(logcat::LogcatState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            ensure_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            adb::detect_adb,
            adb::list_adb_devices,
            adb::list_adb_processes,
            export::export_logs,
            logcat::start_logcat,
            logcat::stop_logcat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
