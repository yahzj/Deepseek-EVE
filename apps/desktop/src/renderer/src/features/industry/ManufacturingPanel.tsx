import { countWare, countModule, manufacturingRunViews, missingMaterials, ownsBlueprint, recipeCapability, canStartBlueprint, sortManuRows, plugCraftUnlockedOf } from '@whale/core'
import type { MaterialNeed } from '@whale/core'
import { Panel } from '@whale/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { ItemHover, ModuleHover } from '../../ui/shipInfo'
import { pinMarked } from '../../ui/marks'
import { AiSlotText } from '../../ui/aiSlots'
import { HintIcon } from '../../ui/Hint'
import { itemGlyphName, partToneKeyOf, toneOf } from '../../ui/Glyphs'
import { ASSEMBLER_CARD_MIN_H, LazyMount, useIdleChunk } from '../../ui/LazyMount'
import { useL10n } from '../../i18n/locale'
import { BLUEPRINT_LEARN_TABS, MANU_TABS_CRAFT, SUB_ALL, manuSubsOf, moduleSubKeyOf, presentSubs, type BlueprintLearnKey, type ManuTabKey } from '../../ui/itemSubs'
import { tr } from '../../i18n/locale'
import { productBaseOf, bookPriceOf } from './blueprintValue'
import { cardLiveKeyOf } from './cardLiveKey'
import { BlueprintCard } from './BlueprintCard'

/**
 * **组装机目录条目**（2026-09-22 第 3 步）。
 * ⚠ 这里**只放"目录级"的字段**（蓝图/产物/价格/排序键），**不许放随引擎心跳变的字段**——
 * 一旦放进来，`useMemo` 出来的模型每拍都会换新引用，卡片上的 `memo` 就永远击穿。
 * 实时数（材料库存、制造线、循环、持有量、徽标）统一走 `cardLiveKeyOf` 的指纹 + 卡片自己现取。
 */
interface ManuItem {
  id: string
  kindLabel: string
  /** 二级子筛选键（装备 = 产物功能分组 / 舰船 = t<级别> / 消耗品 = 产物大类；与 itemSubs 单点同键） */
  subKey: string
  productGlyph: string
  /** 图标色覆盖（零件两档分色；缺省 = toneOf(glyph)） */
  productTone?: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  productLabel: string
  productNode: ReactNode
  productBase: number
  /** 产物"自己有多少"的**取数闭包**（装备库 / 物品仓库 / 舰船仓库口径由模型定，数值每次现取） */
  countOwned: () => number
  /** 产物来处（仓库 / 装备库 / 机库名）——卡面「（×× N）」用 */
  ownedWhere: string
  bookPrice: number
  /** 排序用：**产物唯一键**（`ship:`/`module:`/`item:` + 产物 id）——2026-09-14 船长：
   *  「一次性图纸应该和原图纸放在一起」⇒ 同产物成组，组内原图纸在前 */
  productKey: string
  /** 产物引用（与 `productKey` 同义，拆成 kind + refId 供卡面取行情；见卡片 props 注释） */
  productRef?: { kind: 'module' | 'ship' | 'item'; refId: string }
  /** **一次制造产出件数**（缺省 1；零件 = 10、消耗品 = N 发）——供卡面按整批算利润率（见卡片 props 注释） */
  productUnits?: number
  /** 排序用：本卡是否为**一次性图纸**（`singleUse`） */
  singleUse: boolean
  /** 2026-09-20 零件体系：隐式蓝图（基础零件无需学习） */
  learnless: boolean
  /** 2026-09-20 零件体系：零件档位（排序用：基础零件默认在前） */
  partTier?: 'basic' | 'advanced'
}

export function ManufacturingPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  onGotoPlugExchange,
  onGotoShelf,
  plugExchangeFocus,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  /** 「市场求购蓝图书」跳市场（传市场商品键）；由工业页透传 App 的「去市场」入口 */
  onGotoMarket?: (goodKey: string) => void
  /** 「去虫洞（遗迹打捞）」跳星图 · 出港 · 扫描虫洞（船长 2026-09-14：虫洞专属图纸市场买不到） */
  onGotoWormhole?: () => void
  /** 「前往章鱼人兑换」跳**章鱼人声望商店**（2026-09-26 船长令：插件图纸缺书时走这里） */
  onGotoPlugExchange?: () => void
  /** 「去书架」反向入口（2026-09-26：优3）——由工业页透传，点了切到蓝图书架并高亮那一本 */
  onGotoShelf?: (blueprintId: string) => void
  /** 兑换窗口开过的次数（自增序号）：一开就切到「舰船插件」档（2026-09-26 船长令：
   *  跳转要"跳转到舰船插件的筛选内"） */
  plugExchangeFocus?: number
  /** 蓝图书架「去组装机」的定位目标（蓝图 id）：本面板会**先清掉三级筛选**再高亮那张卡 */
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTabKey>('all')
  /** 视口懒挂载的"首屏块 + 空闲补块"两张尺寸（见 `.app-belt-grid` 那处的说明；船长 2026-09-27 批准） */
  const EAGER_FIRST = 12
  const idleChunk = useIdleChunk(12)
  /**
   * **占位高自适应**（2026-09-27 实测补的）：占位高若与真卡高差太多，网格**行高会随挂载"塌一下"**
   * （一行 4 张，行高 = 该行最高那张 ⇒ 占位偏高时整行先高后矮 = 滚动中跳动）。
   * 用常量 523（CSS 那条 `contain-intrinsic-size` 的旧实测值）在 1600×900 下实测真卡只有 **394** ⇒ 偏高 33%。
   * 故首屏块挂上后**量一次真卡高中位数**，之后的占位一律按它来（同一批卡同版式 ⇒ 比常量准得多）。
   */
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [cardH, setCardH] = useState(ASSEMBLER_CARD_MIN_H)
  useEffect(() => {
    const g = gridRef.current
    if (g === null) return
    const hs = [...g.querySelectorAll<HTMLElement>('.app-belt-card')]
      .map((el) => Math.round(el.getBoundingClientRect().height))
      .filter((h) => h > 80)
    if (hs.length < 4) return
    hs.sort((a, b) => a - b)
    const med = hs[Math.floor(hs.length / 2)] ?? ASSEMBLER_CARD_MIN_H
    setCardH((prev) => (Math.abs(prev - med) >= 8 ? med : prev))
  }, [idleChunk])
  useL10n()
  /**
   * **「蓝图」维度**（原「学会」行，**2026-09-26 船长令**：「**将造船的一次性蓝图筛选移动到学会的筛选内，
   * 并将学会的筛选改名为蓝图。删除原先的图纸筛选**」）。
   *
   * 口径变化：原先拆成两行——第一行「学会：全部/已学会/未学会」、第三行「图纸：全部/永久/一次性」
   * （第三行还**只在选了子类后才出现**）。现在合并成一个维度，键仍是 `BlueprintLearnKey` 的两轴组合：
   * - `learned` / `unlearned`：学会那一轴（原样）；
   * - `learned-single` / `unlearned-single`：**一次性图纸**那一轴并入（原来在第三行选的"一次性"）；
   * - `SUB_ALL`：全部。
   * ⚠ 合并后**不再依赖子类**（原第三行"选完子类才出现"的级联随之取消）⇒ 少一次点击、少一行。
   * ⚠ 落款文案见 `BLUEPRINT_LEARN_TABS`（那一行已改名「蓝图」）。
   */
  const [learn, setLearn] = useState<BlueprintLearnKey>(SUB_ALL)
  /**
   * **组装机搜索栏**（船长 2026-09-19：「也给精炼炉和组装机添加搜索栏」；追问后定范围 =
   * **名称 ＋ 产物/材料 ＋ 说明**）：搜蓝图名、产物名（含产物参数行）、说明，以及**材料名**
   * （"哪张图纸要用这个材料"也搜得到）。与筛选取「与」。
   */
  const [kw, setKw] = useState('')
  const kq = kw.trim().toLowerCase()
  // 二级子筛选（2026-09-11 船长）；切一级标签即回「全部子类」（与市场页 changeKind 同款口径）
  const [sub, setSub] = useState<string>(SUB_ALL)
  /**
   * ⚠ **2026-09-26：第三级「图纸」筛选（一次性/永久）整维已删除**（船长令：「**删除原先的图纸筛选**」）——
   * "一次性/永久"那一轴并进了上面的「蓝图」维度（`learn`），本维连同它的状态与现算表 `usesShown` 一起退场
   * （原注释留档：那一维**只在选了子类后才出现**、且只剩「全部」一项时整行隐藏）。
   */
  /**
   * **「仅看可造」开关**（**2026-09-26 船长令**：优化工业界面）。
   * 与门类/子类那些"选完就收窄"的维度不同：它是**并列的布尔开关**（与「学会」同为属性行），
   * 关着 = 不过滤（默认）；开着 = 只留"现在就能开工"的图纸（判据 = 卡片按钮同一把尺 `canStartNow`）。
   */
  const [craftableOnly, setCraftableOnly] = useState(false)
  /**
   * **书架跳过来的定位**（船长 2026-09-14）：先把三级筛选全部复位（否则目标卡可能正被筛掉 ⇒ 跳过去空白），
   * 高亮由页面层的 `.app-belt-card.is-goto` + 居中滚动负责（与「去精炼」同一套）。
   */
  useEffect(() => {
    if (!focusBlueprintId) return
    setTab('all')
    setSub(SUB_ALL)
    setLearn(SUB_ALL) // 「蓝图」维度也要复位：否则目标卡可能正被「已学会/未学会…」那四档筛掉
  }, [focusBlueprintId])

  /**
   * **「前往章鱼人兑换」之后落到「舰船插件」档**（**2026-09-26 船长令**：跳转要"跳转到舰船插件的
   * 筛选内"）。触发信号 = `plugExchangeFocus`（自增序号，来源两处：组装机那张卡的按钮、首匣通讯的
   * 「前往」）——**只切档、不复位二级**（那一档本来就没有子筛选）。
   */
  useEffect(() => {
    if (!plugExchangeFocus) return
    // 2026-09-26 船长令「不可用的筛选项隐藏」：档都藏了，自然不能再切进去（正常路径下两个入口
    // 都只在"已解锁"时可达——组装机那张卡的按钮与首匣通讯；这条是防御，防日后入口前移）
    if (!plugCraftUnlockedOf(engine.state)) return
    setTab('plug')
    setSub(SUB_ALL)
  }, [plugExchangeFocus, engine])

  /**
   * **目录模型只在"目录本身"变化时重建**（2026-09-22 工业页卡顿修复第 3 步 · 单点在 `cardLiveKeyOf`）。
   *
   * 原先每次渲染（= 每秒 1~2 次引擎心跳）都把 151 条重建一遍、并**当场造 `productNode` ReactNode**
   * ⇒ 每张卡的 props 每次都是新引用 ⇒ 卡片上的 `memo` 必被击穿（等于白加）。
   * 依赖只有目录上下文与蓝图表：`engine.ts` 里这两个字段**只在换语言时一起重建**
   * （`buildSimContext(locale)` + `overlayList(...)`）⇒ 语言相关的卡面字也跟着一起更新。
   *
   * ⚠ **模型里不许放"随心跳变"的字段**（见 `ManuItem` 的说明）：放进来这张 memo 就每拍失效。
   */
  const items = useMemo<ManuItem[]>(() => {
    const out: ManuItem[] = []
  /** 该船型的**总持有**（2026-09-14 舰船仓库批：组装机产出先进仓库 ⇒ 读口径改走 core 单点
   *  `shipOwnedCount` = 舰船仓库 ＋ 在役舰队；原先只数机库，会让"仓里堆着 3 艘"显示成 0）
   *  ⚠ 2026-09-20 零件体系：舰船蓝图已迁入**造船厂**子页（`panels/Shipyard.tsx`），本面板不再渲染舰船。 */
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId !== undefined) continue // 弹药等物品蓝图单独分类
      const moduleDef = engine.ctx.modules.get(bp.moduleId!)
      const prodLabel = moduleDef?.name ?? bp.moduleId!
      // 产物名金色（按类型分色作废，2026-09-13 船长）
      const prodText = <span className="app-gold">{prodLabel}</span>
      const moduleId = bp.moduleId!
      /**
       * 🔴 **舰船插件蓝图归「舰船插件」档，不进「装备」档**（**2026-09-26 船长报障**：
       * 「组装机处也没有舰船插件的门类筛选，反而是多出一个错误的图纸筛选」）。
       *
       * 根因：本函数原先**无条件**把所有"产物是装备"的蓝图都标 `kindLabel = '装备'`，
       * 而一级门类判定 `inTab` 那条三元链里没有 `plug` 分支 ⇒ 选「舰船插件」时落到 else
       * 只认 `'消耗品'` ⇒ **该档一张卡都没有**（看着就是一个空档）。
       * 现在：插件走自己的键（与 `bpFilterKeysOf` 返回的 `tab: 'plug'` 同源），subKey 留空
       * （插件档不二级分类）。
       */
      const isPlugBp = moduleDef?.slot === 'plug'
      out.push({
        id: bp.id,
        kindLabel: isPlugBp ? '舰船插件' : tr('ui.MarketPage.003'), // l10n-keep：前者是内容层联合 key
        // 装备蓝图按**产物功能**分组（2026-09-11 船长：「根据产物的类型进行二次分类」；键与 MODULE_SUBS 同源）
        subKey: isPlugBp ? '' : moduleDef ? moduleSubKeyOf(moduleDef.slot, moduleDef.id) : '',
        productGlyph: moduleDef?.slot ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: moduleDef ? <ModuleHover mod={moduleDef}>{prodText}</ModuleHover> : prodText,
        productBase: moduleDef ? productBaseOf(engine, 'module', moduleId) : 0,
        productRef: { kind: 'module' as const, refId: moduleId },
        countOwned: () => countModule(engine.state, moduleId), // 装备产物 → 装备库件数
        ownedWhere: tr("ui.Industry.004"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `module:${moduleId}`,
        singleUse: bp.singleUse === true,
        learnless: false,
      })
    }
  }
  /** 消耗品蓝图（2026-09-05：基础弹自制；产物为物品按 outputUnits 入仓）
   *  2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——本档实际含弹药 + 修理组件，按**产物大类**再筛
   *  ⚠ 2026-09-20 零件体系：产物为**零件**的蓝图（含隐式蓝图）不在本档，归入「零件」门类。 */
  const pushSupply = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      if (itemDef?.kind === 'part') continue // 零件走 pushPart
      const units = bp.outputUnits ?? 1
      const prodName = itemDef?.name ?? bp.itemId
      const prodLabel = tr("ui.Industry.120", { prodName: prodName, units: units })
      // 产物名金色（按类型分色作废，2026-09-13 船长）；「×N 发」等参数不上色
      /**
       * ⚠ **「×N 发」也要按语言**（**2026-09-30 批 5**）：原先这里是**裸模板串** `` ` ×${units} 发` ``
       * ⇒ 英文界面下弹药产物一律显示「×120 发」（英文扫描实测 2 处）。
       * `ui.Industry.120` 就是同一句的 id（`{prodName} ×{units} 发` / `… rounds`）——
       * 只取它的**量词那半段**：把 `{prodName}` 喂空串再拼金色产物名，视觉与改前一致。
       */
      const unitTail = tr("ui.Industry.120", { prodName: '', units: units })
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {unitTail}
        </>
      )
      const itemId = bp.itemId
      out.push({
        id: bp.id,
        kindLabel: tr("ui.MarketPage.007"),
        subKey: itemDef?.kind ?? '',
        productGlyph: itemGlyphName(itemDef?.id, itemDef?.kind ?? 'blueprint'),
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
        productBase: itemDef ? productBaseOf(engine, 'item', itemId, units) : 0,
        productRef: { kind: 'item' as const, refId: itemId },
        productUnits: units, // 一次产 N 发（利润率按整批算；船长 2026-09-24 报障）
        countOwned: () => countWare(engine.state, itemId), // 弹药/物品产物 → 物品仓库单位数
        ownedWhere: tr("ui.ItemsPage.001"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${itemId}`,
        singleUse: bp.singleUse === true,
        learnless: false,
      })
    }
  }
  /** 零件蓝图（2026-09-20 船长「组装机内新增零件分页」）：产物 kind = `part` 的全部蓝图——
   *  基础 7 张 = 隐式蓝图（无需学习直接造）；高级 7 张 = 正常蓝图（学书后造）。无二级子筛选。 */
  const pushPart = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      if (itemDef?.kind !== 'part') continue
      const prodName = itemDef?.name ?? bp.itemId
      /**
       * ⚠ **产物行要写清"一次生产几件"**（**2026-09-20 船长报障**：「组装机零件的生产卡片内，
       * 产物那边并没有表明是每次生产 10 个对应零件」）：零件 14 张全是 `outputUnits: 10`（每批 10 件、
       * 材料也按 10 件配），消耗品档早有 `×N 发` 这种尾巴、零件档当初漏了 ⇒ 与弹药同一款式补上。
       */
      const units = bp.outputUnits ?? 1
      const prodLabel = tr('ui.Industry.152', { prodName: prodName, units: units })
      // 产物名金色（按类型分色作废，2026-09-13 船长）；「×N 件」等参数不上色
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {tr('ui.Industry.153', { units: units })}
        </>
      )
      const partItemId = bp.itemId
      out.push({
        id: bp.id,
        kindLabel: '零件', // l10n-keep：内容层联合 key（渲染走 kindLabelText）
        // 2026-09-20 零件体系：二级子筛选 = 基础/高级（键 `part-<档>`，单点 `itemSubs.partTierOf`）
        subKey: bp.partTier ? `part-${bp.partTier}` : '',
        productGlyph: 'part',
        productTone: toneOf(partToneKeyOf(itemDef.id)),
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
        productBase: itemDef ? productBaseOf(engine, 'item', partItemId, bp.outputUnits ?? 1) : 0,
        productRef: { kind: 'item' as const, refId: partItemId },
        productUnits: units, // 一次产 10 件（利润率按整批算；船长 2026-09-24 报障）
        countOwned: () => countWare(engine.state, partItemId),
        ownedWhere: '仓库', // l10n-keep：内容层联合 key（渲染走 ownedWhereText）
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${partItemId}`,
        singleUse: bp.singleUse === true,
        learnless: bp.learnless === true,
        partTier: bp.partTier,
      })
    }
  }
  pushEquip()
  pushPart()
  pushSupply()
    return out
  }, [engine.ctx, engine.blueprints])

  /** 本门类判定（一级门类 → 该卡是否在档内）——二级/三级现算与最终过滤共用一把尺 */  const inTab = (kindLabel: string): boolean =>
    /**
     * ⚠ **2026-09-26 修**（船长报障：「组装机处也没有舰船插件的门类筛选，反而是多出一个错误的图纸筛选」）：
     * 这里原先是**按卡片上的中文 key 字符串**做三元链
     * `tab === 'all' || (tab === 'equip' ? '装备' : tab === 'part' ? '零件' : '消耗品')`——
     * 加第 5 档「舰船插件」时它**没有分支**，任何非 equip/part 的档一律落到"只认消耗品"
     * ⇒ 插件档一张卡都不剩。
     * 现在改成走**同一把尺**：`cardTabOf` 从蓝图与产物现算门类（与 `bpFilterKeysOf` 同源，
     * 那张表是"蓝图书架 / 组装机"共用的单点），判据只有一条 `cardTabOf === tab`。
     * 字符串三元链随之删除——**新增门类时只需在 `MANU_TABS_CRAFT` 加一行**，不会再漏分支。
     */
    tab === 'all' || cardTabOf(kindLabel) === tab
  /** 卡片门类（一级档键）：按卡片的中文 key 反查蓝图与产物（查不到 ⇒ 判给「装备」，与改动前的兜底一致） */
  const cardTabOf = (kindLabel: string): ManuTabKey => {
    // l10n-keep：比较用的都是**内容层联合 key**（不是文案）
    if (kindLabel === '舰船插件') return 'plug'
    if (kindLabel === '零件') return 'part'
    if (kindLabel === '消耗品') return 'supply'
    if (kindLabel === '舰船') return 'ship'
    return 'equip'
  }
  /**
   * **二级子类候选：只列本门类下真有卡片的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）——
   * 与蓝图书架同一套现算口径（`presentSubs`）；「全部」档常显（基线②）。
   */
  const subOptions = presentSubs(manuSubsOf(tab), (key) => items.some((it) => inTab(it.kindLabel) && it.subKey === key))
  /**
   * ⚠ **2026-09-26：三级「图纸」那一维连同它的现算表 `usesShown` 一起删除**
   * （船长令：「**删除原先的图纸筛选**」）——"一次性/永久"两轴已并进「蓝图」维度（`learn`）。
   * 原注释留档：那一维**只在选了子类后才出现**、且只剩「全部」一项时整行隐藏。
   */

  /** 可开工判定（与卡片按钮同口径）：已学会（或一次性图纸有货且名额未用尽；隐式蓝图无需学习）+ 材料足
   *  （制造费已取消；劳动者判定由卡片按钮各自表达） */
  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    const su = engine.ctx.blueprints.get(blueprintId)?.singleUse === true
      || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
    if (engine.ctx.blueprints.get(blueprintId)?.learnless === true) {
      return canStartBlueprint(state, engine.ctx, blueprintId) && missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }, blueprintId).length === 0
    }
    if (!ownsBlueprint(state, blueprintId) && recipeCapability(state, blueprintId, su).kind !== 'ok') return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }, blueprintId).length === 0
  }

  const visible = items
    /** 搜索命中（名称 ＋ 产物/材料 ＋ 说明）：`kq` 为空 ⇒ 恒真；与筛选取「与」 */
    .filter((it) => {
      if (kq.length === 0) return true
      if (it.name.toLowerCase().includes(kq)) return true
      if (it.productLabel.toLowerCase().includes(kq)) return true
      if ((it.description ?? '').toLowerCase().includes(kq)) return true
      // 产物大类名也入索引（与物品页搜索同口径：搜「舰船」「消耗品」这类词也能收窄）
      if (it.kindLabel.toLowerCase().includes(kq)) return true
      return it.materials.some((m) => (engine.ctx.items.get(m.itemId)?.name ?? m.itemId).toLowerCase().includes(kq))
    })
    // 「蓝图」维度（**2026-09-27 船长令收口**：删掉「已学会的一次性图纸」、把「未学会的一次性图纸」改名为「一次性蓝图」）
    // 三档各自判：已学会 / 未学会 / 一次性（还没学会 ＋ 是一次性）；隐式蓝图视为已学会（2026-09-20 零件体系）
    .filter((it) => {
      if (learn === SUB_ALL) return true
      const learned = it.learnless || ownsBlueprint(state, it.id)
      if (learn === 'learned') return learned
      if (learn === 'unlearned') return !learned
      // 'single'（一次性蓝图）
      return !learned && it.singleUse
    })
    .filter((it) => inTab(it.kindLabel))
    // 二级子筛选（2026-09-11 船长）：未选子类（SUB_ALL）不过滤
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    /**
     * **「仅看可造」**（**2026-09-26 船长令**：「**对整个工业界面进行下优化。看下是否有优化空间**」）。
     *
     * 为什么加这一条（优化空间就在这里）：组装机是**唯一长列表**（后期档 151 张），而玩家最常问的
     * 不是"我有哪些图纸"，而是"**现在这批料能造什么**"。原先 `canStartNow()` 只喂按钮的可用态
     * （在卡片上逐张判），**做成筛选项的入口一个都没有** ⇒ 只能一张张往下找。
     * 判据与按钮**同一把尺**（同一个 `canStartNow`）⇒ 筛出来的就是真能点的，不会"说能造却点不动"。
     */
    .filter((it) => !craftableOnly || canStartNow(it.id, it.materials, it.buildSeconds))
  // 排序口径（类型 → 价格升序 → 同产物的一次性图纸紧随原图纸）**单点在 core**：
  // `sortManuRows`（2026-09-08 船长定 + 2026-09-14 船长改定；详见 core 该段注释与 `tests/manu-order.test.ts`）
  // 2026-09-10 船长定：已标记（收藏）的蓝图在默认排序下置顶——「全部」标签下会排在类型分组之前
  // （标签本身是筛选、不是排序键，故各处标签都按同一口径置顶）；组内保持类型→价格顺序。
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  /**
   * **有没有任何一维筛选/搜索在生效**（2026-09-26：卡头那两条读数合并的判据）——
   * 三个维度：搜索词 · 蓝图（学会 × 一次性）· 子类，外加「仅看可造」。
   * ⚠ 门类（`tab`）**不算**：它是"看哪一类"的分区，不是"收窄"（默认就在「全部」，
   * 选了门类也只是换一屏内容，卡头照旧该报"这类里有什么"）。
   */
  const filterActive = kq.length > 0 || learn !== SUB_ALL || sub !== SUB_ALL || craftableOnly
  /**
   * **每张卡的实时指纹**（2026-09-22 第 3 步）：心跳只让指纹变了的卡重渲染。
   * 制造线先按蓝图归并一遍（O(线)），再逐卡拼材料/需求/持有量（O(卡×材料)≈1000 次仓库查询，实测很便宜）。
   */
  const runSigByBp = new Map<string, string>()
  for (const v of runViews) {
    if (v.blueprintId === null) continue // 精炼线的 blueprintId 为空（本表只服务组装机卡）
    runSigByBp.set(v.blueprintId, `${runSigByBp.get(v.blueprintId) ?? ''}${v.id}.${Math.round(v.remainingMs / 1000)}.${Math.round(v.percent)}.${v.worker ?? '-'}|`)
  }
  const liveKeyOf = (it: (typeof items)[number]): string =>
    cardLiveKeyOf(engine, it.id, it.materials, runSigByBp.get(it.id) ?? '', it.countOwned())
  // l10n-keep-start：以下 kindLabel 过滤用的都是**内容层联合 key**（不是文案）
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const partN = items.filter((i) => i.kindLabel === '零件').length
  const supplyN = items.filter((i) => i.kindLabel === '消耗品').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.IndustryPage.059")}
      hint={
        // 常驻说明收进标题后的圆形感叹号（2026-09-13 船长口径）；2026-09-14 船长点名："组装机的说明并没有隐藏"
        <HintIcon tip={tr('ui.Industry.150')} />
      }
      right={
        <>
          {/* 搜索栏（船长 2026-09-19）：与精炼炉、物品页/货仓/技能/舰船页/手册同款（标题行右侧） */}
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={tr("ui.Industry.128")}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              spellCheck={false}
            />
          </span>
          <span className="app-dim">
            {/**
             * **两条读数合并成一条**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"删2／优1"）。
             *
             * 原先这里**同时**显示两组数：
             * - `ui.Industry.156` 的分项汇总（制造线 / 装备 / 零件 / 消耗品 / 已学会）——**全目录**口径；
             * - 紧接着 `ui.Industry.127` 的「当前 N 张」——**筛完**口径。
             * 未筛选时两者里的"总数"是同一个数，连读两遍才知道哪个是筛后的 ⇒ 现在**二选一**：
             * - **筛选/搜索生效** ⇒ 只报「当前 N 张」（玩家此刻要知道的就是"筛剩多少"）；
             * - **没筛选** ⇒ 只报分项汇总（此刻要知道的是"池子里都有什么"）。
             */}
            {filterActive
              ? tr('ui.Industry.127', { n: sorted.length })
              : tr('ui.Industry.156', {
                  p1: runViews.length,
                  p2: equipN,
                  p3: partN,
                  p4: supplyN,
                  p5: learnedN,
                })}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      {/* 筛选固定、说明进标题后的圆形感叹号（固定头+下滚）：各筛选行常驻，卡网格独立内滚。
          ⚠ 行序（2026-09-19 丙组）：**学会（并列属性）+ 门类（一级）同排一行 → 子类（二级）→ 图纸（三级）**；
          胶囊行一律「全部」+ 同行灰字前缀（基线①）。
          ⚠ **学会与门类同排**（船长 2026-09-19：「建议和门类放在同一行。除非宽度不够才另外起一行」）——
          `.app-fleet-row` 自带 `flex-wrap: wrap`，窗口窄时门类那组会自动折到下一行，无需另写断点。 */}
      {/* 筛选区（整块外面加 `.app-filter-block` = 与内容之间的**虚线分隔**；背景线不占布局 ⇒ 高宽不变，
          船长 2026-09-19） */}
      <div className="app-filter-block">
      <div className="app-fleet-row">
        <span className="app-dim">{tr('ui.Industry.136')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {BLUEPRINT_LEARN_TABS.map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={learn === l.key}
              className={`app-tasktab${learn === l.key ? ' is-active' : ''}`}
              onClick={() => setLearn(l.key)}
            >
              {tr(l.id)}
            </button>
          ))}
        </div>
        <span className="app-dim">{tr('ui.Industry.134')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {/**
           * **「舰船插件」档在取得第一个黑匣前整档不出现**（**2026-09-26 船长令**：
           * 「**组装机，门类：舰船插件筛选项不可用时，隐藏该选项**」）。
           *
           * 判据走 core 单点 `plugCraftUnlockedOf`（= 见过黑匣；与"解锁组装机插件选项"同一条令）。
           * ⚠ **沿革（本轮改判）**：先前是"标签仍在但置灰不可点 ＋ 悬停写原因"（当时的理由是
           * "让玩家知道有这一档"）⇒ 船长令改为**直接隐藏**：不可用的筛选项不该占位。
           * 因此 `disabled` / 锁定悬停 / 那条 `ui.IndustryPage.117` 提示在本处一并撤掉
           * （该 id 仍被章鱼人兑换窗口的未解锁态使用，不是死条目）。
           * ⚠ **筛选合并批（二号，同日晚）**：本行原先那句 `setUseKind(SUB_ALL)` 随第三级「图纸」筛选
           * **整维删除**而去掉（"一次性/永久"那一轴已并进上面的「蓝图」维度）。
           */}
          {MANU_TABS_CRAFT.filter((t) => t.key !== 'plug' || plugCraftUnlockedOf(engine.state)).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => {
                setTab(t.key)
                setSub(SUB_ALL) // 换一级标签即回「全部子类」（与市场页 changeKind 同款）
              }}
            >
              {tr(t.id)}
            </button>
          ))}
        </div>
        {/**
         * **「仅看可造」开关**（**2026-09-26 船长令**：优化工业界面）——与「学会」同排、贴在门类之后。
         *
         * 为什么放这一排而不是新起一行：它与「学会」同性质（**并列的布尔收窄**，不是层级维度），
         * 且 `.app-fleet-row` 自带 `flex-wrap`（窗口窄了自动折行，不必另写断点）⇒ 不新增行高。
         * 落款走既有胶囊样式（`.app-tasktab` ＋ `is-active`），与两个筛选行**同一套观感**。
         */}
        <span className="app-dim">{tr('ui.IndustryPage.127')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={craftableOnly}
            className={`app-tasktab${craftableOnly ? ' is-active' : ''}`}
            title={tr('ui.IndustryPage.128')}
            onClick={() => setCraftableOnly((v) => !v)}
          >
            {tr('ui.IndustryPage.129')}
          </button>
        </div>
      </div>
      {/* 二级子筛选（2026-09-11 船长：按产物的类型二次分类 / 舰船按舰船级别）——
          复刻舰船页「舰队筛选」那套次级标签样式（app-task-tabs + app-fleet-tabs 去下边框 + app-tasktab 胶囊）；
          「全部」标签不带子筛选（与市场「全部类型」同款）；文案 = 裸「全部」+ 同行前缀（基线①） */}
      {subOptions.length > 0 ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setSub(SUB_ALL)}
            >
              {tr('ui.IndustryPage.001')}
            </button>
            {subOptions.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => setSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      </div>
      <div className="app-win-body">
        <div className="app-belt-grid" ref={gridRef}>
          {sorted.map((it, i) => (
            /**
             * **视口懒挂载**（**2026-09-27 船长令**：「**组装机的卡片太多了，能否采用流式加载？当卡片靠近玩家
             * 屏幕时才加载**」；方案获船长「**按你推荐来**」确认）。三档 eager：
             * ① **首屏块 `EAGER_FIRST` 张**立刻挂（进页先有一屏半真卡，不会一进来就一片空白）；
             * ② **空闲补块 `EAGER_IDLE` 张**（`useIdleChunk`）——滚得快时少看见空白；
             * ③ **被跳转定位的那一张**必须立刻挂（页面那条 `.app-belt-card.is-goto` 居中滚动要能 querySelector 到节点）。
             * 其余交给 `LazyMount` 的 IntersectionObserver（视口上下各 1 屏）。
             */
            <LazyMount
              key={it.id}
              eager={i < EAGER_FIRST + idleChunk || focusBlueprintId === it.id}
              minHeight={cardH}
            >
              <BlueprintCard
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
                productRef={it.productRef}
                productUnits={it.productUnits}
                productGlyph={it.productGlyph}
                productTone={it.productTone}
                productBase={it.productBase}
                countOwned={it.countOwned}
                ownedWhere={it.ownedWhere}
                onNeedMineral={onNeedMineral}
                onGotoMarket={onGotoMarket}
                onGotoWormhole={onGotoWormhole}
                onGotoPlugExchange={onGotoPlugExchange}
                onGotoShelf={onGotoShelf}
                highlighted={focusBlueprintId === it.id}
                learnless={it.learnless}
                /** 实时指纹：只有它变了的卡才会真正重渲染（详见 `cardLiveKeyOf` 的说明） */
                liveKey={liveKeyOf(it)}
              />
            </LazyMount>
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">{tr("ui.Industry.093")}</div>
        ) : null}
      </div>
    </Panel>
  )
}
