/**
 * V15 调试面板（开发工具，**只有本机可用**）。
 * 进入方式：设置 →「调试模式」开关（`panels/DebugPanel` 的 `setDebugEnabled`），
 * 或在 DevTools 里执行 `localStorage.setItem('whale-idle:debug','1')` 后刷新 → 顶栏出现 ⇄ 调试。
 * 功能：1 秒化总开关（所有作业按 1 秒完成，随存档 debugQuick 记录）；离线快进（复用离线结算，8 小时上限）。
 *
 * ⚠ **发布版一律关闭且隐藏**（2026-09-25 船长令：「只有本地开启，上传后的版本都是关闭隐藏的」）：
 * 门禁实现在 `game/debugFlag.ts`（本机判定走 `@whale/core` 的 `isLocalDebugOrigin`）——
 * 公网域名与桌面打包版的 `file:` 协议下，`debugEnabled()` 恒为 false（手动置标志也不生效），
 * 设置里那一行也不渲染。本文件只做**转发**，方便既有调用点（`Expedition` 等）不改 import。
 */
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

export { debugAllowed, debugEnabled, setDebugEnabled } from '../game/debugFlag'

/** 顶栏调试按钮 + 面板 */
export function DebugButton({
  engine,
  onFastForwarded,
}: {
  engine: GameEngine
  onFastForwarded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [quick, setQuick] = useState(engine.state.debugQuick)
  const [amount, setAmount] = useState('30')
  const [unit, setUnit] = useState<'min' | 'hour'>('min')

  function doFastForward(): void {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return
    const ms = unit === 'hour' ? Math.round(n * 3_600_000) : Math.round(n * 60_000)
    engine.debugFastForward(ms)
    onFastForwarded()
  }

  return (
    <span className="app-debug-wrap">
      <button
        className={`app-btn${quick ? ' is-warn' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={tr("ui.DebugPanel.001")}
      >
        {tr("ui.DebugPanel.002")}{quick ? tr("ui.DebugPanel.003") : ''}
      </button>
      {open ? (
        <>
          <div className="app-debug-backdrop" onClick={() => setOpen(false)} />
          <div className="app-debug-pop">
            <div className="app-debug-title">{tr("ui.DebugPanel.004")}</div>
            <label className="app-check">
              <input
                type="checkbox"
                checked={quick}
                onChange={(e) => {
                  setQuick(e.target.checked)
                  engine.setDebugQuick(e.target.checked)
                }}
              />
              {tr("ui.DebugPanel.005")}
            </label>
            <div className="app-debug-row">
              <span className="app-dim">{tr("ui.DebugPanel.006")}</span>
              <input
                className="app-select app-debug-input"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select className="app-select" value={unit} onChange={(e) => setUnit(e.target.value as 'min' | 'hour')}>
                <option value="min">{tr("ui.DebugPanel.007")}</option>
                <option value="hour">{tr("ui.DebugPanel.008")}</option>
              </select>
              <button className="app-btn is-small is-primary" onClick={doFastForward} title={tr("ui.DebugPanel.009")}>
                {tr("ui.DebugPanel.010")}
              </button>
            </div>
            <div className="app-dim app-debug-note">{tr("ui.DebugPanel.011")}</div>
          </div>
        </>
      ) : null}
    </span>
  )
}
