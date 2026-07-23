import type { LogEntry, LogLevel } from './types'

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

function parseThreadtimeEpochMs(timestamp: string) {
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
  return {
    ...base,
    timestamp,
    timestampEpochMs: parseThreadtimeEpochMs(timestamp),
    pid,
    tid,
    level: level as LogLevel,
    tag: tag.trim(),
    message,
  }
}
