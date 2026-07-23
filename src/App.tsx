import {
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCcw,
  Search,
  Square,
  Trash2,
  Usb,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listAdbDevices } from './api/adb'
import {
  listenLogcatBatch,
  listenLogcatError,
  listenLogcatStopped,
  startLogcat,
  stopLogcat,
} from './api/logcat'
import './App.css'
import { LOG_LEVEL_LABELS, parseLogcatLine } from './logcat'
import type { AdbDevice, AdbInfo, LogEntry, LogLevel, LogcatSessionInfo } from './types'

const MAX_LOG_ENTRIES = 10000
const DISPLAY_LIMIT = 1000

type LevelFilter = 'all' | LogLevel

function deviceLabel(device: AdbDevice) {
  return device.description ? `${device.serial} ${device.description}` : device.serial
}

function levelClass(level: LogLevel) {
  return `level-${level === '?' ? 'raw' : level.toLowerCase()}`
}

function App() {
  const [adbInfo, setAdbInfo] = useState<AdbInfo>()
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [selectedSerial, setSelectedSerial] = useState('')
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [session, setSession] = useState<LogcatSessionInfo>()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logError, setLogError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [searchText, setSearchText] = useState('')
  const sessionIdRef = useRef('')
  const nextLogIdRef = useRef(1)

  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === 'device'),
    [devices],
  )
  const selectedDevice = onlineDevices.find((device) => device.serial === selectedSerial)
  const isListening = Boolean(session?.running)

  const filteredLogs = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) {
        return false
      }
      if (!query) {
        return true
      }
      return entry.raw.toLowerCase().includes(query)
    })
  }, [levelFilter, logs, searchText])

  const visibleLogs = filteredLogs.slice(-DISPLAY_LIMIT)

  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true)
    setDeviceError('')

    try {
      const result = await listAdbDevices()
      const nextDevices = result.devices ?? []
      const nextOnlineDevices = nextDevices.filter((device) => device.state === 'device')

      setAdbInfo(result.adb)
      setDevices(nextDevices)
      setSelectedSerial((current) => {
        if (current && nextOnlineDevices.some((device) => device.serial === current)) {
          return current
        }
        return nextOnlineDevices[0]?.serial ?? ''
      })

      if (!result.ok) {
        setDeviceError(result.error ?? '读取设备列表失败')
      }
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error))
      setDevices([])
      setSelectedSerial('')
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  const handleStartLogcat = useCallback(async () => {
    if (!selectedDevice) {
      return
    }

    sessionIdRef.current = ''
    nextLogIdRef.current = 1
    setLogs([])
    setLogError('')
    setIsStarting(true)

    try {
      const nextSession = await startLogcat(selectedDevice.serial)
      sessionIdRef.current = nextSession.sessionId
      setSession(nextSession)
    } catch (error) {
      setLogError(error instanceof Error ? error.message : String(error))
      setSession(undefined)
      sessionIdRef.current = ''
    } finally {
      setIsStarting(false)
    }
  }, [selectedDevice])

  const handleStopLogcat = useCallback(async () => {
    try {
      await stopLogcat()
    } catch (error) {
      setLogError(error instanceof Error ? error.message : String(error))
    } finally {
      setSession(undefined)
      sessionIdRef.current = ''
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  useEffect(() => {
    let disposed = false
    const unlistenCallbacks: Array<() => void> = []

    Promise.all([
      listenLogcatBatch((payload) => {
        if (sessionIdRef.current && payload.sessionId !== sessionIdRef.current) {
          return
        }

        setLogs((current) => {
          let nextId = nextLogIdRef.current
          const nextEntries = payload.lines.map((line) =>
            parseLogcatLine(line, payload.sessionId, nextId++),
          )
          nextLogIdRef.current = nextId
          return [...current, ...nextEntries].slice(-MAX_LOG_ENTRIES)
        })
      }),
      listenLogcatError((payload) => {
        if (sessionIdRef.current && payload.sessionId !== sessionIdRef.current) {
          return
        }
        setLogError(payload.message)
      }),
      listenLogcatStopped((payload) => {
        if (sessionIdRef.current && payload.sessionId !== sessionIdRef.current) {
          return
        }
        setSession(undefined)
        sessionIdRef.current = ''
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
    }
  }, [])

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AL</span>
          <div>
            <strong>Android Log</strong>
            <span>Desktop</span>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-heading">
            <p className="section-label">设备</p>
            <button
              aria-label="刷新设备"
              className="icon-button"
              disabled={loadingDevices || isListening}
              onClick={refreshDevices}
              title="刷新设备"
            >
              <RefreshCcw size={16} />
            </button>
          </div>

          {onlineDevices.length > 0 ? (
            onlineDevices.map((device) => (
              <button
                className={`device-button ${device.serial === selectedSerial ? 'active' : ''}`}
                disabled={isListening}
                key={device.serial}
                onClick={() => setSelectedSerial(device.serial)}
              >
                <Usb size={16} />
                <span>{deviceLabel(device)}</span>
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
          <p className="section-label">当前会话</p>
          <div>
            <span>缓存</span>
            <strong>{logs.length}</strong>
          </div>
          <div>
            <span>筛选结果</span>
            <strong>{filteredLogs.length}</strong>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <h1>Logcat</h1>
            <p>{selectedDevice ? deviceLabel(selectedDevice) : '等待设备连接'}</p>
          </div>
          <div className="toolbar-actions">
            <button disabled={loadingDevices || isListening} onClick={refreshDevices}>
              <RefreshCcw size={16} />
              刷新设备
            </button>
            {isListening ? (
              <button onClick={handleStopLogcat}>
                <Square size={16} />
                停止监听
              </button>
            ) : (
              <button className="primary" disabled={!selectedDevice || isStarting} onClick={handleStartLogcat}>
                <Play size={16} />
                {isStarting ? '启动中' : '开始监听'}
              </button>
            )}
            <button disabled={logs.length === 0} onClick={() => setLogs([])}>
              <Trash2 size={16} />
              清空
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
          <label className="search-field">
            <Search size={16} />
            <input
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索日志、Tag、包名"
              value={searchText}
            />
          </label>
          <select
            onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}
            value={levelFilter}
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
        </div>

        <div className="log-panel">
          <div className="log-header">
            <span>时间</span>
            <span>级别</span>
            <span>PID/TID</span>
            <span>Tag</span>
            <span>内容</span>
          </div>
          {visibleLogs.length > 0 ? (
            <div className="log-list">
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
              <strong>{isListening ? '正在监听' : '等待日志输入'}</strong>
              <span>{isListening ? '当前过滤条件下暂无日志。' : '连接设备后即可开始监听 logcat。'}</span>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
