import { invoke } from '@tauri-apps/api/core'
import type { ExternalOpenResult, UpdateCheckResult } from '../types'

export function checkForUpdates() {
  return invoke<UpdateCheckResult>('check_for_updates')
}

export function openExternalUrl(url: string) {
  return invoke<ExternalOpenResult>('open_external_url', { url })
}
