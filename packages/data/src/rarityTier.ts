/**
 * **物品稀有度表**（数字档 1~5；2026-09-09 船长拍板「稀有度入物品本体」，2026-09-20 定名与合并）。
 *
 * **本表是"物品自身稀有度"的唯一来源**（2026-09-20 船长：「市场稀有采取物品本身稀有度」＋
 * 「两个稀有度表没有区别就合并，并删除多余的表」）⇒ 原先的 `OFF_MARKET_RARITY_TIER` 已并入本表，
 * 市场外物品（残骸 / 碎片）与本表同列、同档、同语义。
 *
 * ⚠ **渠道归属不受本表管**（2026-09-20 船长：「渠道归属不动」）：一件货进哪个盘口（常驻 / 稀有 / 奇货）
 * 仍由 `marketCatalog.ts` 的 `rarity`（common/rare/exotic 字符串）决定，本表**不参与**该判定。
 * 数字档只驱动**稀有订单渠道的刷新权重**（`market.ts` 的 `rareTierWeight`，⟪**2026-09-25 船长令**⟫
 * 现行四档阶梯 = **档 2 ×1 · 档 3 ×0.5 · 档 4 ×0.2 · 档 5 ×0.05**；沿革：2026-09-09 立表只给档 3
 * 系数 0.25 → 2026-09-10 定 0.15 → 2026-09-16 补档 4 = 0.05 → 本次四档一次补齐，**档 5 首次有系数**
 * ——此前档 5 走 `else` 拿 ×1、与大众档同频）；**常驻与奇货渠道的出率与档位无关**（船长定）。
 *
 * 档位语义（**隐藏，不进玩家文案**）：1 = 常驻层；2/3/4 = 可走稀有订单层（2 大众 / 3 高阶）；
 * 3/4/5 = 可走奇货层（5 当前无物品使用，为将来更高档预留）。
 * ⚠ **2026-09-16 船长改判**：「**修正契约，rate现在允许2~4，exotic拓展到3~5**」⇒ 渠道允许带放宽为**区间**；
 * ⚠ **2026-09-20 船长再改**：「**「common 渠道档必须=1」的契约废除，改为『common 渠道稀有度不影响交易』**」
 * ⇒ 常驻渠道**不再约束档位**（实证：`rareTierWeight` 只在 rare/exotic 分支被调用）。
 *
 * 初值 = v1 机械规则（common→1；rare ≤50 万→2、>50 万→3；exotic→4），此后**逐条人审**（豁免直接改本表）；
 * 契约见 `content:check`（键必须真实存在 · 值 ∈ 1~5）。
 *
 * **2026-09-10 船长定（装备价对齐同级武器价 的同批收口）**：MK2/MK3 装备价上调后，
 * 12 件 MK3 装备（护盾增强器三系 / 护盾扩展器 / 装甲镀层三系 / 装甲增厚板 / 矢量推进器 /
 * 无人机甲板扩展 / 中继天线 / 导控阵列）**由 2 升 3**——它们与其余 MK3 装备同级同价量级，
 * 却因初值规则（当时只要 17~42 万）留在"大众档"，会以约 1 小时/件的频率供货（高阶档是 8 小时级）。
 * 升档后**档位与价格解耦**：日后调价不再自动触发改档，档位是人审结果。
 */
export const RARITY_TIER: Readonly<Record<string, number>> = {
  // 2026-09-15 虫洞战利品与经济扩充（船长确认）：谜质精华 · 奢侈品 · 贵重品/军用备货柜
  'mat-wh-essence': 4, // exotic（只收不卖的专属口径 ⇒ 奇货档；与 exclusive-market 用例的口径一致）
  // ⚠ 渠道一致性：common ⇒ 必须 1（`content:check` 硬契约）。奢侈品与两个新货柜都按"常驻 ⇒ 才卖得掉"
  //   的口径走 common ⇒ 档位一律 1；**价格差由 basePrice 承担**（2026-09-16 扩到十款：6~320 万，见 items.ts），
  //   不靠稀有度分层。
  'lux-1': 1, // common · 10 万（星港陈酿）
  'lux-2': 1, // common · 40 万（贵族香料）
  'lux-3': 1, // common · 200 万（失落艺术品）
  // 2026-09-16 船长：「让奢侈品有10个类型，分布在目前的3个奢侈品价格附近」⇒ 补七款（同档 = 常驻层）
  'lux-4': 1, // common · 6 万（陈年雪茄）
  'lux-5': 1, // common · 14 万（异域织物）
  'lux-6': 1, // common · 25 万（香木雕刻）
  'lux-7': 1, // common · 60 万（宫廷乐谱）
  'lux-8': 1, // common · 80 万（古法香膏）
  'lux-9': 1, // common · 120 万（星图真迹）
  'lux-10': 1, // common · 320 万（王冠遗钻）
  'box-valuables': 1, // common · 382.8 万（只收不卖；2026-09-16 随十款均价重算 = 内容期望 1,531.25 万 ×0.25）
  'box-military': 1, // common · 280 万（只收不卖；2026-09-15 批 B 复核：= MK3 拆解期望 470.95 万 ×0.6）
  'alpha': 4,
  // 2026-09-20 船长：「**弹药 MK2 移动到稀有订单**」⇒ 三系 MK2 的档随渠道由 R1 提到 **R2**
  //   （与 `rare` 渠道的允许带 2~4 相符；MK1 三系仍 common/R1 不动）
  'ammo-explosive-2': 2,
  'ammo-explosive-l': 1,
  'ammo-kinetic-2': 2,
  'ammo-kinetic-l': 1,
  'ammo-plasma-2': 2,
  'ammo-plasma-l': 1,
  'basic': 1,
  'beta': 4,
  'bp-ammo-explosive': 1,
  'bp-ammo-explosive-2': 4,
  'bp-ammo-kinetic': 1,
  'bp-ammo-kinetic-2': 4,
  'bp-ammo-plasma': 1,
  'bp-ammo-plasma-2': 4,
  'bp-armor-exp-1': 1,
  'bp-armor-exp-2': 2,
  'bp-armor-exp-3': 3,
  'bp-armor-kin-1': 1,
  'bp-armor-kin-2': 2,
  'bp-armor-kin-3': 3,
  'bp-armor-pla-1': 1,
  'bp-armor-pla-2': 2,
  'bp-armor-pla-3': 3,
  'bp-armor-plate-1': 1,
  'bp-armor-plate-2': 2,
  'bp-armor-plate-3': 3,
  'bp-cargo-1': 1,
  'bp-cargo-2': 2,
  'bp-cargo-3': 3,
  'bp-cargo-civ': 1,
  // 2026-09-11 协处理器（船长定：MK1 稀有 2 档、MK2 稀有 3 档；**MK3 无蓝图**故无 bp-cpu-3）
  'bp-cpu-1': 2,
  'bp-cpu-2': 3,
  'bp-drone-rack-1': 1,
  'bp-drone-rack-2': 2,
  'bp-drone-rack-3': 3,
  'bp-drone-relay-1': 1,
  'bp-drone-relay-2': 2,
  'bp-drone-relay-3': 3,
  'bp-drone-tac-1': 1,
  'bp-drone-tac-2': 2,
  'bp-drone-tac-3': 3,
  'bp-gyro-1': 1,
  'bp-gyro-2': 2,
  'bp-gyro-3': 3,
  'bp-hullrep-1': 1,
  'bp-hullrep-2': 3,
  'bp-hullrep-civ': 1,
  'bp-laser-1': 1,
  'bp-laser-2': 3,
  'bp-laser-3': 3,
  'bp-lock-1': 1,
  'bp-lock-2': 2,
  'bp-lock-3': 3,
  // 2026-09-15 隐秘行动装置蓝图（与产物同渠道同档：MK2 = 稀有档 3 · MK3 = 奇货档 4）
  'bp-stealth-2': 3,
  'bp-stealth-3': 4,
  'bp-miner-1': 1,
  'bp-miner-2': 2,
  'bp-miner-3': 3,
  'bp-miner-civ': 1,
  'bp-missile-1': 1,
  'bp-missile-2': 3,
  'bp-missile-3': 3,
  // 微型跃迁引擎（2026-09-14 船长定）：MK1 大众稀有档 2 / MK2 高阶稀有档 3 / MK3 奇货 4
  'bp-mwd-1': 2,
  'bp-mwd-2': 3,
  'bp-mwd-3': 4,
  // 零件（2026-09-20 零件体系）：全部常驻档 1（船长「所有零件及其蓝图都在常驻市场有出售」）
  'part-circuit': 1,
  'part-armor-plate': 1,
  'part-frame': 1,
  'part-cable': 1,
  'part-coolant': 1,
  'part-gyro': 1,
  'part-lens': 1,
  'part-drone-neural': 1,
  'part-shield-gen': 1,
  'part-jet-array': 1,
  'part-qchip': 1,
  'part-keel': 1,
  'part-fire-control': 1,
  'part-grav-comp': 1,
  'bp-part-drone-neural': 1,
  'bp-part-shield-gen': 1,
  'bp-part-jet-array': 1,
  'bp-part-qchip': 1,
  'bp-part-keel': 1,
  'bp-part-fire-control': 1,
  'bp-part-grav-comp': 1,
  'bp-prop-1': 1,
  'bp-prop-2': 2,
  'bp-prop-3': 3,
  'bp-repairkit-civ': 1,
  'bp-repairkit-mil': 1,
  'bp-repairkit-dc': 1, // 损管修理组件图纸（2026-09-25）：与另两种修理组件图纸同档
  'bp-rof-1': 1,
  'bp-rof-2': 2,
  'bp-rof-3': 3,
  'bp-salvager-1': 1,
  'bp-salvager-2': 2,
  'bp-salvager-3': 3,
  'bp-shield-exp-1': 1,
  'bp-shield-exp-2': 2,
  'bp-shield-exp-3': 3,
  'bp-shield-ext-1': 1,
  'bp-shield-ext-2': 2,
  'bp-shield-ext-3': 3,
  'bp-shieldchg-1': 1,
  'bp-shieldchg-2': 1, // 书比件好买（现货稀有、书常驻）——照船体维修装置 MK1
  'bp-shieldchg-3': 3,
  'bp-shield-kin-1': 1,
  'bp-shield-kin-2': 2,
  'bp-shield-kin-3': 3,
  'bp-shield-pla-1': 1,
  'bp-shield-pla-2': 2,
  'bp-shield-pla-3': 3,
  'bp-stab-exp-1': 1,
  'bp-stab-exp-2': 3,
  'bp-stab-exp-3': 3,
  'bp-stab-kin-1': 1,
  'bp-stab-kin-2': 3,
  'bp-stab-kin-3': 3,
  'bp-stab-pla-1': 1,
  'bp-stab-pla-2': 3,
  'bp-stab-pla-3': 3,
  'bp-track-1': 1,
  'bp-track-2': 2,
  'bp-track-3': 3,
  'bp-turret-1': 1,
  'bp-turret-2': 3,
  'bp-turret-3': 3,
  'bp-turret-civ': 1,
  'bp-warpcomp-2': 3,
  'bp-warpcomp-3': 3,
  'burrower': 1,
  'drone-assault': 1,
  'drone-heavy': 1,
  'drone-scout': 1,
  'drone-sentry': 1,
  'gamma': 4,
  'gas-aurora': 1,
  'gas-ionstorm': 1,
  'gas-neon': 1,
  'gas-phosphor': 1,
  'ice-darkstar': 1,
  'ice-frost': 1,
  'ice-marrow': 1,
  'min-darkiron': 1,
  'min-isotope': 1,
  'min-mexallon': 1,
  'min-nocxium': 1,
  'min-pyerite': 1,
  'min-starcore': 1,
  'min-tritanium': 1,
  'min-voidcrystal': 1,
  'mod-armor-exp-1': 1,
  'mod-armor-exp-2': 2,
  'mod-armor-exp-3': 3,
  'mod-armor-kin-1': 1,
  'mod-armor-kin-2': 2,
  'mod-armor-kin-3': 3,
  /* 损伤管制装置线（2026-09-25 船长令）：人审档位 = 按"同为低槽稀有件"的价格梯对齐
     （装甲镀层 / 货舱扩展：MK1 1～2 → MK2 2～3 → MK3 3）；本线整体更贵 ⇒ 取 2 / 3 / 4，蓝图跟产物同梯。 */
  'mod-dc-1': 2,
  'mod-dc-2': 3,
  'mod-dc-3': 4,
  'bp-dc-1': 2,
  'bp-dc-2': 3,
  'bp-dc-3': 4,
  // 制式无人机永久图纸（2026-09-26 船长令「放入稀有订单档」）：四型统一**数字档 2（大众）**
  // —— 与 MK2 装备蓝图同档（稀有订单层内权重 1），渠道稀有、价格大众。
  'bp-drone-scout': 2,
  'bp-drone-assault': 2,
  'bp-drone-heavy': 2,
  'bp-drone-sentry': 2,
  'mod-armor-pla-1': 1,
  'mod-armor-pla-2': 2,
  'mod-armor-pla-3': 3,
  'mod-armor-plate-1': 1,
  'mod-armor-plate-2': 2,
  'mod-armor-plate-3': 3,
  'mod-cargo-1': 1,
  'mod-cargo-2': 2,
  'mod-cargo-3': 3,
  'mod-cargo-civ': 1,
  'mod-cargo-proto': 4,
  // 2026-09-11 协处理器（船长定：MK1 = 2、MK2 = 3、**MK3 = 4 走奇货、无蓝图**）
  'mod-cpu-1': 2,
  'mod-cpu-2': 3,
  'mod-cpu-3': 4,
  'mod-drone-rack-1': 1,
  'mod-drone-rack-2': 2,
  'mod-drone-rack-3': 3,
  'mod-drone-relay-1': 1,
  'mod-drone-relay-2': 2,
  'mod-drone-relay-3': 3,
  'mod-drone-tac-1': 1,
  'mod-drone-tac-2': 2,
  'mod-drone-tac-3': 3,
  'mod-gyro-1': 1,
  'mod-gyro-2': 2,
  'mod-gyro-3': 3,
  'mod-hullrep-1': 2,
  'mod-hullrep-2': 3,
  'mod-hullrep-civ': 1,
  'mod-laser-1': 1,
  'mod-laser-2': 2,
  'mod-laser-3': 3,
  'mod-laser-proto': 4,
  'mod-lock-1': 1,
  'mod-lock-2': 2,
  'mod-lock-3': 3,
  // 2026-09-15 隐秘行动装置（船长 2026-09-16 定数与渠道：**MK2 = 稀有订单档 3** · **MK3 = 奇货档 4**）
  'mod-stealth-2': 3,
  'mod-stealth-3': 4,
  'mod-miner-1': 1,
  'mod-miner-2': 2,
  'mod-miner-3': 3,
  'mod-miner-civ': 1,
  'mod-miner-proto': 4,
  'mod-missile-1': 1,
  'mod-missile-2': 2,
  'mod-missile-3': 3,
  // 微型跃迁引擎（2026-09-14 船长定 · 同上一组蓝图）：档位与价格解耦，这里是**人审**结果
  'mod-mwd-1': 2,
  'mod-mwd-2': 3,
  'mod-mwd-3': 4,
  'mod-prop-1': 1,
  'mod-prop-2': 2,
  'mod-prop-3': 3,
  'mod-rof-1': 1,
  'mod-rof-2': 2,
  'mod-rof-3': 3,
  'mod-salvager-1': 1,
  'mod-salvager-2': 2,
  'mod-salvager-3': 3,
  'mod-shield-exp-1': 1,
  'mod-shield-exp-2': 2,
  'mod-shield-exp-3': 3,
  'mod-shield-ext-1': 1,
  'mod-shield-ext-2': 2,
  'mod-shield-ext-3': 3,
  'mod-shieldchg-1': 1,
  'mod-shieldchg-2': 2,
  'mod-shieldchg-3': 3, // 照船体维修装置三档（民用/MK1/MK2）
  'mod-shield-kin-1': 1,
  'mod-shield-kin-2': 2,
  'mod-shield-kin-3': 3,
  'mod-shield-pla-1': 1,
  'mod-shield-pla-2': 2,
  'mod-shield-pla-3': 3,
  'mod-stab-exp-1': 1,
  'mod-stab-exp-2': 2,
  'mod-stab-exp-3': 3,
  'mod-stab-kin-1': 1,
  'mod-stab-kin-2': 2,
  'mod-stab-kin-3': 3,
  'mod-stab-pla-1': 1,
  'mod-stab-pla-2': 2,
  'mod-stab-pla-3': 3,
  'mod-track-1': 1,
  'mod-track-2': 2,
  'mod-warpcomp-2': 3,
  'mod-warpcomp-3': 3,
  'mod-track-3': 3,
  'mod-turret-civ': 1,
  'mod-pd-e': 2, // 巨构近防炮（2026-09-11 机群批 S4）：防空武器，定位与 MK2 同档
  'bp-pd-e': 2, // 其蓝图（市场卡与稀有度表必须成对）
  'mod-pd-e-2': 2,
  'bp-pd-e-2': 2,
  'mod-pd-e-3': 3, // MK3 顶档（与 exotic 渠道对应 3/4）
  'bp-pd-e-3': 3,
  'mod-turret-kin-1': 1,
  'mod-turret-kin-2': 2,
  'mod-turret-kin-3': 3,
  'ore-glowstone': 1,
  'ore-hemorphite': 1,
  'ore-nebulite': 1,
  'ore-scorched': 1,
  'ore-sunshard': 1,
  'ore-veldspar': 1,
  'ore-voidmother': 1, // 虚空母矿（2026-09-12 虫洞线新增原矿；数字档 = 1 常驻层，与其它原矿同档）
  // 遗迹安全货柜（F4 · 2026-09-13）：罕见的中间件（带回后拆解），数字档同常驻层（1）；✅ 2026-09-14 已上线
  'box-relic-a': 1,
  'box-relic-c': 1,
  'box-relic-d': 1,
  'box-relic-e': 1,
  // 图纸货柜（2026-09-14 船长：遗迹打捞新增）：同为中间件，数字档同常驻层（1）；✅ 2026-09-14 已上线
  'box-bp-shallow': 1,
  'box-bp-mid': 1,
  'box-bp-deep': 1,
  // AI 核心（2026-09-14 船长：遗迹打捞掉落）：洞内实物形态，数字档同常驻层（1）
  'ai-core-gamma': 1,
  'ai-core-beta': 1,
  'ai-core-alpha': 1,
  // 谜质储存器（F3c · 2026-09-13）：本趟虫洞内生效的装置，数字档同常驻层（1）
  'mat-chrono': 1,
  'mat-crane': 1,
  'mat-drill': 1,
  'mat-enricher': 1,
  'mat-expander': 1,
  'mat-nebula': 1,
  'mat-surveyor': 1,
  // 谜质储存器 B1 批（威胁 3 + 战斗 10）：同档
  'mat-ammo-dmg': 1,
  'mat-armor-res': 1,
  'mat-blindspot': 1,
  'mat-boss-analyzer': 1,
  'mat-extract-cover': 1,
  'mat-gyro': 1,
  'mat-hull-res': 1,
  'mat-jammer': 1,
  'mat-rangefinder': 1,
  'mat-reload': 1,
  'mat-shield-res': 1,
  'mat-suppressor': 1,
  'mat-tracker': 1,
  'mat-ammo-back': 1,
  'mat-drone-net': 1,
  'mat-field-repair': 1,
  'mat-volley': 1,
  'box-relic-g': 1,
  'ore-voidshard': 1,
  'pioneer': 3,
  'repairkit-civ': 1,
  'repairkit-mil': 1,
  'repairkit-dc': 1, // 损管修理组件（2026-09-25）：常驻渠道 ⇒ 与另两种修理组件同档
  'sbp-bowhead': 4,
  'sbp-bullshark': 4,
  'sbp-burrower': 2,
  'sbp-colossal': 4,
  'sbp-electricray': 4,
  'sbp-falconet': 2,
  'sbp-flyingfish': 2,
  'sbp-hammerhead': 4,
  'sbp-hawksbill': 4, // 2026-09-13：渠道升奇货（船长「玳瑁现货和蓝图上调至奇货」）
  'sbp-humpback': 4,
  'sbp-mako': 3,
  'sbp-megalodon': 4, // 2026-09-13 新增（巨齿鲨级舰船图纸 · 奇货渠道）
  // 2026-09-26 新增两艘官方战列舰（船长令）——同走奇货渠道（数字档 4），与 T4 邻舰一致
  'sbp-orca': 4, // 虎鲸级指挥舰图纸
  'sbp-helicoprion': 4, // 旋齿鲨级装甲战列舰图纸
  'sbp-once-orca': 4, // 虎鲸级一次性图纸（2026-09-26）
  'sbp-once-helicoprion': 4, // 旋齿鲨级一次性图纸（2026-09-26）
  'sh-orca': 4, // 虎鲸级指挥舰（只收不卖）
  'sh-helicoprion': 4, // 旋齿鲨级装甲战列舰（现货在售）
  'sbp-nautilus': 4, // 2026-09-13 新增（鹦鹉螺级舰船图纸 · 奇货渠道；与成品同行留 4，船长裁定）
  // 2026-09-13 新增：T3/T4/T5 的**一次性蓝图**（船长「给T3船也添加一次性蓝图」）——
  // 稀有订单层（数字 3）= T3 十张 + 剑鱼/蝠鲼；奇货（数字 4）= 玄武/巨齿鲨/皇带鱼
  'sbp-once-bowhead': 3,
  'sbp-once-bullshark': 3,
  'sbp-once-colossal': 4,
  'sbp-once-electricray': 3,
  'sbp-once-hammerhead': 3,
  'sbp-once-hawksbill': 3,
  'sbp-once-humpback': 3,
  'sbp-once-megalodon': 4,
  'sbp-once-nautilus': 3,
  'sbp-once-sailfish': 3,
  'sbp-once-sentinel': 3,
  'sbp-once-swordfish': 3,
  'sbp-once-thresher': 3,
  'sbp-once-whale-king': 3,
  'sbp-once-xuanwu': 4,
  'sbp-pioneer': 4,
  'sbp-sailfish': 3,
  'sbp-sentinel': 4,
  'sbp-shrike': 2,
  'sbp-swarm': 3,
  'sbp-swordfish': 4,
  'sbp-thresher': 4,
  'sbp-tigershark': 2,
  'sbp-tortoise': 3,
  'sbp-whale': 3,
  'sbp-whale-king': 4,
  'sbp-whiteshark': 4,
  'sbp-xuanwu': 4,
  'sh-bowhead': 4, // 2026-09-13：渠道升奇货（船长「蝠鲼现货…上调至奇货」）
  'sh-bullshark': 4,
  'sh-colossal': 4,
  'sh-electricray': 4,
  'sh-falconet': 2,
  'sh-flyingfish': 2,
  'sh-hammerhead': 4,
  'sh-hawksbill': 4, // 2026-09-13：渠道升奇货（船长「玳瑁现货…上调至奇货」）
  'sh-humpback': 3,
  'sh-mako': 2,
  'sh-megalodon': 4, // 2026-09-13 新增（巨齿鲨级战列舰 · 奇货渠道，只收不卖）
  'sh-nautilus': 4, // 2026-09-13 新增（鹦鹉螺级测绘巡洋舰 · 奇货渠道；✅ 2026-09-14 上线放开）
  'sh-sailfish': 2,
  'sh-sentinel': 4,
  'sh-shrike': 2,
  'sh-swarm': 3,
  'sh-swordfish': 4,
  'sh-thresher': 4,
  'sh-tigershark': 2,
  'sh-tortoise': 2,
  'sh-whiteshark': 4,
  'sh-xuanwu': 4,
  'whale': 3,
  'whale-king': 4,
  // 残骸（2026-09-19 合并后：**按「族 × 地区」登记**，与市场收购卡一一对应——
  // 洞内 5 组没有市场行 ⇒ 本表也不登记，契约要求键集与市场卡逐条对齐）
  'wreck-a-hi': 1,
  'wreck-a-lo': 1,
  'wreck-b-hi': 1,
  'wreck-c-lo': 1,
  'wreck-d-hi': 1,
  'wreck-d-lo': 1,
  'wreck-e-lo': 1,
  'wreck-g-lo': 1,
  // H 族（墨潮帮）· 入侵卡的洞外组（2026-09-25 船长令「修，②」）：与其余高安普通残骸同档（1）
  'wreck-h-hi': 1,
  // 2026-09-14 新增（船长「允许玩家挂卖」批）：专属内容补市场行 ⇒ 全部奇货层（数字 4）
  // —— 舰船图纸 15 · 装备图纸 28 · 虫洞装备 28 · 虫洞舰船 15 · 窝点专属装备 14 · 专属无人机 3
  // —— 外加 3 张无人机一次性蓝图（bp-lair-g-drone / bp-wh-c-drone / bp-wh-e-drone）
  'bp-lair-g-drone': 4,
  'bp-wh-a-coat': 4,
  'bp-wh-a-frag': 4,
  'bp-wh-a-hangar': 4,
  'bp-wh-a-prop': 4,
  'bp-wh-a-scan': 4,
  'bp-wh-a-shield': 4,
  'bp-wh-c-drone': 4,
  'bp-wh-c-frame': 4,
  'bp-wh-c-laser': 4,
  'bp-wh-c-missile': 4,
  'bp-wh-c-prism': 4,
  'bp-wh-c-pulse': 4,
  'bp-wh-d-laser': 4,
  'bp-wh-d-loader': 4,
  'bp-wh-d-lock': 4,
  'bp-wh-d-shield': 4,
  'bp-wh-d-steady': 4,
  'bp-wh-d-turret': 4,
  'bp-wh-e-cpu': 4,
  'bp-wh-e-dc': 4,
  'bp-wh-e-drone': 4,
  'bp-wh-e-pd': 4,
  'bp-wh-e-shield': 4,
  'bp-wh-e-tac': 4,
  'bp-wh-g-ballistic': 4,
  'bp-wh-g-fcs': 4,
  'bp-wh-g-hangar': 4,
  'bp-wh-g-hull': 4,
  'bp-wh-g-prop': 4,
  'bp-wh-g-turret': 4,
  'drone-exile-bee': 4,
  // 2026-09-26 H 族三件（墨潮电子舱 / 墨潮捕获网 / 墨潮重袭无人机）：与其余专属件同档 = 4
  'drone-ink-heavy': 4,
  /* 2026-09-26 舰船插件 12 件：**当前不上市场**（市场卡挂 `unreleased`），但 `ctx.modules` 里是全的
     ⇒ 稀有度查档这条契约要求"目录里的每一件都有档"，故先按**专属件同档 = 4** 登记；日后开市时一并复核。 */
  'plug-shield-plate': 4,
  'plug-armor-plate': 4,
  'plug-hull-plate': 4,
  'plug-mid-bay': 4,
  'plug-low-bay': 4,
  'plug-cpu-core': 4,
  'plug-firepower': 4,
  'plug-sight': 4,
  'plug-thruster': 4,
  'plug-rangefinder': 4,
  'plug-target-beacon': 4,
  'plug-concealment': 4,
  /* 2026-09-26 插件**蓝图** 12 张：与插件本体同档 = 4（`content:check` 的稀有度查档要求目录里每张蓝图都有档） */
  'bp-plug-shield-plate': 4,
  'bp-plug-armor-plate': 4,
  'bp-plug-hull-plate': 4,
  'bp-plug-mid-bay': 4,
  'bp-plug-low-bay': 4,
  'bp-plug-cpu-core': 4,
  'bp-plug-firepower': 4,
  'bp-plug-sight': 4,
  'bp-plug-thruster': 4,
  'bp-plug-rangefinder': 4,
  'bp-plug-target-beacon': 4,
  'bp-plug-concealment': 4,
  'mod-lair-ecm-h': 4,
  'mod-lair-web-h': 4,
  'drone-wh-c-heavy': 4,
  'drone-wh-e-sentry': 4,
  'mod-lair-armor-c': 4,
  'mod-lair-armor-d': 4,
  'mod-lair-cargo-a': 4,
  'mod-lair-dc-c': 4,
  'mod-lair-drone-relay-g': 4,
  'mod-lair-drone-tac-g': 4,
  'mod-lair-frame-e': 4,
  'mod-lair-hangar-e': 4,
  'mod-lair-laser-c': 4,
  'mod-lair-missile-a': 4,
  'mod-lair-shield-d': 4,
  'mod-lair-turret-a': 4,
  'mod-lair-turret-d': 4,
  'mod-lair-turret-e': 4,
  'mod-wh-a-coat': 4,
  'mod-wh-a-frag': 4,
  'mod-wh-a-hangar': 4,
  'mod-wh-a-prop': 4,
  'mod-wh-a-scan': 4,
  'mod-wh-a-shield': 4,
  'mod-wh-c-frame': 4,
  'mod-wh-c-laser': 4,
  'mod-wh-c-missile': 4,
  'mod-wh-c-prism': 4,
  'mod-wh-c-pulse': 4,
  'mod-wh-d-laser': 4,
  'mod-wh-d-loader': 4,
  'mod-wh-d-lock': 4,
  'mod-wh-d-shield': 4,
  'mod-wh-d-steady': 4,
  'mod-wh-d-turret': 4,
  'mod-wh-e-cpu': 4,
  'mod-wh-e-dc': 4,
  'mod-wh-e-pd': 4,
  'mod-wh-e-shield': 4,
  'mod-wh-e-tac': 4,
  'mod-wh-g-ballistic': 4,
  'mod-wh-g-fcs': 4,
  'mod-wh-g-hangar': 4,
  'mod-wh-g-hull': 4,
  'mod-wh-g-prop': 4,
  'mod-wh-g-turret': 4,
  'sbp-wh-a-cruiser': 4,
  'sbp-wh-a-destroyer': 4,
  'sbp-wh-a-frigate': 4,
  'sbp-wh-c-cruiser': 4,
  'sbp-wh-c-destroyer': 4,
  'sbp-wh-c-frigate': 4,
  'sbp-wh-d-cruiser': 4,
  'sbp-wh-d-destroyer': 4,
  'sbp-wh-d-frigate': 4,
  'sbp-wh-e-carrier': 4,
  'sbp-wh-e-destroyer': 4,
  'sbp-wh-e-frigate': 4,
  'sbp-wh-g-cruiser': 4,
  'sbp-wh-g-destroyer': 4,
  'sbp-wh-g-frigate': 4,
  'sh-wh-a-cruiser': 4,
  'sh-wh-a-destroyer': 4,
  'sh-wh-a-frigate': 4,
  'sh-wh-c-cruiser': 4,
  'sh-wh-c-destroyer': 4,
  'sh-wh-c-frigate': 4,
  'sh-wh-d-cruiser': 4,
  'sh-wh-d-destroyer': 4,
  'sh-wh-d-frigate': 4,
  'sh-wh-e-carrier': 4,
  'sh-wh-e-destroyer': 4,
  'sh-wh-e-frigate': 4,
  'sh-wh-g-cruiser': 4,
  'sh-wh-g-destroyer': 4,
  'sh-wh-g-frigate': 4,

  /* ══════════ 市场外物品（2026-09-20 船长：「两个稀有度表没有区别就合并，并删除多余的表」）══════════
   * 残骸与碎片**没有市场行、也不该有**，但**稀有度是物品自身的属性** ⇒ 与市场商品同一张表、同一套 1~5 档。
   * 档位按"获得难度 × 稀缺度"给（首次分配，可由船长随时改）：
   *  - **4**：高安稀有残骸（高危窝点 S1 级产出）
   *  - **3**：低安 / 虫洞稀有残骸 · MK3 蓝图碎片
   *  - **2**：虫洞普通残骸 · MK2 蓝图碎片
   *  - **1**：高安 / 低安普通残骸
   * ⚠ 本段**不参与市场渠道运算**（它们不进任何盘口）——档位只用于界面展示与其它读取物品档的地方。 */
  'wreck-rare-a-hi': 4,
  'wreck-rare-b-hi': 4,
  'wreck-rare-d-hi': 4,
  // H 族（墨潮帮）· 入侵卡的洞外组（2026-09-25 船长令「修，②」）：与其余**高安**稀有残骸同档（4）
  'wreck-rare-h-hi': 4,
  // 墨潮旗舰黑匣（周末入侵击毁旗舰的彩头；2026-09-25「先做壳」）——与专属内容同档（奇货层 4）
  'blackbox-h': 4,
  'wreck-rare-a-lo': 3,
  'wreck-rare-c-lo': 3,
  'wreck-rare-d-lo': 3,
  'wreck-rare-e-lo': 3,
  'wreck-rare-g-lo': 3,
  'wreck-rare-a-wh': 3,
  'wreck-rare-c-wh': 3,
  'wreck-rare-d-wh': 3,
  'wreck-rare-e-wh': 3,
  'wreck-rare-g-wh': 3,
  'wreck-a-wh': 2,
  'wreck-c-wh': 2,
  'wreck-d-wh': 2,
  'wreck-e-wh': 2,
  'wreck-g-wh': 2,
  // H 族（墨潮帮）第 14 组：并入洞外高安档（普通 = 1 见上段 · 稀有 = 4 见本段）
  'frag-mod-miner-2': 2,
  'frag-mod-cargo-2': 2,
  'frag-mod-turret-kin-2': 2,
  'frag-mod-miner-3': 3,
  'frag-mod-cargo-3': 3,
  'frag-mod-turret-kin-3': 3,
  /* ── 护盾充能力场装置（2026-09-20 船长：「MK2 和 MK3 的稀有度分别是 4 和 5」＋
     「（一次性蓝图）和装备一致稀有度」）⇒ 成品与书**各按 4 / 5**，共四条 ──
     ⚠ 书放**稀有渠道**且档 5 ⇒ 令 rare 渠道出现档 5，与旧"rare 带 2~4"冲突
     ⇒ `content:check` 的该带按船长裁定放宽为 **2~5**（见 changelog 同日那条）。 */
  'mod-shieldfield-2': 4,
  'mod-shieldfield-3': 5,
  'bp-shieldfield-2': 4,
  'bp-shieldfield-3': 5,
}

/**
 * **物品稀有度查询**（单点）：键 = 市场行 refId（市场商品）或物品 id（市场外物品，二者同形）。
 *
 * 表缺省 = 1。⚠ **表里现在同时装两类键**（2026-09-20 合并后）：
 * ① 市场商品的 refId（契约核对：每个市场卡都必须有项）；
 * ② **市场外物品的物品 id**（残骸 / 碎片——它们没有市场行，但稀有度是物品自身的属性）。
 */
export function rarityTierOf(refId: string): number {
  return RARITY_TIER[refId] ?? 1
}

/**
 * **物品 id → 数字稀有度**（图标模式的小标签用；2026-09-20）。
 *
 * 与 `rarityTierOf` 的差别只有一处**键形态适配**：表里**多数键与物品 id 同形**
 * （装备 `mod-*`、蓝图 `bp-*`/`sbp-*`、物品、AI 核心、36 艘舰船、残骸、碎片都是），
 * 但**有一处历史遗留**——**鲸王**在表里是无前缀的 `whale-king`（物品 id `sh-whale-king`、
 * 市场行 refId `ship-whale-king`，三个名字各不相同）⇒ 去掉 `sh-` 再试一把才解得开。
 *
 * ⚠ **别把"市场 refId"当"物品 id"用**（2026-09-20 我在这里踩过一次）：市场里另有一批**可交易**的
 * 同类行（如 AI 核心 `core-gamma` 的 refId 是 `gamma` 档 4），它与**洞内实物形态**的物品
 * `ai-core-gamma`（表里档 1）**是两回事**。所以本函数**只做物品 id 的键形态适配**，
 * 绝不把市场短名（`gamma`）套到物品 id 上——那会把洞内核心错标成 R4。
 *
 * ⚠ 返回 `undefined` = **查不到**（表里没有这条键）⇒ 界面**不显示标签**，而不是硬塞一个 R1。
 */
export function itemRarityTierOf(itemId: string): number | undefined {
  const direct = RARITY_TIER[itemId]
  if (direct !== undefined) return direct
  // 唯一需要的键形态适配：舰船里的历史遗留（鲸王：表键 `whale-king`，物品 id `sh-whale-king`）
  const ship = /^sh-(.+)$/.exec(itemId)
  if (ship) return RARITY_TIER[ship[1]!]
  return undefined
}
