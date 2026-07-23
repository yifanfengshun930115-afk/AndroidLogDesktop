import { invoke } from '@tauri-apps/api/core'

export function putTabTransfer(transferId: string, payload: string) {
  return invoke<void>('put_tab_transfer', { transferId, payload })
}

export function takeTabTransfer(transferId: string) {
  return invoke<string | null>('take_tab_transfer', { transferId })
}

export function clearTabTransfer(transferId: string) {
  return invoke<void>('clear_tab_transfer', { transferId })
}
