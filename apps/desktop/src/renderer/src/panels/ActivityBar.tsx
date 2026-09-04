/**
 * T1 顶部活动窗口：常驻显示当前全部进行中活动（训练/采矿/扫描/制造/远征/AI），
 * 并提供统一终止入口。各页原有运行状态区与停止按钮已收敛于此。
 */
import { activityOverview } from '@whale/core'
import type { ActivityView } from '@whale/core'
import { formatDurationMs } from '@whale/core'
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

const KIND_ICON: Record<string, string> = {
  train: '✚',
  mining: '⛏',
  scan: '🔭',
  manufacture: '⚒',
  expedition: '⚔',
  ai: '🤖',
  return: '↩',
  transit: '🏠',
}

function stopLabel(v: ActivityView): string {
  switch (v.stop) {
    case 'remove-training':
      return '移除'
    case 'stop-mining':
      return '停止'
    case 'stop-scan':
      return '终止'
    case 'cancel-manufacture':
      return '取消'
    case 'recall-expedition':
      return '召回'
    case 'retreat-battle':
      return '撤退'
    case 'cancel-ai':
      return '取消'
    default:
      return ''
  }
}

function doStop(v: ActivityView, engine: GameEngine, onToast: ToastFn): void {
  const run = (r: { ok: boolean; error?: string } | boolean, okText: string): void => {
    const ok = typeof r === 'boolean' ? r : r.ok
    if (!ok) onToast((typeof r === 'object' && r.error) || '操作失败。', true)
    else onToast(okText)
  }
  switch (v.stop) {
    case 'remove-training':
      run(engine.dequeueAt(0), '已取消训练：本级进度保留，重新排同一级可续接。')
      break
    case 'stop-mining':
      run(engine.stopMiningNow(), '已停止开采。')
      break
    case 'stop-scan':
      run(engine.stopScanNow(), '已终止扫描探索：就地扫描进度已保存，下次续扫。')
      break
    case 'cancel-manufacture':
      run(engine.cancelManufacturingNow(), '已取消制造：材料全额退回物品仓库（制造费不退）。')
      break
    case 'recall-expedition':
      run(engine.recallExpeditionNow(), '远征已召回：舰队返回母港（无战果）。')
      break
    case 'retreat-battle':
      run(engine.retreatNow(), '已撤退：舰队脱离交火并自动返航。')
      break
    case 'cancel-ai':
      if (v.stopParam) run(engine.cancelAiTaskAt(v.stopParam), 'AI 任务已取消（核心已归还）。')
      break
  }
}

export function ActivityBar({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const items = activityOverview(state, engine.ctx)
  const loopId = state.autoLoopAnomalyId
  // 撤退需二次确认（轻损但有代价）
  const [retreatAsk, setRetreatAsk] = useState(false)
  if (retreatAsk && !items.some((i) => i.stop === 'retreat-battle')) setRetreatAsk(false)
  if (items.length === 0 && !loopId) return null
  return (
    <div className="app-activitybar">
      <span className="app-activitybar-title">活动</span>
      <div className="app-activitybar-items">
        {items.map((v) => (
          <div key={v.id} className={`app-activitybar-item is-${v.kind}`} title={v.stopReason ?? undefined}>
            <span className="app-activitybar-icon">{KIND_ICON[v.kind] ?? '•'}</span>
            <div className="app-activitybar-main">
              <div className="app-activitybar-line">
                <span className="app-activitybar-label">{v.label}</span>
                <span className="app-dim app-activitybar-sub">{v.sub}</span>
                {v.percent !== null ? (
                  <span className="app-activitybar-track">
                    <span className="app-activitybar-fill" style={{ width: `${v.percent}%` }} />
                  </span>
                ) : null}
                <span className="app-activitybar-time">
                  {v.percent !== null ? `${Math.round(v.percent)}%` : ''}
                  {v.remainingMs !== null && v.remainingMs > 0 ? ` · 剩 ${formatDurationMs(v.remainingMs)}` : ''}
                </span>
              </div>
            </div>
            {v.stopable && v.stop ? (
              <button
                className="app-btn is-small is-warn"
                title={
                  v.stop === 'cancel-manufacture'
                    ? '取消制造：材料全额退回、制造费不退'
                    : v.stop === 'recall-expedition'
                      ? '召回远征：中止任务返回母港（无战果）'
                      : v.stop === 'stop-scan'
                        ? '终止扫描：就地扫描进度保存，下次续扫'
                        : v.stop === 'remove-training'
                          ? '取消训练：本级进度保留，重排同一级自动续接；后续同技能队列顺延一级'
                          : v.stop === 'retreat-battle'
                            ? '撤退：轻损脱离战斗并自动返航（仅损失少量舰船耐久、无弃船风险；同时停止连续出击）'
                            : undefined
                }
                onClick={() => {
                  if (v.stop !== 'retreat-battle') {
                    doStop(v, engine, onToast)
                    return
                  }
                  if (!retreatAsk) {
                    setRetreatAsk(true)
                    onToast('撤退 = 轻损脱离（仅损失少量舰船耐久、无弃船风险）——再点一次确认。', true)
                    return
                  }
                  setRetreatAsk(false)
                  doStop(v, engine, onToast)
                }}
              >
                {v.stop === 'retreat-battle' && retreatAsk ? '再点确认撤退' : stopLabel(v)}
              </button>
            ) : null}
          </div>
        ))}
        {loopId ? (
          <div className="app-activitybar-loop">
            <span className="app-dim">
              🔁 连击：{engine.ctx.anomalies.get(loopId)?.name ?? loopId}（胜利冷却 10 秒起自动再出发）
            </span>
            <button
              className="app-btn is-small is-warn"
              title="停止连续出击（当前这一单照常打完）"
              onClick={() => {
                const r = engine.bountyLoopAt(null)
                if (!r.ok) onToast(r.error ?? '操作失败', true)
              }}
            >
              停连击
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
