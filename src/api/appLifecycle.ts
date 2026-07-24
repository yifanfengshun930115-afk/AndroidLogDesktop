import { invoke } from '@tauri-apps/api/core'

export function closeApp() {
  return invoke<void>('close_app')
}
