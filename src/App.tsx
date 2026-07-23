import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  CaseSensitive,
  CheckCircle2,
  Columns3,
  Download,
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
  Usb,
  WholeWord,
  WrapText,
  X,
} from 'lucide-react'
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { listAdbDevices, listAdbProcesses } from './api/adb'
import { exportLogs } from './api/exportLogs'
import {
  listenLogcatBatch,
  listenLogcatError,
  listenLogcatStopped,
  startLogcat,
  stopLogcat,
} from './api/logcat'
import './App.css'
import { LOG_LEVEL_LABELS } from './logcat'
import { LogStore, logStore } from './logStore'
import {
  compileSearchMatcher,
  findSearchMatchRanges,
  type CompiledSearchMatcher,
  type LogSearchOptions,
} from './search'
import type {
  AdbDevice,
  AdbInfo,
  AdbProcessInfo,
  LogLevel,
  LogcatSessionInfo,
} from './types'

interface LogTab {
  id: string
  title: string
  store: LogStore
  selectedSerial: string
  session?: LogcatSessionInfo
  paused: boolean
  softWrap: boolean
  selectedLevels: LogLevel[]
  searchText: string
  selectedTags: string[]
  selectedPackages: string[]
  visibleLogFields: LogField[]
  searchOptions: LogSearchOptions
  processes: AdbProcessInfo[]
  processError: string
  loadingProcesses: boolean
}

type LogColorScheme = 'android-studio' | 'idea' | 'vscode'
type LogField = 'time' | 'level' | 'process' | 'tag' | 'message'

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
  { value: 'time', label: '时间' },
  { value: 'level', label: '级别' },
  { value: 'process', label: 'PID' },
  { value: 'tag', label: 'tag' },
  { value: 'message', label: '内容', required: true },
]

const DEFAULT_LOG_FIELDS: LogField[] = LOG_FIELD_OPTIONS.map((option) => option.value)
const DEFAULT_SEARCH_OPTIONS: LogSearchOptions = {
  matchCase: false,
  wholeWords: false,
  regex: false,
}

const LOG_FIELD_COLUMNS: Record<LogField, { nowrap: string; wrap: string; minWidth: number }> = {
  time: { nowrap: '150px', wrap: '150px', minWidth: 150 },
  level: { nowrap: '88px', wrap: '88px', minWidth: 88 },
  process: { nowrap: '96px', wrap: '96px', minWidth: 96 },
  tag: { nowrap: '180px', wrap: '180px', minWidth: 180 },
  message: { nowrap: 'minmax(520px, 1fr)', wrap: 'minmax(260px, 1fr)', minWidth: 520 },
}

function createLogTab(index: number, selectedSerial = ''): LogTab {
  return {
    id: `tab-${index}`,
    title: `Logcat ${index}`,
    store: index === 1 ? logStore : new LogStore(),
    selectedSerial,
    paused: false,
    softWrap: false,
    selectedLevels: [],
    searchText: '',
    selectedTags: [],
    selectedPackages: [],
    visibleLogFields: [...DEFAULT_LOG_FIELDS],
    searchOptions: { ...DEFAULT_SEARCH_OPTIONS },
    processes: [],
    processError: '',
    loadingProcesses: false,
  }
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

function levelClass(level: LogLevel) {
  return `level-${level === '?' ? 'raw' : level.toLowerCase()}`
}

function packageOptions(processes: AdbProcessInfo[]) {
  const seen = new Set<string>()
  return processes
    .filter((process) => {
      if (!process.name || process.name.startsWith('[') || seen.has(process.name)) {
        return false
      }
      seen.add(process.name)
      return true
    })
    .sort((first, second) => first.name.localeCompare(second.name))
}

function packagePids(processes: AdbProcessInfo[], selectedPackages: string[]) {
  const selected = new Set(selectedPackages)
  return processes
    .filter((process) => selected.has(process.name))
    .map((process) => process.pid)
}

function filterPackageOptions(processes: AdbProcessInfo[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const options = packageOptions(processes)
  if (!normalizedQuery) {
    return options
  }
  return options.filter((process) => process.name.toLowerCase().includes(normalizedQuery))
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

function buildLogGridColumns(fields: LogField[], softWrap: boolean) {
  return fields.map((field) => LOG_FIELD_COLUMNS[field][softWrap ? 'wrap' : 'nowrap']).join(' ')
}

function buildLogMinWidth(fields: LogField[], softWrap: boolean) {
  if (softWrap) {
    return '0px'
  }
  const minWidth = fields.reduce((sum, field) => sum + LOG_FIELD_COLUMNS[field].minWidth, 0)
  return `${Math.max(minWidth, 260)}px`
}

function HighlightedText({
  className,
  matcher,
  text,
}: {
  className?: string
  matcher: CompiledSearchMatcher
  text: string
}) {
  const ranges = findSearchMatchRanges(text, matcher, 100)
  if (ranges.length === 0) {
    return <span className={className}>{text}</span>
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

  return <span className={className}>{parts}</span>
}

function App() {
  const [adbInfo, setAdbInfo] = useState<AdbInfo>()
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [logError, setLogError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportPath, setExportPath] = useState('')
  const [exportError, setExportError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [packageMenuOpen, setPackageMenuOpen] = useState(false)
  const [packageSearch, setPackageSearch] = useState('')
  const [levelMenuOpen, setLevelMenuOpen] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const [contentMenuOpen, setContentMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [logColorScheme, setLogColorScheme] = useState<LogColorScheme>('android-studio')
  const [startingTabId, setStartingTabId] = useState('')
  const [tabs, setTabs] = useState<LogTab[]>(() => [createLogTab(1)])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const nextTabIndexRef = useRef(2)
  const tabsRef = useRef(tabs)
  const logListRef = useRef<HTMLDivElement>(null)
  const packageFilterRef = useRef<HTMLDivElement>(null)
  const levelFilterRef = useRef<HTMLDivElement>(null)
  const tagFilterRef = useRef<HTMLDivElement>(null)
  const contentFilterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

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
  const selectedDevice = onlineDevices.find((device) => device.serial === activeTab.selectedSerial)
  const isRunning = Boolean(activeTab.session?.running)
  const isStarting = startingTabId === activeTab.id
  const visibleLogs = logSnapshot.visibleEntries
  const packages = packageOptions(activeTab.processes)
  const visiblePackages = filterPackageOptions(activeTab.processes, packageSearch)
  const visibleTags = filterTextOptions(logSnapshot.tagOptions, tagSearch)
  const activeSearchMatcher = useMemo(
    () => compileSearchMatcher(activeTab.searchText, activeTab.searchOptions),
    [activeTab.searchOptions, activeTab.searchText],
  )
  const logLayoutStyle = useMemo(
    () =>
      ({
        '--log-grid-columns': buildLogGridColumns(activeTab.visibleLogFields, activeTab.softWrap),
        '--log-min-width': buildLogMinWidth(activeTab.visibleLogFields, activeTab.softWrap),
      }) as CSSProperties,
    [activeTab.softWrap, activeTab.visibleLogFields],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.logScheme = logColorScheme
  }, [logColorScheme])

  useEffect(() => {
    setPackageMenuOpen(false)
    setPackageSearch('')
    setLevelMenuOpen(false)
    setTagMenuOpen(false)
    setTagSearch('')
    setContentMenuOpen(false)
  }, [activeTabId])

  useEffect(() => {
    if (!packageMenuOpen && !levelMenuOpen && !tagMenuOpen && !contentMenuOpen) {
      return undefined
    }

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
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return
      }

      const clickedPackageFilter = packageFilterRef.current?.contains(event.target) ?? false
      const clickedLevelFilter = levelFilterRef.current?.contains(event.target) ?? false
      const clickedTagFilter = tagFilterRef.current?.contains(event.target) ?? false
      const clickedContentFilter = contentFilterRef.current?.contains(event.target) ?? false
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
  }, [contentMenuOpen, levelMenuOpen, packageMenuOpen, tagMenuOpen])

  const updateTab = useCallback((tabId: string, updater: (tab: LogTab) => LogTab) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
  }, [])

  const updateActiveTab = useCallback(
    (updater: (tab: LogTab) => LogTab) => updateTab(activeTabId, updater),
    [activeTabId, updateTab],
  )

  const refreshProcesses = useCallback(
    async (tabId: string, serial: string) => {
      if (!serial) {
        return
      }

      updateTab(tabId, (tab) => ({ ...tab, loadingProcesses: true, processError: '' }))
      try {
        const result = await listAdbProcesses(serial)
        updateTab(tabId, (tab) => ({
          ...tab,
          processes: result.processes,
          processError: result.ok ? '' : result.error ?? '读取进程列表失败',
          loadingProcesses: false,
        }))
      } catch (error) {
        updateTab(tabId, (tab) => ({
          ...tab,
          processes: [],
          processError: error instanceof Error ? error.message : String(error),
          loadingProcesses: false,
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

      setAdbInfo(result.adb)
      setDevices(nextDevices)
      setTabs((current) =>
        current.map((tab) => {
          if (tab.selectedSerial && nextOnlineDevices.some((device) => device.serial === tab.selectedSerial)) {
            return tab
          }
          return {
            ...tab,
            selectedSerial: nextOnlineDevices[0]?.serial ?? '',
            selectedPackages: [],
            processes: [],
          }
        }),
      )

      if (!result.ok) {
        setDeviceError(result.error ?? '读取设备列表失败')
      }
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error))
      setDevices([])
      setTabs((current) =>
        current.map((tab) => ({
          ...tab,
          selectedSerial: '',
          selectedPackages: [],
          processes: [],
        })),
      )
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  const startTabLogcat = useCallback(
    async (tabId: string, clearBeforeStart: boolean) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab?.selectedSerial) {
        return
      }

      if (tab.session?.sessionId) {
        await stopLogcat(tab.session.sessionId)
      }
      if (clearBeforeStart) {
        tab.store.clear()
      }

      setLogError('')
      setStartingTabId(tabId)
      try {
        const nextSession = await startLogcat(tab.selectedSerial)
        updateTab(tabId, (current) => ({
          ...current,
          session: nextSession,
          paused: false,
        }))
      } catch (error) {
        setLogError(error instanceof Error ? error.message : String(error))
        updateTab(tabId, (current) => ({ ...current, session: undefined, paused: false }))
      } finally {
        setStartingTabId('')
      }
    },
    [updateTab],
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

  const handleExportLogs = useCallback(async () => {
    setExportPath('')
    setExportError('')
    setIsExporting(true)

    try {
      const result = await exportLogs(activeTab.store.getExportContent())
      setExportPath(result.filePath)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsExporting(false)
    }
  }, [activeTab.store])

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
          visibleLogFields: DEFAULT_LOG_FIELDS.filter((item) => selected.has(item)),
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

  const addTab = useCallback(() => {
    const nextIndex = nextTabIndexRef.current
    nextTabIndexRef.current += 1
    const tab = createLogTab(nextIndex, onlineDevices[0]?.serial ?? '')
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }, [onlineDevices])

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (tab?.session?.sessionId) {
        void stopLogcat(tab.session.sessionId)
      }

      setTabs((current) => {
        if (current.length === 1) {
          const replacement = createLogTab(nextTabIndexRef.current, onlineDevices[0]?.serial ?? '')
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

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  useEffect(() => {
    if (activeTab.selectedSerial && activeTab.processes.length === 0 && !activeTab.loadingProcesses) {
      void refreshProcesses(activeTab.id, activeTab.selectedSerial)
    }
  }, [
    activeTab.id,
    activeTab.loadingProcesses,
    activeTab.processes.length,
    activeTab.selectedSerial,
    refreshProcesses,
  ])

  useEffect(() => {
    activeTab.store.setQuery({
      levels: activeTab.selectedLevels,
      includeText: activeTab.searchText,
      searchOptions: activeTab.searchOptions,
      tags: activeTab.selectedTags,
      pids: packagePids(activeTab.processes, activeTab.selectedPackages),
    })
  }, [
    activeTab.processes,
    activeTab.searchOptions,
    activeTab.searchText,
    activeTab.selectedPackages,
    activeTab.selectedLevels,
    activeTab.selectedTags,
    activeTab.store,
  ])

  useEffect(() => {
    let disposed = false
    const unlistenCallbacks: Array<() => void> = []

    Promise.all([
      listenLogcatBatch((payload) => {
        const tab = tabsRef.current.find((item) => item.session?.sessionId === payload.sessionId)
        if (!tab || tab.paused) {
          return
        }

        tab.store.appendRawBatch({
          sessionId: payload.sessionId,
          lines: payload.lines,
          deviceSerial: tab.session?.serial,
        })
      }),
      listenLogcatError((payload) => {
        const tab = tabsRef.current.find((item) => item.session?.sessionId === payload.sessionId)
        if (tab) {
          setLogError(payload.message)
        }
      }),
      listenLogcatStopped((payload) => {
        const tab = tabsRef.current.find((item) => item.session?.sessionId === payload.sessionId)
        if (!tab) {
          return
        }
        updateTab(tab.id, (current) => ({ ...current, session: undefined, paused: false }))
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
      void stopLogcat()
    }
  }, [updateTab])

  return (
    <main className="app-shell">
      {drawerOpen ? <button className="drawer-backdrop" onClick={() => setDrawerOpen(false)} /> : null}
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">AL</span>
          <div>
            <strong>Android Log</strong>
            <span>Desktop</span>
          </div>
          <button className="icon-button drawer-close" onClick={() => setDrawerOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <section className="sidebar-section">
          <p className="section-label">外观</p>
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'light' ? '切换暗色' : '切换亮色'}
          </button>
          <select
            className="theme-select"
            onChange={(event) => setLogColorScheme(event.target.value as LogColorScheme)}
            value={logColorScheme}
          >
            {Object.entries(LOG_COLOR_SCHEME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                日志配色：{label}
              </option>
            ))}
          </select>
        </section>

        <section className="sidebar-section">
          <div className="section-heading">
            <p className="section-label">设备</p>
            <button
              aria-label="刷新设备"
              className="icon-button"
              disabled={loadingDevices || isRunning}
              onClick={refreshDevices}
              title="刷新设备"
            >
              <RefreshCcw size={16} />
            </button>
          </div>

          {onlineDevices.length > 0 ? (
            onlineDevices.map((device) => (
              <button
                className={`device-button ${device.serial === activeTab.selectedSerial ? 'active' : ''}`}
                disabled={isRunning}
                key={device.serial}
                onClick={() => {
                  updateActiveTab((tab) => ({
                    ...tab,
                    selectedSerial: device.serial,
                    selectedPackages: [],
                    processes: [],
                  }))
                  void refreshProcesses(activeTab.id, device.serial)
                }}
              >
                <Usb size={16} />
                <span>
                  <strong>{deviceTitle(device)}</strong>
                  <small>{deviceSubtitle(device)}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="device-empty">未连接可用设备</div>
          )}
        </section>

        <section className="sidebar-section">
          <p className="section-label">ADB</p>
          <div className={`adb-status ${adbInfo?.available ? 'available' : 'unavailable'}`}>
            {adbInfo?.available ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{adbInfo?.available ? '已就绪' : '未找到'}</span>
          </div>
          {adbInfo?.path ? <code className="path-line">{adbInfo.path}</code> : null}
        </section>

        <section className="sidebar-section metrics">
          <p className="section-label">当前页面</p>
          <div>
            <span>缓存</span>
            <strong>{logSnapshot.totalCount}</strong>
          </div>
          <div>
            <span>筛选结果</span>
            <strong>{logSnapshot.filteredCount}</strong>
          </div>
          <div>
            <span>已淘汰</span>
            <strong>{logSnapshot.droppedCount}</strong>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <div className="tab-strip">
          {tabs.map((tab) => (
            <button
              className={`tab-button ${tab.id === activeTab.id ? 'active' : ''}`}
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.title}</span>
              {tab.session?.running ? <small>{tab.paused ? '暂停' : '运行'}</small> : null}
              <X
                size={14}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              />
            </button>
          ))}
          <button className="tab-add" onClick={addTab}>
            <Plus size={16} />
          </button>
        </div>

        <header className="toolbar">
          <div className="title-row">
            <button className="icon-button" onClick={() => setDrawerOpen(true)} title="打开设备与筛选抽屉">
              <Menu size={18} />
            </button>
            <div>
              <h1>Logcat</h1>
              <p>{selectedDevice ? deviceTitle(selectedDevice) : '等待设备连接'}</p>
            </div>
          </div>
          <div className="toolbar-actions">
            <button disabled={!selectedDevice || isStarting} onClick={handleStartPause}>
              {isRunning && !activeTab.paused ? <Pause size={16} /> : <Play size={16} />}
              {!isRunning ? (isStarting ? '启动中' : '开始') : activeTab.paused ? '继续' : '暂停'}
            </button>
            <button disabled={!selectedDevice || isStarting} onClick={handleRestart}>
              <RotateCcw size={16} />
              Restart
            </button>
            <button disabled={logSnapshot.totalCount === 0} onClick={() => activeTab.store.clear()}>
              <Trash2 size={16} />
              清理
            </button>
            <button onClick={() => logListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
              <ArrowUpToLine size={16} />
              滚顶
            </button>
            <button
              onClick={() =>
                logListRef.current?.scrollTo({
                  top: logListRef.current.scrollHeight,
                  behavior: 'smooth',
                })
              }
            >
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

        {exportError ? (
          <section className="notice danger">
            <AlertTriangle size={18} />
            <div>
              <strong>导出失败</strong>
              <span>{exportError}</span>
            </div>
          </section>
        ) : null}

        {exportPath ? (
          <section className="notice success">
            <CheckCircle2 size={18} />
            <div>
              <strong>已导出</strong>
              <span>{exportPath}</span>
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
          <div className="filter-popover-anchor" ref={packageFilterRef}>
            <button
              className="filter-trigger"
              onClick={() => {
                setPackageMenuOpen((open) => !open)
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
                    disabled={!activeTab.selectedSerial || activeTab.loadingProcesses}
                    onClick={() => void refreshProcesses(activeTab.id, activeTab.selectedSerial)}
                  >
                    <RefreshCcw size={16} />
                    {activeTab.loadingProcesses ? '读取中' : '刷新'}
                  </button>
                </div>
                {activeTab.processError ? <span className="inline-error">{activeTab.processError}</span> : null}
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
                            <small>pid {process.pid}</small>
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
                setPackageMenuOpen(false)
                setLevelMenuOpen(false)
                setTagMenuOpen(false)
              }}
            >
              <Columns3 size={16} />
              内容 {activeTab.visibleLogFields.length}/{DEFAULT_LOG_FIELDS.length}
            </button>
            {contentMenuOpen ? (
              <div className="filter-popover filter-popover-narrow">
                <div className="popover-header">
                  <strong>内容</strong>
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
            className={`search-field log-search-field ${activeSearchMatcher.error ? 'invalid' : ''}`}
            title={activeSearchMatcher.error ? `Regex 无效：${activeSearchMatcher.error}` : undefined}
          >
            <Search size={16} />
            <input
              onChange={(event) =>
                updateActiveTab((tab) => ({ ...tab, searchText: event.target.value }))
              }
              placeholder="搜索日志内容"
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
                  activeSearchMatcher.error ? 'invalid' : ''
                }`}
                onClick={() => toggleSearchOption('regex')}
                title={activeSearchMatcher.error ? `Regex 无效：${activeSearchMatcher.error}` : 'Regex'}
              >
                <Regex size={15} />
              </button>
            </div>
          </div>
        </div>

        <div
          className={`log-panel ${activeTab.softWrap ? 'soft-wrap' : 'no-soft-wrap'}`}
          style={logLayoutStyle}
        >
          <div className="log-header">
            {activeTab.visibleLogFields.map((field) => (
              <span key={field}>{LOG_FIELD_OPTIONS.find((option) => option.value === field)?.label}</span>
            ))}
          </div>
          {visibleLogs.length > 0 ? (
            <div className="log-list" ref={logListRef}>
              {visibleLogs.map((entry) => (
                <div className={`log-row ${levelClass(entry.level)}-row`} key={entry.id} title={entry.raw}>
                  {activeTab.visibleLogFields.map((field) => {
                    if (field === 'time') {
                      return (
                        <HighlightedText
                          className="mono muted"
                          key={field}
                          matcher={activeSearchMatcher}
                          text={entry.timestamp || '-'}
                        />
                      )
                    }
                    if (field === 'level') {
                      return (
                        <span key={field}>
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
                          matcher={activeSearchMatcher}
                          text={entry.pid || '-'}
                        />
                      )
                    }
                    if (field === 'tag') {
                      return (
                        <HighlightedText
                          className="log-tag"
                          key={field}
                          matcher={activeSearchMatcher}
                          text={entry.tag || '-'}
                        />
                      )
                    }
                    return (
                      <HighlightedText
                        className="log-message"
                        key={field}
                        matcher={activeSearchMatcher}
                        text={entry.message}
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
      </section>
    </main>
  )
}

export default App
