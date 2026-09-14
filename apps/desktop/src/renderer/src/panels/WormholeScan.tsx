/**
 * **「扫描虫洞」页**（2026-09-14 船长：「将扫描虫洞放入出港界面的选项卡内。新增主控活动：'扫描虫洞'。
 * 玩家需要在扫描虫洞界面内开始。…进度条满后。玩家就可以发现一个虫洞。玩家最多可以囤积5个未开始探索的虫洞。」）。
 *
 * 口径（design §三/§五 已确认）：
 * - **主控活动**：开始/停止都只在本页（进度保留，停扫不清零）；与采矿/打捞/远征等互斥；
 * - **窗口 = 220 分钟 × 三技能乘算**（信号分析学/星图测绘学/信号过滤学，与星图扫描同源；不吃舰船属性）；
 * - 进度满 ⇒ 发现一处虫洞进库存（**上限 5**，满了**停机并提示**）；
 * - 库存每处带**种子 + 起始层**（越深越险、产出越高）；「探索这一处」⇒ 打开准备页选编队进洞（**消耗**该处）；
 * - **施工期**：整个选项卡只在调试模式下出现（与虫洞入口同一把开关）。
 */
import { useEffect, useState } from 'react'
import { Panel } from '@whale/ui'
import { formatDurationMs } from '@whale/core'
import { WORMHOLE_SCAN_BASE_MS, WORMHOLE_STOCK_MAX } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

export function WormholeScanTab({ engine, onToast, onExplore }: { engine: GameEngine; onToast: ToastFn; onExplore: (stockId: string) => void }) {
  const state = engine.state
  /** 每秒重算一次读数（进度条/剩余时间跟手；引擎本身按拍推进） */
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const scan = state.wormholeScan ?? { active: false, progressMs: 0 }
  const stock = engine.wormholeStock()
  const windowMs = engine.wormholeScanWindow()
  const done = Math.min(windowMs, scan.progressMs)
  const percent = Math.max(0, Math.min(100, Math.round((done / windowMs) * 100)))
  const blocked = engine.wormholeScanBlockReason()
  const full = stock.length >= WORMHOLE_STOCK_MAX

  return (
    <Panel
      className="is-fill win-fixed-body"
      title="扫描虫洞"
      right={
        <span className="app-dim">
          已囤 {stock.length}/{WORMHOLE_STOCK_MAX} 处 · 单次窗口 {formatDurationMs(windowMs)}
        </span>
      }
    >
      <div className="app-win-body">
        <div className="app-dim app-note">
          主控就地展开扫描阵列找**虫洞**：进度条走满一处即可开始探索。窗口 = 基准{' '}
          {formatDurationMs(WORMHOLE_SCAN_BASE_MS)}，受「信号分析学 / 星图测绘学 / 信号过滤学」缩短（三项乘算）。
          扫描期间**遭遇随机事件的概率与星图扫描一致**；被打断也**不影响进度**。
          未探索的虫洞最多囤 {WORMHOLE_STOCK_MAX} 处。
        </div>

        <div className="app-wh-scanbar">
          <div className="app-wh-scanbar-label">
            进度 <b>{percent}%</b>
            <span className="app-dim">
              {' '}
              · 已扫 {formatDurationMs(done)} / {formatDurationMs(windowMs)}
              {scan.active ? ` · 还需 ${formatDurationMs(Math.max(0, windowMs - done))}` : ''}
            </span>
          </div>
          <div className="app-wh-scanbar-track">
            <div className="app-wh-scanbar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="app-wh-scanbar-actions">
            {scan.active ? (
              <button
                className="app-btn is-small"
                onClick={() => {
                  const r = engine.wormholeScanStop()
                  if (!r.ok) onToast(r.error ?? '停不了。', true)
                  else onToast('已停扫：进度保留，下次接着扫。')
                }}
              >
                停止扫描（进度保留）
              </button>
            ) : (
              <button
                className="app-btn is-small is-primary"
                disabled={blocked !== null}
                title={blocked ?? '开始扫描虫洞'}
                onClick={() => {
                  const r = engine.wormholeScanStart()
                  if (!r.ok) onToast(r.error ?? '无法开扫。', true)
                  else onToast('开始扫描虫洞：主控就地展开扫描阵列。')
                }}
              >
                开始扫描
              </button>
            )}
            {full ? <span className="app-wh-hold-warn">已囤满上限：先去探索掉一处才能继续扫</span> : null}
          </div>
          {blocked !== null && !scan.active ? <div className="app-dim">{blocked}</div> : null}
        </div>

        <div className="app-bay-title">已发现的虫洞 · {stock.length} 处</div>
        {stock.length === 0 ? (
          <div className="app-dim app-inv-empty">还没有发现虫洞：开扫后等进度条走满。</div>
        ) : (
          <ul className="app-inv-list">
            {stock.map((item) => (
              <li key={item.id} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">虫洞 · 起始第 {item.depth} 层</span>
                  <span className="app-inv-count">
                    威胁与产出随起始层上升（越深越险、产出越高） · 发现于 {formatDurationMs(Math.max(0, state.gameMs - item.foundAtGameMs))}前
                  </span>
                </div>
                <div className="app-inv-btns">
                  <button className="app-btn is-small is-primary" onClick={() => onExplore(item.id)}>
                    探索这一处
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
