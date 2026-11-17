
import { battleVerdictOf } from '@whale/core'
import type { BattleVerdict } from '@whale/core'

import { droneModelOrFallback } from './droneArt'

import { mountNamesTextOf } from '../../i18n/locale'

export function renderBattleReport({ stage, outroRef, droneReportRef, battleReportRef, tr, reportTextRef, finish }: {
stage: import('./battleViewCore').Stage
outroRef: import('react').MutableRefObject<import('./battleViewCore').OutroSnap | null>
droneReportRef: import('react').MutableRefObject<import('@whale/core').DroneLossReport | null>
battleReportRef: import('react').MutableRefObject<import('@whale/core').BattleReportRecord | null>
tr: (id: string, params?: Record<string, string | number>) => string
reportTextRef: import('react').MutableRefObject<string>
finish: () => void
}) {
if (stage === 'report') {
    const snap = outroRef.current
    const droneReport = droneReportRef.current
    const br = battleReportRef.current
    const won = snap?.kind === 'me'
    const durSec = Math.max(1, Math.round((snap?.durMs ?? 0) / 1000))
    const fallback = won ? tr("ui.BattleScreen.007") : tr("ui.BattleScreen.008")
    const verdict: BattleVerdict = br ? battleVerdictOf(br) : won ? 'great' : 'defeat'
    const lostN = br?.shipsLost.length ?? 0
    const titleOf: Record<BattleVerdict, string> = {
      great: tr("ui.BattleScreen.009"),
      pyrrhic: tr("ui.BattleScreen.078", { lostN: lostN }),
      defeat: tr("ui.BattleScreen.010"),
      break: tr("ui.BattleScreen.011"),
    }
    const isWinSide = verdict === 'great' || verdict === 'pyrrhic'
    const myUnitsText = br
      ? br.myUnits.map((u) => tr("ui.BattleScreen.079", { p1: u.name, p2: Math.round(u.s), p3: Math.round(u.sMax), p4: Math.round(u.a), p5: Math.round(u.aMax), p6: Math.round(u.h), p7: Math.round(u.hMax) })).join(' ｜ ')
      : ''
    const foeText = br
      ? br.foe.alive <= 0
        ? tr("ui.BattleScreen.080", { p1: br.foe.total })
        : tr("ui.BattleScreen.081", { p1: br.foe.alive, p2: br.foe.total, p3: Math.round(br.foe.hpFrac * 100) })
      : ''
    const ammoSeg = br
      ? ([
          [tr("ui.BattleScreen.002"), br.ammoUsed.kin],
          [tr("ui.BattleScreen.012"), br.ammoUsed.exp],
          [tr("ui.BattleScreen.013"), br.ammoUsed.pla],
        ] as const)
          .filter(([, n]) => n > 0)
          .map(([label, n]) => `${label} ×${n}`)
          .join(' · ')
      : ''
    return (
      <div className="app-battle-screen is-report">
        <div className="app-bts-report">
          <div className={`app-bts-report-card${isWinSide ? " is-win" : " is-lose"}`}>
            <div className="app-bts-report-title">{titleOf[verdict]}</div>
            <div className="app-bts-report-text">
              {reportTextRef.current || fallback}
            </div>
            {snap ? (
              <div className="app-bts-report-stats">
                {tr("ui.BattleScreen.014")} {snap.meShots} {tr("ui.BattleScreen.015")} {snap.meHits}{tr('ui.BattleScreen.097')}{' '}
                {Math.round(snap.meDmg).toLocaleString('zh-CN')}{tr('ui.BattleScreen.098')}{' '}
                {snap.foeShots} {tr("ui.BattleScreen.015")} {snap.foeHits}{tr('ui.BattleScreen.099', { s: durSec })}
              </div>
            ) : null}
            {/* **我方损失**（2026-09-14 船长定：新增三行之一）——这条正是"损失了舰船也显示大捷"的正身 */}
            {br && lostN > 0 ? (
              <div className="app-bts-report-stats is-loss">
                {tr("ui.BattleScreen.016")}{br.shipsLost.join(tr("ui.MatterTechTab.017"))}（{lostN} {tr("ui.BattleScreen.017")}
              </div>
            ) : null}
            {/* **双方残余**（新增三行之二）：逐舰 盾/甲/结构（当前/上限）+ 敌方残余 */}
            {myUnitsText ? <div className="app-bts-report-stats">{tr("ui.BattleScreen.018")} {myUnitsText} ｜ {foeText}</div> : null}
            {/* **敌方挂载件**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——没挂件就整行不显示；
                2026-09-24 起按当前语言取一列（`foeMountNamePairs` 与 `foeMounts` 同序；缺省回落中文） */}
            {br && br.foeMounts && br.foeMounts.length > 0 ? (
              <div className="app-bts-report-stats">
                {tr("ui.BattleScreen.019")}
                {mountNamesTextOf(br.foeMounts, br.foeMountNamePairs).join(tr("ui.MatterTechTab.017"))}
              </div>
            ) : null}
            {/* **弹药消耗**（新增三行之三）：按弹种；0 的弹种不列 */}
            {ammoSeg ? <div className="app-bts-report-stats">{tr("ui.BattleScreen.020")}{ammoSeg}</div> : null}
            {/* 机群战损（2026-09-11 船长：优先回收高价值 + 在战报里显示）：
                第一行 = 汇总（损坏 / 回收归队 / 净损失），第二行 = 逐型明细（回收 ｜ 净损失，按机型价值降序） */}
            {droneReport ? (
              <>
                <div className="app-bts-report-stats is-loss">
                  {tr("ui.BattleScreen.021")} {droneReport.total} {tr("ui.BattleScreen.022")}{' '}
                  {droneReport.recovered} {tr("ui.BattleScreen.023")}{' '}
                  {tr("ui.BattleScreen.103", { p1: Math.round(droneReport.rate * 100) })}
                  {tr("ui.BattleScreen.104", { p1: droneReport.gone })}
                </div>
                <div className="app-bts-report-stats is-loss">
                  {tr("ui.BattleScreen.024")}
                  {droneReport.rows
                    .filter((r) => r.back > 0)
                    .map((r) => `${r.name}×${r.back}`)
                    .join(tr("ui.MatterTechTab.017")) || tr("ui.BattleScreen.001")}
                  {' ｜ '}{tr("ui.BattleScreen.025")}
                  {droneReport.rows
                    .filter((r) => r.gone > 0)
                    .map((r) => `${r.name}×${r.gone}`)
                    .join(tr("ui.MatterTechTab.017")) || tr("ui.BattleScreen.001")}
                  {tr("ui.BattleScreen.026")}
                </div>
              </>
            ) : snap?.droneLost && Object.keys(snap.droneLost).length > 0 ? (
              <div className="app-bts-report-stats is-loss">
                {tr("ui.BattleScreen.027")}
                {Object.entries(snap.droneLost)
                  // 战报里的机型名同样走兜底（2026-09-26）：漏登记时显示机型 id，便于一眼发现
                  .map(([artId, n]) => `${droneModelOrFallback(artId).name} ×${n}`)
                  .join(tr("ui.MatterTechTab.017"))}
                {tr("ui.BattleScreen.026")}
              </div>
            ) : null}
            <div className="app-bts-report-note">{tr("ui.BattleScreen.028")}</div>
            <button className="app-btn" onClick={() => finish()}>
              {tr("ui.BattleScreen.029")}
            </button>
          </div>
        </div>
      </div>
    )
  }

}
