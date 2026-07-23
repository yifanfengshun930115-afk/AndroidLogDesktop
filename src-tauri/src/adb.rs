use serde::Serialize;
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

const ADB_INSTALL_HINT: &str = "未找到 ADB。请通过 Android Studio SDK Manager 或 Google Platform-Tools 安装 Android SDK Platform-Tools，并设置 ADB_PATH 或 ANDROID_HOME；也可以把内置 ADB 放到 resources/platform-tools/<platform>/adb。";

#[derive(Clone)]
struct AdbCandidate {
    path: String,
    source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbInfo {
    available: bool,
    path: Option<String>,
    source: Option<String>,
    version: Option<String>,
    checked_paths: Vec<String>,
    install_hint: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbDevice {
    serial: String,
    state: String,
    description: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbCommandResult {
    ok: bool,
    stdout: String,
    stderr: String,
    error: Option<String>,
    devices: Option<Vec<AdbDevice>>,
    adb: Option<AdbInfo>,
}

impl AdbInfo {
    pub fn is_available(&self) -> bool {
        self.available
    }

    pub fn binary_path(&self) -> Option<&str> {
        self.path.as_deref()
    }

    pub fn install_hint(&self) -> &str {
        &self.install_hint
    }
}

fn adb_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    }
}

fn bundled_platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-x64"
        }
    } else if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_arch = "aarch64") {
        "linux-arm64"
    } else {
        "linux-x64"
    }
}

fn candidate(path: Option<String>, source: &str) -> Vec<AdbCandidate> {
    path.filter(|value| !value.trim().is_empty())
        .map(|path| {
            vec![AdbCandidate {
                path,
                source: source.to_string(),
            }]
        })
        .unwrap_or_default()
}

fn candidate_from_sdk_root(sdk_root: Option<String>, source: &str) -> Vec<AdbCandidate> {
    sdk_root
        .filter(|value| !value.trim().is_empty())
        .map(|root| {
            candidate(
                Some(
                    Path::new(&root)
                        .join("platform-tools")
                        .join(adb_file_name())
                        .to_string_lossy()
                        .to_string(),
                ),
                source,
            )
        })
        .unwrap_or_default()
}

fn resource_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn get_path_candidates(app: &AppHandle) -> Vec<AdbCandidate> {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_default();
    let bundled_root = resource_dir(app)
        .join("platform-tools")
        .join(bundled_platform_name());

    let mut candidates = vec![];
    candidates.extend(candidate(env::var("ADB_PATH").ok(), "ADB_PATH"));
    candidates.extend(candidate(
        Some(
            bundled_root
                .join(adb_file_name())
                .to_string_lossy()
                .to_string(),
        ),
        "bundled platform-tools",
    ));
    candidates.extend(candidate_from_sdk_root(
        env::var("ANDROID_HOME").ok(),
        "ANDROID_HOME",
    ));
    candidates.extend(candidate_from_sdk_root(
        env::var("ANDROID_SDK_ROOT").ok(),
        "ANDROID_SDK_ROOT",
    ));

    if cfg!(target_os = "macos") {
        candidates.push(AdbCandidate {
            path: Path::new(&home)
                .join("Library")
                .join("Android")
                .join("sdk")
                .join("platform-tools")
                .join("adb")
                .to_string_lossy()
                .to_string(),
            source: "Android Studio default SDK".to_string(),
        });
        candidates.push(AdbCandidate {
            path: "/opt/homebrew/bin/adb".to_string(),
            source: "Homebrew".to_string(),
        });
        candidates.push(AdbCandidate {
            path: "/usr/local/bin/adb".to_string(),
            source: "Homebrew".to_string(),
        });
    } else if cfg!(target_os = "windows") {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            candidates.push(AdbCandidate {
                path: Path::new(&local_app_data)
                    .join("Android")
                    .join("Sdk")
                    .join("platform-tools")
                    .join("adb.exe")
                    .to_string_lossy()
                    .to_string(),
                source: "Android Studio default SDK".to_string(),
            });
        }
        if let Ok(program_files) = env::var("PROGRAMFILES") {
            candidates.push(AdbCandidate {
                path: Path::new(&program_files)
                    .join("Android")
                    .join("platform-tools")
                    .join("adb.exe")
                    .to_string_lossy()
                    .to_string(),
                source: "Program Files".to_string(),
            });
        }
    } else {
        candidates.push(AdbCandidate {
            path: Path::new(&home)
                .join("Android")
                .join("Sdk")
                .join("platform-tools")
                .join("adb")
                .to_string_lossy()
                .to_string(),
            source: "Android Studio default SDK".to_string(),
        });
        candidates.push(AdbCandidate {
            path: "/usr/bin/adb".to_string(),
            source: "system PATH".to_string(),
        });
        candidates.push(AdbCandidate {
            path: "/usr/local/bin/adb".to_string(),
            source: "system PATH".to_string(),
        });
    }

    candidates.push(AdbCandidate {
        path: "adb".to_string(),
        source: "PATH".to_string(),
    });

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|item| !item.path.is_empty() && seen.insert(item.path.clone()))
        .collect()
}

fn parse_version(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

fn run_binary(binary: &str, args: &[&str]) -> Result<(String, String), String> {
    Command::new(binary)
        .args(args)
        .output()
        .map_err(|error| error.to_string())
        .and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() {
                Ok((stdout, stderr))
            } else {
                Err(if stderr.trim().is_empty() {
                    format!("ADB command exited with status {}", output.status)
                } else {
                    stderr
                })
            }
        })
}

pub fn detect_adb_impl(app: &AppHandle) -> AdbInfo {
    let candidates = get_path_candidates(app);
    let mut checked_paths = vec![];

    for item in candidates {
        checked_paths.push(item.path.clone());
        if item.path != "adb" && fs::metadata(&item.path).is_err() {
            continue;
        }

        if let Ok((stdout, _stderr)) = run_binary(&item.path, &["version"]) {
            return AdbInfo {
                available: true,
                path: Some(item.path),
                source: Some(item.source),
                version: parse_version(&stdout),
                checked_paths,
                install_hint: ADB_INSTALL_HINT.to_string(),
            };
        }
    }

    AdbInfo {
        available: false,
        path: None,
        source: None,
        version: None,
        checked_paths,
        install_hint: ADB_INSTALL_HINT.to_string(),
    }
}

fn run_adb(app: &AppHandle, args: &[&str]) -> AdbCommandResult {
    let adb = detect_adb_impl(app);
    let Some(path) = adb.path.clone().filter(|_| adb.available) else {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: None,
            adb: Some(adb),
        };
    };

    match run_binary(&path, args) {
        Ok((stdout, stderr)) => AdbCommandResult {
            ok: true,
            stdout,
            stderr,
            error: None,
            devices: None,
            adb: Some(adb),
        },
        Err(error) => AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(error),
            devices: None,
            adb: Some(adb),
        },
    }
}

fn parse_devices(stdout: &str) -> Vec<AdbDevice> {
    stdout
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next().unwrap_or_default().to_string();
            let state = parts.next().unwrap_or_default().to_string();
            let description = parts.collect::<Vec<_>>().join(" ");
            AdbDevice {
                serial,
                state,
                description,
            }
        })
        .collect()
}

#[tauri::command]
pub fn detect_adb(app: AppHandle) -> AdbInfo {
    detect_adb_impl(&app)
}

#[tauri::command]
pub fn list_adb_devices(app: AppHandle) -> AdbCommandResult {
    let mut result = run_adb(&app, &["devices", "-l"]);
    result.devices = Some(if result.ok {
        parse_devices(&result.stdout)
    } else {
        vec![]
    });
    result
}
