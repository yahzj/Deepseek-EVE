/**
 * **「里程碑任务」面板**（**2026-09-20 船长转玩家反馈**：「**已经完成「第一次」任务后的里程碑任务链，
 * 建议单开一个任务中心的子页面「里程碑任务」来装**」）。
 *
 * 口径（船长同日三选）：
 * - 页签**恒显**（未解锁时给提示，与「快递任务」页"未建成副站给建设提示"同一做法）；
 * - 每条**次数链**（里程碑）一张卡：名字 · 当前档位/总档 · 已累计读数 · 可领奖金 · 下一级奖金；
 * - **领奖按钮只在本页**——「第一次」卡片那边只留一行只读（见 `FirstTasks.tsx`），避免两处重复入口。
 *
 * 数据侧全部在 core 的 `milestoneBoard(state)`（含 `unlocked` 判据：对应「第一次」已完成才上本页）；
 * 本面板只渲染，不自己算。
 */
import { milestoneBoard } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { tr } from '../i18n/locale'

/** 链进度的计数单位（**纯显示用**，与 core 的阈值表同源；`tierKey` 缺项 ⇒ 不写单位） */
const CHAIN_UNITS: Record<string, string> = {
  scan: tr('ui.FirstTasks.004'),
  mineUnits: tr('ui.FirstTasks.005'),
  salvageRuns: tr('ui.FirstTasks.006'),
  bountyWins: tr('ui.FirstTasks.007'),
  repairs: tr('ui.FirstTasks.006'),
  refineBatches: tr('ui.FirstTasks.008'),
  produceUnits: tr('ui.MarketPage.117'),
  marketIncome: tr('ui.FirstTasks.003'),
  ships: tr('ui.MarketPage.116'),
  aiAssigns: tr('ui.FirstTasks.006'),
  haulTrips: tr('ui.FirstTasks.009'),
  wormholeRuns: tr('ui.FirstTasks.009'),
  skills: tr('ui.FirstTasks.010'),
}

/** 链 id → 计数单位键（与 `CHAIN_TIERS` 的 tierKey 同名；这里显式列一次，免得面板再引 core 的阈值表） */
const UNIT_BY_CHAIN: Record<string, string> = {
  explorer: 'scan',
  digger: 'mineUnits',
  scavenger: 'salvageRuns',
  mechanic: 'repairs',
  hunter: 'bountyWins',
  refiner: 'refineBatches',
  lineboss: 'produceUnits',
  marketeer: 'marketIncome',
  shipwright: 'ships',
  scholar: 'skills',
  dispatch: 'aiAssigns',
  freight: 'haulTrips',
  abyss: 'wormholeRuns',
}

export function MilestoneTasks({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const rows = milestoneBoard(state)
  const open = rows.filter((r) => r.unlocked)
  const claimable = open.filter((r) => r.pendingIsk > 0).length

  return (
    <div className="app-station-list">
      <div className="app-task-family">
        {tr('ui.MilestoneTasks.001')} {open.length}/{rows.length} {tr('ui.MilestoneTasks.002')}
        <span className="app-dim">{tr('ui.MilestoneTasks.003')}</span>
      </div>
      {open.length === 0 ? (
        <div className="app-dim app-note">{tr('ui.MilestoneTasks.004')}</div>
      ) : (
        open.map((r) => {
          const unit = CHAIN_UNITS[UNIT_BY_CHAIN[r.chainId] ?? ''] ?? ''
          const goal = r.next ?? r.count
          const claimableNow = r.pendingIsk > 0
          return (
            <div key={r.chainId} className="app-station-card">
              <div className="app-station-head">
                <span className="app-station-name">
                  {r.name}
                  {claimableNow ? <em className="app-chip">{tr('ui.FirstTasks.015')}</em> : null}
                </span>
                <span className="app-dim">
                  {r.level}/{r.total} {tr('ui.MilestoneTasks.005')}
                </span>
              </div>
              <div className="app-station-mats">
                {tr('ui.FirstTasks.016')} {r.count.toLocaleString('zh-CN')}/{goal.toLocaleString('zh-CN')} {unit}
                {r.next === null ? tr('ui.FirstTasks.017') : ''}
              </div>
              <div className="app-task-reward">
                <span className="app-dim">{tr('ui.FirstTasks.018')} </span>
                {r.nextRewardIsk > 0
                  ? tr('ui.FirstTasks.030', { p1: r.level + 1, p2: r.nextRewardIsk.toLocaleString('zh-CN') })
                  : tr('ui.FirstTasks.019')}
              </div>
              <div className="app-station-deliver">
                <span className="app-dim">
                  {claimableNow ? tr('ui.FirstTasks.031', { p1: r.pendingIsk.toLocaleString('zh-CN') }) : tr('ui.FirstTasks.020')}
                </span>
                {claimableNow ? (
                  <button
                    className="app-btn is-small is-primary"
                    title={tr('ui.FirstTasks.032', { p1: r.pendingIsk.toLocaleString('zh-CN') })}
                    onClick={() => {
                      const isk = engine.claimChainRewardAt(r.chainId)
                      onToast(isk > 0 ? tr('ui.FirstTasks.033', { p1: isk.toLocaleString('zh-CN') }) : tr('ui.FirstTasks.024'), isk <= 0)
                    }}
                  >
                    {tr('ui.FirstTasks.025')}
                    {r.pendingIsk.toLocaleString('zh-CN')} {tr('ui.FirstTasks.034')}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })
      )}
      {open.length > 0 && claimable === 0 ? <div className="app-dim app-note">{tr('ui.MilestoneTasks.006')}</div> : null}
    </div>
  )
}
