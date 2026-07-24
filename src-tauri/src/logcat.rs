use crate::adb::detect_adb_impl;
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

const LOGCAT_BATCH_EVENT: &str = "logcat://batch";
const LOGCAT_ERROR_EVENT: &str = "logcat://error";
const LOGCAT_STOPPED_EVENT: &str = "logcat://stopped";
const BATCH_SIZE: usize = 80;
const BATCH_INTERVAL_MS: u64 = 120;

#[derive(Default)]
pub struct LogcatState {
    processes: Mutex<HashMap<String, LogcatProcess>>,
}

struct LogcatProcess {
    session_id: String,
    child: Child,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogcatSessionInfo {
    session_id: String,
    serial: String,
    running: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogcatBatchPayload {
    session_id: String,
    lines: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogcatMessagePayload {
    session_id: String,
    message: String,
}

fn session_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn emit_batch(app: &AppHandle, session_id: &str, lines: &mut Vec<String>) {
    if lines.is_empty() {
        return;
    }

    let payload = LogcatBatchPayload {
        session_id: session_id.to_string(),
        lines: std::mem::take(lines),
    };
    let _ = app.emit(LOGCAT_BATCH_EVENT, payload);
}

fn emit_message(app: &AppHandle, event: &str, session_id: &str, message: impl Into<String>) {
    let _ = app.emit(
        event,
        LogcatMessagePayload {
            session_id: session_id.to_string(),
            message: message.into(),
        },
    );
}

fn stop_process(process: &mut LogcatProcess) {
    let _ = process.child.kill();
    let _ = process.child.wait();
}

pub fn stop_all_logcat_processes(state: &LogcatState) -> Result<(), String> {
    let mut processes = state.processes.lock().map_err(|error| error.to_string())?;
    for process in processes.values_mut() {
        stop_process(process);
    }
    processes.clear();
    Ok(())
}

fn spawn_stdout_reader(
    app: AppHandle,
    session_id: String,
    stdout: impl std::io::Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut batch = Vec::with_capacity(BATCH_SIZE);
        let mut last_emit = Instant::now();

        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
                    if !trimmed.is_empty() {
                        batch.push(trimmed);
                    }

                    if batch.len() >= BATCH_SIZE
                        || last_emit.elapsed() >= Duration::from_millis(BATCH_INTERVAL_MS)
                    {
                        emit_batch(&app, &session_id, &mut batch);
                        last_emit = Instant::now();
                    }
                }
                Err(error) => {
                    emit_message(&app, LOGCAT_ERROR_EVENT, &session_id, error.to_string());
                    break;
                }
            }
        }

        emit_batch(&app, &session_id, &mut batch);
        emit_message(&app, LOGCAT_STOPPED_EVENT, &session_id, "logcat stopped");
    });
}

fn spawn_stderr_reader(
    app: AppHandle,
    session_id: String,
    stderr: impl std::io::Read + Send + 'static,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let message = line.trim();
            if !message.is_empty() {
                emit_message(&app, LOGCAT_ERROR_EVENT, &session_id, message.to_string());
            }
        }
    });
}

#[tauri::command]
pub fn start_logcat(
    app: AppHandle,
    state: State<'_, LogcatState>,
    serial: String,
) -> Result<LogcatSessionInfo, String> {
    let serial = serial.trim().to_string();
    if serial.is_empty() {
        return Err("请先选择一个在线设备".to_string());
    }

    let adb = detect_adb_impl(&app);
    if !adb.is_available() {
        return Err(adb.install_hint().to_string());
    }

    let adb_path = adb
        .binary_path()
        .ok_or_else(|| adb.install_hint().to_string())?
        .to_string();

    let session_id = session_id();
    let mut child = Command::new(adb_path)
        .args(["-s", &serial, "logcat", "-v", "threadtime", "-T", "1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 logcat stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 logcat stderr".to_string())?;

    spawn_stdout_reader(app.clone(), session_id.clone(), stdout);
    spawn_stderr_reader(app, session_id.clone(), stderr);

    state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            session_id.clone(),
            LogcatProcess {
                session_id: session_id.clone(),
                child,
            },
        );

    Ok(LogcatSessionInfo {
        session_id,
        serial,
        running: true,
    })
}

#[tauri::command]
pub fn stop_logcat(
    state: State<'_, LogcatState>,
    session_id: Option<String>,
) -> Result<LogcatSessionInfo, String> {
    let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) else {
        stop_all_logcat_processes(&state)?;
        return Ok(LogcatSessionInfo {
            session_id: String::new(),
            serial: String::new(),
            running: false,
        });
    };

    let Some(mut process) = state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&session_id)
    else {
        return Ok(LogcatSessionInfo {
            session_id: String::new(),
            serial: String::new(),
            running: false,
        });
    };

    let session_id = process.session_id.clone();
    stop_process(&mut process);

    Ok(LogcatSessionInfo {
        session_id,
        serial: String::new(),
        running: false,
    })
}
