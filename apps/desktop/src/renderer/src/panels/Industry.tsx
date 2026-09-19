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
import { RedeemFragmentButton } from '../ui/fragmentRedeem'
import { Panel } from '@whale/ui'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ItemHover, ModuleHover, ShipHover } from '../ui/shipInfo'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { HintIcon } from '../ui/Hint'
import { RowGlyph } from '../ui/itemView'
import { useL10n } from '../i18n/locale'
import { MONEY_GLYPH } from '../pages/common'
import {
  CONSUME_SUBS,
  MODULE_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  moduleSubKeyOf,
  type SubOption,
} from '../ui/itemSubs'
import { tr } from '../i18n/locale'

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
  const { t } = useL10n()
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)
  /**
   * **与组装机同样的筛选**（船长 2026-09-14：「蓝图书架也加入组装机同样的筛选」）：
   * 一级类别（`MANU_TABS`）/ 二级子类（`manuSubsOf`）/ 三级一次性-永久（`BLUEPRINT_USE_TABS`），
   * 三项都走 `bpFilterKeysOf` 同一个单点；三级同样**只在选了子类后才出现**（与组装机逐字同款口径）。
   */
  const [kind, setKind] = useState<ManuTab>('all')
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [useKind, setUseKind] = useState<BlueprintUse>('all')
  /** 蓝图书卡（未筛选）：书架 = **手上还没学的书** */
  const bookCards = entries.map(([id, n]) => ({ id, n, keys: bpFilterKeysOf(engine, id) }))
  /**
   * **碎片逆向卡（2026-09-19 船长：「蓝图书架内确实没有显示可以合并的蓝图碎片。是否忘记添加到蓝图书架了？」）**：
   * 书架原先**只列"手上持有的蓝图书"**，而碎片是"还没有书"的那条路 ⇒ 玩家在这里看不到任何可合并的碎片。
   * 现补一类卡：**碎片进度 > 0 且尚未掌握、且手上没有这本书**的逆向蓝图，卡上直接给「逆向解锁 N/M」。
   * 读数走 core 单点 `fragmentRedeemRows()`（与兑命令同源）；门类归属走 `bpFilterKeysOf`（与蓝图书同一把尺）。
   */
  const fragCards = engine
    .fragmentRedeemRows()
    .filter((r) => !r.learned && r.have > 0 && (state.blueprintStock?.[r.blueprintId] ?? 0) <= 0)
    .map((r) => ({ r, keys: bpFilterKeysOf(engine, r.blueprintId) }))
  const cards = [...bookCards, ...fragCards]
  /**
   * **筛选项按"书架上真有卡片"出**（2026-09-19 报障修复 · 船长：「如果选择舰船蓝图或者消耗品蓝图，
   * 卡片列表会变空」）：书架只列"还没学的书"＋"可逆向的碎片卡"，而**学习一本吃一本书**
   * （`market.learnBlueprint`）⇒ 把某一门类学完的档，书架上那一门类就是空的。
   * 旧口径把三个标签**静态全列** ⇒ 选「舰船蓝图」/「消耗品蓝图」必然一张卡都不剩，
   * 正是 2026-09-14 那条「避免看不见的筛选」要防的坑。现改为**只列真有卡片的档**：
   * 「全部 / 全部子类 / 全部图纸」三项**常显**，其余按现有卡片现算（键与顺序仍取既有单点表）。
   */
  const tabsShown = MANU_TABS.filter((tb) => tb.key === 'all' || cards.some((c) => c.keys.tab === tb.key))
  const subsShown = manuSubsOf(kind).filter((s) => cards.some((c) => c.keys.tab === kind && c.keys.subKey === s.key))
  const usesShown = BLUEPRINT_USE_TABS.filter((u) =>
    u.key === 'all'
      ? true
      : cards.some(
          (c) =>
            (kind === 'all' || c.keys.tab === kind) &&
            (sub === SUB_ALL || c.keys.subKey === sub) &&
            (u.key === 'single' ? c.keys.singleUse : !c.keys.singleUse),
        ),
  )
  /**
   * **卡片集合变了 ⇒ 原选择可能已经无卡**（学掉最后一张该类书 / 逆向解锁 / 新书到架）：
   * 回落到「全部」，别让玩家卡在永远空的档（与"不出空标签"同一目的）。
   */
  const kindMissing = kind !== 'all' && !tabsShown.some((x) => x.key === kind)
  const subMissing = !kindMissing && sub !== SUB_ALL && !subsShown.some((x) => x.key === sub)
  useEffect(() => {
    if (kindMissing) {
      setKind('all')
      setSub(SUB_ALL)
      setUseKind('all')
      return
    }
    if (subMissing) {
      setSub(SUB_ALL)
      setUseKind('all')
    }
  }, [kindMissing, subMissing])
  /** 三级筛选判定（与上面两张"现算表"同一把尺） */
  const passKeys = (k: { tab: ManuTab; subKey: string; singleUse: boolean }): boolean =>
    (kind === 'all' || k.tab === kind) &&
    (sub === SUB_ALL || k.subKey === sub) &&
    (useKind === 'all' || (useKind === 'single' ? k.singleUse : !k.singleUse))
  const shown = bookCards.filter((c) => passKeys(c.keys))
  const fragShown = fragCards.filter((c) => passKeys(c.keys))

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

  if (cards.length === 0) {
    return (
      <Panel
        title={tr("ui.IndustryPage.060")}
        hint={
          // 空态只留"还没有书"这句状态；怎么弄到书的常驻引导收进标题后的圆形感叹号（2026-09-13 船长口径）
          // 2026-09-14 船长：虫洞专属图纸市场买不到 ⇒ 组装机那张卡改「去虫洞（遗迹打捞）」，这里同步改口径
          <HintIcon tip={tr("ui.Industry.005")} />
        }
        right={<span className="app-dim">{tr("ui.Industry.006")}</span>}
      >
        <div className="app-dim app-inv-empty">{tr("ui.Industry.007")}</div>
      </Panel>
    )
  }

  return (
    <Panel
      className="is-fill"
      title={tr("ui.IndustryPage.060")}
      right={
        <span className="app-dim">
          {tr("ui.Industry.008")}
          {/* 筛选生效时补"当前 N 本"（与组装机/精炼炉同款，免得对着收窄后的网格数不清） */}
          {kind !== 'all' || sub !== SUB_ALL || useKind !== 'all' ? ` · 当前 ${shown.length} 本` : ''}
        </span>
      }
    >
      {/* 三级筛选与组装机**同一套**（同表、同顺序、同"选了子类才出三级"的规则）——
          样式逐字复用这两行（`app-task-tabs` + `app-fleet-tabs` + `app-tasktab`）；
          ⚠ **标签集合是现算的**（2026-09-19 报障修复）：只列"书架上真有卡片"的档，
          「全部 / 全部子类 / 全部图纸」常显——详见上面 `tabsShown / subsShown / usesShown` 的注释 */}
      <div className="app-task-tabs" role="tablist">
        {tabsShown.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={kind === tb.key}
            className={`app-tasktab${kind === tb.key ? ' is-active' : ''}`}
            onClick={() => {
              setKind(tb.key)
              setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机同款）
              setUseKind('all')
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>
      {subsShown.length > 0 ? (
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
            {tr("ui.IndustryPage.064")}
          </button>
          {subsShown.map((s) => (
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
          {usesShown.map((u) => (
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
                    ? tr("ui.Industry.009")
                    : willConsume
                      ? tr("ui.Industry.010")
                      : tr("ui.Industry.011")
                  : learned
                    ? tr("ui.Industry.012")
                    : tr("ui.Industry.013")}
              </div>
              <div className="app-belt-actions">
                {/* **去组装机**（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图直接跳转对应组装机」）——
                    切到组装机标签并定位这张卡；组装机那一侧会先清掉三级筛选，保证目标卡一定在网格里 */}
                {onGotoCraft ? (
                  <button
                    className="app-btn is-small"
                    title={tr("ui.Industry.014")}
                    onClick={() => onGotoCraft(id)}
                  >
                    {tr("ui.Industry.015")}
                  </button>
                ) : null}
                {!learned && !su ? (
                  <button className="app-btn is-small is-primary" onClick={() => handleLearn(id)}>
                    {tr("ui.Industry.016")}
                  </button>
                ) : null}
                {!su ? (
                  <button className="app-btn is-small" onClick={() => handleSell(id)} title={tr("ui.Industry.017")}>
                    {tr("ui.Industry.018")}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {/* **碎片逆向卡**（2026-09-19 船长：书架里看不到可合并的碎片）——与蓝图书同网格、同筛选，
          卡面标明"碎片"来源与进度，动作 = 「逆向解锁 N/M」 */}
      {fragShown.map(({ r }) => (
        <div key={`frag-${r.fragmentItemId}`} className="app-belt-card app-shelf-card is-frag">
          <div className="app-belt-head">
            <span className="app-belt-name" title={`${r.blueprintName}（碎片 ${r.have}/${r.need}）`}>
              ▦ {r.blueprintName}
            </span>
            <span className="app-chip" style={{ marginLeft: 'auto' }}>
              {tr("ui.Industry.019")} {r.have}/{r.need}
            </span>
          </div>
          <div className="app-belt-desc">
            {r.have >= r.need
              ? tr("ui.Industry.020")
              : `碎片未集齐：还差 ${r.need - r.have} 片（来自残骸回收的彩头掉落）`}
          </div>
          <div className="app-belt-actions">
            <RedeemFragmentButton engine={engine} itemId={r.fragmentItemId} onToast={onToast} />
          </div>
        </div>
      ))}
      {shown.length === 0 && fragShown.length === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Industry.094")}</div>
      ) : null}
    </Panel>
  )
}

/* ═══════════════ 组装机（2026-09-08 与精炼炉同款劳动者制：主控亲自 / AI 核心驱动；多蓝图 + 同蓝图多线） ═══════════════ */

/** 组装机类型筛选：全部 / 装备 / 舰船 / 消耗品（2026-09-05 基础弹药可自制；
 *  2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——该档实际含弹药 + 修理组件，与市场一级类型「消耗品」对齐） */
type ManuTab = 'all' | 'equip' | 'ship' | 'supply'
const MANU_TABS: Array<{ key: ManuTab; label: string }> = [
  { key: 'all', label: tr("ui.IndustryPage.001") },
  { key: 'equip', label: tr("ui.ShipPage.115") },
  { key: 'ship', label: tr("ui.ShipPage.116") },
  { key: 'supply', label: tr("ui.ShipPage.114") },
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
  { key: 'all', label: tr("ui.Industry.022") },
  { key: 'perm', label: tr("ui.Industry.023") },
  { key: 'single', label: tr("ui.Industry.024") },
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
    return tr("ui.Industry.025")
  }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return tr("ui.Industry.026")
  }
  if (state.awayGalaxy !== null) return tr("ui.IndustryPage.010")
  if (state.mining.active) return tr("ui.IndustryPage.011")
  if (state.salvaging.active) return tr("ui.IndustryPage.012")
  if (state.expedition.active) return tr("ui.IndustryPage.013")
  if (state.standby.active) return tr("ui.IndustryPage.014")
  if (state.transit.active) return tr("ui.Industry.027")
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
      ? tr("ui.Industry.028")
      : cap.kind === 'exhausted'
        ? tr("ui.Industry.029")
        : cap.kind !== 'ok'
          ? tr("ui.Industry.030")
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
        ? tr("ui.Industry.031")
        : `${aiCoreName(worker)}已接入：材料已扣除，线已开（核心占用一枚，完成/取消自动归还）。`,
    )
  }

  function handleCancel(runId: number): void {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(r.error ?? '取消失败', true)
    else onToast('已取消该条制造线：材料全额退回物品仓库（AI 核心已归还），其余线不受影响。')
  }

  // 2026-09-10 船长定：循环制造（开关 + 目标批数）从逐条制造线**上移到整张生产卡**——
  // 一张卡一个开关，作用于该卡全部制造线（含主控亲自那条），打开后新开的线自动继承；
  // 目标批数 = 全卡合计；「关→开」= 开一批新循环（合计与停因清零）。判定/计数都在 core。
  const loop = manufacturingLoopOf(state, blueprintId)
  const [goalDraft, setGoalDraft] = useState('')
  /**
   * **草稿引用**（2026-09-17 报障修复）：「目标批数」原先**只在回车 / 失焦那一刻提交**，
   * 而**程序化跳页**（通讯「前往」、教程跳转、任务卡跳转）**不产生失焦** ⇒ 玩家刚打的数字
   * 从未提交，切回来输入框是空的、循环开关还开着 ⇒ **变成"无限生产"**（真浏览器复现：
   * 打字→不回车→合成点击导航⇒落盘 goal=null；鼠标点导航则因 mousedown 先失焦而侥幸不丢）。
   * 这里把最新草稿放进 ref，**卡片卸载时补一次提交**（切页/切标签都会卸载卡片）⇒ 打过就一定生效。
   * 回车/失焦仍即时提交（口径不变，见输入框 title）；没打字（草稿为空）时**不做任何动作**，
   * 故不会凭空清掉已有目标、也不会在 StrictMode 的"挂载即卸载"里误提交。
   */
  const goalDraftRef = useRef('')
  goalDraftRef.current = goalDraft
  /** 「这一版草稿是玩家打出来的」——只有它为真，卸载时才补提交；任何一次正式提交后即清账 */
  const goalTouchedRef = useRef(false)
  useEffect(
    () => () => {
      if (!goalTouchedRef.current) return
      const n = Number.parseInt(goalDraftRef.current, 10)
      engine.setManufacturingLoopAt(blueprintId, true, Number.isFinite(n) && n > 0 ? n : null)
    },
    [engine, blueprintId],
  )
  function commitLoop(on: boolean, goalText: string): void {
    goalTouchedRef.current = false
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
      ? tr("ui.Industry.032")
      : tr("ui.Industry.033"))
  const aiTitle = feedTxt
    ? feedTxt
    : core
      ? running
        ? tr("ui.Industry.034")
        : tr("ui.Industry.035")
      : tr("ui.Industry.036")

  return (
    <div className={`app-belt-card is-assembler${highlighted ? ' is-goto' : ''}`}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={productGlyph} /> {name}
          {running ? (
            <em className="app-belt-flag is-run">
              {kindLabel === '舰船' ? tr("ui.Industry.037") : tr("ui.Industry.038")}
              {runs.length > 1 ? ` ×${runs.length}` : ''}
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 状态徽标（已学会/蓝图书存量/市场门槛提示/类型）
            ⚠ 「市场门槛」这枚**只是提示**（2026-09-14 船长：组装机不再用声望挡启动）——它不挡任何按钮 */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="blueprints" id={blueprintId} />
          {owned ? (
            <span className="app-chip">{tr("ui.Industry.039")}</span>
          ) : singleUse && bookCount > 0 ? (
            <span className="app-chip is-stock" title={tr("ui.Industry.040")}>
              {tr("ui.Industry.041")}{bookCount}
            </span>
          ) : bookCount > 0 ? (
            <span className="app-chip">{tr("ui.Industry.042")}{bookCount}</span>
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
        {tr("ui.Handbook.013")}{productNode ?? productLabel}
        <span className="app-dim" title={`自己已有的成品数量：${ownedWhere}；已挂单托管的量不计在内（与市场页「持有」同源）`}>
          （{ownedWhere} {ownedCount.toLocaleString('zh-CN')}）
        </span>
        {running ? (
          <>
            {' '}
            · 已开 {runs.length} {tr("ui.Industry.043")} {formatDurationMs(Math.min(...runs.map((v) => v.remainingMs)))} {tr("ui.Industry.044")}
          </>
        ) : (
          <> · 主控耗时 {formatDurationMs(buildMs)}{tr("ui.Industry.045")}</>
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
                <span className="app-dim">{tr("ui.Industry.046")}{need.count.toLocaleString('zh-CN')}，材料学折扣后）</span>
              ) : null}
              <span className="app-dim">{tr("ui.IndustryPage.029")} {have.toLocaleString('zh-CN')}）</span>
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
                      {srcs.length > 0 ? tr("ui.Industry.047") : tr("ui.Industry.048")}
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
          {tr("ui.Industry.049")}
          {running && feedTxt ? <span className="app-dim">{tr("ui.Industry.050")}</span> : null}
        </div>
        {netPerH !== null ? (
          <div
            className={`app-belt-econ-val${netPerH < 0 ? ' is-neg' : ''}`}
            title={`净收益估算：每件产物（市场现货基准价）− 每件材料（站内收价，材料学折扣后），按当前技能单件耗时折算每小时；不随市场收购波动、未计成交税。${
              netPerH < 0 ? tr("ui.Industry.051") : tr("ui.Industry.052")
            }`}
          >
            {MONEY_GLYPH} ≈{netPerH.toLocaleString('zh-CN')} {tr("ui.IndustryPage.026")}{netPerH < 0 ? tr("ui.Industry.053") : tr("ui.Industry.054")}
          </div>
        ) : null}
      </div>

      <div className="app-belt-actions">
        {/* 循环制造（2026-09-10 船长定：开关与目标批数**单独领出来挂在生产卡上**，不再逐线各一份）——
            作用于本卡全部制造线（含主控亲自那条），新开的线自动继承；目标批数 = 全卡合计口径（2026-09-18 船长定：按「批」不按件） */}
        {/* 一次性图纸不循环**（2026-09-12 船长：「只能制造一次」）⇒ 该开关对它不适用，整块不渲染 */}
        {(owned || running) && !singleUse ? (
          <div className="app-belt-loop">
            <label
              className="app-toggle"
              title={`循环制造：本卡全部制造线完成一件后自动续做同一蓝图（含主控亲自那条；劳动者/核心保持占用）；${loop.on ? tr("ui.Industry.055") : tr("ui.Industry.056")}本卡在跑的线完成当前件即止`}
            >
              <input
                type="checkbox"
                className="app-toggle-input"
                checked={loop.on}
                onChange={(e) => commitLoop(e.target.checked, e.target.checked ? (goalDraft || (loop.goal > 0 ? String(loop.goal) : '')) : '')}
              />
              <span className="app-toggle-track" aria-hidden="true" />
              <span className="app-toggle-label">{tr("ui.Industry.057")}</span>
            </label>
            {loop.on ? (
              <span className="app-mf-goal">
                {tr("ui.Industry.058")}
                <input
                  type="number"
                  min={1}
                  className="app-mf-goal-input"
                  placeholder="∞"
                  value={goalDraft !== '' ? goalDraft : loop.goal > 0 ? String(loop.goal) : ''}
                  onChange={(e) => {
                    goalTouchedRef.current = true
                    setGoalDraft(e.target.value)
                  }}
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
                  title={tr("ui.Industry.059")}
                />
                件<em className="app-dim">{tr("ui.Industry.060")}</em>
              </span>
            ) : null}
            {loop.produced > 0 ? <span className="app-mf-made">{tr("ui.Industry.061")} {loop.produced.toLocaleString('zh-CN')} 件</span> : null}
            {loop.stopWhy.length > 0 ? <span className="app-mf-why">{tr("ui.Industry.062")}{loop.stopWhy}</span> : null}
            <span className="app-dim app-mf-note">
              {tr("ui.Industry.063")}{runs.length > 0 ? `（当前 ${runs.length} 条）` : ''}
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
                  title={`总耗时 ${formatDurationMs(v.durationMs)}；到点自动${kindLabel === '舰船' ? tr("ui.Industry.064") : tr("ui.Industry.065")}${v.worker === null ? tr("ui.Industry.066") : ''}`}
                >
                  {v.worker === null ? tr("ui.Industry.067") : v.worker === 'pilot' ? tr("ui.Industry.068") : `⚙ ${v.workerLabel}驱动`} · 剩余约{' '}
                  {formatDurationMs(v.remainingMs)}
                </span>
                <span className="app-progress-mini" title={`制造进度 ${v.percent}%`}>
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => handleCancel(v.id)}
                  title={tr("ui.Industry.069")}
                >
                  {tr("ui.Industry.070")}
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
              {tr("ui.Industry.071")}
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
                    ? tr("ui.IndustryPage.051")
                    : tr("ui.Industry.072")
                }
              >
                {usableCores.length === 0 ? (
                  <option value="">{tr("ui.ShipPage.070")}</option>
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
                title={oneTimeNote ?? (core ? aiTitle : tr("ui.IndustryPage.055"))}
                onClick={() => core && runWith(core)}
              >
                {tr("ui.Industry.073")}
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
            {tr("ui.Industry.074")}
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
                ? tr("ui.Industry.075")
                : `虫洞尚未解锁：需「深空工业协会」声望 ${WORMHOLE_SCAN_UNLOCK_STANDING}（当前 ${whStanding}）——先去协会攒声望`
            }
            onClick={handleGotoWormhole}
          >
            {whUnlocked ? tr("ui.Industry.076") : tr("ui.Industry.077")}
          </button>
        ) : singleUse && bookBuyable ? (
          /* 一次性图纸（2026-09-14 船长：「组装机的一次性蓝图制造如果没有蓝图，也改为跳转市场，
             和其他组装机一样」）——**在市场流通的一次性图纸**（`sbp-once-*`：稀有订单层 / 奇货）
             缺书与名额已用尽都只差"再拿一张图" ⇒ 一律指路市场；买不买、按什么价挂单由玩家在详情里定。 */
          <button
            className="app-btn is-small"
            title={
              cap.kind === 'exhausted'
                ? tr("ui.Industry.078")
                : tr("ui.Industry.079")
            }
            onClick={handleGotoMarket}
          >
            {tr("ui.Industry.080")}{cap.kind === 'exhausted' ? tr("ui.Industry.081") : ''}
          </button>
        ) : singleUse ? (
          /* 一次性图纸**不在市场流通**的（既非虫洞线、市场目录里也没有它）：写清唯一来源，不挂死路按钮 */
          <button
            className="app-btn is-small"
            disabled
            title={
              cap.kind === 'exhausted'
                ? tr("ui.Industry.082")
                : tr("ui.Industry.083")
            }
          >
            {cap.kind === 'exhausted' ? tr("ui.Industry.084") : tr("ui.Industry.085")}
          </button>
        ) : bookBuyable ? (
          /* 求购 = 只跳市场行情详情，不替玩家下单（2026-09-14 船长口径） */
          <button className="app-btn is-small" title={tr("ui.Industry.086")} onClick={handleGotoMarket}>
            {tr("ui.Industry.080")}
          </button>
        ) : (
          /* 市场目录里根本没有这张图（可获得的渠道不在市场）：别给死路按钮 */
          <button className="app-btn is-small" disabled title={tr("ui.Industry.087")}>
            {tr("ui.Industry.088")}
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
        kindLabel: tr("ui.App.002"),
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
        ownedWhere: tr("ui.Industry.089"),
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
        kindLabel: tr("ui.MarketPage.003"),
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
        ownedWhere: tr("ui.Industry.004"),
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
        kindLabel: tr("ui.MarketPage.007"),
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
        ownedWhere: tr("ui.ItemsPage.001"),
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
      title={tr("ui.IndustryPage.059")}
      hint={
        // 常驻说明收进标题后的圆形感叹号（2026-09-13 船长口径）；2026-09-14 船长点名："组装机的说明并没有隐藏"
        <HintIcon tip={tr("ui.Industry.090")} />
      }
      right={
        <>
          <span className="app-dim">
            {tr("ui.Industry.091")} {runViews.length} {tr("ui.Industry.092")} {equipN} · 舰船 {shipN} · 已学会 {learnedN}
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
            {tr("ui.IndustryPage.064")}
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
          <div className="app-dim app-exp-idle">{tr("ui.Industry.093")}</div>
        ) : null}
      </div>
    </Panel>
  )
}
