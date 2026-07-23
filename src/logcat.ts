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

export function parseLogcatLine(raw: string, sessionId: string, id: number): LogEntry {
  const match = raw.match(THREADTIME_PATTERN)
  if (!match) {
    return {
      id,
      sessionId,
      timestamp: '',
      pid: '',
      tid: '',
      level: '?',
      tag: '',
      message: raw,
      raw,
    }
  }

  const [, timestamp, pid, tid, level, tag, message] = match
  return {
    id,
    sessionId,
    timestamp,
    pid,
    tid,
    level: level as LogLevel,
    tag: tag.trim(),
    message,
    raw,
  }
}
