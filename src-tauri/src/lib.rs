mod adb;
mod export;
mod logcat;
mod transfer;

use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder, WindowEvent};

const APP_CLOSE_REQUESTED_EVENT: &str = "app://close-requested";

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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_main_window_after(app: AppHandle, delay_ms: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(delay_ms));
        show_main_window(&app);
    });
}

#[tauri::command]
fn close_app(app: AppHandle, state: State<'_, logcat::LogcatState>) -> Result<(), String> {
    logcat::stop_all_logcat_processes(&state)?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(logcat::LogcatState::default())
        .manage(transfer::TabTransferState::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit(APP_CLOSE_REQUESTED_EVENT, ());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            ensure_main_window(app)?;
            show_main_window_after(app.handle().clone(), 250);
            show_main_window_after(app.handle().clone(), 1200);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            adb::detect_adb,
            adb::list_adb_devices,
            adb::list_adb_processes,
            export::export_logs,
            export::reveal_export_file,
            transfer::clear_tab_transfer,
            transfer::put_tab_transfer,
            transfer::take_tab_transfer,
            close_app,
            logcat::start_logcat,
            logcat::stop_logcat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
