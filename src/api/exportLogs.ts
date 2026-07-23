import { invoke } from '@tauri-apps/api/core'
import type { ExportResult } from '../types'

export function exportLogs(content: string) {
  return invoke<ExportResult>('export_logs', { content })
}
