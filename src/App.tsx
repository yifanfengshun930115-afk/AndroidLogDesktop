import './App.css'

function App() {
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
          <p className="section-label">设备</p>
          <button className="device-button active">未连接设备</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <h1>Logcat</h1>
            <p>轻量级 Android 日志工作台</p>
          </div>
          <div className="toolbar-actions">
            <button>刷新设备</button>
            <button className="primary">开始监听</button>
          </div>
        </header>

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
