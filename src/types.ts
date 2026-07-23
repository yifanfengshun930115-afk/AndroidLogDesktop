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
  pid: string
  tid: string
  level: LogLevel
  tag: string
  message: string
  raw: string
  searchText: string
  isCrash: boolean
}

export interface ExportResult {
  filePath: string
  sizeBytes: number
}
