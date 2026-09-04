/**
 * 装配页（V18 槽位制）：给"当前驾驶的船"装配装备。
 * 高/中/低三类物理槽 × 位序（ShipDef.slots 数量，复数安装）；模块按 rack 归槽
 * （高 = 炮台/采集器/无人机装置；中 = 盾系/推进；低 = 甲系/货舱扩展）。
 * 装备随船：换船后看到的是那艘船自己的装配；弃船时装备随船损失。
 */
import type { ReactNode } from 'react'
import type { DamageResists, ModuleDef, ModuleSlot, RackSlot } from '@whale/core'
import {
  countModule,
  createPlayerSpec,
  fleetDefOf,
  fittedCpuUsed,
  RACK_LABELS,
  rackLabel,
  rackOf,
  sameKindCount,
  shipDisplayName,
  shipSlotsOf,
  slotLabel,
  stackingOf,
  stackWeight,
} from '@whale/core'
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

/** 槽类可装家族简述（空位引导文案；V18.1 支援件：伤害/射速 = 低槽，命中/闪避 = 中槽） */
const RACK_FAMILIES: Record<RackSlot, string> = {
  high: '炮台 / 导弹架 / 采集器 / 无人机装置',
  mid: '护盾增强・扩展 / 矢量推进器 / 索敌・陀螺（命中・闪避支援）',
  low: '装甲镀层・增厚板 / 货舱扩展 / 稳定器・射速计算机（伤害・射速支援）',
}

/** 数字千分位 */
const fmt = (n: number): string => n.toLocaleString('zh-CN')

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
  const slots = shipDef ? shipSlotsOf(shipDef) : { high: 1, mid: 1, low: 1 }
  // 装后合成（与战斗引擎同源：血量含容量件、抗性含乘入缺口、速度含加力曲线、回避含陀螺缺口）
  const spec = shipDef ? createPlayerSpec(state, engine.ctx, state.shipId) : null
  // V18.1 索敌阵列（命中件）：炮台命中乘子（收敛后；条目层）
  const gunEq = spec?.weapons.find((w) => w.kind === 'gun')?.eqHitMul

  const bayModules: ModuleDef[] = engine.modules.filter((m) => countModule(state, m.id) > 0)
  // CPU 占用（全位合计，与无人机放飞共用）
  const cpuUsed = fitted ? fittedCpuUsed(fitted, engine.ctx) : 0

  function handleFit(m: ModuleDef): void {
    const r = engine.fitModuleAt(m.id)
    if (!r.ok) onToast(r.error ?? '装配失败', true)
    else onToast(`${m.name} 已装配到${rackLabel(rackOf(m))}。`)
  }

  function handleFitToBay(m: ModuleDef, rack: RackSlot, index: number): void {
    const r = engine.fitModuleTo(m.id, rack, index)
    if (!r.ok) onToast(r.error ?? '装配失败', true)
    else onToast(`${m.name} 已装入${rackLabel(rack)}第 ${index + 1} 位。`)
  }

  function handleUnfit(rack: RackSlot, index: number): void {
    if (engine.unfitAtAt(rack, index)) onToast('装备已卸下并放回装备库。')
  }

  /** 空位候选下拉文案：V18.1 收敛件标注"第 N 件衰减"（避免玩家误以为全效线性叠加） */
  function fitOptionLabel(m: ModuleDef): string {
    const base = `${m.name}（×${countModule(state, m.id)} · ${moduleShortEffect(m)}）`
    if (!fitted) return base
    const st = stackingOf(m)
    if (st.group === 'flat') return base
    const n = sameKindCount(fitted, engine.ctx, m)
    if (n === 0) return base
    if (st.group === 'curve') {
      return `${base} ← 同类第 ${n + 1} 件：按 ${Math.round(stackWeight(n + 1) * 100)}% 生效`
    }
    return `${base} ← 同类第 ${n + 1} 件：只削剩余缺口（收益递减）`
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
                ...shipInfoLines(shipDef).filter(
                  (l) => l.k !== '槽位' && l.k !== '采集性能' && l.k !== '货舱容量' && !COMBAT_BASE_KEYS.has(l.k),
                ),
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
                      // V18.1：合成预览（收敛件多装的最终值——回避/命中/速度均为装后结果）
                      { k: '回避率（含装备）', v: `${Math.round(spec.evasion * 100)}%` },
                      {
                        k: '开火命中修正（含装备）',
                        v: `推进失稳 ×${(spec.hitMul ?? 1).toFixed(2)}${
                          gunEq !== undefined ? ` · 索敌 ×${gunEq.toFixed(2)}` : ''
                        }`,
                      },
                      { k: '机动速度（含加力）', v: `${fmt(Math.round(spec.speedMps))} m/s` },
                    ]
                  : []),
              ]}
              note={`槽位布局：${slots.high} 高 / ${slots.mid} 中 / ${slots.low} 低（复数安装）；抗性 = EVE 式乘入合成（上限 90%）；V18.1 多装规则：伤害/射速/容量全额叠加，命中/闪避/抗性/速度收益递减；「动力」影响弃船避险与跃迁充能。`}
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
                <div className="app-info-note">间接属性（2026-09 定：速度参与战斗机动与航行；信号/锁定/质量为设定展示，不参与战斗公式）</div>
                <InfoTable lines={shipIndirectLines(shipDef)} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* V18：高/中/低三组槽位（每组按位序列出；复数安装） */}
        <div className="app-fit-racks">
          {(['high', 'mid', 'low'] as RackSlot[]).map((rack) => {
            const bays = fitted ? fitted[rack] : []
            const filledCount = bays.filter((id) => id !== null).length
            const total = slots[rack]
            const candidates = bayModules.filter((m) => rackOf(m) === rack)
            return (
              <div key={rack} className="app-fit-rack">
                <div className="app-fit-rack-title">
                  {RACK_LABELS[rack]} <span className="app-dim">（{RACK_FAMILIES[rack]}）</span>
                  <span className="app-dim">　{filledCount}/{total} 已占</span>
                </div>
                {Array.from({ length: Math.max(total, bays.length) }, (_, i) => {
                  const fittedId = bays[i] ?? null
                  const fittedDef = fittedId ? engine.ctx.modules.get(fittedId) : undefined
                  if (!fittedDef) {
                    // 空位：给出该类候选件（库中），一键装入本空位
                    return (
                      <div key={`${rack}-${i}`} className="app-fit-slot">
                        <div className="app-fit-slot-main">
                          <span className="app-fit-slot-name">第 {i + 1} 位</span>
                          <span className="app-fit-slot-effect">
                            空
                            {candidates.length > 0 ? (
                              <select
                                className="app-select app-fit-baypick"
                                value=""
                                onChange={(e) => {
                                  const mid = e.target.value
                                  if (!mid) return
                                  const m = engine.ctx.modules.get(mid)
                                  if (m) handleFitToBay(m, rack, i)
                                }}
                              >
                                <option value="">— 装入…</option>
                                {candidates.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {fitOptionLabel(m)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="app-dim">（装备库无此类件——市场/制造获取）</span>
                            )}
                          </span>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={`${rack}-${i}`} className="app-fit-slot is-filled">
                      <div className="app-fit-slot-main">
                        <span className="app-fit-slot-name">第 {i + 1} 位</span>
                        <span className="app-fit-slot-effect">
                          <ModuleHover mod={fittedDef}>{`${fittedDef.name} · ${moduleShortEffect(fittedDef)}`}</ModuleHover>
                        </span>
                      </div>
                      <button className="app-btn is-small is-warn" onClick={() => handleUnfit(rack, i)}>
                        卸下
                      </button>
                    </div>
                  )
                })}
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
                    ×{countModule(state, m.id)} · {slotLabel(m.slot)} · {rackLabel(rackOf(m))}：{moduleShortEffect(m)}
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
