/**
 * 手册 / 图鉴：玩法速览 + 物品/装备/舰船/蓝图/技能图鉴。
 * - 数据页签支持「图标网格 / 列表」两种视图（默认网格，偏好存 localStorage）；
 * - 图标为统一科幻线性 SVG（Glyphs.tsx），按内容体系映射并带分类色调；
 * - 网格模式下点击卡片 → 弹出详情窗（完整字段）；点击窗口外任意位置关闭；
 * - 列表视图保留完整字段（材料/配方等）。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ITEM_KIND_LABELS, SHIP_ROLE_LABELS, SLOT_LABELS } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { Glyph, toneOf } from '../ui/Glyphs'
import { combatBadges, itemCombatLines, moduleInfoLines, shipInfoLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'

/** 宽类型标签索引（详情窗数据来自 raw，键是 string） */
const kindName = (k: string): string => (ITEM_KIND_LABELS as Record<string, string>)[k] ?? k
const slotName = (k: string): string => (SLOT_LABELS as Record<string, string>)[k] ?? k
const roleName = (k: string): string => (SHIP_ROLE_LABELS as Record<string, string>)[k] ?? k

type Tab = 'guide' | 'items' | 'modules' | 'ships' | 'blueprints' | 'skills'
type ViewMode = 'grid' | 'list'
/** 详情行数据 */
type RawData = Record<string, unknown>

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'guide', label: '玩法速览' },
  { key: 'items', label: '物品图鉴' },
  { key: 'modules', label: '装备图鉴' },
  { key: 'ships', label: '舰船图鉴' },
  { key: 'blueprints', label: '蓝图图鉴' },
  { key: 'skills', label: '技能速查' },
]
const VIEW_KEY = 'whale-idle:handbook-view'

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

const GUIDE_ROWS: Array<[string, string]> = [
  ['采矿', '星图页选矿带开采：矿石进当前船货仓；练「采矿技术/采矿护卫舰操作」提产量缩循环。'],
  ['装卸', '货仓页一键卸入物品仓库（无限容量、不随船）；矿也可直接市价卖出。'],
  ['精炼', '工业页把矿石炼成矿物（收率受精炼学/高级回收影响）；矿物是制造原料，也可卖出。'],
  ['制造', '市场买蓝图书 → 蓝图书架「学习」后永久可造 → 工业页开工（扣材料+制造费，到点自动入库/入坞）。'],
  ['装配', '装备库里的模块可装到船的采集器/货舱/炮台/护盾/装甲/推进器槽；卸下自动退回装备库。'],
  ['远征', '星图页选悬赏目标出发：按火力胜率结算，胜利得奖金/战利品/声望；失败扣耐久、可能弃船。'],
  ['AI 副船', '练「人工智能专家」+ 买基础 AI 核心，可给闲置舰船指派自动采矿/远征任务（核心效率越高越快）。'],
  ['交易', '市场页：常驻供应/稀有订单两栏，挂单与市价买卖；卖出成交收贸易税（练贸易技能减免）。'],
  ['随机事件', '深空偶发奇遇与市场风云：约 10~30 分钟一件，事件日志带 ✦，在线时弹小卡。'],
  ['耐久与维修', '远征失利会扣耐久，耐久归零弃船（货随船失）；舰船页可付费维修。'],
]

const GUIDE_NOTES: string[] = [
  '技能训练与采矿/远征并行：训练队列永不停歇，先排要练的技能即可。',
  '物品仓库与装备库是空间站资产，弃船不丢；船上的货仓与装备会随船遗失。',
  '离线最长结算 8 小时：下次启动会自动结算并弹离线简报。',
]

/* ═══════════ 网格渲染 ═══════════ */

interface GridCell {
  key: string
  tab: Tab
  glyph: string
  name: string
  sub: string
  /** 完整数据（详情窗用） */
  raw: RawData
}

function IconGrid({ cells, onPick }: { cells: GridCell[]; onPick: (c: GridCell) => void }) {
  return (
    <div className="app-hand-grid">
      {cells.map((c) => {
        const tone = toneOf(c.glyph)
        return (
          <button key={c.key} className="app-hand-cell" onClick={() => onPick(c)} style={{ '--tone': tone } as React.CSSProperties}>
            <span className="app-hand-cell-icon">
              <Glyph name={c.glyph} size={30} color={tone} />
            </span>
            <span className="app-hand-cell-name">{c.name}</span>
            <span className="app-hand-cell-sub">{c.sub}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════ 详情窗 ═══════════ */

/** 详情内容（按页签/数据类型给出完整字段） */
function DetailBody({ engine, cell }: { engine: GameEngine; cell: GridCell }) {
  const r = cell.raw
  const rows: Array<[string, ReactNode]> = []

  if (cell.tab === 'items') {
    const kind = String(r.kind ?? '')
    rows.push(['种类', kindName(kind)])
    rows.push(['单位体积', `${Number(r.unitM3 ?? 0)} m³`])
    // V10.5：弹药/无人机补充伤害契约（与其它界面统一由 shipInfo 生成）
    const itemId = String(r.id ?? '')
    const itemDef = itemId ? engine.ctx.items.get(itemId) : undefined
    if (itemDef && (itemDef.kind === 'ammo' || itemDef.kind === 'drone')) {
      for (const line of itemCombatLines(itemDef)) rows.push([line.k, line.v])
    }
    const refine = (r.refine as Array<{ mineralId: string; perOre: number }> | undefined) ?? []
    if (refine.length > 0) {
      rows.push([
        '精炼配方',
        refine
          .map((row) => `${engine.ctx.items.get(row.mineralId)?.name ?? row.mineralId} ×${row.perOre}`)
          .join('　'),
      ])
    }
  } else if (cell.tab === 'modules') {
    const modId = String(r.id ?? '')
    const modDef = modId ? engine.ctx.modules.get(modId) : undefined
    if (modDef) {
      // V10.5：统一行（基础加成 + 盾/甲/推进/炮台契约字段）
      for (const line of moduleInfoLines(modDef)) rows.push([line.k, line.v])
      const parts: string[] = []
      if (modDef.shieldHpBonus !== undefined || modDef.armorHpBonus !== undefined || modDef.agilityBonus !== undefined || modDef.weaponSize !== undefined) {
        parts.push('战斗契约数值，战斗系统启用后生效')
      }
      if (parts.length > 0) rows.push(['说明', parts.join('')])
    } else {
      rows.push(['槽位', `${slotName(String(r.slot ?? ''))} · 加成 ${Math.round(Number(r.bonus ?? 0) * 100)}%`])
    }
  } else if (cell.tab === 'ships') {
    const shipId = String(r.id ?? '')
    const shipDef = shipId ? engine.ctx.ships.get(shipId) : undefined
    if (shipDef) {
      // V10.5：统一行（定位/货舱/采集/动力 + 盾甲结构抗性与槽位）
      for (const line of shipInfoLines(shipDef)) rows.push([line.k, line.v])
      rows.push(['说明', '盾/甲/结构/火力为战斗契约数值：战斗系统启用后生效'])
      rows.push(['获取方式', Number(r.priceIsk ?? 0) <= 0 ? '仅可制造（市场偶尔闪现）' : '市场流通'])
    } else {
      const role = String(r.role ?? 'industrial')
      rows.push(['定位 / 档次', `${roleName(role)} · T${Number(r.tier ?? 0)}`])
      rows.push(['货舱容量', `${Number(r.cargoM3 ?? 0).toLocaleString('zh-CN')} m³`])
      rows.push(['采集性能', `${Number(r.cycleSeconds ?? 0)} 秒 × ${Number(r.oreUnitsPerCycle ?? 0)} 单位/循环`])
      rows.push(['动力（机动 / 跃迁充能）', `${Math.round(Number(r.agility ?? 0) * 100)}%`])
      if (Number(r.priceIsk ?? 0) <= 0) rows.push(['获取方式', '仅可制造（市场偶尔闪现）'])
    }
  } else if (cell.tab === 'blueprints') {
    const materials = (r.materials as Array<{ itemId: string; count: number }> | undefined) ?? []
    const moduleId = r.moduleId !== undefined ? String(r.moduleId) : undefined
    const shipId = r.shipId !== undefined ? String(r.shipId) : undefined
    rows.push(['产物', moduleId !== undefined ? `${engine.ctx.modules.get(moduleId)?.name ?? moduleId}（装备）` : `${engine.ctx.ships.get(shipId ?? '')?.name ?? shipId ?? ''}（舰船）`])
    rows.push([
      '材料需求',
      <span key="mats" className="app-detail-mats">
        {materials.map((m) => (
          <span key={m.itemId} className="app-detail-mat">
            {engine.ctx.items.get(m.itemId)?.name ?? m.itemId} ×{m.count.toLocaleString('zh-CN')}
          </span>
        ))}
      </span>,
    ])
    rows.push(['耗时', `约 ${Math.round(Number(r.buildSeconds ?? 0) / 60)} 分钟（受工业理论缩短）`])
    rows.push(['制造费', `${Number(r.buildCostIsk ?? 0).toLocaleString('zh-CN')} ISK`])
  } else if (cell.tab === 'skills') {
    rows.push(['技能组', String(r.group ?? '')])
    rows.push(['训练难度', `rank ${Number(r.rank ?? 0)}（数值越大整条线练得越慢）`])
  }

  return (
    <div className="app-detail-body">
      {rows.map(([k, v]) => (
        <div key={k} className="app-detail-row">
          <span className="app-detail-key">{k}</span>
          <span className="app-detail-val">{v}</span>
        </div>
      ))}
      {String(r.description ?? '') !== '' ? (
        <div className="app-detail-desc">{plainSkillDesc(String(r.description))}</div>
      ) : null}
    </div>
  )
}

function CellDetail({
  engine,
  cell,
  onClose,
}: {
  engine: GameEngine
  cell: GridCell
  onClose: () => void
}) {
  const tone = toneOf(cell.glyph)
  return (
    <div className="app-detail-mask" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div
        className="app-detail"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        style={{ '--tone': tone } as React.CSSProperties}
      >
        <div className="app-detail-head">
          <span className="app-hand-cell-icon">
            <Glyph name={cell.glyph} size={44} color={tone} />
          </span>
          <div className="app-detail-title">
            <div className="app-detail-name">{cell.name}</div>
            <div className="app-detail-sub">{cell.sub}</div>
          </div>
        </div>
        <DetailBody engine={engine} cell={cell} />
        <div className="app-dim app-detail-tip">点击窗口外部任意位置关闭</div>
      </div>
    </div>
  )
}

/* ═══════════ 数据页签外壳 ═══════════ */

function DataTab({
  view,
  onView,
  cells,
  renderList,
  onPick,
}: {
  view: ViewMode
  onView: (v: ViewMode) => void
  cells: GridCell[]
  renderList: () => ReactNode
  onPick: (c: GridCell) => void
}) {
  return (
    <>
      <div className="app-hand-viewbar">
        <span className="app-dim">显示方式：</span>
        <button className={`app-hand-viewbtn${view === 'grid' ? ' is-active' : ''}`} onClick={() => onView('grid')}>
          图标
        </button>
        <button className={`app-hand-viewbtn${view === 'list' ? ' is-active' : ''}`} onClick={() => onView('list')}>
          列表
        </button>
      </div>
      {view === 'grid' ? <IconGrid cells={cells} onPick={onPick} /> : renderList()}
    </>
  )
}

/** 行内小图标（列表视图前缀） */
function RowGlyph({ glyph }: { glyph: string }) {
  return (
    <span className="app-hand-row-glyph" style={{ color: toneOf(glyph) }}>
      <Glyph name={glyph} size={15} color="currentColor" />
    </span>
  )
}

export function Handbook({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('guide')
  const [view, setView] = useState<ViewMode>(readView)
  const [detail, setDetail] = useState<GridCell | null>(null)

  function changeView(v: ViewMode): void {
    setView(v)
    setDetail(null)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 本地存储不可用：忽略
    }
  }

  /* ── 网格单元（glyph 名即色调键；raw 带完整数据供详情窗） ── */
  const itemCells: GridCell[] = engine.items.map((item) => ({
    key: item.id,
    tab: 'items',
    glyph: item.kind,
    name: item.name,
    sub: `${kindName(item.kind)} · ${item.unitM3} m³`,
    raw: item as unknown as RawData,
  }))
  const moduleCells: GridCell[] = engine.modules.map((mod) => ({
    key: mod.id,
    tab: 'modules',
    glyph: mod.slot,
    name: mod.name,
    sub: `${slotName(mod.slot)} · ${Math.round(mod.bonus * 100)}%`,
    raw: mod as unknown as RawData,
  }))
  const shipCells: GridCell[] = engine.ships.map((ship) => {
    const role = ship.role ?? 'industrial'
    return {
      key: ship.id,
      tab: 'ships',
      glyph: role,
      name: ship.name,
      sub: `${roleName(role)} · T${ship.tier} · ${ship.cargoM3.toLocaleString('zh-CN')} m³`,
      raw: ship as unknown as RawData,
    }
  })
  const bpCells: GridCell[] = [
    ...engine.blueprints.map((bp) => ({
      key: bp.id,
      tab: 'blueprints' as Tab,
      glyph: 'blueprint',
      name: bp.name,
      sub: `装备 · ${engine.ctx.modules.get(bp.moduleId)?.name ?? bp.moduleId}`,
      raw: bp as unknown as RawData,
    })),
    ...engine.shipBlueprints.map((bp) => ({
      key: bp.id,
      tab: 'blueprints' as Tab,
      glyph: 'blueprint',
      name: bp.name,
      sub: `舰船 · ${engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}`,
      raw: bp as unknown as RawData,
    })),
  ]
  const skillCells: GridCell[] = engine.skills.map((s) => ({
    key: s.id,
    tab: 'skills',
    glyph: `group-${s.group}`,
    name: s.name,
    sub: `${s.group} · 难度 ${s.rank}`,
    raw: s as unknown as RawData,
  }))

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">手册 · 图鉴</span>
          <button className="app-btn is-small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="app-modal-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`app-modal-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="app-modal-body app-hand-body">
          {tab === 'guide' ? (
            <div className="app-hand-guide">
              {GUIDE_ROWS.map(([k, v]) => (
                <div key={k} className="app-hand-guide-row">
                  <b className="app-hand-guide-key">{k}</b>
                  <span>{v}</span>
                </div>
              ))}
              <div className="app-bay-title">小贴士</div>
              <ul className="app-hand-notes">
                {GUIDE_NOTES.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === 'items' ? (
            <DataTab
              view={view}
              onView={changeView}
              cells={itemCells}
              onPick={setDetail}
              renderList={() => (
                <ul className="app-hand-list">
                  {engine.items.map((item) => {
                    const refine = (item.refine ?? [])
                      .map((r) => `${engine.ctx.items.get(r.mineralId)?.name ?? r.mineralId}×${r.perOre}`)
                      .join(' + ')
                    return (
                      <li key={item.id} className="app-hand-entry">
                        <div className="app-inv-name">
                          <RowGlyph glyph={item.kind} /> {item.name}
                          <span className="app-chip is-dim">{kindName(item.kind)}</span>
                          <span className="app-dim"> · {item.unitM3} m³/单位</span>
                        </div>
                        <div className="app-dim">{item.description}</div>
                        {refine ? <div className="app-hand-sub">精炼（100% 收率）→ {refine}</div> : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            />
          ) : null}

          {tab === 'modules' ? (
            <DataTab
              view={view}
              onView={changeView}
              cells={moduleCells}
              onPick={setDetail}
              renderList={() => (
                <ul className="app-hand-list">
                  {engine.modules.map((mod) => (
                    <li key={mod.id} className="app-hand-entry">
                      <div className="app-inv-name">
                        <RowGlyph glyph={mod.slot} /> {mod.name}
                        <span className="app-chip is-dim">{slotName(mod.slot)}</span>
                        <span className="app-gold"> {Math.round(mod.bonus * 100)}%</span>
                      </div>
                      <div className="app-dim">{mod.description}</div>
                    </li>
                  ))}
                </ul>
              )}
            />
          ) : null}

          {tab === 'ships' ? (
            <DataTab
              view={view}
              onView={changeView}
              cells={shipCells}
              onPick={setDetail}
              renderList={() => (
                <ul className="app-hand-list">
                  {engine.ships.map((ship) => {
                    const role = ship.role ?? 'industrial'
                    return (
                      <li key={ship.id} className="app-hand-entry">
                        <div className="app-inv-name">
                          <RowGlyph glyph={role} /> {ship.name}
                          <span className="app-chip is-dim">T{ship.tier}</span>
                          <span className={`app-chip app-role-chip is-${role}`}>{roleName(role)}</span>
                          {ship.priceIsk <= 0 ? <span className="app-chip">仅可制造</span> : null}
                        </div>
                        <div className="app-dim">
                          货舱 {ship.cargoM3.toLocaleString('zh-CN')} m³ · 循环 {ship.cycleSeconds} 秒 × {ship.oreUnitsPerCycle} 单位 ·
                          动力 {Math.round(ship.agility * 100)}%
                        </div>
                        <div className="app-hand-sub">
                          <span className="app-combat-badges">{combatBadges(ship)}</span>
                          <span className="app-dim">（契约数值：战斗系统启用后生效）</span>
                        </div>
                        <div className="app-hand-sub">{ship.description}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            />
          ) : null}

          {tab === 'blueprints' ? (
            <DataTab
              view={view}
              onView={changeView}
              cells={bpCells}
              onPick={setDetail}
              renderList={() => (
                <ul className="app-hand-list">
                  {engine.blueprints.map((bp) => {
                    const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
                    return (
                      <li key={bp.id} className="app-hand-entry">
                        <div className="app-inv-name">
                          <RowGlyph glyph="blueprint" /> {bp.name}
                        </div>
                        <div className="app-dim">产物：{engine.ctx.modules.get(bp.moduleId)?.name ?? bp.moduleId}（装备）</div>
                        <div className="app-hand-sub">
                          材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} 分 · 制造费 {bp.buildCostIsk.toLocaleString('zh-CN')} ISK
                        </div>
                        <div className="app-dim">{bp.description}</div>
                      </li>
                    )
                  })}
                  {engine.shipBlueprints.map((bp) => {
                    const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
                    return (
                      <li key={bp.id} className="app-hand-entry">
                        <div className="app-inv-name">
                          <RowGlyph glyph="blueprint" /> {bp.name}
                        </div>
                        <div className="app-dim">产物：{engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}（舰船）</div>
                        <div className="app-hand-sub">
                          材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} 分 · 制造费 {bp.buildCostIsk.toLocaleString('zh-CN')} ISK
                        </div>
                        <div className="app-dim">{bp.description}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            />
          ) : null}

          {tab === 'skills' ? (
            <DataTab
              view={view}
              onView={changeView}
              cells={skillCells}
              onPick={setDetail}
              renderList={() => (
                <div>
                  {engine.groups.map((group) => (
                    <div key={group}>
                      <div className="app-bay-title">
                        <RowGlyph glyph={`group-${group}`} /> {group}
                      </div>
                      <ul className="app-hand-list">
                        {engine.skills
                          .filter((s) => s.group === group)
                          .map((s) => (
                            <li key={s.id} className="app-hand-entry">
                              <div className="app-inv-name">
                                {s.name}
                                <span className="app-chip is-dim">难度 {s.rank}</span>
                              </div>
                              <div className="app-dim">{plainSkillDesc(s.description)}</div>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            />
          ) : null}
        </div>
      </div>
      {detail !== null ? <CellDetail engine={engine} cell={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
