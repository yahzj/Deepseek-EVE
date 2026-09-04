/**
 * 工业页：精炼炉（运转周期制：固定批量循环，主控/AI 核心驱动）+ 蓝图书架 + 蓝图制造台。
 *
 * 运转模型（2026-09-04 船长定稿）：
 * - 单工位：同一时刻只运转一种资源；启动 = 把"货仓+仓库"当前全部库存锁定入炉，
 *   每批到点按收率出货并自动续批，直到料尽自动停炉；
 * - 劳动者 = 主控亲自运转（占主控工作位）或一枚 AI 核心驱动（不占副船名额）；
 * - 停炉即止：已完成批已出货，剩余原料全额退回仓库（AI 核心自动归还）。
 */
import { refineRate } from '@whale/core'
import type { AiCoreType } from '@whale/core'
import { Panel } from '@whale/ui'
import { useState } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../panels/Industry'
import type { PageProps } from './common'
import { m3 } from './common'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

export function IndustryPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)
  const run = engine.refineRunView()

  // 主控是否空闲（亲自运转的前提：人要在母港且无其它主控作业）
  const pilotFree =
    state.awayGalaxy === null &&
    !state.transit.active &&
    !state.expedition.active &&
    !state.scanning.active &&
    !state.standby.active &&
    !state.mining.active
  const pilotBusyNote = state.awayGalaxy !== null
    ? '你不在母港——先返航。'
    : state.mining.active
      ? '采矿作业中：先停止开采。'
      : state.expedition.active
        ? '远征中：先召回或等待结束。'
        : state.scanning.active
          ? '扫描探索中：先终止扫描。'
          : state.standby.active
            ? '待命行程中：先召回。'
            : state.transit.active
              ? '返航途中：到站后再运转。'
              : null

  const ownedCores = CORE_ORDER.filter((t) => (state.aiCores[t] ?? 0) > 0)
  const [corePick, setCorePick] = useState<AiCoreType>('basic')
  const coreReady = ownedCores.includes(corePick) ? corePick : (ownedCores[0] ?? null)

  /** 货仓+仓库里有货且带精炼配方的可精炼资源（矿石/气体/冰矿） */
  const oreDefs = engine.items.filter(
    (def) => (def.refine !== undefined && def.refine.length > 0) && oreTotal(def.id) > 0,
  )
  function oreTotal(id: string): number {
    return (state.fleet[state.shipId]?.cargo[id] ?? 0) + (state.warehouse.items[id] ?? 0)
  }

  function start(defId: string, worker: AiCoreType | 'pilot'): void {
    const def = engine.ctx.items.get(defId)
    const total = oreTotal(defId)
    const r = engine.startRefineRunAt(defId, worker)
    if (!r.ok) {
      onToast(r.error ?? '启动失败。', true)
    } else {
      onToast(`精炼炉启动：${def?.name ?? ''}×${total} 入炉（${worker === 'pilot' ? '你亲自运转' : 'AI 核心驱动'}，到点自动续批）。`)
    }
  }

  function stop(): void {
    const r = engine.stopRefineRunNow()
    if (!r.ok) onToast(r.error ?? '停炉失败。', true)
    else onToast('已停炉：已完成批保留，剩余原料退回仓库。')
  }

  return (
    <div className="page-stack">
      <Panel
        title="精炼炉"
        right={<span className="app-dim">收率 {Math.round(rate * 100)}%（精炼学 +8%/级 · 高级回收 +4%/级，上限 95%）</span>}
      >
        <div className="app-dim app-note">
          循环运转制：启动即把「当前船货仓 + 物品仓库」的该资源全部锁定入炉，按固定批量周期到点出矿物并自动续批，
          料尽自动停炉。劳动者 = 你亲自运转（占主控工作位）或接入一枚 AI 核心（不占副船）。
        </div>

        {run.active ? (
          <div className="app-inv-row">
            <div className="app-inv-main">
              <span className="app-inv-name">{run.itemName}</span>
              <span className="app-inv-count">
                {run.workerLabel}驱动 · 已炼 {run.batchesDone} 批 / 余 ×{run.lockedQty}（每批 {run.batchUnits} 单位 · {Math.round(run.cycleMs / 100) / 10} 秒）
                {run.remainingMs > 0 ? ` · 整炉约剩 ${Math.max(1, Math.ceil(run.remainingMs / 1000))} 秒` : ''}
              </span>
              <div className="app-refine-progress">
                <span className="app-refine-progress-fill" style={{ width: `${run.percent}%` }} />
              </div>
            </div>
            <div className="app-inv-btns">
              <button className="app-btn is-small is-warn" onClick={stop} title="停炉：已完成批保留，剩余原料全额退回仓库（AI 核心自动归还）">
                停炉
              </button>
            </div>
          </div>
        ) : null}

        {!run.active && oreDefs.length === 0 ? (
          <div className="app-dim app-inv-empty">
            没有可精炼的资源——先到「星图」页采集矿石/气体/冰矿（在船上或仓库里都行），或先停掉正在运转的炉子。
          </div>
        ) : null}

        {!run.active && oreDefs.length > 0 ? (
          <ul className="app-inv-list">
            {oreDefs.map((def) => {
              const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
              const cycleS = def.refineCycleMs && def.refineCycleMs > 0 ? Math.round(def.refineCycleMs / 100) / 10 : 6
              const total = oreTotal(def.id)
              const batchPreview = (def.refine ?? [])
                .map((row) => {
                  const mineral = engine.ctx.items.get(row.mineralId)
                  const units = Math.floor(batch * row.perOre * rate)
                  return units > 0 ? `${mineral?.name ?? row.mineralId}×${units}` : ''
                })
                .filter(Boolean)
                .join('、')
              const batches = Math.ceil(total / batch)
              return (
                <li key={def.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">{def.name}</span>
                    <span className="app-inv-count">
                      可用 ×{total.toLocaleString('zh-CN')}（{m3(total * def.unitM3)}）· 每批 {batch} 单位 / {cycleS} 秒 · 约 {batches} 批炼完
                      （每批产出 {batchPreview || '（收率过低无产出）'}）
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!pilotFree}
                      title={pilotFree ? '由你亲自运转：锁定全部库存，循环炼到料尽（期间不可离港作业）' : pilotBusyNote ?? undefined}
                      onClick={() => start(def.id, 'pilot')}
                    >
                      手动运转
                    </button>
                    {ownedCores.length > 0 ? (
                      <>
                        <select
                          className="app-dim"
                          value={coreReady ?? ''}
                          onChange={(e) => setCorePick(e.target.value as AiCoreType)}
                          title="选择接入精炼炉的 AI 核心（驱动期间核心被占用）"
                        >
                          {ownedCores.map((t) => (
                            <option key={t} value={t}>
                              {t === 'basic' ? '基础' : t === 'gamma' ? '伽马' : t === 'beta' ? '贝塔' : '阿尔法'}核心
                            </option>
                          ))}
                        </select>
                        <button
                          className="app-btn is-small"
                          title="接入 AI 核心自动运转（不占副船与主控；效率越高批周期越短）"
                          onClick={() => coreReady && start(def.id, coreReady)}
                        >
                          AI 运转
                        </button>
                      </>
                    ) : (
                      <button className="app-btn is-small" disabled title="没有 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。">
                        AI 运转
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </Panel>

      <BlueprintShelfPanel engine={engine} onToast={onToast} />
      <ManufacturingPanel engine={engine} onToast={onToast} />
    </div>
  )
}
