/**
 * 手册图鉴 · 详情窗与卡片构造（2026-10-02 从 `panels/Handbook.tsx` 拆出 · 批次 4s · 零行为变化）。
 *
 * 本文件 = 图鉴的**详情域**：卡片构造器（模块/舰船/物品/蓝图/势力同源 `app-hand-cell`）、详情窗
 * （DetailBody / FoeBody / CellDetail）、分组小节 GroupSection 与宽类型标签助手（kindName/slotName/roleName）。
 * `Handbook.tsx` 借回使用（先例：fitted.ts）；GridCell / RawData 从 Handbook 纯类型借入 ⇒ 无运行期回边。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { shipCategoryKeyOf } from '@whale/core'
import type { BlueprintDef, DamageType, DroneClass, FoeShipDef, ItemDef, ItemKind, ModuleDef, ShipBlueprintDef, ShipDef, ShipRole } from '@whale/core'
import { itemRarityTierOf } from '@whale/data'
import { handMarketKeyOf } from '../ui/marketJump'
import { kindText, slotText, shipRoleText, crestFamOf, shipTierText, kindTextOfItem } from '../ui/labelsText'
import { Glyph, partToneKeyOf, itemGlyphName } from '../ui/Glyphs'
import { toneOfAny } from '../ui/tones'
import { DmgChip, itemCombatLines, itemInfoLines, moduleInfoLines, moduleShortEffect, shipCodexBaseLines, shipIndirectLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'
import { foeBriefLinesOfShip, mountLabelText } from '../ui/foeBrief'
import { ShipSprite } from '../ui/ShipSprite'
import { Panel } from '@whale/ui'
import { tr } from '../i18n/locale'
import type { GameEngine } from '../game/engine'
import type { GridCell, RawData } from './Handbook'

/**
 * 宽类型标签索引（**详情窗数据来自 raw，键是 string**）。
 *
 * ⚠ **2026-09-22 船长令「先进行手册的本地化」改判**：这三个助手原先直接读 core 的**中文**名表
 * （`ITEM_KIND_LABELS` / `SLOT_LABELS` / `SHIP_ROLE_LABELS`）⇒ 手册的卡片副标题、槽位/角色 chip、
 * 详情行与筛选档在**英文界面下整片漏中文**（实测手册页 314 处里的大头）。现一律走本地化单点
 * （`ui/labelsText.ts` 的 `kindText` / `slotText` / `shipRoleText`，可复用的 id 都复用，core 不动）。
 */
export const kindName = (k: string): string => kindText(k as Parameters<typeof kindText>[0])
export const slotName = (k: string): string => slotText(k)
export const roleName = (k: string): string => shipRoleText(k as Parameters<typeof shipRoleText>[0])

/* ═══════════ 详情窗 ═══════════ */

/** 详情窗用：把当前表格单元喂给 {@link handMarketKeyOf}（映射单点在 `ui/marketJump.ts`，
 *  体检那条跨层契约也读同一个函数——**不许在这里另写一份映射**） */
export function marketKeyOf(engine: GameEngine, cell: GridCell): string | null {
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
export function moduleCellOf(mod: ModuleDef): GridCell {
  const crest = crestFamOf(mod.id)
  return {
    key: mod.id,
    tab: 'modules',
    glyph: mod.slot,
    name: mod.name,
    sub: `${slotName(mod.slot)} · ${moduleShortEffect(mod)}`,
    raw: mod as unknown as RawData,
    rarity: itemRarityTierOf(mod.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}

export function shipCellOf(ship: ShipDef): GridCell {
  // 2026-09-16 船长：类别键走 `shipCategoryKeyOf` —— 装甲线 = `role: 'armored'` **或**武装舰里装甲占比 > 护盾占比
  // （牛鲨级突击巡洋舰 + E 族专属舰；丙案「只在武装舰里判」）。图标/文字/分组/筛选四处同源这一处。
  const cls = shipCategoryKeyOf(ship)
  const crest = crestFamOf(ship.id)
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
    ...(crest !== undefined ? { crest } : {}),
  }
}

/**
 * **物品卡**（产物 = `ItemDef`）：副行 = 大类 · 单位体积；族徽按**物品自身 id** 判。
 *
 * 为什么要这件构造点（**2026-09-26 船长报障**：「**H族专属装备内不含无人机**」）：
 * H 族（墨潮帮）三件专属里有一架**无人机**（`drone-ink-heavy`）——它是**物品**（`kind: 'drone'`），
 * 不是模块。势力图鉴的「专属装备」段原先只查 `ctx.modules` ⇒ 那架机被**静默丢掉**
 * （实测：小节计数写「3 件」、卡只画 2 张）。**件型不是归属的判据**，所以这里把物品卡也做成
 * 与装备/舰船/图纸同一份构造（`app-hand-cell`），让"专属三件"能三种件型混排。
 */
export function itemCellOf(item: ItemDef): GridCell {
  const crest = crestFamOf(item.id)
  return {
    key: item.id,
    tab: 'items',
    // 2026-09-20 零件两档：glyph 用档位键 ⇒ 图鉴里基础/高级零件分色（形状同一枚 part 线稿）
    // ⚠ 2026-09-30：其余物品一律走**物品 id 单点映射**（三件道具在图鉴网格里也要各自的线稿）
    glyph: item.kind === 'part' ? partToneKeyOf(item.id) : itemGlyphName(item.id, item.kind),
    name: item.name,
    sub: `${kindName(item.kind)} · ${item.unitM3} m³`,
    raw: item as unknown as RawData,
    rarity: itemRarityTierOf(item.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}

/** 装备蓝图卡（产物是模块/物品）：副行 = 产物门类 · 产物名；族徽按**产物**判 */
export function blueprintCellOf(engine: GameEngine, bp: BlueprintDef): GridCell {
  const prodMod = bp.moduleId !== undefined ? engine.ctx.modules.get(bp.moduleId) : undefined
  const crest = crestFamOf(bp.moduleId)
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
    ...(crest !== undefined ? { crest } : {}),
  }
}

/** 舰船蓝图卡：副行 = 产物舰名；族徽按**产物舰**判 */
export function shipBlueprintCellOf(engine: GameEngine, bp: ShipBlueprintDef): GridCell {
  const crest = crestFamOf(bp.shipId)
  return {
    key: bp.id,
    tab: 'blueprints',
    glyph: 'blueprint',
    name: bp.name,
    sub: tr("ui.Handbook.249", { p1: engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId }),
    raw: bp as unknown as RawData,
    rarity: itemRarityTierOf(bp.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}

/**
 * **族徽判据与可读名的单点 = `ui/labelsText.ts` 的 `crestFamOf` / `crestLabelOf`**（2026-09-27 迁出）。
 *
 * 迁出原因（**船长 2026-09-27 报障**）：「**物品仓库内的势力装备，左上角没有角标，能否将所有功能
 * 相同的同类型的图标规则进行统一下**」——同款图标卡不止图鉴有，物品页仓库 / 货仓走 `ui/itemView.tsx`
 * 的 `ItemGlyphGrid`，判据与可读名必须**一份实现两处共用**，否则迟早漂（一个标、一个不标）。
 * 源码级护栏 = `tools/ui-attr-check.ts` 的族徽契约（已改为检查**单点文件**）。
 */

/** 详情内容（按页签/数据类型给出完整字段） */
export function DetailBody({ engine, cell }: { engine: GameEngine; cell: GridCell }) {
  const r = cell.raw
  const rows: Array<[string, ReactNode]> = []
  /** 底部脚注（口径说明类文字；**不再冒充属性行** —— 见 ships 分支的说明） */
  let note: ReactNode = null

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
      // ② 「动力」与「无人机舱」的过滤口径**走单点 `shipCodexBaseLines`**（2026-09-27 收口：
      //    此前本分支与「舰船蓝图产物」分支各写一遍、`tools/ui-attr-check.ts` 又抄第三份，三份互不相同）：
      //    滤「动力」（下面的间接属性块会报一次）、**只滤掉无舱船的「无人机舱 = 无」**——
      //    船长 2026-09-27 报障「**而且还缺少无人机舱属性**」，此前这里是**无条件滤掉**，有舱的船也看不到。
      for (const line of shipCodexBaseLines(shipDef)) rows.push([line.k, line.v])
      // 2026-09-12 船长：「手册图鉴里的舰船信息可以查看舰船的间接属性」⇒ 追加间接属性行
      // （动力/跃迁速度/质量/锁定范围/信号半径/扫描分辨率/跃迁充能；与装配页同一数据源）。
      // ⚠ 行以 `k` 作 React key ⇒ `shipIndirectLines` 的键不得与 `shipInfoLines` 重名（当前无重名）。
      for (const line of shipIndirectLines(shipDef)) rows.push([line.k, line.v])
      rows.push([tr("ui.Handbook.315"), Number(r.priceIsk ?? 0) <= 0 ? tr("ui.Handbook.107") : tr("ui.Handbook.108")])
      /**
       * 「已生效战斗数值：抗性按递减方式合成（上限 90%）」是**口径脚注**，不是一项属性 ——
       * 2026-09-27 船长报障：「有一条**意义不明的「说明」属性**」。
       * 原先它被塞成一行 `[「说明」, 这句话]`，混在货舱 / 机动速度这些真属性里 ⇒ 看着莫名其妙。
       * 现改为**脚注**（与舰船悬浮卡 `ShipHover` 同一句话、同一个 `.app-info-note` 类 ⇒ 样式参考同级相似项）。
       */
      note = tr('ui.Handbook.181')
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
        // 2026-09-27：口径**收敛到单点 `shipCodexBaseLines`**（含"无人机舱真有舱才显示"）——
        // 此前本支只滤了「动力」，与档案窗那支并不一致（注释却写着"同口径"）。
        for (const l of shipCodexBaseLines(shipDef)) prodRows.push([l.k, l.v])
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
      {note !== null ? <div className="app-info-note">{note}</div> : null}
    </div>
  )
}

/**
 * **敌舰详情**（**2026-09-26 船长令**：敌人卡「**和其他图鉴中一样，可以点开**」）。
 *
 * 数据全部来自**敌舰自身的定义**（`FoeShipDef`）与既有单点，不在界面里另算一套：
 * - 一句话战术/武器/主副伤/舰载机/精英档 ＋ 特殊装置：`foeBriefLinesOfShip`（与悬赏卡悬停**同一份**）；
 * - 机体数值：三层血占比 `split`、命中 `hitRate`、装填 `reloadMs`、射程带、闪避、基础速度（机动速度）；
 *   ⚠ **不含单发伤害**（船长 2026-09-26：「实际上并没有这个伤害」⇒ 舰级裸值不上面）；
 * - 舰影：`ShipSprite`（敌舰逐舰资产表，与战斗画面同一张；未命中回退族形）。
 *
 * ⚠ 标签复用既有 `ui.*` 词条（舰级 / 护盾 / 装甲 / 结构 / 命中加成 / 回避率 / 射程带 /
 * 装填 / 机动速度 / 特殊装置），**不新造文案、不新取 id**。
 */
export function FoeBody({ cell, engine }: { cell: GridCell; engine: GameEngine }): ReactNode {
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
      {/**
       * ⚠ **不显示「单发伤害」**（**2026-09-26 船长令**：「**敌人的单发伤害不要显示，因为实际上
       * 并没有这个伤害**」）——`FoeShipDef.shotDmg` 是**舰级裸值**，实战单发在战斗建档时经
       * `dmgMul × 多舰船补偿 × 越线折扣 × 逐卡缩放` 才成形，卡面上报它等于报一个不存在的数。
       * 火力大小由上面那行**伤害构成占比**表达；装填仍留着（它是射速口径，不是伤害口径）。
       */}
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

export function CellDetail({
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
  const tone = cell.tone ?? toneOfAny(cell.glyph)
  const marketKey = onGotoMarket ? marketKeyOf(engine, cell) : null
  /**
   * **Esc 关闭**（2026-09-26 优化批）：详情窗是 `role="dialog"` 的覆盖层，此前只有"点窗口外部"
   * 一条关法 ⇒ 纯键盘走不通（全仓也没有全局 Esc 兜底，只有舰船页改名那处自己处理）。
   * 挂 window 上的 keydown，卸载即摘；与遮罩点击走**同一个 `onClose`**，不新增第二条关闭路径。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="app-detail-mask" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div
        className="app-detail"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        /* 无障碍名 = 条目名（读屏进这条时先报"这是什么"）。`aria-modal` 不写：
           本窗不抢焦点、也不锁外部交互，写了反而与"点外面即关"的实际行为不符。 */
        aria-label={cell.name}
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
export function GroupSection({
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
