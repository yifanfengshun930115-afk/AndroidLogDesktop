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
