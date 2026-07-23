use serde::Serialize;
use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    file_path: String,
    size_bytes: u64,
}

fn downloads_dir() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join("Downloads")
}

fn export_file_name() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("android-log-desktop-{seconds}.txt")
}

fn export_logs_to_dir(
    content: &str,
    dir: PathBuf,
    file_name: String,
) -> Result<ExportResult, String> {
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let file_path = dir.join(file_name);
    fs::write(&file_path, content).map_err(|error| error.to_string())?;
    let size_bytes = fs::metadata(&file_path)
        .map_err(|error| error.to_string())?
        .len();

    Ok(ExportResult {
        file_path: file_path.to_string_lossy().to_string(),
        size_bytes,
    })
}

#[tauri::command]
pub fn export_logs(content: String) -> Result<ExportResult, String> {
    if content.trim().is_empty() {
        return Err("没有可导出的日志".to_string());
    }

    export_logs_to_dir(&content, downloads_dir(), export_file_name())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_export_content_to_file() {
        let dir = env::temp_dir().join(format!(
            "android-log-desktop-export-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);

        let result =
            export_logs_to_dir("line one\nline two\n", dir.clone(), "logs.txt".to_string())
                .expect("export should be written");

        assert_eq!(result.size_bytes, 18);
        assert_eq!(
            fs::read_to_string(&result.file_path).expect("export file should be readable"),
            "line one\nline two\n"
        );

        let _ = fs::remove_dir_all(dir);
    }
}
