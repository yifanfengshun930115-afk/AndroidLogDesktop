import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCircle2,
  Download,
  Menu,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Trash2,
  Usb,
  WrapText,
  X,
} from 'lucide-react'
import {
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
import { LogStore, logStore, type LevelFilter } from './logStore'
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
  levelFilter: LevelFilter
  searchText: string
  selectedTags: string[]
  selectedPackages: string[]
  processes: AdbProcessInfo[]
  processError: string
  loadingProcesses: boolean
}

function createLogTab(index: number, selectedSerial = ''): LogTab {
  return {
    id: `tab-${index}`,
    title: `Logcat ${index}`,
    store: index === 1 ? logStore : new LogStore(),
    selectedSerial,
    paused: false,
    softWrap: false,
    levelFilter: 'all',
    searchText: '',
    selectedTags: [],
    selectedPackages: [],
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

function selectedOptions(options: HTMLCollectionOf<HTMLOptionElement>) {
  return Array.from(options)
    .filter((option) => option.selected)
    .map((option) => option.value)
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
  const [startingTabId, setStartingTabId] = useState('')
  const [tabs, setTabs] = useState<LogTab[]>(() => [createLogTab(1)])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const nextTabIndexRef = useRef(2)
  const tabsRef = useRef(tabs)
  const logListRef = useRef<HTMLDivElement>(null)

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
      levels: activeTab.levelFilter === 'all' ? [] : [activeTab.levelFilter],
      includeText: activeTab.searchText,
      tags: activeTab.selectedTags,
      pids: packagePids(activeTab.processes, activeTab.selectedPackages),
    })
  }, [
    activeTab.levelFilter,
    activeTab.processes,
    activeTab.searchText,
    activeTab.selectedPackages,
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
          <p className="section-label">包名 / 进程</p>
          <select
            className="multi-select"
            multiple
            onChange={(event) =>
              updateActiveTab((tab) => ({
                ...tab,
                selectedPackages: selectedOptions(event.currentTarget.selectedOptions),
              }))
            }
            value={activeTab.selectedPackages}
          >
            {packages.map((process) => (
              <option key={process.name} value={process.name}>
                {process.name}
              </option>
            ))}
          </select>
          <button
            disabled={!activeTab.selectedSerial || activeTab.loadingProcesses}
            onClick={() => void refreshProcesses(activeTab.id, activeTab.selectedSerial)}
          >
            <RefreshCcw size={16} />
            {activeTab.loadingProcesses ? '读取中' : '刷新进程'}
          </button>
          {activeTab.processError ? <span className="inline-error">{activeTab.processError}</span> : null}
        </section>

        <section className="sidebar-section">
          <p className="section-label">Tag</p>
          <select
            className="multi-select"
            multiple
            onChange={(event) =>
              updateActiveTab((tab) => ({
                ...tab,
                selectedTags: selectedOptions(event.currentTarget.selectedOptions),
              }))
            }
            value={activeTab.selectedTags}
          >
            {logSnapshot.tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
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
          <label className="search-field">
            <Search size={16} />
            <input
              onChange={(event) =>
                updateActiveTab((tab) => ({ ...tab, searchText: event.target.value }))
              }
              placeholder="搜索日志、Tag、包名"
              value={activeTab.searchText}
            />
          </label>
          <select
            onChange={(event) =>
              updateActiveTab((tab) => ({
                ...tab,
                levelFilter: event.target.value as LevelFilter,
              }))
            }
            value={activeTab.levelFilter}
          >
            <option value="all">全部级别</option>
            <option value="F">Fatal</option>
            <option value="E">Error</option>
            <option value="W">Warn</option>
            <option value="I">Info</option>
            <option value="D">Debug</option>
            <option value="V">Verbose</option>
            <option value="?">Raw</option>
          </select>
          <button className="package-filter-button" onClick={() => setDrawerOpen(true)}>
            <Package size={16} />
            包名 {activeTab.selectedPackages.length || ''}
          </button>
        </div>

        <div className={`log-panel ${activeTab.softWrap ? 'soft-wrap' : 'no-soft-wrap'}`}>
          <div className="log-header">
            <span>时间</span>
            <span>级别</span>
            <span>PID/TID</span>
            <span>Tag</span>
            <span>内容</span>
          </div>
          {visibleLogs.length > 0 ? (
            <div className="log-list" ref={logListRef}>
              {visibleLogs.map((entry) => (
                <div className="log-row" key={entry.id} title={entry.raw}>
                  <span className="mono muted">{entry.timestamp || '-'}</span>
                  <span className={`level-badge ${levelClass(entry.level)}`}>
                    {LOG_LEVEL_LABELS[entry.level]}
                  </span>
                  <span className="mono muted">{entry.pid ? `${entry.pid}/${entry.tid}` : '-'}</span>
                  <span className="log-tag">{entry.tag || '-'}</span>
                  <span className="log-message">{entry.message}</span>
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
