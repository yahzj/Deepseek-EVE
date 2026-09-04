/**
 * 装配页：给"当前驾驶的船"装配装备（V17.1：六槽全部真生效——工业槽加产量/容量；
 * 战斗槽抗性件与容量件同槽二选一（护盾增强器/扩展器、装甲镀层/增厚板）、炮台武器卡、
 * 矢量推进器带常驻命中代价；装配受船体 CPU 上限约束，档位 5/15/40）。
 * 装备随船：换船后看到的是那艘船自己的装配；弃船时装备随船损失。
 */
import type { ReactNode } from 'react'
import type { DamageResists, ModuleDef, ModuleSlot } from '@whale/core'
import { countModule, createPlayerSpec, fleetDefOf, MODULE_SLOTS, shipDisplayName, slotLabel } from '@whale/core'
import { Panel } from '@whale/ui'
import { combatBadges, DmgChip, DMG_LABEL, InfoTable, ModuleHover, moduleShortEffect, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import type { PageProps } from './common'

/** 装配台主表的战斗基础行（由"装后合成"行取代，避免基础/合成重复） */
const COMBAT_BASE_KEYS = new Set([
  '护盾',
  '护盾抗性',
  '装甲',
  '装甲抗性',
  '结构',
  '结构抗性',
  '火力加成',
  '命中加成',
  '回避率',
])

/** 单层抗性 chips：只列非零系（chip 底色 = 类型色），全零 = "—" */
function layerResChips(res: DamageResists | undefined): ReactNode {
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: res?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (parts.length === 0) return '—'
  return parts.map((x, i) => (
    <span key={x.t}>
      {i > 0 ? ' ' : null}
      <DmgChip t={x.t} label={`${DMG_LABEL[x.t]} ${Math.round(x.v * 100)}%`} />
    </span>
  ))
}

export function FitPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const shipDef = fleetDefOf(state, engine.ctx, state.shipId)
  const shipName = shipDisplayName(state, engine.ctx, state.shipId)
  const fitted = state.fleet[state.shipId]?.fitted
  // 装后合成（与战斗引擎同源：血量含容量件、抗性含乘入缺口、速度含加力、命中含失稳）
  const spec = shipDef ? createPlayerSpec(state, engine.ctx, state.shipId) : null

  // 空槽短文案（按槽位一句引导）
  const emptyText = (slot: ModuleSlot): string => {
    if (slot === 'shield') return '增强器（分系抗性）或扩展器（护盾容量）——二选一'
    if (slot === 'armor') return '镀层（分系抗性）或增厚板（装甲容量）——二选一'
    if (slot === 'propulsion') return '矢量推进器：加力速度加成 + 命中代价'
    if (slot === 'turret') return '炮台：武器卡——射程/命中/装填/伤害（配弹）'
    if (slot === 'miner') return '采集器：循环产量加成'
    return '货舱扩展：容量加成'
  }

  const bayModules: ModuleDef[] = engine.modules.filter((m) => countModule(state, m.id) > 0)

  // CPU 占用：当前驾驶船已装配模块的 cpuUse 合计（V17.1 校验生效，档位 5/15/40）
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
              lines={[
                ...shipInfoLines(shipDef).filter((l) => l.k !== '槽位' && l.k !== '采集性能' && l.k !== '货舱容量' && !COMBAT_BASE_KEYS.has(l.k)),
                ...(spec
                  ? [
                      {
                        k: '血量（含装备）',
                        v: `盾 ${Math.round(spec.hp.s)} · 甲 ${Math.round(spec.hp.a)} · 结构 ${Math.round(spec.hp.h)}`,
                      },
                      {
                        k: '抗性（含装备）',
                        v: (
                          <>
                            盾 {layerResChips(spec.resists.shield)}　甲 {layerResChips(spec.resists.armor)}　结构{' '}
                            {layerResChips(spec.resists.hull)}
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
              note="抗性 = EVE 式乘入合成（上限 90%）；推进器 = 速度加成 + 命中代价；「动力」影响弃船避险与跃迁充能。"
            />
            <div className="app-info-row">
              <span className="app-info-key">CPU 占用</span>
              <span className="app-info-val">
                {cpuUsed} / {shipDef.cpu ?? '—'}
                <span className="app-dim">　档位：低级 5 / 中级 15 / 高级 40（炮台更高）；与无人机放飞共用，超上限拒绝装配</span>
              </span>
            </div>
            {shipIndirectLines(shipDef).length > 0 ? (
              <div className="app-fit-shipinfo-low">
                <div className="app-info-note">间接属性（速度/信号/锁定——战斗与装配决策参考）</div>
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
                  <span className="app-fit-slot-effect">
                    {fittedDef ? (
                      <ModuleHover mod={fittedDef}>{`${fittedDef.name} · ${moduleShortEffect(fittedDef)}`}</ModuleHover>
                    ) : (
                      `空 · ${emptyText(slot)}`
                    )}
                  </span>
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
          <div className="app-dim app-inv-empty">装备库是空的——去「工业」页用蓝图制造，或在市场淘现成装备。</div>
        ) : (
          <ul className="app-inv-list">
            {bayModules.map((m) => (
              <ModuleHover key={m.id} as="li" mod={m} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">{m.name}</span>
                  <span className="app-inv-count">
                    ×{countModule(state, m.id)} · {slotLabel(m.slot)}：{moduleShortEffect(m)}
                  </span>
                </div>
                <div className="app-inv-btns">
                  <button className="app-btn is-small is-primary" onClick={() => handleFit(m)}>
                    装配
                  </button>
                </div>
              </ModuleHover>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
