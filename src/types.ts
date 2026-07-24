export interface AdbInfo {
  available: boolean
  path?: string
  source?: string
  version?: string
  checkedPaths: string[]
  installHint: string
}

export interface AdbDevice {
  serial: string
  state: string
  description: string
}

export interface AdbCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
  devices?: AdbDevice[]
  adb?: AdbInfo
}

export interface AdbProcessInfo {
  pid: string
  name: string
}

export interface AdbProcessResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
  processes: AdbProcessInfo[]
  adb?: AdbInfo
}

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | '?'

export interface LogcatSessionInfo {
  sessionId: string
  serial: string
  running: boolean
}

export interface LogcatBatchPayload {
  sessionId: string
  lines: string[]
}

export interface LogcatMessagePayload {
  sessionId: string
  message: string
}

export interface LogEntry {
  id: number
  sequence: number
  sessionId: string
  deviceSerial?: string
  timestamp: string
  timestampEpochMs?: number
  timestampSeconds?: number
  timestampNanos?: number
  pid: string
  tid: string
  level: LogLevel
  tag: string
  message: string
  applicationId?: string
  processName?: string
  raw: string
  searchText: string
  isCrash: boolean
}

export interface ExportResult {
  filePath: string
  sizeBytes: number
}

export type AndroidStudioLogLevel = 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'ASSERT'

export interface AndroidStudioLogcatTimestamp {
  seconds: number
  nanos: number
}

export interface AndroidStudioLogcatHeader {
  logLevel: AndroidStudioLogLevel
  pid: number
  tid: number
  applicationId: string
  processName: string
  tag: string
  timestamp: AndroidStudioLogcatTimestamp
}

export interface AndroidStudioLogcatMessage {
  header: AndroidStudioLogcatHeader
  message: string
}

export interface AndroidStudioPhysicalDevice {
  serialNumber: string
  isOnline: boolean
  release: string
  apiLevel: {
    majorVersion: number
    minorVersion: number
  }
  featureLevel: number
  manufacturer: string
  model: string
  type: string
}

export interface AndroidStudioLogcatMetadata {
  device?: {
    physicalDevice?: AndroidStudioPhysicalDevice
  }
  filter: string
  projectApplicationIds: string[]
}

export interface AndroidStudioLogcatFile {
  metadata: AndroidStudioLogcatMetadata
  logcatMessages: AndroidStudioLogcatMessage[]
}

export interface UpdateCheckResult {
  ok: boolean
  currentVersion: string
  latestVersion?: string
  hasUpdate: boolean
  releaseUrl: string
  assetName?: string
  assetDownloadUrl?: string
  assetSizeBytes?: number
  checkedAtEpochMs: number
  message: string
  error?: string
}

export interface ExternalOpenResult {
  ok: boolean
  message: string
  error?: string
}

export type UpdateInstallStage = 'downloading' | 'downloaded' | 'installing'

export interface UpdateInstallProgress {
  stage: UpdateInstallStage
  downloadedBytes: number
  totalBytes?: number
  percent?: number
  message: string
  filePath?: string
}

export interface UpdateInstallResult {
  ok: boolean
  message: string
  filePath?: string
  error?: string
}
