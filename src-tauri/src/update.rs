use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashSet,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const RELEASE_REPO_URL: &str = "https://github.com/yifanfengshun930115-afk/AndroidLogDesktop";
const RELEASE_LATEST_URL: &str =
    "https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/releases/latest";
const RELEASE_DOWNLOAD_PATH_PREFIX: &str =
    "/yifanfengshun930115-afk/AndroidLogDesktop/releases/download/";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetInfo {
    name: String,
    browser_download_url: String,
    size_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    ok: bool,
    current_version: String,
    latest_version: Option<String>,
    has_update: bool,
    release_url: String,
    asset_name: Option<String>,
    asset_download_url: Option<String>,
    asset_size_bytes: Option<u64>,
    checked_at_epoch_ms: u64,
    message: String,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenResult {
    ok: bool,
    message: String,
    error: Option<String>,
}

#[tauri::command]
pub fn check_for_updates() -> UpdateCheckResult {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let checked_at_epoch_ms = now_ms();

    match fetch_latest_release_info() {
        Ok((latest_version, release_url, assets)) => {
            let asset = select_release_asset(&assets, std::env::consts::OS, std::env::consts::ARCH);
            let version_order = compare_versions(&latest_version, &current_version);
            let has_update = version_order > 0;
            let message = if has_update {
                if let Some(asset) = &asset {
                    format!("可下载适配当前系统的安装包：{}。", asset.name)
                } else {
                    "发现新版本，但没有找到适配当前系统的安装包。".to_string()
                }
            } else if version_order < 0 {
                format!(
                    "当前版本 v{} 高于最新 Release {}。",
                    current_version, latest_version
                )
            } else {
                format!("当前版本 v{} 已是最新。", current_version)
            };

            UpdateCheckResult {
                ok: true,
                current_version,
                latest_version: Some(latest_version),
                has_update,
                release_url,
                asset_name: asset.as_ref().map(|asset| asset.name.clone()),
                asset_download_url: asset
                    .as_ref()
                    .map(|asset| asset.browser_download_url.clone()),
                asset_size_bytes: asset.as_ref().and_then(|asset| asset.size_bytes),
                checked_at_epoch_ms,
                message,
                error: None,
            }
        }
        Err(error) => UpdateCheckResult {
            ok: false,
            current_version,
            latest_version: None,
            has_update: false,
            release_url: RELEASE_LATEST_URL.to_string(),
            asset_name: None,
            asset_download_url: None,
            asset_size_bytes: None,
            checked_at_epoch_ms,
            message: "更新检查失败。".to_string(),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> ExternalOpenResult {
    let trimmed = url.trim();
    if !is_allowed_release_url(trimmed) {
        return ExternalOpenResult {
            ok: false,
            message: "外部链接不在允许范围内。".to_string(),
            error: Some("只允许打开当前项目的 GitHub Release 链接。".to_string()),
        };
    }

    match open_url(trimmed) {
        Ok(()) => ExternalOpenResult {
            ok: true,
            message: "已在浏览器中打开链接。".to_string(),
            error: None,
        },
        Err(error) => ExternalOpenResult {
            ok: false,
            message: format!("打开链接失败：{error}"),
            error: Some(error),
        },
    }
}

fn hidden_command(path: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new(path);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(path)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn fetch_latest_release_info() -> Result<(String, String, Vec<ReleaseAssetInfo>), String> {
    let (final_url, latest_html) = fetch_text(RELEASE_LATEST_URL)?;
    let latest_version = extract_release_tag_from_url(&final_url)
        .or_else(|| extract_release_tag_from_html(&latest_html))
        .ok_or_else(|| "未能从 GitHub Release 页面解析最新版本。".to_string())?;
    let release_url = format!("{}/releases/tag/{}", RELEASE_REPO_URL, latest_version);
    let assets_url = format!(
        "{}/releases/expanded_assets/{}",
        RELEASE_REPO_URL, latest_version
    );
    let (_, assets_html) = fetch_text(&assets_url)?;
    let assets = parse_release_assets(&assets_html);
    Ok((latest_version, release_url, assets))
}

fn fetch_text(url: &str) -> Result<(String, String), String> {
    const FINAL_URL_MARKER: &str = "\n__ANDROID_LOG_FINAL_URL__:";
    let write_out = format!("{FINAL_URL_MARKER}%{{url_effective}}");
    let output = hidden_command("curl")
        .args([
            "-fsSL",
            "--http1.1",
            "--connect-timeout",
            "8",
            "--max-time",
            "15",
            "--retry",
            "1",
            "--retry-delay",
            "1",
            "-A",
            concat!("AndroidLogDesktop/", env!("CARGO_PKG_VERSION")),
            "-H",
            "Accept: text/html,application/xhtml+xml",
        ])
        .arg("-w")
        .arg(write_out)
        .arg(url)
        .output()
        .map_err(|error| format!("无法执行 curl：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "GitHub 页面请求失败，curl 退出码 {:?}。",
                output.status.code()
            )
        } else {
            format!("GitHub 页面请求失败：{stderr}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if let Some(marker_index) = stdout.rfind(FINAL_URL_MARKER) {
        let text = stdout[..marker_index].to_string();
        let final_url = stdout[marker_index + FINAL_URL_MARKER.len()..]
            .trim()
            .to_string();
        Ok((final_url, text))
    } else {
        Ok((url.to_string(), stdout))
    }
}

fn extract_release_tag_from_url(url: &str) -> Option<String> {
    let marker = "/releases/tag/";
    let start = url.find(marker)? + marker.len();
    let tail = &url[start..];
    let end = tail
        .find(|character| matches!(character, '?' | '#' | '/'))
        .unwrap_or(tail.len());
    let tag = &tail[..end];
    if tag.is_empty() {
        None
    } else {
        Some(percent_decode(tag))
    }
}

fn extract_release_tag_from_html(html: &str) -> Option<String> {
    let marker = "/releases/tag/";
    let start = html.find(marker)? + marker.len();
    let tail = &html[start..];
    let end = tail
        .find(|character| matches!(character, '"' | '\'' | '<' | '?' | '#' | '/'))
        .unwrap_or(tail.len());
    let tag = &tail[..end];
    if tag.is_empty() {
        None
    } else {
        Some(percent_decode(tag))
    }
}

fn parse_release_assets(fragment: &str) -> Vec<ReleaseAssetInfo> {
    let mut assets = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = 0usize;

    while let Some(relative_index) = fragment[cursor..].find(RELEASE_DOWNLOAD_PATH_PREFIX) {
        let href_start = cursor + relative_index;
        let Some(relative_end) = fragment[href_start..].find('"') else {
            break;
        };
        let href_end = href_start + relative_end;
        let href = html_unescape(&fragment[href_start..href_end]);
        cursor = href_end;

        if !seen.insert(href.clone()) {
            continue;
        }

        let Some(encoded_name) = href.rsplit('/').next() else {
            continue;
        };
        let name = percent_decode(encoded_name);
        if name.is_empty() || name.eq_ignore_ascii_case("source code") {
            continue;
        }

        let browser_download_url = if href.starts_with("https://") {
            href
        } else {
            format!("https://github.com{href}")
        };
        let size_window_end = (href_end + 3200).min(fragment.len());
        let size_bytes = parse_asset_size_bytes(&fragment[href_end..size_window_end]);
        assets.push(ReleaseAssetInfo {
            name,
            browser_download_url,
            size_bytes,
        });
    }

    assets
}

fn parse_asset_size_bytes(text: &str) -> Option<u64> {
    for (unit, multiplier) in [
        (" GB", 1024_f64 * 1024_f64 * 1024_f64),
        (" MB", 1024_f64 * 1024_f64),
        (" KB", 1024_f64),
        (" B", 1_f64),
    ] {
        if let Some(unit_index) = text.find(unit) {
            let before = &text[..unit_index];
            let number = before
                .chars()
                .rev()
                .take_while(|character| character.is_ascii_digit() || *character == '.')
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            if let Ok(value) = number.parse::<f64>() {
                return Some((value * multiplier).round() as u64);
            }
        }
    }
    None
}

fn select_release_asset(
    assets: &[ReleaseAssetInfo],
    os: &str,
    arch: &str,
) -> Option<ReleaseAssetInfo> {
    let normalized_os = os.to_ascii_lowercase();
    let normalized_arch = arch.to_ascii_lowercase();
    let arch_tokens: &[&str] =
        if normalized_arch.contains("aarch64") || normalized_arch.contains("arm64") {
            &["aarch64", "arm64"]
        } else {
            &["x64", "x86_64", "amd64"]
        };

    match normalized_os.as_str() {
        "macos" | "darwin" => find_asset_by_extension_and_arch(assets, ".dmg", arch_tokens),
        "windows" | "win32" => assets
            .iter()
            .find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.ends_with(".exe") && name.contains("setup")
            })
            .or_else(|| {
                assets
                    .iter()
                    .find(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
            })
            .cloned(),
        "linux" => assets
            .iter()
            .find(|asset| asset.name.to_ascii_lowercase().ends_with(".appimage"))
            .or_else(|| {
                assets
                    .iter()
                    .find(|asset| asset.name.to_ascii_lowercase().ends_with(".deb"))
            })
            .cloned(),
        _ => None,
    }
}

fn find_asset_by_extension_and_arch(
    assets: &[ReleaseAssetInfo],
    extension: &str,
    arch_tokens: &[&str],
) -> Option<ReleaseAssetInfo> {
    let candidates = assets
        .iter()
        .filter(|asset| asset.name.to_ascii_lowercase().ends_with(extension))
        .collect::<Vec<_>>();
    candidates
        .iter()
        .find(|asset| {
            let name = asset.name.to_ascii_lowercase();
            arch_tokens.iter().any(|token| name.contains(token))
        })
        .or_else(|| candidates.first())
        .map(|asset| (*asset).clone())
}

fn compare_versions(left: &str, right: &str) -> i8 {
    let left_parts = version_parts(left);
    let right_parts = version_parts(right);
    let length = left_parts.len().max(right_parts.len());
    for index in 0..length {
        let left = left_parts.get(index).copied().unwrap_or(0);
        let right = right_parts.get(index).copied().unwrap_or(0);
        if left > right {
            return 1;
        }
        if left < right {
            return -1;
        }
    }
    0
}

fn version_parts(version: &str) -> Vec<u64> {
    let normalized = version.trim().trim_start_matches(['v', 'V']);
    let numeric = normalized
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>();
    numeric
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn is_allowed_release_url(url: &str) -> bool {
    url == RELEASE_REPO_URL || url.starts_with(&format!("{}/releases/", RELEASE_REPO_URL))
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn html_unescape(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(value) = u8::from_str_radix(hex, 16) {
                    output.push(value);
                    index += 3;
                    continue;
                }
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_tag_from_redirect_url() {
        assert_eq!(
            extract_release_tag_from_url(
                "https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/releases/tag/v0.1.2"
            )
            .as_deref(),
            Some("v0.1.2")
        );
    }

    #[test]
    fn parses_release_assets_from_expanded_fragment() {
        let html = r#"
          <a href="/yifanfengshun930115-afk/AndroidLogDesktop/releases/download/v0.1.2/Android.Log.Desktop_0.1.2_aarch64.dmg">mac</a>
          <span>21.7 MB</span>
          <a href="/yifanfengshun930115-afk/AndroidLogDesktop/releases/download/v0.1.2/Android.Log.Desktop_0.1.2_x64-setup.exe">win</a>
          <span>10.8 MB</span>
        "#;

        let assets = parse_release_assets(html);

        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].name, "Android.Log.Desktop_0.1.2_aarch64.dmg");
        assert!(assets[0]
            .browser_download_url
            .starts_with("https://github.com/"));
        assert_eq!(assets[0].size_bytes, Some(22_754_099));
    }

    #[test]
    fn selects_asset_for_current_platform_family() {
        let assets = vec![
            ReleaseAssetInfo {
                name: "Android.Log.Desktop_0.1.2_x64.dmg".to_string(),
                browser_download_url: "https://github.com/example/x64.dmg".to_string(),
                size_bytes: None,
            },
            ReleaseAssetInfo {
                name: "Android.Log.Desktop_0.1.2_aarch64.dmg".to_string(),
                browser_download_url: "https://github.com/example/aarch64.dmg".to_string(),
                size_bytes: None,
            },
            ReleaseAssetInfo {
                name: "Android.Log.Desktop_0.1.2_x64-setup.exe".to_string(),
                browser_download_url: "https://github.com/example/setup.exe".to_string(),
                size_bytes: None,
            },
        ];

        assert_eq!(
            select_release_asset(&assets, "macos", "aarch64")
                .map(|asset| asset.name)
                .as_deref(),
            Some("Android.Log.Desktop_0.1.2_aarch64.dmg")
        );
        assert_eq!(
            select_release_asset(&assets, "windows", "x86_64")
                .map(|asset| asset.name)
                .as_deref(),
            Some("Android.Log.Desktop_0.1.2_x64-setup.exe")
        );
    }

    #[test]
    fn release_url_allowlist_is_scoped_to_project_releases() {
        assert!(is_allowed_release_url(
            "https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/releases/latest"
        ));
        assert!(is_allowed_release_url(
            "https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/releases/download/v0.1.2/app.dmg"
        ));
        assert!(!is_allowed_release_url(
            "https://github.com/other/repo/releases/latest"
        ));
        assert!(!is_allowed_release_url("https://example.com/app.dmg"));
    }
}
