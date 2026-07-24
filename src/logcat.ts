import type { AndroidStudioLogLevel, LogEntry, LogLevel } from './types'

const THREADTIME_PATTERN =
  /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  V: 'Verbose',
  D: 'Debug',
  I: 'Info',
  W: 'Warn',
  E: 'Error',
  F: 'Fatal',
  '?': 'Raw',
}

const ANDROID_STUDIO_TO_LOG_LEVEL: Record<string, LogLevel> = {
  VERBOSE: 'V',
  DEBUG: 'D',
  INFO: 'I',
  WARN: 'W',
  WARNING: 'W',
  ERROR: 'E',
  ASSERT: 'F',
  FATAL: 'F',
}

export interface StructuredLogEntryInput {
  raw: string
  sessionId: string
  sequence: number
  deviceSerial?: string
  timestamp?: string
  timestampEpochMs?: number
  timestampSeconds?: number
  timestampNanos?: number
  pid?: string
  tid?: string
  level?: LogLevel
  tag?: string
  message?: string
  applicationId?: string
  processName?: string
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function pad3(value: number) {
  return String(value).padStart(3, '0')
}

function timestampFromDate(date: Date) {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`
}

export function parseThreadtimeEpochMs(timestamp: string) {
  const match = timestamp.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
  if (!match) {
    return undefined
  }

  const [, month, day, hour, minute, second, millisecond] = match
  const now = new Date()
  const parsed = new Date(
    now.getFullYear(),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  )
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime()
}

export function timestampPartsFromEpochMs(epochMs: number | undefined) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) {
    return undefined
  }

  const safeEpoch = Math.max(0, Math.floor(epochMs))
  return {
    seconds: Math.floor(safeEpoch / 1000),
    nanos: (safeEpoch % 1000) * 1_000_000,
  }
}

export function timestampFromAndroidStudioParts(seconds: number, nanos: number) {
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos) || (seconds === 0 && nanos === 0)) {
    return {
      timestamp: '',
      timestampEpochMs: undefined,
    }
  }

  const timestampEpochMs = Math.max(0, Math.floor(seconds * 1000 + nanos / 1_000_000))
  return {
    timestamp: timestampFromDate(new Date(timestampEpochMs)),
    timestampEpochMs,
  }
}

export function androidStudioLevelFromLogLevel(level: LogLevel): AndroidStudioLogLevel {
  if (level === 'V') {
    return 'VERBOSE'
  }
  if (level === 'D') {
    return 'DEBUG'
  }
  if (level === 'I') {
    return 'INFO'
  }
  if (level === 'W') {
    return 'WARN'
  }
  if (level === 'E') {
    return 'ERROR'
  }
  if (level === 'F') {
    return 'ASSERT'
  }
  return 'INFO'
}

export function logLevelFromAndroidStudioLevel(level: string | undefined): LogLevel {
  return ANDROID_STUDIO_TO_LOG_LEVEL[level?.trim().toUpperCase() ?? ''] ?? '?'
}

export function buildThreadtimeRawLine(input: {
  timestamp?: string
  pid?: string
  tid?: string
  level?: LogLevel
  tag?: string
  message: string
}) {
  const pid = input.pid?.trim() ?? ''
  const tid = input.tid?.trim() ?? ''
  const tag = input.tag?.trim() ?? ''
  const level = input.level && input.level !== '?' ? input.level : ''
  if (!input.timestamp || !pid || !tid || !level || !tag) {
    return input.message
  }

  return `${input.timestamp} ${pid.padStart(5, ' ')} ${tid.padStart(5, ' ')} ${level} ${tag}: ${input.message}`
}

function buildEntryBase(raw: string, sessionId: string, sequence: number, deviceSerial?: string) {
  const searchText = raw.toLowerCase()
  return {
    id: sequence,
    sequence,
    sessionId,
    deviceSerial,
    raw,
    searchText,
    isCrash:
      searchText.includes('fatal exception') ||
      searchText.includes('androidruntime') ||
      searchText.includes('anr in '),
  }
}

export function createStructuredLogEntry(input: StructuredLogEntryInput): LogEntry {
  return {
    ...buildEntryBase(input.raw, input.sessionId, input.sequence, input.deviceSerial),
    timestamp: input.timestamp ?? '',
    timestampEpochMs: input.timestampEpochMs,
    timestampSeconds: input.timestampSeconds,
    timestampNanos: input.timestampNanos,
    pid: input.pid ?? '',
    tid: input.tid ?? '',
    level: input.level ?? '?',
    tag: input.tag?.trim() ?? '',
    message: input.message ?? input.raw,
    applicationId: input.applicationId,
    processName: input.processName,
  }
}

export function parseLogcatLine(
  raw: string,
  sessionId: string,
  sequence: number,
  deviceSerial?: string,
): LogEntry {
  const base = buildEntryBase(raw, sessionId, sequence, deviceSerial)
  const match = raw.match(THREADTIME_PATTERN)
  if (!match) {
    return {
      ...base,
      timestamp: '',
      pid: '',
      tid: '',
      level: '?',
      tag: '',
      message: raw,
    }
  }

  const [, timestamp, pid, tid, level, tag, message] = match
  const timestampEpochMs = parseThreadtimeEpochMs(timestamp)
  const timestampParts = timestampPartsFromEpochMs(timestampEpochMs)
  return {
    ...base,
    timestamp,
    timestampEpochMs,
    timestampSeconds: timestampParts?.seconds,
    timestampNanos: timestampParts?.nanos,
    pid,
    tid,
    level: level as LogLevel,
    tag: tag.trim(),
    message,
  }
}
