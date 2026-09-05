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
import { combatBadges, InfoHover, itemCombatLines, ItemHover, ModuleHover, moduleInfoLines, moduleShortEffect, ShipHover, shipInfoLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'

/** 宽类型标签索引（详情窗数据来自 raw，键是 string） */
const kindName = (k: string): string => (ITEM_KIND_LABELS as Record<string, string>)[k] ?? k
const slotName = (k: string): string => (SLOT_LABELS as Record<string, string>)[k] ?? k
const roleName = (k: string): string => (SHIP_ROLE_LABELS as Record<string, string>)[k] ?? k

type Tab = 'guide' | 'rules' | 'items' | 'modules' | 'ships' | 'blueprints' | 'skills'
type ViewMode = 'grid' | 'list'
/** 详情行数据 */
type RawData = Record<string, unknown>

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'guide', label: '玩法速览' },
  { key: 'rules', label: '航行须知' },
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
  ['AI 副船', '练「人工智能专家」+ 买基础 AI 核心，可给闲置舰船指派自动采矿/打捞/驻留待命任务（核心效率越高越快）。AI 远征已下线（2026-09-05）：悬赏请主控亲自出击。'],
  ['交易', '市场页：常驻供应/稀有订单两栏，挂单与市价买卖；卖出成交收贸易税（练贸易技能减免）。'],
  ['随机事件', '深空偶发奇遇与市场风云：约 10~30 分钟一件，事件日志带 ✦，在线时弹小卡。'],
  ['耐久与维修', '远征失利会扣耐久，耐久归零弃船（货随船失）；舰船页可付费维修。'],
]

/** 航行须知 · 低安安全规则（B1；2026-09-04 定稿） */
const RULES_LOWSEC: Array<[string, string]> = [
  ['安全等级', '星图星系标色：越高越安全。sec ≥ 0.5 高安基本太平；低于 0 越深越危险。'],
  ['什么会遇袭', '在低安星系的采矿（含往返矿带）、远征途中、以及胜利后停留，都可能撞见巡逻拦截或海盗伏击；AI 副船同样会遇。'],
  ['承担者', '同一低安星系我方有船在场时，停泊/停留的船优先成为目标（区域事件一次，事件后该星系冷却一段时间）。'],
  ['触发节奏', '到达低安约 5 分钟后才可能遇袭（安全缓冲）；遇袭判定与随机事件共用时机——事件到点时可能撞上巡逻/伏击，也可能照常出事件。'],
  ['在线时', '遭遇会弹出「伏击待决」横幅：可「⚔ 迎战」（进入实时战斗，自动打完）或「💨 快速脱离」；60 秒未处置自动脱离。'],
  ['离线时', '离线（含离线结算）遭遇直接文字结算，不会凭空等你去点。'],
  ['结局三档', '击退：缴获少量 ISK；受损：耐久 −5%~15%（底线 5%，绝不弃船）；被抢：至多 30% 船上货物（无货则抢少量钱包）。'],
]

/** 航行须知 · 重要规则留档（后续新机制持续补充） */
const RULES_CORE: Array<[string, string]> = [
  ['采矿 ↔ 远征 转场', '采矿中点悬赏「⚡ 转战出发」= 结束采矿（货随船）并从矿带星系出发；远征中点矿带「⚡ 转开采」= 取消远征（无战果、连击同步停）并回港开采。均需两次确认。'],
  ['连续出击', '「连续出击」在空闲时可开：打完自动冷却 10 秒再战；货仓装不下缴获 / 耐久低于 50% 且修理组件耗尽 / 战败都会自动暂停。'],
  ['战斗撤退', '交火中可「⚑ 撤退」（活动栏或战场内，两次确认）：轻损脱离、无弃船风险、自动返航并停止连击。'],
  ['船只锁定', '锁定只防误售：驾驶、AI 执勤、维修、改名都不受影响。'],
  ['重复舰船', '同型可买多艘：第 2 艘起默认带「#N」；可自由改名（10 字内、允许重名），改名后全界面显示自定义名。'],
  ['货仓与出售', '装卸与出售只对当前驾驶船；出售需回母港市场；副站可卸货入仓库。'],
  ['离线结算', '离线最长结算 8 小时，重启自动结算并弹离线简报。'],
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
      // V17：统一行——各家族真实进公式参数（工业加成 / 武器卡 / 容量+缺口抗性 / 加力推进）
      for (const line of moduleInfoLines(modDef)) rows.push([line.k, line.v])
    } else {
      rows.push(['槽位', `${slotName(String(r.slot ?? ''))} · 加成 ${Math.round(Number(r.bonus ?? 0) * 100)}%`])
    }
  } else if (cell.tab === 'ships') {
    const shipId = String(r.id ?? '')
    const shipDef = shipId ? engine.ctx.ships.get(shipId) : undefined
    if (shipDef) {
      // V10.5：统一行（定位/货舱/采集/动力 + 盾甲结构抗性与槽位）；V17 战斗数值已生效
      for (const line of shipInfoLines(shipDef)) rows.push([line.k, line.v])
      rows.push(['说明', '已生效战斗数值：抗性为整数主抗制，增强器以缺口乘入合成（上限 90%）'])
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
    sub: `${slotName(mod.slot)} · ${moduleShortEffect(mod)}`,
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

          {tab === 'rules' ? (
            <div className="app-hand-guide">
              <div className="app-bay-title">低安安全（安全等级 = 星系风险）</div>
              {RULES_LOWSEC.map(([k, v]) => (
                <div key={k} className="app-hand-guide-row">
                  <b className="app-hand-guide-key">{k}</b>
                  <span>{v}</span>
                </div>
              ))}
              <div className="app-bay-title">重要规则留档</div>
              {RULES_CORE.map(([k, v]) => (
                <div key={k} className="app-hand-guide-row">
                  <b className="app-hand-guide-key">{k}</b>
                  <span>{v}</span>
                </div>
              ))}
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
                      <ItemHover
                        key={item.id}
                        as="li"
                        item={item}
                        nameOf={(pid) => engine.ctx.items.get(pid)?.name}
                        className="app-hand-entry"
                      >
                        <div className="app-inv-name">
                          <RowGlyph glyph={item.kind} /> {item.name}
                          <span className="app-chip is-dim">{kindName(item.kind)}</span>
                          <span className="app-dim"> · {item.unitM3} m³/单位</span>
                        </div>
                        <div className="app-dim">{item.description}</div>
                        {refine ? <div className="app-hand-sub">精炼（100% 收率）→ {refine}</div> : null}
                      </ItemHover>
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
                    <ModuleHover key={mod.id} as="li" mod={mod} className="app-hand-entry">
                      <div className="app-inv-name">
                        <RowGlyph glyph={mod.slot} /> {mod.name}
                        <span className="app-chip is-dim">{slotName(mod.slot)}</span>
                        <span className="app-gold"> {moduleShortEffect(mod)}</span>
                      </div>
                      <div className="app-dim">{mod.description}</div>
                    </ModuleHover>
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
                      <ShipHover key={ship.id} as="li" ship={ship} className="app-hand-entry">
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
                          <span className="app-dim">（战斗数值已启用 · 悬停查看完整面板）</span>
                        </div>
                        <div className="app-hand-sub">{ship.description}</div>
                      </ShipHover>
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
                      <InfoHover
                        key={bp.id}
                        as="li"
                        title={bp.name}
                        lines={[
                          { k: '产物', v: `${engine.ctx.modules.get(bp.moduleId)?.name ?? bp.moduleId}（装备）` },
                          { k: '材料需求', v: mats },
                          { k: '制造', v: `${(bp.buildSeconds / 60).toFixed(0)} 分 · 造费 ${bp.buildCostIsk.toLocaleString('zh-CN')} ISK` },
                        ]}
                        note={bp.description}
                        className="app-hand-entry"
                      >
                        <div className="app-inv-name">
                          <RowGlyph glyph="blueprint" /> {bp.name}
                        </div>
                        <div className="app-dim">产物：{engine.ctx.modules.get(bp.moduleId)?.name ?? bp.moduleId}（装备）</div>
                        <div className="app-hand-sub">
                          材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} 分 · 制造费 {bp.buildCostIsk.toLocaleString('zh-CN')} ISK
                        </div>
                        <div className="app-dim">{bp.description}</div>
                      </InfoHover>
                    )
                  })}
                  {engine.shipBlueprints.map((bp) => {
                    const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
                    return (
                      <InfoHover
                        key={bp.id}
                        as="li"
                        title={bp.name}
                        lines={[
                          { k: '产物', v: `${engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}（舰船）` },
                          { k: '材料需求', v: mats },
                          { k: '制造', v: `${(bp.buildSeconds / 60).toFixed(0)} 分 · 造费 ${bp.buildCostIsk.toLocaleString('zh-CN')} ISK` },
                        ]}
                        note={bp.description}
                        className="app-hand-entry"
                      >
                        <div className="app-inv-name">
                          <RowGlyph glyph="blueprint" /> {bp.name}
                        </div>
                        <div className="app-dim">产物：{engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}（舰船）</div>
                        <div className="app-hand-sub">
                          材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} 分 · 制造费 {bp.buildCostIsk.toLocaleString('zh-CN')} ISK
                        </div>
                        <div className="app-dim">{bp.description}</div>
                      </InfoHover>
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
