import { useState } from 'react'
import type { ReactNode } from 'react'
import { shipCategoryKeyOf, visibleItemDefs } from '@whale/core'
import type { FoeShipDef, ShipRole } from '@whale/core'
import { buildFactionCards, FACTION_CODEX_ORDER, FOE_SHIPS } from '@whale/data'
import { Panel } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { Glyph } from '../ui/Glyphs'
import { FOE_ACCENT, toneOfAny } from '../ui/tones'
import {
  BLUEPRINT_SUBS,
  ITEM_CODEX_SUBS,
  CONSUME_SUBS,
  MODULE_SUBS,
  RACK_SUBS,
  SHIP_DOMAIN_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  SUBS_OF_KIND,
  itemBucketPasses,
  itemCategoryOf,
  itemSubPasses,
  moduleSubKeyOf,
  presentSubs,
  rackDimKeyOf,
  shipRolePasses,
  shipTierPasses,
  subText,
} from '../ui/itemSubs'
import type { SubOption } from '../ui/itemSubs'
import { RowGlyph } from '../ui/itemView'
import { itemGlyphName } from '../ui/Glyphs'
import { combatBadges, InfoHover, ItemHover, ModuleHover, moduleShortEffect, ShipHover } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'
import { foeBriefLinesOfShip } from '../ui/foeBrief'
import { tr } from '../i18n/locale'
import { kindTextOfItem, skillGroupText } from '../ui/labelsText'
import { crestLabelOf } from '../ui/labelsText'
import { ShipSprite } from '../ui/ShipSprite'
import { slotName, roleName, CellDetail, GroupSection, moduleCellOf, shipCellOf, itemCellOf, blueprintCellOf, shipBlueprintCellOf } from './handbookDetail'
import { handbookContentOrderOf } from '../ui/handbookOrder'

type Tab = 'guide' | 'rules' | 'exchange' | 'items' | 'modules' | 'ships' | 'blueprints' | 'skills' | 'factions'
type DetailTab = Tab | 'foe'
type CodexTab = 'items' | 'modules' | 'ships' | 'blueprints' | 'skills' | 'factions'
type ViewMode = 'grid' | 'list'
export type RawData = Record<string, unknown>

const FACTION_NAME_BASE: Record<string, number> = { A: 326, C: 335, D: 344, E: 353, G: 362, H: 371, R: 381 }

function FactionDetailPanel({ engine, family }: { engine: GameEngine; family: string }) {
  const ships = collectFoeShips(engine)
  const card = buildFactionCards(FOE_SHIPS, engine.state.foeShipSeen).find((c) => c.family === family)
  if (!card) return null
  const base = FACTION_NAME_BASE[family] ?? 326
  const [detail, setDetail] = useState<GridCell | null>(null)
  const enemyCells: GridCell[] = card.enemies.map((e) => {
    const ship = e.seen ? ships.get(e.id) : undefined
    const line = ship !== undefined ? foeBriefLinesOfShip(ship) : null
    const sub = line !== null ? [line.hull, ...line.bits].filter((x) => x !== '').join(' · ') : tr('ui.codex.010')
    return {
      key: e.id,
      tab: 'foe',
      glyph: e.seen ? 'ico-tact' : 'signal-lost',
      ...(ship !== undefined ? { tone: FOE_ACCENT[family] } : {}),
      name: e.seen ? (ship?.name ?? e.id) : tr('ui.codex.005'),
      sub,
      subWrap: true,
      raw: (ship ?? { id: e.id, name: e.id, hullClassTier: 1, split: { s: 0, a: 0, h: 0 } }) as unknown as RawData,
      ...(ship !== undefined ? { shipId: ship.id } : {}),
    }
  })
  const exclusiveModuleCells: GridCell[] = handbookContentOrderOf(card.modules, id => id).flatMap((id) => {
    const mod = engine.ctx.modules.get(id)
    if (mod !== undefined) return [moduleCellOf(mod)]
    const item = engine.ctx.items.get(id)
    return item !== undefined ? [itemCellOf(item)] : []
  })
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
      hint={
        <span style={{ color: FOE_ACCENT[family], marginLeft: 6, verticalAlign: '-2px' }} aria-hidden="true">
          <Glyph name={`fam-${family.toLowerCase()}`} size={13} color="currentColor" />
        </span>
      }
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
  const put = (s: FoeShipDef | null | undefined, mounts = s?.mounts): void => {
    if (!s) return
    const previous = out.get(s.id)
    out.set(s.id, { ...(previous ?? s), mounts: [...new Set([...(previous?.mounts ?? []), ...(mounts ?? [])])] })
  }
  for (const card of engine.ctx.anomalies.values()) for (const slot of card.ships ?? []) put(slot?.ship, slot.mounts ?? slot.ship.mounts)
  for (const s of FOE_SHIPS) if (!out.has(s.id)) put(s)
  return out
}

const NAV: Array<{ key: Tab; label: string }> = [
  { key: 'guide', get label() { return tr("ui.Handbook.186") } },
  { key: 'rules', get label() { return tr("ui.Handbook.187") } },
  { key: 'items', get label() { return tr("ui.Handbook.188") } },
  { key: 'modules', get label() { return tr("ui.Handbook.254") } },
  { key: 'ships', get label() { return tr("ui.Handbook.189") } },
  { key: 'blueprints', get label() { return tr("ui.Handbook.255") } },
  { key: 'factions', get label() { return tr("ui.codex.001") } },
  { key: 'skills', get label() { return tr("ui.Handbook.124") } },
  { key: 'exchange', get label() { return tr("ui.Handbook.424") } },
]
const SEARCH_PLACEHOLDER: Record<Tab, string> = {
  get guide() { return tr("ui.Handbook.125") },
  get rules() { return tr("ui.Handbook.126") },
  get exchange() { return tr("ui.Handbook.425") },
  get items() { return tr("ui.Handbook.127") },
  get modules() { return tr("ui.Handbook.128") },
  get ships() { return tr("ui.Handbook.129") },
  get blueprints() { return tr("ui.Handbook.130") },
  get factions() { return tr("ui.codex.002") },
  get skills() { return tr("ui.Handbook.131") },
}
const COUNT_UNIT: Record<Tab, string> = {
  get guide() { return tr("ui.Handbook.190") },
  get rules() { return tr("ui.Handbook.190") },
  get exchange() { return tr("ui.Handbook.190") },
  get items() { return tr("ui.Handbook.191") },
  get modules() { return tr("ui.MarketPage.117") },
  get ships() { return tr("ui.MarketPage.116") },
  get blueprints() { return tr("ui.Handbook.017") },
  get factions() { return tr("ui.Handbook.190") },
  get skills() { return tr("ui.Handbook.256") },
}
const VIEW_KEY = 'whale-idle:handbook-view'

const BP_MAIN: SubOption[] = [
  { key: 'equip', get label() { return tr("ui.ShipPage.115") } },
  { key: 'ship', get label() { return tr("ui.ShipPage.116") } },
  { key: 'consume', get label() { return tr("ui.ShipPage.114") } },
  { key: 'part', get label() { return tr("ui.Handbook.265") } },
]
const FILTER_LABEL: Record<Tab, string> = {
  guide: '',
  rules: '',
  exchange: '',
  get items() { return tr("ui.Handbook.003") },
  get modules() { return tr("ui.Handbook.192") },
  get ships() { return tr("ui.Handbook.193") },
  get blueprints() { return tr("ui.Handbook.257") },
  factions: '',
  get skills() { return tr("ui.Handbook.132") },
}

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}


interface HandEntry {
  title: string
  paras: Array<[string, string]>
}

interface HandGroup {
  title: string
  entries: HandEntry[]
}

function handEntryHits(e: HandEntry, q: string): number {
  if (q === '') return 1
  if (e.title.toLowerCase().includes(q)) return e.paras.length
  return e.paras.filter(([, t]) => t.toLowerCase().includes(q)).length
}

function guideGroupsOf(): HandGroup[] { return [
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
          [tr("ui.Handbook.018"), `${tr('core.departure.001')} → ${tr('core.departure.002')} → ${tr('ui.invasionActivity.003')}`],
          [tr("ui.Handbook.028"), tr("ui.Handbook.140")],
          [tr("ui.Handbook.262"), tr('core.departure.003')],
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

}

function exchangeGroupsOf(): HandGroup[] { return [
  {
    title: tr("ui.Handbook.390"),
    entries: [
      {
        title: tr("ui.Handbook.391"),
        paras: [
          [tr("ui.Handbook.392"), tr("ui.Handbook.393")],
          [tr("ui.Handbook.394"), tr("ui.Handbook.395")],
        ],
      },
      {
        title: tr("ui.Handbook.462"),
        paras: [
          [tr("ui.Handbook.463"), tr("ui.Handbook.464")],
          [tr("ui.Handbook.465"), tr("ui.Handbook.466")],
          [tr("ui.Handbook.467"), tr("ui.Handbook.468")],
        ],
      },
      {
        title: tr("ui.Handbook.426"),
        paras: [
          [tr("ui.Handbook.427"), tr("ui.Handbook.428")],
          [tr("ui.Handbook.434"), tr("ui.Handbook.435")],
        ],
      },
      {
        title: tr("ui.Handbook.396"),
        paras: [
          [tr("ui.Handbook.397"), tr("ui.Handbook.398")],
          [tr("ui.Handbook.399"), tr("ui.Handbook.400")],
        ],
      },
      {
        title: tr("ui.Handbook.429"),
        paras: [
          [tr("ui.Handbook.430"), tr("ui.Handbook.431")],
          [tr("ui.Handbook.432"), tr("ui.Handbook.433")],
        ],
      },
      {
        title: tr("ui.Handbook.403"),
        paras: [
          [tr("ui.Handbook.404"), tr("ui.Handbook.405")],
          [tr("ui.Handbook.406"), tr("ui.Handbook.407")],
        ],
      },
      {
        title: tr("ui.Handbook.417"),
        paras: [
          [tr("ui.Handbook.418"), tr("ui.Handbook.419")],
          [tr("ui.Handbook.401"), tr("ui.Handbook.402")],
          [tr("ui.Handbook.436"), tr("ui.Handbook.437")],
          [tr("ui.Handbook.420"), tr("ui.Handbook.421")],
        ],
      },
      {
        title: tr("ui.Handbook.408"),
        paras: [
          [tr("ui.Handbook.409"), tr("ui.Handbook.410")],
          [tr("ui.Handbook.411"), tr("ui.Handbook.412")],
          [tr("ui.Handbook.413"), tr("ui.Handbook.414")],
          [tr("ui.Handbook.415"), tr("ui.Handbook.416")],
        ],
      },
      {
        title: tr("ui.Handbook.441"),
        paras: [
          [tr("ui.Handbook.442"), tr("ui.Handbook.443")],
          [tr("ui.Handbook.422"), tr("ui.Handbook.423")],
          [tr("ui.Handbook.444"), tr("ui.Handbook.445")],
        ],
      },
      {
        title: tr("ui.Handbook.453"),
        paras: [
          [tr("ui.Handbook.454"), tr("ui.Handbook.455")],
          [tr("ui.Handbook.456"), tr("ui.Handbook.457")],
          [tr("ui.Handbook.458"), tr("ui.Handbook.459")],
          [tr("ui.Handbook.460"), tr("ui.Handbook.461")],
        ],
      },
      {
        title: tr("ui.Handbook.446"),
        paras: [
          [tr("ui.Handbook.447"), tr("ui.Handbook.448")],
          [tr("ui.Handbook.449"), tr("ui.Handbook.450")],
          [tr("ui.Handbook.451"), tr("ui.Handbook.452")],
        ],
      },
    ],
  },
] }

const TIPS_KEY = '__tips'
const guideNotesOf = (): string[] => [
  tr("ui.Handbook.164"),
  tr("ui.Handbook.219"),
  tr("ui.Handbook.220"),
]


const ruleGroupsOf = (): HandGroup[] => [
  {
    get title() { return tr("ui.Handbook.064") },
    entries: [
      {
        get title() { return tr("ui.Handbook.065") },
        paras: [
          [tr("ui.Handbook.221"), tr("ui.Handbook.222")],
          [tr("ui.Handbook.066"), tr("ui.Handbook.165")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.067") },
        paras: [
          [tr("ui.Handbook.068"), tr("ui.Handbook.069")],
          [tr("ui.MapPage.006"), tr("ui.Handbook.280")],
          [tr("ui.Handbook.042"), tr("ui.Handbook.070")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.166") },
        paras: [
          [tr("ui.Handbook.281"), tr("ui.Handbook.167")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.282") },
        paras: [
          [tr("ui.Handbook.071"), tr("ui.Handbook.283")],
          [tr("ui.Handbook.072"), tr("ui.Handbook.284")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.073") },
        paras: [
          [tr("ui.Handbook.223"), tr("ui.Handbook.285")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.224") },
        paras: [
          [tr("ui.Handbook.225"), tr("ui.Handbook.226")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.227") },
        paras: [
          [tr("ui.Handbook.074"), tr("ui.Handbook.075")],
          [tr("ui.Handbook.076"), tr("ui.Handbook.168")],
          [tr("ui.Handbook.286"), tr("ui.Handbook.287")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.169") },
        paras: [
          [tr("ui.Handbook.077"), tr("ui.Handbook.288")],
          [tr("ui.Handbook.078"), tr("ui.Handbook.228")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.289") },
        paras: [
          [tr("ui.Handbook.290"), tr("ui.Handbook.079")],
        ],
      },
    ],
  },
  {
    get title() { return tr("ui.Handbook.291") },
    entries: [
      {
        get title() { return tr("ui.Handbook.292") },
        paras: [
          [tr("ui.Handbook.080"), tr("ui.Handbook.293")],
          [tr("ui.Handbook.014"), tr("ui.Handbook.081")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.294") },
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.229")],
          [tr("ui.Handbook.082"), tr("ui.Handbook.295")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.083") },
        paras: [
          [tr("ui.Handbook.084"), tr("ui.Handbook.085")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.296") },
        paras: [
          [tr("ui.Handbook.297"), tr("ui.Handbook.298")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.299") },
        paras: [
          [tr("ui.Handbook.086"), tr("ui.Handbook.170")],
          [tr("ui.ShipPage.013"), tr("ui.Handbook.171")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.300") },
        paras: [
          [tr("ui.Handbook.087"), tr("ui.Handbook.088")],
          [tr("ui.Handbook.301"), tr("ui.Handbook.172")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.230") },
        paras: [
          [tr("ui.Handbook.057"), tr("ui.Handbook.231")],
          [tr("ui.Handbook.089"), tr("ui.Handbook.173")],
          [tr("ui.Handbook.232"), tr("ui.Handbook.302")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.233") },
        paras: [
          [tr("ui.Handbook.090"), tr("ui.Handbook.234")],
        ],
      },
    ],
  },
  {
    get title() { return tr("ui.Handbook.091") },
    entries: [
      {
        get title() { return tr("ui.Handbook.303") },
        paras: [
          [tr("ui.Handbook.092"), tr("ui.Handbook.235")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.093") },
        paras: [
          [tr("ui.BattleScreen.002"), tr("ui.Handbook.174")],
          [tr("ui.battleViewCore.001"), tr("ui.Handbook.236")],
          [tr("ui.battleViewCore.002"), tr("ui.Handbook.237")],
          [tr("ui.Handbook.238"), tr("ui.Handbook.175")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.176") },
        paras: [
          [tr("ui.Handbook.304"), tr("ui.Handbook.177")],
          [tr("ui.Handbook.094"), tr("ui.Handbook.239")],
        ],
      },
    ],
  },
  {
    get title() { return tr("ui.MatterTechTab.001") },
    entries: [
      {
        get title() { return tr("ui.Handbook.305") },
        paras: [
          [tr("ui.Handbook.095"), tr("ui.Handbook.306")],
          [tr("ui.Handbook.096"), tr("ui.Handbook.097")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.098") },
        paras: [
          [tr("ui.Handbook.099"), tr("ui.Handbook.178")],
          [tr("ui.Handbook.307"), tr("ui.Handbook.240")],
          [tr("ui.Handbook.308"), tr("ui.Handbook.309")],
          [tr("ui.Handbook.062"), tr("ui.Handbook.310")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.100") },
        paras: [
          [tr("ui.Handbook.198"), tr("ui.Handbook.311")],
          [tr("ui.Handbook.312"), tr("ui.Handbook.313")],
        ],
      },
      {
        get title() { return tr("ui.Handbook.314") },
        paras: [
          [tr("ui.Handbook.101"), tr("ui.Handbook.241")],
          [tr("ui.Handbook.179"), tr("ui.Handbook.242")],
        ],
      },
    ],
  },
  {
    get title() { return tr("ui.Handbook.243") },
    entries: [
      {
        get title() { return tr("ui.Handbook.102") },
        paras: [
          [tr("ui.Handbook.103"), tr("ui.Handbook.104")],
          [tr("ui.Handbook.244"), tr("ui.Handbook.245")],
          [tr("ui.Handbook.180"), tr("ui.Handbook.105")],
        ],
      },
    ],
  },
]


export interface GridCell {
  key: string
  tab: DetailTab
  glyph: string
  tone?: string
  name: string
  sub: string
  raw: RawData
  rarity?: number
  faction?: string
  crest?: string
  shipId?: string
  shipRole?: ShipRole
  subWrap?: boolean
}

interface CellGroup {
  key: string
  label: string
  id?: string
  idParam?: string
  cells: GridCell[]
}

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

function IconGrid({ cells, onPick, selectedKey }: { cells: GridCell[]; onPick: (c: GridCell) => void; selectedKey?: string }) {
  return (
    <div className="app-hand-grid">
      {cells.map((c) => {
        /* 色调：显式 `tone` 优先（势力卡 / 势力详情敌人卡 = 族色），否则按图标键跨表取色
           （`toneOfAny`：TONES → ICO_TONES → NAV_TONES）—— 详见 `ui/tones.ts` 的报障注释 */
        const tone = c.tone ?? toneOfAny(c.glyph)
        const selected = selectedKey !== undefined && c.key === selectedKey
        return (
          <button
            key={c.key}
            className="app-hand-cell"
            onClick={() => onPick(c)}
            aria-current={selected ? 'true' : undefined}
            /* `position: relative`：族徽与稀有度两枚角标都绝对定位（内联样式，不新增 CSS 类） */
            style={{
              '--tone': tone,
              position: 'relative',
              ...(selected ? { boxShadow: `inset 0 0 0 1px ${tone}` } : {}),
            } as React.CSSProperties}
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
             * ⚠ 判据用 `!= null`（**同时挡掉 `null` 与 `undefined`**）：`crest` 曾经漏进过 `null`
             * ⇒ 整页 `toLowerCase` 崩（2026-09-27 船长报障）。构造侧已由 `crestFamOf()` 收窄，
             * 这里再兜一层 —— 画不出角标可以，**白屏不行**。
             *
             * 与右上角那枚稀有度标签**同一套绝对定位语言**（`top/left: 3px` ＋ 小圆角 ＋ 同族色），
             * 徽记用已有的 `fam-a/c/d/e/g/h` 线稿（`Glyph`）。
             *
             * ⚠ **颜色取 `FOE_ACCENT[族]`（族色单点），不再用 `toneOf('fam-x')`**——那张表查不到
             * `fam-*` 键、返回兜底灰，而且内联色会**压掉** `.app-map-famchip.is-fam-X` 的类色 ⇒
             * 上一批实测这枚角标是灰的（族色没上上去）。顺带解决 **H 族（墨潮帮）没有 `is-fam-H` 类**
             * 的历史缺口（走 FOE_ACCENT 后八个族一视同仁）。
             * `aria-label` 用**势力全称**（`FACTION_CODEX` 的 `nameId`，随语言）而不是族字母——
             * 读屏读「势力 A 专属」等于没读；同时守住"**不许只靠颜色传达信息**"（色盲/读屏照样拿到归属）。
             */}
            {c.crest != null ? (
              <span
                className={`app-map-famchip is-fam-${c.crest}`}
                aria-label={crestLabelOf(c.crest)}
                style={{ position: 'absolute', top: 3, left: 3, zIndex: 1, color: FOE_ACCENT[c.crest] ?? tone, pointerEvents: 'none' }}
              >
                <Glyph name={`fam-${c.crest.toLowerCase()}`} size={13} color="currentColor" />
              </span>
            ) : null}
            {/* 稀有度小标签（2026-09-20 船长）：与仓库/货仓图标模式同一语言 */}
            {c.rarity !== undefined ? (
              <span className={`app-hand-cell-rarity is-r${c.rarity}`} aria-label={tr('ui.itemView.001', { p1: c.rarity })}>
                R{c.rarity}
              </span>
            ) : null}
            <span className="app-hand-cell-name">{c.name}</span>
            {/* 副行：默认单行省略号（`.app-hand-cell-sub`）；带 `subWrap` 的卡给两行（敌舰卡的副行长） */}
            <span
              className="app-hand-cell-sub"
              style={
                c.subWrap === true
                  ? { whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                  : undefined
              }
            >
              {c.sub}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Handbook({
  engine,
  onClose,
  onGotoMarket,
}: {
  engine: GameEngine
  onClose: () => void
  onGotoMarket?: (goodKey: string) => void
}) {
  const [tab, setTab] = useState<Tab>('guide')
  const [view, setView] = useState<ViewMode>(readView)
  const [detail, setDetail] = useState<GridCell | null>(null)
  const [query, setQuery] = useState('')
  const [mainKey, setMainKey] = useState<string>(SUB_ALL)
  const [subKey, setSubKey] = useState<string>(SUB_ALL)
  const [pageKey, setPageKey] = useState<string>('')
  const [factionSel, setFactionSel] = useState<string>(FACTION_CODEX_ORDER[0] ?? 'A')

  function changeView(v: ViewMode): void {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
    }
  }
  function changeTab(t: Tab): void {
    setTab(t)
    setDetail(null)
    setMainKey(SUB_ALL)
    setSubKey(SUB_ALL)
    setPageKey('')
  }
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
  const guideGroups = guideGroupsOf()
  const RULE_SECTS = ruleGroupsOf()
  const EXCHANGE_SECTS = exchangeGroupsOf()
  const guideNotes = guideNotesOf()
  const sects: HandGroup[] =
    tab === 'guide' ? guideGroups : tab === 'rules' ? RULE_SECTS : tab === 'exchange' ? EXCHANGE_SECTS : []
  const flat = sects.flatMap((g) => g.entries.map((e) => ({ g, e })))
  const matched = flat.filter((x) => handEntryHits(x.e, q) > 0)
  const onTips = tab === 'guide' && pageKey === TIPS_KEY
  const cur = onTips ? null : (matched.find((x) => x.e.title === pageKey) ?? matched[0] ?? null)
  const tipsHit = q === '' || guideNotes.some((n) => n.toLowerCase().includes(q))
  const pageSeq: Array<{ key: string; label: string }> = [
    ...matched.map((x) => ({ key: x.e.title, label: x.e.title })),
    ...(tab === 'guide' && tipsHit ? [{ key: TIPS_KEY, label: tr("ui.Handbook.114") }] : []),
  ]
  const pageIdx = pageSeq.findIndex((p) => p.key === (onTips ? TIPS_KEY : (cur?.e.title ?? '')))
  const prevPage = pageIdx > 0 ? pageSeq[pageIdx - 1]! : null
  const nextPage = pageIdx >= 0 && pageIdx < pageSeq.length - 1 ? pageSeq[pageIdx + 1]! : null

  const orderedItems = handbookContentOrderOf(visibleItemDefs(engine.ctx), item => item.id)
  const orderedModules = handbookContentOrderOf(engine.modules, mod => mod.id)
  const itemCells: GridCell[] = orderedItems.map((item) => itemCellOf(item))
  const itemNameOf = (id: string): string | undefined => engine.ctx.items.get(id)?.name
  const moduleCells: GridCell[] = orderedModules.map((mod) => moduleCellOf(mod))
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
    sub: tr("ui.Handbook.115", { p1: skillGroupText(s.group), p2: s.rank }),
    raw: s as unknown as RawData,
  }))

  const filtered = (cells: GridCell[]): GridCell[] => cells.filter(hitCell)
  const showCells = (cells: GridCell[], t: Tab): CellGroup[] => groupCells(cells, groupKeyOf, orderOf(t))
  function groupKeyOf(c: GridCell): string {
    if (c.tab === 'items') return itemCategoryOf({ kind: String(c.raw.kind ?? '') })
    if (c.tab === 'modules') return moduleSubKeyOf(String(c.raw.slot ?? ''), String(c.raw.id ?? ''))
    if (c.tab === 'ships') return SHIP_DOMAIN_SUBS.find((s) => shipRolePasses(engine.ctx.ships.get(c.key), s.key))?.key ?? 'other'
    if (c.tab === 'blueprints') {
      if (c.raw.shipId !== undefined) {
        const ship = engine.ctx.ships.get(String(c.raw.shipId))
        return ship ? `t${ship.tier}` : ''
      }
      if (c.raw.itemId !== undefined) {
        return engine.ctx.items.get(String(c.raw.itemId))?.kind === 'part' ? 'part-advanced' : 'supply'
      }
      const mod = engine.ctx.modules.get(String(c.raw.moduleId ?? ''))
      return mod ? rackDimKeyOf(mod) : ''
    }
    return String(c.raw.group ?? '')
  }
  function orderOf(t: Tab): readonly { key: string; label: string; id?: string; idParam?: string }[] {
    if (t === 'items') return ITEM_CODEX_SUBS
    if (t === 'modules')
      return MODULE_SUBS.map(
        (s): { key: string; label: string; id?: string; idParam?: string } => ({
          key: s.key,
          label: s.label,
          id: s.id,
          idParam: s.idParam,
        }),
      ).concat([{ key: '', label: tr("ui.Handbook.116") }])
    if (t === 'ships') return SHIP_DOMAIN_SUBS
    if (t === 'blueprints')
      return BLUEPRINT_SUBS.map(
        (s): { key: string; label: string; id?: string; idParam?: string } => ({
          key: s.key,
          label: s.label,
          id: s.id,
          idParam: s.idParam,
        }),
      ).concat([{ key: '', label: tr("ui.Handbook.116") }])
    return engine.groups.map((g) => ({ key: g, label: skillGroupText(g) }))
  }

  const isFactionPage = tab === 'factions'
  const factionCells: GridCell[] = (() => {
        const ships = collectFoeShips(engine)
        return buildFactionCards(FOE_SHIPS, engine.state.foeShipSeen).map((card) => {
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
            tone: FOE_ACCENT[card.family],
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


  function mainCandidatesOf(t: CodexTab): readonly SubOption[] {
    if (t === 'items') return ITEM_CODEX_SUBS
    if (t === 'modules') return RACK_SUBS
    if (t === 'ships') return SHIP_DOMAIN_SUBS
    if (t === 'blueprints') return BP_MAIN
    return engine.groups.map((g) => ({ key: g, label: skillGroupText(g) }))
  }
  function mainOptions(t: CodexTab): SubOption[] {
    return presentSubs(mainCandidatesOf(t), (key) => codexCells[t].some((c) => mainPasses(c, t, key)))
  }
  function subCandidatesOf(t: CodexTab, main: string): readonly SubOption[] {
    if (t === 'modules') return MODULE_SUBS
    if (t === 'ships') return SHIP_TIER_SUBS
    if (t === 'items') return SUBS_OF_KIND[main] ?? []
    if (t === 'blueprints') {
      if (main === 'equip') return RACK_SUBS
      if (main === 'ship') return SHIP_TIER_SUBS
      if (main !== 'consume') return []
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
  function subOptions(t: CodexTab, main: string): SubOption[] {
    if (main === SUB_ALL) return []
    return presentSubs(subCandidatesOf(t, main), (key) =>
      codexCells[t].some((c) => mainPasses(c, t, main) && subPassesCell(c, t, key)),
    )
  }
  function mainPasses(c: GridCell, t: Tab, main: string): boolean {
    if (main === SUB_ALL) return true
    if (t === 'items') return itemBucketPasses(engine.ctx, c.key, main)
    if (t === 'modules') return itemBucketPasses(engine.ctx, c.key, `module-${main}`)
    if (t === 'ships') return shipRolePasses(engine.ctx.ships.get(c.key), main)
    if (t === 'blueprints') {
      if (c.raw.shipId !== undefined) return main === 'ship'
      if (c.raw.itemId !== undefined) {
        const kind = engine.ctx.items.get(String(c.raw.itemId))?.kind
        return main === (kind === 'part' ? 'part' : 'consume')
      }
      return main === 'equip'
    }
    return String(c.raw.group ?? '') === main
  }
  function subPassesCell(c: GridCell, t: Tab, sub: string): boolean {
    if (sub === SUB_ALL) return true
    if (t === 'items') return itemSubPasses(engine.ctx, c.key, itemCategoryOf({ kind: String(c.raw.kind ?? '') }), sub)
    if (t === 'modules') return itemSubPasses(engine.ctx, c.key, 'module', sub)
    if (t === 'ships') return shipTierPasses(engine.ctx.ships.get(c.key), sub)
    if (t === 'blueprints') {
      if (c.raw.shipId !== undefined) {
        const ship = engine.ctx.ships.get(String(c.raw.shipId))
        return ship !== undefined && `t${ship.tier}` === sub
      }
      if (c.raw.itemId !== undefined) {
        const it = engine.ctx.items.get(String(c.raw.itemId))
        return it !== undefined && it.kind === sub
      }
      const mod = engine.ctx.modules.get(String(c.raw.moduleId ?? ''))
      return mod !== undefined && rackDimKeyOf(mod) === sub
    }
    return true
  }

  const mainOpts = isCodex ? mainOptions(tab) : []
  const subOpts = isCodex ? subOptions(tab, mainKey) : []
  const narrowed = q !== '' || mainKey !== SUB_ALL || subKey !== SUB_ALL
  function factionHit(c: GridCell): boolean {
    if (!hitCell(c)) return false
    if (q === '') return true
    const extra = String((c as { hits?: string }).hits ?? '').toLowerCase()
    return extra.includes(q) || c.name.toLowerCase().includes(q)
  }
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

  function navCount(t: Tab): number {
    if (t === 'guide') return guideGroups.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    if (t === 'rules') return RULE_SECTS.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    if (t === 'exchange') return EXCHANGE_SECTS.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    return codexCells[t].filter(hitCell).length
  }
  const countText = (): string => {
    if (tab === 'guide' || tab === 'rules' || tab === 'exchange') {
      const n = navCount(tab)
      return q === '' ? `${n} ${COUNT_UNIT[tab]}` : tr("ui.Handbook.182", { n: n, p2: COUNT_UNIT[tab] })
    }
    return narrowed ? tr("ui.Handbook.183", { codexHit: codexHit, p2: COUNT_UNIT[tab] }) : `${codexHit} ${COUNT_UNIT[tab]}`
  }

  function renderList(g: CellGroup): ReactNode {
    const ids = new Set(g.cells.map((c) => c.key))
    if (tab === 'items') {
      return (
        <ul className="app-hand-list">
          {orderedItems
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
                    {/* 图标走**物品 id 单点映射**（2026-09-30 船长报障：图鉴里新道具还是通用图标） */}
                    <RowGlyph glyph={itemGlyphName(item.id, item.kind)} /> {item.name}
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
          {orderedModules
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

  function renderPage(): ReactNode {
    if (onTips) {
      return (
        <div className="app-hand-guide">
          <div className="app-hand-sect">
            <div className="app-bay-title">{tr("ui.Handbook.114")}</div>
            <ul className="app-hand-notes">
              {guideNotes.filter((n) => q === '' || n.toLowerCase().includes(q)).map((n) => (
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
          {tab === 'guide' || tab === 'rules' || tab === 'exchange' ? (
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
                aria-label={SEARCH_PLACEHOLDER[tab]}
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
                  {/* `aria-pressed`（2026-09-26 优化批）：选中态此前只有 `.is-active` 类 ⇒ 读屏读不出"当前是哪一档" */}
                  <button
                    className={`app-hand-viewbtn${view === 'grid' ? ' is-active' : ''}`}
                    aria-pressed={view === 'grid'}
                    onClick={() => changeView('grid')}
                  >
                    {tr("ui.Handbook.015")}
                  </button>
                  <button
                    className={`app-hand-viewbtn${view === 'list' ? ' is-active' : ''}`}
                    aria-pressed={view === 'list'}
                    onClick={() => changeView('list')}
                  >
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
                          {/* 消耗品桶含「道具逐件档」，档名 = 那件道具自己的名字（2026-10-02 船长令） */}
                          {subText(o, itemNameOf)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="app-hand-scroll">
              {tab === 'guide' || tab === 'rules' || tab === 'exchange' ? renderPage() : null}
              {isCodex ? (
                codexEmpty ? (
                  /**
                   * **空态**（2026-09-26 优化批 · 船长批「4 可以」）：此前只写一句"没有条目"就完了——
                   * 玩家得自己回想是在哪一格筛选/搜索里卡住的（技能条目 No Results：「死胡同最劝退」）。
                   * 现在补一枚**一次归零**的按钮：关键词 + 一级分类 + 二级分类（三处一起清；
                   * 「切页归零、关键词跨页保留」那套口径不变，本按钮只在"清"的方向上动）。
                   */
                  <div className="app-dim app-inv-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                    <span>{q !== '' ? tr("ui.Handbook.253", { p1: query.trim() }) : tr("ui.Handbook.185")}</span>
                    <button
                      className="app-btn is-small"
                      onClick={() => {
                        setQuery('')
                        setMainKey(SUB_ALL)
                        setSubKey(SUB_ALL)
                      }}
                    >
                      {tr("ui.Handbook.380")}
                    </button>
                  </div>
                ) : (
                  isFactionPage ? (
                    factionEntries.map((g) => (
                      <div key={g.key}>
                        <GroupSection key={g.key} label={subText(g)} unit={COUNT_UNIT[tab]} count={g.cells.length}>
                          {/* 势力页**恒走卡片网格**（2026-09-26 船长令：「图标和列表切换是多余的。而且有问题」）
                              —— 原先那支列表档把卡片按 `.app-inv-row` 排版，观感是坏的，已整支删除 */}
                          <IconGrid cells={g.cells} onPick={(c) => setFactionSel(c.key)} selectedKey={factionSel} />
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
