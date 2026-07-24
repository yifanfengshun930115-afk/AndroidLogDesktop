import {
  androidStudioLevelFromLogLevel,
  buildThreadtimeRawLine,
  logLevelFromAndroidStudioLevel,
  timestampFromAndroidStudioParts,
  timestampPartsFromEpochMs,
  type StructuredLogEntryInput,
} from './logcat'
import type {
  AdbDevice,
  AndroidStudioLogcatFile,
  AndroidStudioLogcatMessage,
  AndroidStudioPhysicalDevice,
  LogEntry,
  LogLevel,
} from './types'

interface ProcessContext {
  serial?: string
  pid: string
  name: string
}

export interface AndroidStudioExportContext {
  devices: AdbDevice[]
  selectedSerials: string[]
  processes: ProcessContext[]
  selectedPackages: string[]
  selectedTags: string[]
  selectedLevels: LogLevel[]
  searchText: string
}

export interface ParsedAndroidStudioLogcatImport {
  title: string
  deviceSerials: string[]
  entries: Array<Omit<StructuredLogEntryInput, 'sessionId' | 'sequence'>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function integerValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
  }
  return 0
}

function positiveIntegerText(value: unknown) {
  const integer = integerValue(value)
  return integer > 0 ? String(integer) : ''
}

function parseDeviceDescription(description: string) {
  return Object.fromEntries(
    description
      .split(/\s+/)
      .map((part) => part.split(':'))
      .filter(([key, value]) => key && value),
  )
}

function physicalDeviceFromAdbDevice(device: AdbDevice | undefined, fallbackSerial = '') {
  const serialNumber = device?.serial || fallbackSerial
  if (!serialNumber) {
    return undefined
  }

  const props = parseDeviceDescription(device?.description ?? '')
  return {
    serialNumber,
    isOnline: device?.state === 'device',
    release: '',
    apiLevel: {
      majorVersion: 0,
      minorVersion: 0,
    },
    featureLevel: 0,
    manufacturer: props.manufacturer ?? '',
    model: props.model?.replaceAll('_', ' ') || props.device || serialNumber,
    type: 'HANDHELD',
  } satisfies AndroidStudioPhysicalDevice
}

function firstSelectedDevice(context: AndroidStudioExportContext) {
  const firstSerial =
    context.selectedSerials[0] ??
    context.devices.find((device) => device.state === 'device')?.serial ??
    ''
  return context.devices.find((device) => device.serial === firstSerial) ?? {
    serial: firstSerial,
    state: firstSerial ? 'device' : '',
    description: '',
  }
}

function processForEntry(entry: LogEntry, processes: ProcessContext[]) {
  return (
    processes.find((process) => process.pid === entry.pid && process.serial === entry.deviceSerial) ??
    processes.find((process) => process.pid === entry.pid)
  )
}

function projectApplicationIds(entries: LogEntry[], context: AndroidStudioExportContext) {
  const ids = new Set<string>()
  for (const packageName of context.selectedPackages) {
    ids.add(packageName)
  }
  for (const entry of entries) {
    const process = processForEntry(entry, context.processes)
    const applicationId = entry.applicationId || process?.name || entry.processName || ''
    if (applicationId && !applicationId.startsWith('[')) {
      ids.add(applicationId)
    }
  }
  return [...ids]
}

function filterText(context: AndroidStudioExportContext) {
  const parts: string[] = []
  for (const serial of context.selectedSerials) {
    parts.push(`device:${serial}`)
  }
  for (const packageName of context.selectedPackages) {
    parts.push(`package:${packageName}`)
  }
  for (const level of context.selectedLevels) {
    parts.push(`level:${androidStudioLevelFromLogLevel(level)}`)
  }
  for (const tag of context.selectedTags) {
    parts.push(`tag:${tag}`)
  }
  if (context.searchText.trim()) {
    parts.push(`message:${context.searchText.trim()}`)
  }
  return parts.join(' ')
}

function timestampForEntry(entry: LogEntry) {
  if (
    typeof entry.timestampSeconds === 'number' &&
    Number.isFinite(entry.timestampSeconds) &&
    typeof entry.timestampNanos === 'number' &&
    Number.isFinite(entry.timestampNanos)
  ) {
    return {
      seconds: Math.max(0, Math.trunc(entry.timestampSeconds)),
      nanos: Math.max(0, Math.trunc(entry.timestampNanos)),
    }
  }
  return timestampPartsFromEpochMs(entry.timestampEpochMs) ?? { seconds: 0, nanos: 0 }
}

function numericText(value: string | undefined) {
  if (!value?.trim()) {
    return 0
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function messageToAndroidStudio(entry: LogEntry, context: AndroidStudioExportContext) {
  const process = processForEntry(entry, context.processes)
  const processName = entry.processName || process?.name || ''
  const applicationId = entry.applicationId || processName
  return {
    header: {
      logLevel: androidStudioLevelFromLogLevel(entry.level),
      pid: numericText(entry.pid),
      tid: numericText(entry.tid),
      applicationId,
      processName,
      tag: entry.tag,
      timestamp: timestampForEntry(entry),
    },
    message: entry.message,
  } satisfies AndroidStudioLogcatMessage
}

export function buildAndroidStudioLogcatFile(
  entries: LogEntry[],
  context: AndroidStudioExportContext,
) {
  const physicalDevice = physicalDeviceFromAdbDevice(
    firstSelectedDevice(context),
    entries.find((entry) => entry.deviceSerial)?.deviceSerial,
  )
  return {
    metadata: {
      device: physicalDevice ? { physicalDevice } : undefined,
      filter: filterText(context),
      projectApplicationIds: projectApplicationIds(entries, context),
    },
    logcatMessages: entries.map((entry) => messageToAndroidStudio(entry, context)),
  } satisfies AndroidStudioLogcatFile
}

export function stringifyAndroidStudioLogcatFile(file: AndroidStudioLogcatFile) {
  return `${JSON.stringify(file, null, 2)}\n`
}

function importedTitle(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) {
    return '导入日志'
  }
  return `导入 - ${trimmed.replace(/\.(logcat|json)$/i, '')}`
}

function physicalDeviceFromMetadata(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.device)) {
    return undefined
  }
  const physicalDevice = metadata.device.physicalDevice
  return isRecord(physicalDevice) ? physicalDevice : undefined
}

function serialFromMetadata(metadata: unknown) {
  const physicalDevice = physicalDeviceFromMetadata(metadata)
  return stringValue(physicalDevice?.serialNumber).trim()
}

function timestampFromHeader(header: Record<string, unknown>) {
  const timestamp = isRecord(header.timestamp) ? header.timestamp : {}
  const seconds = integerValue(timestamp.seconds)
  const nanos = integerValue(timestamp.nanos)
  return {
    seconds,
    nanos,
    ...timestampFromAndroidStudioParts(seconds, nanos),
  }
}

function parseMessage(value: unknown, fallbackDeviceSerial: string) {
  if (!isRecord(value)) {
    return undefined
  }

  const header = isRecord(value.header) ? value.header : {}
  const message = stringValue(value.message)
  const timestamp = timestampFromHeader(header)
  const level = logLevelFromAndroidStudioLevel(stringValue(header.logLevel))
  const pid = positiveIntegerText(header.pid)
  const tid = positiveIntegerText(header.tid)
  const tag = stringValue(header.tag).trim()
  const raw = buildThreadtimeRawLine({
    timestamp: timestamp.timestamp,
    pid,
    tid,
    level,
    tag,
    message,
  })

  return {
    raw,
    deviceSerial: fallbackDeviceSerial,
    timestamp: timestamp.timestamp,
    timestampEpochMs: timestamp.timestampEpochMs,
    timestampSeconds: timestamp.seconds,
    timestampNanos: timestamp.nanos,
    pid,
    tid,
    level,
    tag,
    message,
    applicationId: stringValue(header.applicationId),
    processName: stringValue(header.processName),
  } satisfies Omit<StructuredLogEntryInput, 'sessionId' | 'sequence'>
}

export function parseAndroidStudioLogcatText(text: string, fileName: string) {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是 Android Studio .logcat JSON 格式')
  }

  if (!isRecord(data) || !Array.isArray(data.logcatMessages)) {
    throw new Error('文件缺少 logcatMessages，无法导入')
  }

  const metadataSerial = serialFromMetadata(data.metadata)
  const fallbackDeviceSerial = metadataSerial || `import:${fileName || Date.now()}`
  const entries: Array<Omit<StructuredLogEntryInput, 'sessionId' | 'sequence'>> = []
  for (const message of data.logcatMessages) {
    const parsed = parseMessage(message, fallbackDeviceSerial)
    if (parsed) {
      entries.push(parsed)
    }
  }

  if (entries.length === 0) {
    throw new Error('文件中没有可导入的日志')
  }

  return {
    title: importedTitle(fileName),
    deviceSerials: [fallbackDeviceSerial],
    entries,
  } satisfies ParsedAndroidStudioLogcatImport
}
