import { milestoneBoard } from '@whale/core'
import { firstChainText } from '@whale/data'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { currentLocale, tr } from '../i18n/locale'

const CHAIN_UNITS: Record<string, string> = {
  get scan() { return tr('ui.FirstTasks.004') },
  get mineUnits() { return tr('ui.FirstTasks.005') },
  get salvageRuns() { return tr('ui.FirstTasks.006') },
  get bountyWins() { return tr('ui.FirstTasks.007') },
  get repairs() { return tr('ui.FirstTasks.006') },
  get refineBatches() { return tr('ui.FirstTasks.008') },
  get produceUnits() { return tr('ui.MarketPage.117') },
  get marketIncome() { return tr('ui.FirstTasks.003') },
  get ships() { return tr('ui.MarketPage.116') },
  get aiAssigns() { return tr('ui.FirstTasks.006') },
  get haulTrips() { return tr('ui.FirstTasks.009') },
  get wormholeRuns() { return tr('ui.FirstTasks.009') },
  get skills() { return tr('ui.FirstTasks.010') },
}

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
                  {firstChainText(r.chainId, currentLocale())}
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
