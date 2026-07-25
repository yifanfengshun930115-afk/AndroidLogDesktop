import { translate } from './index'

type MatchLocalizer = {
  pattern: RegExp
  format: (match: RegExpMatchArray) => string
}

const exactMessageKeys = new Map<string, string>([
  ['transfer id 不能为空', 'backend.transferIdRequired'],
  ['请先选择一个在线设备', 'backend.selectOnlineDevice'],
  ['无法读取 logcat stdout', 'backend.readLogcatStdoutFailed'],
  ['无法读取 logcat stderr', 'backend.readLogcatStderrFailed'],
  [
    '未找到 ADB。请通过 Android Studio SDK Manager 或 Google Platform-Tools 安装 Android SDK Platform-Tools，并设置 ADB_PATH 或 ANDROID_HOME；也可以把内置 ADB 放到 resources/platform-tools/<platform>/adb。',
    'backend.adbMissing',
  ],
  ['导出文件路径为空', 'backend.exportPathEmpty'],
  ['导出文件不存在', 'backend.exportPathMissing'],
  ['发现新版本，但没有找到适配当前系统的安装包。', 'backend.updateNoCompatibleAsset'],
  ['更新检查失败。', 'backend.updateCheckFailed'],
  ['只允许下载当前项目 GitHub Release 的安装包。', 'backend.releaseDownloadOnly'],
  ['安装程序已准备好，应用即将退出并开始安装。', 'backend.installerReady'],
  ['安装程序已启动。', 'update.installerStarted'],
  ['更新失败。', 'update.updateFailed'],
  ['外部链接不在允许范围内。', 'backend.externalUrlBlocked'],
  ['只允许打开当前项目的 GitHub Release 链接。', 'backend.releaseUrlOnly'],
  ['已在浏览器中打开链接。', 'backend.externalUrlOpened'],
  ['未能从 GitHub Release 页面解析最新版本。', 'backend.parseLatestVersionFailed'],
  ['正在连接 GitHub Release。', 'backend.connectingGithubRelease'],
  ['安装包下载完成。', 'backend.installerDownloaded'],
  ['正在下载安装包。', 'backend.downloadingInstaller'],
  ['无法解析安装包文件名。', 'backend.parseInstallerNameFailed'],
  ['安装包文件名无效。', 'backend.invalidInstallerName'],
])

const matchLocalizers: MatchLocalizer[] = [
  {
    pattern: /^打开 Finder 失败：(.+)$/,
    format: (match) => translate('backend.revealFinderFailed', { error: match[1] }),
  },
  {
    pattern: /^打开文件管理器失败：(.+)$/,
    format: (match) => translate('backend.revealFileManagerFailed', { error: match[1] }),
  },
  {
    pattern: /^(.+) 退出码 (-?\d+)$/,
    format: (match) => translate('backend.commandExitCode', { program: match[1], code: match[2] }),
  },
  {
    pattern: /^(.+) 被系统中断$/,
    format: (match) => translate('backend.commandInterrupted', { program: match[1] }),
  },
  {
    pattern: /^更新检查任务异常：(.+)$/,
    format: (match) => translate('backend.updateCheckPanic', { error: match[1] }),
  },
  {
    pattern: /^可更新到适配当前系统的安装包：(.+)。$/,
    format: (match) => translate('backend.updateCompatibleAsset', { name: match[1] }),
  },
  {
    pattern: /^当前版本 v(.+) 高于最新 Release (.+)。$/,
    format: (match) => translate('backend.updateAhead', { current: match[1], latest: match[2] }),
  },
  {
    pattern: /^当前版本 v(.+) 已是最新。$/,
    format: (match) => translate('backend.updateCurrent', { version: match[1] }),
  },
  {
    pattern: /^更新下载任务异常：(.+)$/,
    format: (match) => translate('backend.updateDownloadPanic', { error: match[1] }),
  },
  {
    pattern: /^打开链接失败：(.+)$/,
    format: (match) => translate('backend.openLinkFailed', { error: match[1] }),
  },
  {
    pattern: /^无法执行 curl：(.+)$/,
    format: (match) => translate('backend.curlFailed', { error: match[1] }),
  },
  {
    pattern: /^GitHub 页面请求失败，curl 退出码 (.+)。$/,
    format: (match) => translate('backend.githubCurlStatusFailed', { code: match[1] }),
  },
  {
    pattern: /^GitHub 页面请求失败：(.+)$/,
    format: (match) => translate('backend.githubRequestFailed', { error: match[1] }),
  },
  {
    pattern: /^创建更新目录失败：(.+)$/,
    format: (match) => translate('backend.createUpdateDirFailed', { error: match[1] }),
  },
  {
    pattern: /^创建下载客户端失败：(.+)$/,
    format: (match) => translate('backend.createDownloadClientFailed', { error: match[1] }),
  },
  {
    pattern: /^下载安装包失败：(.+)$/,
    format: (match) => translate('backend.downloadInstallerFailed', { error: match[1] }),
  },
  {
    pattern: /^下载安装包失败，HTTP 状态码 (.+)。$/,
    format: (match) => translate('backend.downloadHttpFailed', { status: match[1] }),
  },
  {
    pattern: /^创建安装包文件失败：(.+)$/,
    format: (match) => translate('backend.createInstallerFileFailed', { error: match[1] }),
  },
  {
    pattern: /^读取下载数据失败：(.+)$/,
    format: (match) => translate('backend.readDownloadFailed', { error: match[1] }),
  },
  {
    pattern: /^写入安装包失败：(.+)$/,
    format: (match) => translate('backend.writeInstallerFailed', { error: match[1] }),
  },
  {
    pattern: /^保存安装包失败：(.+)$/,
    format: (match) => translate('backend.saveInstallerFailed', { error: match[1] }),
  },
  {
    pattern: /^创建安装脚本失败：(.+)$/,
    format: (match) => translate('backend.createInstallScriptFailed', { error: match[1] }),
  },
  {
    pattern: /^启动安装脚本失败：(.+)$/,
    format: (match) => translate('backend.startInstallScriptFailed', { error: match[1] }),
  },
  {
    pattern: /^启动 Windows 安装脚本失败：(.+)$/,
    format: (match) => translate('backend.startWindowsInstallScriptFailed', { error: match[1] }),
  },
  {
    pattern: /^读取 AppImage 权限失败：(.+)$/,
    format: (match) => translate('backend.readAppImagePermissionFailed', { error: match[1] }),
  },
  {
    pattern: /^设置 AppImage 可执行权限失败：(.+)$/,
    format: (match) => translate('backend.setAppImageExecutableFailed', { error: match[1] }),
  },
]

export function localizeBackendMessage(message: unknown) {
  const text = message instanceof Error ? message.message : String(message ?? '')
  const key = exactMessageKeys.get(text)
  if (key) {
    return translate(key)
  }

  for (const localizer of matchLocalizers) {
    const match = text.match(localizer.pattern)
    if (match) {
      return localizer.format(match)
    }
  }

  return text
}
