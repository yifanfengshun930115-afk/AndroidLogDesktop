import { invoke } from '@tauri-apps/api/core'
import type { AdbCommandResult, AdbInfo } from '../types'

export function detectAdb() {
  return invoke<AdbInfo>('detect_adb')
}

export function listAdbDevices() {
  return invoke<AdbCommandResult>('list_adb_devices')
}
