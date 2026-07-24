import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  ExternalOpenResult,
  UpdateCheckResult,
  UpdateInstallProgress,
  UpdateInstallResult,
} from '../types'

export const UPDATE_INSTALL_PROGRESS_EVENT = 'update://install-progress'

export function checkForUpdates() {
  return invoke<UpdateCheckResult>('check_for_updates')
}

export function installUpdate(downloadUrl: string, assetName?: string) {
  return invoke<UpdateInstallResult>('install_update', { downloadUrl, assetName })
}

export function listenUpdateInstallProgress(handler: (payload: UpdateInstallProgress) => void) {
  return listen<UpdateInstallProgress>(UPDATE_INSTALL_PROGRESS_EVENT, (event) => handler(event.payload))
}

export function openExternalUrl(url: string) {
  return invoke<ExternalOpenResult>('open_external_url', { url })
}
