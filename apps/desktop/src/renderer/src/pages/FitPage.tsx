/**
 * 装配页：给"当前驾驶的船"装配装备（V10 六槽：采集器/货舱/炮台生效，
 * 护盾/装甲/推进器为占位家族——可装配，效果随战斗系统开放）。
 * 装备随船：换船后看到的是那艘船自己的装配；弃船时装备随船损失。
 */
import type { ModuleDef, ModuleSlot } from '@whale/core'
import { countModule, fittedBonuses, fleetDefOf, MODULE_SLOTS, shipDisplayName, slotLabel } from '@whale/core'
import { Panel } from '@whale/ui'
import { combatBadges, InfoTable, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import type { PageProps } from './common'

/** 立即生效的槽位（有真实效果文案） */
const LIVE_SLOTS = new Set<ModuleSlot>(['miner', 'cargo', 'turret'])

export function FitPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const shipDef = fleetDefOf(state, engine.ctx, state.shipId)
  const shipName = shipDisplayName(state, engine.ctx, state.shipId)
  const bonuses = fittedBonuses(state, engine.ctx)

  const fitted = state.fleet[state.shipId]?.fitted
  const effectText = (slot: ModuleSlot): string => {
    if (!LIVE_SLOTS.has(slot)) return '效果随战斗系统开放（占位）'
    const b = bonuses[slot] ?? 0
    if (slot === 'miner') return b > 0 ? `循环产量 +${Math.round(b * 100)}%` : '无加成'
    if (slot === 'cargo') return b > 0 ? `货仓容量 +${Math.round(b * 100)}%` : '无加成'
    return b > 0 ? `火力 +${Math.round(b * 100)}%（远征胜率提升）` : '无加成'
  }

  const bayModules: ModuleDef[] = engine.modules.filter((m) => countModule(state, m.id) > 0)

  // CPU 占用：当前驾驶船已装配模块的 cpuUse 合计（无人机放飞未来并入校验；契约占位展示）
  const cpuUsed = MODULE_SLOTS.reduce((sum, slot) => {
    const id = fitted?.[slot]
    if (!id) return sum
    return sum + (engine.ctx.modules.get(id)?.cpuUse ?? 0)
  }, 0)

  function handleFit(m: ModuleDef): void {
    const r = engine.fitModuleAt(m.id)
    if (!r.ok) onToast(r.error ?? '装配失败', true)
    else onToast(`${m.name} 已装配到${slotLabel(m.slot)}。`)
  }

  function handleUnfit(key: ModuleSlot): void {
    if (engine.unfitSlotAt(key)) onToast('装备已卸下并放回装备库。')
  }

  return (
    <div className="page-stack">
      <Panel title="装配台" right={<span className="app-dim">当前舰船：{shipName} · 装备随船</span>}>
        {shipDef ? (
          <div className="app-fit-shipinfo">
            <span className="app-fit-shipinfo-head">
              <span className="app-combat-badges">{combatBadges(shipDef)}</span>
            </span>
            <InfoTable
              lines={shipInfoLines(shipDef).filter((l) => l.k !== '槽位' && l.k !== '采集性能' && l.k !== '货舱容量')}
              note="盾/甲/结构/抗性/火力/命中/回避为战斗契约：战斗系统启用后生效；「动力」当前影响弃船避险、战斗机动与跃迁充能。"
            />
            <div className="app-info-row">
              <span className="app-info-key">CPU 占用</span>
              <span className="app-info-val">
                {cpuUsed} / {shipDef.cpu ?? '—'}
                <span className="app-dim">　契约占位：装备与无人机放飞共用，战斗系统启用后校验</span>
              </span>
            </div>
            {shipIndirectLines(shipDef).length > 0 ? (
              <div className="app-fit-shipinfo-low">
                <div className="app-info-note">间接属性（占位数值 · 对战斗的影响方式待战斗系统阶段确定）</div>
                <InfoTable lines={shipIndirectLines(shipDef)} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="app-fit-slots">
          {MODULE_SLOTS.map((slot) => {
            const fittedId = fitted?.[slot] ?? null
            const fittedDef = fittedId ? engine.ctx.modules.get(fittedId) : undefined
            return (
              <div key={slot} className={`app-fit-slot${fittedDef ? ' is-filled' : ''}`}>
                <div className="app-fit-slot-main">
                  <span className="app-fit-slot-name">{slotLabel(slot)}</span>
                  <span className="app-fit-slot-effect">{fittedDef ? `${fittedDef.name} · ${effectText(slot)}` : `空 · ${effectText(slot)}`}</span>
                </div>
                {fittedDef ? (
                  <button className="app-btn is-small is-warn" onClick={() => handleUnfit(slot)}>
                    卸下
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="装备库" right={<span className="app-dim">制造完成或卸下的装备 · 空间站库存不随船</span>}>
        {bayModules.length === 0 ? (
          <div className="app-dim app-inv-empty">装备库是空的——去「工业」页用蓝图制造一件。</div>
        ) : (
          <ul className="app-inv-list">
            {bayModules.map((m) => (
              <li key={m.id} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">{m.name}</span>
                  <span className="app-inv-count">
                    ×{countModule(state, m.id)} · {slotLabel(m.slot)}：
                    {m.slot === 'miner' ? `产量 +${Math.round(m.bonus * 100)}%`
                      : m.slot === 'cargo' ? `容量 +${Math.round(m.bonus * 100)}%`
                        : m.slot === 'turret' ? `火力 +${Math.round(m.bonus * 100)}%`
                          : '效果随战斗系统开放（占位）'}
                  </span>
                </div>
                <div className="app-inv-btns">
                  <button className="app-btn is-small is-primary" onClick={() => handleFit(m)}>
                    装配
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
