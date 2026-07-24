import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  CaseSensitive,
  Check,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Download,
  ExternalLink,
  ListFilter,
  Menu,
  Moon,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Regex,
  RotateCcw,
  Search,
  Sun,
  Tags,
  Trash2,
  Undo2,
  Usb,
  WholeWord,
  WrapText,
  X,
} from 'lucide-react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { closeApp } from './api/appLifecycle'
import { listAdbDevices, listAdbProcesses } from './api/adb'
import { exportLogs, revealExportFile } from './api/exportLogs'
import {
  listenLogcatBatch,
  listenLogcatError,
  listenLogcatStopped,
  startLogcat,
  stopLogcat,
} from './api/logcat'
import { clearTabTransfer, putTabTransfer, takeTabTransfer } from './api/tabTransfer'
import {
  checkForUpdates as checkForAppUpdatesCommand,
  installUpdate,
  listenUpdateInstallProgress,
  openExternalUrl,
} from './api/update'
import appIconUrl from '../src-tauri/icons/128x128.png'
import './App.css'
import { LOG_LEVEL_LABELS } from './logcat'
import { createPidDeviceKey, LogStore, logStore, type SerializedLogEntry } from './logStore'
import {
  compileSearchMatcher,
  findSearchMatchRanges,
  normalizeSearchOptions,
  type CompiledSearchMatcher,
  type LogSearchOptions,
} from './search'
import type {
  AdbDevice,
  AdbInfo,
  AdbProcessInfo,
  ExternalOpenResult,
  LogEntry,
  LogLevel,
  LogcatSessionInfo,
  UpdateCheckResult,
  UpdateInstallProgress,
  UpdateInstallResult,
} from './types'

interface LogTab {
  id: string
  title: string
  store: LogStore
  selectedSerials: string[]
  sessions: LogcatSessionInfo[]
  paused: boolean
  softWrap: boolean
  selectedLevels: LogLevel[]
  searchText: string
  selectedTags: string[]
  selectedPackages: string[]
  visibleLogFields: LogField[]
  columnWidths: LogColumnWidths
  deviceSelectionManuallyConfigured: boolean
  deviceFieldManuallyConfigured: boolean
  searchOptions: LogSearchOptions
  findText: string
  findOptions: LogSearchOptions
  processesBySerial: Record<string, AdbProcessInfo[]>
  processErrorsBySerial: Record<string, string>
  loadingProcessesBySerial: Record<string, boolean>
  restoreSessionRunning?: boolean
}

type LogColorScheme = 'android-studio' | 'idea' | 'vscode'
type LogField = 'device' | 'time' | 'level' | 'process' | 'tag' | 'message'
type LogColumnWidths = Partial<Record<LogField, number>>
type DeviceProcessInfo = AdbProcessInfo & { serial: string }

interface PackageOption {
  name: string
  pidLabel: string
  serials: string[]
}

interface TabTransferPayload {
  schemaVersion: 1
  id: string
  title: string
  selectedSerial?: string
  selectedSerials?: string[]
  paused: boolean
  softWrap: boolean
  selectedLevels: LogLevel[]
  searchText: string
  selectedTags: string[]
  selectedPackages: string[]
  visibleLogFields: LogField[]
  columnWidths: LogColumnWidths
  deviceSelectionManuallyConfigured?: boolean
  deviceFieldManuallyConfigured?: boolean
  searchOptions: LogSearchOptions
  findText?: string
  findOptions?: LogSearchOptions
  sessionRunning?: boolean
  processes?: AdbProcessInfo[]
  processError?: string
  processesBySerial?: Record<string, AdbProcessInfo[]>
  processErrorsBySerial?: Record<string, string>
  logEntries: SerializedLogEntry[]
}

interface TabTransferEventPayload {
  transferId: string
}

interface InitialAppState {
  tabs: LogTab[]
  activeTabId: string
  nextTabIndex: number
  drawerOpen: boolean
  findBarOpen: boolean
  logColorScheme: LogColorScheme
  logFontSize: number
  logRowPadding: number
  theme: 'light' | 'dark'
}

interface ToastMessage {
  id: number
  tone: 'success' | 'danger'
  title: string
  message?: string
}

type UpdateCheckStatus = 'idle' | 'checking' | 'current' | 'available' | 'error'
type UpdateInstallStatus = 'idle' | 'downloading' | 'installing' | 'error'

interface UpdateCheckState {
  status: UpdateCheckStatus
  currentVersion?: string
  latestVersion?: string
  releaseUrl?: string
  assetName?: string
  assetDownloadUrl?: string
  assetSizeBytes?: number
  checkedAtEpochMs?: number
  message: string
}

interface UpdateInstallState {
  open: boolean
  status: UpdateInstallStatus
  message: string
  downloadedBytes: number
  totalBytes?: number
  percent?: number
  filePath?: string
}

interface CellCopyMenu {
  x: number
  y: number
  label: string
  text: string
}

interface PersistedLogTabState {
  id: string
  title: string
  selectedSerials: string[]
  paused: boolean
  softWrap: boolean
  selectedLevels: LogLevel[]
  searchText: string
  selectedTags: string[]
  selectedPackages: string[]
  visibleLogFields: LogField[]
  columnWidths: LogColumnWidths
  deviceSelectionManuallyConfigured: boolean
  deviceFieldManuallyConfigured: boolean
  searchOptions: LogSearchOptions
  findText: string
  findOptions: LogSearchOptions
}

interface PersistedAppState {
  schemaVersion: 1
  tabs: PersistedLogTabState[]
  activeTabId: string
  nextTabIndex: number
  drawerOpen: boolean
  findBarOpen: boolean
  logColorScheme: LogColorScheme
  logFontSize: number
  logRowPadding: number
  theme: 'light' | 'dark'
}

const LOG_COLOR_SCHEME_LABELS: Record<LogColorScheme, string> = {
  'android-studio': 'Android Studio',
  idea: 'IntelliJ IDEA',
  vscode: 'VS Code',
}

const LOG_LEVEL_OPTIONS: Array<{ value: LogLevel; label: string; description: string }> = [
  { value: 'F', label: 'Fatal', description: 'F / Assert，崩溃或严重失败' },
  { value: 'E', label: 'Error', description: '错误' },
  { value: 'W', label: 'Warn', description: '警告' },
  { value: 'I', label: 'Info', description: '信息' },
  { value: 'D', label: 'Debug', description: '调试' },
  { value: 'V', label: 'Verbose', description: '最详细日志' },
  { value: '?', label: 'Raw', description: '未匹配 threadtime 格式的原始行' },
]

const LOG_FIELD_OPTIONS: Array<{ value: LogField; label: string; required?: boolean }> = [
  { value: 'device', label: '设备' },
  { value: 'time', label: '时间' },
  { value: 'level', label: '级别' },
  { value: 'process', label: 'PID' },
  { value: 'tag', label: 'tag' },
  { value: 'message', label: '内容', required: true },
]

const ALL_LOG_FIELDS: LogField[] = LOG_FIELD_OPTIONS.map((option) => option.value)
const DEFAULT_LOG_FIELDS: LogField[] = ['time', 'level', 'process', 'tag', 'message']
const DEFAULT_SEARCH_OPTIONS: LogSearchOptions = {
  matchCase: false,
  wholeWords: false,
  regex: false,
}
const LOG_FONT_SIZE_STORAGE_KEY = 'android-log-desktop.logFontSize'
const LOG_ROW_PADDING_STORAGE_KEY = 'android-log-desktop.logRowPadding'
const APP_STATE_STORAGE_KEY = 'android-log-desktop.appState.v1'
const DEFAULT_LOG_FONT_SIZE = 12
const DEFAULT_LOG_ROW_PADDING = 7
const LOG_FONT_SIZE_RANGE = { min: 10, max: 18 }
const LOG_ROW_PADDING_RANGE = { min: 3, max: 12 }
const LOG_SCROLL_EDGE_THRESHOLD = 18
const DETACHED_TAB_QUERY_PARAM = 'detachedTab'
const TAB_TRANSFER_SCHEMA_VERSION = 1
const REATTACH_TAB_EVENT = 'tabs://reattach'
const APP_CLOSE_REQUESTED_EVENT = 'app://close-requested'
const RELEASE_PAGE_URL = 'https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/releases/latest'

const LOG_FIELD_COLUMNS: Record<LogField, { defaultWidth: number; minWidth: number; maxWidth: number }> = {
  device: { defaultWidth: 170, minWidth: 112, maxWidth: 420 },
  time: { defaultWidth: 150, minWidth: 96, maxWidth: 320 },
  level: { defaultWidth: 88, minWidth: 72, maxWidth: 180 },
  process: { defaultWidth: 96, minWidth: 72, maxWidth: 220 },
  tag: { defaultWidth: 180, minWidth: 96, maxWidth: 520 },
  message: { defaultWidth: 520, minWidth: 260, maxWidth: 2400 },
}

function createLogTab(index: number, selectedSerials: string[] = []): LogTab {
  const normalizedSerials = normalizeSelectedSerials(selectedSerials)
  return {
    id: `tab-${index}`,
    title: `Logcat ${index}`,
    store: index === 1 ? logStore : new LogStore(),
    selectedSerials: normalizedSerials,
    sessions: [],
    paused: false,
    softWrap: false,
    selectedLevels: [],
    searchText: '',
    selectedTags: [],
    selectedPackages: [],
    visibleLogFields: reconcileLogFieldsForDeviceSelection(DEFAULT_LOG_FIELDS, normalizedSerials, false),
    columnWidths: {},
    deviceSelectionManuallyConfigured: false,
    deviceFieldManuallyConfigured: false,
    searchOptions: { ...DEFAULT_SEARCH_OPTIONS },
    findText: '',
    findOptions: { ...DEFAULT_SEARCH_OPTIONS },
    processesBySerial: {},
    processErrorsBySerial: {},
    loadingProcessesBySerial: {},
  }
}

function createDetachedPlaceholderTab(transferId: string): LogTab {
  return {
    ...createLogTab(0),
    id: `detached-${transferId || 'pending'}`,
    title: '分离日志页',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function normalizeSelectedSerials(value: unknown, legacySerial = '') {
  const serials = stringList(value)
  if (legacySerial) {
    serials.push(legacySerial)
  }
  const seen = new Set<string>()
  return serials
    .map((serial) => serial.trim())
    .filter((serial) => {
      if (!serial || seen.has(serial)) {
        return false
      }
      seen.add(serial)
      return true
    })
}

function selectedSerialsFromData(data: Record<string, unknown>) {
  const legacySerial = typeof data.selectedSerial === 'string' ? data.selectedSerial : ''
  return normalizeSelectedSerials(data.selectedSerials, legacySerial)
}

function reconcileLogFieldsForDeviceSelection(
  fields: LogField[],
  selectedSerials: string[],
  deviceFieldManuallyConfigured: boolean,
) {
  const selected = new Set(fields.filter((field) => ALL_LOG_FIELDS.includes(field)))
  selected.add('message')

  if (!deviceFieldManuallyConfigured) {
    if (selectedSerials.length > 1) {
      selected.add('device')
    } else {
      selected.delete('device')
    }
  }

  return ALL_LOG_FIELDS.filter((field) => selected.has(field))
}

function firstRecordListItem(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : []
}

function normalizeProcesses(value: unknown) {
  return firstRecordListItem(value)
    .map((process) => ({
      pid: typeof process.pid === 'string' ? process.pid : '',
      name: typeof process.name === 'string' ? process.name : '',
    }))
    .filter((process) => process.pid && process.name)
}

function normalizeProcessesBySerial(
  value: unknown,
  legacySerial = '',
  legacyProcesses: AdbProcessInfo[] = [],
) {
  const data = isRecord(value) ? value : {}
  const entries = Object.entries(data).reduce<Record<string, AdbProcessInfo[]>>((result, [serial, processes]) => {
    const normalizedSerial = serial.trim()
    if (normalizedSerial) {
      result[normalizedSerial] = normalizeProcesses(processes)
    }
    return result
  }, {})

  if (legacySerial && legacyProcesses.length > 0 && !entries[legacySerial]) {
    entries[legacySerial] = legacyProcesses
  }

  return entries
}

function normalizeStringMap(value: unknown, legacySerial = '', legacyValue = '') {
  const data = isRecord(value) ? value : {}
  const entries = Object.entries(data).reduce<Record<string, string>>((result, [serial, text]) => {
    const normalizedSerial = serial.trim()
    if (normalizedSerial && typeof text === 'string') {
      result[normalizedSerial] = text
    }
    return result
  }, {})

  if (legacySerial && legacyValue && !entries[legacySerial]) {
    entries[legacySerial] = legacyValue
  }

  return entries
}

function normalizeTheme(value: unknown): 'light' | 'dark' {
  return value === 'dark' ? 'dark' : 'light'
}

function normalizeLogColorScheme(value: unknown): LogColorScheme {
  return value === 'idea' || value === 'vscode' ? value : 'android-studio'
}

function normalizeLogLevels(value: unknown): LogLevel[] {
  const allowedLevels = new Set(LOG_LEVEL_OPTIONS.map((option) => option.value))
  return stringList(value).filter((level): level is LogLevel => allowedLevels.has(level as LogLevel))
}

function clampLogColumnWidth(field: LogField, width: number) {
  const column = LOG_FIELD_COLUMNS[field]
  return clampNumber(Math.round(width), column.minWidth, column.maxWidth)
}

function logColumnWidth(field: LogField, widths: LogColumnWidths) {
  return clampLogColumnWidth(field, widths[field] ?? LOG_FIELD_COLUMNS[field].defaultWidth)
}

function normalizeLogColumnWidths(value: unknown): LogColumnWidths {
  const data = isRecord(value) ? value : {}
  return ALL_LOG_FIELDS.reduce<LogColumnWidths>((widths, field) => {
    const rawWidth = Number(data[field])
    if (Number.isFinite(rawWidth)) {
      widths[field] = clampLogColumnWidth(field, rawWidth)
    }
    return widths
  }, {})
}

function normalizePersistedTabState(value: unknown, index: number): PersistedLogTabState {
  const data = isRecord(value) ? value : {}
  const selectedSerials = selectedSerialsFromData(data)
  const deviceSelectionManuallyConfigured = Boolean(data.deviceSelectionManuallyConfigured)
  const deviceFieldManuallyConfigured = Boolean(data.deviceFieldManuallyConfigured)
  return {
    id: typeof data.id === 'string' && data.id.trim() ? data.id : `tab-${index + 1}`,
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 80) : `Logcat ${index + 1}`,
    selectedSerials,
    paused: Boolean(data.paused),
    softWrap: Boolean(data.softWrap),
    selectedLevels: normalizeLogLevels(data.selectedLevels),
    searchText: typeof data.searchText === 'string' ? data.searchText : '',
    selectedTags: stringList(data.selectedTags),
    selectedPackages: stringList(data.selectedPackages),
    visibleLogFields: reconcileLogFieldsForDeviceSelection(
      stringList(data.visibleLogFields) as LogField[],
      selectedSerials,
      deviceFieldManuallyConfigured,
    ),
    columnWidths: normalizeLogColumnWidths(data.columnWidths),
    deviceSelectionManuallyConfigured,
    deviceFieldManuallyConfigured,
    searchOptions: normalizeSearchOptions(isRecord(data.searchOptions) ? data.searchOptions : undefined),
    findText: typeof data.findText === 'string' ? data.findText : '',
    findOptions: normalizeSearchOptions(isRecord(data.findOptions) ? data.findOptions : undefined),
  }
}

function readPersistedAppState(): PersistedAppState | undefined {
  try {
    const payload = window.localStorage.getItem(APP_STATE_STORAGE_KEY)
    if (!payload) {
      return undefined
    }

    const parsed = JSON.parse(payload) as unknown
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
      return undefined
    }

    const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : [])
      .map((tab, index) => normalizePersistedTabState(tab, index))
      .slice(0, 12)
    if (tabs.length === 0) {
      return undefined
    }

    return {
      schemaVersion: 1,
      tabs,
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : tabs[0].id,
      nextTabIndex: Number.isFinite(Number(parsed.nextTabIndex)) ? Number(parsed.nextTabIndex) : 2,
      drawerOpen: typeof parsed.drawerOpen === 'boolean' ? parsed.drawerOpen : true,
      findBarOpen: Boolean(parsed.findBarOpen),
      logColorScheme: normalizeLogColorScheme(parsed.logColorScheme),
      logFontSize: clampNumber(
        Number(parsed.logFontSize),
        LOG_FONT_SIZE_RANGE.min,
        LOG_FONT_SIZE_RANGE.max,
      ),
      logRowPadding: clampNumber(
        Number(parsed.logRowPadding),
        LOG_ROW_PADDING_RANGE.min,
        LOG_ROW_PADDING_RANGE.max,
      ),
      theme: normalizeTheme(parsed.theme),
    }
  } catch {
    return undefined
  }
}

function createLogTabFromPersistedState(state: PersistedLogTabState, index: number, existingIds: Set<string>) {
  const tab = createLogTab(index + 1, state.selectedSerials)
  return {
    ...tab,
    id: uniqueTabId(state.id, existingIds),
    title: state.title,
    paused: state.paused,
    softWrap: state.softWrap,
    selectedLevels: [...state.selectedLevels],
    searchText: state.searchText,
    selectedTags: [...state.selectedTags],
    selectedPackages: [...state.selectedPackages],
    visibleLogFields: reconcileLogFieldsForDeviceSelection(
      state.visibleLogFields,
      state.selectedSerials,
      state.deviceFieldManuallyConfigured,
    ),
    columnWidths: normalizeLogColumnWidths(state.columnWidths),
    deviceSelectionManuallyConfigured: state.deviceSelectionManuallyConfigured,
    deviceFieldManuallyConfigured: state.deviceFieldManuallyConfigured,
    searchOptions: { ...state.searchOptions },
    findText: state.findText,
    findOptions: { ...state.findOptions },
  } satisfies LogTab
}

function createInitialAppState(detachedTransferId: string): InitialAppState {
  if (detachedTransferId) {
    const tab = createDetachedPlaceholderTab(detachedTransferId)
    return {
      tabs: [tab],
      activeTabId: tab.id,
      nextTabIndex: 1,
      drawerOpen: false,
      findBarOpen: false,
      logColorScheme: 'android-studio',
      logFontSize: readNumberPreference(
        LOG_FONT_SIZE_STORAGE_KEY,
        DEFAULT_LOG_FONT_SIZE,
        LOG_FONT_SIZE_RANGE.min,
        LOG_FONT_SIZE_RANGE.max,
      ),
      logRowPadding: readNumberPreference(
        LOG_ROW_PADDING_STORAGE_KEY,
        DEFAULT_LOG_ROW_PADDING,
        LOG_ROW_PADDING_RANGE.min,
        LOG_ROW_PADDING_RANGE.max,
      ),
      theme: 'light',
    }
  }

  const persistedState = readPersistedAppState()
  if (persistedState) {
    const existingIds = new Set<string>()
    const tabs = persistedState.tabs.map((tabState, index) => {
      const tab = createLogTabFromPersistedState(tabState, index, existingIds)
      existingIds.add(tab.id)
      return tab
    })
    const activeTabId = tabs.some((tab) => tab.id === persistedState.activeTabId)
      ? persistedState.activeTabId
      : tabs[0].id

    return {
      tabs,
      activeTabId,
      nextTabIndex: Math.max(persistedState.nextTabIndex, nextLogcatIndex(tabs)),
      drawerOpen: persistedState.drawerOpen,
      findBarOpen: persistedState.findBarOpen,
      logColorScheme: persistedState.logColorScheme,
      logFontSize: persistedState.logFontSize,
      logRowPadding: persistedState.logRowPadding,
      theme: persistedState.theme,
    }
  }

  const tab = createLogTab(1)
  return {
    tabs: [tab],
    activeTabId: tab.id,
    nextTabIndex: 2,
    drawerOpen: true,
    findBarOpen: false,
    logColorScheme: 'android-studio',
    logFontSize: readNumberPreference(
      LOG_FONT_SIZE_STORAGE_KEY,
      DEFAULT_LOG_FONT_SIZE,
      LOG_FONT_SIZE_RANGE.min,
      LOG_FONT_SIZE_RANGE.max,
    ),
    logRowPadding: readNumberPreference(
      LOG_ROW_PADDING_STORAGE_KEY,
      DEFAULT_LOG_ROW_PADDING,
      LOG_ROW_PADDING_RANGE.min,
      LOG_ROW_PADDING_RANGE.max,
    ),
    theme: 'light',
  }
}

function readDetachedTransferId() {
  try {
    return new URLSearchParams(window.location.search).get(DETACHED_TAB_QUERY_PARAM)?.trim() ?? ''
  } catch {
    return ''
  }
}

function normalizeLogFields(fields: LogField[]) {
  const selected = new Set(fields.filter((field) => ALL_LOG_FIELDS.includes(field)))
  selected.add('message')
  return ALL_LOG_FIELDS.filter((field) => selected.has(field))
}

function serializeTabForTransfer(tab: LogTab, sessionRunning: boolean): TabTransferPayload {
  return {
    schemaVersion: TAB_TRANSFER_SCHEMA_VERSION,
    id: tab.id,
    title: tab.title,
    selectedSerial: tab.selectedSerials[0] ?? '',
    selectedSerials: [...tab.selectedSerials],
    paused: tab.paused,
    softWrap: tab.softWrap,
    selectedLevels: [...tab.selectedLevels],
    searchText: tab.searchText,
    selectedTags: [...tab.selectedTags],
    selectedPackages: [...tab.selectedPackages],
    visibleLogFields: normalizeLogFields(tab.visibleLogFields),
    columnWidths: normalizeLogColumnWidths(tab.columnWidths),
    deviceSelectionManuallyConfigured: tab.deviceSelectionManuallyConfigured,
    deviceFieldManuallyConfigured: tab.deviceFieldManuallyConfigured,
    searchOptions: { ...tab.searchOptions },
    findText: tab.findText,
    findOptions: { ...tab.findOptions },
    sessionRunning,
    processesBySerial: { ...tab.processesBySerial },
    processErrorsBySerial: { ...tab.processErrorsBySerial },
    logEntries: tab.store.getTransferEntries(),
  }
}

function parseTabTransferPayload(payloadText: string | null): TabTransferPayload | undefined {
  if (!payloadText) {
    return undefined
  }

  const payload = JSON.parse(payloadText) as Partial<TabTransferPayload>
  if (payload.schemaVersion !== TAB_TRANSFER_SCHEMA_VERSION) {
    throw new Error('日志页中转数据版本不匹配')
  }
  return payload as TabTransferPayload
}

function uniqueTabId(preferredId: string, existingIds: Set<string>) {
  if (!existingIds.has(preferredId)) {
    return preferredId
  }

  let index = 2
  let nextId = `${preferredId}-${index}`
  while (existingIds.has(nextId)) {
    index += 1
    nextId = `${preferredId}-${index}`
  }
  return nextId
}

function createTabFromTransferPayload(payload: TabTransferPayload, existingIds = new Set<string>()) {
  const store = new LogStore()
  store.hydrateTransferEntries(payload.logEntries ?? [])
  const selectedSerials = normalizeSelectedSerials(payload.selectedSerials, payload.selectedSerial ?? '')
  const legacyProcesses = normalizeProcesses(payload.processes)
  const deviceSelectionManuallyConfigured = Boolean(payload.deviceSelectionManuallyConfigured)
  const deviceFieldManuallyConfigured = Boolean(payload.deviceFieldManuallyConfigured)
  return {
    id: uniqueTabId(payload.id || `tab-${Date.now()}`, existingIds),
    title: payload.title || 'Logcat',
    store,
    selectedSerials,
    sessions: [],
    paused: Boolean(payload.paused),
    softWrap: Boolean(payload.softWrap),
    selectedLevels: payload.selectedLevels ?? [],
    searchText: payload.searchText ?? '',
    selectedTags: payload.selectedTags ?? [],
    selectedPackages: payload.selectedPackages ?? [],
    visibleLogFields: reconcileLogFieldsForDeviceSelection(
      payload.visibleLogFields ?? DEFAULT_LOG_FIELDS,
      selectedSerials,
      deviceFieldManuallyConfigured,
    ),
    columnWidths: normalizeLogColumnWidths(payload.columnWidths),
    deviceSelectionManuallyConfigured,
    deviceFieldManuallyConfigured,
    searchOptions: { ...DEFAULT_SEARCH_OPTIONS, ...payload.searchOptions },
    findText: payload.findText ?? '',
    findOptions: { ...DEFAULT_SEARCH_OPTIONS, ...payload.findOptions },
    processesBySerial: normalizeProcessesBySerial(
      payload.processesBySerial,
      payload.selectedSerial ?? selectedSerials[0] ?? '',
      legacyProcesses,
    ),
    processErrorsBySerial: normalizeStringMap(
      payload.processErrorsBySerial,
      payload.selectedSerial ?? selectedSerials[0] ?? '',
      payload.processError ?? '',
    ),
    loadingProcessesBySerial: {},
    restoreSessionRunning: Boolean(payload.sessionRunning),
  } satisfies LogTab
}

function nextLogcatIndex(tabs: LogTab[]) {
  return Math.max(
    2,
    ...tabs.map((tab) => {
      const match = tab.id.match(/^tab-(\d+)$/)
      return match ? Number(match[1]) + 1 : 0
    }),
  )
}

function createTransferId(prefix: 'detached' | 'reattach', tabId: string) {
  return `${prefix}-${tabId.replace(/[^a-zA-Z0-9-_:]/g, '-')}-${Date.now()}`
}

function detachedWindowUrl(transferId: string) {
  return `index.html?${DETACHED_TAB_QUERY_PARAM}=${encodeURIComponent(transferId)}`
}

function waitForWindowCreated(window: WebviewWindow) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: unknown) => {
      if (settled) {
        return
      }
      settled = true
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      resolve()
    }

    void window.once('tauri://created', () => settle())
    void window.once<string>('tauri://error', (event) => settle(event.payload))
  })
}

async function stopLogcatSessions(sessions: LogcatSessionInfo[]) {
  await Promise.allSettled(
    sessions
      .filter((session) => session.sessionId)
      .map((session) => stopLogcat(session.sessionId)),
  )
}

function parseDeviceDescription(description: string) {
  return Object.fromEntries(
    description
      .split(/\s+/)
      .map((part) => part.split(':'))
      .filter(([key, value]) => key && value),
  )
}

function deviceTitle(device: AdbDevice) {
  const props = parseDeviceDescription(device.description)
  return props.model?.replaceAll('_', ' ') || props.device || device.serial
}

function deviceSubtitle(device: AdbDevice) {
  const props = parseDeviceDescription(device.description)
  const details = [props.product, props.device, device.serial].filter(Boolean)
  return details.join(' · ')
}

function deviceLabelForSerial(serial: string | undefined, devices: AdbDevice[]) {
  if (!serial) {
    return '-'
  }
  const device = devices.find((item) => item.serial === serial)
  return device ? deviceTitle(device) : serial
}

function deviceFilterLabel(selectedSerials: string[], onlineDevices: AdbDevice[]) {
  if (onlineDevices.length === 0) {
    return '设备 无'
  }
  if (selectedSerials.length === 0) {
    return '设备 未选'
  }
  if (selectedSerials.length === 1) {
    return `设备 ${deviceLabelForSerial(selectedSerials[0], onlineDevices)}`
  }
  if (selectedSerials.length === onlineDevices.length) {
    return `设备 全部 ${selectedSerials.length}`
  }
  return `设备 ${selectedSerials.length}/${onlineDevices.length}`
}

function selectedDeviceSummary(selectedSerials: string[], onlineDevices: AdbDevice[]) {
  if (selectedSerials.length === 0) {
    return '等待设备连接'
  }
  if (selectedSerials.length === 1) {
    return deviceLabelForSerial(selectedSerials[0], onlineDevices)
  }
  return `${selectedSerials.length} 台设备`
}

function levelClass(level: LogLevel) {
  return `level-${level === '?' ? 'raw' : level.toLowerCase()}`
}

function processesForSelectedDevices(
  processesBySerial: Record<string, AdbProcessInfo[]>,
  selectedSerials: string[],
) {
  return selectedSerials.flatMap((serial) =>
    (processesBySerial[serial] ?? []).map((process) => ({ ...process, serial })),
  )
}

function packageOptions(processes: DeviceProcessInfo[]) {
  const grouped = new Map<string, { pids: Set<string>; serials: Set<string> }>()
  for (const process of processes) {
    if (!process.name || process.name.startsWith('[')) {
      continue
    }
    const group = grouped.get(process.name) ?? { pids: new Set<string>(), serials: new Set<string>() }
    group.pids.add(process.pid)
    group.serials.add(process.serial)
    grouped.set(process.name, group)
  }

  return [...grouped.entries()]
    .map<PackageOption>(([name, group]) => ({
      name,
      pidLabel: [...group.pids].slice(0, 3).join(', '),
      serials: [...group.serials],
    }))
    .sort((first, second) => first.name.localeCompare(second.name))
}

function packagePidDeviceKeys(processes: DeviceProcessInfo[], selectedPackages: string[]) {
  const selected = new Set(selectedPackages)
  return [
    ...new Set(
      processes
        .filter((process) => selected.has(process.name))
        .map((process) => createPidDeviceKey(process.serial, process.pid))
        .filter(Boolean),
    ),
  ]
}

function filterPackageOptions(processes: DeviceProcessInfo[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const options = packageOptions(processes)
  if (!normalizedQuery) {
    return options
  }
  return options.filter((process) => process.name.toLowerCase().includes(normalizedQuery))
}

function pruneSelectedPackages(selectedPackages: string[], processes: DeviceProcessInfo[]) {
  const availablePackages = new Set(packageOptions(processes).map((process) => process.name))
  return selectedPackages.filter((packageName) => availablePackages.has(packageName))
}

function reconcileTabDevices(tab: LogTab, onlineSerials: string[]) {
  const onlineSet = new Set(onlineSerials)
  const retainedSerials = tab.selectedSerials.filter((serial) => onlineSet.has(serial))
  const selectedSerials =
    !tab.deviceSelectionManuallyConfigured && onlineSerials.length > 0
      ? onlineSerials
      : retainedSerials.length > 0
        ? retainedSerials
        : onlineSerials
  const selectedSet = new Set(selectedSerials)
  const processesBySerial = Object.fromEntries(
    Object.entries(tab.processesBySerial).filter(([serial]) => selectedSet.has(serial)),
  )
  const processErrorsBySerial = Object.fromEntries(
    Object.entries(tab.processErrorsBySerial).filter(([serial]) => selectedSet.has(serial)),
  )
  const loadingProcessesBySerial = Object.fromEntries(
    Object.entries(tab.loadingProcessesBySerial).filter(([serial]) => selectedSet.has(serial)),
  )
  const processes = processesForSelectedDevices(processesBySerial, selectedSerials)

  return {
    ...tab,
    selectedSerials,
    selectedPackages: pruneSelectedPackages(tab.selectedPackages, processes),
    visibleLogFields: reconcileLogFieldsForDeviceSelection(
      tab.visibleLogFields,
      selectedSerials,
      tab.deviceFieldManuallyConfigured,
    ),
    processesBySerial,
    processErrorsBySerial,
    loadingProcessesBySerial,
  }
}

function filterTextOptions(options: string[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return options
  }
  return options.filter((option) => option.toLowerCase().includes(normalizedQuery))
}

function countSuffix(count: number) {
  return count > 0 ? String(count) : ''
}

function levelFilterLabel(selectedLevels: LogLevel[]) {
  if (selectedLevels.length === 0) {
    return 'Level 全部'
  }
  if (selectedLevels.length === 1) {
    return `Level ${LOG_LEVEL_LABELS[selectedLevels[0]]}`
  }
  return `Level ${selectedLevels.length}`
}

function logFieldLabel(field: LogField) {
  return LOG_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field
}

function logCellText(field: LogField, entry: LogEntry, devices: AdbDevice[]) {
  if (field === 'device') {
    return deviceLabelForSerial(entry.deviceSerial, devices)
  }
  if (field === 'time') {
    return entry.timestamp || '-'
  }
  if (field === 'level') {
    return LOG_LEVEL_LABELS[entry.level]
  }
  if (field === 'process') {
    return entry.pid || '-'
  }
  if (field === 'tag') {
    return entry.tag || '-'
  }
  return entry.message
}

function displayVersion(version?: string) {
  return version ? `v${version.replace(/^v/i, '')}` : '-'
}

function formatBytes(sizeBytes?: number) {
  if (!sizeBytes || sizeBytes < 0) {
    return ''
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = sizeBytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function formatPercent(percent?: number) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return undefined
  }
  return `${Math.max(0, Math.min(100, percent)).toFixed(0)}%`
}

function formatCheckedTime(epochMs?: number) {
  if (!epochMs) {
    return ''
  }
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function updateStatusTitle(status: UpdateCheckStatus) {
  if (status === 'checking') {
    return '正在检查更新'
  }
  if (status === 'available') {
    return '发现新版本'
  }
  if (status === 'current') {
    return '当前已是最新版本'
  }
  if (status === 'error') {
    return '更新检查失败'
  }
  return '自动检查更新'
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) {
    throw new Error('系统剪贴板不可用')
  }
}

function buildLogGridColumns(fields: LogField[], softWrap: boolean, widths: LogColumnWidths) {
  return fields
    .map((field) => {
      const width = logColumnWidth(field, widths)
      if (field === 'message') {
        return `minmax(${width}px, ${softWrap ? '1fr' : 'max-content'})`
      }
      return `${width}px`
    })
    .join(' ')
}

function buildLogMinWidth(fields: LogField[], widths: LogColumnWidths) {
  const minWidth = fields.reduce((sum, field) => sum + logColumnWidth(field, widths), 0)
  return `${Math.max(minWidth, 260)}px`
}

function isScrollNearBottom(element: HTMLElement) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - LOG_SCROLL_EDGE_THRESHOLD
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

function readNumberPreference(key: string, fallback: number, min: number, max: number) {
  try {
    const storedValue = window.localStorage.getItem(key)
    if (storedValue === null) {
      return fallback
    }
    const value = Number(storedValue)
    return Number.isFinite(value) ? clampNumber(value, min, max) : fallback
  } catch {
    return fallback
  }
}

function writeNumberPreference(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Non-critical preference persistence can be unavailable in restricted WebViews.
  }
}

function serializeTabForPersistence(tab: LogTab): PersistedLogTabState {
  return {
    id: tab.id,
    title: tab.title,
    selectedSerials: [...tab.selectedSerials],
    paused: tab.paused,
    softWrap: tab.softWrap,
    selectedLevels: [...tab.selectedLevels],
    searchText: tab.searchText,
    selectedTags: [...tab.selectedTags],
    selectedPackages: [...tab.selectedPackages],
    visibleLogFields: normalizeLogFields(tab.visibleLogFields),
    columnWidths: normalizeLogColumnWidths(tab.columnWidths),
    deviceSelectionManuallyConfigured: tab.deviceSelectionManuallyConfigured,
    deviceFieldManuallyConfigured: tab.deviceFieldManuallyConfigured,
    searchOptions: { ...tab.searchOptions },
    findText: tab.findText,
    findOptions: { ...tab.findOptions },
  }
}

function writePersistedAppState(state: PersistedAppState) {
  try {
    window.localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // State restore is a convenience; restricted WebViews may block localStorage.
  }
}

function HighlightedText({
  className,
  matcher,
  onContextMenu,
  text,
}: {
  className?: string
  matcher: CompiledSearchMatcher
  onContextMenu?: (event: ReactMouseEvent<HTMLSpanElement>) => void
  text: string
}) {
  const ranges = findSearchMatchRanges(text, matcher, 100)
  if (ranges.length === 0) {
    return (
      <span className={className} onContextMenu={onContextMenu}>
        {text}
      </span>
    )
  }

  const parts = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) {
      continue
    }
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start))
    }
    parts.push(
      <mark className="log-highlight" key={`${range.start}-${range.end}`}>
        {text.slice(range.start, range.end)}
      </mark>,
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return (
    <span className={className} onContextMenu={onContextMenu}>
      {parts}
    </span>
  )
}

function App() {
  const detachedTransferId = useMemo(() => readDetachedTransferId(), [])
  const isDetachedWindow = detachedTransferId.length > 0
  const [initialAppState] = useState(() => createInitialAppState(detachedTransferId))
  const [adbInfo, setAdbInfo] = useState<AdbInfo>()
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [logError, setLogError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [toast, setToast] = useState<ToastMessage>()
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({
    status: 'idle',
    releaseUrl: RELEASE_PAGE_URL,
    message: '启动后会自动检查 GitHub Release。',
  })
  const [updateInstall, setUpdateInstall] = useState<UpdateInstallState>({
    open: false,
    status: 'idle',
    message: '',
    downloadedBytes: 0,
  })
  const [cellCopyMenu, setCellCopyMenu] = useState<CellCopyMenu>()
  const [drawerOpen, setDrawerOpen] = useState(initialAppState.drawerOpen)
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false)
  const [packageMenuOpen, setPackageMenuOpen] = useState(false)
  const [packageSearch, setPackageSearch] = useState('')
  const [levelMenuOpen, setLevelMenuOpen] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const [contentMenuOpen, setContentMenuOpen] = useState(false)
  const [logSchemeMenuOpen, setLogSchemeMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(initialAppState.theme)
  const [logColorScheme, setLogColorScheme] = useState<LogColorScheme>(initialAppState.logColorScheme)
  const [logFontSize, setLogFontSize] = useState(initialAppState.logFontSize)
  const [logRowPadding, setLogRowPadding] = useState(initialAppState.logRowPadding)
  const [startingTabId, setStartingTabId] = useState('')
  const [detachingTabId, setDetachingTabId] = useState('')
  const [returningToMain, setReturningToMain] = useState(false)
  const [dragOverTabId, setDragOverTabId] = useState('')
  const [editingTabId, setEditingTabId] = useState('')
  const [editingTabTitle, setEditingTabTitle] = useState('')
  const [findBarOpen, setFindBarOpen] = useState(initialAppState.findBarOpen)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [closingApp, setClosingApp] = useState(false)
  const [resizingLogField, setResizingLogField] = useState<LogField | ''>('')
  const [logWindowStarts, setLogWindowStarts] = useState<Record<string, number>>({})
  const [tabs, setTabs] = useState<LogTab[]>(initialAppState.tabs)
  const [activeTabId, setActiveTabId] = useState(initialAppState.activeTabId)
  const nextTabIndexRef = useRef(initialAppState.nextTabIndex)
  const tabsRef = useRef(tabs)
  const draggedTabIdRef = useRef('')
  const autoStartPendingRef = useRef(!isDetachedWindow)
  const updateAutoCheckStartedRef = useRef(false)
  const toastTimerRef = useRef<number>()
  const cellCopyMenuRef = useRef<HTMLDivElement>(null)
  const tabTitleInputRef = useRef<HTMLInputElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const logListRef = useRef<HTMLDivElement>(null)
  const logScrollTopByTabRef = useRef<Record<string, number>>({})
  const logStickToBottomByTabRef = useRef<Record<string, boolean>>({})
  const pendingLogScrollRef = useRef<'top' | 'bottom'>()
  const columnResizeRef = useRef<{
    tabId: string
    field: LogField
    startX: number
    startWidth: number
  }>()
  const logSchemeSelectRef = useRef<HTMLDivElement>(null)
  const deviceFilterRef = useRef<HTMLDivElement>(null)
  const packageFilterRef = useRef<HTMLDivElement>(null)
  const levelFilterRef = useRef<HTMLDivElement>(null)
  const tagFilterRef = useRef<HTMLDivElement>(null)
  const contentFilterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    if (!isDetachedWindow) {
      return undefined
    }

    let disposed = false

    const loadDetachedTab = async () => {
      try {
        const payloadText = await takeTabTransfer(detachedTransferId)
        const payload = parseTabTransferPayload(payloadText)
        if (!payload) {
          throw new Error('未找到分离日志页的中转数据')
        }

        const tab = createTabFromTransferPayload(payload)
        if (disposed) {
          return
        }
        setTabs([tab])
        setActiveTabId(tab.id)
        setDrawerOpen(false)
        nextTabIndexRef.current = nextLogcatIndex([tab])
      } catch (error) {
        if (!disposed) {
          setLogError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void loadDetachedTab()
    return () => {
      disposed = true
    }
  }, [detachedTransferId, isDetachedWindow])

  useEffect(() => {
    if (isDetachedWindow) {
      return undefined
    }

    let disposed = false
    let unlisten: (() => void) | undefined

    listen<TabTransferEventPayload>(REATTACH_TAB_EVENT, async (event) => {
      try {
        const payloadText = await takeTabTransfer(event.payload.transferId)
        const payload = parseTabTransferPayload(payloadText)
        if (!payload) {
          throw new Error('未找到回归日志页的中转数据')
        }
        if (disposed) {
          return
        }

        setTabs((current) => {
          const tab = createTabFromTransferPayload(
            payload,
            new Set(current.map((item) => item.id)),
          )
          const nextTabs = [...current, tab]
          setActiveTabId(tab.id)
          nextTabIndexRef.current = Math.max(nextTabIndexRef.current, nextLogcatIndex(nextTabs))
          return nextTabs
        })
        setLogError('')
      } catch (error) {
        if (!disposed) {
          setLogError(error instanceof Error ? error.message : String(error))
        }
      }
    })
      .then((callback) => {
        if (disposed) {
          callback()
          return
        }
        unlisten = callback
      })
      .catch((error) => {
        if (!disposed) {
          setLogError(error instanceof Error ? error.message : String(error))
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [isDetachedWindow])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const activeStore = activeTab.store
  const logSnapshot = useSyncExternalStore(
    activeStore.subscribe,
    activeStore.getSnapshot,
    activeStore.getSnapshot,
  )

  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === 'device'),
    [devices],
  )
  const selectedSerialSet = useMemo(() => new Set(activeTab.selectedSerials), [activeTab.selectedSerials])
  const activeProcesses = useMemo(
    () => processesForSelectedDevices(activeTab.processesBySerial, activeTab.selectedSerials),
    [activeTab.processesBySerial, activeTab.selectedSerials],
  )
  const hasSelectedDevice = activeTab.selectedSerials.length > 0
  const isRunning = activeTab.sessions.some((session) => session.running)
  const isStarting = startingTabId === activeTab.id
  const activeLogWindowStart = logWindowStarts[activeTabId] ?? 0
  const visibleLogs = activeStore.getVisibleEntriesWindow(activeLogWindowStart)
  const packages = packageOptions(activeProcesses)
  const visiblePackages = filterPackageOptions(activeProcesses, packageSearch)
  const processError = activeTab.selectedSerials
    .map((serial) => activeTab.processErrorsBySerial[serial])
    .filter(Boolean)
    .join(' / ')
  const loadingProcesses = activeTab.selectedSerials.some((serial) => activeTab.loadingProcessesBySerial[serial])
  const visibleTags = filterTextOptions(logSnapshot.tagOptions, tagSearch)
  const activeFilterMatcher = useMemo(
    () => compileSearchMatcher(activeTab.searchText, activeTab.searchOptions),
    [activeTab.searchOptions, activeTab.searchText],
  )
  const activeFindMatcher = useMemo(
    () => compileSearchMatcher(findBarOpen ? activeTab.findText : '', activeTab.findOptions),
    [activeTab.findOptions, activeTab.findText, findBarOpen],
  )
  const logLayoutStyle = useMemo(
    () =>
      ({
        '--log-grid-columns': buildLogGridColumns(
          activeTab.visibleLogFields,
          activeTab.softWrap,
          activeTab.columnWidths,
        ),
        '--log-min-width': buildLogMinWidth(activeTab.visibleLogFields, activeTab.columnWidths),
        '--log-font-size': `${logFontSize}px`,
        '--log-row-padding': `${logRowPadding}px`,
      }) as CSSProperties,
    [activeTab.columnWidths, activeTab.softWrap, activeTab.visibleLogFields, logFontSize, logRowPadding],
  )

  const setActiveLogWindowStart = useCallback(
    (startIndex: number) => {
      const safeStart = Math.max(0, Math.floor(startIndex))
      setLogWindowStarts((current) =>
        current[activeTabId] === safeStart ? current : { ...current, [activeTabId]: safeStart },
      )
    },
    [activeTabId],
  )

  const resetLogWindowForTab = useCallback(
    (tabId: string, options: { stickToBottom?: boolean } = {}) => {
      const nextStickToBottom =
        options.stickToBottom ?? logStickToBottomByTabRef.current[tabId] ?? true
      logScrollTopByTabRef.current[tabId] = 0
      logStickToBottomByTabRef.current[tabId] = nextStickToBottom
      setLogWindowStarts((current) => (current[tabId] === 0 ? current : { ...current, [tabId]: 0 }))
      if (tabId === activeTabId) {
        pendingLogScrollRef.current = nextStickToBottom ? 'bottom' : 'top'
      }
    },
    [activeTabId],
  )

  const applyPendingLogScroll = useCallback(() => {
    const scrollFrame = logListRef.current
    const target = pendingLogScrollRef.current
    if (!scrollFrame || !target) {
      return false
    }

    const nextTop = target === 'bottom' ? scrollFrame.scrollHeight : 0
    scrollFrame.scrollTop = nextTop
    logScrollTopByTabRef.current[activeTabId] = nextTop
    pendingLogScrollRef.current = undefined
    return true
  }, [activeTabId])

  const handleLogScroll = useCallback(() => {
    const scrollFrame = logListRef.current
    if (scrollFrame) {
      logScrollTopByTabRef.current[activeTabId] = scrollFrame.scrollTop
      const atBottom = isScrollNearBottom(scrollFrame)
      logStickToBottomByTabRef.current[activeTabId] = atBottom

      if (atBottom) {
        const latestWindowStart = Math.max(0, logSnapshot.filteredCount - logSnapshot.displayLimit)
        if (activeLogWindowStart < latestWindowStart) {
          pendingLogScrollRef.current = 'bottom'
          setActiveLogWindowStart(latestWindowStart)
        }
      }
    }
  }, [
    activeLogWindowStart,
    activeTabId,
    logSnapshot.displayLimit,
    logSnapshot.filteredCount,
    setActiveLogWindowStart,
  ])

  const scrollLogToTop = useCallback(() => {
    const scrollFrame = logListRef.current
    if (!scrollFrame) {
      return
    }
    pendingLogScrollRef.current = 'top'
    logStickToBottomByTabRef.current[activeTabId] = false
    setActiveLogWindowStart(0)
    logScrollTopByTabRef.current[activeTabId] = 0
    scrollFrame.scrollTo({ top: 0, behavior: 'smooth' })
    window.requestAnimationFrame(() => {
      applyPendingLogScroll()
    })
  }, [activeTabId, applyPendingLogScroll, setActiveLogWindowStart])

  const scrollLogToBottom = useCallback(() => {
    const scrollFrame = logListRef.current
    if (!scrollFrame) {
      return
    }
    const startIndex = Math.max(0, logSnapshot.filteredCount - logSnapshot.displayLimit)
    pendingLogScrollRef.current = 'bottom'
    logStickToBottomByTabRef.current[activeTabId] = true
    setActiveLogWindowStart(startIndex)
    const top = scrollFrame.scrollHeight
    logScrollTopByTabRef.current[activeTabId] = top
    scrollFrame.scrollTo({ top, behavior: 'smooth' })
    window.requestAnimationFrame(() => {
      applyPendingLogScroll()
    })
  }, [
    activeTabId,
    applyPendingLogScroll,
    logSnapshot.displayLimit,
    logSnapshot.filteredCount,
    setActiveLogWindowStart,
  ])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') {
        return
      }

      event.preventDefault()
      setFindBarOpen(true)
      window.requestAnimationFrame(() => findInputRef.current?.focus())
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!findBarOpen) {
      return
    }
    window.requestAnimationFrame(() => findInputRef.current?.focus())
  }, [activeTabId, findBarOpen])

  useLayoutEffect(() => {
    const scrollFrame = logListRef.current
    if (!scrollFrame) {
      return
    }

    const stickToBottom = logStickToBottomByTabRef.current[activeTabId] ?? true
    if (stickToBottom) {
      const latestWindowStart = Math.max(0, logSnapshot.filteredCount - logSnapshot.displayLimit)
      if (activeLogWindowStart !== latestWindowStart) {
        pendingLogScrollRef.current = 'bottom'
        setActiveLogWindowStart(latestWindowStart)
        return
      }

      scrollFrame.scrollTop = scrollFrame.scrollHeight
      logScrollTopByTabRef.current[activeTabId] = scrollFrame.scrollTop
      pendingLogScrollRef.current = undefined
      return
    }

    if (applyPendingLogScroll()) {
      return
    }

    const maxTop = Math.max(0, scrollFrame.scrollHeight - scrollFrame.clientHeight)
    const nextTop = Math.min(logScrollTopByTabRef.current[activeTabId] ?? 0, maxTop)
    if (scrollFrame.scrollTop !== nextTop) {
      scrollFrame.scrollTop = nextTop
    }
    logScrollTopByTabRef.current[activeTabId] = nextTop
  }, [
    activeLogWindowStart,
    activeTabId,
    applyPendingLogScroll,
    logSnapshot.displayLimit,
    logSnapshot.filteredCount,
    logSnapshot.version,
    setActiveLogWindowStart,
  ])

  useLayoutEffect(() => {
    if (logListRef.current) {
      logListRef.current.scrollLeft = 0
    }
  }, [activeTab.softWrap, activeTab.visibleLogFields, activeTabId])

  useEffect(() => {
    if (!activeTab?.title) {
      return
    }
    const windowTitle = isDetachedWindow ? activeTab.title : `Android Log Desktop - ${activeTab.title}`
    void getCurrentWindow().setTitle(windowTitle)
  }, [activeTab?.title, isDetachedWindow])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    listen(APP_CLOSE_REQUESTED_EVENT, () => {
      setExitConfirmOpen(true)
    })
      .then((callback) => {
        if (disposed) {
          callback()
          return
        }
        unlisten = callback
      })
      .catch((error) => {
        setLogError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.logScheme = logColorScheme
  }, [logColorScheme])

  useEffect(() => {
    writeNumberPreference(LOG_FONT_SIZE_STORAGE_KEY, logFontSize)
  }, [logFontSize])

  useEffect(() => {
    writeNumberPreference(LOG_ROW_PADDING_STORAGE_KEY, logRowPadding)
  }, [logRowPadding])

  useEffect(() => {
    if (isDetachedWindow) {
      return
    }

    writePersistedAppState({
      schemaVersion: 1,
      tabs: tabs.map(serializeTabForPersistence),
      activeTabId,
      nextTabIndex: nextTabIndexRef.current,
      drawerOpen,
      findBarOpen,
      logColorScheme,
      logFontSize,
      logRowPadding,
      theme,
    })
  }, [
    activeTabId,
    drawerOpen,
    findBarOpen,
    isDetachedWindow,
    logColorScheme,
    logFontSize,
    logRowPadding,
    tabs,
    theme,
  ])

  useEffect(() => {
    setDeviceMenuOpen(false)
    setPackageMenuOpen(false)
    setPackageSearch('')
    setLevelMenuOpen(false)
    setTagMenuOpen(false)
    setTagSearch('')
    setContentMenuOpen(false)
    setLogSchemeMenuOpen(false)
    setCellCopyMenu(undefined)
    setEditingTabId('')
    setEditingTabTitle('')
  }, [activeTabId])

  useEffect(() => {
    if (!cellCopyMenu) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && cellCopyMenuRef.current?.contains(event.target)) {
        return
      }
      setCellCopyMenu(undefined)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCellCopyMenu(undefined)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [cellCopyMenu])

  useEffect(() => {
    if (
      !deviceMenuOpen &&
      !packageMenuOpen &&
      !levelMenuOpen &&
      !tagMenuOpen &&
      !contentMenuOpen &&
      !logSchemeMenuOpen
    ) {
      return undefined
    }

    const closeDeviceMenu = () => setDeviceMenuOpen(false)
    const closePackageMenu = () => {
      setPackageMenuOpen(false)
      setPackageSearch('')
    }
    const closeTagMenu = () => {
      setTagMenuOpen(false)
      setTagSearch('')
    }
    const closeLevelMenu = () => setLevelMenuOpen(false)
    const closeContentMenu = () => setContentMenuOpen(false)
    const closeLogSchemeMenu = () => setLogSchemeMenuOpen(false)
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return
      }

      const clickedLogSchemeSelect = logSchemeSelectRef.current?.contains(event.target) ?? false
      const clickedDeviceFilter = deviceFilterRef.current?.contains(event.target) ?? false
      const clickedPackageFilter = packageFilterRef.current?.contains(event.target) ?? false
      const clickedLevelFilter = levelFilterRef.current?.contains(event.target) ?? false
      const clickedTagFilter = tagFilterRef.current?.contains(event.target) ?? false
      const clickedContentFilter = contentFilterRef.current?.contains(event.target) ?? false
      if (logSchemeMenuOpen && !clickedLogSchemeSelect) {
        closeLogSchemeMenu()
      }
      if (deviceMenuOpen && !clickedDeviceFilter) {
        closeDeviceMenu()
      }
      if (packageMenuOpen && !clickedPackageFilter) {
        closePackageMenu()
      }
      if (levelMenuOpen && !clickedLevelFilter) {
        closeLevelMenu()
      }
      if (tagMenuOpen && !clickedTagFilter) {
        closeTagMenu()
      }
      if (contentMenuOpen && !clickedContentFilter) {
        closeContentMenu()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLogSchemeMenu()
        closeDeviceMenu()
        closePackageMenu()
        closeLevelMenu()
        closeTagMenu()
        closeContentMenu()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contentMenuOpen, deviceMenuOpen, levelMenuOpen, logSchemeMenuOpen, packageMenuOpen, tagMenuOpen])

  const updateTab = useCallback((tabId: string, updater: (tab: LogTab) => LogTab) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
  }, [])

  const updateActiveTab = useCallback(
    (updater: (tab: LogTab) => LogTab) => updateTab(activeTabId, updater),
    [activeTabId, updateTab],
  )

  const beginResizeLogColumn = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, field: LogField) => {
      event.preventDefault()
      event.stopPropagation()
      columnResizeRef.current = {
        tabId: activeTab.id,
        field,
        startX: event.clientX,
        startWidth: logColumnWidth(field, activeTab.columnWidths),
      }
      setResizingLogField(field)
    },
    [activeTab.columnWidths, activeTab.id],
  )

  useEffect(() => {
    if (!resizingLogField) {
      return undefined
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (event: PointerEvent) => {
      const drag = columnResizeRef.current
      if (!drag) {
        return
      }

      const nextWidth = drag.startWidth + event.clientX - drag.startX
      updateTab(drag.tabId, (tab) => ({
        ...tab,
        columnWidths: {
          ...tab.columnWidths,
          [drag.field]: clampLogColumnWidth(drag.field, nextWidth),
        },
      }))
    }

    const stopResize = () => {
      columnResizeRef.current = undefined
      setResizingLogField('')
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize, { once: true })
    document.addEventListener('pointercancel', stopResize, { once: true })
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
    }
  }, [resizingLogField, updateTab])

  const showToast = useCallback((message: ToastMessage) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }
    setToast(message)
    toastTimerRef.current = window.setTimeout(() => setToast(undefined), 3600)
  }, [])

  const checkForUpdates = useCallback(
    async (manual = true) => {
      setUpdateCheck((current) => ({
        ...current,
        status: 'checking',
        message: manual ? '正在从 GitHub Release 获取最新版本。' : '正在自动检查 GitHub Release。',
      }))

      try {
        const result: UpdateCheckResult = await checkForAppUpdatesCommand()
        const nextState: UpdateCheckState = {
          status: result.ok ? (result.hasUpdate ? 'available' : 'current') : 'error',
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          releaseUrl: result.releaseUrl || RELEASE_PAGE_URL,
          assetName: result.assetName,
          assetDownloadUrl: result.assetDownloadUrl,
          assetSizeBytes: result.assetSizeBytes,
          checkedAtEpochMs: result.checkedAtEpochMs,
          message: result.ok ? result.message : result.error ?? result.message,
        }
        setUpdateCheck(nextState)

        if (!result.ok) {
          if (manual) {
            showToast({
              id: Date.now(),
              tone: 'danger',
              title: '更新检查失败',
              message: result.error ?? result.message,
            })
          }
        } else if (result.hasUpdate) {
          showToast({
            id: Date.now(),
            tone: 'success',
            title: '发现新版本',
            message: displayVersion(result.latestVersion),
          })
        } else if (manual) {
          showToast({
            id: Date.now(),
            tone: 'success',
            title: '当前已是最新版本',
            message: displayVersion(result.currentVersion),
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setUpdateCheck((current) => ({
          ...current,
          status: 'error',
          releaseUrl: current.releaseUrl ?? RELEASE_PAGE_URL,
          checkedAtEpochMs: Date.now(),
          message,
        }))
        if (manual) {
          showToast({
            id: Date.now(),
            tone: 'danger',
            title: '更新检查失败',
            message,
          })
        }
      }
    },
    [showToast],
  )

  const applyUpdateInstallProgress = useCallback((progress: UpdateInstallProgress) => {
    setUpdateInstall((current) => ({
      open: true,
      status: progress.stage === 'installing' ? 'installing' : 'downloading',
      message: progress.message,
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes ?? current.totalBytes,
      percent: progress.percent ?? current.percent,
      filePath: progress.filePath ?? current.filePath,
    }))
  }, [])

  const openUpdateUrl = useCallback(
    async (url: string | undefined, successTitle: string) => {
      if (!url) {
        showToast({
          id: Date.now(),
          tone: 'danger',
          title: '没有可打开的链接',
        })
        return
      }

      try {
        const result: ExternalOpenResult = await openExternalUrl(url)
        showToast({
          id: Date.now(),
          tone: result.ok ? 'success' : 'danger',
          title: result.ok ? successTitle : '打开链接失败',
          message: result.ok ? undefined : result.error ?? result.message,
        })
      } catch (error) {
        showToast({
          id: Date.now(),
          tone: 'danger',
          title: '打开链接失败',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [showToast],
  )

  const downloadUpdateAsset = useCallback(async () => {
    if (!updateCheck.assetDownloadUrl) {
      showToast({
        id: Date.now(),
        tone: 'danger',
        title: '未找到适配安装包',
        message: '请打开 Release 页面手动选择。',
      })
      return
    }

    setUpdateInstall({
      open: true,
      status: 'downloading',
      message: '准备下载安装包。',
      downloadedBytes: 0,
      totalBytes: updateCheck.assetSizeBytes,
      percent: 0,
      filePath: undefined,
    })

    try {
      const result: UpdateInstallResult = await installUpdate(
        updateCheck.assetDownloadUrl,
        updateCheck.assetName,
      )
      if (!result.ok) {
        throw new Error(result.error ?? result.message)
      }

      setUpdateInstall((current) => ({
        ...current,
        open: true,
        status: 'installing',
        message: result.message,
        percent: 100,
        filePath: result.filePath ?? current.filePath,
      }))
      showToast({
        id: Date.now(),
        tone: 'success',
        title: '安装程序已启动',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUpdateInstall((current) => ({
        ...current,
        open: true,
        status: 'error',
        message,
      }))
      showToast({
        id: Date.now(),
        tone: 'danger',
        title: '更新失败',
        message,
      })
    }
  }, [
    showToast,
    updateCheck.assetDownloadUrl,
    updateCheck.assetName,
    updateCheck.assetSizeBytes,
  ])

  const openReleasePage = useCallback(async () => {
    await openUpdateUrl(updateCheck.releaseUrl ?? RELEASE_PAGE_URL, '已打开 Release 页面')
  }, [openUpdateUrl, updateCheck.releaseUrl])

  const openCellCopyMenu = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>, label: string, text: string) => {
      event.preventDefault()
      event.stopPropagation()
      const menuWidth = 168
      const menuHeight = 44
      setCellCopyMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        label,
        text,
      })
    },
    [],
  )

  const copyCellText = useCallback(async () => {
    if (!cellCopyMenu) {
      return
    }

    try {
      await copyTextToClipboard(cellCopyMenu.text)
      showToast({
        id: Date.now(),
        tone: 'success',
        title: `已复制${cellCopyMenu.label}`,
      })
    } catch (error) {
      showToast({
        id: Date.now(),
        tone: 'danger',
        title: '复制失败',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setCellCopyMenu(undefined)
    }
  }, [cellCopyMenu, showToast])

  const beginRenameTab = useCallback((tab: LogTab) => {
    setEditingTabId(tab.id)
    setEditingTabTitle(tab.title)
    window.requestAnimationFrame(() => tabTitleInputRef.current?.select())
  }, [])

  const cancelRenameTab = useCallback(() => {
    setEditingTabId('')
    setEditingTabTitle('')
  }, [])

  const commitRenameTab = useCallback(() => {
    const tabId = editingTabId
    const nextTitle = editingTabTitle.trim().slice(0, 80)
    if (tabId && nextTitle) {
      updateTab(tabId, (tab) => ({ ...tab, title: nextTitle }))
    }
    setEditingTabId('')
    setEditingTabTitle('')
  }, [editingTabId, editingTabTitle, updateTab])

  const handleRenameSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      commitRenameTab()
    },
    [commitRenameTab],
  )

  const refreshProcesses = useCallback(
    async (tabId: string, serial: string) => {
      if (!serial) {
        return
      }

      updateTab(tabId, (tab) => ({
        ...tab,
        loadingProcessesBySerial: { ...tab.loadingProcessesBySerial, [serial]: true },
        processErrorsBySerial: { ...tab.processErrorsBySerial, [serial]: '' },
      }))
      try {
        const result = await listAdbProcesses(serial)
        updateTab(tabId, (tab) => ({
          ...tab,
          processesBySerial: { ...tab.processesBySerial, [serial]: result.processes },
          processErrorsBySerial: {
            ...tab.processErrorsBySerial,
            [serial]: result.ok ? '' : result.error ?? '读取进程列表失败',
          },
          loadingProcessesBySerial: { ...tab.loadingProcessesBySerial, [serial]: false },
        }))
      } catch (error) {
        updateTab(tabId, (tab) => ({
          ...tab,
          processesBySerial: { ...tab.processesBySerial, [serial]: [] },
          processErrorsBySerial: {
            ...tab.processErrorsBySerial,
            [serial]: error instanceof Error ? error.message : String(error),
          },
          loadingProcessesBySerial: { ...tab.loadingProcessesBySerial, [serial]: false },
        }))
      }
    },
    [updateTab],
  )

  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true)
    setDeviceError('')

    try {
      const result = await listAdbDevices()
      const nextDevices = result.devices ?? []
      const nextOnlineDevices = nextDevices.filter((device) => device.state === 'device')
      const nextOnlineSerials = nextOnlineDevices.map((device) => device.serial)

      setAdbInfo(result.adb)
      setDevices(nextDevices)
      setTabs((current) => current.map((tab) => reconcileTabDevices(tab, nextOnlineSerials)))

      if (!result.ok) {
        setDeviceError(result.error ?? '读取设备列表失败')
      }
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error))
      setDevices([])
      setTabs((current) =>
        current.map((tab) => reconcileTabDevices(tab, [])),
      )
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  const startTabLogcat = useCallback(
    async (
      tabId: string,
      clearBeforeStart: boolean,
      options: { preservePaused?: boolean } = {},
      selectedSerialsOverride?: string[],
    ) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      const selectedSerials = normalizeSelectedSerials(selectedSerialsOverride ?? tab?.selectedSerials ?? [])
      if (!tab || selectedSerials.length === 0) {
        return
      }

      await stopLogcatSessions(tab.sessions)
      if (clearBeforeStart) {
        resetLogWindowForTab(tabId, { stickToBottom: true })
        tab.store.clear()
      }

      setLogError('')
      setStartingTabId(tabId)
      try {
        const results = await Promise.allSettled(selectedSerials.map((serial) => startLogcat(serial)))
        const nextSessions: LogcatSessionInfo[] = []
        const errors: string[] = []

        results.forEach((result, index) => {
          const serial = selectedSerials[index]
          if (result.status === 'fulfilled') {
            nextSessions.push(result.value)
          } else {
            const reason = result.reason
            errors.push(
              `${deviceLabelForSerial(serial, onlineDevices)}：${
                reason instanceof Error ? reason.message : String(reason)
              }`,
            )
          }
        })

        if (errors.length > 0) {
          setLogError(errors.join(' / '))
        }

        updateTab(tabId, (current) => ({
          ...current,
          selectedSerials,
          sessions: nextSessions,
          visibleLogFields: reconcileLogFieldsForDeviceSelection(
            current.visibleLogFields,
            selectedSerials,
            current.deviceFieldManuallyConfigured,
          ),
          paused: options.preservePaused ? current.paused : false,
          restoreSessionRunning: false,
        }))
      } catch (error) {
        setLogError(error instanceof Error ? error.message : String(error))
        updateTab(tabId, (current) => ({
          ...current,
          sessions: [],
          paused: options.preservePaused ? current.paused : false,
          restoreSessionRunning: false,
        }))
      } finally {
        setStartingTabId('')
      }
    },
    [onlineDevices, resetLogWindowForTab, updateTab],
  )

  const handleStartPause = useCallback(() => {
    if (!isRunning) {
      void startTabLogcat(activeTab.id, activeTab.store.getSnapshot().totalCount === 0)
      return
    }
    updateActiveTab((tab) => ({ ...tab, paused: !tab.paused }))
  }, [activeTab, isRunning, startTabLogcat, updateActiveTab])

  const handleRestart = useCallback(() => {
    void startTabLogcat(activeTab.id, true)
  }, [activeTab.id, startTabLogcat])

  const toggleDevice = useCallback(
    (serial: string) => {
      const currentTab = tabsRef.current.find((tab) => tab.id === activeTab.id) ?? activeTab
      const selected = new Set(currentTab.selectedSerials)
      if (selected.has(serial)) {
        if (selected.size <= 1) {
          return
        }
        selected.delete(serial)
      } else {
        selected.add(serial)
      }

      const nextSerials = onlineDevices
        .map((device) => device.serial)
        .filter((deviceSerial) => selected.has(deviceSerial))

      updateActiveTab((tab) => {
        const processes = processesForSelectedDevices(tab.processesBySerial, nextSerials)
        return {
          ...tab,
          selectedSerials: nextSerials,
          deviceSelectionManuallyConfigured: true,
          selectedPackages: pruneSelectedPackages(tab.selectedPackages, processes),
          visibleLogFields: reconcileLogFieldsForDeviceSelection(
            tab.visibleLogFields,
            nextSerials,
            tab.deviceFieldManuallyConfigured,
          ),
        }
      })

      for (const nextSerial of nextSerials) {
        if (
          !currentTab.processesBySerial[nextSerial] &&
          !currentTab.loadingProcessesBySerial[nextSerial]
        ) {
          void refreshProcesses(activeTab.id, nextSerial)
        }
      }

      if (currentTab.sessions.some((session) => session.running)) {
        void startTabLogcat(activeTab.id, false, { preservePaused: true }, nextSerials)
      }
    },
    [activeTab, onlineDevices, refreshProcesses, startTabLogcat, updateActiveTab],
  )

  const handleClearLogs = useCallback(() => {
    resetLogWindowForTab(activeTab.id, { stickToBottom: true })
    activeTab.store.clear()
  }, [activeTab.id, activeTab.store, resetLogWindowForTab])

  const handleExportLogs = useCallback(async () => {
    setIsExporting(true)

    try {
      const result = await exportLogs(activeTab.store.getExportContent())
      try {
        await revealExportFile(result.filePath)
        showToast({
          id: Date.now(),
          tone: 'success',
          title: '已导出日志',
          message: result.filePath,
        })
      } catch (error) {
        showToast({
          id: Date.now(),
          tone: 'success',
          title: '已导出日志',
          message: `打开文件管理器失败：${error instanceof Error ? error.message : String(error)}`,
        })
      }
    } catch (error) {
      showToast({
        id: Date.now(),
        tone: 'danger',
        title: '导出失败',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsExporting(false)
    }
  }, [activeTab.store, showToast])

  const handleExitApp = useCallback(async () => {
    setClosingApp(true)
    try {
      await Promise.all(tabsRef.current.map((tab) => stopLogcatSessions(tab.sessions)))
      await closeApp()
    } catch (error) {
      setClosingApp(false)
      setExitConfirmOpen(false)
      setLogError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const handleMinimizeApp = useCallback(async () => {
    setExitConfirmOpen(false)
    try {
      await getCurrentWindow().minimize()
    } catch (error) {
      setLogError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const togglePackage = useCallback(
    (packageName: string) => {
      updateActiveTab((tab) => {
        const selected = new Set(tab.selectedPackages)
        if (selected.has(packageName)) {
          selected.delete(packageName)
        } else {
          selected.add(packageName)
        }
        return {
          ...tab,
          selectedPackages: [...selected],
        }
      })
    },
    [updateActiveTab],
  )

  const toggleLevel = useCallback(
    (level: LogLevel) => {
      updateActiveTab((tab) => {
        const selected = new Set(tab.selectedLevels)
        if (selected.has(level)) {
          selected.delete(level)
        } else {
          selected.add(level)
        }
        return {
          ...tab,
          selectedLevels: [...selected],
        }
      })
    },
    [updateActiveTab],
  )

  const toggleTag = useCallback(
    (tag: string) => {
      updateActiveTab((tab) => {
        const selected = new Set(tab.selectedTags)
        if (selected.has(tag)) {
          selected.delete(tag)
        } else {
          selected.add(tag)
        }
        return {
          ...tab,
          selectedTags: [...selected],
        }
      })
    },
    [updateActiveTab],
  )

  const toggleLogField = useCallback(
    (field: LogField) => {
      const option = LOG_FIELD_OPTIONS.find((item) => item.value === field)
      if (option?.required) {
        return
      }

      updateActiveTab((tab) => {
        const selected = new Set(tab.visibleLogFields)
        if (selected.has(field)) {
          selected.delete(field)
        } else {
          selected.add(field)
        }
        selected.add('message')
        return {
          ...tab,
          deviceFieldManuallyConfigured:
            field === 'device' ? true : tab.deviceFieldManuallyConfigured,
          visibleLogFields: ALL_LOG_FIELDS.filter((item) => selected.has(item)),
        }
      })
    },
    [updateActiveTab],
  )

  const toggleSearchOption = useCallback(
    (option: keyof LogSearchOptions) => {
      updateActiveTab((tab) => ({
        ...tab,
        searchOptions: {
          ...tab.searchOptions,
          [option]: !tab.searchOptions[option],
        },
      }))
    },
    [updateActiveTab],
  )

  const toggleFindOption = useCallback(
    (option: keyof LogSearchOptions) => {
      updateActiveTab((tab) => ({
        ...tab,
        findOptions: {
          ...tab.findOptions,
          [option]: !tab.findOptions[option],
        },
      }))
    },
    [updateActiveTab],
  )

  const addTab = useCallback(() => {
    const nextIndex = nextTabIndexRef.current
    nextTabIndexRef.current += 1
    const tab = createLogTab(nextIndex, onlineDevices.map((device) => device.serial))
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }, [onlineDevices])

  const removeTabFromMain = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length === 1) {
          const replacement = createLogTab(
            nextTabIndexRef.current,
            onlineDevices.map((device) => device.serial),
          )
          nextTabIndexRef.current += 1
          setActiveTabId(replacement.id)
          return [replacement]
        }
        const nextTabs = current.filter((item) => item.id !== tabId)
        if (activeTabId === tabId) {
          setActiveTabId(nextTabs[0].id)
        }
        return nextTabs
      })
    },
    [activeTabId, onlineDevices],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (tab?.sessions.length) {
        void stopLogcatSessions(tab.sessions)
      }
      removeTabFromMain(tabId)
    },
    [removeTabFromMain],
  )

  const moveTab = useCallback((sourceTabId: string, targetTabId: string, placement: 'before' | 'after') => {
    if (!sourceTabId || sourceTabId === targetTabId) {
      return
    }

    setTabs((current) => {
      const sourceIndex = current.findIndex((tab) => tab.id === sourceTabId)
      const targetIndex = current.findIndex((tab) => tab.id === targetTabId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return current
      }

      const sourceTab = current[sourceIndex]
      const nextTabs = current.filter((tab) => tab.id !== sourceTabId)
      const nextTargetIndex = nextTabs.findIndex((tab) => tab.id === targetTabId)
      nextTabs.splice(placement === 'after' ? nextTargetIndex + 1 : nextTargetIndex, 0, sourceTab)
      return nextTabs
    })
  }, [])

  const detachTab = useCallback(
    async (tabId: string) => {
      if (isDetachedWindow || detachingTabId) {
        return
      }

      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) {
        return
      }

      let transferId = ''
      setDetachingTabId(tabId)
      setLogError('')

      try {
        const wasRunning = tab.sessions.some((session) => session.running)
        const wasPaused = tab.paused
        await stopLogcatSessions(tab.sessions)

        const latestTab = tabsRef.current.find((item) => item.id === tabId) ?? tab
        const payload = serializeTabForTransfer(
          {
            ...latestTab,
            sessions: [],
            paused: wasPaused,
          },
          wasRunning,
        )
        transferId = createTransferId('detached', tabId)
        await putTabTransfer(transferId, JSON.stringify(payload))

        const detachedWindow = new WebviewWindow(transferId, {
          url: detachedWindowUrl(transferId),
          title: payload.title,
          width: 1280,
          height: 820,
          minWidth: 1040,
          minHeight: 680,
          resizable: true,
        })
        await waitForWindowCreated(detachedWindow)
        removeTabFromMain(tabId)
      } catch (error) {
        if (transferId) {
          void clearTabTransfer(transferId)
        }
        setLogError(error instanceof Error ? error.message : String(error))
      } finally {
        setDetachingTabId('')
      }
    },
    [detachingTabId, isDetachedWindow, removeTabFromMain],
  )

  const returnTabToMain = useCallback(async () => {
    if (!isDetachedWindow || returningToMain) {
      return
    }

    let transferId = ''
    setReturningToMain(true)
    setLogError('')

    try {
      const wasRunning = activeTab.sessions.some((session) => session.running)
      const wasPaused = activeTab.paused
      await stopLogcatSessions(activeTab.sessions)

      const latestTab = tabsRef.current.find((item) => item.id === activeTab.id) ?? activeTab
      const payload = serializeTabForTransfer(
        {
          ...latestTab,
          sessions: [],
          paused: wasPaused,
        },
        wasRunning,
      )
      transferId = createTransferId('reattach', activeTab.id)
      await putTabTransfer(transferId, JSON.stringify(payload))
      await emitTo<TabTransferEventPayload>('main', REATTACH_TAB_EVENT, { transferId })
      await getCurrentWindow().close()
    } catch (error) {
      if (transferId) {
        void clearTabTransfer(transferId)
      }
      setLogError(error instanceof Error ? error.message : String(error))
      setReturningToMain(false)
    }
  }, [activeTab, isDetachedWindow, returningToMain])

  const handleTabDragStart = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
      if (isDetachedWindow || detachingTabId) {
        event.preventDefault()
        return
      }

      draggedTabIdRef.current = tabId
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', tabId)
    },
    [detachingTabId, isDetachedWindow],
  )

  const handleTabDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
    const sourceTabId = draggedTabIdRef.current
    if (!sourceTabId || sourceTabId === tabId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverTabId(tabId)
  }, [])

  const handleTabDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
      event.preventDefault()
      const targetBounds = event.currentTarget.getBoundingClientRect()
      const placement = event.clientX > targetBounds.left + targetBounds.width / 2 ? 'after' : 'before'
      moveTab(draggedTabIdRef.current, tabId, placement)
      draggedTabIdRef.current = ''
      setDragOverTabId('')
    },
    [moveTab],
  )

  const handleTabDragEnd = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const tabId = draggedTabIdRef.current
      draggedTabIdRef.current = ''
      setDragOverTabId('')

      const endedOutsideWindow =
        event.clientX < 0 ||
        event.clientY < 0 ||
        event.clientX > window.innerWidth ||
        event.clientY > window.innerHeight ||
        event.screenX < window.screenX ||
        event.screenY < window.screenY ||
        event.screenX > window.screenX + window.outerWidth ||
        event.screenY > window.screenY + window.outerHeight

      if (tabId && endedOutsideWindow) {
        void detachTab(tabId)
      }
    },
    [detachTab],
  )

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  useEffect(() => {
    if (isDetachedWindow || updateAutoCheckStartedRef.current) {
      return
    }
    updateAutoCheckStartedRef.current = true
    void checkForUpdates(false)
  }, [checkForUpdates, isDetachedWindow])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    listenUpdateInstallProgress(applyUpdateInstallProgress).then((callback) => {
      if (disposed) {
        callback()
        return
      }
      unlisten = callback
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyUpdateInstallProgress])

  useEffect(() => {
    for (const serial of activeTab.selectedSerials) {
      if (!activeTab.processesBySerial[serial] && !activeTab.loadingProcessesBySerial[serial]) {
        void refreshProcesses(activeTab.id, serial)
      }
    }
  }, [
    activeTab.id,
    activeTab.loadingProcessesBySerial,
    activeTab.processesBySerial,
    activeTab.selectedSerials,
    refreshProcesses,
  ])

  useEffect(() => {
    if (
      !autoStartPendingRef.current ||
      isDetachedWindow ||
      loadingDevices ||
      !adbInfo?.available ||
      onlineDevices.length === 0 ||
      startingTabId === activeTab.id ||
      activeTab.sessions.some((session) => session.running) ||
      activeTab.selectedSerials.length === 0
    ) {
      return
    }

    autoStartPendingRef.current = false
    void startTabLogcat(activeTab.id, false)
  }, [
    activeTab.id,
    activeTab.selectedSerials,
    activeTab.sessions,
    adbInfo?.available,
    isDetachedWindow,
    loadingDevices,
    onlineDevices.length,
    startTabLogcat,
    startingTabId,
  ])

  useEffect(() => {
    const pendingTab = tabs.find(
      (tab) =>
        tab.restoreSessionRunning &&
        !tab.sessions.some((session) => session.running) &&
        startingTabId !== tab.id,
    )
    if (!pendingTab) {
      return
    }
    if (pendingTab.selectedSerials.length === 0) {
      updateTab(pendingTab.id, (tab) => ({ ...tab, restoreSessionRunning: false }))
      return
    }

    void startTabLogcat(pendingTab.id, false, { preservePaused: true })
  }, [startingTabId, startTabLogcat, tabs, updateTab])

  useEffect(() => {
    resetLogWindowForTab(activeTab.id)
    activeTab.store.setQuery({
      levels: activeTab.selectedLevels,
      includeText: activeTab.searchText,
      searchOptions: activeTab.searchOptions,
      tags: activeTab.selectedTags,
      devices: activeTab.selectedSerials.length > 0 ? activeTab.selectedSerials : ['__no_device_selected__'],
      pidDeviceKeys: packagePidDeviceKeys(activeProcesses, activeTab.selectedPackages),
    })
  }, [
    activeTab.id,
    activeTab.searchOptions,
    activeTab.searchText,
    activeTab.selectedPackages,
    activeTab.selectedLevels,
    activeTab.selectedSerials,
    activeTab.selectedTags,
    activeTab.store,
    activeProcesses,
    resetLogWindowForTab,
  ])

  useEffect(() => {
    let disposed = false
    const unlistenCallbacks: Array<() => void> = []

    Promise.all([
      listenLogcatBatch((payload) => {
        const tab = tabsRef.current.find((item) =>
          item.sessions.some((session) => session.sessionId === payload.sessionId),
        )
        const session = tab?.sessions.find((item) => item.sessionId === payload.sessionId)
        if (!tab || !session || tab.paused) {
          return
        }

        tab.store.appendRawBatch({
          sessionId: payload.sessionId,
          lines: payload.lines,
          deviceSerial: session.serial,
        })
      }),
      listenLogcatError((payload) => {
        const tab = tabsRef.current.find((item) =>
          item.sessions.some((session) => session.sessionId === payload.sessionId),
        )
        if (tab) {
          setLogError(payload.message)
        }
      }),
      listenLogcatStopped((payload) => {
        const tab = tabsRef.current.find((item) =>
          item.sessions.some((session) => session.sessionId === payload.sessionId),
        )
        if (!tab) {
          return
        }
        updateTab(tab.id, (current) => {
          const sessions = current.sessions.filter((session) => session.sessionId !== payload.sessionId)
          return { ...current, sessions, paused: sessions.length > 0 ? current.paused : false }
        })
      }),
    ]).then((callbacks) => {
      if (disposed) {
        callbacks.forEach((callback) => callback())
        return
      }
      unlistenCallbacks.push(...callbacks)
    })

    return () => {
      disposed = true
      unlistenCallbacks.forEach((callback) => callback())
      for (const tab of tabsRef.current) {
        if (tab.sessions.length) {
          void stopLogcatSessions(tab.sessions)
        }
      }
    }
  }, [updateTab])

  const updateChecking = updateCheck.status === 'checking'
  const updateInstalling = updateInstall.status === 'downloading' || updateInstall.status === 'installing'
  const updateLastChecked = formatCheckedTime(updateCheck.checkedAtEpochMs)
  const updatePercentLabel = formatPercent(updateInstall.percent)
  const updateProgressWidth = `${Math.max(4, Math.min(100, updateInstall.percent ?? 12))}%`
  const updateDownloadedLabel = formatBytes(updateInstall.downloadedBytes)
  const updateTotalLabel = formatBytes(updateInstall.totalBytes)
  const updateActionIsInstall = updateCheck.status === 'available'
  const updateActionDisabled =
    updateChecking ||
    updateInstalling ||
    (updateActionIsInstall && !updateCheck.assetDownloadUrl)
  const updateActionLabel = updateInstalling
    ? '更新中'
    : updateActionIsInstall
      ? '更新'
      : updateChecking
        ? '检查中'
        : '检查更新'

  return (
    <main className="app-shell">
      {exitConfirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
            <div>
              <h2 id="exit-confirm-title">关闭 Android Log Desktop？</h2>
              <p>退出前会停止正在运行的 adb logcat 命令。选择最小化会保留当前监听状态。</p>
            </div>
            <div className="confirm-actions">
              <button
                className="danger-button"
                disabled={closingApp}
                onClick={() => void handleExitApp()}
                type="button"
              >
                {closingApp ? '正在退出...' : '退出应用'}
              </button>
              <button disabled={closingApp} onClick={() => void handleMinimizeApp()} type="button">
                最小化
              </button>
              <button disabled={closingApp} onClick={() => setExitConfirmOpen(false)} type="button">
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {updateInstall.open ? (
        <div className="modal-backdrop" role="presentation">
          <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
            <div className="update-dialog-header">
              <div>
                <h2 id="update-dialog-title">
                  {updateInstall.status === 'error' ? '更新失败' : '正在更新 Android Log Desktop'}
                </h2>
                <p>{updateInstall.message}</p>
              </div>
              {updateInstall.status === 'error' ? (
                <button
                  className="icon-button"
                  onClick={() => setUpdateInstall((current) => ({ ...current, open: false }))}
                  type="button"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <div
              className="update-progress-track"
              role="progressbar"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={
                typeof updateInstall.percent === 'number' ? Math.round(updateInstall.percent) : undefined
              }
            >
              <span
                className={updatePercentLabel ? undefined : 'indeterminate'}
                style={{ width: updateProgressWidth }}
              />
            </div>
            <div className="update-progress-meta">
              <span>
                {updateDownloadedLabel}
                {updateTotalLabel ? ` / ${updateTotalLabel}` : ''}
              </span>
              <strong>{updatePercentLabel ?? '下载中'}</strong>
            </div>
            {updateInstall.filePath ? (
              <p className="update-file-path" title={updateInstall.filePath}>
                {updateInstall.filePath}
              </p>
            ) : null}
            {updateInstall.status === 'error' ? (
              <div className="confirm-actions">
                <button
                  onClick={() => setUpdateInstall((current) => ({ ...current, open: false }))}
                  type="button"
                >
                  关闭
                </button>
                <button onClick={() => void openReleasePage()} type="button">
                  打开 Release 页面
                </button>
              </div>
            ) : (
              <p className="hint-text">下载完成后会自动启动安装流程，安装前会停止正在运行的 logcat。</p>
            )}
          </section>
        </div>
      ) : null}
      {drawerOpen ? <button className="drawer-backdrop" onClick={() => setDrawerOpen(false)} /> : null}
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="brand">
          <img className="brand-icon" src={appIconUrl} alt="" />
          <div>
            <strong>Android Log</strong>
            <span>Desktop</span>
          </div>
          <button className="icon-button drawer-close" onClick={() => setDrawerOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <section className={`sidebar-section update-section update-${updateCheck.status}`}>
          <p className="section-label">软件更新</p>
          <div className="update-summary">
            <span className="update-indicator" />
            <div>
              <strong>{updateStatusTitle(updateCheck.status)}</strong>
              <span>{updateCheck.message}</span>
            </div>
          </div>
          <div className="update-version-grid">
            <div>
              <span>当前版本</span>
              <strong>{displayVersion(updateCheck.currentVersion)}</strong>
            </div>
            <div>
              <span>最新版本</span>
              <strong>{displayVersion(updateCheck.latestVersion)}</strong>
            </div>
          </div>
          {updateCheck.assetName ? (
            <p className="hint-text" title={updateCheck.assetName}>
              适配包 {updateCheck.assetName}
              {updateCheck.assetSizeBytes ? ` · ${formatBytes(updateCheck.assetSizeBytes)}` : ''}
            </p>
          ) : null}
          {updateLastChecked ? <p className="hint-text">最近检查 {updateLastChecked}</p> : null}
          <div className="utility-actions">
            <button
              disabled={updateActionDisabled}
              onClick={() => {
                if (updateActionIsInstall) {
                  void downloadUpdateAsset()
                } else {
                  void checkForUpdates(true)
                }
              }}
              type="button"
            >
              {updateActionIsInstall || updateInstalling ? <Download size={15} /> : <RefreshCcw size={15} />}
              {updateActionLabel}
            </button>
            <button disabled={updateInstalling} onClick={() => void openReleasePage()} type="button">
              <ExternalLink size={15} />
              Release 页面
            </button>
          </div>
        </section>

        <section className="sidebar-section">
          <p className="section-label">外观</p>
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'light' ? '切换暗色' : '切换亮色'}
          </button>
          <div className="theme-select-control" ref={logSchemeSelectRef}>
            <button
              aria-expanded={logSchemeMenuOpen}
              className={`theme-select-trigger ${logSchemeMenuOpen ? 'open' : ''}`}
              onClick={() => setLogSchemeMenuOpen((open) => !open)}
              type="button"
            >
              <span>日志配色</span>
              <strong>{LOG_COLOR_SCHEME_LABELS[logColorScheme]}</strong>
              <ChevronDown className="theme-select-chevron" size={16} />
            </button>
            {logSchemeMenuOpen ? (
              <div className="theme-select-menu" role="listbox">
                {Object.entries(LOG_COLOR_SCHEME_LABELS).map(([value, label]) => {
                  const selected = value === logColorScheme
                  return (
                    <button
                      aria-selected={selected}
                      className={`theme-select-option ${selected ? 'selected' : ''}`}
                      key={value}
                      onClick={() => {
                        setLogColorScheme(value as LogColorScheme)
                        setLogSchemeMenuOpen(false)
                      }}
                      role="option"
                      type="button"
                    >
                      <span className="theme-select-check">{selected ? <Check size={16} /> : null}</span>
                      日志配色：{label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <label className="preference-control">
            <span className="preference-heading">
              <span>日志字号</span>
              <strong>{logFontSize}px</strong>
            </span>
            <input
              max={LOG_FONT_SIZE_RANGE.max}
              min={LOG_FONT_SIZE_RANGE.min}
              onChange={(event) =>
                setLogFontSize(
                  clampNumber(Number(event.target.value), LOG_FONT_SIZE_RANGE.min, LOG_FONT_SIZE_RANGE.max),
                )
              }
              step={1}
              type="range"
              value={logFontSize}
            />
            <span className="preference-scale">
              <span>小</span>
              <span>大</span>
            </span>
          </label>
          <label className="preference-control">
            <span className="preference-heading">
              <span>行内边距</span>
              <strong>{logRowPadding}px</strong>
            </span>
            <input
              max={LOG_ROW_PADDING_RANGE.max}
              min={LOG_ROW_PADDING_RANGE.min}
              onChange={(event) =>
                setLogRowPadding(
                  clampNumber(Number(event.target.value), LOG_ROW_PADDING_RANGE.min, LOG_ROW_PADDING_RANGE.max),
                )
              }
              step={1}
              type="range"
              value={logRowPadding}
            />
            <span className="preference-scale">
              <span>紧凑</span>
              <span>舒展</span>
            </span>
          </label>
        </section>

        <section className="sidebar-section">
          <p className="section-label">ADB</p>
          <div className={`adb-status ${adbInfo?.available ? 'available' : 'unavailable'}`}>
            {adbInfo?.available ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{adbInfo?.available ? '已就绪' : '未找到'}</span>
          </div>
          {adbInfo?.path ? <code className="path-line">{adbInfo.path}</code> : null}
        </section>

      </aside>

      <section className="workspace">
        <div className="tab-strip">
          {tabs.map((tab) => (
            <div
              className={`tab-button ${tab.id === activeTab.id ? 'active' : ''} ${
                dragOverTabId === tab.id ? 'drag-over' : ''
              } ${detachingTabId === tab.id ? 'pending' : ''}`}
              draggable={!isDetachedWindow && !detachingTabId && editingTabId !== tab.id}
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              onDoubleClick={() => beginRenameTab(tab)}
              onDragEnd={handleTabDragEnd}
              onDragLeave={() => {
                if (dragOverTabId === tab.id) {
                  setDragOverTabId('')
                }
              }}
              onDragOver={(event) => handleTabDragOver(event, tab.id)}
              onDragStart={(event) => handleTabDragStart(event, tab.id)}
              onDrop={(event) => handleTabDrop(event, tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActiveTabId(tab.id)
                }
              }}
              role="button"
              tabIndex={0}
            >
              {editingTabId === tab.id ? (
                <form
                  className="tab-title-form"
                  onBlur={commitRenameTab}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onSubmit={handleRenameSubmit}
                >
                  <input
                    ref={tabTitleInputRef}
                    onChange={(event) => setEditingTabTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRenameTab()
                      }
                    }}
                    value={editingTabTitle}
                  />
                </form>
              ) : (
                <span className="tab-title">{tab.title}</span>
              )}
              {detachingTabId === tab.id ? (
                <small>分离中</small>
              ) : tab.sessions.some((session) => session.running) ? (
                <small>{tab.paused ? '暂停' : `运行 ${tab.sessions.length}`}</small>
              ) : null}
              {!isDetachedWindow ? (
                <>
                  <button
                    aria-label="分离日志页"
                    className="tab-action-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void detachTab(tab.id)
                    }}
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    aria-label="关闭日志页"
                    className="tab-action-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(tab.id)
                    }}
                  >
                    <X size={14} />
                  </button>
                </>
              ) : null}
            </div>
          ))}
          {!isDetachedWindow ? (
            <button className="tab-add" onClick={addTab}>
              <Plus size={16} />
            </button>
          ) : null}
        </div>

        <header className="toolbar">
          <div className="title-row">
            <button className="icon-button" onClick={() => setDrawerOpen(true)} title="打开设备与筛选抽屉">
              <Menu size={18} />
            </button>
            <div>
              <h1>{activeTab.title}</h1>
              <p>{selectedDeviceSummary(activeTab.selectedSerials, onlineDevices)}</p>
            </div>
          </div>
          <div className="toolbar-metrics" aria-label="日志状态">
            <span>
              缓存 <strong>{logSnapshot.totalCount.toLocaleString()}</strong>
            </span>
            <span>
              筛选 <strong>{logSnapshot.filteredCount.toLocaleString()}</strong>
            </span>
            <span>
              淘汰 <strong>{logSnapshot.droppedCount.toLocaleString()}</strong>
            </span>
          </div>
          <div className="toolbar-actions">
            {isDetachedWindow ? (
              <button className="primary" disabled={returningToMain} onClick={returnTabToMain}>
                <Undo2 size={16} />
                {returningToMain ? '回归中' : '回归主窗'}
              </button>
            ) : null}
            <button disabled={!hasSelectedDevice || isStarting} onClick={handleStartPause}>
              {isRunning && !activeTab.paused ? <Pause size={16} /> : <Play size={16} />}
              {!isRunning ? (isStarting ? '启动中' : '开始') : activeTab.paused ? '继续' : '暂停'}
            </button>
            <button disabled={!hasSelectedDevice || isStarting} onClick={handleRestart}>
              <RotateCcw size={16} />
              Restart
            </button>
            <button disabled={logSnapshot.totalCount === 0} onClick={handleClearLogs}>
              <Trash2 size={16} />
              清理
            </button>
            <button onClick={scrollLogToTop}>
              <ArrowUpToLine size={16} />
              滚顶
            </button>
            <button onClick={scrollLogToBottom}>
              <ArrowDownToLine size={16} />
              滚底
            </button>
            <button
              className={activeTab.softWrap ? 'active-toggle' : ''}
              onClick={() => updateActiveTab((tab) => ({ ...tab, softWrap: !tab.softWrap }))}
            >
              <WrapText size={16} />
              Soft-wrap
            </button>
            <button disabled={logSnapshot.filteredCount === 0 || isExporting} onClick={handleExportLogs}>
              <Download size={16} />
              {isExporting ? '导出中' : '导出'}
            </button>
          </div>
        </header>

        {deviceError ? (
          <section className="notice danger">
            <AlertTriangle size={18} />
            <div>
              <strong>{deviceError}</strong>
              {adbInfo?.installHint ? <span>{adbInfo.installHint}</span> : null}
            </div>
          </section>
        ) : null}

        {logError ? (
          <section className="notice danger">
            <AlertTriangle size={18} />
            <div>
              <strong>Logcat</strong>
              <span>{logError}</span>
            </div>
          </section>
        ) : null}

        {!adbInfo?.available && adbInfo?.checkedPaths.length ? (
          <section className="notice">
            <span className="notice-dot" />
            <div>
              <strong>ADB 检测路径</strong>
              <span>{adbInfo.checkedPaths.join(' / ')}</span>
            </div>
          </section>
        ) : null}

        <div className="filter-row">
          <div className="filter-popover-anchor" ref={deviceFilterRef}>
            <button
              className="filter-trigger"
              onClick={() => {
                setDeviceMenuOpen((open) => !open)
                setPackageMenuOpen(false)
                setLevelMenuOpen(false)
                setTagMenuOpen(false)
                setContentMenuOpen(false)
              }}
            >
              <Usb size={16} />
              {deviceFilterLabel(activeTab.selectedSerials, onlineDevices)}
            </button>
            {deviceMenuOpen ? (
              <div className="filter-popover filter-popover-narrow">
                <div className="popover-header">
                  <strong>设备</strong>
                  <button className="icon-button" onClick={() => setDeviceMenuOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="popover-actions">
                  <span>{onlineDevices.length} 台在线设备</span>
                  <button disabled={loadingDevices} onClick={refreshDevices}>
                    <RefreshCcw size={16} />
                    {loadingDevices ? '刷新中' : '刷新'}
                  </button>
                </div>
                <div className="filter-option-list">
                  {onlineDevices.length > 0 ? (
                    onlineDevices.map((device) => {
                      const checked = selectedSerialSet.has(device.serial)
                      const locked = checked && activeTab.selectedSerials.length <= 1
                      return (
                        <button
                          className={`filter-option ${checked ? 'selected' : ''}`}
                          disabled={locked}
                          key={device.serial}
                          onClick={() => toggleDevice(device.serial)}
                        >
                          <input readOnly checked={checked} disabled={locked} type="checkbox" />
                          <span>
                            <strong>{deviceTitle(device)}</strong>
                            <small>{deviceSubtitle(device)}</small>
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="popover-empty">未连接可用设备</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="filter-popover-anchor" ref={packageFilterRef}>
            <button
              className="filter-trigger"
              onClick={() => {
                setPackageMenuOpen((open) => !open)
                setDeviceMenuOpen(false)
                setLevelMenuOpen(false)
                setTagMenuOpen(false)
                setContentMenuOpen(false)
              }}
            >
              <Package size={16} />
              包名 {countSuffix(activeTab.selectedPackages.length)}
            </button>
            {packageMenuOpen ? (
              <div className="filter-popover">
                <div className="popover-header">
                  <strong>包名 / 进程</strong>
                  <button className="icon-button" onClick={() => setPackageMenuOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="popover-search-row">
                  <label className="search-field popover-search">
                    <Search size={16} />
                    <input
                      autoFocus
                      onChange={(event) => setPackageSearch(event.target.value)}
                      placeholder="搜索包名或进程"
                      value={packageSearch}
                    />
                  </label>
                  <button
                    className="popover-clear-button"
                    disabled={activeTab.selectedPackages.length === 0 && packageSearch.length === 0}
                    onClick={() => {
                      setPackageSearch('')
                      updateActiveTab((tab) => ({ ...tab, selectedPackages: [] }))
                    }}
                  >
                    清理
                  </button>
                </div>
                <div className="popover-actions">
                  <span>{packages.length} 个进程</span>
                  <button
                    disabled={activeTab.selectedSerials.length === 0 || loadingProcesses}
                    onClick={() => {
                      for (const serial of activeTab.selectedSerials) {
                        void refreshProcesses(activeTab.id, serial)
                      }
                    }}
                  >
                    <RefreshCcw size={16} />
                    {loadingProcesses ? '读取中' : '刷新'}
                  </button>
                </div>
                {processError ? <span className="inline-error">{processError}</span> : null}
                <div className="filter-option-list">
                  {visiblePackages.length > 0 ? (
                    visiblePackages.map((process) => {
                      const checked = activeTab.selectedPackages.includes(process.name)
                      return (
                        <button
                          className={`filter-option ${checked ? 'selected' : ''}`}
                          key={process.name}
                          onClick={() => togglePackage(process.name)}
                        >
                          <input
                            readOnly
                            checked={checked}
                            type="checkbox"
                          />
                          <span>
                            <strong>{process.name}</strong>
                            <small>
                              pid {process.pidLabel}
                              {process.serials.length > 1 ? ` · ${process.serials.length} 台设备` : ''}
                            </small>
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="popover-empty">没有匹配进程</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="filter-popover-anchor" ref={levelFilterRef}>
            <button
              className="filter-trigger"
              onClick={() => {
                setLevelMenuOpen((open) => !open)
                setDeviceMenuOpen(false)
                setPackageMenuOpen(false)
                setTagMenuOpen(false)
                setContentMenuOpen(false)
              }}
            >
              <ListFilter size={16} />
              {levelFilterLabel(activeTab.selectedLevels)}
            </button>
            {levelMenuOpen ? (
              <div className="filter-popover filter-popover-narrow">
                <div className="popover-header">
                  <strong>Level</strong>
                  <button className="icon-button" onClick={() => setLevelMenuOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="filter-option-list">
                  <button
                    className={`filter-option compact ${activeTab.selectedLevels.length === 0 ? 'selected' : ''}`}
                    onClick={() => updateActiveTab((tab) => ({ ...tab, selectedLevels: [] }))}
                  >
                    <input readOnly checked={activeTab.selectedLevels.length === 0} type="checkbox" />
                    <span>
                      <strong>全部</strong>
                    </span>
                  </button>
                  {LOG_LEVEL_OPTIONS.map((level) => {
                    const checked = activeTab.selectedLevels.includes(level.value)
                    return (
                      <button
                        className={`filter-option ${checked ? 'selected' : ''}`}
                        key={level.value}
                        onClick={() => toggleLevel(level.value)}
                      >
                        <input readOnly checked={checked} type="checkbox" />
                        <span>
                          <strong>{level.label}</strong>
                          <small>{level.description}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <div className="filter-popover-anchor" ref={tagFilterRef}>
            <button
              className="filter-trigger"
              onClick={() => {
                setTagMenuOpen((open) => !open)
                setDeviceMenuOpen(false)
                setPackageMenuOpen(false)
                setLevelMenuOpen(false)
                setContentMenuOpen(false)
              }}
            >
              <Tags size={16} />
              Tag {countSuffix(activeTab.selectedTags.length)}
            </button>
            {tagMenuOpen ? (
              <div className="filter-popover">
                <div className="popover-header">
                  <strong>Tag</strong>
                  <button className="icon-button" onClick={() => setTagMenuOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="popover-search-row">
                  <label className="search-field popover-search">
                    <Search size={16} />
                    <input
                      autoFocus
                      onChange={(event) => setTagSearch(event.target.value)}
                      placeholder="搜索 Tag"
                      value={tagSearch}
                    />
                  </label>
                  <button
                    className="popover-clear-button"
                    disabled={activeTab.selectedTags.length === 0 && tagSearch.length === 0}
                    onClick={() => {
                      setTagSearch('')
                      updateActiveTab((tab) => ({ ...tab, selectedTags: [] }))
                    }}
                  >
                    清理
                  </button>
                </div>
                <div className="popover-actions">
                  <span>{logSnapshot.tagOptions.length} 个 Tag</span>
                </div>
                <div className="filter-option-list">
                  {visibleTags.length > 0 ? (
                    visibleTags.map((tag) => {
                      const checked = activeTab.selectedTags.includes(tag)
                      return (
                        <button
                          className={`filter-option compact ${checked ? 'selected' : ''}`}
                          key={tag}
                          onClick={() => toggleTag(tag)}
                        >
                          <input
                            readOnly
                            checked={checked}
                            type="checkbox"
                          />
                          <span>
                            <strong>{tag}</strong>
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="popover-empty">没有匹配 Tag</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="filter-popover-anchor" ref={contentFilterRef}>
            <button
              className="filter-trigger"
              onClick={() => {
                setContentMenuOpen((open) => !open)
                setDeviceMenuOpen(false)
                setPackageMenuOpen(false)
                setLevelMenuOpen(false)
                setTagMenuOpen(false)
              }}
            >
              <Columns3 size={16} />
              列显示 {activeTab.visibleLogFields.length}/{ALL_LOG_FIELDS.length}
            </button>
            {contentMenuOpen ? (
              <div className="filter-popover filter-popover-narrow">
                <div className="popover-header">
                  <strong>列显示</strong>
                  <button className="icon-button" onClick={() => setContentMenuOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="filter-option-list">
                  {LOG_FIELD_OPTIONS.map((field) => {
                    const checked = activeTab.visibleLogFields.includes(field.value)
                    return (
                      <button
                        className={`filter-option compact ${checked ? 'selected' : ''}`}
                        disabled={field.required}
                        key={field.value}
                        onClick={() => toggleLogField(field.value)}
                      >
                        <input readOnly checked={checked} type="checkbox" />
                        <span>
                          <strong>{field.label}</strong>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <div
            className={`search-field log-search-field ${activeFilterMatcher.error ? 'invalid' : ''}`}
            title={activeFilterMatcher.error ? `Regex 无效：${activeFilterMatcher.error}` : undefined}
          >
            <Search size={16} />
            <input
              onChange={(event) =>
                updateActiveTab((tab) => ({ ...tab, searchText: event.target.value }))
              }
              placeholder="过滤日志内容"
              value={activeTab.searchText}
            />
            <div className="search-option-group" aria-label="搜索选项">
              <button
                aria-label="Match Case"
                aria-pressed={activeTab.searchOptions.matchCase}
                className={`search-option-button ${activeTab.searchOptions.matchCase ? 'active-toggle' : ''}`}
                onClick={() => toggleSearchOption('matchCase')}
                title="Match Case"
              >
                <CaseSensitive size={15} />
              </button>
              <button
                aria-label="Words"
                aria-pressed={activeTab.searchOptions.wholeWords}
                className={`search-option-button ${activeTab.searchOptions.wholeWords ? 'active-toggle' : ''}`}
                onClick={() => toggleSearchOption('wholeWords')}
                title="Words"
              >
                <WholeWord size={15} />
              </button>
              <button
                aria-label="Regex"
                aria-pressed={activeTab.searchOptions.regex}
                className={`search-option-button ${activeTab.searchOptions.regex ? 'active-toggle' : ''} ${
                  activeFilterMatcher.error ? 'invalid' : ''
                }`}
                onClick={() => toggleSearchOption('regex')}
                title={activeFilterMatcher.error ? `Regex 无效：${activeFilterMatcher.error}` : 'Regex'}
              >
                <Regex size={15} />
              </button>
            </div>
          </div>
        </div>

        {findBarOpen ? (
          <div className={`find-row ${activeFindMatcher.error ? 'invalid' : ''}`}>
            <label className="search-field log-search-field find-search-field">
              <Search size={16} />
              <input
                ref={findInputRef}
                onChange={(event) =>
                  updateActiveTab((tab) => ({ ...tab, findText: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setFindBarOpen(false)
                  }
                }}
                placeholder="查找并高亮日志内容"
                value={activeTab.findText}
              />
              <div className="search-option-group" aria-label="查找选项">
                <button
                  aria-label="Match Case"
                  aria-pressed={activeTab.findOptions.matchCase}
                  className={`search-option-button ${activeTab.findOptions.matchCase ? 'active-toggle' : ''}`}
                  onClick={() => toggleFindOption('matchCase')}
                  title="Match Case"
                >
                  <CaseSensitive size={15} />
                </button>
                <button
                  aria-label="Words"
                  aria-pressed={activeTab.findOptions.wholeWords}
                  className={`search-option-button ${activeTab.findOptions.wholeWords ? 'active-toggle' : ''}`}
                  onClick={() => toggleFindOption('wholeWords')}
                  title="Words"
                >
                  <WholeWord size={15} />
                </button>
                <button
                  aria-label="Regex"
                  aria-pressed={activeTab.findOptions.regex}
                  className={`search-option-button ${activeTab.findOptions.regex ? 'active-toggle' : ''} ${
                    activeFindMatcher.error ? 'invalid' : ''
                  }`}
                  onClick={() => toggleFindOption('regex')}
                  title={activeFindMatcher.error ? `Regex 无效：${activeFindMatcher.error}` : 'Regex'}
                >
                  <Regex size={15} />
                </button>
              </div>
            </label>
            <button className="icon-button" onClick={() => setFindBarOpen(false)}>
              <X size={16} />
            </button>
            {activeFindMatcher.error ? (
              <span className="find-error">Regex 无效：{activeFindMatcher.error}</span>
            ) : null}
          </div>
        ) : null}

        <div
          className={`log-panel ${activeTab.softWrap ? 'soft-wrap' : 'no-soft-wrap'}`}
          style={logLayoutStyle}
        >
          <div className="log-scroll-frame" onScroll={handleLogScroll} ref={logListRef}>
            <div className="log-table">
              <div className="log-header">
                {activeTab.visibleLogFields.map((field) => {
                  const label = LOG_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field
                  return (
                    <span className="log-header-cell" key={field}>
                      <span className="log-header-label">{label}</span>
                      <button
                        aria-label={`调整${label}列宽`}
                        className={`column-resizer ${resizingLogField === field ? 'active' : ''}`}
                        onPointerDown={(event) => beginResizeLogColumn(event, field)}
                        type="button"
                      />
                    </span>
                  )
                })}
              </div>
              {visibleLogs.length > 0 ? (
                <div className="log-list">
                  {visibleLogs.map((entry) => (
                    <div className={`log-row ${levelClass(entry.level)}-row`} key={entry.id}>
                      {activeTab.visibleLogFields.map((field) => {
                        const text = logCellText(field, entry, devices)
                        const handleCellContextMenu = (event: ReactMouseEvent<HTMLSpanElement>) =>
                          openCellCopyMenu(event, logFieldLabel(field), text)
                        if (field === 'device') {
                          return (
                            <HighlightedText
                              className="log-device"
                              key={field}
                              matcher={activeFindMatcher}
                              onContextMenu={handleCellContextMenu}
                              text={text}
                            />
                          )
                        }
                        if (field === 'time') {
                          return (
                            <HighlightedText
                              className="mono muted"
                              key={field}
                              matcher={activeFindMatcher}
                              onContextMenu={handleCellContextMenu}
                              text={text}
                            />
                          )
                        }
                        if (field === 'level') {
                          return (
                            <span key={field} onContextMenu={handleCellContextMenu}>
                              <span className={`level-badge ${levelClass(entry.level)}`}>
                                {LOG_LEVEL_LABELS[entry.level]}
                              </span>
                            </span>
                          )
                        }
                        if (field === 'process') {
                          return (
                            <HighlightedText
                              className="mono muted"
                              key={field}
                              matcher={activeFindMatcher}
                              onContextMenu={handleCellContextMenu}
                              text={text}
                            />
                          )
                        }
                        if (field === 'tag') {
                          return (
                            <HighlightedText
                              className="log-tag"
                              key={field}
                              matcher={activeFindMatcher}
                              onContextMenu={handleCellContextMenu}
                              text={text}
                            />
                          )
                        }
                        return (
                          <HighlightedText
                            className="log-message"
                            key={field}
                            matcher={activeFindMatcher}
                            onContextMenu={handleCellContextMenu}
                            text={text}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>{isRunning ? (activeTab.paused ? '已暂停' : '正在监听') : '等待日志输入'}</strong>
                  <span>{isRunning ? '当前过滤条件下暂无日志。' : '连接设备后即可开始监听 logcat。'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      {cellCopyMenu ? (
        <div
          className="cell-copy-menu"
          onContextMenu={(event) => event.preventDefault()}
          ref={cellCopyMenuRef}
          style={{ left: cellCopyMenu.x, top: cellCopyMenu.y }}
        >
          <button onClick={() => void copyCellText()} type="button">
            复制{cellCopyMenu.label}
          </button>
        </div>
      ) : null}
      {toast ? (
        <div className={`toast ${toast.tone}`} key={toast.id} role="status">
          {toast.tone === 'danger' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <strong>{toast.title}</strong>
            {toast.message ? <span>{toast.message}</span> : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
