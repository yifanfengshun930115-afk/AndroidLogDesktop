import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  LogcatBatchPayload,
  LogcatMessagePayload,
  LogcatSessionInfo,
} from '../types'

export const LOGCAT_BATCH_EVENT = 'logcat://batch'
export const LOGCAT_ERROR_EVENT = 'logcat://error'
export const LOGCAT_STOPPED_EVENT = 'logcat://stopped'

export function startLogcat(serial: string) {
  return invoke<LogcatSessionInfo>('start_logcat', { serial })
}

export function stopLogcat() {
  return invoke<LogcatSessionInfo>('stop_logcat')
}

export function listenLogcatBatch(handler: (payload: LogcatBatchPayload) => void) {
  return listen<LogcatBatchPayload>(LOGCAT_BATCH_EVENT, (event) => handler(event.payload))
}

export function listenLogcatError(handler: (payload: LogcatMessagePayload) => void) {
  return listen<LogcatMessagePayload>(LOGCAT_ERROR_EVENT, (event) => handler(event.payload))
}

export function listenLogcatStopped(handler: (payload: LogcatMessagePayload) => void) {
  return listen<LogcatMessagePayload>(LOGCAT_STOPPED_EVENT, (event) => handler(event.payload))
}
