/**
 * 工业面板：蓝图书架 + 组装机（2026-09-08 与精炼炉完全同款劳动者制：主控亲自/AI 核心驱动；
 * 同一蓝图可同时开多条线、不同蓝图不限，皆受劳动者约束——每条线独立进度与取消，可随时加开）。
 * V9：蓝图 = 消耗品书。市场买书 → 书进"蓝图书架"（blueprintStock）→ 学习一本 → 永久可造；
 * 学会后的重复蓝图书只能放回市场出售。
 */
import {
  aiCoreName,
  aiEfficiency,
  calcBuildDurationMs,
  countAiCore,
  countWare,
  countModule,
  formatDurationMs,
  manufacturingLoopOf,
  manufacturingRunViews,
  marketLockedReason,
  matNeedCount,
  missingMaterials,
  ownsBlueprint,
  recipeCapability,
  canStartBlueprint,
  // 组装机卡片排序（2026-09-14 船长「一次性图纸应该和原图纸放在一起」）——口径单点在 core 纯函数
  sortManuRows,
  // 2026-09-14 舰船仓库批：船型"总持有"读口径（仓库＋在役舰队）
  shipOwnedCount,
  // 2026-09-13：精炼源只列玩家可见的矿（未上线矿不进"由精炼炉炼出"提示）
  visibleItemDefs,
  // 2026-09-14 船长：虫洞专属图纸改「去虫洞」跳转，门槛与扫描虫洞页同一本账
  WORMHOLE_SCAN_UNLOCK_STANDING,
} from '@whale/core'
import type { AiCoreType, GameState, MaterialNeed } from '@whale/core'
import { Panel } from '@whale/ui'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ItemHover, ModuleHover, ShipHover } from '../ui/shipInfo'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { HintIcon } from '../ui/Hint'
import { RowGlyph } from '../ui/itemView'
import { MONEY_GLYPH } from '../pages/common'
import {
  CONSUME_SUBS,
  MODULE_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  moduleSubKeyOf,
  type SubOption,
} from '../ui/itemSubs'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 在市场目录里找某蓝图的市场商品（key）；找不到返回 null */
function bpGoodKey(engine: GameEngine, blueprintId: string): string | null {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === 'blueprint' && good.refId === blueprintId) return good.key
  }
  return null
}

/** 产物现货基准价（产物在市场目录的 basePrice；弹药等按单次产出数量折算） */
function productBaseOf(engine: GameEngine, kind: 'module' | 'ship' | 'item', refId: string, units = 1): number {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === kind && good.refId === refId) return (good.basePrice ?? 0) * units
  }
  return 0
}

/** 精炼源矿石：精炼配方（def.refine）产出该矿物的矿石 id 列表；空 = 无精炼产出，只能市场购买。
 *  ⚠ 只列**玩家可见**的矿（`visibleItemDefs`）：未上线矿石不能作为"由精炼炉炼出"的提示来源
 *  （否则"虚空晶由虚空母矿炼出"会把未上线矿名念给玩家听）。 */
function refineSourcesOf(engine: GameEngine, mineralId: string): string[] {
  const out: string[] = []
  for (const def of visibleItemDefs(engine.ctx)) {
    if (def.kind === 'wreck') continue
    if ((def.refine ?? []).some((r) => r.mineralId === mineralId)) out.push(def.id)
  }
  return out
}

/** 蓝图书市场价（组装机排序用：市场目录 basePrice；缺省 = 蓝图字段；再无 = 沉底） */
function bookPriceOf(engine: GameEngine, blueprintId: string, fallback: number): number {
  const k = bpGoodKey(engine, blueprintId)
  if (k) {
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.key === k) return g.basePrice ?? fallback
    }
  }
  return fallback
}

/* ═══════════════ 蓝图书架（紧凑小卡网格：书+数量+状态+学习/出售；船长 2026-09-05 定形态） ═══════════════ */

/** 蓝图书架：持有的蓝图书（学习 → 永久学会；多余的书市价出售） */
export function BlueprintShelfPanel({
  engine,
  onToast,
  onGotoCraft,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「去组装机」：切到组装机标签并定位那张蓝图卡（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图
   *  直接跳转对应组装机」）——由工业页透传（跳转时会**清掉组装机的三级筛选**，否则目标卡可能被筛掉） */
  onGotoCraft?: (blueprintId: string) => void
}) {
  const state = engine.state
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)
  /**
   * **与组装机同样的筛选**（船长 2026-09-14：「蓝图书架也加入组装机同样的筛选」）：
   * 一级类别（`MANU_TABS`）/ 二级子类（`manuSubsOf`）/ 三级一次性-永久（`BLUEPRINT_USE_TABS`），
   * 三项都走 `bpFilterKeysOf` 同一个单点；三级同样**只在选了子类后才出现**（与组装机逐字同款口径）。
   */
  const [kind, setKind] = useState<ManuTab>('all')
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [useKind, setUseKind] = useState<BlueprintUse>('all')
  const subOptions = manuSubsOf(kind)
  const all = entries.map(([id, n]) => ({ id, n, keys: bpFilterKeysOf(engine, id) }))
  const shown = all
    .filter((e) => kind === 'all' || e.keys.tab === kind)
    .filter((e) => sub === SUB_ALL || e.keys.subKey === sub)
    .filter((e) => useKind === 'all' || (useKind === 'single' ? e.keys.singleUse : !e.keys.singleUse))

  function handleLearn(blueprintId: string): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '学习失败', true)
    else onToast('已学习该配方：可到组装机无限次制造。')
  }

  function handleSell(blueprintId: string): void {
    const key = bpGoodKey(engine, blueprintId)
    if (!key) {
      onToast('该蓝图不在市场流通目录（无法出售）。', true)
      return
    }
    const r = engine.sellHoldingAt(key)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast('出售指令已受理：市场收购簿有单即时成交，否则自动挂卖单。')
  }

  if (entries.length === 0) {
    return (
      <Panel
        title="蓝图书架"
        hint={
          // 空态只留"还没有书"这句状态；怎么弄到书的常驻引导收进标题后的圆形感叹号（2026-09-13 船长口径）
          // 2026-09-14 船长：虫洞专属图纸市场买不到 ⇒ 组装机那张卡改「去虫洞（遗迹打捞）」，这里同步改口径
          <HintIcon tip="到下方组装机点「市场求购蓝图书」→ 跳到市场的该蓝图行情详情，在那里自己下买单；书到架后回到这里点「学习」即可永久学会配方（重复书只能出售）。一次性图纸不能学习，拿到组装机直接用掉即可（开工时消耗）；在市场流通的那些同样可以在组装机卡上看订单。虫洞专属图纸（装备 / 舰船）市场不出售——组装机卡上是「去虫洞（遗迹打捞）」，进洞在遗迹与图纸货柜里捞。" />
        }
        right={<span className="app-dim">学习 = 永久可造；一次性图纸不开工不消耗</span>}
      >
        <div className="app-dim app-inv-empty">书架上还没有蓝图书。</div>
      </Panel>
    )
  }

  return (
    <Panel
      className="is-fill"
      title="蓝图书架"
      right={
        <span className="app-dim">
          学习 = 永久可造；一次性图纸只能制造一次
          {/* 筛选生效时补"当前 N 本"（与组装机/精炼炉同款，免得对着收窄后的网格数不清） */}
          {kind !== 'all' || sub !== SUB_ALL || useKind !== 'all' ? ` · 当前 ${shown.length} 本` : ''}
        </span>
      }
    >
      {/* 三级筛选与组装机**同一套**（同表、同顺序、同"选了子类才出三级"的规则）——
          样式逐字复用这两行（`app-task-tabs` + `app-fleet-tabs` + `app-tasktab`） */}
      <div className="app-task-tabs" role="tablist">
        {MANU_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={kind === t.key}
            className={`app-tasktab${kind === t.key ? ' is-active' : ''}`}
            onClick={() => {
              setKind(t.key)
              setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机同款）
              setUseKind('all')
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subOptions.length > 0 ? (
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={sub === SUB_ALL}
            className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
            onClick={() => {
              setSub(SUB_ALL)
              setUseKind('all')
            }}
          >
            全部子类
          </button>
          {subOptions.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={sub === s.key}
              className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
              onClick={() => {
                setSub(s.key)
                setUseKind('all')
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {sub !== SUB_ALL ? (
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {BLUEPRINT_USE_TABS.map((u) => (
            <button
              key={u.key}
              role="tab"
              aria-selected={useKind === u.key}
              className={`app-tasktab${useKind === u.key ? ' is-active' : ''}`}
              onClick={() => setUseKind(u.key)}
            >
              {u.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="app-shelf-grid">
        {shown.map(({ id, n }) => {
          // 蓝图书架按**持有的书**列条目 ⇒ 走全目录（施工期闸门下未上线的图纸只有调试才可能持有）
          const bp = engine.allBlueprints.find((b) => b.id === id) ?? engine.allShipBlueprints.find((b) => b.id === id)
          const learned = ownsBlueprint(state, id)
          const su = bp?.singleUse === true
          const willConsume = su && !learned && (state.spentOneTimeRecipes ?? []).includes(id)
          const kindShip = (bp && 'shipId' in bp) || (!bp && engine.allShipBlueprints.some((b) => b.id === id))
          return (
            <div key={id} className={`app-belt-card app-shelf-card${learned ? ' is-learned' : ''}`}>
              <div className="app-belt-head">
                <span className="app-belt-name" title={bp?.name ?? id}>
                  {kindShip ? '◈ ' : '▦ '}
                  {bp?.name ?? id}
                </span>
                <span className="app-chip" style={{ marginLeft: 'auto' }}>
                  ×{n}
                </span>
              </div>
              <div className="app-belt-desc">
                {su
                  ? learned
                    ? '一次性图纸：已永久学会该配方，这张用不上（不消耗）'
                    : willConsume
                      ? '一次性图纸：制造名额已用尽，这张开工时会直接消耗并制造一次'
                      : '一次性图纸：不能学习——到组装机开工时消耗，只能制造一次'
                  : learned
                    ? '配方已学会（重复书可出售）'
                    : '尚未学习——学习后永久可造'}
              </div>
              <div className="app-belt-actions">
                {/* **去组装机**（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图直接跳转对应组装机」）——
                    切到组装机标签并定位这张卡；组装机那一侧会先清掉三级筛选，保证目标卡一定在网格里 */}
                {onGotoCraft ? (
                  <button
                    className="app-btn is-small"
                    title="跳到组装机并定位这张图纸的卡片（那里才能开工制造）"
                    onClick={() => onGotoCraft(id)}
                  >
                    去组装机
                  </button>
                ) : null}
                {!learned && !su ? (
                  <button className="app-btn is-small is-primary" onClick={() => handleLearn(id)}>
                    学习
                  </button>
                ) : null}
                {!su ? (
                  <button className="app-btn is-small" onClick={() => handleSell(id)} title="按市场收购价卖出这本蓝图书（重复书只能出售）">
                    市价出售
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {shown.length === 0 ? (
        <div className="app-dim app-inv-empty">该筛选下书架里没有对应的书——换个分类、或把「全部子类 / 全部图纸」点回来看看。</div>
      ) : null}
    </Panel>
  )
}

/* ═══════════════ 组装机（2026-09-08 与精炼炉同款劳动者制：主控亲自 / AI 核心驱动；多蓝图 + 同蓝图多线） ═══════════════ */

/** 组装机类型筛选：全部 / 装备 / 舰船 / 消耗品（2026-09-05 基础弹药可自制；
 *  2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——该档实际含弹药 + 修理组件，与市场一级类型「消耗品」对齐） */
type ManuTab = 'all' | 'equip' | 'ship' | 'supply'
const MANU_TABS: Array<{ key: ManuTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'equip', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
  { key: 'supply', label: '消耗品蓝图' },
]

/**
 * 组装机**二级子筛选**（2026-09-11 船长：「对组装机的蓝图添加子筛选，根据产物的类型进行二次分类。
 * 舰船部分按舰船级别划分。」）——按当前一级标签给候选子类，**全部取自 `ui/itemSubs.ts` 单点表**：
 * 装备 = 产物功能九组（`MODULE_SUBS`）· 舰船 = 舰船级别五档（`SHIP_TIER_SUBS`）· 消耗品 = 产物大类（`CONSUME_SUBS`）；
 * 「全部」标签不带子筛选（与市场「全部类型」同款）。
 */
function manuSubsOf(tab: ManuTab): SubOption[] {
  if (tab === 'equip') return MODULE_SUBS
  if (tab === 'ship') return SHIP_TIER_SUBS
  if (tab === 'supply') return CONSUME_SUBS
  return []
}

/**
 * **第三级筛选：一次性蓝图 / 永久蓝图**（船长 2026-09-14：「组装机添加第三个筛选，一次性蓝图和永久蓝图。
 * 需要选完上一级子类后才出现」「蓝图书架也加入组装机同样的筛选」）——**组装机与蓝图书架同一张表**。
 * 显示规则（两处一致）：**只在选了二级子类（`sub !== SUB_ALL`）之后才出现**；切一级标签或换子类一律回「全部图纸」
 * （否则会出现"看不见的筛选"——卡片被筛掉而玩家找不到开关，与 `handleNeedMineral` 那条同一类坑）。
 */
type BlueprintUse = 'all' | 'perm' | 'single'
const BLUEPRINT_USE_TABS: Array<{ key: BlueprintUse; label: string }> = [
  { key: 'all', label: '全部图纸' },
  { key: 'perm', label: '永久蓝图' },
  { key: 'single', label: '一次性蓝图' },
]

/** 蓝图筛选三件套（类别 / 子类 / 是否一次性）——**单点**：组装机与蓝图书架都读它，键与组装机的分组逐字同源
 * （舰船 = `t<级别>` · 装备 = 产物功能 `moduleSubKeyOf(slot)` · 消耗品 = 产物大类 `itemDef.kind`）。 */
function bpFilterKeysOf(engine: GameEngine, bpId: string): { tab: ManuTab; subKey: string; singleUse: boolean } {
  const sbp = engine.ctx.shipBlueprints.get(bpId)
  if (sbp) {
    const def = engine.ctx.ships.get(sbp.shipId)
    return { tab: 'ship', subKey: def ? `t${def.tier}` : '', singleUse: sbp.singleUse === true }
  }
  const bp = engine.ctx.blueprints.get(bpId)
  if (bp && bp.itemId !== undefined) {
    const item = engine.ctx.items.get(bp.itemId)
    return { tab: 'supply', subKey: item?.kind ?? '', singleUse: bp.singleUse === true }
  }
  const mod = bp?.moduleId ? engine.ctx.modules.get(bp.moduleId) : undefined
  return { tab: 'equip', subKey: mod ? moduleSubKeyOf(mod.slot) : '', singleUse: bp?.singleUse === true }
}

/**
 * **虫洞专属图纸**（`bp-wh-*` / `sbp-wh-*`）——船长 2026-09-14：「虫洞专属的蓝图市场上没有卖，建议改为跳转虫洞。
 * 如果玩家声望不达标，就无法跳转」⇒ 这类卡不给"市场求购"（那里买不到），改给**去虫洞（遗迹打捞）**按钮 +
 * **虫洞解锁声望闸**（`WORMHOLE_SCAN_UNLOCK_STANDING`，与扫描虫洞页同一本账）。
 */
function isWormholeBlueprint(bpId: string): boolean {
  return /^(bp|sbp)-wh-/.test(bpId)
}

/** 主控此刻不能"亲自再开一条制造线"的原因（null = 主控空闲可开；AI 核心驱动不受此限；
 * 与精炼炉卡的手动判定同口径：手动工作位全局限 1 条（精炼炉/回收炉/制造线共用）） */
function manualBuildNote(state: GameState): string | null {
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return '你已亲自开着一条制造线：先取消或等它完成才能再亲自开一条（AI 核心不受此限）。'
  }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return '你已亲自运转着一台精炼炉/回收炉：先停掉它才能亲自开制造线（AI 核心不受此限）。'
  }
  if (state.awayGalaxy !== null) return '你不在空间站（母港或已建成副站）——先返航停靠。'
  if (state.mining.active) return '采矿作业中：先停止开采。'
  if (state.salvaging.active) return '打捞作业中：先停止打捞（或等满仓自动返航）。'
  if (state.expedition.active) return '远征中：先召回或等待结束。'
  if (state.standby.active) return '掩护巡逻进行中：先召回。'
  if (state.transit.active) return '返航途中：到站后再开线。'
  return null
}

/** 一张可制造蓝图的展示卡（与精炼炉卡同款结构：运转名册逐线 = 劳动者 + 进度 + 取消；
 * 开工按钮 = 手动制造（主控亲自）/ AI 核心下拉 + AI 制造；已学会 + 材料够即可随时加开（制造费已于 2026-09-08 取消）） */
function BlueprintCard({
  engine,
  onToast,
  blueprintId,
  name,
  description,
  materials,
  buildSeconds,
  productLabel,
  productNode,
  kindLabel,
  productGlyph,
  productBase,
  ownedCount,
  ownedWhere,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  highlighted,
}: {
  engine: GameEngine
  onToast: ToastFn
  blueprintId: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  /** 产物标签（如 装备名 或 舰船名+属性） */
  productLabel: string
  /** 产物名悬浮卡（ModuleHover/ShipHover/ItemHover——查看成品属性的统一入口；无解析 = 纯文本） */
  productNode?: ReactNode
  /** 产物类别徽标：装备 / 舰船 */
  kindLabel: string
  /** 产物图标键（与图鉴行同口径：物品/弹药 = 物品 kind、装备 = 槽位、舰船 = 船族；卡名前的 SVG 小图标） */
  productGlyph: string
  /** 产物市场现货基准价（×单次产出数量；0 = 市场无卡不显示估算） */
  productBase: number
  /** 自己已有多少产物（2026-09-10 船长：卡面产物行尾要显示"我拥有多少个成品"） */
  ownedCount: number
  /** 上面这个数字从哪儿数来的（仓库 / 装备库 / 机库），写进产物行括注 */
  ownedWhere: string
  /** 点需求材料：有精炼源 → 跳到精炼炉对应源矿石卡；无源 → 跳市场（2026-09-08 船长定） */
  onNeedMineral?: (itemId: string) => void
  /** 「市场求购蓝图书」跳市场：传该蓝图的市场商品键，市场页会搜到并展开它的行情详情
   *  （2026-09-14 船长：组装机只指路、不替玩家下任何单） */
  onGotoMarket?: (goodKey: string) => void
  /** 「去虫洞（遗迹打捞）」跳星图 · 出港 · 「扫描虫洞」页（船长 2026-09-14：虫洞专属图纸市场买不到，
   *  改跳虫洞；未达虫洞解锁声望时按钮禁用、不跳） */
  onGotoWormhole?: () => void
  /** 被「蓝图书架 → 去组装机」定位到的那张卡（页面层同一套 `.app-belt-card.is-goto` 高亮） */
  highlighted?: boolean
}) {
  const state = engine.state
  // 该蓝图的全部制造线（同蓝图可多条；与精炼炉同资源多台运转同构）
  const runs = manufacturingRunViews(state, engine.ctx).filter((v) => v.blueprintId === blueprintId)
  const running = runs.length > 0
  const owned = ownsBlueprint(state, blueprintId)
  // 制造费已取消（2026-09-08）：耗时/缺口等 spec 计算的费用字段恒置 0
  const spec = { materials, buildSeconds, buildCostIsk: 0 }
  const buildMs = calcBuildDurationMs(state, engine.ctx, spec)
  const bookCount = state.blueprintStock[blueprintId] ?? 0
  // **一次性图纸**（2026-09-12 船长：「玩家无法学会，只能制造一次」）：
  // 不学习、每次开工消耗一本同名图纸；已永久学会时这本不消耗也不用（裁定「2乙」）
  const bpDef = engine.ctx.blueprints.get(blueprintId) ?? engine.ctx.shipBlueprints.get(blueprintId)
  const singleUse = bpDef?.singleUse === true
  const cap = recipeCapability(state, blueprintId, singleUse)
  /**
   * ⚠ **不能用 `cap.kind === 'ok'` 当"能造"**（2026-09-14 船长报障「组装机原先没有图纸时会跳转到市场
   * 求购的按钮怎么没了」）：`recipeCapability(..., singleUse=false)` 对**普通图纸恒返回 `ok`**
   * （core 注释：「普通蓝图恒 ok：只由 `startManufacturing` 的'是否已学会'把关」）⇒
   * `ownsBlueprint || cap.kind === 'ok'` **恒为真**，未学会的卡也会走上面"手动制造 + AI 工位"那一支，
   * 于是下面「市场求购蓝图书」的 else 分支**永远轮不到**（181 张图里 123 张普通图纸全被吃掉）。
   * ⇒ 改用 core 的**单点判定** `canStartBlueprint`（已学会 ⇒ true；一次性图纸另有"书架有书且名额未用尽"）。
   */
  const canBuild = canStartBlueprint(state, engine.ctx, blueprintId)
  /** 一次性图纸的缺口提示（`null` = 无需提示） */
  const oneTimeNote = !singleUse
    ? null
    : owned
      ? '已永久学会该配方：这张一次性图纸用不上（不消耗，可留作纪念或转手）'
      : cap.kind === 'exhausted'
        ? '这张一次性图纸的制造名额已用尽：要再造需要再获得一张同名图纸'
        : cap.kind !== 'ok'
          ? '一次性图纸不在蓝图书架：需要先获得这张图纸'
          : null
  const short = missingMaterials(state, engine.ctx, spec)
  const goodKey = bpGoodKey(engine, blueprintId)
  /**
   * **市场购买门槛**（只作"卡头状态"提示用）。⚠ **2026-09-14 船长：「组装机里，需要声望的才能启动组装机的
   * 限制删除」** —— 这一条**不再挡任何按钮**：
   * - 引擎侧本来就不看声望（`startManufacturing` / `canStartBlueprint` 只认"是否已学会 / 一次性图纸是否在书架"）；
   * - 界面侧原先在 `canBuild` 之后插了一支 `lock ? 「✕ 声望未达标」（disabled）`，它排在
   *   **「书架有书 ⇒ 就地学习」之前** ⇒ 手里已经拿着书（洞内打捞来的）也点不动、只看到"需要声望"。
   * 现在只留卡头那枚提示（告诉玩家"市场这条路暂时买不了、还差多少声望"），
   * **卡片永远给出下一步能做的事**：能造 ⇒ 制造；书架有书 ⇒ 学习；否则 ⇒ 市场求购（点到市场页自己看门槛）。
   * 市场买书本身的声望门槛**未动**（那是已确认的"声望用途"口径，船长本轮只点了组装机）。
   */
  const lock = !owned && goodKey ? marketLockedReason(state, engine.ctx, goodKey) : null
  /**
   * **这张图能不能在市场买到**（2026-09-14 船长：「虫洞专属的蓝图市场上没有卖，建议改为跳转虫洞。
   * 如果玩家声望不达标，就无法跳转」）：`playerBuyable === false`（只收不卖那批）＝ 买不到 ⇒
   * 「市场求购」是条死路（点进去只会看到"只收不卖"），改给「去虫洞」。
   */
  const bookBuyable = goodKey !== null && engine.ctx.marketGoods.get(goodKey)?.playerBuyable !== false
  const whBlueprint = isWormholeBlueprint(blueprintId)
  /** 虫洞解锁声望闸（与扫描虫洞页同一本账：协会声望 ≥ `WORMHOLE_SCAN_UNLOCK_STANDING`） */
  const whStanding = state.standings.dsi ?? 0
  const whUnlocked = whStanding >= WORMHOLE_SCAN_UNLOCK_STANDING
  // 每卡独立的 AI 核心选择（一枚核心驱动一条线；核心库存被占用后自动回落可用类型）
  const [coreSel, setCoreSel] = useState<AiCoreType>('basic')
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const manualNote = manualBuildNote(state)

  /** 求购 = **只跳转、不下单**（2026-09-14 船长：「组装机求购蓝图应该跳转到市场对应的订单详细。
   *  而不是直接市场价下订单」）——到市场页会自动搜到该蓝图并展开它的行情详情（与舰船页/物品页
   *  「去市场」同一个入口 `onGotoMarket`，全仓一处口径）；买不买、按什么价挂单由玩家在详情里自己定。 */
  function handleGotoMarket(): void {
    if (!goodKey) {
      onToast('该蓝图不在市场流通目录。', true)
      return
    }
    if (!onGotoMarket) {
      onToast('当前入口不支持跳转市场：请从左侧「市场」页搜索这张蓝图。', true)
      return
    }
    onGotoMarket(goodKey)
  }

  /**
   * **去虫洞（遗迹打捞）**（船长 2026-09-14）——虫洞专属图纸（`bp-wh-*` / `sbp-wh-*`）市场只收不卖、
   * 买不到，所以指路"真正能拿到它的地方"：星图 · 出港 · **扫描虫洞**页（进洞 → 遗迹 / 图纸货柜 / 安全货柜）。
   * **声望不达标 ⇒ 不跳**（按钮本身也置灰；这里再兜一道，防键盘/程序化触发）。
   */
  function handleGotoWormhole(): void {
    if (!whUnlocked) {
      onToast(`虫洞尚未解锁：需「深空工业协会」声望 ${WORMHOLE_SCAN_UNLOCK_STANDING}（当前 ${whStanding}）。`, true)
      return
    }
    if (!onGotoWormhole) {
      onToast('当前入口不支持跳转虫洞：请从左侧「星图」→「出港 · 扫描虫洞」进入。', true)
      return
    }
    onGotoWormhole()
  }

  /** 书已在书架（未学习）：就地学习——与「蓝图书架」的「学习」同一个引擎出口与话术（不花钱、不占制造位） */
  function handleLearnFromShelf(): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '学习失败', true)
    else onToast('已学习该配方：现在可以开始制造了。')
  }

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) {
      onToast(r.error ?? '开工失败', true)
      return
    }
    onToast(
      worker === 'pilot'
        ? '主控亲自开工：材料已扣除，线已开（期间不可离港作业）。'
        : `${aiCoreName(worker)}已接入：材料已扣除，线已开（核心占用一枚，完成/取消自动归还）。`,
    )
  }

  function handleCancel(runId: number): void {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(r.error ?? '取消失败', true)
    else onToast('已取消该条制造线：材料全额退回物品仓库（AI 核心已归还），其余线不受影响。')
  }

  // 2026-09-10 船长定：循环制造（开关 + 目标件数）从逐条制造线**上移到整张生产卡**——
  // 一张卡一个开关，作用于该卡全部制造线（含主控亲自那条），打开后新开的线自动继承；
  // 目标件数 = 全卡合计；「关→开」= 开一批新循环（合计与停因清零）。判定/计数都在 core。
  const loop = manufacturingLoopOf(state, blueprintId)
  const [goalDraft, setGoalDraft] = useState('')
  function commitLoop(on: boolean, goalText: string): void {
    const n = Number.parseInt(goalText, 10)
    const goal = Number.isFinite(n) && n > 0 ? n : null
    const r = engine.setManufacturingLoopAt(blueprintId, on, on ? goal : null)
    if (!r.ok) onToast(r.error ?? '开关操作失败', true)
  }

  const feedTxt = short.length > 0 ? short.join('；') : ''
  // 2026-09-08（二号·组装机收益体检 A 项）：卡面补「净 ≈信用点/h」——产物现货基准价 − 材料收价
  // （材料学折扣后），按当前技能单件耗时折算每小时；未计销路与成交税（卖出按空间站收购档约
  // 6~7 折，自用装配则按现货计）——与精炼/回收卡「净口径估算」同款视觉。
  const matIsk = materials.reduce(
    (s, m) => s + matNeedCount(state, m.count) * (engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
    0,
  )
  const netPerH = productBase > 0 ? Math.round(((productBase - matIsk) / Math.max(1, buildMs)) * 3_600_000) : null
  const manualTitle =
    manualNote ??
    feedTxt ??
    (running
      ? '主控亲自再加开一条线：材料立即扣除（主控手动工作位全局限 1 条，其余线须 AI 驱动）'
      : '主控亲自开一条制造线：材料立即扣除，期间不可离港作业')
  const aiTitle = feedTxt
    ? feedTxt
    : core
      ? running
        ? '接入一枚闲置 AI 核心再加开一条线（核心出库占用；完成/取消自动归还）'
        : '接入 AI 核心自动制造：材料立即扣除（核心出库占用一枚；不占主控与副船名额）'
      : '没有可用 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。'

  return (
    <div className={`app-belt-card is-assembler${highlighted ? ' is-goto' : ''}`}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={productGlyph} /> {name}
          {running ? (
            <em className="app-belt-flag is-run">
              {kindLabel === '舰船' ? '造船中' : '制造中'}
              {runs.length > 1 ? ` ×${runs.length}` : ''}
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 状态徽标（已学会/蓝图书存量/市场门槛提示/类型）
            ⚠ 「市场门槛」这枚**只是提示**（2026-09-14 船长：组装机不再用声望挡启动）——它不挡任何按钮 */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="blueprints" id={blueprintId} />
          {owned ? (
            <span className="app-chip">已学会</span>
          ) : singleUse && bookCount > 0 ? (
            <span className="app-chip is-stock" title="一次性图纸：不能学习，只能到组装机直接制造一次（开工时消耗这张图纸）">
              一次性图纸 ×{bookCount}
            </span>
          ) : bookCount > 0 ? (
            <span className="app-chip">蓝图书 ×{bookCount}</span>
          ) : lock ? (
            <span className="app-chip is-exotic" title={`${lock}——这只影响「在市场买这本书」，不影响组装机开工`}>
              ✕ {lock}
            </span>
          ) : (
            <span className="app-chip">{kindLabel}</span>
          )}
        </span>
      </div>
      <div className="app-belt-desc">{description}</div>

      <div className="app-belt-ore">
        产物：{productNode ?? productLabel}
        <span className="app-dim" title={`自己已有的成品数量：${ownedWhere}；已挂单托管的量不计在内（与市场页「持有」同源）`}>
          （{ownedWhere} {ownedCount.toLocaleString('zh-CN')}）
        </span>
        {running ? (
          <>
            {' '}
            · 已开 {runs.length} 条线，首条约 {formatDurationMs(Math.min(...runs.map((v) => v.remainingMs)))} 到点
          </>
        ) : (
          <> · 主控耗时 {formatDurationMs(buildMs)}（技能修正后；AI 核心另按效率拉长）</>
        )}
      </div>
      <ul className="app-bp-mats">
        {materials.map((need) => {
          const needCount = matNeedCount(state, need.count) // 材料学折扣后的实际需求
          const have = countWare(state, need.itemId)
          const enough = have >= needCount
          const matName = engine.ctx.items.get(need.itemId)?.name ?? need.itemId
          // 空闲态才标红缺口；制造中仓库余量只影响「加开一条线」，红色会误读成故障
          return (
            <li key={need.itemId} className={`app-bp-mat${!enough && !running ? ' is-short' : ''}`}>
              {matName} ×{needCount.toLocaleString('zh-CN')}
              {needCount !== need.count ? (
                <span className="app-dim">（原 ×{need.count.toLocaleString('zh-CN')}，材料学折扣后）</span>
              ) : null}
              <span className="app-dim">（仓库 {have.toLocaleString('zh-CN')}）</span>
              {onNeedMineral ? (
                (() => {
                  const srcs = refineSourcesOf(engine, need.itemId)
                  const srcName = (id: string): string => engine.ctx.items.get(id)?.name ?? id
                  return (
                    <span
                      className="app-bp-mat-act"
                      role="button"
                      tabIndex={0}
                      title={
                        srcs.length > 0
                          ? `「${matName}」由精炼炉炼出（${srcs.map(srcName).join('、')} 等）——点击跳到精炼炉该资源卡`
                          : `「${matName}」无法经精炼炉产出——点击到市场购买`
                      }
                      onClick={() => onNeedMineral?.(need.itemId)}
                    >
                      {srcs.length > 0 ? '⚒ 去精炼' : '🛒 去市场'}
                    </span>
                  )
                })()
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="app-belt-econ">
        <div>
          理论收益率：
          {running && feedTxt ? <span className="app-dim">（余料不足「加开一条线」，缺口见按钮提示）</span> : null}
        </div>
        {netPerH !== null ? (
          <div
            className={`app-belt-econ-val${netPerH < 0 ? ' is-neg' : ''}`}
            title={`净收益估算：每件产物（市场现货基准价）− 每件材料（站内收价，材料学折扣后），按当前技能单件耗时折算每小时；不随市场收购波动、未计成交税。${
              netPerH < 0 ? '当前价格与技能下制造不如直接卖材料。' : '卖出给空间站按收购档（约 6~7 折），自用装配则按现货价计。'
            }`}
          >
            {MONEY_GLYPH} ≈{netPerH.toLocaleString('zh-CN')} 信用点/h{netPerH < 0 ? '（净亏：直接卖材料更划算）' : '（净 · 现货价）'}
          </div>
        ) : null}
      </div>

      <div className="app-belt-actions">
        {/* 循环制造（2026-09-10 船长定：开关与目标件数**单独领出来挂在生产卡上**，不再逐线各一份）——
            作用于本卡全部制造线（含主控亲自那条），新开的线自动继承；目标件数 = 全卡合计口径 */}
        {/* 一次性图纸不循环**（2026-09-12 船长：「只能制造一次」）⇒ 该开关对它不适用，整块不渲染 */}
        {(owned || running) && !singleUse ? (
          <div className="app-belt-loop">
            <label
              className="app-toggle"
              title={`循环制造：本卡全部制造线完成一件后自动续做同一蓝图（含主控亲自那条；劳动者/核心保持占用）；${loop.on ? '关闭后' : '打开后'}本卡在跑的线完成当前件即止`}
            >
              <input
                type="checkbox"
                className="app-toggle-input"
                checked={loop.on}
                onChange={(e) => commitLoop(e.target.checked, e.target.checked ? (goalDraft || (loop.goal > 0 ? String(loop.goal) : '')) : '')}
              />
              <span className="app-toggle-track" aria-hidden="true" />
              <span className="app-toggle-label">循环制造</span>
            </label>
            {loop.on ? (
              <span className="app-mf-goal">
                目标
                <input
                  type="number"
                  min={1}
                  className="app-mf-goal-input"
                  placeholder="∞"
                  value={goalDraft !== '' ? goalDraft : loop.goal > 0 ? String(loop.goal) : ''}
                  onChange={(e) => setGoalDraft(e.target.value)}
                  onBlur={(e) => {
                    setGoalDraft('')
                    commitLoop(true, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setGoalDraft('')
                      commitLoop(true, (e.target as HTMLInputElement).value)
                    }
                  }}
                  title="目标件数：本卡全部制造线合计做到这么多件就停（留空 = 直到材料不足自动停）；回车/失焦生效"
                />
                件<em className="app-dim">（全卡合计）</em>
              </span>
            ) : null}
            {loop.produced > 0 ? <span className="app-mf-made">已产 {loop.produced.toLocaleString('zh-CN')} 件</span> : null}
            {loop.stopWhy.length > 0 ? <span className="app-mf-why">已停线：{loop.stopWhy}</span> : null}
            <span className="app-dim app-mf-note">
              作用于本卡全部制造线{runs.length > 0 ? `（当前 ${runs.length} 条）` : ''}
            </span>
          </div>
        ) : null}
        {/* 该蓝图逐条制造线名册（每行：劳动者 + 剩余 + 进度 + 取消）——精炼炉运转名册同款结构；
            2026-09-10 起循环开关已在卡片级，行内不再各带一份 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers" style={{ marginTop: 2 }}>
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span
                  className="app-belt-worker-name"
                  title={`总耗时 ${formatDurationMs(v.durationMs)}；到点自动${kindLabel === '舰船' ? '入舰船仓库' : '入库'}${v.worker === null ? '（旧作业：老规则免占用线，跑完即止）' : ''}`}
                >
                  {v.worker === null ? '⚙ 旧作业' : v.worker === 'pilot' ? '⛏ 主控亲自' : `⚙ ${v.workerLabel}驱动`} · 剩余约{' '}
                  {formatDurationMs(v.remainingMs)}
                </span>
                <span className="app-progress-mini" title={`制造进度 ${v.percent}%`}>
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => handleCancel(v.id)}
                  title="取消这条制造线：材料按材料学折扣后的实际用量全额退回（AI 核心自动归还），其它线不受影响"
                >
                  ■ 取消
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {canBuild ? (
          <>
            <button
              className="app-btn is-small is-primary"
              disabled={manualNote !== null || short.length > 0}
              title={oneTimeNote ?? manualTitle}
              onClick={() => runWith('pilot')}
            >
              手动制造
            </button>
            {/* AI 工位：核心下拉常驻（无可用核心时置灰并在控件里写明，卡面不跳动；船长 2026-09-10） */}
            <div className="app-belt-ai">
              <select
                className="app-select"
                value={usableCores.length === 0 ? '' : (core ?? '')}
                onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
                disabled={usableCores.length === 0}
                title={
                  usableCores.length === 0
                    ? '无可用 AI 核心：核心库为空或全部已在占用中——去市场购入「基础 AI 核心」（空间站直购），或先取消占用中的任务、训练「AI 核心操作学」/「工业自动化」扩容'
                    : '选择接入 AI 核心：一枚核心驱动一条线（驱动期间该核心被占用并计入 AI 核心启用上限——上限由 AI 核心上限技能决定，与 AI 副船任务共用）'
                }
              >
                {usableCores.length === 0 ? (
                  <option value="">无可用 AI 核心</option>
                ) : (
                  usableCores.map((t) => (
                    <option key={t} value={t}>
                      {aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                    </option>
                  ))
                )}
              </select>
              <button
                className="app-btn is-small"
                disabled={!core || short.length > 0}
                title={oneTimeNote ?? (core ? aiTitle : '无可用 AI 核心：先去市场购入「基础 AI 核心」，或等占用中的核心归还')}
                onClick={() => core && runWith(core)}
              >
                AI 制造
              </button>
            </div>
          </>
        ) : !singleUse && bookCount > 0 ? (
          /* 书已在书架（尚未学习）：就地学习（2026-09-14 船长裁定「乙」）——与「蓝图书架」的「学习」
             同一个引擎出口与话术；书不消耗、也不占制造位。
             ⚠ 顺序上提到「去哪买/去哪捞」之前：手里有书就该先能学（这正是上一批"拿着书却只看到需要声望"的坑）。 */
          <button
            className="app-btn is-small"
            title={`蓝图书架已有这本图纸 ×${bookCount}：点此学习（不消耗书），学会后本卡永久可造`}
            onClick={handleLearnFromShelf}
          >
            学习该配方（书架已有书）
          </button>
        ) : whBlueprint ? (
          /**
           * **虫洞专属图纸 ⇒ 去虫洞（遗迹打捞）**（船长 2026-09-14：「虫洞专属的蓝图市场上没有卖，建议改为
           * 跳转虫洞。**如果玩家声望不达标，就无法跳转**」）——这类图（`bp-wh-*` / `sbp-wh-*`）的市场行是
           * "只收不卖"，点「市场求购」进去也买不到 ⇒ 死路；改成跳**星图 · 出港 · 扫描虫洞**（真正能拿图的地方：
           * 洞内遗迹打捞 / 图纸货柜 / 安全货柜），并以**虫洞解锁声望**为闸（未达标一律禁用 + 写明还差多少）。
           */
          <button
            className={`app-btn is-small${whUnlocked ? ' is-primary' : ''}`}
            disabled={!whUnlocked}
            title={
              whUnlocked
                ? '虫洞专属图纸：市场不出售（只收不卖）——点此跳到「扫描虫洞」进洞，在遗迹与图纸货柜里打捞同名图纸'
                : `虫洞尚未解锁：需「深空工业协会」声望 ${WORMHOLE_SCAN_UNLOCK_STANDING}（当前 ${whStanding}）——先去协会攒声望`
            }
            onClick={handleGotoWormhole}
          >
            {whUnlocked ? '去虫洞（遗迹打捞）' : '✕ 虫洞未解锁'}
          </button>
        ) : singleUse && bookBuyable ? (
          /* 一次性图纸（2026-09-14 船长：「组装机的一次性蓝图制造如果没有蓝图，也改为跳转市场，
             和其他组装机一样」）——**在市场流通的一次性图纸**（`sbp-once-*`：稀有订单层 / 奇货）
             缺书与名额已用尽都只差"再拿一张图" ⇒ 一律指路市场；买不买、按什么价挂单由玩家在详情里定。 */
          <button
            className="app-btn is-small"
            title={
              cap.kind === 'exhausted'
                ? '本门一次性图纸的名额已用尽：要再造需要再获得一张同名图纸——点此跳市场看这张图纸的订单（稀有订单层 / 奇货偶有现货）'
                : '一次性图纸：不能学习，只能用一次——组装机开工时消耗。点此跳市场看这张图纸的订单（稀有订单层 / 奇货偶有现货）'
            }
            onClick={handleGotoMarket}
          >
            市场求购蓝图书{cap.kind === 'exhausted' ? '（名额已用尽）' : ''}
          </button>
        ) : singleUse ? (
          /* 一次性图纸**不在市场流通**的（既非虫洞线、市场目录里也没有它）：写清唯一来源，不挂死路按钮 */
          <button
            className="app-btn is-small"
            disabled
            title={
              cap.kind === 'exhausted'
                ? '本门一次性图纸的名额已用尽：这张不在市场流通，只能从高级箱里再开出一张同名图纸'
                : '一次性图纸：不能学习，只能用一次。这张不在市场流通——只能从高级箱里开出来'
            }
          >
            {cap.kind === 'exhausted' ? '✕ 制造名额已用尽（高级箱）' : '✕ 需要一次性图纸（高级箱）'}
          </button>
        ) : bookBuyable ? (
          /* 求购 = 只跳市场行情详情，不替玩家下单（2026-09-14 船长口径） */
          <button className="app-btn is-small" title="跳到市场的该蓝图行情详情：买现货或按自己的价挂买单" onClick={handleGotoMarket}>
            市场求购蓝图书
          </button>
        ) : (
          /* 市场目录里根本没有这张图（可获得的渠道不在市场）：别给死路按钮 */
          <button className="app-btn is-small" disabled title="这张图纸不在市场流通目录——来源见产物说明（洞内打捞 / 高级箱等）">
            ✕ 无市场渠道
          </button>
        )}
      </div>
    </div>
  )
}

export function ManufacturingPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  /** 「市场求购蓝图书」跳市场（传市场商品键）；由工业页透传 App 的「去市场」入口 */
  onGotoMarket?: (goodKey: string) => void
  /** 「去虫洞（遗迹打捞）」跳星图 · 出港 · 扫描虫洞（船长 2026-09-14：虫洞专属图纸市场买不到） */
  onGotoWormhole?: () => void
  /** 蓝图书架「去组装机」的定位目标（蓝图 id）：本面板会**先清掉三级筛选**再高亮那张卡 */
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTab>('all')
  // 二级子筛选（2026-09-11 船长）；切一级标签即回「全部子类」（与市场页 changeKind 同款口径）
  const [sub, setSub] = useState<string>(SUB_ALL)
  /** 第三级筛选：一次性/永久（**只在选了子类后显示**；见 `BLUEPRINT_USE_TABS` 的注释） */
  const [useKind, setUseKind] = useState<BlueprintUse>('all')
  const subOptions = manuSubsOf(tab)
  /**
   * **书架跳过来的定位**（船长 2026-09-14）：先把三级筛选全部复位（否则目标卡可能正被筛掉 ⇒ 跳过去空白），
   * 高亮由页面层的 `.app-belt-card.is-goto` + 居中滚动负责（与「去精炼」同一套）。
   */
  useEffect(() => {
    if (!focusBlueprintId) return
    setTab('all')
    setSub(SUB_ALL)
    setUseKind('all')
  }, [focusBlueprintId])

  /** 目录数据（舰船 + 装备统一成条目；制造中冒泡在前，再按名称） */
  const items: Array<{
    id: string
    kindLabel: string
    /** 二级子筛选键（装备 = 产物功能分组 / 舰船 = t<级别> / 消耗品 = 产物大类；与 itemSubs 单点同键） */
    subKey: string
    productGlyph: string
    name: string
    description: string
    materials: readonly MaterialNeed[]
    buildSeconds: number
    productLabel: string
    productNode: ReactNode
    running: boolean
    canStart: boolean
    productBase: number
    /** 自己已有多少产物（产物行尾显示）与它的来处（仓库/装备库/机库） */
    ownedCount: number
    ownedWhere: string
    bookPrice: number
    /** 排序用：**产物唯一键**（`ship:`/`module:`/`item:` + 产物 id）——2026-09-14 船长：
     *  「一次性图纸应该和原图纸放在一起」⇒ 同产物成组，组内原图纸在前 */
    productKey: string
    /** 排序用：本卡是否为**一次性图纸**（`singleUse`） */
    singleUse: boolean
  }> = []
  /** 该船型的**总持有**（2026-09-14 舰船仓库批：组装机产出先进仓库 ⇒ 读口径改走 core 单点
   *  `shipOwnedCount` = 舰船仓库 ＋ 在役舰队；原先只数机库，会让"仓里堆着 3 艘"显示成 0） */
  const shipStockOf = (shipId: string): number => shipOwnedCount(state, shipId)
  const pushShip = (): void => {
    for (const sbp of engine.shipBlueprints) {
      const shipDef = engine.ctx.ships.get(sbp.shipId)
      const prodName = shipDef?.name ?? sbp.shipId
      /** 产物名后的参数（货舱/循环）：**不上色**（2026-09-13 船长：「只需要将『护盾扩展器 MK1』这部分换色」） */
      const prodParams = shipDef
        ? `（货舱 ${shipDef.cargoM3.toLocaleString('zh-CN')} m³ · ${shipDef.cycleSeconds} 秒 × ${shipDef.oreUnitsPerCycle} 单位/循环）`
        : ''
      const prodLabel = prodName + prodParams
      // 产物名**一律金色**（2026-09-13 船长：「只需要将产物染成金色就够了，不用根据类型分成不同颜色」——
      // 先前的按类型分色作废）；其余文字的金色在本卡内取消（见 `.app-belt-card.is-assembler` 那条 CSS）
      const prodText = <span className="app-gold">{prodName}</span>
      items.push({
        id: sbp.id,
        kindLabel: '舰船',
        // 舰船蓝图按**舰船级别**分档（2026-09-11 船长；键与 itemSubs.SHIP_TIER_SUBS 同源）
        subKey: shipDef ? `t${shipDef.tier}` : '',
        productGlyph: shipDef?.role ?? 'blueprint',
        name: sbp.name,
        description: sbp.description,
        materials: sbp.materials,
        buildSeconds: sbp.buildSeconds,
        productLabel: prodLabel,
        // note = 船介绍（与市场舰船商品行同口径：悬浮显示舰船介绍而非默认战斗数值说明）
        productNode: shipDef ? (
          <ShipHover ship={shipDef} note={shipDef.description}>
            {prodText}
            {prodParams}
          </ShipHover>
        ) : (
          <>
            {prodText}
            {prodParams}
          </>
        ),
        running: runViews.some((v) => v.blueprintId === sbp.id),
        canStart: canStartNow(sbp.id, sbp.materials, sbp.buildSeconds),
        productBase: shipDef ? (productBaseOf(engine, 'ship', sbp.shipId) || shipDef.priceIsk || 0) : 0,
        // 舰船产物：机库同型艘数（与市场页「持有」同口径；core 自然库存对舰船恒 0）
        ownedCount: shipStockOf(sbp.shipId),
        ownedWhere: '仓库＋机库',
        bookPrice: bookPriceOf(engine, sbp.id, 0),
        productKey: `ship:${sbp.shipId}`,
        singleUse: sbp.singleUse === true,
      })
    }
  }
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId !== undefined) continue // 弹药等物品蓝图单独分类
      const moduleDef = engine.ctx.modules.get(bp.moduleId!)
      const prodLabel = moduleDef?.name ?? bp.moduleId!
      // 产物名金色（按类型分色作废，2026-09-13 船长）
      const prodText = <span className="app-gold">{prodLabel}</span>
      items.push({
        id: bp.id,
        kindLabel: '装备',
        // 装备蓝图按**产物功能**分组（2026-09-11 船长：「根据产物的类型进行二次分类」；键与 MODULE_SUBS 同源）
        subKey: moduleDef ? moduleSubKeyOf(moduleDef.slot) : '',
        productGlyph: moduleDef?.slot ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: moduleDef ? <ModuleHover mod={moduleDef}>{prodText}</ModuleHover> : prodText,
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: moduleDef ? productBaseOf(engine, 'module', bp.moduleId!) : 0,
        ownedCount: moduleDef ? countModule(state, bp.moduleId!) : 0, // 装备产物 → 装备库件数
        ownedWhere: '装备库',
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `module:${bp.moduleId}`,
        singleUse: bp.singleUse === true,
      })
    }
  }
  /** 消耗品蓝图（2026-09-05：基础弹自制；产物为物品按 outputUnits 入仓）
   *  2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——本档实际含弹药 + 修理组件，按**产物大类**再筛 */
  const pushSupply = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      const units = bp.outputUnits ?? 1
      const prodName = itemDef?.name ?? bp.itemId
      const prodLabel = `${prodName} ×${units} 发`
      // 产物名金色（按类型分色作废，2026-09-13 船长）；「×N 发」等参数不上色
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {` ×${units} 发`}
        </>
      )
      items.push({
        id: bp.id,
        kindLabel: '消耗品',
        subKey: itemDef?.kind ?? '',
        productGlyph: itemDef?.kind ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: itemDef ? (
          <ItemHover item={itemDef} nameOf={(id) => engine.ctx.items.get(id)?.name}>
            {prodText}
          </ItemHover>
        ) : (
          prodText
        ),
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: itemDef ? productBaseOf(engine, 'item', bp.itemId, units) : 0,
        ownedCount: itemDef ? countWare(state, bp.itemId) : 0, // 弹药/物品产物 → 物品仓库单位数
        ownedWhere: '仓库',
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${bp.itemId}`,
        singleUse: bp.singleUse === true,
      })
    }
  }
  pushShip()
  pushEquip()
  pushSupply()

  /** 可开工判定（与卡片按钮同口径）：已学会（或一次性图纸有货且名额未用尽）+ 材料足
   *  （制造费已取消；劳动者判定由卡片按钮各自表达） */
  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    const su = engine.ctx.blueprints.get(blueprintId)?.singleUse === true
      || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
    if (!ownsBlueprint(state, blueprintId) && recipeCapability(state, blueprintId, su).kind !== 'ok') return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }).length === 0
  }

  const visible = items
    .filter(
      (it) =>
        tab === 'all' ||
        (tab === 'ship' ? it.kindLabel === '舰船' : tab === 'equip' ? it.kindLabel === '装备' : it.kindLabel === '消耗品'),
    )
    // 二级子筛选（2026-09-11 船长）：未选子类（SUB_ALL）不过滤
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    // 三级筛选（2026-09-14 船长）：一次性 / 永久——**只在选了子类后才有开关**，故这里 sub=全部时它恒为 all
    .filter((it) => useKind === 'all' || (useKind === 'single' ? it.singleUse : !it.singleUse))
  // 排序口径（类型 → 价格升序 → 同产物的一次性图纸紧随原图纸）**单点在 core**：
  // `sortManuRows`（2026-09-08 船长定 + 2026-09-14 船长改定；详见 core 该段注释与 `tests/manu-order.test.ts`）
  // 2026-09-10 船长定：已标记（收藏）的蓝图在默认排序下置顶——「全部」标签下会排在类型分组之前
  // （标签本身是筛选、不是排序键，故各处标签都按同一口径置顶）；组内保持类型→价格顺序。
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const shipN = items.filter((i) => i.kindLabel === '舰船').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title="组装机"
      hint={
        // 常驻说明收进标题后的圆形感叹号（2026-09-13 船长口径）；2026-09-14 船长点名："组装机的说明并没有隐藏"
        <HintIcon tip="已学会的配方才能开工；你亲自开限 1 条、其余每条由一枚 AI 核心驱动（同一蓝图可多条、不同蓝图并行）。" />
      }
      right={
        <>
          <span className="app-dim">
            制造线 {runViews.length} 条 · 装备 {equipN} · 舰船 {shipN} · 已学会 {learnedN}
            {/* 子筛选/三级筛选生效时补一个"当前 N 张"，避免玩家对着收窄后的网格数不清 */}
            {sub !== SUB_ALL || useKind !== 'all' ? ` · 当前 ${sorted.length} 张` : ''}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      {/* 筛选固定、说明进标题后的圆形感叹号（固定头+下滚）：类型标签行 / 子筛选行常驻，卡网格独立内滚 */}
      <div className="app-task-tabs" role="tablist">
        {MANU_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => {
              setTab(t.key)
              setSub(SUB_ALL) // 换一级标签即回「全部子类」（与市场页 changeKind 同款）
              setUseKind('all') // 三级筛选随之复位（它只在选了子类后才显示，留着会变成"看不见的筛选"）
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* 二级子筛选（2026-09-11 船长：按产物的类型二次分类 / 舰船按舰船级别）——
          复刻舰船页「舰队筛选」那套次级标签样式（app-task-tabs + app-fleet-tabs 去下边框 + app-tasktab 胶囊）；
          「全部」标签不带子筛选（与市场「全部类型」同款） */}
      {subOptions.length > 0 ? (
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={sub === SUB_ALL}
            className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
            onClick={() => {
              setSub(SUB_ALL)
              setUseKind('all') // 回「全部子类」⇒ 三级筛选行随之隐藏，故一并复位
            }}
          >
            全部子类
          </button>
          {subOptions.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={sub === s.key}
              className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
              onClick={() => {
                setSub(s.key)
                setUseKind('all') // 换子类即回「全部图纸」（与一级标签同款口径）
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {/* **三级筛选：一次性 / 永久**（船长 2026-09-14：「组装机添加第三个筛选，一次性蓝图和永久蓝图。
          需要选完上一级子类后才出现」）——样式逐字复刻上面那行子筛选（`app-task-tabs app-fleet-tabs`）； 
          **选了子类才渲染**：没选子类时它不出现，避免与"全部子类"语义打架 */}
      {sub !== SUB_ALL ? (
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {BLUEPRINT_USE_TABS.map((u) => (
            <button
              key={u.key}
              role="tab"
              aria-selected={useKind === u.key}
              className={`app-tasktab${useKind === u.key ? ' is-active' : ''}`}
              onClick={() => setUseKind(u.key)}
            >
              {u.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="app-win-body">
        <div className="app-belt-grid">
          {sorted.map((it) => (
            <BlueprintCard
              key={it.id}
              engine={engine}
              onToast={onToast}
              blueprintId={it.id}
              name={it.name}
              description={it.description}
              materials={it.materials}
              buildSeconds={it.buildSeconds}
              productLabel={it.productLabel}
              productNode={it.productNode}
              kindLabel={it.kindLabel}
              productGlyph={it.productGlyph}
              productBase={it.productBase}
              ownedCount={it.ownedCount}
              ownedWhere={it.ownedWhere}
              onNeedMineral={onNeedMineral}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={onGotoWormhole}
              highlighted={focusBlueprintId === it.id}
            />
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">该筛选下暂无蓝图——换个分类、或把「全部子类 / 全部图纸」点回来看看。</div>
        ) : null}
      </div>
    </Panel>
  )
}
