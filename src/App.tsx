import { AlertTriangle, CheckCircle2, Play, RefreshCcw, Usb } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAdbDevices } from './api/adb'
import './App.css'
import type { AdbDevice, AdbInfo } from './types'

function deviceLabel(device: AdbDevice) {
  return device.description ? `${device.serial} ${device.description}` : device.serial
}

function App() {
  const [adbInfo, setAdbInfo] = useState<AdbInfo>()
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [selectedSerial, setSelectedSerial] = useState('')
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [deviceError, setDeviceError] = useState('')

  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === 'device'),
    [devices],
  )
  const selectedDevice = onlineDevices.find((device) => device.serial === selectedSerial)

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

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

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
              disabled={loadingDevices}
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
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <h1>Logcat</h1>
            <p>{selectedDevice ? deviceLabel(selectedDevice) : '等待设备连接'}</p>
          </div>
          <div className="toolbar-actions">
            <button disabled={loadingDevices} onClick={refreshDevices}>
              <RefreshCcw size={16} />
              刷新设备
            </button>
            <button className="primary" disabled={!selectedDevice}>
              <Play size={16} />
              开始监听
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
          <input placeholder="搜索日志、Tag、包名" />
          <select defaultValue="all">
            <option value="all">全部级别</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
            <option value="verbose">Verbose</option>
          </select>
        </div>

        <div className="log-panel">
          <div className="log-header">
            <span>时间</span>
            <span>级别</span>
            <span>PID</span>
            <span>Tag</span>
            <span>内容</span>
          </div>
          <div className="empty-state">
            <strong>等待日志输入</strong>
            <span>连接设备后即可开始监听 logcat。</span>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
