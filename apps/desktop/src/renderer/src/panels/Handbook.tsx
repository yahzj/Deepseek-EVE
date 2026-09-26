/**
 * 手册 / 图鉴（2026-09-10 船长改版：顶部标签页 → 左侧导航栏；图鉴按类型分组，样式照仓库；加搜索栏）。
 *
 * - 弹层加宽为双栏大窗（左导航 168px + 右内容），导航 7 项：玩法速览 / 航行须知 / 物品 / 装备 / 舰船 / 蓝图 / 技能速查；
 * - 图鉴按类型分组：分组表与市场页「类型子分类」同源（见 ui/itemSubs.ts），每组 = 仓库同款小节
 *   （分类名 + 数量 + 卡片网格），空组隐藏；
 * - 内容区顶栏：搜索 + 图标/列表切换 + 命中计数；搜索按名称/分类/说明过滤（玩法速览与航行须知按词条过滤），
 *   **只过滤当前显示的那一页，但关键词跨页保留**（2026-09-17 船长；关掉手册再打开即清空）；
 * - 数据页支持「图标网格 / 列表」两种视图（默认网格，偏好存 localStorage）；
 * - 图标为统一科幻线性 SVG（Glyphs.tsx），按内容体系映射并带分类色调；
 * - 网格模式下点击卡片 → 弹出详情窗（完整字段）；点击窗口外任意位置关闭；列表视图保留完整字段。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ITEM_KIND_ORDER, itemKindText, rackOf, shipCategoryKeyOf, visibleItemDefs } from '@whale/core'
import type { BlueprintDef, DamageType, DroneClass, FoeShipDef, ItemKind, ModuleDef, ShipBlueprintDef, ShipDef, ShipRole } from '@whale/core'
// 稀有度小标签（2026-09-20 船长）：档位走单点 `itemRarityTierOf`（含 AI 核心与舰船的键映射）
import { buildFactionCards, factionOfExclusive, FACTION_CODEX_ORDER, FOE_SHIPS, itemRarityTierOf } from '@whale/data'
import type { FactionCard } from '@whale/data'
// 图鉴 →「↖ 查看市场」的条目→商品映射（2026-09-14 船长）：单点在 `ui/marketJump.ts`
// （独立小模块的原因：体检要跨层调它，而本文件 import 了 `@whale/ui`、node 侧加载不了 CSS）
import { handMarketKeyOf } from '../ui/marketJump'
import { Panel } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { Glyph, partToneKeyOf, toneOf } from '../ui/Glyphs'
import {
  BLUEPRINT_SUBS,
  CONTAINER_SUBS,
  CONSUME_SUBS,
  CORE_SUBS,
  MODULE_SUBS,
  RACK_SUBS,
  SHIP_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  WRECK_SUBS,
  itemBucketPasses,
  itemSubPasses,
  moduleSubKeyOf,
  presentSubs,
  shipRolePasses,
  shipTierPasses,
  subText,
} from '../ui/itemSubs'
import type { SubOption } from '../ui/itemSubs'
import { RowGlyph } from '../ui/itemView'
import { combatBadges, DmgChip, InfoHover, itemCombatLines, itemInfoLines, ItemHover, ModuleHover, moduleInfoLines, moduleShortEffect, ShipHover, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'
// 势力图鉴：逐舰级简报复用**悬赏卡悬停那一份**（同源出口，不另写文案）——2026-09-26
import { foeBriefLinesOfShip, mountLabelText } from '../ui/foeBrief'
import { tr } from '../i18n/locale'
import { kindTextOfItem, shipTierText, skillGroupText, slotText } from '../ui/labelsText'
import { kindText, shipRoleText } from '../ui/labelsText'
// 2026-09-26 船长令：舰船图鉴的**图标模式改画舰船 SVG 形象**（与舰队页/装配页/星图同一张资产表）
import { ShipSprite } from '../ui/ShipSprite'

/**
 * 宽类型标签索引（**详情窗数据来自 raw，键是 string**）。
 *
 * ⚠ **2026-09-22 船长令「先进行手册的本地化」改判**：这三个助手原先直接读 core 的**中文**名表
 * （`ITEM_KIND_LABELS` / `SLOT_LABELS` / `SHIP_ROLE_LABELS`）⇒ 手册的卡片副标题、槽位/角色 chip、
 * 详情行与筛选档在**英文界面下整片漏中文**（实测手册页 314 处里的大头）。现一律走本地化单点
 * （`ui/labelsText.ts` 的 `kindText` / `slotText` / `shipRoleText`，可复用的 id 都复用，core 不动）。
 */
const kindName = (k: string): string => kindText(k as Parameters<typeof kindText>[0])
const slotName = (k: string): string => slotText(k)
const roleName = (k: string): string => shipRoleText(k as Parameters<typeof shipRoleText>[0])

type Tab = 'guide' | 'rules' | 'items' | 'modules' | 'ships' | 'blueprints' | 'skills' | 'factions'
/**
 * **详情窗的卡片类型**（= 导航页 `Tab` ＋ `'foe'`）：势力图鉴的敌人卡也走同一条 `CellDetail` 路
 * （2026-09-26 船长令「敌人卡和其他图鉴中一样，可以点开」），但 `foe` 不是导航页
 * ⇒ 那几个 `Record<Tab, …>`（搜索占位 / 计数单位 / 筛选标签）不该被它污染，故单列这一型。
 */
type DetailTab = Tab | 'foe'
/** 有图鉴内容的页（＝ `codexCells` 的键；筛选两级的现算都在这几页上做） */
type CodexTab = 'items' | 'modules' | 'ships' | 'blueprints' | 'skills' | 'factions'
type ViewMode = 'grid' | 'list'
/** 详情行数据 */
type RawData = Record<string, unknown>

/** 势力图鉴：族 → 序号（0..5）——五段文案的基准 id = 326 + 11×序号（见 `l10n/table.ts` 的块头注释） */
const FACTION_INDEX: Record<string, number> = Object.fromEntries(FACTION_CODEX_ORDER.map((f, i) => [f, i]))

/** 详情窗里插一个**小节块**（小标题一行 ＋ 逐条两列行；空块不插 —— 与详情窗既有 `rows` 同一套渲染） */
function detailBlock(
  rows: Array<[string, React.ReactNode]>,
  title: string,
  body: Array<[string, React.ReactNode]>,
): void {
  if (body.length === 0) return
  rows.push([title, ''])
  for (const [k, v] of body) rows.push([`　${k}`, v])
}

/**
 * **图鉴用的敌舰目录**（2026-09-26 势力图鉴批）：
 * - **已遭遇的舰级**：从**存档卡片**（`engine.ctx.anomalies` 等，已过 l10n 覆盖层）取 ⇒ 舰名与挂载件名
 *   都是**当前语言**，且与悬赏卡悬停**同一份数据**；
 * - **未遭遇的舰级**：从 `FOE_SHIPS` 取 —— 只用来生成「？？？」占位行（不读它的中文名）。
 *
 * 为什么两处合起来：卡片只覆盖"本档出现过的"舰级，而图鉴要**列出该族全部**舰级（未遇的占位）。
 */
/**
 * **势力图鉴：每族的基准格号**（编号即顺序：族名一条 ＋ 四对「小标题 ＋ 正文」＝ 9 格）
 * —— 第 k 段标题 = 基准 + 1 + 2k、正文 = 基准 + 2 + 2k（k = 0..3）。
 */
const FACTION_NAME_BASE: Record<string, number> = { A: 326, C: 335, D: 344, E: 353, G: 362, H: 371 }

/**
 * **势力图鉴的详情容器**（2026-09-26 船长令：「在势力图鉴内新建一个窗口容器，玩家点击某个势力后，
 * 下方窗口内就显示该势力的介绍和敌人种类，专属装备，舰船等」）。
 *
 * 三块，全部只读：
 *   ① **势力档案** —— 四要素（档案摘要 / 舰体特征 / 交手记录 / 活动星域），文案 id = 基准格 + 1 + 2k；
 *   ② **敌人种类** —— 逐舰级一行（舰种 · 战术 · 武器系 · 主副伤 · 舰载机 · 特殊装置 · 精英档），
 *      与悬赏卡悬停**同一份内容**（`foeBriefLinesOfShip`）；未遭遇的舰级显示「？？？」占位；
 *   ③ **专属装备 / 专属舰船 / 图纸** —— 逐件给名与短效果；未解锁时只给一句"遭遇该势力的敌舰后解锁"。
 */
function FactionDetailPanel({ engine, family }: { engine: GameEngine; family: string }) {
  const ships = collectFoeShips(engine)
  const card = buildFactionCards(FOE_SHIPS, engine.state.foeShipSeen).find((c) => c.family === family)
  if (!card) return null
  const base = FACTION_NAME_BASE[family] ?? 326
  const num = (v: number): string => v.toLocaleString('zh-CN')
  const itemName = (id: string): string =>
    engine.ctx.modules.get(id)?.name ?? engine.ctx.ships.get(id)?.name ?? engine.ctx.items.get(id)?.name ?? id
  const bpNameOf = (id: string): string => {
    for (const bp of engine.blueprints) if (bp.id === id) return bp.moduleId ? itemName(bp.moduleId) : String(bp.itemId ?? bp.id)
    for (const bp of engine.shipBlueprints) if (bp.id === id) return engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId
    return id
  }
  /** 本容器自己的详情窗（卡片可点开；与其它图鉴同一条 `CellDetail` 路） */
  const [detail, setDetail] = useState<GridCell | null>(null)
  /** ② 敌人卡：已遭遇 ⇒ 敌舰 SVG；未遭遇 ⇒ 通用「信号不良」图形 ＋「？？？」 */
  const enemyCells: GridCell[] = card.enemies.map((e) => {
    const ship = e.seen ? ships.get(e.id) : undefined
    const line = ship !== undefined ? foeBriefLinesOfShip(ship) : null
    // 副行：舰种 · 战术…（一条短句；与悬赏卡悬停同源，截断由卡片自己的换行处理）
    const sub = line !== null ? [line.hull, ...line.bits].filter((x) => x !== '').join(' · ') : tr('ui.codex.010')
    return {
      key: e.id,
      tab: 'foe',
      glyph: e.seen ? 'ico-tact' : 'signal-lost',
      name: e.seen ? (ship?.name ?? e.id) : tr('ui.codex.005'),
      sub,
      raw: (ship ?? { id: e.id, name: e.id, hullClassTier: 1, split: { s: 0, a: 0, h: 0 } }) as unknown as RawData,
      ...(ship !== undefined ? { shipId: ship.id } : {}),
    }
  })
  /** ③ 专属装备 / 舰船 / 图纸：三段都用**图鉴卡片的同一构造**（族徽由 builder 按所属势力加） */
  const exclusiveModuleCells: GridCell[] = card.modules
    .map((id) => engine.ctx.modules.get(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)
    .map((m) => moduleCellOf(m))
  const exclusiveShipCells: GridCell[] = card.ships
    .map((id) => engine.ctx.ships.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((s) => shipCellOf(s))
  const exclusiveBlueprintCells: GridCell[] = card.blueprints.flatMap((id) => {
    const modBp = engine.blueprints.find((b) => b.id === id)
    if (modBp !== undefined) return [blueprintCellOf(engine, modBp)]
    const shipBp = engine.shipBlueprints.find((b) => b.id === id)
    if (shipBp !== undefined) return [shipBlueprintCellOf(engine, shipBp)]
    return []
  })
  return (
    <Panel
      title={`${tr(card.nameId)} · ${tr('ui.codex.003', { p1: card.seenCount, p2: card.totalCount })}`}
      right={<span className="app-dim">{card.unlocked ? tr('ui.codex.004') : tr('ui.codex.006')}</span>}
    >
      {/* ① 势力档案：四要素（文档 id = 基准 + 1 + 2k 标题 / + 2 + 2k 正文）——
          排版用**内联样式**（不新增 CSS 类 ⇒ 不必走 `ui:layout-css` 生成件链路；与详情窗既有的
          两列行在观感上同族：「小标题（灰）＋ 正文」横排，窄屏由 flexWrap 自动折行） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '2px 0 10px' }}>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="app-dim" style={{ flex: '0 0 auto', minWidth: 64 }}>
              {tr(`ui.Handbook.${base + 1 + 2 * k}`)}
            </span>
            <span style={{ flex: '1 1 auto' }}>{tr(`ui.Handbook.${base + 2 + 2 * k}`)}</span>
          </div>
        ))}
      </div>

      {/**
       * ② **敌人种类**（**2026-09-26 船长令**：「**内容中的敌人窗口，每个敌人需要显示敌人的舰船SVG**」
       * ＋「（未遭遇）**不显示剪影，改为类似信号不良的通用图形**」）。
       *
       * 每型敌人 = 一张**图标卡**（与其它图鉴同一套 `app-hand-cell`）：
       * 舰影走 `ShipSprite`（敌舰逐舰资产表，与战斗画面同一张）；**未遭遇**画通用「信号不良」图形
       * （`ico-antenna` 线稿 ＋ 噪点装饰，见 `SignalLostIcon`），名字与介绍仍按旧令打「？？？」。
       * 卡片**可点开**（船长同批：「和其他图鉴中一样，可以点开」）⇒ 走 `CellDetail` 的 `foe` 分支。
       */}
      <GroupSection label={tr('ui.codex.008')} unit={COUNT_UNIT.factions} count={card.totalCount}>
        {card.unlocked ? (
          <IconGrid cells={enemyCells} onPick={setDetail} />
        ) : (
          <div className="app-dim app-inv-empty">{tr('ui.codex.006')}</div>
        )}
      </GroupSection>

      {/* ③ 专属装备 / 专属舰船 / 图纸（未解锁：不给明细）——三段都用**图鉴卡片**（船长 2026-09-26：
          「专属装备也是过于简陋。装备和舰船以及蓝图这些应该使用装备图鉴舰船图鉴中的痛苦卡片」），
          卡片构造与装备/舰船/蓝图图鉴**同一个 builder** ⇒ 观感与口径不会两处漂移。 */}
      {card.unlocked ? (
        <>
          <GroupSection
            label={tr('ui.codex.011')}
            unit={tr('ui.codex.014')}
            count={card.modules.length}
          >
            <IconGrid cells={exclusiveModuleCells} onPick={setDetail} />
          </GroupSection>
          <GroupSection label={tr('ui.codex.012')} unit={tr('ui.codex.015')} count={card.ships.length}>
            {card.ships.length > 0 ? (
              <IconGrid cells={exclusiveShipCells} onPick={setDetail} />
            ) : (
              <div className="app-dim app-inv-empty">{tr('ui.codex.016')}</div>
            )}
          </GroupSection>
          {card.blueprints.length > 0 ? (
            <GroupSection label={tr('ui.codex.013')} unit={tr('ui.codex.014')} count={card.blueprints.length}>
              <IconGrid cells={exclusiveBlueprintCells} onPick={setDetail} />
            </GroupSection>
          ) : null}
        </>
      ) : (
        <div className="app-dim app-inv-empty">{tr('ui.codex.006')}</div>
      )}
      {/* 卡片详情窗（2026-09-26 船长令：势力图鉴里的卡片「和其他图鉴中一样，可以点开」）——
          与其它图鉴同一条 `CellDetail`；`foe` 分支见 `DetailBody` */}
      {detail !== null ? <CellDetail engine={engine} cell={detail} onClose={() => setDetail(null)} /> : null}
    </Panel>
  )
}

function collectFoeShips(engine: GameEngine): Map<string, FoeShipDef> {
  const out = new Map<string, FoeShipDef>()
  const put = (s: FoeShipDef | null | undefined): void => {
    if (s && !out.has(s.id)) out.set(s.id, s)
  }
  // 存档卡片（已过 l10n 覆盖层 ⇒ 舰名与挂载件名都是当前语言；与悬赏卡悬停同一份数据）
  for (const card of engine.ctx.anomalies.values()) for (const slot of card.ships ?? []) put(slot?.ship)
  // 未遇的舰级：只借 FOE_SHIPS 补 id 与族（**不读它的中文名**，名字由界面显示为占位）
  for (const s of FOE_SHIPS) put(s)
  return out
}

/** 左侧导航（顺序即展示顺序） */
const NAV: Array<{ key: Tab; label: string }> = [
  { key: 'guide', label: tr("ui.Handbook.186") },
  { key: 'rules', label: tr("ui.Handbook.187") },
  { key: 'items', label: tr("ui.Handbook.188") },
  { key: 'modules', label: tr("ui.Handbook.254") },
  { key: 'ships', label: tr("ui.Handbook.189") },
  { key: 'blueprints', label: tr("ui.Handbook.255") },
  // 2026-09-26 船长：「敌族图鉴单独列出吧，放在蓝图图鉴下方，叫『势力图鉴』」
  { key: 'factions', label: tr("ui.codex.001") },
  { key: 'skills', label: tr("ui.Handbook.124") },
]
/** 各页搜索框占位词（按当前页给出，玩家一眼知道搜的是哪一页） */
const SEARCH_PLACEHOLDER: Record<Tab, string> = {
  guide: tr("ui.Handbook.125"),
  rules: tr("ui.Handbook.126"),
  items: tr("ui.Handbook.127"),
  modules: tr("ui.Handbook.128"),
  ships: tr("ui.Handbook.129"),
  blueprints: tr("ui.Handbook.130"),
  factions: tr("ui.codex.002"),
  skills: tr("ui.Handbook.131"),
}
/** 分组计数量词（与仓库「N 种」同款） */
const COUNT_UNIT: Record<Tab, string> = {
  guide: tr("ui.Handbook.190"),
  rules: tr("ui.Handbook.190"),
  items: tr("ui.Handbook.191"),
  modules: tr("ui.MarketPage.117"),
  ships: tr("ui.MarketPage.116"),
  blueprints: tr("ui.Handbook.017"),
  factions: tr("ui.Handbook.190"), // 「条」（与说明类同单位：每张卡 = 一个势力）
  skills: tr("ui.Handbook.256"),
}
const VIEW_KEY = 'whale-idle:handbook-view'

/** 蓝图门类（手册「蓝图图鉴」主筛选）：判据与分组键同源（有 `shipId` = 舰船蓝图、
 *  有 `itemId` = 消耗品蓝图、其余 = 装备蓝图）。2026-09-20 船长裁定「零件蓝图归到该组」：
 *  有 `itemId` 且**产物是零件**的另立「零件蓝图」门类（此前落进消耗品蓝图那门）。 */
const BP_MAIN: SubOption[] = [
  { key: 'equip', label: tr("ui.ShipPage.115") },
  { key: 'ship', label: tr("ui.ShipPage.116") },
  { key: 'consume', label: tr("ui.ShipPage.114") },
  // ⚠ `equip` / `ship` / `consume` 各自**只许出现一次**——2026-09-26 修：原先这表里前三个键各重复一次
  // （合并残留），React 渲染出两颗同名胶囊（`key={o.key}` 撞 key）⇒ 玩家点第二颗时高亮落在第一颗上、
  // 观感是「蓝图图鉴的筛选不消失」（船长报障）。护栏 = `npm run ui:subs-check`（挂在 `ui:rot-check` 链上）。
  { key: 'part', label: tr("ui.Handbook.265") },  // 2026-09-20 船长裁定：产物是零件的另立「零件蓝图」门类
]
/** 各图鉴筛选行的灰字前缀（同「我的舰队」那套「类别：」「级别：」写法，避免多个「全部」混淆） */
const FILTER_LABEL: Record<Tab, string> = {
  guide: '',
  rules: '',
  items: tr("ui.Handbook.003"),
  modules: tr("ui.Handbook.192"),
  ships: tr("ui.Handbook.193"),
  blueprints: tr("ui.Handbook.257"),
  factions: '',
  skills: tr("ui.Handbook.132"),
}

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/* ═══════════ 玩法速览 / 航行须知（2026-09-14 船长：按词条分页 + 正文拆段；见 docs/design/handbook-subnav-20260914.md） ═══════════
   一条解释 = 一个子页：标题 + 2~4 段，每段一行短小标题（小标题为空串 ⇒ 该段是引导句、不加标题）。
   ⚠ 本批**只做"拆段 + 加段首小标题"**：原句与全部数值一字未改（有一次性脚本逐条比对"去标点后逐字相同"）。 */

interface HandEntry {
  title: string
  /** 段落：`[小标题, 正文]` */
  paras: Array<[string, string]>
}

interface HandGroup {
  title: string
  entries: HandEntry[]
}

/** 一条词条的命中段数（`0` = 未命中，子栏置灰；搜索作用于**整章**，跨子页）。
 *  标题命中即整条算命中（返回全部段数，免得只因为标题命中就显示成 0）。 */
function handEntryHits(e: HandEntry, q: string): number {
  if (q === '') return 1
  if (e.title.toLowerCase().includes(q)) return e.paras.length
  return e.paras.filter(([, t]) => t.toLowerCase().includes(q)).length
}

const GUIDE_GROUPS: HandGroup[] = [
  {
    title: tr("ui.Handbook.194"),
    entries: [
      {
        title: tr("ui.Handbook.258"),
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.133")],
          [tr("ui.Handbook.019"), tr("ui.Handbook.195")],
        ],
      },
      {
        title: tr("ui.Handbook.259"),
        paras: [
          [tr("ui.Handbook.196"), tr("ui.Handbook.020")],
          [tr("ui.Handbook.021"), tr("ui.Handbook.260")],
        ],
      },
      {
        title: tr("ui.Handbook.197"),
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.134")],
          [tr("ui.Handbook.198"), tr("ui.Handbook.135")],
          [tr("ui.Handbook.199"), tr("ui.Handbook.200")],
          [tr("ui.Handbook.201"), tr("ui.Handbook.136")],
        ],
      },
      {
        title: tr("ui.Handbook.022"),
        paras: [
          [tr("ui.Handbook.023"), tr("ui.Handbook.137")],
          [tr("ui.Handbook.024"), tr("ui.Handbook.138")],
          [tr("ui.Handbook.025"), tr("ui.Handbook.026")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.027"),
    entries: [
      {
        title: tr("ui.Handbook.261"),
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.139")],
          [tr("ui.Handbook.028"), tr("ui.Handbook.140")],
          [tr("ui.Handbook.262"), tr("ui.Handbook.141")],
        ],
      },
      {
        title: tr("ui.App.003"),
        paras: [
          [tr("ui.Handbook.202"), tr("ui.Handbook.263")],
          [tr("ui.Handbook.029"), tr("ui.Handbook.142")],
          [tr("ui.Handbook.030"), tr("ui.Handbook.264")],
          [tr("ui.Handbook.031"), tr("ui.Handbook.032")],
          [tr("ui.Handbook.004"), tr("ui.Handbook.143")],
          [tr("ui.Handbook.203"), tr("ui.Handbook.144")],
        ],
      },
      {
        title: tr("ui.Handbook.204"),
        paras: [
          [tr("ui.Handbook.033"), tr("ui.Handbook.145")],
          [tr("ui.Handbook.034"), tr("ui.Handbook.146")],
          [tr("ui.Handbook.035"), tr("ui.Handbook.147")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.205"),
    entries: [
      {
        title: tr("ui.Handbook.036"),
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.265")],
          [tr("ui.Handbook.037"), tr("ui.Handbook.038")],
        ],
      },
      {
        title: tr("ui.Handbook.039"),
        paras: [
          [tr("ui.Handbook.040"), tr("ui.Handbook.148")],
          [tr("ui.MapPage.058"), tr("ui.Handbook.149")],
          [tr("ui.Handbook.150"), tr("ui.Handbook.206")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.041"),
    entries: [
      {
        title: tr("ui.Handbook.042"),
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.207")],
          [tr("ui.Handbook.043"), tr("ui.Handbook.151")],
          [tr("ui.Handbook.044"), tr("ui.Handbook.266")],
        ],
      },
      {
        title: tr("ui.Handbook.045"),
        paras: [
          [tr("ui.Handbook.046"), tr("ui.Handbook.152")],
          [tr("ui.Handbook.267"), tr("ui.Handbook.268")],
          [tr("ui.Handbook.047"), tr("ui.Handbook.208")],
        ],
      },
      {
        title: tr("ui.MapPage.006"),
        paras: [
          [tr("ui.Handbook.269"), tr("ui.Handbook.153")],
          [tr("ui.Handbook.048"), tr("ui.Handbook.270")],
          [tr("ui.Handbook.049"), tr("ui.Handbook.271")],
        ],
      },
      {
        title: tr("ui.Handbook.050"),
        paras: [
          [tr("ui.Handbook.051"), tr("ui.Handbook.209")],
          [tr("ui.Handbook.052"), tr("ui.Handbook.272")],
          [tr("ui.Handbook.053"), tr("ui.Handbook.154")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.054"),
    entries: [
      {
        title: tr("ui.App.033"),
        paras: [
          [tr("ui.Handbook.055"), tr("ui.Handbook.155")],
          [tr("ui.Handbook.156"), tr("ui.Handbook.157")],
        ],
      },
      {
        title: tr("ui.Handbook.273"),
        paras: [
          [tr("ui.Handbook.274"), tr("ui.Handbook.210")],
        ],
      },
    ],
  },
  {
    title: tr("ui.MatterTechTab.001"),
    entries: [
      {
        title: tr("ui.Handbook.056"),
        paras: [
          [tr("ui.Handbook.057"), tr("ui.Handbook.158")],
          [tr("ui.Handbook.058"), tr("ui.Handbook.275")],
          [tr("ui.Handbook.059"), tr("ui.Handbook.060")],
        ],
      },
      {
        title: tr("ui.Handbook.211"),
        paras: [
          [tr("ui.Handbook.212"), tr("ui.Handbook.213")],
          [tr("ui.Handbook.159"), tr("ui.Handbook.160")],
          [tr("ui.Handbook.061"), tr("ui.Handbook.214")],
        ],
      },
      {
        title: tr("ui.Handbook.161"),
        paras: [
          [tr("ui.Handbook.162"), tr("ui.Handbook.215")],
          [tr("ui.Handbook.163"), tr("ui.Handbook.276")],
          [tr("ui.Handbook.062"), tr("ui.Handbook.277")],
        ],
      },
      {
        title: tr("ui.Handbook.278"),
        paras: [
          [tr("ui.CargoPage.004"), tr("ui.Handbook.279")],
          [tr("ui.Handbook.063"), tr("ui.Handbook.216")],
          [tr("ui.Handbook.217"), tr("ui.Handbook.218")],
        ],
      },
    ],
  },
]

/** 「小贴士」子页的 key（它不是词条，单独占一页） */
const TIPS_KEY = '__tips'
const GUIDE_NOTES: string[] = [
  tr("ui.Handbook.164"),
  tr("ui.Handbook.219"),
  tr("ui.Handbook.220"),
]

/* ═══════════ 航行须知（2026-09-14 船长：同「玩法速览」，按词条分页 + 正文拆段） ═══════════ */

const RULE_SECTS: HandGroup[] = [
  {
    title: tr("ui.Handbook.064"),
    entries: [
      {
        title: tr("ui.Handbook.065"),
        paras: [
          [tr("ui.Handbook.221"), tr("ui.Handbook.222")],
          [tr("ui.Handbook.066"), tr("ui.Handbook.165")],
        ],
      },
      {
        title: tr("ui.Handbook.067"),
        paras: [
          [tr("ui.Handbook.068"), tr("ui.Handbook.069")],
          [tr("ui.MapPage.006"), tr("ui.Handbook.280")],
          [tr("ui.Handbook.042"), tr("ui.Handbook.070")],
        ],
      },
      {
        title: tr("ui.Handbook.166"),
        paras: [
          [tr("ui.Handbook.281"), tr("ui.Handbook.167")],
        ],
      },
      {
        title: tr("ui.Handbook.282"),
        paras: [
          [tr("ui.Handbook.071"), tr("ui.Handbook.283")],
          [tr("ui.Handbook.072"), tr("ui.Handbook.284")],
        ],
      },
      {
        title: tr("ui.Handbook.073"),
        paras: [
          [tr("ui.Handbook.223"), tr("ui.Handbook.285")],
        ],
      },
      {
        title: tr("ui.Handbook.224"),
        paras: [
          [tr("ui.Handbook.225"), tr("ui.Handbook.226")],
        ],
      },
      {
        title: tr("ui.Handbook.227"),
        paras: [
          [tr("ui.Handbook.074"), tr("ui.Handbook.075")],
          [tr("ui.Handbook.076"), tr("ui.Handbook.168")],
          [tr("ui.Handbook.286"), tr("ui.Handbook.287")],
        ],
      },
      {
        title: tr("ui.Handbook.169"),
        paras: [
          [tr("ui.Handbook.077"), tr("ui.Handbook.288")],
          [tr("ui.Handbook.078"), tr("ui.Handbook.228")],
        ],
      },
      {
        title: tr("ui.Handbook.289"),
        paras: [
          [tr("ui.Handbook.290"), tr("ui.Handbook.079")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.291"),
    entries: [
      {
        title: tr("ui.Handbook.292"),
        paras: [
          [tr("ui.Handbook.080"), tr("ui.Handbook.293")],
          [tr("ui.Handbook.014"), tr("ui.Handbook.081")],
        ],
      },
      {
        title: tr("ui.Handbook.294"),
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.229")],
          [tr("ui.Handbook.082"), tr("ui.Handbook.295")],
        ],
      },
      {
        title: tr("ui.Handbook.083"),
        paras: [
          [tr("ui.Handbook.084"), tr("ui.Handbook.085")],
        ],
      },
      {
        title: tr("ui.Handbook.296"),
        paras: [
          [tr("ui.Handbook.297"), tr("ui.Handbook.298")],
        ],
      },
      {
        title: tr("ui.Handbook.299"),
        paras: [
          [tr("ui.Handbook.086"), tr("ui.Handbook.170")],
          [tr("ui.ShipPage.013"), tr("ui.Handbook.171")],
        ],
      },
      {
        title: tr("ui.Handbook.300"),
        paras: [
          [tr("ui.Handbook.087"), tr("ui.Handbook.088")],
          [tr("ui.Handbook.301"), tr("ui.Handbook.172")],
        ],
      },
      {
        title: tr("ui.Handbook.230"),
        paras: [
          [tr("ui.Handbook.057"), tr("ui.Handbook.231")],
          [tr("ui.Handbook.089"), tr("ui.Handbook.173")],
          [tr("ui.Handbook.232"), tr("ui.Handbook.302")],
        ],
      },
      {
        title: tr("ui.Handbook.233"),
        paras: [
          [tr("ui.Handbook.090"), tr("ui.Handbook.234")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.091"),
    entries: [
      {
        title: tr("ui.Handbook.303"),
        paras: [
          [tr("ui.Handbook.092"), tr("ui.Handbook.235")],
        ],
      },
      {
        title: tr("ui.Handbook.093"),
        paras: [
          [tr("ui.BattleScreen.002"), tr("ui.Handbook.174")],
          [tr("ui.battleViewCore.001"), tr("ui.Handbook.236")],
          [tr("ui.battleViewCore.002"), tr("ui.Handbook.237")],
          [tr("ui.Handbook.238"), tr("ui.Handbook.175")],
        ],
      },
      {
        title: tr("ui.Handbook.176"),
        paras: [
          [tr("ui.Handbook.304"), tr("ui.Handbook.177")],
          [tr("ui.Handbook.094"), tr("ui.Handbook.239")],
        ],
      },
    ],
  },
  {
    title: tr("ui.MatterTechTab.001"),
    entries: [
      {
        title: tr("ui.Handbook.305"),
        paras: [
          [tr("ui.Handbook.095"), tr("ui.Handbook.306")],
          [tr("ui.Handbook.096"), tr("ui.Handbook.097")],
        ],
      },
      {
        title: tr("ui.Handbook.098"),
        paras: [
          [tr("ui.Handbook.099"), tr("ui.Handbook.178")],
          [tr("ui.Handbook.307"), tr("ui.Handbook.240")],
          [tr("ui.Handbook.308"), tr("ui.Handbook.309")],
          [tr("ui.Handbook.062"), tr("ui.Handbook.310")],
        ],
      },
      {
        title: tr("ui.Handbook.100"),
        paras: [
          [tr("ui.Handbook.198"), tr("ui.Handbook.311")],
          [tr("ui.Handbook.312"), tr("ui.Handbook.313")],
        ],
      },
      {
        title: tr("ui.Handbook.314"),
        paras: [
          [tr("ui.Handbook.101"), tr("ui.Handbook.241")],
          [tr("ui.Handbook.179"), tr("ui.Handbook.242")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.243"),
    entries: [
      {
        title: tr("ui.Handbook.102"),
        paras: [
          [tr("ui.Handbook.103"), tr("ui.Handbook.104")],
          [tr("ui.Handbook.244"), tr("ui.Handbook.245")],
          [tr("ui.Handbook.180"), tr("ui.Handbook.105")],
        ],
      },
    ],
  },
]

/* ═══════════ 网格渲染 ═══════════ */

interface GridCell {
  key: string
  /**
   * 该卡属于哪一类。**`'foe'` 不是导航页**——它是**势力图鉴里敌人卡的详情类型**
   * （2026-09-26 船长令「敌人卡可以点开」），只在详情窗里被消费 ⇒ 用 `DetailTab`（= `Tab` ＋ `'foe'`）。
   */
  tab: DetailTab
  glyph: string
  name: string
  sub: string
  /** 完整数据（详情窗用） */
  raw: RawData
  /**
   * **稀有度档**（1~5；`undefined` = 不显示标签）。
   * 2026-09-20 船长：「希望给每个物品的图标模式右上角添加物品稀有度展示的小标签」——
   * 图鉴网格与仓库/货仓**同一个视觉语言**（`app-hand-cell-rarity`），档位走单点
   * `itemRarityTierOf()`（含 AI 核心与舰船的键映射）。
   */
  rarity?: number
  /** **势力图鉴专用**：该卡的族字母（`faction` 页的卡片用它分组/排序，别的页恒缺省） */
  faction?: string
  /**
   * **族徽角标**（**2026-09-26 船长令**：「**给所有位置势力专属的舰船和装备的图标卡片的左上角
   * 标注势力族徽**」）——值 = 势力族字母（`'A' | 'C' | 'D' | 'E' | 'G' | 'H'`）。
   * 判据走**单一入口** `factionOfExclusive(id)`（内容体检在守），装备/舰船按自身 id 判、
   * 蓝图按**产物**判（船长裁定「按照所属势力标」）⇒ 三处图鉴（装备 / 舰船 / 势力详情）同源。
   * 恒缺省 = 非势力专属件，不标。
   */
  crest?: string
  /**
   * **图标模式改画舰船 SVGer 形象**（**2026-09-26 船长令**：「**手册的舰船图鉴中，图标模式舰船的
   * 图标使用舰船的SVG形象**」）——只有舰船图鉴的格子带本字段；带它时 `IconGrid` 走
   * `ShipSpriteShape`（与舰队页/装配页/星图同一个资产表 `SHIP_ART`），不再画类别徽记。
   */
  shipId?: string
  /** 同上：画舰影时的回退族别（资产表未命中时按它取剪影） */
  shipRole?: ShipRole
}

/** 一个分组（仓库同款小节）：分类名 + 数量 + 卡片 */
interface CellGroup {
  key: string
  label: string
  /**
   * **分组标题的本地化来源**（2026-09-22 补）：分组表的档都带 `id`（`ui/itemSubs.ts` 那几张表），
   * 标题必须走 `subText` 取当前语言 —— 此前直接渲染表里的中文 `label`，英文界面下整片分组标题是中文
   * （实测蓝图图鉴「高槽装备蓝图 / T1 护卫舰蓝图…」27 处）。`undefined` = 兜底分组（无档可译）。
   */
  id?: string
  idParam?: string
  cells: GridCell[]
}

/** 按分组表切分卡片（表内顺序在前，未收录的键兜底追加，避免新增内容漏出图鉴） */
function groupCells(
  cells: GridCell[],
  keyOf: (c: GridCell) => string,
  order: readonly { key: string; label: string; id?: string; idParam?: string }[],
): CellGroup[] {
  const byKey = new Map<string, GridCell[]>()
  for (const c of cells) {
    const k = keyOf(c)
    const arr = byKey.get(k)
    if (arr) arr.push(c)
    else byKey.set(k, [c])
  }
  const out: CellGroup[] = []
  for (const o of order) {
    const arr = byKey.get(o.key)
    if (arr && arr.length > 0) {
      out.push({ key: o.key, label: o.label, id: o.id, idParam: o.idParam, cells: arr })
      byKey.delete(o.key)
    }
  }
  for (const [k, arr] of byKey) out.push({ key: k, label: k, cells: arr })
  return out
}

/**
 * **「信号不良」通用图形**（**2026-09-26 船长裁定**：势力图鉴里**未遭遇**的敌人
 * 「**不显示剪影，改为类似信号不良的通用图形**」）。
 *
 * 画法沿用全仓视觉铁律（**一律 SVG 线稿 · currentColor · 细描边 · 不用 CSS 拼形状**）：
 * 天线 ＋ 两圈扫描弧 ＋ 一道斜划 ＋ 三点噪点——表达"有回波、认不出是什么"。
 * 尺寸与卡片图标位一致（约 30px 高），颜色由父级 `--tone` 给（未遭遇卡的 tone 取暗淡档）。
 */
function SignalLostIcon({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 天线杆与底座 */}
      <path d="M16 9.5V25" />
      <path d="M11 27h10" />
      <path d="M13.5 25l2.5-2 2.5 2" />
      {/* 两圈扫描弧（右上、右下不对称 ⇒ 有回波但不成形） */}
      <path d="M12 7.5a6 6 0 0 1 8 0" opacity="0.75" />
      <path d="M9.5 5a10 10 0 0 1 13 0" opacity="0.45" strokeDasharray="2 2.5" />
      {/* 斜划 = 信号不可读 */}
      <path d="M7 24L25 8" opacity="0.55" />
      {/* 噪点 */}
      <circle cx="24.5" cy="20" r="0.9" fill="currentColor" stroke="none" opacity="0.7" />
      <circle cx="27" cy="24.5" r="0.7" fill="currentColor" stroke="none" opacity="0.5" />
      <circle cx="21" cy="26.5" r="0.6" fill="currentColor" stroke="none" opacity="0.4" />
    </svg>
  )
}

function IconGrid({ cells, onPick }: { cells: GridCell[]; onPick: (c: GridCell) => void }) {
  return (
    <div className="app-hand-grid">
      {cells.map((c) => {
        const tone = toneOf(c.glyph)
        return (
          <button
            key={c.key}
            className="app-hand-cell"
            onClick={() => onPick(c)}
            /* `position: relative`：族徽与稀有度两枚角标都绝对定位（内联样式，不新增 CSS 类） */
            style={{ '--tone': tone, position: 'relative' } as React.CSSProperties}
          >
            <span className="app-hand-cell-icon">
              {/**
               * **舰船图鉴：图标画舰船 SVG 形象**（**2026-09-26 船长令**：「**手册的舰船图鉴中，
               * 图标模式舰船的图标使用舰船的SVG形象**」）。
               * 走 **`ShipSprite`**（与舰队页 / 装配页 / 星图**同一张资产表** `SHIP_ART`；
               * 未命中的舰按 `role` 取族剪影）——不再画类别徽记。
               * ⚠ 用带 `<svg>` 外壳的 `ShipSprite`，**不是** `ShipSpriteShape`（后者只输出 `<g>`，
               * 塞进这个 `<span>` 里没有画布 ⇒ 实测格宽 0、什么都不显示）。
               * 其余图鉴（物品/装备/蓝图/技能/势力）**保持原样**走 `Glyph`。
               */}
              {c.shipId !== undefined ? (
                <ShipSprite shipId={c.shipId} role={c.shipRole} size={64} engine={false} />
              ) : c.glyph === 'signal-lost' ? (
                /* 未遭遇的敌人：通用「信号不良」图形（船长裁定：不显示剪影） */
                <SignalLostIcon size={30} />
              ) : (
                <Glyph name={c.glyph} size={30} color={tone} />
              )}
            </span>
            {/**
             * **族徽角标（左上角）**（**2026-09-26 船长令**：「**给所有位置势力专属的舰船和装备的图标
             * 卡片的左上角标注势力族徽**」）。
             * 与右上角那枚稀有度标签**同一套绝对定位语言**（`top/left: 3px` ＋ 小圆角 ＋ 同族色），
             * 徽记用已有的 `fam-a/c/d/e/g/h` 线稿（`Glyph`），颜色走 `toneOf('fam-x')` —— 不自造图形与颜色。
             * `aria-label` 给无障碍/探针一个可读的锚（「势力 X 专属」）。
             */}
            {c.crest !== undefined ? (
              <span
                className={`app-map-famchip is-fam-${c.crest}`}
                aria-label={`势力 ${c.crest} 专属`}
                style={{ position: 'absolute', top: 3, left: 3, zIndex: 1, color: toneOf(`fam-${c.crest.toLowerCase()}`), pointerEvents: 'none' }}
              >
                <Glyph name={`fam-${c.crest.toLowerCase()}`} size={13} color="currentColor" />
              </span>
            ) : null}
            {/* 稀有度小标签（2026-09-20 船长）：与仓库/货仓图标模式同一语言 */}
            {c.rarity !== undefined ? (
              <span className={`app-hand-cell-rarity is-r${c.rarity}`} aria-label={`稀有度 R${c.rarity}`}>
                R{c.rarity}
              </span>
            ) : null}
            <span className="app-hand-cell-name">{c.name}</span>
            <span className="app-hand-cell-sub">{c.sub}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════ 详情窗 ═══════════ */

/** 详情窗用：把当前表格单元喂给 {@link handMarketKeyOf}（映射单点在 `ui/marketJump.ts`，
 *  体检那条跨层契约也读同一个函数——**不许在这里另写一份映射**） */
function marketKeyOf(engine: GameEngine, cell: GridCell): string | null {
  return handMarketKeyOf(engine.ctx, cell.tab, cell.key)
}

/**
 * **图鉴卡片的共用构造**（**2026-09-26 船长令**：「**装备和舰船以及蓝图这些应该使用装备图鉴舰船图鉴中的
 * 痛苦卡片**」——即图标卡 `app-hand-cell`）。
 *
 * 为什么抽到模块作用域：同一张卡**两处消费**——① 各图鉴页的 `IconGrid`；② 势力图鉴详情容器里的
 * 「专属装备 / 专属舰船 / 图纸」三段。原先那三段是纯文字列表行（船长：「**专属装备也是过于简陋**」），
 * 若在详情里另写一份卡片构造，两处迟早漂移 ⇒ 这里做**唯一构造点**。
 *
 * **族徽角标**（同一条船长令：「**给所有位置势力专属的舰船和装备的图标卡片的左上角标注势力族徽**」）：
 * 判据走**单一入口** `factionOfExclusive(id)`；装备/舰船按自身 id 判，**蓝图按产物判**
 * （船长裁定「按照所属势力标」）⇒ 三处图鉴（装备 / 舰船 / 势力详情）同源、不各判一套。
 */
function moduleCellOf(mod: ModuleDef): GridCell {
  return {
    key: mod.id,
    tab: 'modules',
    glyph: mod.slot,
    name: mod.name,
    sub: `${slotName(mod.slot)} · ${moduleShortEffect(mod)}`,
    raw: mod as unknown as RawData,
    rarity: itemRarityTierOf(mod.id),
    ...(factionOfExclusive(mod.id) !== undefined ? { crest: factionOfExclusive(mod.id)! } : {}),
  }
}

function shipCellOf(ship: ShipDef): GridCell {
  // 2026-09-16 船长：类别键走 `shipCategoryKeyOf` —— 装甲线 = `role: 'armored'` **或**武装舰里装甲占比 > 护盾占比
  // （牛鲨级突击巡洋舰 + E 族专属舰；丙案「只在武装舰里判」）。图标/文字/分组/筛选四处同源这一处。
  const cls = shipCategoryKeyOf(ship)
  return {
    key: ship.id,
    tab: 'ships',
    glyph: cls,
    name: ship.name,
    sub: `${roleName(cls)} · ${shipTierText(ship.tier)} · ${ship.cargoM3.toLocaleString('zh-CN')} m³`,
    raw: ship as unknown as RawData,
    rarity: itemRarityTierOf(ship.id),
    // 图标模式画舰船 SVG 形象（船长 2026-09-26 令）——资产表命中走独立形，未命中按族别剪影
    shipId: ship.id,
    shipRole: ship.role,
    ...(factionOfExclusive(ship.id) !== undefined ? { crest: factionOfExclusive(ship.id)! } : {}),
  }
}

/** 装备蓝图卡（产物是模块/物品）：副行 = 产物门类 · 产物名；族徽按**产物**判 */
function blueprintCellOf(engine: GameEngine, bp: BlueprintDef): GridCell {
  const prodMod = bp.moduleId !== undefined ? engine.ctx.modules.get(bp.moduleId) : undefined
  return {
    key: bp.id,
    tab: 'blueprints',
    glyph: 'blueprint',
    name: bp.name,
    sub:
      bp.itemId !== undefined
        ? // 产物门类取**产物自己的**大类（2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——
          // 此前一律写死「弹药」，2 张修理组件蓝图被错标成弹药）
          `${kindName(engine.ctx.items.get(bp.itemId)?.kind ?? 'ammo')} · ${engine.ctx.items.get(bp.itemId)?.name ?? bp.itemId}`
        : tr("ui.Handbook.317", { p1: prodMod?.name ?? bp.moduleId ?? '' }),
    raw: bp as unknown as RawData,
    rarity: itemRarityTierOf(bp.id),
    ...(crestOfProduct(bp.moduleId) !== undefined ? { crest: crestOfProduct(bp.moduleId)! } : {}),
  }
}

/** 舰船蓝图卡：副行 = 产物舰名；族徽按**产物舰**判 */
function shipBlueprintCellOf(engine: GameEngine, bp: ShipBlueprintDef): GridCell {
  return {
    key: bp.id,
    tab: 'blueprints',
    glyph: 'blueprint',
    name: bp.name,
    sub: tr("ui.Handbook.249", { p1: engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId }),
    raw: bp as unknown as RawData,
    rarity: itemRarityTierOf(bp.id),
    ...(factionOfExclusive(bp.shipId) !== undefined ? { crest: factionOfExclusive(bp.shipId)! } : {}),
  }
}

/** 图纸段族徽用的产物查询（模块 id；物品蓝图与舰船蓝图各自另有判据）——
 *  ⚠ `factionOfExclusive` 对"不是任何势力专属"的件返回 `null`（找不到才是 `undefined`）
 *  ⇒ 这里统一收窄成 `string | undefined`，让调用处只判一种"没有" */
function crestOfProduct(moduleId: string | undefined): string | undefined {
  const fam = moduleId !== undefined ? factionOfExclusive(moduleId) : undefined
  return fam ?? undefined
}

/** 详情内容（按页签/数据类型给出完整字段） */
function DetailBody({ engine, cell }: { engine: GameEngine; cell: GridCell }) {
  const r = cell.raw
  const rows: Array<[string, ReactNode]> = []

  if (cell.tab === 'items') {
    const kind = String(r.kind ?? '')
    // 2026-09-10 船长：无人机把归类子属性并入「种类」（无人机 · 侦察机）——走 core 单点
    rows.push([
      tr("ui.Handbook.005"),
      kindTextOfItem({ kind: kind as ItemKind, droneClass: r.droneClass as DroneClass | undefined }),
    ])
    rows.push([tr("ui.Handbook.006"), `${Number(r.unitM3 ?? 0)} m³`])
    // V10.5：弹药/无人机补充伤害契约（与其它界面统一由 shipInfo 生成）
    const itemId = String(r.id ?? '')
    const itemDef = itemId ? engine.ctx.items.get(itemId) : undefined
    if (itemDef && (itemDef.kind === 'ammo' || itemDef.kind === 'drone')) {
      for (const line of itemCombatLines(itemDef)) rows.push([line.k, line.v])
    }
    const refine = (r.refine as Array<{ mineralId: string; perOre: number }> | undefined) ?? []
    if (refine.length > 0) {
      rows.push([
        tr("ui.Handbook.007"),
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
      rows.push([tr("ui.Handbook.008"), tr("ui.Handbook.106", { p1: slotName(String(r.slot ?? '')), p2: Math.round(Number(r.bonus ?? 0) * 100) })])
    }
  } else if (cell.tab === 'ships') {
    const shipId = String(r.id ?? '')
    const shipDef = shipId ? engine.ctx.ships.get(shipId) : undefined
    if (shipDef) {
      // V10.5：统一行（定位/货舱/采集/动力 + 盾甲结构抗性与槽位）；V17 战斗数值已生效
      // 2026-09-26 船长报障（第二遍）：「点击舰船图鉴内的舰船，当中的属性还是有动力，而没有机动速度」
      // ⇒ 本分支与装配页**同一口径**：主属性位报**机动速度**（船体基础值），**动力下沉到间接属性块**。
      // 上一版我把键写反了（藏了「机动速度」、留了「动力」），此处按报障改正：
      // ① `shipInfoLines` 的「机动速度」留下（= 船长第二令「图鉴内按照基础属性算」）；
      // ② 只滤掉「动力」——它在下面的 `shipIndirectLines` 块里，别在两张表里各报一次；
      // ③ 「无人机舱」也滤掉：本详情窗上方是 `app-combat-badges`（三层血量），且无机舱的船
      //    原先会白占一行「无人机舱 = 无」。
      for (const line of shipInfoLines(shipDef)) {
        if (line.k === tr('ui.Handbook.012') || line.k === tr('ui.FitPage.010')) continue
        rows.push([line.k, line.v])
      }
      // 2026-09-12 船长：「手册图鉴里的舰船信息可以查看舰船的间接属性」⇒ 追加间接属性行
      // （动力/跃迁速度/质量/锁定范围/信号半径/扫描分辨率/跃迁充能；与装配页同一数据源）。
      // ⚠ 行以 `k` 作 React key ⇒ `shipIndirectLines` 的键不得与 `shipInfoLines` 重名（当前无重名）。
      for (const line of shipIndirectLines(shipDef)) rows.push([line.k, line.v])
      rows.push([tr("ui.Handbook.002"), tr("ui.Handbook.181")])
      rows.push([tr("ui.Handbook.315"), Number(r.priceIsk ?? 0) <= 0 ? tr("ui.Handbook.107") : tr("ui.Handbook.108")])
    } else {
      const cls = shipCategoryKeyOf(r as unknown as { role?: ShipRole; shieldHp?: number; armorHp?: number })
      rows.push([tr("ui.Handbook.009"), `${roleName(cls)} · ${shipTierText(Number(r.tier ?? 0))}`])
      rows.push([tr("ui.Handbook.010"), `${Number(r.cargoM3 ?? 0).toLocaleString('zh-CN')} m³`])
      rows.push([tr("ui.Handbook.011"), tr("ui.shipInfo.130", { p1: Number(r.cycleSeconds ?? 0), p2: Number(r.oreUnitsPerCycle ?? 0) })])
      rows.push([tr("ui.Handbook.012"), `${Math.round(Number(r.agility ?? 0) * 100)}%`])
      if (Number(r.priceIsk ?? 0) <= 0) rows.push([tr("ui.Handbook.315"), tr("ui.Handbook.107")])
    }
  } else if (cell.tab === 'blueprints') {
    const materials = (r.materials as Array<{ itemId: string; count: number }> | undefined) ?? []
    const moduleId = r.moduleId !== undefined ? String(r.moduleId) : undefined
    const itemId = r.itemId !== undefined ? String(r.itemId) : undefined
    const shipId = r.shipId !== undefined ? String(r.shipId) : undefined
    // 产物 + 产物属性行 + 产物介绍（2026-09-08 船长定：蓝图详情须同显产物属性与介绍——
    // 与图鉴 modules/ships/items 分支同一数据源；弹药蓝图产物此前误落舰船分支，一并修正）
    let productName = ''
    const prodRows: Array<[string, ReactNode]> = []
    if (itemId !== undefined) {
      const itemDef = engine.ctx.items.get(itemId)
      productName = tr("ui.Handbook.109", { p1: itemDef?.name ?? itemId })
      if (itemDef) {
        for (const l of itemInfoLines(itemDef, (id) => engine.ctx.items.get(id)?.name)) prodRows.push([l.k, l.v])
        if (itemDef.description) prodRows.push([tr("ui.Handbook.110"), itemDef.description])
      }
    } else if (moduleId !== undefined) {
      const modDef = engine.ctx.modules.get(moduleId)
      productName = tr("ui.Handbook.111", { p1: modDef?.name ?? moduleId })
      if (modDef) {
        // V17：统一行——各家族真实进公式参数（工业加成 / 武器卡 / 容量+缺口抗性 / 加力推进）
        for (const l of moduleInfoLines(modDef)) prodRows.push([l.k, l.v])
        if (modDef.description) prodRows.push([tr("ui.Handbook.110"), modDef.description])
      }
    } else {
      const shipDef = engine.ctx.ships.get(shipId ?? '')
      productName = tr("ui.Handbook.112", { p1: shipDef?.name ?? shipId ?? '' })
      if (shipDef) {
        // V10.5：统一行（定位/货舱/采集/机动速度 + 盾甲结构抗性与槽位）；V17 战斗数值已生效
        // 2026-09-26 与「图鉴·舰船」分支同口径：动力走下面的间接属性块，不在主属性里重复一遍
        for (const l of shipInfoLines(shipDef)) {
          if (l.k === tr('ui.Handbook.012')) continue
          prodRows.push([l.k, l.v])
        }
        // 2026-09-12 船长：舰船蓝图详情同样可见间接属性（与图鉴·舰船分支同口径）
        for (const l of shipIndirectLines(shipDef)) prodRows.push([l.k, l.v])
        if (shipDef.description) prodRows.push([tr("ui.Handbook.110"), shipDef.description])
      }
    }
    rows.push([tr("ui.MarketPage.016"), productName])
    for (const [k, v] of prodRows) rows.push([k, v])
    rows.push([
      tr("ui.MarketPage.018"),
      <span key="mats" className="app-detail-mats">
        {materials.map((m) => (
          <span key={m.itemId} className="app-detail-mat">
            {engine.ctx.items.get(m.itemId)?.name ?? m.itemId} ×{m.count.toLocaleString('zh-CN')}
          </span>
        ))}
      </span>,
    ])
    rows.push([tr("ui.Handbook.246"), tr("ui.Handbook.247", { p1: Math.round(Number(r.buildSeconds ?? 0) / 60) })])
  } else if (cell.tab === 'foe') {
    /**
     * **敌舰**（2026-09-26 船长令：势力图鉴的敌人卡「和其他图鉴中一样，可以点开」）——
     * 行内容由 `FoeBody` 单独渲染（三层血占比 / 伤害构成 / 特殊装置，且头部画舰影），
     * 不走下面这套通用行表。这里提前 return，避免"空行表"。
     */
    return <FoeBody cell={cell} engine={engine} />
  } else if (cell.tab === 'skills') {
    rows.push([tr("ui.Handbook.132"), String(r.group ?? '')])
    rows.push([tr("ui.Handbook.316"), tr("ui.Handbook.113", { p1: Number(r.rank ?? 0) })])
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

/**
 * **敌舰详情**（**2026-09-26 船长令**：敌人卡「**和其他图鉴中一样，可以点开**」）。
 *
 * 数据全部来自**敌舰自身的定义**（`FoeShipDef`）与既有单点，不在界面里另算一套：
 * - 一句话战术/武器/主副伤/舰载机/精英档 ＋ 特殊装置：`foeBriefLinesOfShip`（与悬赏卡悬停**同一份**）；
 * - 机体数值：三层血占比 `split`、单发 `shotDmg`、命中 `hitRate`、装填 `reloadMs`、射程带、闪避、速度比；
 * - 舰影：`ShipSprite`（敌舰逐舰资产表，与战斗画面同一张；未命中回退族形）。
 *
 * ⚠ 标签复用既有 `ui.*` 词条（舰级 / 护盾 / 装甲 / 结构 / 命中加成 / 回避率 / 锁定范围 /
 * 装填 / 单发伤害 / 机动速度 / 特殊装置），**不新造文案、不新取 id**。
 */
function FoeBody({ cell, engine }: { cell: GridCell; engine: GameEngine }): ReactNode {
  const def = cell.raw as unknown as FoeShipDef
  const line = foeBriefLinesOfShip(def)
  const row = (k: string, v: ReactNode): ReactNode => (
    <div key={k} className="app-detail-row">
      <span className="app-detail-key">{k}</span>
      <span className="app-detail-val">{v}</span>
    </div>
  )
  const pctOf = (v: number | undefined): string => (v === undefined ? '—' : `${Math.round(v * 100)}%`)
  const mounts = line?.mounts ?? []
  return (
    <div className="app-detail-body">
      <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 10px' }}>
        <ShipSprite shipId={def.id} size={200} engine={false} />
      </div>
      {row(tr('ui.Handbook.009'), `${line?.hull ?? ''}${def.elite === true ? ` · ${tr('ui.foeIntro.070')}` : ''}`)}
      {/* 伤害构成：用与卡面同一枚 `DmgChip`（三系伤害色）＋ shares 百分比（`ui.foeIntro.030` 的句式） */}
      {row(
        tr('ui.Expedition.217'),
        (() => {
          const mix = Object.entries(def.dmgMix ?? {}).sort((a, b) => b[1] - a[1])
          const total = mix.reduce((n, [, v]) => n + v, 0)
          if (mix.length === 0 || total <= 0) return '—'
          return (
            <>
              {mix.map(([t, v], i) => (
                <span key={t} className="app-stack-inline">
                  {i > 0 ? <span className="app-dim"> · </span> : null}
                  <DmgChip t={t as DamageType} />
                  <span className="app-dim">{` ${Math.round((v / total) * 100)}%`}</span>
                </span>
              ))}
            </>
          )
        })(),
      )}
      {/* 三层血**占比**（不是绝对血量：敌舰按威胁缩放，占比才是卡面口径） */}
      {row(
        `${tr('ui.FitPage.014')} / ${tr('ui.FitPage.015')} / ${tr('ui.ShipPage.023')}`,
        `${Math.round((def.split?.s ?? 0) * 100)}% / ${Math.round((def.split?.a ?? 0) * 100)}% / ${Math.round((def.split?.h ?? 0) * 100)}%`,
      )}
      {row(tr('ui.FitPage.006'), pctOf(def.hitRate))}
      {row(tr('ui.FitPage.007'), pctOf(def.evasion))}
      {/**
       * **攻击范围**（**2026-09-26 船长令**：「**在手册内的敌人，还会显示其基础速度和攻击范围**」）——
       * 标签复用既有的「射程带」（`ui.shipInfo.040`，与舰船属性表同词），数值 = `rangeMinM – rangeMaxM`。
       * （原先这一行用的是「锁定范围」的标签，语义不对 —— 那是"能锁多远"，这里要报**火力够到哪**。）
       */}
      {row(tr('ui.shipInfo.040'), `${def.rangeMinM ?? 0} – ${def.rangeMaxM ?? 0} m`)}
      {row(tr('ui.shipInfo.044'), def.shotDmg !== undefined ? String(def.shotDmg) : '—')}
      {row(tr('ui.shipInfo.032'), `${((def.reloadMs ?? 0) / 1000).toFixed(1)} s`)}
      {/**
       * **基础速度**（同上一条船长令）：`舰种基准 × speedRatio`，与战斗建档**同源同式**
       * （`combat.createFoeSpecsFromShips`：`HULL_CLASS_BASE_SPEED[舰种档] × speedRatio × speedMul`，
       * `speedMul` 只有编成条目会带、舰级不带 ⇒ 这里是"这条舰级的基础速度"）。
       * 基准表读 core 的 `hullClassBaseSpeedMps`（`{1:340, 2:295, 3:258, 4:205, 5:155}`，
       * data 包的 `HULL_CLASS_BASE_SPEED` 就是它的同源引用 ⇒ 不另存第二份数字）。
       * ⚠ 括号里的倍率是**规格**（命名规则第 9 条允许），不是解释。
       * ⚠ **标签不能用 `ui.shipInfo.009`**（那个键在"删最大速度"批里已删，`tr()` 会原样印出 id ——
       * 实测踩过：格子里印出 `ui.shipInfo.009 = 391 m/s`）⇒ 这里复用既有词条「机动速度」。
       */}
      {row(
        tr('ui.FitPage.049'),
        `${Math.round((engine.ctx.balance.battle.hullClassBaseSpeedMps[def.hullClassTier] ?? 0) * (def.speedRatio ?? 1))} m/s（${def.speedRatio ?? 1}×）`,
      )}
      {row(tr('ui.Expedition.152', { p1: line?.bits[0] ?? '—' }), line !== null && line.bits.length > 1 ? line.bits.slice(1).join(' · ') : '—')}
      {mounts.map((m, i) =>
        row(`${mountLabelText()}${mounts.length > 1 ? ` ${i + 1}` : ''}`, `${m.name !== '' ? `${m.name}：` : ''}${m.effect}`),
      )}
    </div>
  )
}

function CellDetail({
  engine,
  cell,
  onClose,
  onGotoMarket,
}: {
  engine: GameEngine
  cell: GridCell
  onClose: () => void
  /** 图鉴 → 市场（2026-09-14 船长）：传该条目在市场的商品键；**缺省 = 不渲染按钮**（无入口时也不假装能跳） */
  onGotoMarket?: (goodKey: string) => void
}) {
  const tone = toneOf(cell.glyph)
  const marketKey = onGotoMarket ? marketKeyOf(engine, cell) : null
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
            {/* 舰船只/敌舰只：头部也画 SVG（与卡片同一张资产表）；其余条目仍是类别徽记 */}
            {cell.shipId !== undefined ? (
              <ShipSprite shipId={cell.shipId} role={cell.shipRole} size={120} engine={false} />
            ) : (
              <Glyph name={cell.glyph} size={44} color={tone} />
            )}
          </span>
          <div className="app-detail-title">
            <div className="app-detail-name">{cell.name}</div>
            <div className="app-detail-sub">{cell.sub}</div>
          </div>
          {/* 「↖ 查看市场」：只跳转、不下单（与舰船页/物品页/货舱页/组装机同一个 `onGotoMarket` 入口）
              —— 到市场页会自动搜到该商品并展开它的行情详情。⚠ 点它**同时关掉手册**：
              手册是覆盖层，不关就会盖在刚切过去的市场页上面、聚焦也看不见。 */}
          {marketKey !== null && onGotoMarket ? (
            <button
              className="app-btn is-small app-detail-goto"
              title={tr("ui.CargoPage.003")}
              onClick={() => {
                onClose()
                onGotoMarket(marketKey)
              }}
            >
              {tr("ui.CargoPage.001")}
            </button>
          ) : null}
        </div>
        <DetailBody engine={engine} cell={cell} />
        <div className="app-dim app-detail-tip">{tr("ui.Handbook.248")}</div>
      </div>
    </div>
  )
}

/** 一个分组小节（仓库同款：分类名 + 数量 + 卡片/列表） */
function GroupSection({
  label,
  unit,
  count,
  children,
}: {
  label: string
  unit: string
  count: number
  children: ReactNode
}) {
  return (
    <Panel title={label} right={<span className="app-dim">{count} {unit}</span>}>
      {children}
    </Panel>
  )
}

export function Handbook({
  engine,
  onClose,
  onGotoMarket,
}: {
  engine: GameEngine
  onClose: () => void
  /** 图鉴条目 → 市场（2026-09-14 船长）；由 App 透传与舰船页/物品页/工业页同一个入口 */
  onGotoMarket?: (goodKey: string) => void
}) {
  const [tab, setTab] = useState<Tab>('guide')
  const [view, setView] = useState<ViewMode>(readView)
  const [detail, setDetail] = useState<GridCell | null>(null)
  const [query, setQuery] = useState('')
  /* 图鉴筛选（2026-09-13 船长）：一级 `mainKey`，二级 `subKey`；都**不落盘**——关上手册再打开即重置
     （与市场「切类型即回全部子类」同一哲学）。`SUB_ALL` = 全部 / 全部子类。 */
  const [mainKey, setMainKey] = useState<string>(SUB_ALL)
  const [subKey, setSubKey] = useState<string>(SUB_ALL)
  /** 说明类（玩法速览 / 航行须知）当前停留的**子页**（= 词条标题；空串 = 默认第一条，`TIPS_KEY` = 小贴士页） */
  const [pageKey, setPageKey] = useState<string>('')
  /**
   * **势力图鉴：当前选中的势力**（2026-09-26 船长令：「在势力图鉴内新建一个窗口容器，玩家点击某个势力后，
   * 下方窗口内就显示该势力的介绍和敌人种类，专属装备，舰船等」）——
   * 缺省选第一个族；点上方卡片即切换；**详情不再弹二级窗口**，只活在下方容器里。
   */
  const [factionSel, setFactionSel] = useState<string>(FACTION_CODEX_ORDER[0] ?? 'A')

  function changeView(v: ViewMode): void {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 本地存储不可用：忽略
    }
  }
  /**
   * 切页：清空**详情与筛选**；**关键词保留**（2026-09-17 船长：「**手册里进行搜索后，切换导航页搜索会重置**」）。
   *
   * 口径（当日两答）：① **关键词跨页保留**——搜索框里的词切页后原样留着，并作用于新页
   * （新页没命中就显示「没有匹配…」提示，导航计数也按该页命中数显示）；② **关掉手册再打开即清空**
   * （不落 localStorage，与筛选同哲学）。筛选（一级/二级/子页）仍按 2026-09-13 的裁定**切页归零**
   * （「与市场『切类型即回全部子类』同一哲学」）。
   *
   * ⚠ 原先这里还带一句 `setQuery('')`（原注释："各页关键词互不相关，避免换了页却没结果的困惑"）——
   * 那是经办人自定的口径，不是船长裁定，本日按船长指示删除。**别再往回加**（护栏 = `content:check`
   * 「手册搜索跨页保留契约」）。
   */
  function changeTab(t: Tab): void {
    setTab(t)
    setDetail(null)
    setMainKey(SUB_ALL)
    setSubKey(SUB_ALL)
    setPageKey('')
  }
  /** 选一级分类：二级随之归零（与组装机「换一级标签即回全部子类」同款） */
  function pickMain(k: string): void {
    setMainKey(k)
    setSubKey(SUB_ALL)
  }

  const q = query.trim().toLowerCase()
  const hitCell = (c: GridCell): boolean =>
    q === '' ||
    c.name.toLowerCase().includes(q) ||
    c.sub.toLowerCase().includes(q) ||
    String(c.raw.description ?? '').toLowerCase().includes(q)
  /* 说明类（玩法速览 / 航行须知）：搜索作用于**整章**（跨子页命中，见 handEntryHits）。
     `cur` 是当前该显示的**一页**：玩家点的子页；点的那条被关键词滤掉时自动落到第一条命中的（搜索即跳页）。 */
  const sects: HandGroup[] = tab === 'guide' ? GUIDE_GROUPS : tab === 'rules' ? RULE_SECTS : []
  const flat = sects.flatMap((g) => g.entries.map((e) => ({ g, e })))
  const matched = flat.filter((x) => handEntryHits(x.e, q) > 0)
  const onTips = tab === 'guide' && pageKey === TIPS_KEY
  const cur = onTips ? null : (matched.find((x) => x.e.title === pageKey) ?? matched[0] ?? null)
  /* 翻页序列（2026-09-14 船长追加：页底「上一条 / 下一条」）：按当前章的**阅读顺序**连续走，跨组不打断；
     搜索时只在命中项之间走（与"搜索即跳页"同一套口径）。「小贴士」排在「玩法速览」最后一条之后。 */
  const tipsHit = q === '' || GUIDE_NOTES.some((n) => n.toLowerCase().includes(q))
  const pageSeq: Array<{ key: string; label: string }> = [
    ...matched.map((x) => ({ key: x.e.title, label: x.e.title })),
    ...(tab === 'guide' && tipsHit ? [{ key: TIPS_KEY, label: tr("ui.Handbook.114") }] : []),
  ]
  const pageIdx = pageSeq.findIndex((p) => p.key === (onTips ? TIPS_KEY : (cur?.e.title ?? '')))
  const prevPage = pageIdx > 0 ? pageSeq[pageIdx - 1]! : null
  const nextPage = pageIdx >= 0 && pageIdx < pageSeq.length - 1 ? pageSeq[pageIdx + 1]! : null

  /* ── 网格单元（glyph 名即色调键；raw 带完整数据供详情窗） ──
   *  ⚠ 物品图鉴走**玩家可见目录**（`visibleItemDefs`）：未上线物品（标 `ItemDef.unreleased`）
   *  不进图鉴——首版直接遍历 `engine.items` 全目录，未上线矿会连名字带描述一起被搜出来（2026-09-13 实测）。 */
  const itemCells: GridCell[] = visibleItemDefs(engine.ctx).map((item) => ({
    key: item.id,
    tab: 'items',
    // 2026-09-20 零件两档：glyph 用档位键 ⇒ 图鉴里基础/高级零件分色（形状同一枚 part 线稿）
    glyph: item.kind === 'part' ? partToneKeyOf(item.id) : item.kind,
    name: item.name,
    sub: `${kindName(item.kind)} · ${item.unitM3} m³`,
    raw: item as unknown as RawData,
    rarity: itemRarityTierOf(item.id),
  }))
  const moduleCells: GridCell[] = engine.modules.map((mod) => moduleCellOf(mod))
  const shipCells: GridCell[] = engine.ships.map((ship) => shipCellOf(ship))
  const bpCells: GridCell[] = [
    ...engine.blueprints.map((bp) => blueprintCellOf(engine, bp)),
    ...engine.shipBlueprints.map((bp) => shipBlueprintCellOf(engine, bp)),
  ]
  const skillCells: GridCell[] = engine.skills.map((s) => ({
    key: s.id,
    tab: 'skills',
    glyph: `group-${s.group}`,
    name: s.name,
    // ⚠ 技能分类名本地化：`s.group` 是 data 侧的**中文分类键**（`SKILL_GROUPS`），
    //   直读会在英文界面漏中文（2026-09-22 手册本地化批）⇒ 走 `skillGroupText` 单点
    sub: tr("ui.Handbook.115", { p1: skillGroupText(s.group), p2: s.rank }),
    raw: s as unknown as RawData,
  }))

  /* ── 分组（顺序表与市场页类型子分类同源；空组隐藏） ── */
  const filtered = (cells: GridCell[]): GridCell[] => cells.filter(hitCell)
  const showCells = (cells: GridCell[], t: Tab): CellGroup[] => groupCells(cells, groupKeyOf, orderOf(t))
  /** 分组键：物品按大类 / 装备按槽类 / 舰船按舰族 / 蓝图按产物门类（装备蓝图再按产物槽类） / 技能按技能组 */
  function groupKeyOf(c: GridCell): string {
    if (c.tab === 'items') return String(c.raw.kind ?? '')
    if (c.tab === 'modules') return moduleSubKeyOf(String(c.raw.slot ?? ''), String(c.raw.id ?? ''))
    if (c.tab === 'ships') return String(c.glyph) // 舰船类别键（`shipCategoryKeyOf` 的产物；见 shipCells）
    if (c.tab === 'blueprints') {
      // 2026-09-10 船长：装备蓝图按**产物模块的槽类**分高/中/低档（与市场页子分类同源单点）
      // 2026-09-11 船长：「舰船部分按舰船级别划分」——舰船蓝图由 1 组拆成 T1~T5 五组（键 t<级别>，同表）
      if (c.raw.shipId !== undefined) {
        const ship = engine.ctx.ships.get(String(c.raw.shipId))
        return ship ? `t${ship.tier}` : ''
      }
      if (c.raw.itemId !== undefined) {
        // 2026-09-20 零件体系（船长裁定「归到该组」）：**产物是零件的**归「零件蓝图」组——
        // 组键沿用市场那张单点表 `BLUEPRINT_SUBS` 里既有的 `part-advanced` 档（其 label 就是「零件蓝图」，
        // 市场上只有高级零件有书；图鉴这一组连基础零件的隐式蓝图一起列）。
        return engine.ctx.items.get(String(c.raw.itemId))?.kind === 'part' ? 'part-advanced' : 'supply'
      }
      const mod = engine.ctx.modules.get(String(c.raw.moduleId ?? ''))
      return mod ? rackOf(mod) : ''
    }
    return String(c.raw.group ?? '') // skills
  }
  /**
   * 分组顺序表（与市场页同源；装备未收录槽位归「其它」）。
   *
   * ⚠ **2026-09-22 手册本地化批**：这几行原先把单点表**压成 `{ key, label }`、把 `id` 丢掉了**
   * ⇒ 分组标题与筛选档只能回落到中文 `label`（英文界面下整片「高槽装备蓝图 / T1 护卫舰蓝图…」）。
   * 现**原样带上 `id`/`idParam`**，由渲染处的 `subText` 取当前语言；技能分类是 data 侧中文键，
   * 走 `skillGroupText` 单点映射（无 id 时 `subText` 回落到 `label`，故这里给已译好的 `label`）。
   */
  function orderOf(t: Tab): Array<{ key: string; label: string; id?: string; idParam?: string }> {
    if (t === 'items') return ITEM_KIND_ORDER.map((k) => ({ key: k, label: kindName(k) }))
    if (t === 'modules')
      return MODULE_SUBS.map(
        (s): { key: string; label: string; id?: string; idParam?: string } => ({
          key: s.key,
          label: s.label,
          id: s.id,
          idParam: s.idParam,
        }),
      ).concat([{ key: '', label: tr("ui.Handbook.116") }])
    if (t === 'ships') return SHIP_SUBS.map((s) => ({ key: s.key, label: s.label, id: s.id, idParam: s.idParam }))
    if (t === 'blueprints')
      return BLUEPRINT_SUBS.map(
        (s): { key: string; label: string; id?: string; idParam?: string } => ({
          key: s.key,
          label: s.label,
          id: s.id,
          idParam: s.idParam,
        }),
      ).concat([{ key: '', label: tr("ui.Handbook.116") }])
    return engine.groups.map((g) => ({ key: g, label: skillGroupText(g) })) // skills
  }

  /**
   * **势力图鉴的卡片**（2026-09-26 船长：「敌族图鉴单独列出吧，放在蓝图图鉴下方，叫『势力图鉴』」）：
   * 值由 data 侧 `buildFactionCards` 装配（单一来源：收录范围 ＋ 各族专属件/舰/图纸 ＋ 遭遇记录），
   * 这里只把 `FoeShipDef` 目录喂进去、并把搜索文本拼出来。
   */
  const isFactionPage = tab === 'factions'
  /**
   * ⚠ **必须无条件构造**（2026-09-26 船长报障：「势力图鉴，玩家如果不点击，在导航栏的数字显示为 0」）：
   * 导航计数走 `navCount()` ⇒ `codexCells[t]` —— 若这里按 `isFactionPage` 门控，**在别的页时**
   * `codexCells.factions` 就是空数组、导航那一格恒显示 0。六张卡本来就不贵（只读 `FOE_SHIPS`＋遭遇记录），
   * 与搜索词也无关 ⇒ 每次渲染都算。
   */
  const factionCells: GridCell[] = (() => {
        const ships = collectFoeShips(engine)
        return buildFactionCards(FOE_SHIPS, engine.state.foeShipSeen).map((card) => {
          // 卡面**始终给族名**（未解锁的族也看得见是哪一支）；「？？？」只用于**内容行**（敌人 / 专属明细）
          const head = tr(card.nameId)
          const enemyText = card.enemies
            .map((e) => (e.seen ? ships.get(e.id)?.name ?? '' : ''))
            .filter((s) => s !== '')
            .join(' ')
          const itemText = [...card.modules, ...card.ships]
            .map((id) => engine.ctx.modules.get(id)?.name ?? engine.ctx.ships.get(id)?.name ?? engine.ctx.items.get(id)?.name ?? '')
            .join(' ')
          return {
            key: card.family,
            tab,
            glyph: card.glyph,
            name: head,
            sub: tr('ui.codex.003', { p1: card.seenCount, p2: card.totalCount }),
            raw: card as unknown as RawData,
            faction: card.family,
            hits: `${head} ${enemyText} ${itemText}`,
          }
        })
  })()

  const codexCells: Record<CodexTab, GridCell[]> = {
    items: itemCells,
    modules: moduleCells,
    ships: shipCells,
    blueprints: bpCells,
    skills: skillCells,
    factions: factionCells,
  }
  const isCodex = tab === 'items' || tab === 'modules' || tab === 'ships' || tab === 'blueprints' || tab === 'skills' || tab === 'factions'

  /* ── 图鉴筛选（2026-09-13 船长：「对手册中的各个图鉴添加筛选，如果有子分类的，主筛选选择之后出现子分类筛选」；
        集中提问后定：**只做一级的页签 = 物品 / 技能**（无天然第二层），二级只在装备 / 舰船 / 蓝图三页；
        控件复用组装机那一套 `app-task-tabs` + `app-tasktab` 胶囊；与搜索取「与」 ── */

  /** 主筛选（一级）**候选表**——与各页的**分组键同一套判据**：装备＝槽类、舰船＝角色、蓝图＝门类 */
  function mainCandidatesOf(t: CodexTab): SubOption[] {
    if (t === 'items') return ITEM_KIND_ORDER.map((k) => ({ key: k, label: kindName(k) }))
    if (t === 'modules') return RACK_SUBS
    if (t === 'ships') return SHIP_SUBS
    if (t === 'blueprints') return BP_MAIN
    // l10n-keep：`g` 是 data 侧的分类**键**（中文即键），渲染前一律过 `skillGroupText` 取当前语言
    return engine.groups.map((g) => ({ key: g, label: skillGroupText(g) }))
  }
  /**
   * **主筛选（一级）可选项 = 候选表里"本页真有卡片"的那些**（2026-09-20 船长「手册的筛选也进行收缩」）——
   * 「全部」常显；判据与下面的 `mainPasses` 同一把尺（避免出现"选进去必然空"的档）。
   */
  function mainOptions(t: CodexTab): SubOption[] {
    return presentSubs(mainCandidatesOf(t), (key) => codexCells[t].some((c) => mainPasses(c, t, key)))
  }
  /** 子筛选（二级）**候选表**——**必须选了主类才出现**（「全部」不带子筛选；2026-09-13 船长口径：
   *  「如果有子分类的，主筛选选择之后出现子分类筛选」）。2026-09-19 甲组补丁按船长
   *  「涉及到特定分类的父分类时，将其子分类也放入」补齐：
   * - 物品图鉴：货柜→四档 · 残骸→档位 · AI 核心→档位（只列有物品形态的）· 蓝图碎片→功能分组；
   * - 蓝图图鉴：装备→槽类 / 舰船→级别 / **消耗品→产物大类**（原先消耗品整行不出）；
   * - 装备图鉴：槽类（主）→ 功能分组（子）；舰船图鉴：类别（主）→ 级别（子）。
   */
  function subCandidatesOf(t: CodexTab, main: string): SubOption[] {
    if (t === 'modules') return MODULE_SUBS
    if (t === 'ships') return SHIP_TIER_SUBS
    if (t === 'items') {
      if (main === 'container') return CONTAINER_SUBS
      if (main === 'wreck') return WRECK_SUBS
      if (main === 'aicore') return CORE_SUBS.filter((s) => engine.ctx.items.has(`ai-core-${s.key}`))
      if (main === 'fragment') return MODULE_SUBS
      return []
    }
    if (t === 'blueprints') {
      if (main === 'equip') return RACK_SUBS
      if (main === 'ship') return SHIP_TIER_SUBS
      if (main !== 'consume') return [] // 「零件蓝图」自成一门，暂不细分（基础/高级已在卡片副行与产物名里）
      /** 消耗品蓝图：按**产物大类**细分（弹药 / 修理组件 / 无人机）——只列真有蓝图的大类 */
      const kinds = new Set<string>()
      for (const b of engine.blueprints) {
        if (b.itemId === undefined) continue
        const k = engine.ctx.items.get(b.itemId)?.kind
        if (k !== undefined) kinds.add(k)
      }
      return CONSUME_SUBS.filter((s) => kinds.has(s.key))
    }
    return []
  }
  /**
   * **子筛选（二级）可选项 = 候选表里"该主类下真有卡片"的那些**（2026-09-20 船长「手册的筛选也进行收缩」）——
   * 船长点名的同类问题（精炼炉/组装机/市场已改）在手册里的落点：物品图鉴「蓝图碎片」挂着十组功能、
   * 实际只有「采集与货舱 / 武器」有卡；装备图鉴「高槽」下挂着护盾/装甲/推进器/协处理器四档恒空；
   * 舰船图鉴「采矿舰」下挂着 T4/T5 恒空。判据与 `mainPasses × subPassesCell` 同一把尺。
   * ⚠ 只收**选项**：卡片集合（`codexCells` 与下面的分组）一字未动。
   */
  function subOptions(t: CodexTab, main: string): SubOption[] {
    if (main === SUB_ALL) return []
    return presentSubs(subCandidatesOf(t, main), (key) =>
      codexCells[t].some((c) => mainPasses(c, t, main) && subPassesCell(c, t, key)),
    )
  }
  /** 主筛选判定（判据与 `groupKeyOf` 逐条对齐，避免"筛出来的条目和分组标题不一致"） */
  function mainPasses(c: GridCell, t: Tab, main: string): boolean {
    if (main === SUB_ALL) return true
    /** 物品 / 装备两页走**唯一入口** `itemBucketPasses`（甲组·判定单点，2026-09-19 六条基线之⑥）：
     *  物品页的 `main` = 真实物品大类；装备页的 `main` = 槽类键（`high/mid/low`）⇒ 拼成桶键 `module-<rack>`。 */
    if (t === 'items') return itemBucketPasses(engine.ctx, c.key, main)
    if (t === 'modules') return itemBucketPasses(engine.ctx, c.key, `module-${main}`)
    // 舰船图鉴：类别走**唯一入口** `shipRolePasses`（= core `shipCategoryKeyOf`，2026-09-19 乙组）
    if (t === 'ships') return shipRolePasses(engine.ctx.ships.get(c.key), main)
    if (t === 'blueprints') {
      if (c.raw.shipId !== undefined) return main === 'ship'
      if (c.raw.itemId !== undefined) {
        // 2026-09-20 船长裁定：产物是零件的走「零件蓝图」门类，其余物品蓝图仍是消耗品蓝图
        const kind = engine.ctx.items.get(String(c.raw.itemId))?.kind
        return main === (kind === 'part' ? 'part' : 'consume')
      }
      return main === 'equip'
    }
    return String(c.raw.group ?? '') === main // skills
  }
  /** 子筛选判定（技能页无二级，恒真）——物品 / 装备两页走**唯一入口** `itemSubPasses`（甲组补丁） */
  function subPassesCell(c: GridCell, t: Tab, sub: string): boolean {
    if (sub === SUB_ALL) return true
    if (t === 'items') return itemSubPasses(engine.ctx, c.key, String(c.raw.kind ?? ''), sub)
    // 装备图鉴：走**唯一入口** `itemSubPasses`（bucket = `module`）——2026-09-26 收敛：
    // 原先这里自己写 `moduleSubKeyOf(slot) === sub`，与市场/碎片那条单点**各写一份**；
    // 支援件拆三档后两份判定必须有同一把尺，故统一（两者对装备的行为逐字等价）。
    if (t === 'modules') return itemSubPasses(engine.ctx, c.key, 'module', sub)
    // 舰船图鉴：级别走**唯一入口** `shipTierPasses`（2026-09-19 乙组）
    if (t === 'ships') return shipTierPasses(engine.ctx.ships.get(c.key), sub)
    if (t === 'blueprints') {
      if (c.raw.shipId !== undefined) {
        const ship = engine.ctx.ships.get(String(c.raw.shipId))
        return ship !== undefined && `t${ship.tier}` === sub
      }
      // 消耗品蓝图：二级 = 产物大类（弹药 / 修理组件）
      if (c.raw.itemId !== undefined) {
        const it = engine.ctx.items.get(String(c.raw.itemId))
        return it !== undefined && it.kind === sub
      }
      const mod = engine.ctx.modules.get(String(c.raw.moduleId ?? ''))
      return mod !== undefined && rackOf(mod) === sub
    }
    return true
  }

  const mainOpts = isCodex ? mainOptions(tab) : []
  const subOpts = isCodex ? subOptions(tab, mainKey) : []
  /** 搜索或筛选任一生效（命中计数与空态文案据此切换措辞） */
  const narrowed = q !== '' || mainKey !== SUB_ALL || subKey !== SUB_ALL
  /** 势力页的命中判定：与别页同款，但额外搜**已遭遇的舰级名与专属件名**（玩家按"那艘船叫什么"找族） */
  function factionHit(c: GridCell): boolean {
    if (!hitCell(c)) return false
    if (q === '') return true
    const extra = String((c as { hits?: string }).hits ?? '').toLowerCase()
    return extra.includes(q) || c.name.toLowerCase().includes(q)
  }
  /** 势力页分组：**不做两级筛选**（六族平铺，顺序 = `FACTION_CODEX_ORDER`） */
  const factionEntries: CellGroup[] = isFactionPage
    ? (factionCells.some((c) => factionHit(c))
        ? [{ key: 'factions', label: tr('ui.codex.001'), id: 'ui.codex.001', cells: factionCells.filter(factionHit) }]
        : [])
    : []

  const groups: CellGroup[] = isCodex
    ? showCells(
        filtered(codexCells[tab]).filter((c) => mainPasses(c, tab, mainKey) && subPassesCell(c, tab, subKey)),
        tab,
      )
    : []
  const codexHit = isFactionPage
    ? factionEntries.reduce((n, g) => n + g.cells.length, 0)
    : isCodex ? groups.reduce((n, g) => n + g.cells.length, 0) : 0

  /** 左侧导航计数：图鉴类 = 条目数（搜索时显示命中数；**不含筛选**——筛选是当前页的临时收窄），说明类 = 词条数 */
  function navCount(t: Tab): number {
    if (t === 'guide') return GUIDE_GROUPS.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    if (t === 'rules') return RULE_SECTS.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    return codexCells[t].filter(hitCell).length
  }
  /** 当前页命中计数文案（搜索/筛选态与全量态） */
  const countText = (): string => {
    if (tab === 'guide' || tab === 'rules') {
      const n = navCount(tab)
      return q === '' ? `${n} ${COUNT_UNIT[tab]}` : tr("ui.Handbook.182", { n: n, p2: COUNT_UNIT[tab] })
    }
    return narrowed ? tr("ui.Handbook.183", { codexHit: codexHit, p2: COUNT_UNIT[tab] }) : `${codexHit} ${COUNT_UNIT[tab]}`
  }

  /* ── 列表视图：按分组渲染同一批卡片（沿用原有完整字段行） ── */
  function renderList(g: CellGroup): ReactNode {
    const ids = new Set(g.cells.map((c) => c.key))
    if (tab === 'items') {
      return (
        <ul className="app-hand-list">
          {engine.items
            .filter((item) => ids.has(item.id))
            .map((item) => {
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
                    <span className="app-chip is-dim">{kindTextOfItem(item)}</span>
                    <span className="app-dim"> · {item.unitM3} {tr("ui.Handbook.117")}</span>
                  </div>
                  <div className="app-dim">{item.description}</div>
                  {refine ? <div className="app-hand-sub">{tr("ui.Handbook.250")} {refine}</div> : null}
                </ItemHover>
              )
            })}
        </ul>
      )
    }
    if (tab === 'modules') {
      return (
        <ul className="app-hand-list">
          {engine.modules
            .filter((mod) => ids.has(mod.id))
            .map((mod) => (
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
      )
    }
    if (tab === 'ships') {
      return (
        <ul className="app-hand-list">
          {engine.ships
            .filter((ship) => ids.has(ship.id))
            .map((ship) => {
              const cls = shipCategoryKeyOf(ship)
              return (
                <ShipHover key={ship.id} as="li" ship={ship} className="app-hand-entry">
                  <div className="app-inv-name">
                    <RowGlyph glyph={cls} /> {ship.name}
                    <span className="app-chip is-dim">T{ship.tier}</span>
                    <span className={`app-chip app-role-chip is-${cls}`}>{roleName(cls)}</span>
                    {ship.priceIsk <= 0 ? <span className="app-chip">{tr("ui.Handbook.118")}</span> : null}
                  </div>
                  <div className="app-dim">
                    {tr("ui.ShipPage.019")} {ship.cargoM3.toLocaleString('zh-CN')} {tr("ui.ShipPage.020")} {ship.cycleSeconds} {tr("ui.ShipPage.021")} {ship.oreUnitsPerCycle}{' '}
                    {tr('ui.Handbook.012')} {Math.round(ship.agility * 100)}%
                  </div>
                  <div className="app-hand-sub">
                    <span className="app-combat-badges">{combatBadges(ship)}</span>
                    <span className="app-dim">{tr("ui.Handbook.318")}</span>
                  </div>
                  <div className="app-hand-sub">{ship.description}</div>
                </ShipHover>
              )
            })}
        </ul>
      )
    }
    if (tab === 'blueprints') {
      return (
        <ul className="app-hand-list">
          {engine.blueprints
            .filter((bp) => ids.has(bp.id))
            .map((bp) => {
              const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
              const isAmmo = bp.itemId !== undefined
              const product = isAmmo
                ? tr("ui.Handbook.109", { p1: engine.ctx.items.get(bp.itemId!)?.name ?? bp.itemId! })
                : tr("ui.Handbook.111", { p1: engine.ctx.modules.get(bp.moduleId!)?.name ?? bp.moduleId! })
              return (
                <InfoHover
                  key={bp.id}
                  as="li"
                  title={bp.name}
                  lines={[
                    { k: tr("ui.MarketPage.016"), v: product },
                    { k: tr("ui.MarketPage.018"), v: mats },
                    { k: tr("ui.MarketPage.019"), v: tr("ui.Handbook.119", { p1: (bp.buildSeconds / 60).toFixed(0) }) },
                  ]}
                  note={bp.description}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph="blueprint" /> {bp.name}
                  </div>
                  <div className="app-dim">{tr("ui.Handbook.013")}{product}</div>
                  <div className="app-hand-sub">
                    {tr("ui.Handbook.251")} {mats}{tr('ui.Handbook.324', { p: (bp.buildSeconds / 60).toFixed(0) })} {tr("ui.Handbook.120")}
                  </div>
                  <div className="app-dim">{bp.description}</div>
                </InfoHover>
              )
            })}
          {engine.shipBlueprints
            .filter((bp) => ids.has(bp.id))
            .map((bp) => {
              const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
              return (
                <InfoHover
                  key={bp.id}
                  as="li"
                  title={bp.name}
                  lines={[
                    { k: tr("ui.MarketPage.016"), v: tr("ui.Handbook.112", { p1: engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId }) },
                    { k: tr("ui.MarketPage.018"), v: mats },
                    { k: tr("ui.MarketPage.019"), v: tr("ui.Handbook.119", { p1: (bp.buildSeconds / 60).toFixed(0) }) },
                  ]}
                  note={bp.description}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph="blueprint" /> {bp.name}
                  </div>
                  <div className="app-dim">{tr("ui.Handbook.013")}{engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}{tr("ui.Handbook.319")}</div>
                  <div className="app-hand-sub">
                    {tr("ui.Handbook.251")} {mats}{tr('ui.Handbook.324', { p: (bp.buildSeconds / 60).toFixed(0) })} {tr("ui.Handbook.120")}
                  </div>
                  <div className="app-dim">{bp.description}</div>
                </InfoHover>
              )
            })}
        </ul>
      )
    }
    return (
      <ul className="app-hand-list">
        {engine.skills
          .filter((s) => ids.has(s.id))
          .map((s) => (
            <li key={s.id} className="app-hand-entry">
              <div className="app-inv-name">
                {s.name}
                <span className="app-chip is-dim">{tr("ui.Handbook.320")} {s.rank}</span>
              </div>
              <div className="app-dim">{plainSkillDesc(s.description)}</div>
            </li>
          ))}
      </ul>
    )
  }

  /** 页底翻页条（船长 2026-09-14 追加）：连着读完一章更顺；到头的那一侧留空位（保持按钮位置稳定） */
  function renderPager(): ReactNode {
    if (prevPage === null && nextPage === null) return null
    return (
      <div className="app-hand-pager">
        {prevPage !== null ? (
          <button className="app-btn is-small app-hand-pager-btn" onClick={() => setPageKey(prevPage.key)}>
            {tr("ui.Handbook.121")} {prevPage.label}
          </button>
        ) : (
          <span />
        )}
        {nextPage !== null ? (
          <button className="app-btn is-small app-hand-pager-btn" onClick={() => setPageKey(nextPage.key)}>
            {nextPage.label}{tr('ui.Handbook.323')}
          </button>
        ) : (
          <span />
        )}
      </div>
    )
  }

  /** 说明类页面：**一条解释 = 一页**（2026-09-14 船长：按词条分页 + 正文拆段，不再挤成一整段）
   *  上面子栏（`.app-hand-subnav`）选页；正文由 `.app-hand-para`（段首小标题 + 正文）堆成；页底可翻页。 */
  function renderPage(): ReactNode {
    if (onTips) {
      return (
        <div className="app-hand-guide">
          <div className="app-hand-sect">
            <div className="app-bay-title">{tr("ui.Handbook.114")}</div>
            <ul className="app-hand-notes">
              {GUIDE_NOTES.filter((n) => q === '' || n.toLowerCase().includes(q)).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          {renderPager()}
        </div>
      )
    }
    if (cur === null) {
      return <div className="app-dim app-inv-empty">{tr("ui.SkillsPage.006")}{query.trim()}{tr("ui.Handbook.122")}</div>
    }
    return (
      <div className="app-hand-guide">
        <div className="app-hand-sect">
          <div className="app-bay-title">{cur.g.title}</div>
          <div className="app-hand-cards">
            <div className="app-hand-card">
              <div className="app-hand-card-title">{cur.e.title}</div>
              {cur.e.paras.map(([head, body]) => (
                <div key={head + body} className="app-hand-para">
                  {head !== '' ? <div className="app-hand-para-head">{head}</div> : null}
                  <div className="app-hand-card-body">{body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {renderPager()}
      </div>
    )
  }

  const codexEmpty = isCodex && codexHit === 0

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-hand-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{tr("ui.Handbook.123")}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr("ui.App.086")}
          </button>
        </div>
        <div className="app-hand-split">
          {/* 左侧导航（2026-09-10 船长：顶部标签行改侧边导航） */}
          <nav className="app-hand-nav">
            {NAV.map((t) => (
              <button
                key={t.key}
                className={`app-hand-navitem${tab === t.key ? ' is-active' : ''}`}
                onClick={() => changeTab(t.key)}
              >
                <span>{t.label}</span>
                <span className="app-dim">{navCount(t.key)}</span>
              </button>
            ))}
          </nav>
          {/* 子页面导航（2026-09-14 船长：给「玩法速览 / 航行须知」的解释分页）
              组名作分组小标题、每个词条一个按钮；搜索时右侧显示该条命中段数、未命中置灰（搜索仍作用于整章）。 */}
          {tab === 'guide' || tab === 'rules' ? (
            <nav className="app-hand-subnav">
              {sects.map((g) => (
                <div key={g.title} className="app-hand-subgroup">
                  <div className="app-hand-subgroup-title">{g.title}</div>
                  {g.entries.map((e) => {
                    const hits = handEntryHits(e, q)
                    return (
                      <button
                        key={e.title}
                        className={`app-hand-subitem${cur?.e === e ? ' is-active' : ''}${hits === 0 ? ' is-dim' : ''}`}
                        onClick={() => setPageKey(e.title)}
                        title={hits === 0 ? tr("ui.Handbook.184") : undefined}
                      >
                        <span>{e.title}</span>
                        {q !== '' ? <span className="app-hand-subitem-hits">{hits}</span> : null}
                      </button>
                    )
                  })}
                </div>
              ))}
              {tab === 'guide' ? (
                <button
                  className={`app-hand-subitem app-hand-subsolo${onTips ? ' is-active' : ''}`}
                  onClick={() => setPageKey(TIPS_KEY)}
                >
                  <span>{tr("ui.Handbook.114")}</span>
                </button>
              ) : null}
            </nav>
          ) : null}
          <div className="app-hand-main">
            <div className="app-hand-topbar">
              <input
                className="app-head-search"
                type="search"
                placeholder={SEARCH_PLACEHOLDER[tab]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {/**
               * **图标 / 列表切换**（2026-09-13 船长加）——**势力图鉴不给**（**2026-09-26 船长令**：
               * 「**手册内，势力图鉴的图标和列表切换是多余的。而且有问题。**」）：
               * 那一页只有 6 张势力卡、点开才是内容，而"列表"档把卡片按列表行的排版走 ⇒ 观感是坏的。
               * 现在势力页**恒走卡片网格**；其余图鉴页的切换**原样保留**。
               */}
              {isCodex && !isFactionPage ? (
                <div className="app-hand-viewbar">
                  <button className={`app-hand-viewbtn${view === 'grid' ? ' is-active' : ''}`} onClick={() => changeView('grid')}>
                    {tr("ui.Handbook.015")}
                  </button>
                  <button className={`app-hand-viewbtn${view === 'list' ? ' is-active' : ''}`} onClick={() => changeView('list')}>
                    {tr("ui.Handbook.016")}
                  </button>
                </div>
              ) : null}
              <span className="app-dim">{countText()}</span>
            </div>
            {/* 图鉴筛选（2026-09-13 船长）：一级常显；**装备 / 舰船 / 蓝图**选了主类才出二级
                （「全部」时不占位，同组装机「全部标签不带子筛选」）；固定在列表上方不随滚动 */}
            {isCodex && mainOpts.length > 0 ? (
              <div className="app-fleet-toolbar app-hand-filters">
                <div className="app-fleet-row">
                  <span className="app-dim">{FILTER_LABEL[tab]}：</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={mainKey === SUB_ALL}
                      className={`app-tasktab${mainKey === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => pickMain(SUB_ALL)}
                    >
                      {tr("ui.IndustryPage.001")}
                    </button>
                    {mainOpts.map((o) => (
                      <button
                        key={o.key}
                        role="tab"
                        aria-selected={mainKey === o.key}
                        className={`app-tasktab${mainKey === o.key ? ' is-active' : ''}`}
                        onClick={() => pickMain(o.key)}
                      >
                        {subText(o)}
                      </button>
                    ))}
                  </div>
                </div>
                {subOpts.length > 0 ? (
                  <div className="app-fleet-row">
                    <span className="app-dim">{tr("ui.Handbook.252")}</span>
                    <div className="app-task-tabs app-fleet-tabs" role="tablist">
                      <button
                        role="tab"
                        aria-selected={subKey === SUB_ALL}
                        className={`app-tasktab${subKey === SUB_ALL ? ' is-active' : ''}`}
                        onClick={() => setSubKey(SUB_ALL)}
                      >
                        {tr("ui.IndustryPage.001")}
                      </button>
                      {subOpts.map((o) => (
                        <button
                          key={o.key}
                          role="tab"
                          aria-selected={subKey === o.key}
                          className={`app-tasktab${subKey === o.key ? ' is-active' : ''}`}
                          onClick={() => setSubKey(o.key)}
                        >
                          {subText(o)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="app-hand-scroll">
              {tab === 'guide' || tab === 'rules' ? renderPage() : null}
              {isCodex ? (
                codexEmpty ? (
                  <div className="app-dim app-inv-empty">
                    {q !== ''
                      ? tr("ui.Handbook.253", { p1: query.trim() })
                      : tr("ui.Handbook.185")}
                  </div>
                ) : (
                  isFactionPage ? (
                    factionEntries.map((g) => (
                      <div key={g.key}>
                        <GroupSection key={g.key} label={subText(g)} unit={COUNT_UNIT[tab]} count={g.cells.length}>
                          {/* 势力页**恒走卡片网格**（2026-09-26 船长令：「图标和列表切换是多余的。而且有问题」）
                              —— 原先那支列表档把卡片按 `.app-inv-row` 排版，观感是坏的，已整支删除 */}
                          <IconGrid cells={g.cells} onPick={(c) => setFactionSel(c.key)} />
                        </GroupSection>
                        {/* 下方**窗口容器**：选中势力的档案 ＋ 敌人种类 ＋ 专属装备 / 舰船 / 图纸 */}
                        {g.cells.some((c) => c.key === factionSel) ? (
                          <FactionDetailPanel engine={engine} family={factionSel} />
                        ) : null}
                      </div>
                    ))
                  ) : groups.map((g) => (
                    <GroupSection key={g.key} label={subText(g)} unit={COUNT_UNIT[tab]} count={g.cells.length}>
                      {view === 'grid' ? (
                        <IconGrid cells={g.cells} onPick={setDetail} />
                      ) : (
                        renderList(g)
                      )}
                    </GroupSection>
                  ))
                )
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {detail !== null ? (
        <CellDetail engine={engine} cell={detail} onClose={() => setDetail(null)} onGotoMarket={onGotoMarket} />
      ) : null}
    </div>
  )
}
