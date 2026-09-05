/**
 * V15 调试面板（开发工具，默认对玩家隐藏）。
 * 进入方式：DevTools 执行 localStorage.setItem('whale-idle:debug','1') 后刷新 → 顶栏出现 ⇄ 调试。
 * 功能：1 秒化总开关（所有作业按 1 秒完成，随存档 debugQuick 记录）；离线快进（复用离线结算，8 小时上限）。
 */
import { useState } from 'react'
import type { GameEngine } from '../game/engine'

const DEBUG_KEY = 'whale-idle:debug'

/** 调试入口是否可用（隐藏开发工具标志） */
export function debugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

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
        title="调试模式（开发工具）：1 秒化 / 离线快进"
      >
        ⇄ 调试{quick ? ' · 1秒化' : ''}
      </button>
      {open ? (
        <>
          <div className="app-debug-backdrop" onClick={() => setOpen(false)} />
          <div className="app-debug-pop">
            <div className="app-debug-title">调试模式</div>
            <label className="app-check">
              <input
                type="checkbox"
                checked={quick}
                onChange={(e) => {
                  setQuick(e.target.checked)
                  engine.setDebugQuick(e.target.checked)
                }}
              />
              1 秒化：训练/采矿/制造/航行/扫描按 1 秒完成，交火即时按胜率判定
            </label>
            <div className="app-debug-row">
              <span className="app-dim">离线快进：</span>
              <input
                className="app-select app-debug-input"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select className="app-select" value={unit} onChange={(e) => setUnit(e.target.value as 'min' | 'hour')}>
                <option value="min">分钟</option>
                <option value="hour">小时</option>
              </select>
              <button className="app-btn is-small is-primary" onClick={doFastForward} title="立即按所选时长结算一次（上限 8 小时，弹离线简报）">
                快进
              </button>
            </div>
            <div className="app-dim app-debug-note">市场刷单节奏不缩短；快进上限 8 小时；两项均为开发工具，不影响正常玩法数值。</div>
          </div>
        </>
      ) : null}
    </span>
  )
}
