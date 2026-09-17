/**
 * 市场商品目录（V9 + V10 大扩容：31 → 97 张）。
 *
 * 目录规则（中文说明，设计文档 V4/V5/V10 已确认）：
 * - 市场只有两栏：常驻供应（common）/ 稀有订单（rare + exotic 奇货同栏展示）；
 * - 单件商品价格锚定旧商店价：常驻品=平价；稀有/限定品按稀缺度定溢价；
 * - 收购档位（2026-09-08 船长定，防套利 = 收购恒低于供应、倒买倒卖亏税）：
 *   单件收购价 = demandMultiplier × L —— common **0.6** / rare **0.65** / exotic **1.0**；
 *   池商品收购价 = L × demandMultiplier（留空 = 原料平价 1.0L；弹药/修理组件/无人机
 *   池耗材显式 0.6，防"造弹卖站"近无本回血）；
 * - 矿石/矿物/气体/冰矿/弹药/无人机走"池模型"：basePrice = 常驻均衡价，收购平价、供应微溢 6%；
 *   池 target/flow 随价格递减（防高价商品天量刷钱）；弹药/无人机为 NPC 补给池（占位消耗品，
 *   玩家可回卖但收购仅 0.6L，倒卖无套利）；
 * - V10 声望门槛（standingReq）：部分高端商品需协会声望才可买入（卖出不限）——给声望找新用途；
 *   门槛梯度：MK3 蓝图 4、武装/重装/航运顶级船 7~9、异星原型与旗舰 10~11。
 */

import type { MarketGoodDef } from '@whale/core'
import { rarityTierOf } from './rarityTier' // 2026-09-09 数字稀有度表（物品本体属性，市场调用）
import { wreckItemIdOf } from '@whale/core'
import { ANOMALIES } from './anomalies'
import { GALAXIES } from './universe'

export const MARKET_GOODS_RAW: readonly MarketGoodDef[] = [
  // ══════════ 常驻供应（common） ══════════

  // ── 矿石（池模型：玩家售矿主渠道；收购平价，池淤积压价） ──
  // 2026-09-05 船长：低级矿石/矿物是海量消耗品，池量与流量按"越低级越大"放大（稀有矿保持小）
  // 【2026-09-10 船长定：**按玩家生产能力标定**（原值按感觉定，17 个矿带里 15 个覆盖比 <1 = 采了卖不掉）。
  //   基准 = 掘洞级 + 满采矿技能 + 2×强化采集器 MK1（引擎实测 15.4k~20.0k 件/h ⇒ 日产 37~48 万件）；
  //   规则 = **按单价分层覆盖比**：≤20 信用点 → ×15（大宗）／≤200 → ×6（中阶）／≤400 → ×3（高阶）／>400 → ×2（顶级）；
  //   `supplyFlow`（每 60 秒窗吸收/补单量）按 `目标日吸收 ÷ 1440` 定、`poolTarget = supplyFlow × 120`。
  //   效果：梯度保留（建议 flow 513~4,991/窗 = **9.7× 差距**，原 6~5,000 = 833×），最低档仍是基准产能的 2 倍 ⇒ 挖高阶矿也卖得掉；
  //   低阶几乎不动（橄榄 ×1.0、辉长 ×2.5）。价格、产率、弹药/修理件/无人机池**一律未动**。】
  // 【2026-09-11 船长定：**消耗品池按同一把尺重标**（弹药/修理组件玩家可自造 → 基准 = **单工位无技能日产**；
  //   无人机**无蓝图**（纯市场货源）→ 基准按 144 场/天战损折算）。
  //   实测改前产能覆盖比：动能弹药 0.21× / 动能弹药 MK2 0.03× / 民用修理组件 0.40× / 军用修理组件 0.33×
  //   ——"一个工位造出来的量，市场一天都吃不下"，故按 ≤20 → ×15、≤200 → ×6、>400 → ×2 重标：
  //   弹药 MK1 150 → **10,800/窗**（池 4,000 → **1,296,000**）、弹药 MK2 20 → **4,320**（池 → **518,400**）、
  //   民用修理组件 4 → **20**（池 300 → **2,400**）、军用修理组件 1.5 → **9**（池 120 → **1,080**）、
  //   无人机池同步为 flow×120（4/2/1/1 → 池 480/240/120/120）。价格、产率、其它池一律未动。】
  { key: 'ore-veldspar', kind: 'item', refId: 'ore-veldspar', rarity: 'common', basePrice: 12, poolTarget: 598_920, supplyFlow: 4_991 },
  { key: 'ore-scorched', kind: 'item', refId: 'ore-scorched', rarity: 'common', basePrice: 18, poolTarget: 598_920, supplyFlow: 4_991 },
  { key: 'ore-hemorphite', kind: 'item', refId: 'ore-hemorphite', rarity: 'common', basePrice: 55, poolTarget: 239_640, supplyFlow: 1_997 },
  { key: 'ore-glowstone', kind: 'item', refId: 'ore-glowstone', rarity: 'common', basePrice: 150, poolTarget: 184_680, supplyFlow: 1_539 },
  { key: 'ore-sunshard', kind: 'item', refId: 'ore-sunshard', rarity: 'common', basePrice: 115, poolTarget: 184_680, supplyFlow: 1_539 },
  { key: 'ore-voidshard', kind: 'item', refId: 'ore-voidshard', rarity: 'common', basePrice: 340, poolTarget: 92_400, supplyFlow: 770 },
  { key: 'ore-nebulite', kind: 'item', refId: 'ore-nebulite', rarity: 'common', basePrice: 490, poolTarget: 61_560, supplyFlow: 513 },
  // 【虚空母矿 —— 虫洞线的唯一原矿（2026-09-12 船长定）。**虫洞落地前不对玩家可见**：
  //   `unreleased: true` ⇒ 不进 `ctx.marketGoods`（市场页/图鉴/挂单/任务全看不到），
  //   但契约照核（"每种物品必须有市场卡"）。**上线时删掉这一个字段即可开卖。**
  //   ⚠ **2026-09-14 船长：「虚空晶和虚空母矿也添加只收不卖。」＋「市场不会出现虚空晶和母矿的卖单。」**
  //   ⇒ `playerBuyable: false`：**NPC 侧一笔卖单都不铺**（见 `core/market.ts seedCommonBook` 的门），
  //   买入亦被拦；**收购照常**（带回的母矿随时能卖给 NPC）。
  //   数值（2026-09-14 半量后）：虚空晶 **0.25** + 同位聚晶 1.0 + 星髓晶 0.25 ⇒ 产出价值 **566.25**
  //   （改前 0.5 ⇒ 1,016.25）· basePrice 1,300 / demandMultiplier 0.6 ⇒ 收购 ≈780（价格按船长「价格不动」未调）。】
  { key: 'ore-voidmother', kind: 'item', refId: 'ore-voidmother', rarity: 'common', basePrice: 1_300, demandMultiplier: 0.6, playerBuyable: false }, // 只收不卖（2026-09-14 船长）
  // ── **遗迹安全货柜**（F4 · 2026-09-13；2026-09-14 船长改判：给像样的价、只收不卖）──
  // 【它是"带回后拆解"的中间件：**不带货进洞、只从洞内带出** ⇒ 市场**只收不卖**
  //   （`playerBuyable: false`，市场不出售现货 —— 否则花钱就能买箱子，洞内打捞这条渠道被架穿）。
  //   **基础价 = 该族内容期望市值 × 0.6**（一次性探针用真引擎 `wormholeUnboxRoll` 抽 4000 次量得；
  //   内容价一律取内容自身的市场行价）：A 359.3 万 · C 372.6 万 · D 679.3 万 · E 547.7 万 · G 534.6 万。
  //   ⚠ **0.6 这条折扣与残骸同一条哲学**：收购价恒**低于**拆解期望 ⇒ "开箱比卖箱更划算"，
  //   箱子仍是"打开它"的东西，想换现钱随时可以卖（`demandMultiplier: 1.0` = 按基础价全额收）。
  //   ⚠ **2026-09-15 船长「安全货柜价格允许提升」（体积 2000 → 3000 m³ · 6 格）⇒ 五族价一律 ×1.5**
  //   （2,155,000 → 3,232,500 等）：收购价从"期望 ×0.6"变成 **"期望 ×0.9"**——**仍低于**拆解期望，
  //   哲学不破，只是"开箱 vs 卖箱"的差距收窄（体积变 6 格、带回来更难，故补偿到接近等价）。
  //   若日后觉得拆箱动力不足，把这条 ×1.5 收回（或只提到 ×0.75）即可，改的是这一处的 5 个数。】
  { key: 'box-relic-a', kind: 'item', refId: 'box-relic-a', rarity: 'common', basePrice: 3_232_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 359.3 万 ×0.9（原 ×0.6）
  { key: 'box-relic-c', kind: 'item', refId: 'box-relic-c', rarity: 'common', basePrice: 3_352_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 372.6 万 ×0.9（原 ×0.6）
  { key: 'box-relic-d', kind: 'item', refId: 'box-relic-d', rarity: 'common', basePrice: 6_112_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 679.3 万 ×0.9（原 ×0.6）
  { key: 'box-relic-e', kind: 'item', refId: 'box-relic-e', rarity: 'common', basePrice: 4_927_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 547.7 万 ×0.9（原 ×0.6）
  { key: 'box-relic-g', kind: 'item', refId: 'box-relic-g', rarity: 'common', basePrice: 4_815_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 534.6 万 ×0.9（原 ×0.6）
  // 【图纸货柜 3 种（2026-09-14 船长定：虫洞遗迹打捞新增）：口径与安全货柜逐字相同 —— 只收不卖 +
  //   基础价 = 内容期望市值 ×0.6（浅 598.9 万 · 中 2,340.8 万 · 深 4,306.8 万；层档越高箱越值钱）。】
  { key: 'box-bp-shallow', kind: 'item', refId: 'box-bp-shallow', rarity: 'common', basePrice: 3_595_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 598.9 万 ×0.6
  { key: 'box-bp-mid', kind: 'item', refId: 'box-bp-mid', rarity: 'common', basePrice: 14_045_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 2,340.8 万 ×0.6
  { key: 'box-bp-deep', kind: 'item', refId: 'box-bp-deep', rarity: 'common', basePrice: 25_840_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 期望 4,306.8 万 ×0.6
  // 【AI 核心 **洞内实物形态** 3 种（2026-09-14 船长定：虫洞遗迹打捞新增掉落）——**不进市场**：
  //   ① 它占货仓 1 格、撤离成功即自动接入核心库（`state.aiCores`）⇒ **永不进仓库**，市场行没有交易对手；
  //   ② **AI 核心在市场已经有自己的卡**（`core-basic / core-gamma / core-beta / core-alpha` 四档账本核心）
  //      ⇒ 实物再挂一张卡就是"同一个东西的第二张卡"（船长 2026-09-14：「**AI核心已经存在了**」）。
  //   故一律 `unreleased: true`（照"每种物品必须有市场卡"的既有契约保留卡、契约照核，但不进 `ctx.marketGoods`）。】
  { key: 'ai-core-gamma', kind: 'item', refId: 'ai-core-gamma', rarity: 'common', basePrice: 200_000, demandMultiplier: 0, unreleased: true },
  { key: 'ai-core-beta', kind: 'item', refId: 'ai-core-beta', rarity: 'common', basePrice: 1_500_000, demandMultiplier: 0, unreleased: true },
  { key: 'ai-core-alpha', kind: 'item', refId: 'ai-core-alpha', rarity: 'common', basePrice: 10_000_000, demandMultiplier: 0, unreleased: true },
  // 【谜质储存器 24 台（F3c · 船长 2026-09-13 起）：**不进市场**——"本趟虫洞内生效、离开即消失"的装置，
  //   既不带回来也不流通（船长 2026-09-14：「谜质则不一样，**需要设置不出现在市场**」）。
  //   一律 `unreleased: true`：卡留在目录表里（"每种物品必须有市场卡"的契约照核），但不进 `ctx.marketGoods`
  //   ⇒ 市场页 / 挂单 / 订单 / 事件一律看不到、也买不到。`content:check` 有常驻契约钉住这一条。】
  { key: 'mat-surveyor', kind: 'item', refId: 'mat-surveyor', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-chrono', kind: 'item', refId: 'mat-chrono', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-crane', kind: 'item', refId: 'mat-crane', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-drill', kind: 'item', refId: 'mat-drill', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-nebula', kind: 'item', refId: 'mat-nebula', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-enricher', kind: 'item', refId: 'mat-enricher', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-expander', kind: 'item', refId: 'mat-expander', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-suppressor', kind: 'item', refId: 'mat-suppressor', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-boss-analyzer', kind: 'item', refId: 'mat-boss-analyzer', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-extract-cover', kind: 'item', refId: 'mat-extract-cover', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-shield-res', kind: 'item', refId: 'mat-shield-res', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-armor-res', kind: 'item', refId: 'mat-armor-res', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-hull-res', kind: 'item', refId: 'mat-hull-res', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-tracker', kind: 'item', refId: 'mat-tracker', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-gyro', kind: 'item', refId: 'mat-gyro', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-jammer', kind: 'item', refId: 'mat-jammer', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-rangefinder', kind: 'item', refId: 'mat-rangefinder', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-blindspot', kind: 'item', refId: 'mat-blindspot', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-ammo-dmg', kind: 'item', refId: 'mat-ammo-dmg', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-reload', kind: 'item', refId: 'mat-reload', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-volley', kind: 'item', refId: 'mat-volley', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-ammo-back', kind: 'item', refId: 'mat-ammo-back', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-drone-net', kind: 'item', refId: 'mat-drone-net', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  { key: 'mat-field-repair', kind: 'item', refId: 'mat-field-repair', rarity: 'common', basePrice: 1, demandMultiplier: 0, unreleased: true },
  // ── 矿物（池模型：制造原料主渠道；供应微溢 6%） ──
  // 【2026-09-10 同批按"单炉满技能精炼产能"标定（矿 → 矿物取该矿物产率最高的那支矿）：
  //   钛钢 90,734 件/h、银纹 63,385、晶态 22,523、同位聚晶 78,408、重钨 29,233、星髓 29,730、冥铁 7,722
  //   ——冥铁/星髓/重钨/同位聚晶原覆盖比 0.16~0.82×（炼出来卖不掉），钛钢/银纹/晶态本就 ≥5.7× 故仅微调；
  //   虚空晶无精炼来源（回收彩头），池不动。】
  { key: 'min-tritanium', kind: 'item', refId: 'min-tritanium', rarity: 'common', basePrice: 8, poolTarget: 2_722_080, supplyFlow: 22_684 },
  { key: 'min-pyerite', kind: 'item', refId: 'min-pyerite', rarity: 'common', basePrice: 12, poolTarget: 1_901_640, supplyFlow: 15_847 },
  { key: 'min-mexallon', kind: 'item', refId: 'min-mexallon', rarity: 'common', basePrice: 20, poolTarget: 675_720, supplyFlow: 5_631 },
  { key: 'min-nocxium', kind: 'item', refId: 'min-nocxium', rarity: 'common', basePrice: 90, poolTarget: 350_880, supplyFlow: 2_924 },
  { key: 'min-isotope', kind: 'item', refId: 'min-isotope', rarity: 'common', basePrice: 55, poolTarget: 940_920, supplyFlow: 7_841 },
  { key: 'min-starcore', kind: 'item', refId: 'min-starcore', rarity: 'common', basePrice: 245, poolTarget: 178_440, supplyFlow: 1_487 },
  { key: 'min-darkiron', kind: 'item', refId: 'min-darkiron', rarity: 'common', basePrice: 780, poolTarget: 30_960, supplyFlow: 258 },
  // 【虚空晶（2026-09-14 船长：「虚空晶和虚空母矿也添加只收不卖」「市场不会出现…卖单」）：
  //   它是**24 张洞内蓝图 + 皇带鱼级**的通用主料，来源只有"虚空母矿精炼"与"回收彩头"
  //   ⇒ 只收不卖（NPC 不铺卖单、买入被拦），**收购照常**。`poolTarget/supplyFlow` 保留：
  //   池面仍参与均衡价与收购阶梯的计算，只是不再铺供应单。】
  { key: 'min-voidcrystal', kind: 'item', refId: 'min-voidcrystal', rarity: 'common', basePrice: 1_800, poolTarget: 500, supplyFlow: 3, playerBuyable: false }, // 只收不卖（2026-09-14 船长）
  // ── 虫洞战利品与经济扩充（船长 2026-09-15 确认）：谜质精华只收不卖 · 奢侈品正常交易 · 两个新货柜只收不卖 ──
  //   ⚠ **档位口径（2026-09-15 落码）**：凡"玩家产出要拿去卖钱"的行一律 **common（常驻）**——
  //   common 才每 60s 窗口铺 3 档收购阶梯（池商品）或 85% 掷一次收购单（单件平价品）；
  //   rare/exotic 的收购单只有 3% / 1% 每窗的掷骰 ⇒ 内容体检会报「玩家产出将无法稳定卖出」。
  //   既有同类先例：虚空晶 `min-voidcrystal`（common · 池商品）· 遗迹安全货柜/图纸货柜 `box-relic-*`/`box-bp-*`（common）。
  //   ⚠ **谜质（`mat-wh-essence`）暂留 exotic**：`-wh-` 专属内容档位另有 2026-09-14 船长裁定
  //   （「所有专属的东西，价格翻4倍」⇒ 用例 `exclusive-market.test.ts` ① 要求 `-wh-` 行 = 奇货档 + 只收不卖），
  //   与"常驻才好卖"冲突 ⇒ 待船长裁决（见汇报），裁决前不动。
  { key: 'mat-wh-essence', kind: 'item', refId: 'mat-wh-essence', rarity: 'exotic', basePrice: 70_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 虫洞谜质（撤离成功时按台数换算：1 台 = 1 枚；NPC 收购 = 70,000）
  { key: 'lux-1', kind: 'item', refId: 'lux-1', rarity: 'common', basePrice: 100_000, demandMultiplier: 1.0 }, // 奢侈品·低带（贵重品货柜拆解产物；正常交易）· 2026-09-15 船长「单价差距提高」：2.4 → 10 万
  { key: 'lux-2', kind: 'item', refId: 'lux-2', rarity: 'common', basePrice: 400_000, demandMultiplier: 1.0 }, // 奢侈品·中带（常驻 ⇒ 稳定卖出）· 4.8 → 40 万
  { key: 'lux-3', kind: 'item', refId: 'lux-3', rarity: 'common', basePrice: 2_000_000, demandMultiplier: 1.0 }, // 奢侈品·高带（常驻 ⇒ 稳定卖出）· 9.6 → 200 万
  // ⚠ 2026-09-16 船长：「添加更多奢侈品，让奢侈品有10个类型，分布在目前的3个奢侈品价格附近」＋「十件等权」
  //   ⇒ 低带 ≈6~14 万 / 中带 ≈25~80 万 / 高带 ≈120~320 万，围绕原来的 10 / 40 / 200 万铺开；
  //   十款均价 **87.5 万** ⇒ 一箱期望 1,531.25 万 ⇒ 箱价 382.8 万（×0.25 契约不变）。
  { key: 'lux-4', kind: 'item', refId: 'lux-4', rarity: 'common', basePrice: 60_000, demandMultiplier: 1.0 }, // 奢侈品·低带（陈年雪茄）
  { key: 'lux-5', kind: 'item', refId: 'lux-5', rarity: 'common', basePrice: 140_000, demandMultiplier: 1.0 }, // 奢侈品·低带（异域织物）
  { key: 'lux-6', kind: 'item', refId: 'lux-6', rarity: 'common', basePrice: 250_000, demandMultiplier: 1.0 }, // 奢侈品·中带（香木雕刻）
  { key: 'lux-7', kind: 'item', refId: 'lux-7', rarity: 'common', basePrice: 600_000, demandMultiplier: 1.0 }, // 奢侈品·中带（宫廷乐谱）
  { key: 'lux-8', kind: 'item', refId: 'lux-8', rarity: 'common', basePrice: 800_000, demandMultiplier: 1.0 }, // 奢侈品·中带（古法香膏）
  { key: 'lux-9', kind: 'item', refId: 'lux-9', rarity: 'common', basePrice: 1_200_000, demandMultiplier: 1.0 }, // 奢侈品·高带（星图真迹）
  { key: 'lux-10', kind: 'item', refId: 'lux-10', rarity: 'common', basePrice: 3_200_000, demandMultiplier: 1.0 }, // 奢侈品·高带（王冠遗钻）
  { key: 'box-valuables', kind: 'item', refId: 'box-valuables', rarity: 'common', basePrice: 3_828_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 贵重品货柜（2 格）· 期望 = 17.5 件 × 十款均价 87.5 万 = 1,531.25 万 ×**0.25**（2026-09-15 船长改判的专属折扣；其余三类柜仍是 ×0.6）
  { key: 'box-military', kind: 'item', refId: 'box-military', rarity: 'common', basePrice: 2_800_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 军用备货柜（4 格）· 期望 = 2 件 × MK3 均价 235.5 万 = 470.95 万 ×0.6（2026-09-15 批 B 复核：原估值 700 万 > 拆解期望，会诱导"只卖箱不拆箱"⇒ 按同一条 ×0.6 规则下调）
  // ── 气体（V10 池商品） ──
  { key: 'gas-neon', kind: 'item', refId: 'gas-neon', rarity: 'common', basePrice: 85, poolTarget: 227_880, supplyFlow: 1_899 },
  { key: 'gas-phosphor', kind: 'item', refId: 'gas-phosphor', rarity: 'common', basePrice: 330, poolTarget: 114_000, supplyFlow: 950 },
  { key: 'gas-ionstorm', kind: 'item', refId: 'gas-ionstorm', rarity: 'common', basePrice: 230, poolTarget: 114_000, supplyFlow: 950 },
  { key: 'gas-aurora', kind: 'item', refId: 'gas-aurora', rarity: 'common', basePrice: 330, poolTarget: 114_000, supplyFlow: 950 },
  // ── 冰矿（V10 池商品） ──
  { key: 'ice-frost', kind: 'item', refId: 'ice-frost', rarity: 'common', basePrice: 150, poolTarget: 227_880, supplyFlow: 1_899 },
  { key: 'ice-marrow', kind: 'item', refId: 'ice-marrow', rarity: 'common', basePrice: 230, poolTarget: 114_000, supplyFlow: 950 },
  { key: 'ice-darkstar', kind: 'item', refId: 'ice-darkstar', rarity: 'common', basePrice: 360, poolTarget: 114_000, supplyFlow: 950 },
  // ── 弹药（V10 占位消耗品：NPC 补给池，玩家可囤可回卖） ──
  { key: 'ammo-kinetic-l', kind: 'item', refId: 'ammo-kinetic-l', rarity: 'common', basePrice: 7, demandMultiplier: 0.6, poolTarget: 1_296_000, supplyFlow: 10_800 }, // 2026-09-11 消耗品池按产能标定（原 4,000/150）
  { key: 'ammo-explosive-l', kind: 'item', refId: 'ammo-explosive-l', rarity: 'common', basePrice: 8, demandMultiplier: 0.6, poolTarget: 1_296_000, supplyFlow: 10_800 },
  { key: 'ammo-plasma-l', kind: 'item', refId: 'ammo-plasma-l', rarity: 'common', basePrice: 9, demandMultiplier: 0.6, poolTarget: 1_296_000, supplyFlow: 10_800 },
  // ── 弹药 MK2（2026-09-09 船长拍板：攻坚/提速消耗品；补给池高价低耗节流，参数可调） ──
  { key: 'ammo-kinetic-2', kind: 'item', refId: 'ammo-kinetic-2', rarity: 'common', basePrice: 45, demandMultiplier: 0.6, poolTarget: 518_400, supplyFlow: 4_320 }, // 2026-09-11 消耗品池按产能标定（原 1,200/20）
  { key: 'ammo-explosive-2', kind: 'item', refId: 'ammo-explosive-2', rarity: 'common', basePrice: 60, demandMultiplier: 0.6, poolTarget: 518_400, supplyFlow: 4_320 },
  { key: 'ammo-plasma-2', kind: 'item', refId: 'ammo-plasma-2', rarity: 'common', basePrice: 80, demandMultiplier: 0.6, poolTarget: 518_400, supplyFlow: 4_320 },
  // ── 修理组件（2026-09-05：承伤持久化配套消耗品；民用/军用两档 NPC 常驻补给池） ──
  { key: 'repairkit-civ', kind: 'item', refId: 'repairkit-civ', rarity: 'common', basePrice: 3_300, demandMultiplier: 0.6, poolTarget: 2_400, supplyFlow: 20 }, // 2026-09-11 消耗品池按产能标定（原 300/4）
  { key: 'repairkit-mil', kind: 'item', refId: 'repairkit-mil', rarity: 'common', basePrice: 23_100, demandMultiplier: 0.6, poolTarget: 1_080, supplyFlow: 9 }, // 2026-09-11（原 120/1.5；船长定：与其它消耗品同口径，激战单场可吃 23 枚 ⇒ 池约撑 45 场）
  // ── 无人机（V10 占位：NPC 补给池） ──
  { key: 'drone-scout', kind: 'item', refId: 'drone-scout', rarity: 'common', basePrice: 900, demandMultiplier: 0.6, poolTarget: 480, supplyFlow: 4 }, // 2026-09-11 池 = flow×120（原 200）
  { key: 'drone-assault', kind: 'item', refId: 'drone-assault', rarity: 'common', basePrice: 2_200, demandMultiplier: 0.6, poolTarget: 240, supplyFlow: 2 },
  { key: 'drone-heavy', kind: 'item', refId: 'drone-heavy', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6, poolTarget: 120, supplyFlow: 1 },
  { key: 'drone-sentry', kind: 'item', refId: 'drone-sentry', rarity: 'common', basePrice: 9_500, demandMultiplier: 0.6, poolTarget: 120, supplyFlow: 1 },

  // ── 单件平价品 ──
  // 民用/入门装备（市场供应价 = 制造价的合理回本价；玩家自己造更便宜）
  { key: 'mod-miner-civ', kind: 'module', refId: 'mod-miner-civ', rarity: 'common', basePrice: 9_000, demandMultiplier: 0.6 },
  { key: 'mod-cargo-civ', kind: 'module', refId: 'mod-cargo-civ', rarity: 'common', basePrice: 8_000, demandMultiplier: 0.6 },
  { key: 'mod-turret-civ', kind: 'module', refId: 'mod-turret-civ', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'mod-miner-1', kind: 'module', refId: 'mod-miner-1', rarity: 'common', basePrice: 31_200, demandMultiplier: 0.6 },
  { key: 'mod-cargo-1', kind: 'module', refId: 'mod-cargo-1', rarity: 'common', basePrice: 29_200, demandMultiplier: 0.6 },
  { key: 'mod-turret-kin-1', kind: 'module', refId: 'mod-turret-kin-1', rarity: 'common', basePrice: 53_000, demandMultiplier: 0.6 },
  // 巨构近防炮（2026-09-11 机群批 S4）：**唯一能打敌方机群**的武器类型（防空属性），点上架
  // 蓝图行书价 = 产物 × 档位系数（2026-09-12 船长裁定「乙」对齐；原三行书价照抄了产物价）
  { key: 'mod-pd-e', kind: 'module', refId: 'mod-pd-e', rarity: 'rare', basePrice: 118_000, demandMultiplier: 0.7 },
  { key: 'bp-pd-e', kind: 'blueprint', refId: 'bp-pd-e', rarity: 'rare', basePrice: 236_000, demandMultiplier: 0.7 },
  { key: 'mod-pd-e-2', kind: 'module', refId: 'mod-pd-e-2', rarity: 'rare', basePrice: 315_000, demandMultiplier: 0.7 },
  { key: 'bp-pd-e-2', kind: 'blueprint', refId: 'bp-pd-e-2', rarity: 'rare', basePrice: 787_500, demandMultiplier: 0.7 },
  { key: 'mod-pd-e-3', kind: 'module', refId: 'mod-pd-e-3', rarity: 'exotic', basePrice: 690_000, demandMultiplier: 0.75 },
  { key: 'bp-pd-e-3', kind: 'blueprint', refId: 'bp-pd-e-3', rarity: 'exotic', basePrice: 2_760_000, demandMultiplier: 0.75 },
  { key: 'mod-missile-1', kind: 'module', refId: 'mod-missile-1', rarity: 'common', basePrice: 62_000, demandMultiplier: 0.6 },
  { key: 'mod-laser-1', kind: 'module', refId: 'mod-laser-1', rarity: 'common', basePrice: 66_000, demandMultiplier: 0.6 },
  // 战斗家族 MK1（V17 起真生效：护盾/装甲为分系专精三款、矢量推进器；低价鼓励勤换装）
  { key: 'mod-shield-kin-1', kind: 'module', refId: 'mod-shield-kin-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-shield-exp-1', kind: 'module', refId: 'mod-shield-exp-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-shield-pla-1', kind: 'module', refId: 'mod-shield-pla-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-armor-kin-1', kind: 'module', refId: 'mod-armor-kin-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-armor-exp-1', kind: 'module', refId: 'mod-armor-exp-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-armor-pla-1', kind: 'module', refId: 'mod-armor-pla-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-shield-ext-1', kind: 'module', refId: 'mod-shield-ext-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  // 护盾充能装置（2026-09-14 船长新增件：每 30 秒脉冲回满盾的一个比例；与扩展器同槽同档同价）
  { key: 'mod-shieldchg-1', kind: 'module', refId: 'mod-shieldchg-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 }, // 护盾充能装置 MK1（价/渠道照船体维修装置·民用档）
  { key: 'mod-armor-plate-1', kind: 'module', refId: 'mod-armor-plate-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-prop-1', kind: 'module', refId: 'mod-prop-1', rarity: 'common', basePrice: 6_000, demandMultiplier: 0.6 },
  // V18 无人机装置（高槽；现货 + 蓝图双渠道——2026-09-09 全蓝图化后有书可学）
  { key: 'mod-drone-rack-1', kind: 'module', refId: 'mod-drone-rack-1', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'mod-drone-tac-1', kind: 'module', refId: 'mod-drone-tac-1', rarity: 'common', basePrice: 18_000, demandMultiplier: 0.6 },
  { key: 'mod-drone-relay-1', kind: 'module', refId: 'mod-drone-relay-1', rarity: 'common', basePrice: 15_000, demandMultiplier: 0.6 }, // 无人机中继天线 MK1（2026-09-10 现货）
  // 低级蓝图（价格 = 蓝图商店价；买来学习后永久可造，重复蓝图回卖按 common 档 0.6L 收购）
  { key: 'bp-miner-1', kind: 'blueprint', refId: 'bp-miner-1', rarity: 'common', basePrice: 62500, demandMultiplier: 0.6 },
  { key: 'bp-cargo-1', kind: 'blueprint', refId: 'bp-cargo-1', rarity: 'common', basePrice: 58500, demandMultiplier: 0.6 },
  { key: 'bp-turret-1', kind: 'blueprint', refId: 'bp-turret-1', rarity: 'common', basePrice: 106000, demandMultiplier: 0.6 },
  { key: 'bp-miner-civ', kind: 'blueprint', refId: 'bp-miner-civ', rarity: 'common', basePrice: 18000, demandMultiplier: 0.6 },
  { key: 'bp-cargo-civ', kind: 'blueprint', refId: 'bp-cargo-civ', rarity: 'common', basePrice: 16000, demandMultiplier: 0.6 },
  { key: 'bp-turret-civ', kind: 'blueprint', refId: 'bp-turret-civ', rarity: 'common', basePrice: 24000, demandMultiplier: 0.6 },
  // 弹药生产线蓝图（2026-09-05：基础弹自制；书籍价随弹型市场价；2026-09-09 全蓝图化补给线现价 ×1.5）
  // 弹药生产线蓝图（**弹药线书价不随系数漂移**：船长 2026-09-11 复核「弹药蓝图回滚到 1.5 倍，其他保持不变」
  // ⇒ 维持 2026-09-09「补给线 ×1.5」批的落账原值，逐条登记在 blueprints.ts 的 BLUEPRINT_PRICE_OVERRIDES）
  { key: 'bp-ammo-kinetic', kind: 'blueprint', refId: 'bp-ammo-kinetic', rarity: 'common', basePrice: 1350, demandMultiplier: 0.6 },
  { key: 'bp-ammo-explosive', kind: 'blueprint', refId: 'bp-ammo-explosive', rarity: 'common', basePrice: 1650, demandMultiplier: 0.6 },
  { key: 'bp-ammo-plasma', kind: 'blueprint', refId: 'bp-ammo-plasma', rarity: 'common', basePrice: 1950, demandMultiplier: 0.6 },
  // 弹药 MK2 生产线蓝图（2026-09-09：奇货书——船长追加拍板 rare→exotic；收购档随奇货惯例 1.0L 全价回收，
  // 与全部 exotic 蓝图书行一致。**书价同样维持原值** 9,000/12,750/18,000，不走奇货 ×4 系数）
  { key: 'bp-ammo-kinetic-2', kind: 'blueprint', refId: 'bp-ammo-kinetic-2', rarity: 'exotic', basePrice: 9_000, demandMultiplier: 1.0 },
  { key: 'bp-ammo-explosive-2', kind: 'blueprint', refId: 'bp-ammo-explosive-2', rarity: 'exotic', basePrice: 12_750, demandMultiplier: 1.0 },
  { key: 'bp-ammo-plasma-2', kind: 'blueprint', refId: 'bp-ammo-plasma-2', rarity: 'exotic', basePrice: 18_000, demandMultiplier: 1.0 },
  // 修理组件蓝图（2026-09-05：书籍价随组件市场价同构）
  { key: 'bp-repairkit-civ', kind: 'blueprint', refId: 'bp-repairkit-civ', rarity: 'common', basePrice: 33000, demandMultiplier: 0.6 },
  { key: 'bp-repairkit-mil', kind: 'blueprint', refId: 'bp-repairkit-mil', rarity: 'common', basePrice: 138500, demandMultiplier: 0.6 },
  // 2026-09-09 全蓝图化：全部装备可学蓝图自造（双渠道，现货保留）；蓝图书出现概率 −50%。
  // **蓝图价口径 2026-09-11 归一（船长裁决甲）**：书价 = 产物现货价 × 档位系数（民用/基础/MK1 ×2 · MK2 ×2.5 · MK3 ×3，
  // 取整 500 信用点）——单点 = `blueprints.ts` 的 `blueprintTierCoefOf`，本表每行只做「与 blueprints.ts 同值」的落账。
  { key: 'bp-laser-1', kind: 'blueprint', refId: 'bp-laser-1', rarity: 'common', basePrice: 132000, demandMultiplier: 0.6 }, // 轻型激光炮 MK1（蓝图=产物×2）
  { key: 'bp-missile-1', kind: 'blueprint', refId: 'bp-missile-1', rarity: 'common', basePrice: 124000, demandMultiplier: 0.6 }, // 轻型导弹架 MK1（蓝图=产物×2）
  { key: 'bp-drone-rack-1', kind: 'blueprint', refId: 'bp-drone-rack-1', rarity: 'common', basePrice: 24000, demandMultiplier: 0.6 }, // 无人机甲板扩展 MK1（蓝图=产物×2）
  { key: 'bp-drone-tac-1', kind: 'blueprint', refId: 'bp-drone-tac-1', rarity: 'common', basePrice: 36000, demandMultiplier: 0.6 }, // 战术导控阵列 MK1（蓝图=产物×2）
  { key: 'bp-shield-kin-1', kind: 'blueprint', refId: 'bp-shield-kin-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾增强器 MK1·动能型（蓝图=产物×2）
  { key: 'bp-shield-exp-1', kind: 'blueprint', refId: 'bp-shield-exp-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾增强器 MK1·高爆型（蓝图=产物×2）
  { key: 'bp-shield-pla-1', kind: 'blueprint', refId: 'bp-shield-pla-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾增强器 MK1·能量型（蓝图=产物×2）
  { key: 'bp-shield-ext-1', kind: 'blueprint', refId: 'bp-shield-ext-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾扩展器 MK1（蓝图=产物×2）
  { key: 'bp-shieldchg-1', kind: 'blueprint', refId: 'bp-shieldchg-1', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 护盾充能装置 MK1（蓝图=产物×2 · 照船体维修装置·民用档）
  { key: 'bp-armor-kin-1', kind: 'blueprint', refId: 'bp-armor-kin-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲镀层 MK1·动能型（蓝图=产物×2）
  { key: 'bp-armor-exp-1', kind: 'blueprint', refId: 'bp-armor-exp-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲镀层 MK1·高爆型（蓝图=产物×2）
  { key: 'bp-armor-pla-1', kind: 'blueprint', refId: 'bp-armor-pla-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲镀层 MK1·能量型（蓝图=产物×2）
  { key: 'bp-armor-plate-1', kind: 'blueprint', refId: 'bp-armor-plate-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲增厚板 MK1（蓝图=产物×2）
  { key: 'bp-prop-1', kind: 'blueprint', refId: 'bp-prop-1', rarity: 'common', basePrice: 12000, demandMultiplier: 0.6 }, // 矢量推进器 MK1（蓝图=产物×2）
  { key: 'bp-stab-kin-1', kind: 'blueprint', refId: 'bp-stab-kin-1', rarity: 'common', basePrice: 68000, demandMultiplier: 0.6 }, // 动能稳定器 MK1（蓝图=产物×2）
  { key: 'bp-stab-exp-1', kind: 'blueprint', refId: 'bp-stab-exp-1', rarity: 'common', basePrice: 68000, demandMultiplier: 0.6 }, // 高爆稳定器 MK1（蓝图=产物×2）
  { key: 'bp-stab-pla-1', kind: 'blueprint', refId: 'bp-stab-pla-1', rarity: 'common', basePrice: 68000, demandMultiplier: 0.6 }, // 等离子稳定器 MK1（蓝图=产物×2）
  { key: 'bp-rof-1', kind: 'blueprint', refId: 'bp-rof-1', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 射速计算机 MK1（蓝图=产物×2）
  { key: 'bp-track-1', kind: 'blueprint', refId: 'bp-track-1', rarity: 'common', basePrice: 52000, demandMultiplier: 0.6 }, // 索敌阵列 MK1（蓝图=产物×2）
  { key: 'bp-gyro-1', kind: 'blueprint', refId: 'bp-gyro-1', rarity: 'common', basePrice: 48000, demandMultiplier: 0.6 }, // 姿态陀螺 MK1（蓝图=产物×2）
  { key: 'bp-salvager-1', kind: 'blueprint', refId: 'bp-salvager-1', rarity: 'common', basePrice: 40000, demandMultiplier: 0.6 }, // 打捞器 MK1（蓝图=产物×2）
  { key: 'bp-hullrep-civ', kind: 'blueprint', refId: 'bp-hullrep-civ', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 民用船体维修装置（蓝图=产物×2）
  { key: 'bp-hullrep-1', kind: 'blueprint', refId: 'bp-hullrep-1', rarity: 'common', basePrice: 936000, demandMultiplier: 0.6 }, // 船体维修装置 MK1（蓝图=产物×2）
  { key: 'bp-lock-1', kind: 'blueprint', refId: 'bp-lock-1', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 目标锁定阵列 MK1（蓝图=产物×2）
  // 低级船（AI 副船军团的主力船）
  { key: 'ship-burrower', kind: 'ship', refId: 'burrower', rarity: 'common', basePrice: 120_000, demandMultiplier: 0.6 },
  // 基础 AI 核心（原直购并入市场，平价常驻；可回卖：收购档 common 0.6×L）
  { key: 'core-basic', kind: 'aicore', refId: 'basic', rarity: 'common', basePrice: 25_000, demandMultiplier: 0.6 },

  // ══════════ 稀有订单（rare：低频刷新、寿命 9 分钟） ══════════

  // MK2 装备（制造党自用为主；偶有现货——现货价 = 自制成本 ×1.4 稀有溢价）
  // 【2026-09-10 船长定：MK2/MK3 **装备**价一律**对齐同级武器价**（线性映射进攻器带；三武为锚点）。
  //   第 2 档：原 2.8~21 万 → 38.5~48.1 万（×3.70）；第 3 档：原 17~112.2 万 → 192~240 万（×3.69）。
  //   武器价、第 1 档与民用价、奇货价、蓝图价与舰船价**一律未动**；属性/数值零改动。
  //   同批 12 件 MK3 装备的稀有感档位由 T2 升 T3（见 rarityTier.ts），并 `rareTier3Weight` 0.25 → 0.15。】
  { key: 'mod-miner-2', kind: 'module', refId: 'mod-miner-2', rarity: 'rare', basePrice: 466_000, demandMultiplier: 0.65 },
  { key: 'mod-cargo-2', kind: 'module', refId: 'mod-cargo-2', rarity: 'rare', basePrice: 475_000, demandMultiplier: 0.65 },
  { key: 'mod-turret-kin-2', kind: 'module', refId: 'mod-turret-kin-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-missile-2', kind: 'module', refId: 'mod-missile-2', rarity: 'rare', basePrice: 451_000, demandMultiplier: 0.65 },
  { key: 'mod-laser-2', kind: 'module', refId: 'mod-laser-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  // MK3 攻坚装备（V10 起蓝图可造 + 稀有现货高价应急；自制成本 ×1.7）
  { key: 'mod-miner-3', kind: 'module', refId: 'mod-miner-3', rarity: 'rare', basePrice: 2_330_000, demandMultiplier: 0.65 },
  { key: 'mod-cargo-3', kind: 'module', refId: 'mod-cargo-3', rarity: 'rare', basePrice: 2_400_000, demandMultiplier: 0.65 },
  { key: 'mod-turret-kin-3', kind: 'module', refId: 'mod-turret-kin-3', rarity: 'rare', basePrice: 1_916_000, demandMultiplier: 0.65 },
  { key: 'mod-missile-3', kind: 'module', refId: 'mod-missile-3', rarity: 'rare', basePrice: 2_242_000, demandMultiplier: 0.65 },
  { key: 'mod-laser-3', kind: 'module', refId: 'mod-laser-3', rarity: 'rare', basePrice: 2_395_000, demandMultiplier: 0.65 },
  // 战斗家族 MK2/MK3（V17：分系专精 ×3 款；MK3 市场专供——V18 复查：稀有溢价 ×1.4/×1.7）
  // 2026-09-10 船长定：**MK2/MK3 装备价对齐同级武器价**（规则 = 线性映射进攻器带：
  // 第 2 档全部落进 38.5~48.1 万、第 3 档全部落进 192~240 万；锚点 = 三武价，各级中位 45.1 万 / 224.2 万）
  { key: 'mod-shield-kin-2', kind: 'module', refId: 'mod-shield-kin-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-exp-2', kind: 'module', refId: 'mod-shield-exp-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-pla-2', kind: 'module', refId: 'mod-shield-pla-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-kin-2', kind: 'module', refId: 'mod-armor-kin-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-exp-2', kind: 'module', refId: 'mod-armor-exp-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-pla-2', kind: 'module', refId: 'mod-armor-pla-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-prop-2', kind: 'module', refId: 'mod-prop-2', rarity: 'rare', basePrice: 391_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-rack-2', kind: 'module', refId: 'mod-drone-rack-2', rarity: 'rare', basePrice: 418_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-tac-2', kind: 'module', refId: 'mod-drone-tac-2', rarity: 'rare', basePrice: 455_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-relay-2', kind: 'module', refId: 'mod-drone-relay-2', rarity: 'rare', basePrice: 449_000, demandMultiplier: 0.65 }, // 无人机中继天线 MK2（2026-09-10 现货）
  { key: 'mod-shield-kin-3', kind: 'module', refId: 'mod-shield-kin-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-exp-3', kind: 'module', refId: 'mod-shield-exp-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-pla-3', kind: 'module', refId: 'mod-shield-pla-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-kin-3', kind: 'module', refId: 'mod-armor-kin-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-exp-3', kind: 'module', refId: 'mod-armor-exp-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-pla-3', kind: 'module', refId: 'mod-armor-pla-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-ext-2', kind: 'module', refId: 'mod-shield-ext-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-shieldchg-2', kind: 'module', refId: 'mod-shieldchg-2', rarity: 'rare', basePrice: 468_000, demandMultiplier: 0.65 }, // 护盾充能装置 MK2（价/渠道照船体维修装置 MK1）
  { key: 'mod-armor-plate-2', kind: 'module', refId: 'mod-armor-plate-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-ext-3', kind: 'module', refId: 'mod-shield-ext-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-shieldchg-3', kind: 'module', refId: 'mod-shieldchg-3', rarity: 'rare', basePrice: 2_290_000, demandMultiplier: 0.65 }, // 护盾充能装置 MK3（价/渠道照船体维修装置 MK2）
  { key: 'mod-armor-plate-3', kind: 'module', refId: 'mod-armor-plate-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-prop-3', kind: 'module', refId: 'mod-prop-3', rarity: 'rare', basePrice: 1_970_000, demandMultiplier: 0.65 },
  // 微型跃迁引擎（2026-09-14 船长定：中槽短爆发推进，点火 10 秒 / 冷却 60 秒）——
  // 价 = 「同族之上的溢价」：MK1 60,000（矢量 MK1 6,000 ×10）· MK2 780,000（矢量 MK2 ×2）；
  // 书价按档位系数（`blueprintTierCoefOf`：id 后缀 -2 ⇒ ×2.5、其余非奇货 ⇒ ×2）：120,000 / 1,950,000（两处必须同值，体检硬契约）。
  { key: 'mod-mwd-1', kind: 'module', refId: 'mod-mwd-1', rarity: 'rare', basePrice: 60_000, demandMultiplier: 0.65 },
  { key: 'bp-mwd-1', kind: 'blueprint', refId: 'bp-mwd-1', rarity: 'rare', basePrice: 120_000, demandMultiplier: 0.65 },
  { key: 'mod-mwd-2', kind: 'module', refId: 'mod-mwd-2', rarity: 'rare', basePrice: 780_000, demandMultiplier: 0.65 },
  { key: 'bp-mwd-2', kind: 'blueprint', refId: 'bp-mwd-2', rarity: 'rare', basePrice: 1_950_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-rack-3', kind: 'module', refId: 'mod-drone-rack-3', rarity: 'rare', basePrice: 1_960_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-tac-3', kind: 'module', refId: 'mod-drone-tac-3', rarity: 'rare', basePrice: 2_040_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-relay-3', kind: 'module', refId: 'mod-drone-relay-3', rarity: 'rare', basePrice: 2_030_000, demandMultiplier: 0.65 }, // 无人机中继天线 MK3（2026-09-10 现货）
  // V18.1 支援件（伤害稳定器/射速计算机 = 低槽；索敌阵列/姿态陀螺 = 中槽；MK1 常驻、MK2/3 稀有）
  { key: 'mod-stab-kin-1', kind: 'module', refId: 'mod-stab-kin-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-exp-1', kind: 'module', refId: 'mod-stab-exp-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-pla-1', kind: 'module', refId: 'mod-stab-pla-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-rof-1', kind: 'module', refId: 'mod-rof-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-track-1', kind: 'module', refId: 'mod-track-1', rarity: 'common', basePrice: 26_000, demandMultiplier: 0.6 },
  { key: 'mod-gyro-1', kind: 'module', refId: 'mod-gyro-1', rarity: 'common', basePrice: 24_000, demandMultiplier: 0.6 },
  // 船体维修装置（2026-09-09：中槽自动修复件——消耗型；民用级常驻、MK1/MK2 稀有现货；
  // 2026-09-09 船长定：价格档位对位升一级 = 民用级对标支援件 MK1 档、MK1 对标 MK2 档、MK2 对标 MK3 档）
  { key: 'mod-hullrep-civ', kind: 'module', refId: 'mod-hullrep-civ', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-kin-2', kind: 'module', refId: 'mod-stab-kin-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-exp-2', kind: 'module', refId: 'mod-stab-exp-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-pla-2', kind: 'module', refId: 'mod-stab-pla-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  { key: 'mod-rof-2', kind: 'module', refId: 'mod-rof-2', rarity: 'rare', basePrice: 468_000, demandMultiplier: 0.65 },
  { key: 'mod-track-2', kind: 'module', refId: 'mod-track-2', rarity: 'rare', basePrice: 455_000, demandMultiplier: 0.65 },
  { key: 'mod-gyro-2', kind: 'module', refId: 'mod-gyro-2', rarity: 'rare', basePrice: 449_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-kin-3', kind: 'module', refId: 'mod-stab-kin-3', rarity: 'rare', basePrice: 2_360_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-exp-3', kind: 'module', refId: 'mod-stab-exp-3', rarity: 'rare', basePrice: 2_360_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-pla-3', kind: 'module', refId: 'mod-stab-pla-3', rarity: 'rare', basePrice: 2_360_000, demandMultiplier: 0.65 },
  { key: 'mod-rof-3', kind: 'module', refId: 'mod-rof-3', rarity: 'rare', basePrice: 2_290_000, demandMultiplier: 0.65 },
  { key: 'mod-track-3', kind: 'module', refId: 'mod-track-3', rarity: 'rare', basePrice: 2_230_000, demandMultiplier: 0.65 },
  { key: 'mod-gyro-3', kind: 'module', refId: 'mod-gyro-3', rarity: 'rare', basePrice: 2_210_000, demandMultiplier: 0.65 },
  // 2026-09-14 跃迁计算机（船长：「添加低槽装备…提高玩家舰船的跃迁速度，分别提高20%和35%，多件叠加惩罚。
  // 基础价格可以按照同级装备价格的四倍，有蓝图」）：价 = 低槽支援件同档（48.1 万 / 236 万）×4
  { key: 'mod-warpcomp-2', kind: 'module', refId: 'mod-warpcomp-2', rarity: 'rare', basePrice: 1_924_000, demandMultiplier: 0.65 }, // 跃迁计算机 MK2（支援件同档 48.1 万 ×4）
  { key: 'mod-warpcomp-3', kind: 'module', refId: 'mod-warpcomp-3', rarity: 'rare', basePrice: 9_440_000, demandMultiplier: 0.65 }, // 跃迁计算机 MK3（支援件同档 236 万 ×4）
  // 2026-09-11 协处理器（船长定：低槽 CPU 预算扩容件；MK1 稀有 2 档 / MK2 稀有 3 档 /
  // **MK3 稀有 4 档走奇货、无蓝图**）——价格落在本档既有带内（第 2 档 38.5~48.1 万、第 3 档 192~240 万）
  { key: 'mod-cpu-1', kind: 'module', refId: 'mod-cpu-1', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-cpu-2', kind: 'module', refId: 'mod-cpu-2', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  // 船体维修装置 MK1/MK2（消耗型修复件：2026-09-09 船长定档位价对位——MK1 对标支援件 MK2 档、MK2 对标支援件 MK3 档；
  // 2026-09-10 起改按「同级武器价对齐」→ MK1 落第 2 档带 46.8 万、MK2 落第 3 档带 229 万）
  { key: 'mod-hullrep-1', kind: 'module', refId: 'mod-hullrep-1', rarity: 'rare', basePrice: 468_000, demandMultiplier: 0.65 },
  { key: 'mod-hullrep-2', kind: 'module', refId: 'mod-hullrep-2', rarity: 'rare', basePrice: 2_290_000, demandMultiplier: 0.65 },
  // 目标锁定阵列（2026-09-09 高槽 target-lock：集火 + 被锁目标受击加深；MK1 常驻、MK2/3 稀有——价档对齐索敌阵列同梯队）
  { key: 'mod-lock-1', kind: 'module', refId: 'mod-lock-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-lock-2', kind: 'module', refId: 'mod-lock-2', rarity: 'rare', basePrice: 465_000, demandMultiplier: 0.65 },
  { key: 'mod-lock-3', kind: 'module', refId: 'mod-lock-3', rarity: 'rare', basePrice: 2_270_000, demandMultiplier: 0.65 },
  /* ═══ 2026-09-15 隐秘行动装置（船长：高槽 · 自身武器开火前隐身 20/30 秒 · 带推进器则直接解除隐身）
      2026-09-16 船长定数与渠道：**MK2 = CPU 55 · 300 万 · 稀有订单档 3** · **MK3 = CPU 80 · 1000 万 · 奇货档 4**；
      蓝图书价照档位系数 = 产物 **×2.5（750 万）/ ×4（奇货，4000 万）**，与 blueprints.ts 的 bp-stealth-2/3 同值 ═══ */
  { key: 'mod-stealth-2', kind: 'module', refId: 'mod-stealth-2', rarity: 'rare', basePrice: 3_000_000, demandMultiplier: 0.65 },
  { key: 'mod-stealth-3', kind: 'module', refId: 'mod-stealth-3', rarity: 'exotic', basePrice: 10_000_000, demandMultiplier: 0.75 },
  /* ═══ B3 打捞器（2026-09-05；**高槽**无伤害件（2026-09-13 曾改判低槽，2026-09-14 船长「改回高槽」）：升级只减周期；初价按低耗件梯队，可调） ═══ */
  { key: 'mod-salvager-1', kind: 'module', refId: 'mod-salvager-1', rarity: 'common', basePrice: 20_000, demandMultiplier: 0.6 },
  { key: 'mod-salvager-2', kind: 'module', refId: 'mod-salvager-2', rarity: 'rare', basePrice: 439_000, demandMultiplier: 0.65 },
  { key: 'mod-salvager-3', kind: 'module', refId: 'mod-salvager-3', rarity: 'rare', basePrice: 2_220_000, demandMultiplier: 0.65 },
  // 高级蓝图 MK2（旧）+ MK3（V10：学习需声望 4）
  { key: 'bp-miner-2', kind: 'blueprint', refId: 'bp-miner-2', rarity: 'rare', basePrice: 1165000, demandMultiplier: 0.65 },
  { key: 'bp-cargo-2', kind: 'blueprint', refId: 'bp-cargo-2', rarity: 'rare', basePrice: 1187500, demandMultiplier: 0.65 },
  { key: 'bp-turret-2', kind: 'blueprint', refId: 'bp-turret-2', rarity: 'rare', basePrice: 962500, demandMultiplier: 0.65 },
  { key: 'bp-miner-3', kind: 'blueprint', refId: 'bp-miner-3', rarity: 'rare', basePrice: 6990000, demandMultiplier: 0.65, standingReq: 4 },
  { key: 'bp-cargo-3', kind: 'blueprint', refId: 'bp-cargo-3', rarity: 'rare', basePrice: 7200000, demandMultiplier: 0.65, standingReq: 4 },
  { key: 'bp-turret-3', kind: 'blueprint', refId: 'bp-turret-3', rarity: 'rare', basePrice: 5748000, demandMultiplier: 0.65, standingReq: 4 },
  // 2026-09-09 全蓝图化（MK2 蓝图稀有；MK3 蓝图稀有+声望 4，战斗系 MK3 与维修装置 MK2 进声望 11 暗市闸）
  { key: 'bp-laser-2', kind: 'blueprint', refId: 'bp-laser-2', rarity: 'rare', basePrice: 1202500, demandMultiplier: 0.65 }, // 重型激光炮 MK2（蓝图=产物×2.5）
  { key: 'bp-laser-3', kind: 'blueprint', refId: 'bp-laser-3', rarity: 'rare', basePrice: 7185000, demandMultiplier: 0.65, standingReq: 4 }, // 攻坚激光炮 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-missile-2', kind: 'blueprint', refId: 'bp-missile-2', rarity: 'rare', basePrice: 1127500, demandMultiplier: 0.65 }, // 重型导弹架 MK2（蓝图=产物×2.5）
  { key: 'bp-missile-3', kind: 'blueprint', refId: 'bp-missile-3', rarity: 'rare', basePrice: 6726000, demandMultiplier: 0.65, standingReq: 4 }, // 巡航导弹架 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-drone-rack-2', kind: 'blueprint', refId: 'bp-drone-rack-2', rarity: 'rare', basePrice: 1045000, demandMultiplier: 0.65 }, // 无人机甲板扩展 MK2（蓝图=产物×2.5）
  { key: 'bp-drone-rack-3', kind: 'blueprint', refId: 'bp-drone-rack-3', rarity: 'rare', basePrice: 5880000, demandMultiplier: 0.65, standingReq: 4 }, // 无人机甲板扩展 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-drone-tac-2', kind: 'blueprint', refId: 'bp-drone-tac-2', rarity: 'rare', basePrice: 1137500, demandMultiplier: 0.65 }, // 战术导控阵列 MK2（蓝图=产物×2.5）
  { key: 'bp-drone-tac-3', kind: 'blueprint', refId: 'bp-drone-tac-3', rarity: 'rare', basePrice: 6120000, demandMultiplier: 0.65, standingReq: 4 }, // 战术导控阵列 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-drone-relay-1', kind: 'blueprint', refId: 'bp-drone-relay-1', rarity: 'common', basePrice: 30000, demandMultiplier: 0.6 }, // 无人机中继天线 MK1（蓝图=产物×2）
  { key: 'bp-drone-relay-2', kind: 'blueprint', refId: 'bp-drone-relay-2', rarity: 'rare', basePrice: 1122500, demandMultiplier: 0.65 }, // 无人机中继天线 MK2（蓝图=产物×2.5）
  { key: 'bp-drone-relay-3', kind: 'blueprint', refId: 'bp-drone-relay-3', rarity: 'rare', basePrice: 6090000, demandMultiplier: 0.65, standingReq: 4 }, // 无人机中继天线 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-shield-kin-2', kind: 'blueprint', refId: 'bp-shield-kin-2', rarity: 'rare', basePrice: 962500, demandMultiplier: 0.65 }, // 护盾增强器 MK2·动能型（蓝图=产物×2.5）
  { key: 'bp-shield-exp-2', kind: 'blueprint', refId: 'bp-shield-exp-2', rarity: 'rare', basePrice: 962500, demandMultiplier: 0.65 }, // 护盾增强器 MK2·高爆型（蓝图=产物×2.5）
  { key: 'bp-shield-pla-2', kind: 'blueprint', refId: 'bp-shield-pla-2', rarity: 'rare', basePrice: 962500, demandMultiplier: 0.65 }, // 护盾增强器 MK2·能量型（蓝图=产物×2.5）
  { key: 'bp-shield-kin-3', kind: 'blueprint', refId: 'bp-shield-kin-3', rarity: 'rare', basePrice: 5760000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾增强器 MK3·动能型（蓝图=产物×3）（入闸）
  { key: 'bp-shield-exp-3', kind: 'blueprint', refId: 'bp-shield-exp-3', rarity: 'rare', basePrice: 5760000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾增强器 MK3·高爆型（蓝图=产物×3）（入闸）
  { key: 'bp-shield-pla-3', kind: 'blueprint', refId: 'bp-shield-pla-3', rarity: 'rare', basePrice: 5760000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾增强器 MK3·能量型（蓝图=产物×3）（入闸）
  { key: 'bp-shield-ext-2', kind: 'blueprint', refId: 'bp-shield-ext-2', rarity: 'rare', basePrice: 962500, demandMultiplier: 0.65 }, // 护盾扩展器 MK2（蓝图=产物×2.5）
  { key: 'bp-shieldchg-2', kind: 'blueprint', refId: 'bp-shieldchg-2', rarity: 'common', basePrice: 936000, demandMultiplier: 0.6 }, // 护盾充能装置 MK2（**书比件好买**：现货稀有、书常驻；照船体维修装置 MK1）
  { key: 'bp-shield-ext-3', kind: 'blueprint', refId: 'bp-shield-ext-3', rarity: 'rare', basePrice: 5760000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾扩展器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-shieldchg-3', kind: 'blueprint', refId: 'bp-shieldchg-3', rarity: 'rare', basePrice: 5725000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾充能装置 MK3（蓝图=产物×2.5）（入闸 · 照船体维修装置 MK2）
  { key: 'bp-armor-kin-2', kind: 'blueprint', refId: 'bp-armor-kin-2', rarity: 'rare', basePrice: 970000, demandMultiplier: 0.65 }, // 装甲镀层 MK2·动能型（蓝图=产物×2.5）
  { key: 'bp-armor-exp-2', kind: 'blueprint', refId: 'bp-armor-exp-2', rarity: 'rare', basePrice: 970000, demandMultiplier: 0.65 }, // 装甲镀层 MK2·高爆型（蓝图=产物×2.5）
  { key: 'bp-armor-pla-2', kind: 'blueprint', refId: 'bp-armor-pla-2', rarity: 'rare', basePrice: 970000, demandMultiplier: 0.65 }, // 装甲镀层 MK2·能量型（蓝图=产物×2.5）
  { key: 'bp-armor-kin-3', kind: 'blueprint', refId: 'bp-armor-kin-3', rarity: 'rare', basePrice: 5820000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲镀层 MK3·动能型（蓝图=产物×3）（入闸）
  { key: 'bp-armor-exp-3', kind: 'blueprint', refId: 'bp-armor-exp-3', rarity: 'rare', basePrice: 5820000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲镀层 MK3·高爆型（蓝图=产物×3）（入闸）
  { key: 'bp-armor-pla-3', kind: 'blueprint', refId: 'bp-armor-pla-3', rarity: 'rare', basePrice: 5820000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲镀层 MK3·能量型（蓝图=产物×3）（入闸）
  { key: 'bp-armor-plate-2', kind: 'blueprint', refId: 'bp-armor-plate-2', rarity: 'rare', basePrice: 970000, demandMultiplier: 0.65 }, // 装甲增厚板 MK2（蓝图=产物×2.5）
  { key: 'bp-armor-plate-3', kind: 'blueprint', refId: 'bp-armor-plate-3', rarity: 'rare', basePrice: 5820000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲增厚板 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-prop-2', kind: 'blueprint', refId: 'bp-prop-2', rarity: 'rare', basePrice: 977500, demandMultiplier: 0.65 }, // 矢量推进器 MK2（蓝图=产物×2.5）
  { key: 'bp-prop-3', kind: 'blueprint', refId: 'bp-prop-3', rarity: 'rare', basePrice: 5910000, demandMultiplier: 0.65, standingReq: 4 }, // 矢量推进器 MK3（蓝图=产物×3）
  { key: 'bp-stab-kin-2', kind: 'blueprint', refId: 'bp-stab-kin-2', rarity: 'rare', basePrice: 1202500, demandMultiplier: 0.65 }, // 动能稳定器 MK2（蓝图=产物×2.5）
  { key: 'bp-stab-kin-3', kind: 'blueprint', refId: 'bp-stab-kin-3', rarity: 'rare', basePrice: 7080000, demandMultiplier: 0.65, standingReq: 4 }, // 动能稳定器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-stab-exp-2', kind: 'blueprint', refId: 'bp-stab-exp-2', rarity: 'rare', basePrice: 1202500, demandMultiplier: 0.65 }, // 高爆稳定器 MK2（蓝图=产物×2.5）
  { key: 'bp-stab-exp-3', kind: 'blueprint', refId: 'bp-stab-exp-3', rarity: 'rare', basePrice: 7080000, demandMultiplier: 0.65, standingReq: 4 }, // 高爆稳定器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-stab-pla-2', kind: 'blueprint', refId: 'bp-stab-pla-2', rarity: 'rare', basePrice: 1202500, demandMultiplier: 0.65 }, // 等离子稳定器 MK2（蓝图=产物×2.5）
  { key: 'bp-stab-pla-3', kind: 'blueprint', refId: 'bp-stab-pla-3', rarity: 'rare', basePrice: 7080000, demandMultiplier: 0.65, standingReq: 4 }, // 等离子稳定器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-rof-2', kind: 'blueprint', refId: 'bp-rof-2', rarity: 'rare', basePrice: 1170000, demandMultiplier: 0.65 }, // 射速计算机 MK2（蓝图=产物×2.5）
  { key: 'bp-rof-3', kind: 'blueprint', refId: 'bp-rof-3', rarity: 'rare', basePrice: 6870000, demandMultiplier: 0.65, standingReq: 4 }, // 射速计算机 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-track-2', kind: 'blueprint', refId: 'bp-track-2', rarity: 'rare', basePrice: 1137500, demandMultiplier: 0.65 }, // 索敌阵列 MK2（蓝图=产物×2.5）
  { key: 'bp-track-3', kind: 'blueprint', refId: 'bp-track-3', rarity: 'rare', basePrice: 6690000, demandMultiplier: 0.65, standingReq: 4 }, // 索敌阵列 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-gyro-2', kind: 'blueprint', refId: 'bp-gyro-2', rarity: 'rare', basePrice: 1122500, demandMultiplier: 0.65 }, // 姿态陀螺 MK2（蓝图=产物×2.5）
  { key: 'bp-gyro-3', kind: 'blueprint', refId: 'bp-gyro-3', rarity: 'rare', basePrice: 6630000, demandMultiplier: 0.65, standingReq: 4 }, // 姿态陀螺 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-warpcomp-2', kind: 'blueprint', refId: 'bp-warpcomp-2', rarity: 'rare', basePrice: 4810000, demandMultiplier: 0.65 }, // 跃迁计算机 MK2（蓝图=产物×2.5）
  { key: 'bp-warpcomp-3', kind: 'blueprint', refId: 'bp-warpcomp-3', rarity: 'rare', basePrice: 28320000, demandMultiplier: 0.65, standingReq: 4 }, // 跃迁计算机 MK3（蓝图=产物×3）（入闸）
  // 协处理器蓝图书（2026-09-11 新增；**无 MK3 蓝图**——船长定 MK3 走奇货现货）
  // 价按文档口径「蓝图 = 产物 × 2（MK1）/ × 2.5（MK2）」，与 blueprints.priceIsk 同源
  { key: 'bp-cpu-1', kind: 'blueprint', refId: 'bp-cpu-1', rarity: 'rare', basePrice: 776000, demandMultiplier: 0.65 }, // 协处理器 MK1（蓝图=产物×2）
  { key: 'bp-cpu-2', kind: 'blueprint', refId: 'bp-cpu-2', rarity: 'rare', basePrice: 4850000, demandMultiplier: 0.65 }, // 协处理器 MK2（蓝图=产物×2.5）
  { key: 'bp-salvager-2', kind: 'blueprint', refId: 'bp-salvager-2', rarity: 'rare', basePrice: 1097500, demandMultiplier: 0.65 }, // 打捞器 MK2（蓝图=产物×2.5）
  { key: 'bp-salvager-3', kind: 'blueprint', refId: 'bp-salvager-3', rarity: 'rare', basePrice: 6660000, demandMultiplier: 0.65, standingReq: 4 }, // 打捞器 MK3（蓝图=产物×3）
  { key: 'bp-hullrep-2', kind: 'blueprint', refId: 'bp-hullrep-2', rarity: 'rare', basePrice: 5725000, demandMultiplier: 0.65, standingReq: 4 }, // 船体维修装置 MK2（蓝图=产物×3）（入闸）
  { key: 'bp-lock-2', kind: 'blueprint', refId: 'bp-lock-2', rarity: 'rare', basePrice: 1162500, demandMultiplier: 0.65 }, // 目标锁定阵列 MK2（蓝图=产物×2.5）
  { key: 'bp-lock-3', kind: 'blueprint', refId: 'bp-lock-3', rarity: 'rare', basePrice: 6810000, demandMultiplier: 0.65, standingReq: 4 }, // 目标锁定阵列 MK3（蓝图=产物×3）
  // 2026-09-15 隐秘行动装置（高槽 · 开火前隐身 20/30 秒）；2026-09-16 船长定数：MK2 = 300 万（稀有档 3）、
  // MK3 = 1000 万（**奇货档 4**）⇒ 书价 = 产物 ×2.5 / **×4**（奇货档规矩，无 MK 阶梯），与 blueprints.ts 同值（硬契约）
  { key: 'bp-stealth-2', kind: 'blueprint', refId: 'bp-stealth-2', rarity: 'rare', basePrice: 7500000, demandMultiplier: 0.65 },
  { key: 'bp-stealth-3', kind: 'blueprint', refId: 'bp-stealth-3', rarity: 'exotic', basePrice: 40000000, demandMultiplier: 0.75 },
  // 舰船蓝图（造船；稀有）
  { key: 'sbp-pioneer', kind: 'blueprint', refId: 'sbp-pioneer', rarity: 'exotic', basePrice: 3_600_000, demandMultiplier: 1.0, standingReq: 11 }, // 开拓级（蓝图=船价×3；2026-09-09 随全蓝图化升奇货档+声望 11）
  { key: 'sbp-humpback', kind: 'blueprint', refId: 'sbp-humpback', rarity: 'exotic', basePrice: 36_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 座头鲸级（2026-09-13 价位重排：船价 9M ×4；T3 蓝图门槛 15）
  // 稀有舰船（V10 四条族线中坚）
  { key: 'ship-whale', kind: 'ship', refId: 'whale', rarity: 'rare', basePrice: 900_000, demandMultiplier: 0.65 },
  // 蓝图船（2026-09-09 船长：成品无现货、只收不卖）——玩家已拥有的开拓级可二手挂售，NPC 收购，
  // 市场不出售成品（图鉴「仅可制造」标注自洽；供给抽取侧 playerBuyable=false 天然排除）
  { key: 'ship-pioneer', kind: 'ship', refId: 'pioneer', rarity: 'rare', basePrice: 1_200_000, demandMultiplier: 0.65, playerBuyable: false },
  { key: 'ship-humpback', kind: 'ship', refId: 'sh-humpback', rarity: 'rare', basePrice: 9_000_000, demandMultiplier: 0.65, standingReq: 12 }, // 2026-09-13 价位重排：T3 工业（鲸吞 0.9M ×10）；T3 门槛 12
  { key: 'ship-bowhead', kind: 'ship', refId: 'sh-bowhead', rarity: 'exotic', basePrice: 67_500_000, demandMultiplier: 1.0, standingReq: 20 }, // 2026-09-13：价位重排（T4 货舰，剑鱼 24M ×2.81）+ **渠道升奇货**（船长「蝠鲼现货和蓝图上调至奇货」）
  { key: 'ship-falconet', kind: 'ship', refId: 'sh-falconet', rarity: 'rare', basePrice: 42_000, demandMultiplier: 0.65 },
  { key: 'ship-shrike', kind: 'ship', refId: 'sh-shrike', rarity: 'rare', basePrice: 110_000, demandMultiplier: 0.65 },
  { key: 'ship-tigershark', kind: 'ship', refId: 'sh-tigershark', rarity: 'rare', basePrice: 240_000, demandMultiplier: 0.65 },
  { key: 'ship-mako', kind: 'ship', refId: 'sh-mako', rarity: 'rare', basePrice: 480_000, demandMultiplier: 0.65 },
  { key: 'ship-swarm', kind: 'ship', refId: 'sh-swarm', rarity: 'rare', basePrice: 620_000, demandMultiplier: 0.65 },
  { key: 'ship-tortoise', kind: 'ship', refId: 'sh-tortoise', rarity: 'rare', basePrice: 450_000, demandMultiplier: 0.65 },
  { key: 'ship-hawksbill', kind: 'ship', refId: 'sh-hawksbill', rarity: 'exotic', basePrice: 6_000_000, demandMultiplier: 1.0, standingReq: 12 }, // 2026-09-13：价位重排（T3 装甲，陆龟 0.45M ×13.3）+ **渠道升奇货**（船长「玳瑁现货和蓝图上调至奇货」）
  { key: 'ship-flyingfish', kind: 'ship', refId: 'sh-flyingfish', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.65 },
  { key: 'ship-sailfish', kind: 'ship', refId: 'sh-sailfish', rarity: 'rare', basePrice: 2_400_000, demandMultiplier: 0.65, standingReq: 12 }, // 2026-09-13 价位重排：T3 货舰（飞鱼 0.21M ×11.4）；T3 门槛 12

  // ══════════ 限定奇货（exotic：极低概率、寿命 4 分钟、天价） ══════════

  // 鲸王级成品 2026-09-09 船长定只收不卖：蓝图船无现货——市场只供其造船蓝图书（sbp 奇货）；
  // 玩家已拥有的鲸王级可二手挂售（NPC 收购），成品永不出售
  { key: 'ship-whale-king', kind: 'ship', refId: 'whale-king', rarity: 'exotic', basePrice: 12_000_000, demandMultiplier: 1.0, standingReq: 12, playerBuyable: false }, // 2026-09-13 价位重排：T3 工业（开拓 1.2M ×10）
  { key: 'sbp-whale-king', kind: 'blueprint', refId: 'sbp-whale-king', rarity: 'exotic', basePrice: 48_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 2026-09-13：蓝图=船价×4；T3 蓝图门槛 15
  // V10 顶级船（声望解锁）
  { key: 'ship-sentinel', kind: 'ship', refId: 'sh-sentinel', rarity: 'exotic', basePrice: 2_600_000, demandMultiplier: 1.0, standingReq: 12 }, // 2026-09-13：T3 门槛统一 12（原 2026-09-09 定的 6→10 由本口径取代）
  { key: 'ship-whiteshark', kind: 'ship', refId: 'sh-whiteshark', rarity: 'exotic', basePrice: 1_100_000, demandMultiplier: 1.0, standingReq: 7 }, // T2：保留门槛（船长 2026-09-13「大白鲨作为稀有船，可以保留门槛」）
  // 掠食者巡洋舰线（2026-09-09 尺寸分级：T3 巡洋入奇货；价位 2026-09-09 船长定档：按战力序 9/11/13/15M）
  { key: 'ship-thresher', kind: 'ship', refId: 'sh-thresher', rarity: 'exotic', basePrice: 9_000_000, demandMultiplier: 1.0, standingReq: 12 },
  { key: 'ship-electricray', kind: 'ship', refId: 'sh-electricray', rarity: 'exotic', basePrice: 15_000_000, demandMultiplier: 1.0, standingReq: 12 },
  { key: 'ship-hammerhead', kind: 'ship', refId: 'sh-hammerhead', rarity: 'exotic', basePrice: 11_000_000, demandMultiplier: 1.0, standingReq: 12 },
  { key: 'ship-bullshark', kind: 'ship', refId: 'sh-bullshark', rarity: 'exotic', basePrice: 13_000_000, demandMultiplier: 1.0, standingReq: 12 },
  // 2026-09-13 船长：**鹦鹉螺级**（协会测绘处 · T3 侦察巡洋舰）——奇货 + 数字 4（与长尾鲨级同档同价）；
  // ✅ 2026-09-14 虫洞上线：**闸门已删**（与舰体/两张图纸同一批放开，见 design/scout-cruiser §2.3）
  { key: 'ship-nautilus', kind: 'ship', refId: 'sh-nautilus', rarity: 'exotic', basePrice: 9_000_000, demandMultiplier: 1.0, standingReq: 12 },
  { key: 'ship-swordfish', kind: 'ship', refId: 'sh-swordfish', rarity: 'exotic', basePrice: 24_000_000, demandMultiplier: 1.0, standingReq: 20 }, // 2026-09-13 价位重排：T4 货舰（旗鱼 2.4M ×10）；T4 门槛 20
  { key: 'ship-xuanwu', kind: 'ship', refId: 'sh-xuanwu', rarity: 'exotic', basePrice: 90_000_000, demandMultiplier: 1.0, standingReq: 20 }, // 2026-09-13 价位重排：T4 装甲（玳瑁 6M ×15）；T4 门槛 20
  // 2026-09-13 船长裁定：巨齿鲨级（T4 战列舰）走**仅图纸制造**——成品只收不卖（照皇带鱼口径），
  // 行价 225M = T3 武装顶（电鳐 15M）×15；蓝图价 900M = 行价 ×4（>400 万档系数）。**T4 门槛 20**。
  { key: 'ship-megalodon', kind: 'ship', refId: 'sh-megalodon', rarity: 'exotic', basePrice: 225_000_000, demandMultiplier: 1.0, standingReq: 20, playerBuyable: false },
  // 2026-09-11 船长裁决（甲）：皇带鱼与开拓/鲸王同口径——**蓝图船收起成品现货**（只收不卖，二手可卖）。
  // 此前它漏在 2026-09-09「蓝图船成品现货下架」那次清扫之外：图鉴写着「仅可制造」（ships.ts priceIsk=0），
  // 市场却挂着 550 万现货——同一条口径两处打架，由 content-check「舰船价格口径（预警）」抓出。
  { key: 'ship-colossal', kind: 'ship', refId: 'sh-colossal', rarity: 'exotic', basePrice: 640_000_000, demandMultiplier: 1.0, standingReq: 35, playerBuyable: false }, // 2026-09-13 价位重排：T5 旗舰（旗舰基准 8 亿 ×0.8 非战斗下浮）；T5 门槛 35
  // 2026-09-09 全舰船蓝图化（第二批）：全部可造舰船开放蓝图书；**蓝图价 = 船市场价 × 档位系数**
  // （≤30 万 ×2 / 30~100 万 ×2.5 / 100~400 万 ×3 / >400 万 ×4）——这条**仍然有效**。
  // ⚠ **2026-09-13 旧规则作废**：同一条注释里的「船价 ≤100 万 → 稀有、>100 万 → 奇货+声望 11」已作废——
  // 声望口径改为**按舰种档**（T1/T2 保持现状 · T3 现货 12 / 蓝图 15 · T4 20/25 · T5 35/40；
  // 装备与物品行不动）。见 `docs/design/price-ladder-20260913.md`。
  { key: 'sbp-burrower', kind: 'blueprint', refId: 'sbp-burrower', rarity: 'rare', basePrice: 240000, demandMultiplier: 0.65 }, // 掘洞级（蓝图=船价×2）
  { key: 'sbp-whale', kind: 'blueprint', refId: 'sbp-whale', rarity: 'rare', basePrice: 2250000, demandMultiplier: 0.65 }, // 鲸吞级（蓝图=船价×2.5）
  { key: 'sbp-bowhead', kind: 'blueprint', refId: 'sbp-bowhead', rarity: 'exotic', basePrice: 270_000_000, demandMultiplier: 1.0, standingReq: 25 }, // 蝠鲼级（2026-09-13：船价 67.5M ×4 + **渠道升奇货**）
  { key: 'sbp-falconet', kind: 'blueprint', refId: 'sbp-falconet', rarity: 'rare', basePrice: 80000, demandMultiplier: 0.65 }, // 鲣鱼级（蓝图=船价×2）
  { key: 'sbp-shrike', kind: 'blueprint', refId: 'sbp-shrike', rarity: 'rare', basePrice: 220000, demandMultiplier: 0.65 }, // 马鲛级（蓝图=船价×2）
  { key: 'sbp-tigershark', kind: 'blueprint', refId: 'sbp-tigershark', rarity: 'rare', basePrice: 480000, demandMultiplier: 0.65 }, // 虎鲨级（蓝图=船价×2）
  { key: 'sbp-mako', kind: 'blueprint', refId: 'sbp-mako', rarity: 'rare', basePrice: 1200000, demandMultiplier: 0.65 }, // 灰鲭鲨级（蓝图=船价×2.5）
  { key: 'sbp-whiteshark', kind: 'blueprint', refId: 'sbp-whiteshark', rarity: 'exotic', basePrice: 3300000, demandMultiplier: 1.0, standingReq: 11 }, // 大白鲨级（蓝图=船价×3）
  { key: 'sbp-swarm', kind: 'blueprint', refId: 'sbp-swarm', rarity: 'rare', basePrice: 1550000, demandMultiplier: 0.65 }, // 梭鱼级（蓝图=船价×2.5）
  { key: 'sbp-sentinel', kind: 'blueprint', refId: 'sbp-sentinel', rarity: 'exotic', basePrice: 7_800_000, demandMultiplier: 1.0, standingReq: 15 }, // 王鲭级（2026-09-13：T3 蓝图门槛 15）
  { key: 'sbp-thresher', kind: 'blueprint', refId: 'sbp-thresher', rarity: 'exotic', basePrice: 36_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 长尾鲨级（2026-09-13：T3 蓝图门槛 15）
  { key: 'sbp-electricray', kind: 'blueprint', refId: 'sbp-electricray', rarity: 'exotic', basePrice: 60_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 电鳐级（2026-09-13：T3 蓝图门槛 15）
  { key: 'sbp-hammerhead', kind: 'blueprint', refId: 'sbp-hammerhead', rarity: 'exotic', basePrice: 44_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 锤头鲨级（2026-09-13：T3 蓝图门槛 15）
  { key: 'sbp-bullshark', kind: 'blueprint', refId: 'sbp-bullshark', rarity: 'exotic', basePrice: 52_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 牛鲨级（2026-09-13：T3 蓝图门槛 15）
  { key: 'sbp-nautilus', kind: 'blueprint', refId: 'sbp-nautilus', rarity: 'exotic', basePrice: 36_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 鹦鹉螺级（2026-09-13：T3 蓝图门槛 15；✅ 2026-09-14 上线放开）
  { key: 'sbp-tortoise', kind: 'blueprint', refId: 'sbp-tortoise', rarity: 'rare', basePrice: 830000, demandMultiplier: 0.65 }, // 陆龟级（蓝图=船价×2.5）
  { key: 'sbp-hawksbill', kind: 'blueprint', refId: 'sbp-hawksbill', rarity: 'exotic', basePrice: 24_000_000, demandMultiplier: 1.0, standingReq: 15 }, // 玳瑁级（2026-09-13：船价 6M ×4 + **渠道升奇货**）
  { key: 'sbp-xuanwu', kind: 'blueprint', refId: 'sbp-xuanwu', rarity: 'exotic', basePrice: 360_000_000, demandMultiplier: 1.0, standingReq: 25 }, // 玄武级（2026-09-13 价位重排：船价 90M ×4；T4 蓝图门槛 25）
  { key: 'sbp-flyingfish', kind: 'blueprint', refId: 'sbp-flyingfish', rarity: 'rare', basePrice: 420000, demandMultiplier: 0.65 }, // 飞鱼级（蓝图=船价×2）
  { key: 'sbp-sailfish', kind: 'blueprint', refId: 'sbp-sailfish', rarity: 'rare', basePrice: 7_200_000, demandMultiplier: 0.65, standingReq: 15 }, // 旗鱼级（2026-09-13 价位重排：船价 2.4M 属 100~400 万档 ⇒ ×3 = 7.2M；T3 蓝图门槛 15）
  { key: 'sbp-swordfish', kind: 'blueprint', refId: 'sbp-swordfish', rarity: 'exotic', basePrice: 96_000_000, demandMultiplier: 1.0, standingReq: 25 }, // 剑鱼级（2026-09-13 价位重排：船价 24M ×4；T4 蓝图门槛 25）
  { key: 'sbp-megalodon', kind: 'blueprint', refId: 'sbp-megalodon', rarity: 'exotic', basePrice: 900_000_000, demandMultiplier: 1.0, standingReq: 25 }, // 巨齿鲨级（船价 225M ×4；T4 蓝图门槛 25）

// 2026-09-13 价位重排：皇带鱼 = 旗舰基准 8 亿 ×0.8 = 640M（蓝图 ×4 = 2.56B）；其余三张的价格口径见各自行注释
  { key: 'sbp-colossal', kind: 'blueprint', refId: 'sbp-colossal', rarity: 'exotic', basePrice: 2_560_000_000, demandMultiplier: 1.0, standingReq: 40 }, // 皇带鱼级（2026-09-13：船价 640M ×4；T5 蓝图门槛 40）
  // ══════════ T3/T4/T5 的**一次性蓝图**（2026-09-13 船长：「给T3船也添加一次性蓝图」＋
  //   「T4T5舰船都出一张一次性蓝图，价格按照舰船价格的100%算」）══════════
  // 口径：① 价格 = **该舰市场行价 × 50%**（**2026-09-14 船长改判**：「将一次性蓝图的价格下调到舰船的
  //       0.5倍」——原「×100%」作废）；② `singleUse` ⇒ 造一艘吃一张；③ 材料/工期同永久蓝图；
  //      ④ **渠道**：T3 十张 + 剑鱼/蝠鲼 = 稀有订单层（数字 3）；玄武/巨齿鲨/皇带鱼 = 奇货（数字 4）；
  //      ⑤ **权重**：引擎 `blueprintWeight` 对一次性舰船蓝图 = ×0.5（普通蓝图 ×0.05）。
  { key: 'sbp-once-sailfish', kind: 'blueprint', refId: 'sbp-once-sailfish', rarity: 'rare', basePrice: 1_200_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-sentinel', kind: 'blueprint', refId: 'sbp-once-sentinel', rarity: 'rare', basePrice: 1_300_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-hawksbill', kind: 'blueprint', refId: 'sbp-once-hawksbill', rarity: 'rare', basePrice: 3_000_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-humpback', kind: 'blueprint', refId: 'sbp-once-humpback', rarity: 'rare', basePrice: 4_500_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-thresher', kind: 'blueprint', refId: 'sbp-once-thresher', rarity: 'rare', basePrice: 4_500_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-nautilus', kind: 'blueprint', refId: 'sbp-once-nautilus', rarity: 'rare', basePrice: 4_500_000, demandMultiplier: 0.65, standingReq: 15 }, // ✅ 2026-09-14 随鹦鹉螺级同步放开
  { key: 'sbp-once-hammerhead', kind: 'blueprint', refId: 'sbp-once-hammerhead', rarity: 'rare', basePrice: 5_500_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-whale-king', kind: 'blueprint', refId: 'sbp-once-whale-king', rarity: 'rare', basePrice: 6_000_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-bullshark', kind: 'blueprint', refId: 'sbp-once-bullshark', rarity: 'rare', basePrice: 6_500_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-electricray', kind: 'blueprint', refId: 'sbp-once-electricray', rarity: 'rare', basePrice: 7_500_000, demandMultiplier: 0.65, standingReq: 15 },
  { key: 'sbp-once-swordfish', kind: 'blueprint', refId: 'sbp-once-swordfish', rarity: 'rare', basePrice: 12_000_000, demandMultiplier: 0.65, standingReq: 25 }, // T4：船长「剑鱼的一次性蓝图也下放稀有」
  { key: 'sbp-once-bowhead', kind: 'blueprint', refId: 'sbp-once-bowhead', rarity: 'rare', basePrice: 33_750_000, demandMultiplier: 0.65, standingReq: 25 }, // T4：船长「蝠鲼…一次性蓝图保留在稀有」
  { key: 'sbp-once-xuanwu', kind: 'blueprint', refId: 'sbp-once-xuanwu', rarity: 'exotic', basePrice: 45_000_000, demandMultiplier: 1.0, standingReq: 25 },
  { key: 'sbp-once-megalodon', kind: 'blueprint', refId: 'sbp-once-megalodon', rarity: 'exotic', basePrice: 112_500_000, demandMultiplier: 1.0, standingReq: 25 },
  { key: 'sbp-once-colossal', kind: 'blueprint', refId: 'sbp-once-colossal', rarity: 'exotic', basePrice: 320_000_000, demandMultiplier: 1.0, standingReq: 40 },
  // 异星原型装备（V10：超档收藏，无蓝图，需声望 10）
  { key: 'mod-miner-proto', kind: 'module', refId: 'mod-miner-proto', rarity: 'exotic', basePrice: 1_600_000, demandMultiplier: 1.0, standingReq: 10 },
  { key: 'mod-cargo-proto', kind: 'module', refId: 'mod-cargo-proto', rarity: 'exotic', basePrice: 1_500_000, demandMultiplier: 1.0, standingReq: 10 },
  { key: 'mod-laser-proto', kind: 'module', refId: 'mod-laser-proto', rarity: 'exotic', basePrice: 3_000_000, demandMultiplier: 1.0, standingReq: 10 },
  // 协处理器 MK3（2026-09-11 船长定：稀有度 4 走奇货、**无蓝图**——只能等奇货现货；无声望门槛）
  { key: 'mod-cpu-3', kind: 'module', refId: 'mod-cpu-3', rarity: 'exotic', basePrice: 2_600_000, demandMultiplier: 1.0 },
  /**
   * **高级 AI 核心**（伽马 / 贝塔 / 阿尔法）——**2026-09-14 船长两条改判**：
   *
   * ① **贝塔与阿尔法「移除出售订单」**（船长原话：「核心加入虫洞掉落后，移除市场的贝塔和阿尔法
   *    AI 核心的出售订单并备注」）⇒ 照**残骸 / 皇带鱼成品**的现成口径设 `playerBuyable: false`
   *    （**只收不卖**：市场不出售现货，NPC 仍按行价收购 ⇒ 玩家仍可回卖，只是买不到）。
   *    动机：这两种核心已在**虫洞遗迹打捞**里产出（10% 出货 · 贝塔 30 / 阿尔法 10 权重），
   *    再让市场卖现货就等于"花钱跳过副本"，掉落的稀缺性归零。
   *    ⚠ 伽马**不在此列**（船长只点了贝塔与阿尔法）⇒ 仍可市场购入。
   *
   * ② **按级别大幅提高价值**（船长原话：「同时按级别大幅提高AI核心的价值。阿尔法核心定价为1000万」，
   *    同日给定四档 = **2.5 万 / 20 万 / 150 万 / 1000 万**）：伽马 9 万 → **20 万**（×2.2）·
   *    贝塔 28 万 → **150 万**（×5.4）· 阿尔法 90 万 → **1000 万**（×11.1）；基础核心 2.5 万**不动**
   *    （不碰早期 AI 副船/产线的入门成本）。
   *    回卖价 = `basePrice × demandMultiplier`（exotic 档 = 1.0×）⇒ 捞到一枚阿尔法可卖 **1000 万**。
   */
  { key: 'core-gamma', kind: 'aicore', refId: 'gamma', rarity: 'exotic', basePrice: 200_000, demandMultiplier: 1.0 },
  { key: 'core-beta', kind: 'aicore', refId: 'beta', rarity: 'exotic', basePrice: 1_500_000, demandMultiplier: 1.0, playerBuyable: false },
  { key: 'core-alpha', kind: 'aicore', refId: 'alpha', rarity: 'exotic', basePrice: 10_000_000, demandMultiplier: 1.0, playerBuyable: false },
]

/**
 * P2 抽取节拍制闸内商品（2026-09-06 船长定：声望 11 前以低权重（0.04）参与每 10 分钟 rare
 * 加权抽取、命中即 ×4 价暗市单可绕过买入；解锁后恢复正常权重与价格、不转常驻）。
 * 范围 = MK3 战斗件 19 件（武器三族/无人机架·导控/盾·甲抗容/支援件；剔除生产件 miner·cargo·salvager
 * 与机动 prop）+ 动能 MK3 蓝图书（自制渠道同闸，防绕过）。
 * 原型（proto）与顶船维持原 standingReq 纯硬拦，不加暗市。
 */
const BM_MK3_KEYS = new Set([
  'mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3',
  'mod-drone-rack-3', 'mod-drone-tac-3',
  'mod-shield-kin-3', 'mod-shield-exp-3', 'mod-shield-pla-3', 'mod-shield-ext-3',
  'mod-armor-kin-3', 'mod-armor-exp-3', 'mod-armor-pla-3', 'mod-armor-plate-3',
  'mod-stab-kin-3', 'mod-stab-exp-3', 'mod-stab-pla-3', 'mod-rof-3', 'mod-track-3', 'mod-gyro-3',
  'bp-turret-3',
  'bp-laser-3',
  'bp-missile-3',
  'bp-drone-rack-3',
  'bp-drone-tac-3',
  'bp-shield-kin-3',
  'bp-shield-exp-3',
  'bp-shield-pla-3',
  'bp-shield-ext-3',
  'bp-shieldchg-3',
  'bp-armor-kin-3',
  'bp-armor-exp-3',
  'bp-armor-pla-3',
  'bp-armor-plate-3',
  'bp-stab-kin-3',
  'bp-stab-exp-3',
  'bp-stab-pla-3',
  'bp-rof-3',
  'bp-track-3',
  'bp-gyro-3',
  // 2026-09-14 跃迁计算机 MK3（+ 其蓝图）：按"**同槽支援件**"归入闸内（与 stab/rof/track/gyro 同列）。
  // ⚠ 它**不提升战斗力**（只缩短星系际航行时间）——与"机动 prop 剔出闸"那条理由相反；
  //   若船长要按 prop/MWD 口径放它出闸，删这两行即可（其余一行都不用动）。
  'mod-warpcomp-3',
  'bp-warpcomp-3',
  'bp-hullrep-2',
])

/* ═══════════ 残骸收购卡（2026-09-08 船长定：残骸可到市场出售，单独分类；只收不卖） ═══════════
 * - 收价按残骸所在星系回收档（常/险/危，与精炼炉「残骸回收」档一致）：30 / 40 / 50 信用点·m³。
 *   锚定口径（2026-09-08 修正）：三档无技能拆解保底均 ≈57/m³（Y×池均价反推齐平）——
 *   卖价必须**严格低于 57**（任何档直接卖都不如拆解），同时对"该档典型特色回收（含 m）"
 *   ≈ 50% 上下（常 60 / 险 71 / 危 97 估算 → 30/40/50 ≈ 50%/56%/52%）——拆解 + 彩头 + 碎片 +
 *   技能(×1.75) 仍明显更赚，卖站 = 折价清仓/应急通道；档位梯度保留（越危险卖价越高）；
 * - playerBuyable = false（只收不卖）：NPC 只挂收购单、不出售残骸（防"低价买残骸→拆解套利"）；
 * - 每单位 = 1 m³（残骸乙案记账：计数即体积）。
 */

const GALAXY_SEC = new Map(GALAXIES.map((g) => [g.id, typeof g.security === 'number' ? g.security : 0.5]))
/** 残骸站内收价（信用点/m³；档位 = 该星系基础密度回收档：常 <20 / 险 20~29 / 危 ≥30） */
const WRECK_BUY_PRICE = { common: 30, risky: 40, dire: 50 } as const

export const WRECK_BUY_GOODS: readonly MarketGoodDef[] = ANOMALIES.filter((a) => a.hidden !== true).map((a) => {
  const sec = GALAXY_SEC.get(a.galaxyId) ?? 0.5
  const density = Math.min(40, Math.max(10, Math.round(10 + 15 * (1 - sec))))
  const tier = density >= 30 ? 'dire' : density >= 20 ? 'risky' : 'common'
  const id = wreckItemIdOf(a.id)
  return {
    key: id,
    kind: 'item',
    refId: id,
    rarity: 'common',
    basePrice: WRECK_BUY_PRICE[tier],
    poolTarget: 30_000,
    supplyFlow: 500,
    playerBuyable: false, // 只收不卖：空间站回收站不出售残骸
  }
})

export const MARKET_GOODS: readonly MarketGoodDef[] = [
  ...MARKET_GOODS_RAW.map((g) => (BM_MK3_KEYS.has(g.key) ? { ...g, bmStanding: 11 } : g)),
  ...WRECK_BUY_GOODS,

  /* ══════════ 专属内容的市场行（2026-09-14 船长四条裁定 · 三号）══════════
   * 船长原话（照抄）：「允许玩家挂卖，顺便检查下其他物品，维持所有物品允许玩家挂卖」＋
   *   「所有专属的东西，价格翻4倍」。⇒ 凡此前**无市场行**的可获得内容一律补行：
   *   **一律 `playerBuyable: false`（只收不卖）**——市场不出售现货（渠道与稀缺性不变：洞内遗迹打捞 /
   *   窝点高级箱），但玩家**可以挂卖**（自定价挂单）、也可以卖给 NPC 收购单（奇货档 = 全价回收）。
   * 价 = **基准 × 4**（专属口径）：有材料单的走「材料 ÷ 0.45」当基准（全表"料/价 45%"锚）、
   *   窝点专属件走「同槽位最高档常规件」、专属无人机走**自带货值 `baseSellPriceIsk`**。
   * 不设声望门槛（门槛只挡买入，这些行不出售现货 ⇒ 设了没意义）；老档零迁移（纯内容表）。
   * ⚠ 沙猫级（协会保底艇）与邓氏鱼级（无渠道壳体）**有意不补**（船长裁定）——见 roadmap 同日条目。 */
  // ── 舰船图纸 15 张（`sbp-wh-*`：五族各 3，一次性）──
    { key: 'sbp-wh-a-frigate', kind: 'blueprint', refId: 'sbp-wh-a-frigate', rarity: 'exotic', basePrice: 1_153_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭电子舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-a-destroyer', kind: 'blueprint', refId: 'sbp-wh-a-destroyer', rarity: 'exotic', basePrice: 2_555_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭炮舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-a-cruiser', kind: 'blueprint', refId: 'sbp-wh-a-cruiser', rarity: 'exotic', basePrice: 4_942_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭重型突击巡洋舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-c-frigate', kind: 'blueprint', refId: 'sbp-wh-c-frigate', rarity: 'exotic', basePrice: 1_307_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幼虫截击舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-c-destroyer', kind: 'blueprint', refId: 'sbp-wh-c-destroyer', rarity: 'exotic', basePrice: 2_822_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 甲壳截击舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-c-cruiser', kind: 'blueprint', refId: 'sbp-wh-c-cruiser', rarity: 'exotic', basePrice: 5_680_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巢群重型突击巡洋舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-d-frigate', kind: 'blueprint', refId: 'sbp-wh-d-frigate', rarity: 'exotic', basePrice: 1_536_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 哨戒电子舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-d-destroyer', kind: 'blueprint', refId: 'sbp-wh-d-destroyer', rarity: 'exotic', basePrice: 3_722_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵卫指挥舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-d-cruiser', kind: 'blueprint', refId: 'sbp-wh-d-cruiser', rarity: 'exotic', basePrice: 7_680_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵寝巡洋舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-e-frigate', kind: 'blueprint', refId: 'sbp-wh-e-frigate', rarity: 'exotic', basePrice: 1_437_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 构件鱼雷舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-e-destroyer', kind: 'blueprint', refId: 'sbp-wh-e-destroyer', rarity: 'exotic', basePrice: 3_107_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 机库无人机作战舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-e-carrier', kind: 'blueprint', refId: 'sbp-wh-e-carrier', rarity: 'exotic', basePrice: 7_172_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构无人机作战舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-g-frigate', kind: 'blueprint', refId: 'sbp-wh-g-frigate', rarity: 'exotic', basePrice: 1_515_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幽影侦察舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-g-destroyer', kind: 'blueprint', refId: 'sbp-wh-g-destroyer', rarity: 'exotic', basePrice: 3_335_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军后勤舰图纸（一次性）（= 舰价 ×0.5）
    { key: 'sbp-wh-g-cruiser', kind: 'blueprint', refId: 'sbp-wh-g-cruiser', rarity: 'exotic', basePrice: 6_693_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军鱼雷舰图纸（一次性）（= 舰价 ×0.5）
  // ── 装备图纸 28 张（`bp-wh-*`：五族专属装备的一次性图纸）──
    { key: 'bp-wh-a-frag', kind: 'blueprint', refId: 'bp-wh-a-frag', rarity: 'exotic', basePrice: 5_244_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭破片炮图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-a-hangar', kind: 'blueprint', refId: 'bp-wh-a-hangar', rarity: 'exotic', basePrice: 3_955_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭机库图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-a-prop', kind: 'blueprint', refId: 'bp-wh-a-prop', rarity: 'exotic', basePrice: 2_995_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭加力器图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-a-coat', kind: 'blueprint', refId: 'bp-wh-a-coat', rarity: 'exotic', basePrice: 2_674_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭折射涂层图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-a-scan', kind: 'blueprint', refId: 'bp-wh-a-scan', rarity: 'exotic', basePrice: 2_802_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 赃物扫描阵图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-a-shield', kind: 'blueprint', refId: 'bp-wh-a-shield', rarity: 'exotic', basePrice: 4_764_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭者护盾笼图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-c-laser', kind: 'blueprint', refId: 'bp-wh-c-laser', rarity: 'exotic', basePrice: 4_995_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 生体棱镜束图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-c-prism', kind: 'blueprint', refId: 'bp-wh-c-prism', rarity: 'exotic', basePrice: 4_844_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 甲壳棱镜层图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-c-pulse', kind: 'blueprint', refId: 'bp-wh-c-pulse', rarity: 'exotic', basePrice: 2_915_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 生体脉搏加速器图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-c-missile', kind: 'blueprint', refId: 'bp-wh-c-missile', rarity: 'exotic', basePrice: 4_653_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 孢子导弹巢图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-c-frame', kind: 'blueprint', refId: 'bp-wh-c-frame', rarity: 'exotic', basePrice: 4_898_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 几丁质骨架层图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-d-turret', kind: 'blueprint', refId: 'bp-wh-d-turret', rarity: 'exotic', basePrice: 8_555_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵卫连装炮图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-d-shield', kind: 'blueprint', refId: 'bp-wh-d-shield', rarity: 'exotic', basePrice: 8_087_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵墓护盾芯图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-d-lock', kind: 'blueprint', refId: 'bp-wh-d-lock', rarity: 'exotic', basePrice: 6_454_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 守墓者丧钟图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-d-laser', kind: 'blueprint', refId: 'bp-wh-d-laser', rarity: 'exotic', basePrice: 9_312_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵寝棱镜炮图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-d-loader', kind: 'blueprint', refId: 'bp-wh-d-loader', rarity: 'exotic', basePrice: 5_506_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 守墓者速装填机图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-d-steady', kind: 'blueprint', refId: 'bp-wh-d-steady', rarity: 'exotic', basePrice: 5_141_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵墓弹道铭文图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-e-dc', kind: 'blueprint', refId: 'bp-wh-e-dc', rarity: 'exotic', basePrice: 7_442_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构损管阵列图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-e-tac', kind: 'blueprint', refId: 'bp-wh-e-tac', rarity: 'exotic', basePrice: 6_009_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构导控塔图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-e-cpu', kind: 'blueprint', refId: 'bp-wh-e-cpu', rarity: 'exotic', basePrice: 6_377_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构协处理器图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-e-pd', kind: 'blueprint', refId: 'bp-wh-e-pd', rarity: 'exotic', basePrice: 6_153_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构近防阵列图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-e-shield', kind: 'blueprint', refId: 'bp-wh-e-shield', rarity: 'exotic', basePrice: 7_406_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构护盾矩阵图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-g-hangar', kind: 'blueprint', refId: 'bp-wh-g-hangar', rarity: 'exotic', basePrice: 6_360_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军蜂巢坞图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-g-fcs', kind: 'blueprint', refId: 'bp-wh-g-fcs', rarity: 'exotic', basePrice: 4_978_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军火控图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-g-ballistic', kind: 'blueprint', refId: 'bp-wh-g-ballistic', rarity: 'exotic', basePrice: 4_642_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幽灵弹道校正器图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-g-hull', kind: 'blueprint', refId: 'bp-wh-g-hull', rarity: 'exotic', basePrice: 6_718_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 鱿蜂结构层图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-g-turret', kind: 'blueprint', refId: 'bp-wh-g-turret', rarity: 'exotic', basePrice: 6_306_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军残炮图纸（一次性）（料÷0.45×4）
    { key: 'bp-wh-g-prop', kind: 'blueprint', refId: 'bp-wh-g-prop', rarity: 'exotic', basePrice: 4_709_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幽灵推进器图纸（一次性）（料÷0.45×4）
  // ── 虫洞装备 28 件（`mod-wh-*`：与各自图纸同料单 ⇒ 同价）──
    { key: 'mod-wh-a-frag', kind: 'module', refId: 'mod-wh-a-frag', rarity: 'exotic', basePrice: 5_244_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭破片炮（料÷0.45×4）
    { key: 'mod-wh-a-hangar', kind: 'module', refId: 'mod-wh-a-hangar', rarity: 'exotic', basePrice: 3_955_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭机库（料÷0.45×4）
    { key: 'mod-wh-a-prop', kind: 'module', refId: 'mod-wh-a-prop', rarity: 'exotic', basePrice: 2_995_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭加力器（料÷0.45×4）
    { key: 'mod-wh-a-coat', kind: 'module', refId: 'mod-wh-a-coat', rarity: 'exotic', basePrice: 2_674_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭折射涂层（料÷0.45×4）
    { key: 'mod-wh-a-scan', kind: 'module', refId: 'mod-wh-a-scan', rarity: 'exotic', basePrice: 2_802_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 赃物扫描阵（料÷0.45×4）
    { key: 'mod-wh-a-shield', kind: 'module', refId: 'mod-wh-a-shield', rarity: 'exotic', basePrice: 4_764_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭者护盾笼（料÷0.45×4）
    { key: 'mod-wh-c-laser', kind: 'module', refId: 'mod-wh-c-laser', rarity: 'exotic', basePrice: 4_995_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 生体棱镜束（料÷0.45×4）
    { key: 'mod-wh-c-prism', kind: 'module', refId: 'mod-wh-c-prism', rarity: 'exotic', basePrice: 4_844_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 甲壳棱镜层（料÷0.45×4）
    { key: 'mod-wh-c-pulse', kind: 'module', refId: 'mod-wh-c-pulse', rarity: 'exotic', basePrice: 2_915_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 生体脉搏加速器（料÷0.45×4）
    { key: 'mod-wh-c-missile', kind: 'module', refId: 'mod-wh-c-missile', rarity: 'exotic', basePrice: 4_653_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 孢子导弹巢（料÷0.45×4）
    { key: 'mod-wh-c-frame', kind: 'module', refId: 'mod-wh-c-frame', rarity: 'exotic', basePrice: 4_898_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 几丁质骨架层（料÷0.45×4）
    { key: 'mod-wh-d-turret', kind: 'module', refId: 'mod-wh-d-turret', rarity: 'exotic', basePrice: 8_555_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵卫连装炮（料÷0.45×4）
    { key: 'mod-wh-d-shield', kind: 'module', refId: 'mod-wh-d-shield', rarity: 'exotic', basePrice: 8_087_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵墓护盾芯（料÷0.45×4）
    { key: 'mod-wh-d-lock', kind: 'module', refId: 'mod-wh-d-lock', rarity: 'exotic', basePrice: 6_454_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 守墓者丧钟（料÷0.45×4）
    { key: 'mod-wh-d-laser', kind: 'module', refId: 'mod-wh-d-laser', rarity: 'exotic', basePrice: 9_312_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵寝棱镜炮（料÷0.45×4）
    { key: 'mod-wh-d-loader', kind: 'module', refId: 'mod-wh-d-loader', rarity: 'exotic', basePrice: 5_506_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 守墓者速装填机（料÷0.45×4）
    { key: 'mod-wh-d-steady', kind: 'module', refId: 'mod-wh-d-steady', rarity: 'exotic', basePrice: 5_141_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵墓弹道铭文（料÷0.45×4）
    { key: 'mod-wh-e-dc', kind: 'module', refId: 'mod-wh-e-dc', rarity: 'exotic', basePrice: 7_442_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构损管阵列（料÷0.45×4）
    { key: 'mod-wh-e-tac', kind: 'module', refId: 'mod-wh-e-tac', rarity: 'exotic', basePrice: 6_009_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构导控塔（料÷0.45×4）
    { key: 'mod-wh-e-cpu', kind: 'module', refId: 'mod-wh-e-cpu', rarity: 'exotic', basePrice: 6_377_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构协处理器（料÷0.45×4）
    { key: 'mod-wh-e-pd', kind: 'module', refId: 'mod-wh-e-pd', rarity: 'exotic', basePrice: 6_153_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构近防阵列（料÷0.45×4）
    { key: 'mod-wh-e-shield', kind: 'module', refId: 'mod-wh-e-shield', rarity: 'exotic', basePrice: 7_406_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构护盾矩阵（料÷0.45×4）
    { key: 'mod-wh-g-hangar', kind: 'module', refId: 'mod-wh-g-hangar', rarity: 'exotic', basePrice: 6_360_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军蜂巢坞（料÷0.45×4）
    { key: 'mod-wh-g-fcs', kind: 'module', refId: 'mod-wh-g-fcs', rarity: 'exotic', basePrice: 4_978_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军火控（料÷0.45×4）
    { key: 'mod-wh-g-ballistic', kind: 'module', refId: 'mod-wh-g-ballistic', rarity: 'exotic', basePrice: 4_642_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幽灵弹道校正器（料÷0.45×4）
    { key: 'mod-wh-g-hull', kind: 'module', refId: 'mod-wh-g-hull', rarity: 'exotic', basePrice: 6_718_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 鱿蜂结构层（料÷0.45×4）
    { key: 'mod-wh-g-turret', kind: 'module', refId: 'mod-wh-g-turret', rarity: 'exotic', basePrice: 6_306_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军残炮（料÷0.45×4）
    { key: 'mod-wh-g-prop', kind: 'module', refId: 'mod-wh-g-prop', rarity: 'exotic', basePrice: 4_709_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幽灵推进器（料÷0.45×4）
  // ── 虫洞舰船 15 艘（`sh-wh-*`：定制船，`priceIsk` 仍为 0 = 定制口径，契约「舰船价格口径」守）──
    { key: 'sh-wh-a-frigate', kind: 'ship', refId: 'sh-wh-a-frigate', rarity: 'exotic', basePrice: 2_306_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭电子舰（料÷0.45×4）
    { key: 'sh-wh-a-destroyer', kind: 'ship', refId: 'sh-wh-a-destroyer', rarity: 'exotic', basePrice: 5_109_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭炮舰（料÷0.45×4）
    { key: 'sh-wh-a-cruiser', kind: 'ship', refId: 'sh-wh-a-cruiser', rarity: 'exotic', basePrice: 9_884_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭重型突击巡洋舰（料÷0.45×4）
    { key: 'sh-wh-c-frigate', kind: 'ship', refId: 'sh-wh-c-frigate', rarity: 'exotic', basePrice: 2_613_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幼虫截击舰（料÷0.45×4）
    { key: 'sh-wh-c-destroyer', kind: 'ship', refId: 'sh-wh-c-destroyer', rarity: 'exotic', basePrice: 5_644_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 甲壳截击舰（料÷0.45×4）
    { key: 'sh-wh-c-cruiser', kind: 'ship', refId: 'sh-wh-c-cruiser', rarity: 'exotic', basePrice: 11_360_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巢群重型突击巡洋舰（料÷0.45×4）
    { key: 'sh-wh-d-frigate', kind: 'ship', refId: 'sh-wh-d-frigate', rarity: 'exotic', basePrice: 3_073_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 哨戒电子舰（料÷0.45×4）
    { key: 'sh-wh-d-destroyer', kind: 'ship', refId: 'sh-wh-d-destroyer', rarity: 'exotic', basePrice: 7_443_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵卫指挥舰（料÷0.45×4）
    { key: 'sh-wh-d-cruiser', kind: 'ship', refId: 'sh-wh-d-cruiser', rarity: 'exotic', basePrice: 15_360_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵寝巡洋舰（料÷0.45×4）
    { key: 'sh-wh-e-frigate', kind: 'ship', refId: 'sh-wh-e-frigate', rarity: 'exotic', basePrice: 2_874_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 构件鱼雷舰（料÷0.45×4）
    { key: 'sh-wh-e-destroyer', kind: 'ship', refId: 'sh-wh-e-destroyer', rarity: 'exotic', basePrice: 6_213_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 机库无人机作战舰（料÷0.45×4）
    { key: 'sh-wh-e-carrier', kind: 'ship', refId: 'sh-wh-e-carrier', rarity: 'exotic', basePrice: 14_345_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构无人机作战舰（料÷0.45×4）
    { key: 'sh-wh-g-frigate', kind: 'ship', refId: 'sh-wh-g-frigate', rarity: 'exotic', basePrice: 3_030_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 幽影侦察舰（料÷0.45×4）
    { key: 'sh-wh-g-destroyer', kind: 'ship', refId: 'sh-wh-g-destroyer', rarity: 'exotic', basePrice: 6_670_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军后勤舰（料÷0.45×4）
    { key: 'sh-wh-g-cruiser', kind: 'ship', refId: 'sh-wh-g-cruiser', rarity: 'exotic', basePrice: 13_386_500, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 亡军鱼雷舰（料÷0.45×4）
  // ── 窝点专属装备 14 件（`mod-lair-*`：无蓝图、无料单 ⇒ 同槽位最高档 ×4）──
    { key: 'mod-lair-turret-a', kind: 'module', refId: 'mod-lair-turret-a', rarity: 'exotic', basePrice: 7_664_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 劫掠者转管炮（同槽位最高档 1,916,000×4）
    { key: 'mod-lair-missile-a', kind: 'module', refId: 'mod-lair-missile-a', rarity: 'exotic', basePrice: 8_968_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 掠袭导弹巢（同槽位最高档 2,242,000×4）
    { key: 'mod-lair-cargo-a', kind: 'module', refId: 'mod-lair-cargo-a', rarity: 'exotic', basePrice: 9_600_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 赃物强化舱（同槽位最高档 2,400,000×4）
    { key: 'mod-lair-armor-c', kind: 'module', refId: 'mod-lair-armor-c', rarity: 'exotic', basePrice: 7_760_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 生体甲壳板（同槽位最高档 1,940,000×4）
    { key: 'mod-lair-dc-c', kind: 'module', refId: 'mod-lair-dc-c', rarity: 'exotic', basePrice: 9_440_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 生体损管腔（同槽位最高档 2,360,000×4）
    { key: 'mod-lair-laser-c', kind: 'module', refId: 'mod-lair-laser-c', rarity: 'exotic', basePrice: 12_000_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 酸液喷吐器（同槽位最高档 3,000,000×4）
    { key: 'mod-lair-shield-d', kind: 'module', refId: 'mod-lair-shield-d', rarity: 'exotic', basePrice: 9_160_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵墓护盾阵列（同槽位最高档 2,290,000×4）
    { key: 'mod-lair-turret-d', kind: 'module', refId: 'mod-lair-turret-d', rarity: 'exotic', basePrice: 7_664_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 守墓者长炮（同槽位最高档 1,916,000×4）
    { key: 'mod-lair-armor-d', kind: 'module', refId: 'mod-lair-armor-d', rarity: 'exotic', basePrice: 7_760_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 陵寝装甲层（同槽位最高档 1,940,000×4）
    { key: 'mod-lair-turret-e', kind: 'module', refId: 'mod-lair-turret-e', rarity: 'exotic', basePrice: 7_664_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构残骸炮（同槽位最高档 1,916,000×4）
    { key: 'mod-lair-hangar-e', kind: 'module', refId: 'mod-lair-hangar-e', rarity: 'exotic', basePrice: 7_840_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 深层机库（同槽位最高档 1,960,000×4）
    { key: 'mod-lair-frame-e', kind: 'module', refId: 'mod-lair-frame-e', rarity: 'exotic', basePrice: 7_760_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巨构骨架（同槽位最高档 1,940,000×4）
    { key: 'mod-lair-drone-tac-g', kind: 'module', refId: 'mod-lair-drone-tac-g', rarity: 'exotic', basePrice: 8_160_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 鱿蜂群导控（同槽位最高档 2,040,000×4）
    { key: 'mod-lair-drone-relay-g', kind: 'module', refId: 'mod-lair-drone-relay-g', rarity: 'exotic', basePrice: 8_120_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 流亡中继桅（同槽位最高档 2,030,000×4）
  // ── 专属无人机 3 型（自带货值 ×4；无人机线**无制式图纸**，这三型各有一张一次性图纸，见 blueprints.ts）──
    { key: 'drone-exile-bee', kind: 'item', refId: 'drone-exile-bee', rarity: 'exotic', basePrice: 24_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 鱿蜂无人机（自带货值 6000×4）
    { key: 'drone-wh-c-heavy', kind: 'item', refId: 'drone-wh-c-heavy', rarity: 'exotic', basePrice: 48_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巢卫攻坚无人机（自带货值 12000×4）
    { key: 'drone-wh-e-sentry', kind: 'item', refId: 'drone-wh-e-sentry', rarity: 'exotic', basePrice: 88_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 构件哨戒无人机（自带货值 22000×4）
  // ── 3 张新增的一次性无人机蓝图（每次开工出 50 架）──
  { key: 'bp-lair-g-drone', kind: 'blueprint', refId: 'bp-lair-g-drone', rarity: 'exotic', basePrice: 1_200_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 鱿蜂无人机图纸（一次性）（料÷0.45×4）
  { key: 'bp-wh-c-drone', kind: 'blueprint', refId: 'bp-wh-c-drone', rarity: 'exotic', basePrice: 2_400_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 巢卫无人机图纸（一次性）（料÷0.45×4）
  { key: 'bp-wh-e-drone', kind: 'blueprint', refId: 'bp-wh-e-drone', rarity: 'exotic', basePrice: 4_400_000, demandMultiplier: 1.0, playerBuyable: false }, // 只收不卖 · 构件无人机图纸（一次性）（料÷0.45×4）
  // ── 微型跃迁引擎 MK3（2026-09-14 船长定 · 奇货档：顶配那条「十秒 +250%」）——
  // 价 = 同族之上的溢价（矢量推进器 MK3 1,970,000 ×1.32 ≈ 2,600,000）；书价按奇货档 ×4 = 10,400,000。
  { key: 'mod-mwd-3', kind: 'module', refId: 'mod-mwd-3', rarity: 'exotic', basePrice: 2_600_000, demandMultiplier: 0.75 },
  { key: 'bp-mwd-3', kind: 'blueprint', refId: 'bp-mwd-3', rarity: 'exotic', basePrice: 10_400_000, demandMultiplier: 0.75 },
]

/** 构建市场商品目录（数字稀有度按物品表 RARITY_TIER 填充——2026-09-09 船长拍板：
 * 稀有度入物品本体，市场调用；与渠道 rarity 分离，只驱动稀有订单渠道刷新权重）
 *
 * ⚠ **未上线商品在这里被挡掉**（2026-09-12 船长：「所有虫洞相关的内容需要等虫洞落地后才统一对玩家可见」）：
 * `unreleased: true` 的卡**不进本目录** ⇒ `ctx.marketGoods` 里没有它 ⇒ 市场页/挂单/订单/任务/事件
 * 一律看不到也交易不到；而它在 `MARKET_GOODS`（目录表）里，**契约照核**（`content:check` 用该表）。
 * 上线时把卡上的 `unreleased` 删掉即可。 */
export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.filter((g) => g.unreleased !== true).map((g) => [g.key, { ...g, rarityTier: rarityTierOf(g.refId) }]))
}
