/**
 * 物品表（M1 + V10 扩容）：矿石 / 矿物 / 气体 / 冰矿 / 弹药 / 无人机。
 *
 * 数值设计（中文说明）：
 * - 矿石/气体/冰矿 1 单位占 1 m³ 货舱，矿物精炼后体积骤减（0.01 m³/单位）；
 * - 精炼配方 = 「产出倍率基准下每 1 单位资源的矿物产出」（玩家口径：产出倍率，旧称收率；
 *   balance.refining 基础倍率 1.2（无技能净率 ≈+20%）、精炼学 +6%/级、高级回收处理 +3%/级、
 *   满级倍率 1.65（技能本身每级加成较原值下调约 20%）。2026-09-08 工业工位收益体检再定
 *   （配方仍按倍率 1.0 时代的 perOre 值，由引擎倍率驱动产值；perOre 取整允许 ±2pp 漂移）；
 * - 新矿物只由新资源产出 → 不稀释旧矿价值；V10 起高价值采集点需协会声望（见 belts.ts）；
 * - 弹药/无人机为占位消耗品：市场流通、可囤可回卖，战斗系统开放后启用消耗。
 */

import type { ItemDef } from '@whale/core'

/** 矿石（可精炼） */
export const ORES: readonly ItemDef[] = [
  {
    id: 'ore-veldspar',
    name: '橄榄岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 13,
    description: '最常见的低品位原矿，遍布新手星域，是起步的第一桶金。',
    refine: [
      { mineralId: 'min-tritanium', perOre: 1.175 },
      { mineralId: 'min-pyerite', perOre: 0.34 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 10_000,
  },
  {
    id: 'ore-scorched',
    name: '辉长岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 18,
    description: '熔岩包裹的致密原矿，银纹超金属与晶态胶体的重要来源。',
    refine: [
      { mineralId: 'min-pyerite', perOre: 0.985 },
      { mineralId: 'min-mexallon', perOre: 0.35 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 12_000,
  },
  {
    id: 'ore-hemorphite',
    name: '赤环岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 55,
    description: '红色星环内的高价值原矿，航线更长，回报也更丰厚。',
    refine: [
      { mineralId: 'min-nocxium', perOre: 0.53 },
      { mineralId: 'min-tritanium', perOre: 1.445 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 14_000,
  },
  {
    id: 'ore-glowstone',
    name: '辉云岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 150,
    description: '泛着幽光的致密岩层，同位聚晶的主要载体——环心矿区的高纯产出。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.64 },
      { mineralId: 'min-tritanium', perOre: 2.15 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 26_000,
  },
  {
    id: 'ore-sunshard',
    name: '曦棱晶',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 115,
    description: '棱面折射晨光的晶体原矿，高纯度同位聚晶的富矿层。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.075 },
      { mineralId: 'min-pyerite', perOre: 0.77 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 30_000,
  },
  {
    id: 'ore-voidshard',
    name: '玄晶',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 340,
    description: '深空裂隙中凝结的黑色晶体，孕育冥铁合金的母矿。',
    refine: [
      { mineralId: 'min-starcore', perOre: 1.185 },
      { mineralId: 'min-darkiron', perOre: 0.095 },
      { mineralId: 'min-nocxium', perOre: 0.24 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 45_000,
  },
  {
    id: 'ore-nebulite',
    name: '星幽矿',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 490,
    description: '只有星云深处的矿脉才出产的传说级原矿，一舱就能换一艘船。',
    refine: [
      { mineralId: 'min-darkiron', perOre: 0.5 },
      { mineralId: 'min-starcore', perOre: 0.685 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 50_000,
  },
  {
    /**
     * **虚空母矿**（2026-09-12 船长定 · 虫洞线的唯一原矿）。
     *
     * 船长原话：「虚空晶添加一个原矿石用于精炼出虚空晶。原矿石采取正常矿石体积（**1 m³/单位**），
     * 虚空晶保持不变」＋「虫洞内只能获得原矿」。
     * ⚠ 后半句（「只能获得原矿」）**已于 2026-09-13 由船长删除**（「**「虫洞内只掉原矿」删除。残骸能进背包。**」）
     * ⇒ 洞内现在也掉**残骸类**（墓场/遗迹打捞产物，见设计稿 §11.5）；本矿仍是洞内唯一的**原矿**。
     *
     * 口径：
     * - **虚空晶本身一字未动**（`unitM3 0.01` · `baseSellPriceIsk 1,800`）——变的只是**来源**：
     *   今后它从这本原矿精炼出来，而不是从市场稀缺口 / 残骸彩头直接给；
     * - 精炼产出 = 虚空晶 **0.25** + 副产物（同位聚晶 1.0 · 星髓晶 0.25）⇒ 每单位产出价值
     *   `0.25×1800 + 1.0×55 + 0.25×245 = **566.25 信用点**`。
     *   ⚠ **2026-09-14 船长：「然后精炼炉，虚空晶的产出量下调到一半」** ⇒ 虚空晶由 **0.5 → 0.25**
     *   （副产物与价格一律不动；基础卖价 915 亦按"价格不动"保留）。半量后每单位母矿的两条路变成
     *   「卖原矿 ≈780 现金（站内收购）」vs「炼成三件套再卖 ≈566」⇒ **炼不如卖**：这是船长要的
     *   "虚空晶更稀缺"的直接后果（洞内 24 张蓝图 + 皇带鱼级都以虚空晶为主料，挖矿量相应翻倍）；
     *   "要虚空晶就得自己炼"这条主线不受影响。
     * - **2026-09-14 船长：「虚空晶和虚空母矿也添加只收不卖」「市场不会出现虚空晶和母矿的卖单」**
     *   ⇒ 市场两行 `playerBuyable: false`（见 `marketCatalog.ts`）：**买不到**、**NPC 一笔卖单都不铺**
     *   （`core/market.ts seedCommonBook`），但**照常收购**。原有的"买入精炼不赚"防套利论证随之退休
     *   （这条路已经封死）。
     * - **虫洞落地前对玩家不可见**：**两道闸门都要标**——
     *   a) 市场卡 `unreleased`（见 `marketCatalog.ts`）⇒ 挡在市场/图鉴/挂单/任务/事件之外；
     *   b) **物品卡 `unreleased`**（2026-09-13 补）⇒ 挡在工业页「可精炼资源」网格、
     *      舰船页 AI 精炼炉下拉、组装机材料提示、手册物品图鉴之外。
     *   ⚠ 首版只标了 a)：实测**这本矿连卡带"虫洞"描述一起挂在工业页可精炼资源里**（玩家可见泄露）。
     *   虫洞上线时把两个字段一起去掉即可（2026-09-14 已上线 ⇒ 两道闸门都已撤）。
     */
    id: 'ore-voidmother',
    name: '虚空母矿',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 915,
    description: '深空裂隙里结出的黑色母岩，炼得出虚空晶。',
    refine: [
      { mineralId: 'min-voidcrystal', perOre: 0.25 }, // 2026-09-14 船长：产出量下调到一半（原 0.5）
      { mineralId: 'min-isotope', perOre: 1.0 },
      { mineralId: 'min-starcore', perOre: 0.25 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 60_000,
  },
]

/**
 * **遗迹安全货柜**（F4 · 船长 2026-09-13：「装备和蓝图的产出加一个中间件：玩家从遗迹获得
 * 『遗迹安全货柜』，货柜体积是 2000 立方（也就是 4 格），将安全货柜带回后在精炼炉拆解」）。
 *
 * 口径：
 * - **按族各一种**（A/C/D/E/G）——保住「专属掉落按种族库走」这条裁定：拆解时才知道内容物，
 *   但**族信息不能丢**，所以族写在物品 id 与名字里；
 * - **2000 m³ / 件，占货仓 2×2 = 4 格**（`packages/core/src/wormholeHold.ts` 的形状表已登记这 5 个 id）；
 * - **市场口径**（2026-09-14 船长改判）：它**可带回、可拆解、也可换现** ⇒ 市场**只收不卖**
 *   （`playerBuyable: false`——玩家不能买箱子，否则花钱就能买、把洞内打捞这条渠道架穿）；
 *   **基础价 = 该族内容期望市值 ×0.6**（真引擎 `wormholeUnboxRoll` 抽 4000 次量得，与 `baseSellPriceIsk` 同值）。
 *   ⚠ 2026-09-14 之前这里写着"施工期一律 unreleased、上线动作 = 删字段"——那批字段上线时删掉了，
 *   结果这 8 行**变成 1 信用点的常驻现货**（船长报障「谜质出现在了市场内…并且可以购买」的同源问题）。
 */
export const RELIC_CONTAINERS: readonly ItemDef[] = [
  {
    id: 'box-relic-a',
    name: '遗迹安全货柜（海盗）',
    kind: 'container',
    unitM3: 3000, // 2026-09-15 船长「将安全货柜大小增加到6格」：2000（2×2=4 格）→ **3000（3×2=6 格）**
    baseSellPriceIsk: 3_232_500, // 2026-09-15 船长「安全货柜价格允许提升」：体积 ×1.5 同比例提价（原 2_155_000）
    description:
      '从遗迹里拖出来的整箱货柜：外壳带锁、标记已被磨掉，只有回站拆开才知道里面是什么。占货仓 2×2 格。',
  },
  {
    id: 'box-relic-c',
    name: '遗迹安全货柜（异形）',
    kind: 'container',
    unitM3: 3000, // 2026-09-15 船长「将安全货柜大小增加到6格」：2000（2×2=4 格）→ **3000（3×2=6 格）**
    baseSellPriceIsk: 3_352_500, // 2026-09-15 船长「安全货柜价格允许提升」：体积 ×1.5 同比例提价（原 2_235_000）
    description:
      '从遗迹里拖出来的整箱货柜：外壁挂着干涸的生物膜，只有回站拆开才知道里面是什么。占货仓 2×2 格。',
  },
  {
    id: 'box-relic-d',
    name: '遗迹安全货柜（守墓）',
    kind: 'container',
    unitM3: 3000, // 2026-09-15 船长「将安全货柜大小增加到6格」：2000（2×2=4 格）→ **3000（3×2=6 格）**
    baseSellPriceIsk: 6_112_500, // 2026-09-15 船长「安全货柜价格允许提升」：体积 ×1.5 同比例提价（原 4_075_000）
    description:
      '从遗迹里拖出来的整箱货柜：封条上还留着守墓者的印记，只有回站拆开才知道里面是什么。占货仓 2×2 格。',
  },
  {
    id: 'box-relic-e',
    name: '遗迹安全货柜（巨构）',
    kind: 'container',
    unitM3: 3000, // 2026-09-15 船长「将安全货柜大小增加到6格」：2000（2×2=4 格）→ **3000（3×2=6 格）**
    baseSellPriceIsk: 4_927_500, // 2026-09-15 船长「安全货柜价格允许提升」：体积 ×1.5 同比例提价（原 3_285_000）
    description:
      '从遗迹里拖出来的整箱货柜：外壳是巨构自己的合金，接口仍在待机，只有回站拆开才知道里面是什么。占货仓 2×2 格。',
  },
  {
    id: 'box-relic-g',
    name: '遗迹安全货柜（亡军）',
    kind: 'container',
    unitM3: 3000, // 2026-09-15 船长「将安全货柜大小增加到6格」：2000（2×2=4 格）→ **3000（3×2=6 格）**
    baseSellPriceIsk: 4_815_000, // 2026-09-15 船长「安全货柜价格允许提升」：体积 ×1.5 同比例提价（原 3_210_000）
    description:
      '从遗迹里拖出来的整箱货柜：箱体被蜂群啃过又焊上，只有回站拆开才知道里面是什么。占货仓 2×2 格。',
  },
]

/**
 * **图纸货柜**（2026-09-14 船长定：虫洞遗迹打捞新增）。
 *
 * 口径（船长逐条裁定）：
 * - **占货仓 2×1 = 2 格**（`packages/core/src/wormholeHold.ts` 的形状表已登记这 3 个 id）·
 *   **1000 m³ / 件**（与安全货柜同尺：货仓规则是 **500 m³/格**，2000 m³ = 4 格 ⇒ 1000 = 2 格）；
 * - **三种 = 层档**：浅层（第 2 层）· 中层（第 3~4 层）· 深层（第 5 层起）。
 *   ⚠ **层档必须写进物品 id**：拆解读的是精炼炉产线记录里的 `itemId`，而货柜撤离后进仓库
 *   只剩「物品 id + 数量」⇒ 层信息无处可挂。好在稀释池的层门槛是 2/3/5，**三段精确等价**。
 * - **内容物**（拆解时揭）：一次性舰船图纸（T3 / T4 / T5，按层档过滤）+ **5%** 永久图纸（T3 / T4）；
 * - **市场口径**（2026-09-14）：与安全货柜同款——**只收不卖** + 基础价 = 内容期望市值 ×0.6。
 *   ⚠ 这三种箱子"贵"是**内容决定的**（船长问过「为什么图纸货柜那么贵」）：深箱 EV 4,326 万里
 *   **单张皇带鱼一次性图纸（3.2 亿 × 6.3% 出货）就占 46%**；该定价锚由船长选定「维持 EV×0.6」。
 */
export const BLUEPRINT_CONTAINERS: readonly ItemDef[] = [
  {
    id: 'box-bp-shallow',
    name: '图纸货柜（浅层）',
    kind: 'container',
    unitM3: 1000,
    baseSellPriceIsk: 3_595_000, // 2026-09-14：与市场行同值（全表惯例）＝ 内容期望市值 ×0.6
    description:
      '从遗迹里拖出来的长条货柜：外壳印着制式编号，接口还是热的，只有回站拆开才知道里面压着哪张图纸。占货仓 2×1 格。',
  },
  {
    id: 'box-bp-mid',
    name: '图纸货柜（中层）',
    kind: 'container',
    unitM3: 1000,
    baseSellPriceIsk: 14_045_000, // 2026-09-14：与市场行同值（全表惯例）＝ 内容期望市值 ×0.6
    description:
      '从遗迹里拖出来的长条货柜：编号被人为磨去一半，比浅层那种压手得多。占货仓 2×1 格。',
  },
  {
    id: 'box-bp-deep',
    name: '图纸货柜（深层）',
    kind: 'container',
    unitM3: 1000,
    baseSellPriceIsk: 25_840_000, // 2026-09-14：与市场行同值（全表惯例）＝ 内容期望市值 ×0.6
    description:
      '从遗迹里拖出来的长条货柜：铭牌上还留着旧主人的舰徽，封条完好无损。占货仓 2×1 格。',
  },
]

/** 矿物（精炼产物，可出售；制造原料） */
export const MINERALS: readonly ItemDef[] = [
  {
    id: 'min-tritanium',
    name: '钛钢合金',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 8,
    description: '舰船装甲的基本原料，量大价稳。',
  },
  {
    id: 'min-pyerite',
    name: '银纹超金属',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 12,
    description: '结构与电子组件的常用材料。',
  },
  {
    id: 'min-mexallon',
    name: '晶态胶体',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 20,
    description: '高端设备与护盾模组的原料。',
  },
  {
    id: 'min-nocxium',
    name: '重钨合金',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 90,
    description: '稀有原材料，制造旗舰级部件的核心。',
  },
  {
    id: 'min-isotope',
    name: '同位聚晶',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 55,
    description: '辉云/曦棱层系的精炼核心，高端工业的入门级新材料。',
  },
  {
    id: 'min-starcore',
    name: '星髓晶',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 245,
    description: '星髓凝晶，MK3 级装备与旗舰舰船骨架的必需材料。',
  },
  {
    id: 'min-darkiron',
    name: '冥铁合金',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 780,
    description: '玄晶与暗星冰才炼得出的重合金，顶级工业的象征。',
  },
  {
    id: 'min-voidcrystal',
    name: '虚空晶',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 3_600, // 2026-09-15 船长「调整虚空晶的价格，让现在精炼虚空母矿不会显示亏本」：1,800 → **3,600**（面板口径：每批 100 母矿耗料 91,500，产出 25 虚空晶 + 100 同位聚晶 + 25 星髓晶；盈亏平衡价 **3,195**，取 3,600 留约 13% 余量 ⇒ 净 +10,125/批）
    description: '全宇宙最稀有的原材料，只有传说级制造项目才用得起。',
  },
]

/** 气体（可采集可精炼；V10 新资源类） */
export const GASES: readonly ItemDef[] = [
  {
    id: 'gas-neon',
    name: '氖云气',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 85,
    description: '低重力气田的氖氦混合云，采集容易，同位聚晶的重要来源。',
    refine: [
      { mineralId: 'min-isotope', perOre: 1.43 },
      { mineralId: 'min-tritanium', perOre: 0.92 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 18_000,
  },
  {
    id: 'gas-phosphor',
    name: '磷光霾',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 330,
    description: '坟场深处沉淀的腐蚀性磷光霾云——提炼价值极高的稀有气藏。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.29 },
      { mineralId: 'min-starcore', perOre: 0.81 },
      { mineralId: 'min-mexallon', perOre: 0.63 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 24_000,
  },
  {
    id: 'gas-ionstorm',
    name: '离子风暴云',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 230,
    description: '狂暴离子流内部反而凝集着纯净的星髓晶——敢进去的人才拿得到。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.77 },
      { mineralId: 'min-darkiron', perOre: 0.065 },
      { mineralId: 'min-isotope', perOre: 0.315 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 20_000,
  },
  {
    id: 'gas-aurora',
    name: '极光云',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 330,
    description: '极光粒子云团，传说其中沉淀着冥铁与星髓的混合物。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.735 },
      { mineralId: 'min-darkiron', perOre: 0.25 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 28_000,
  },
]

/** 冰矿（可采集可精炼；V10 新资源类） */
export const ICES: readonly ItemDef[] = [
  {
    id: 'ice-frost',
    name: '蓝霜冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 150,
    description: '蓝白色寒冰星环的碎块，冰层里封存着高纯度同位聚晶。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.475 },
      { mineralId: 'min-mexallon', perOre: 0.73 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 33_000,
  },
  {
    id: 'ice-marrow',
    name: '寒髓冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 230,
    description: '冰核深处呈现髓质纹理的古老冰层，星髓晶藏量可观。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.66 },
      { mineralId: 'min-isotope', perOre: 1.21 },
      { mineralId: 'min-mexallon', perOre: 0.44 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 48_000,
  },
  {
    id: 'ice-darkstar',
    name: '暗星冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 360,
    description: '吸收光线的黑色冰晶，暗星冰环深处才有的珍品。',
    refine: [
      { mineralId: 'min-darkiron', perOre: 0.295 },
      { mineralId: 'min-starcore', perOre: 0.55 },
      { mineralId: 'min-isotope', perOre: 0.915 },
    ],
    // 2026-09-09 顶阶档校准：58/8s 会使 120% 产出倍率净率 135.9% 超护栏(≤135%)——取 42/5.8s
    // （吞吐 ≈26,069/h，净率 132.7% 带内；min-darkiron 高价使 floor 阶梯敏感）
    refineBatchUnits: 100,
    refineCycleMs: 60_000,
  },
]

/** 弹药（V10.5 战斗数值契约就位：克制体系见 docs/design/v10b-combat-data.md；
 * 动能弹对护盾 ×1.5 对装甲 ×0.75、爆破导弹（爆炸）反之、能量弹药（能量系）对护盾 ×1.25 其余 ×1.0；
 * V18 口径取消：每型只留单档通用弹；V18B-1/2：高爆弹更名"爆破导弹"（导弹架专用）、
 * 等离子弹更名"能量弹药"（激光炮专用）——武器形态与弹药一一对应） */
export const AMMO: readonly ItemDef[] = [
  {
    id: 'ammo-kinetic-l',
    name: '动能弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 6,
    description: '动能弹：实心高速弹，破盾专精（对护盾 ×1.5、对装甲 ×0.75）。',
    damageType: 'kinetic',
    dmg: 6,
  },
  {
    id: 'ammo-explosive-l',
    name: '爆破导弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 7,
    description: '爆破导弹：导弹架专用弹药，拆甲专精（对装甲 ×1.5、对护盾 ×0.75）。导弹无视近盲、命中不随距离衰减。',
    damageType: 'explosive',
    dmg: 7,
  },
  {
    id: 'ammo-plasma-l',
    name: '能量弹药',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 8,
    description: '能量弹药：激光炮专用高能电池弹——光束必中、对护盾 ×1.25、对甲/结构 ×1。',
    damageType: 'plasma',
    dmg: 9,
  },
  /* ═══ 弹药 MK2（2026-09-09 船长拍板：三族各出一档高级版——纯数值上级、克制表同基础；
   * dmg 8/9/12、市场 45/60/80、蓝图书稀有可造；装配页按族选档、连打消耗当前配置弹） ═══ */
  {
    id: 'ammo-kinetic-2',
    name: '动能弹 MK2',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 45,
    description: '动能弹 MK2：高密度穿甲弹芯的实心高速弹，破盾专精（对护盾 ×1.5、对装甲 ×0.75）。攻坚用高级弹药。',
    damageType: 'kinetic',
    dmg: 8,
  },
  {
    id: 'ammo-explosive-2',
    name: '爆破导弹 MK2',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 60,
    description: '爆破导弹 MK2：双级聚能装药的导弹架专用弹，拆甲专精（对装甲 ×1.5、对护盾 ×0.75）。导弹无视近盲、命中不随距离衰减。',
    damageType: 'explosive',
    dmg: 9,
  },
  {
    id: 'ammo-plasma-2',
    name: '能量弹药 MK2',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 80,
    description: '能量弹药 MK2：高密度充能电池弹——光束必中、对护盾 ×1.25、对甲/结构 ×1。激光炮攻坚专用。',
    damageType: 'plasma',
    dmg: 12,
  },
]

/** 无人机（V10.5 战斗数值契约就位：自带伤害源不耗弹；放飞占用船体 CPU——V10.5b 带宽并入；
 * 携带上限受无人机舱容积（ship.droneBayM3）与 CPU 双约束；defense（V11）= 三层血量/回避契约，
 * v1 并入主船火力不单独承伤，"可被击落"机制启用时零迁移）
 * 体积档（2026-09-09 船长拍板）：unitM3 按机种大小分 5/10/20/40 四档——机巢能装几架由体积主导
 * （小护卫带蜂鸟/赤鸢、炮舰带猎鹰、母舰带雷鸥；甲板扩展 +m³ 恢复意义），每架 CPU 不变 */
export const DRONES: readonly ItemDef[] = [
  {
    id: 'drone-scout',
    name: '蜂鸟侦察无人机',
    kind: 'drone',
    unitM3: 5, // 体积档 1/4：轻型侦察机（2026-09-09 船长：体积 5/10/20/40 四档，机巢架数由体积主导）
    baseSellPriceIsk: 900,
    description: '轻型侦察无人机：动能点射（破盾）。机体轻快——闪避最高、装甲最薄。',
    damageType: 'kinetic',
    dmg: 3,
    cpuUse: 4,
    maxRangeM: 4000, // 射程分类 1/4：近身护航（2026-09-10 船长：前三型大幅缩减、哨戒独享远程）；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    droneClass: 'scout', // 2026-09-10 分类入本体：「种类」显示 无人机 · 侦察机
    hitRate: 0.75, // 2026-09-10 船长：轻型机群命中 0.6→0.75
    falloff: 1, // 2026-09-10 船长：侦察/战斗/攻坚三型**命中不随距离衰减**（射程带内恒定）
    defense: { shieldHp: 12, armorHp: 6, hullHp: 20, evasion: 0.45 },
  },
  {
    id: 'drone-assault',
    name: '赤鸢战斗无人机',
    kind: 'drone',
    unitM3: 10, // 体积档 2/4：轻型战斗（2026-09-09 船长：体积 5/10/20/40 四档）
    baseSellPriceIsk: 2200,
    description: '轻型战斗无人机：高爆打击（拆甲）。属性均衡——机群的主力机型。',
    damageType: 'explosive',
    dmg: 6,
    cpuUse: 7,
    maxRangeM: 4500, // 射程分类 2/4：中近缠斗（2026-09-10 船长）；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    droneClass: 'combat', // 2026-09-10：无人机 · 战斗机
    hitRate: 0.75, // 2026-09-10 船长
    falloff: 1, // 命中不随距离衰减
    // 2026-09-10 定位调整：属性平均档（闪避 25%、血居中）
    defense: { shieldHp: 24, armorHp: 16, hullHp: 40, shieldResist: { kinetic: 0.1 }, evasion: 0.25 },
  },
  {
    id: 'drone-heavy',
    name: '猎鹰攻坚无人机',
    kind: 'drone',
    unitM3: 20, // 体积档 3/4：重型攻坚（2026-09-09 船长：体积 5/10/20/40 四档）
    baseSellPriceIsk: 5000,
    description: '重型攻坚无人机：能量脉冲（通用）。厚甲重击——血量最厚、闪避最低。',
    damageType: 'plasma',
    dmg: 12,
    cpuUse: 11,
    maxRangeM: 5000, // 射程分类 3/4：攻坚中程（2026-09-10 船长）；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    droneClass: 'assault', // 2026-09-10：无人机 · 攻坚机
    hitRate: 0.75, // 2026-09-10 船长
    falloff: 1, // 命中不随距离衰减
    // 2026-09-10 定位调整：血量最厚（97）+ 闪避最低（10%）+ 装甲向抗性（抗拆甲）
    // 2026-09-12 船长裁决：「**给攻坚无人机添加 25% 全抗性**」⇒ 三层 × 三系**全抗 25%**
    //（取代原来的"甲抗爆炸 0.15 / 结构抗动能 0.05"两处零散抗性——攻坚机 = 硬、慢、挨打抗）。
    defense: {
      shieldHp: 60,
      armorHp: 44,
      hullHp: 90,
      shieldResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 },
      armorResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 },
      hullResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 },
      evasion: 0.1,
    },
  },
  {
    id: 'drone-sentry',
    name: '雷鸥哨戒无人机',
    kind: 'drone',
    unitM3: 40, // 体积档 4/4：重型哨戒（2026-09-09 船长：体积 5/10/20/40 四档）
    baseSellPriceIsk: 9500,
    description: '哨戒无人机：重型能量炮组，航程极远——但距离越远越难命中；机体轻薄，生存与侦察机相仿。',
    damageType: 'plasma',
    dmg: 20,
    cpuUse: 16,
    maxRangeM: 6500, // 射程分类 4/4：远程哨戒（2026-09-10 船长——哨戒独享远程，兑现"航程极远"）；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    reloadMs: 8800, // 2026-09-11 船长「哨卫将攻击周期翻倍」：4400 → **8800**（哨戒机不再会被攻击 ⇒ 削 DPS）
    droneClass: 'sentry', // 2026-09-10：无人机 · 哨戒机
    hitRate: 1.1, // 2026-09-10 船长：哨戒基础命中 110%（近距被 100% 上限截断，用于抵消回避）
    falloff: 0.35, // 2026-09-10 船长：哨戒**保留正常命中衰减**（射程端点 ×0.35）——独有代价
    // 2026-09-10 定位调整：血量与侦察机相仿（23）+ 闪避次低（18%）——狙击平台靠距离活命
    defense: { shieldHp: 16, armorHp: 10, hullHp: 20, shieldResist: { kinetic: 0.1 }, evasion: 0.18 },
  },
  // ══════════ 专属机型（2026-09-10 船长：G 族「鱿蜂群巢」改为专属侦查无人机） ══════════
  // 只在敌族窝点 → 稀有残骸 → 高级箱这条链路上产出（exclusive：无蓝图、不上市场、不入常规掉落池）；
  // 无人机是消耗品（会被点防击落、永久损失），故**一次掉一批 ×10 架**，打光之后再刷可补。
  {
    id: 'drone-exile-bee',
    name: '鱿蜂无人机',
    kind: 'drone',
    unitM3: 5, // 轻型侦察机档（与蜂鸟同体积）
    baseSellPriceIsk: 24_000, // 2026-09-14 船长「专属 ×4」：6,000 → 24,000（与市场行同值）
    description:
      '流亡者从残舰机库里拼出来的侦查无人机：单发比制式侦察机重一倍、机体更飘，放飞更省电。代价是三层血最薄——挨一下就没了。',
    damageType: 'kinetic', // 侦察机档：动能点射（破盾）
    dmg: 6, // 2026-09-10 船长裁决：A 档基础上「输出提高到 6 点」（专属强化型，契约登记豁免）
    cpuUse: 5, // 船长裁决：随单发上调（仍低于制式战斗机赤鸢的 7）
    maxRangeM: 4000, // 侦察机档：近身护航；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    droneClass: 'scout', // 侦察机（「种类」显示：无人机 · 侦察机）
    hitRate: 0.75,
    falloff: 1, // 侦察机档：命中不随距离衰减
    defense: { shieldHp: 12, armorHp: 6, hullHp: 12, evasion: 0.55 }, // 三层血 15（最薄）+ 闪避最高
    exclusive: true,
  },
  // ══════════ 虫洞族专属机型（2026-09-13 船长：C 移「活性甲壳层」/ E 移「巨构稳态器」⇒ **换成族专属无人机**，
  // 不用制式机。两型都走"专属强化型"口径（`exclusive`：无蓝图、不上市场、不入常规掉落）＋施工期 `unreleased`） ══════════
  {
    id: 'drone-wh-c-heavy',
    name: '巢卫攻坚无人机',
    kind: 'drone',
    unitM3: 20, // 体积档 3/4：重型攻坚（与制式攻坚机同档）
    baseSellPriceIsk: 48_000, // 2026-09-14 专属 ×4：12,000 → 48,000
    description:
      '巢群的活体攻坚机：孢子爆裂弹头拆甲，三层血比制式攻坚机更厚且偏甲壳，装甲与结构的抗性也更硬——代价是更笨重。',
    damageType: 'explosive', // 族弹型权威：C 族 = 等离子 8 / 爆炸 2 ⇒ 爆炸在族内（且呼应本族「孢子导弹巢」）
    dmg: 15, // 制式攻坚机 12 ⇒ +25%（专属强化型，豁免区间校验、只受硬边界约束）
    cpuUse: 12,
    maxRangeM: 5100, // **专属射程豁免**（船长 2026-09-13「专属无人机开豁免」）：档位标准 3500 ⇒ 3,600（+100m）；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    droneClass: 'assault', // 攻坚机
    hitRate: 0.78,
    falloff: 1, // 攻坚机档：命中不随距离衰减
    // 2026-09-13 船长：「C 组无人机护甲和结构抗性提高 10%」⇒ 护甲/结构抗性 0.25 → **0.35**，护盾维持 0.25
    defense: {
      shieldHp: 50,
      armorHp: 70,
      hullHp: 120, // 三层血 240（制式 194 ⇒ +24%），偏甲/壳
      shieldResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 },
      armorResist: { kinetic: 0.35, explosive: 0.35, plasma: 0.35 },
      hullResist: { kinetic: 0.35, explosive: 0.35, plasma: 0.35 },
      evasion: 0.08, // 厚而慢（制式 0.10）
    },
    exclusive: true,
  },
  {
    id: 'drone-wh-e-sentry',
    name: '构件哨戒无人机',
    kind: 'drone',
    unitM3: 40, // 体积档 4/4：重型哨戒（与制式哨戒机同档）
    baseSellPriceIsk: 88_000, // 2026-09-14 专属 ×4：22,000 → 88,000
    description:
      '巨构自组装的长针哨戒机：动能长针拆盾，航程比制式哨戒机更远，命中更高、远端衰减更缓，机体也略厚——它是机群里射得最远的一型。',
    damageType: 'kinetic', // 族弹型权威：E 族 = 动能 5 / 爆炸 5 ⇒ 动能在族内（呼应本族「巨构导控塔/近防阵列」）
    dmg: 24, // 制式哨戒机 20 ⇒ +20%（专属强化型）
    cpuUse: 18,
    maxRangeM: 7500, // **专属射程豁免**（船长 2026-09-13「专属无人机开豁免」）：档位标准 5000 ⇒ 6,000（哨戒区间上限）；2026-09-14 +1500（船长「只有我方无人机，射程+1500」）
    reloadMs: 8800, // 沿用"哨戒机攻击周期翻倍"口径（与制式同）
    droneClass: 'sentry', // 哨戒机
    hitRate: 1.15,
    falloff: 0.4, // 哨戒机保留命中衰减（独有代价），比制式 0.35 略缓
    defense: {
      shieldHp: 28,
      armorHp: 14,
      hullHp: 18, // 三层血 60（制式 46 ⇒ +30%），偏盾
      shieldResist: { kinetic: 0.2 },
      armorResist: { kinetic: 0.1 },
      hullResist: { kinetic: 0.1 },
      evasion: 0.2,
    },
    exclusive: true,
  },
]

/** 修理组件（P2 定稿 2026-09-05；**2026-09-13 船长改数值**：基础回复对齐「船体维修装置每跳」口径——
 * 民用 30 → **5**、军用 70 → **10**；甲、结构各按此值 × 该层容量增幅 × 舰体快修学（与装置侧同吃该技能）。
 * 厚甲船绝对回复更大 = 甲抗流特征保留） */
export const REPAIR_KITS: readonly ItemDef[] = [
  {
    id: 'repairkit-civ',
    name: '民用修理组件',
    kind: 'kit',
    unitM3: 1,
    baseSellPriceIsk: 3_000,
    repairRestore: 5,
    description: '纳米修理组件：基础回复 5 HP（结构/装甲各按此值×容量增幅×舰体快修学——甲板/技能越厚回得越多）。野外/回港前应急可用。',
  },
  {
    id: 'repairkit-mil',
    name: '军用修理组件',
    kind: 'kit',
    unitM3: 1,
    baseSellPriceIsk: 21_000,
    repairRestore: 10,
    description: '军用级纳米修理组件：基础回复 10 HP×容量增幅×舰体快修学。远征深空长线作战的标准补给。',
  },
]

/**
 * **谜质储存器**（F3c · 船长 2026-09-13 逐条裁定；A 批 = 探索与作业类 7 台）。
 *
 * 船长原话（照抄）：「**现在做，谜质玩家采集后，在货仓内显示为4格的『谜质储存器』，
 * 在本次虫洞探索中提供临时增益**」＋「多种效果……包括探索上的增益：扫描+1.回合数+10.威胁-5%。
 * 每个装置额外打捞/采集等」。
 *
 * 口径：
 * - **一台 = 2000 m³ = 2×2 = 4 格**形状件（`packages/core/src/wormholeHold.ts` 形状表已登记这 7 个 id）；
 * - **放在货仓里就生效、本趟结束随趟消失**（不进仓库、不拆解；效果一律现算，见 `wormholeMatter.ts`）；
 * - **施工期一律 `unreleased`**（与虫洞同批上线；`content:check` 有契约钉住）；
 * - 战斗类与威胁类装置（12 + 3 台）在 B 批追加。
 */
export const MATTER_DEVICES: readonly ItemDef[] = [
  {
    id: 'mat-surveyor',
    name: '深空测绘仪',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质凝成的测绘阵列：只要它躺在货仓里，扫描就能多看一圈。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-chrono',
    name: '时序核心',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质里剥出的一小段时间：带在货仓里，本趟可用的回合凭空多出一截。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-crane',
    name: '打捞起重机',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质驱动的起重臂：每轮打捞都能多拖一堆上来。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-drill',
    name: '采集钻机',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质磨出的钻头：每轮采集都能多挖一堆母矿。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-nebula',
    name: '星云驱散器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质吹出的一阵风：每次扫描都会额外吹散附近的星云。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-enricher',
    name: '母矿富集器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质做的富集槽：矿脉里采出的虚空母矿会更多。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-expander',
    name: '舱段扩展器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质撑开的折叠舱段：货仓能多塞几格货（它自己仍占 2×2 格）。离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  /* ── B1 批：威胁类（三档合计最多把威胁压到一半）── */
  {
    id: 'mat-suppressor',
    name: '压制力场',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质铺开的一层压制场：本层的节点战与守卫战都会更轻。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-boss-analyzer',
    name: '守卫解析仪',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质里读出的守卫编成：层末守卫的威胁明显下降。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    /**
     * ⚠ **退役留档（2026-09-15 船长「虫洞的撤离战取消吧」）**：撤离战整条退役 ⇒ 本装置**不再从谜质里抽出**
     * （core 的 `WORMHOLE_MATTER_DRAW_POOL` 已排除退役项）。物品卡与 core 装置条目**保留不删**：
     * 老档货仓里可能正带着它（谜质是本趟限定物），删掉会变成"读不懂的东西"；体检的「谜质契约」也要求
     * core 装置表与 data 物品表（`kind: 'matter'`）逐字一致。说明改成"已不再提供增益"以免误导玩家。
     */
    id: 'mat-extract-cover',
    name: '撤离掩护器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质凝成的一层薄壳：如今只剩形态，不再提供增益。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  /* ── B1 批：战斗类（一律只在本趟虫洞的战斗里生效）── */
  {
    id: 'mat-shield-res',
    name: '护盾谐振片',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质调谐出的护盾谐振：护盾对敌方主用伤害类型的抗性提高（只作用护盾这一层）。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-armor-res',
    name: '装甲强化片',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质重排的装甲层：装甲对敌方主用伤害类型的抗性提高（只作用装甲这一层）。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-hull-res',
    name: '结构加固片',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质织进船体骨架：结构对敌方主用伤害类型的抗性提高（只作用结构这一层）。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-tracker',
    name: '追踪阵列',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质校准的追踪阵列：编队命中更准。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-gyro',
    name: '陀螺稳定器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质陀螺让船身更难被咬住：编队回避提高。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-jammer',
    name: '干扰发射器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质噪声盖住你的信号：敌方打得更不准。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-rangefinder',
    name: '射程扩展器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质拉伸的测距阵列：全武器射程更远。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-blindspot',
    name: '盲区压制器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质在贴身距离上搅乱敌方火控：敌人贴脸开火的伤害比例下降。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-ammo-dmg',
    name: '弹药增效器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质给每一发弹丸加了一层：编队单发伤害提高。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-reload',
    name: '装填加速器',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质替装填机构抢时间：武器装填周期缩短。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  /* ── B2 批：战后收口与新机制 ── */
  {
    id: 'mat-volley',
    name: '齐射协调仪',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质接管了齐射分配：一轮齐射打死一艘后，多余的火力立刻转打下一艘。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-ammo-back',
    name: '弹药回收装置',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质在战后把打出去的弹壳与残料捞回来：本场消耗的弹药能回收一部分。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-drone-net',
    name: '机群回收网',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质织成的回收网：被点防打下来的无人机有更多能被捞回机库。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
  {
    id: 'mat-field-repair',
    name: '战地维修单元',
    kind: 'matter',
    unitM3: 2000,
    baseSellPriceIsk: 1,
    description: '谜质驱动的战地维修臂：每场交火后自动修补装甲与结构（不消耗货仓里的修理组件）。占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）。',
  },
]

/**
 * **AI 核心（洞内实物形态）**（船长 2026-09-14：「在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的
 * 掉落。AI 核心单独占 1 格。出率为 10%，不挤占旧有出率。三种核心根据稀有度区分出货权重」）。
 *
 * 为什么要"实物形态"这一层：AI 核心在游戏里**是一本账**（`state.aiCores`：市场买卖、技能上限、
 * 副船与产线占用全按它走），而**虫洞货仓只认物品 id**（占格、拖拽、临时空间、散落、结算全按物品走）
 * ⇒ 想让它"占 1 格"就必须先有物品卡。船长裁定：**撤离成功那一刻自动接入核心库、不进仓库**
 * （避免"仓库里有 3 个核心却不能接"的两本账）。
 *
 * **`kind: 'aicore'` 是本次新增的分类**（不复用 `container`）：拆解台的门是 `def.kind !== 'container'`
 * ⇒ 复用会让核心出现在拆解台、还会被丢进货柜抽奖（抽不出东西）；新分类语义干净，
 * `ITEM_KIND_ORDER` / `ITEM_KIND_LABELS` 两处登记，漏登记 typecheck 直接失败。
 *
 * **id 为什么是 `ai-core-*` 而不是 `core-*`**：市场那本账的 key 就叫 `core-gamma`（`kind:'aicore'`、
 * `refId:'gamma'`，见 `marketCatalog.ts`）——两者是不同命名空间，但同名会让人以为是一回事。
 *
 * `unitM3: 500` 与"1 格"对得上（货仓 500 m³/格，形状表登记 1×1）；`baseSellPriceIsk: 1` 与货柜同款
 * 兜底（它不上市交易，市场卡 `basePrice 1` / `demandMultiplier 0`）。施工期一律 `unreleased`。
 */
/* ══════════ 虫洞战利品与经济扩充（船长 2026-09-15 确认；口径见 docs/glossary.md 八之二「战利品四件」）══════════ */

/**
 * **虫洞谜质**（精华形态 · 船长 2026-09-15：「**谜质在虫洞结束时不再删除，而是转化成虫洞谜质存入仓库。
 * 介绍是虫洞内存在的奇幻物资，具备研究价值。该物品只收不卖。且具备较高价值，目前纯粹作为虫洞的金钱收益。**」）。
 *
 * 口径：
 * - **撤离成功时**按本趟**已取回**的谜质装置台数换算（**1 台 = 1 枚**）；**全损不转**（随货仓一起丢）；
 *   **没捡的不补发**；装置本身的「取回即生效、离洞失效」增益**保留**（本批只新增"转成物品"这一条）；
 * - **只收不卖**（`playerBuyable: false`）、市场行 `demandMultiplier: 1.0` ⇒ **NPC 收购 = 70,000/枚**；
 * - 它是**仓库物品**（不占虫洞货仓形状格、不进拆解/精炼/制造链）。
 */
export const WORMHOLE_ESSENCES: readonly ItemDef[] = [
  {
    id: 'mat-wh-essence',
    name: '虫洞谜质',
    kind: 'essence',
    unitM3: 0.5,
    baseSellPriceIsk: 70_000,
    description: '虫洞内存在的奇幻物资，具备研究价值，不建议出售。装在密封匣里的冷辉结晶，回收商按枚收购。',
  },
]

/**
 * **奢侈品**（船长 2026-09-15：「新增贵重品货柜，2格，精炼炉拆解后获得随机数量的'奢侈品'，
 * 奢侈品纯粹用来卖钱，**市场正常交易**」）——纯贸易品：**可买可卖**、不参与拆解/精炼/制造链，
 * 来源 = 贵重品货柜拆解（每箱 **5~30 件**、三档**等权**）。
 * ⚠ **2026-09-15 船长改判**（原 2.4 / 4.8 / 9.6 万）：「**单价差距提高（10/40/200万）**」——
 * 三档拉开 4 倍与 5 倍，均值 83.33 万/件 ⇒ 一箱内容期望 ≈ **1,458 万**（原 84 万）。
 */
export const LUXURIES: readonly ItemDef[] = [
  {
    id: 'lux-1',
    name: '星港陈酿',
    kind: 'luxury',
    unitM3: 2,
    baseSellPriceIsk: 100_000,
    description: '停泊区酒廊里翻倍加价的陈年酿造：产自哪一站不重要，年份与封蜡才是价钱。',
  },
  {
    id: 'lux-2',
    name: '贵族香料',
    kind: 'luxury',
    unitM3: 2,
    baseSellPriceIsk: 400_000,
    description: '只在少数星域能长的香材，贵族厨房的硬通货——按克计价，防潮封罐。',
  },
  {
    id: 'lux-3',
    name: '失落艺术品',
    kind: 'luxury',
    unitM3: 2,
    baseSellPriceIsk: 2_000_000,
    description: '战乱里流散的旧时代原作：真伪由拍卖行说了算，价钱由愿意出价的人说了算。',
  },
]

/**
 * **贵重品货柜**（船长 2026-09-15）——**2 格**（1000 m³ / 2×1，沿用图纸货柜口径）、**只收不卖**、
 * 拆解产物 = 奢侈品 **5~30 件**（`industry` 的拆解台产出表）。
 * 箱价口径（船长 2026-09-15 改判）：**= 内容期望 ×0.25**（本箱专属折扣；其余三类柜仍是 ×0.6）——
 * 期望 = 17.5 件 × 83.33 万 ≈ 1,458.33 万 ⇒ 箱价 **365 万**（原 50 万 = 84 万 ×0.6）。
 */
export const VALUABLES_CONTAINERS: readonly ItemDef[] = [
  {
    id: 'box-valuables',
    name: '贵重品货柜',
    kind: 'container',
    unitM3: 1000,
    baseSellPriceIsk: 3_650_000, // 2026-09-15 船长改判：内容期望（5~30 件 · 三档 10/40/200 万 · 等权 ≈ 1,458 万）× 0.25
    description: '贴满封条与防拆标记的软包箱：里面是拍卖行里的奢侈品，拆开才知道这一箱值多少。',
  },
]

/**
 * **军用备货柜**（船长 2026-09-15：「新增军用备货柜4格，精炼炉可以从中拆出数件随机MK3装备」
 * ＋「**军用备货柜含武器，不含专属**」）——**4 格**（2000 m³ / 2×2）、**只收不卖**、
 * 拆解产物 = **随机 MK3 装备 1~3 件**（**含武器**；**排除** `mod-lair-*` 族专属与 `mod-wh-*` 虫洞专属）。
 */
export const MILITARY_CONTAINERS: readonly ItemDef[] = [
  {
    id: 'box-military',
    name: '军用备货柜',
    kind: 'container',
    unitM3: 2000,
    baseSellPriceIsk: 2_800_000, // 2026-09-15 批 B 复核：MK3 池 30 件、行价均 235.5 万 × 期望 2 件 = 470.95 万 × **0.6** ⇒ 280 万（原估值 700 万高于拆解期望，会诱导"只卖箱不拆箱"）
    description: '制式军械箱：封条上还留着番号。拆开能得到成套的顶配装备——武器与部件混装。',
  },
]
export const AI_CORE_ITEMS: readonly ItemDef[] = [
  {
    id: 'ai-core-gamma',
    name: '伽马 AI 核心',
    kind: 'aicore',
    unitM3: 500,
    baseSellPriceIsk: 1,
    description: '从遗迹控制台里拔出来的运算核心：外壳烧灼过，内核还在低鸣。占货仓 1 格；撤离成功后自动接入核心库。',
  },
  {
    id: 'ai-core-beta',
    name: '贝塔 AI 核心',
    kind: 'aicore',
    unitM3: 500,
    baseSellPriceIsk: 1,
    description: '遗迹主控柜里的运算核心：散热鳍片完好，出厂编号被刻意磨掉。占货仓 1 格；撤离成功后自动接入核心库。',
  },
  {
    id: 'ai-core-alpha',
    name: '阿尔法 AI 核心',
    kind: 'aicore',
    unitM3: 500,
    baseSellPriceIsk: 1,
    description: '遗迹最深处供着的那一枚：整块冷铸合金外壳，摸上去冰凉。占货仓 1 格；撤离成功后自动接入核心库。',
  },
]

/** 全部物品（矿石/矿物在前为兼容旧展示顺序，其后气体/冰/弹药/无人机/修理组件） */
export const ITEMS: readonly ItemDef[] = [
  ...ORES,
  ...MINERALS,
  ...GASES,
  ...ICES,
  ...AMMO,
  ...DRONES,
  ...REPAIR_KITS,
  ...RELIC_CONTAINERS,
  ...BLUEPRINT_CONTAINERS,
  ...MATTER_DEVICES,
  ...WORMHOLE_ESSENCES,
  ...LUXURIES,
  ...VALUABLES_CONTAINERS,
  ...MILITARY_CONTAINERS,
  ...AI_CORE_ITEMS,
]

/** 构建"物品 id → 定义"目录 */
export function buildItemCatalog(): ReadonlyMap<string, ItemDef> {
  return new Map(ITEMS.map((item) => [item.id, item]))
}
