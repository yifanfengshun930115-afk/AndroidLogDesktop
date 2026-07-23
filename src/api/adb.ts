import { invoke } from '@tauri-apps/api/core'
import type { AdbCommandResult, AdbInfo, AdbProcessResult } from '../types'

export function detectAdb() {
  return invoke<AdbInfo>('detect_adb')
}

export function listAdbDevices() {
  return invoke<AdbCommandResult>('list_adb_devices')
}

export function listAdbProcesses(serial: string) {
  return invoke<AdbProcessResult>('list_adb_processes', { serial })
}
