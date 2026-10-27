/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf, FOE_MOUNT_IDS } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'

/**
 * R 族 · T1「**粼光级**」—— 光环最小的一档，快而碎。
 *
 * 血 260 × 0.85 = **221**（低于同档标准护卫，走"脆但多"）· 单发 39.5 × 1.00 = **40** ·
 * 实速 340 × 1.1 = **374 m/s** · 射程 1~9,000（能量线中距；2026-10-01 船长令非中枢 +3,000）· **不带机巢**。
 */
export const FOE_R_CORONA_GLINT: FoeShipDef = {
  id: 'foe-r-corona-glint',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "gunCount"),
  name: '粼光级',
  family: 'R',
  /**
   * 🔴 **2026-10-03 船长令（三件）**：「**顺便我希望将粼光级和回响级的回避率互换。
   * 将粼光级的闪现后恢复护盾的挂载件移交给回响级。提高粼光级的机动速度到1.6**」
   * - **回避率与回响级互换** ⇒ 0.30 → **0.50**（回响级当时取 0.30）；
   * - **闪烁过载装置（闪现后回盾）移交回响级** ⇒ 本舰 `mounts` 只留闪现跃迁仪；
   * - **机动 1.1 → 1.6** ⇒ 340 × 1.6 = **544 m/s**（原 374）。
   *
   * 🔴 **2026-10-02 船长令（本批两条，同日）**：
   * - 「**将入侵的回响级，闪避率改为 0.**」⇒ 回响级归零；
   * - 「**粼光级闪避率下调到41%**」⇒ 本舰 **0.50 → 0.41**（**本舰现为族内闪避最高**，其余四档见各自定义）。
   */
  evasion: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "speedRatio"), // 🔴 **船长 2026-10-03 令「放宽 R 族速带到1.45，粼光级速度就按1.45倍率」**——
  // 「1.45」指的是 `content:check` 报的那个**比率**（实速 ÷ 基准），不是本字段本身：
  // 实测 `speedRatio 1.45` ⇒ 实速 493 ⇒ 比率 **1.68×**（仍越带）；本字段 ×1.16 ≈ 比率
  // ⇒ 取 **1.25** ⇒ 实速 340 × 1.25 = **425 m/s**、比率 ≈ **1.45**（正好压在放宽后的上沿）。原 1.1 = 374 m/s。
  hp: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "hp"), // **船长 2026-10-01 令「拥有一个 0.9 倍血量的修正（这个修正不计入预算内）」**：原 221 × 0.9（⚠ 该折减**不进威胁预算** —— 预算只由卡面 threat 决定，见 roster 表的「总血」列）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "split_h") }, // **护盾特化**（船长的族格第一条）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "shotDmg"), // T1 档基线 39.5 × 角色 1.00
  hitRate: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意；与 D 族同款写法）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "rangeMaxM"), // 激光·风筝线：上限拉长才有「风筝」可言（2026-10-01 船长令「非常擅长风筝战术」）＋ **同日令「给非中枢的R族船添加3000的基础射程」**（6000 → 9000）
  falloff: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "falloff"), // 与 D 族同款（船长 2026-09-19「将D族单独调整，远端改为 0.2」）；风筝流要保住远端威力
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-r-corona-glint", "dmgMix_kinetic") }, // 能量线为主（族格第二条）
  energyForm: 'beam', // 激光（能量·必中）—— 船长 2026-10-01「使用以激光为主的武器」；全仓另一族是 D 守墓古舰
  // **闪现跃迁仪**（**船长 2026-10-01 令**：「激光武器+闪现效果的挂载件」，选「乙：五档全带」）：
  // 本体被命中时拉开交战距离 2,000 m、冷却 **12 秒**（参数选「甲」；冷却经 2026-10-01「下调到5秒」后，**2026-10-03 船长令「将敌人的闪现冷却时间延长到12秒」⇒ 现行 12 秒**）—— 与「风筝」配套：被近身就闪开、重建射程优势。
  // ⚠ **闪烁过载装置（闪现后回盾）已按 2026-10-03 船长令移交「回响级」**（本舰不再挂）。
  mounts: [FOE_MOUNT_IDS.coronaBlink],
  tactic: 'kite', // 船长令「非常擅长风筝战术」⇒ 全档 kite（改前 T1~T3 是 orbit）

}

/**
 * R 族 · T2「**回响级**」—— 驱逐档。
 *
 * 血 480 × 0.90 = **367** · 单发 68 × 1.05 = **71** · 实速 295 × 1.1 = **325 m/s** ·
 * 射程 1~10,000（2026-10-01 船长令非中枢 +3,000）· **不带机巢**。
 *
 * ⚠ **闪避 0**（**2026-10-02 船长令**：「**将入侵的回响级，闪避率改为 0.**」）⇒ 本条原写
 * 「全族闪避最高」，该说法随本令作废（族内闪避最高的现在是**粼光级 0.50**）。
 */
export const FOE_R_CORONA_ECHO: FoeShipDef = {
  id: 'foe-r-corona-echo',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "gunCount"),
  name: '回响级',
  family: 'R',
  /**
   * 🔴 **2026-10-02 船长令「将入侵的回响级，闪避率改为 0.」** ⇒ **0.30 → 0**（被打必中，不再掷回避）。
   * 沿革：2026-10-01「回响级闪避上调到0.5」→ 2026-10-03「粼光级与回响级回避率互换」⇒ 0.5 给粼光、本舰 0.30
   * → **本令归零**。
   */
  evasion: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "speedRatio"), // **船长 2026-10-01 令「敌人速度按照标准同级舰 1.1 的速度定」**：295 × 1.1 = 324.5 → **325** m/s
  hp: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "hp"), // **船长 2026-10-01 令「拥有一个 0.9 倍血量的修正（这个修正不计入预算内）」**：原 408 × 0.9（⚠ 该折减**不进威胁预算** —— 预算只由卡面 threat 决定，见 roster 表的「总血」列）
  /**
   * **三层血型 33/33/34**（**2026-10-02 船长令**：「**并且将回响级的血量调整为33/33/34**」）
   * ⇒ 原 0.65 / 0.20 / 0.15（与粼光级同为"护盾特化"档）改成**三层近乎均分**。
   *
   * ⚠ 本舰因此**脱离族级护盾特化口径**（族头注那条「护盾占比 0.55~0.65」现只覆盖粼光/叠光/垂暮/中枢
   * 四档）—— 与同日那条「**闪避率改为 0**」合起来看：本舰从"最难打中的护盾舰"变成
   * "**必中、但三层血均衡**"的承伤位（仍挂闪烁过载：每次闪跃回满护盾、结构上限 −5%）。
   */
  split: { s: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "shotDmg"), // T2 档基线 68 × 角色 1.05
  hitRate: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意；与 D 族同款写法）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "rangeMaxM"), // 激光·风筝线：上限拉长才有「风筝」可言（2026-10-01 船长令「非常擅长风筝战术」）＋ **同日令「给非中枢的R族船添加3000的基础射程」**（7000 → 10000）
  falloff: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "falloff"), // 与 D 族同款（船长 2026-09-19「将D族单独调整，远端改为 0.2」）；风筝流要保住远端威力
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-r-corona-echo", "dmgMix_kinetic") },
  energyForm: 'beam', // 激光（能量·必中）—— 船长 2026-10-01「使用以激光为主的武器」；全仓另一族是 D 守墓古舰
  // **闪现跃迁仪**（**船长 2026-10-01 令**：「激光武器+闪现效果的挂载件」，选「乙：五档全带」）：
  // 本体被命中时拉开交战距离 2,000 m、冷却 **12 秒**（参数选「甲」；冷却经 2026-10-01「下调到5秒」后，**2026-10-03 船长令「将敌人的闪现冷却时间延长到12秒」⇒ 现行 12 秒**）—— 与「风筝」配套：被近身就闪开、重建射程优势。
  // **闪烁过载装置**（**2026-10-03 船长令「将粼光级的闪现后恢复护盾的挂载件移交给回响级」**，自粼光级移来）：
  // 每次闪现后护盾回满、结构 −结构上限 5%，**不设保底 ⇒ 反复闪现会把结构扣到 0、该舰当场自毁**（船长选「乙」）。
  mounts: [FOE_MOUNT_IDS.coronaBlink, FOE_MOUNT_IDS.coronaFlashOverload],
  tactic: 'kite', // 船长令「非常擅长风筝战术」⇒ 全档 kite（改前 T1~T3 是 orbit）

}

/**
 * R 族 · T3「**叠光级**」—— 巡洋档，族里的中坚。
 *
 * 血 900 × 0.90 = **810** · 单发 124 × 1.00 = **124** · 实速 258 × 1.1 = **284 m/s** ·
 * 射程 1~11,000（2026-10-01 船长令非中枢 +3,000）· **不带机巢**。
 */
export const FOE_R_CORONA_OVERLAY: FoeShipDef = {
  id: 'foe-r-corona-overlay',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "gunCount"),
  name: '叠光级',
  family: 'R',
  evasion: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "speedRatio"), // **船长 2026-10-01 令「敌人速度按照标准同级舰 1.1 的速度定」**：258 × 1.1 = 284 m/s
  hp: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "hp"), // **船长 2026-10-01 令「拥有一个 0.9 倍血量的修正（这个修正不计入预算内）」**：原 810 × 0.9（⚠ 该折减**不进威胁预算** —— 预算只由卡面 threat 决定，见 roster 表的「总血」列）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "shotDmg"), // T3 档基线 124 × 角色 1.00
  hitRate: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意；与 D 族同款写法）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "rangeMaxM"), // 激光·风筝线：上限拉长才有「风筝」可言（2026-10-01 船长令「非常擅长风筝战术」）＋ **同日令「给非中枢的R族船添加3000的基础射程」**（8000 → 11000）
  falloff: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "falloff"), // 与 D 族同款（船长 2026-09-19「将D族单独调整，远端改为 0.2」）；风筝流要保住远端威力
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-r-corona-overlay", "dmgMix_kinetic") },
  energyForm: 'beam', // 激光（能量·必中）—— 船长 2026-10-01「使用以激光为主的武器」；全仓另一族是 D 守墓古舰
  // **闪现跃迁仪**（**船长 2026-10-01 令**：「激光武器+闪现效果的挂载件」，选「乙：五档全带」）：
  // 本体被命中时拉开交战距离 2,000 m、冷却 **12 秒**（参数选「甲」；冷却经 2026-10-01「下调到5秒」后，**2026-10-03 船长令「将敌人的闪现冷却时间延长到12秒」⇒ 现行 12 秒**）—— 与「风筝」配套：被近身就闪开、重建射程优势。
  // **叠光装置**（**船长 2026-10-01 令**：「添加叠光装置：效果是每次攻击或者闪现后，攻击间隔缩短，
  // 最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。」）：本舰每开一火 / 每闪一次 ⇒ 装填间隔
  // 2026-10-03 改判：−400ms（4500 → 下限 500ms）；攻击与闪现各推进一格，耗时由实际触发次数决定。
  // 对价 = **该舰全部伤害 ×0.5**（收口在 `combat.foeRepairDiscountedShot`，光束与实弹都过）。
  mounts: [FOE_MOUNT_IDS.coronaBlink, FOE_MOUNT_IDS.coronaOverlayDrive],
  tactic: 'kite', // 船长令「非常擅长风筝战术」⇒ 全档 kite（改前 T1~T3 是 orbit）

}

/**
 * R 族 · T4「**垂暮级**」—— 战列档，机群是主力输出。
 *
 * 血 1,600 × 0.90 = **1,368** · 单发 240 × 1.00 = **240** · 实速 205 × 1.1 = **226 m/s** ·
 * 射程 1~12,500（2026-10-01 船长令非中枢 +3,000）· **不带机巢** ⇒ 打法 = **船体压住、激光点**（`kite`）。
 */
export const FOE_R_CORONA_DUSK: FoeShipDef = {
  id: 'foe-r-corona-dusk',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "gunCount"),
  name: '垂暮级',
  family: 'R',
  evasion: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 战列舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "speedRatio"), // **船长 2026-10-01 令「敌人速度按照标准同级舰 1.1 的速度定」**：205 × 1.1 = 226 m/s
  hp: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "hp"), // **船长 2026-10-01 令「拥有一个 0.9 倍血量的修正（这个修正不计入预算内）」**：原 1520 × 0.9（⚠ 该折减**不进威胁预算** —— 预算只由卡面 threat 决定，见 roster 表的「总血」列）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "shotDmg"), // T4 档基线 240 × 角色 1.00
  hitRate: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意；与 D 族同款写法）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "rangeMaxM"), // 激光·风筝线：上限拉长才有「风筝」可言（2026-10-01 船长令「非常擅长风筝战术」）＋ **同日令「给非中枢的R族船添加3000的基础射程」**（9500 → 12500）
  falloff: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "falloff"), // 与 D 族同款（船长 2026-09-19「将D族单独调整，远端改为 0.2」）；风筝流要保住远端威力
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-r-corona-dusk", "dmgMix_kinetic") },
  energyForm: 'beam', // 激光（能量·必中）—— 船长 2026-10-01「使用以激光为主的武器」；全仓另一族是 D 守墓古舰
  // **闪现跃迁仪**（**船长 2026-10-01 令**：「激光武器+闪现效果的挂载件」，选「乙：五档全带」）：
  // 本体被命中时拉开交战距离 2,000 m、冷却 **12 秒**（参数选「甲」；冷却经 2026-10-01「下调到5秒」后，**2026-10-03 船长令「将敌人的闪现冷却时间延长到12秒」⇒ 现行 12 秒**）—— 与「风筝」配套：被近身就闪开、重建射程优势。
  // **待机护盾阵列**（**船长 2026-10-02 令**：「闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。」）：
  // 闪现不在冷却中（**从未闪过也算可用 ⇒ 开场即生效**）时，**护盾层**对全伤害类型 ×0.5；
  // 闪完那段冷却（**2026-10-03 起 12 秒**）里没有这层抗性（与闪现共用冷却，机制的一部分）。见 `FoeMountDef.standbyShield`。
  mounts: [FOE_MOUNT_IDS.coronaBlink, FOE_MOUNT_IDS.coronaStandbyShield],
  tactic: 'kite', // 船长令「非常擅长风筝战术」⇒ 全档 kite（改前 T1~T3 是 orbit）

}

/**
 * R 族 · **T5「光环中枢」**—— 周末入侵的族旗舰（**本族唯一 T5，须登记在 R 族旗舰白名单**）。
 *
 * 数值 = T5 档基线 2,800 / 420 × 旗舰角色 1.40 / 1.30，机巢撤下后**单发只剩角色系数 1.30**、另吃
 * 角色折扣 0.95 ⇒ 420 × 1.3 × 0.95 = **519**；实速 155 × 1.1 = **171 m/s**；射程 1~13,500（2026-10-01 船长令**中枢 +5,000**）；**不带机巢**。
 *
 * ⚠ **血 39,200 = 3,920 × 10**（与 H 族旗舰同口径）：它是 **BOSS 本体**——战斗里的血条由
 * **池子剩余**接管（`FoeOverride.bossHp`，池子 = 固定 150,000 起算，见 `WEEKEND_BOSS_POOL_HP`），
 * 这里的 39,200 是**卡面基准**（池子立起前的读数）。
 * ⚠ 光环登记在 `WEEKEND_BOSS_FAMILIES` 里（本批），旗舰战走共享血池那套。
 */
export const FOE_R_CORONA_NEXUS: FoeShipDef = {
  id: 'foe-r-corona-nexus',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "gunCount"),
  name: '光环中枢',
  family: 'R',
  evasion: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 旗舰（本族唯一 T5）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "speedRatio"), // **船长 2026-10-01 令「敌人速度按照标准同级舰 1.1 的速度定」**：155 × 1.1 = 170.5 → **171** m/s
  hp: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "hp"), // **船长 2026-10-01 令「拥有一个 0.9 倍血量的修正（这个修正不计入预算内）」**：原 39200 × 0.9（⚠ 该折减**不进威胁预算** —— 预算只由卡面 threat 决定，见 roster 表的「总血」列）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "split_h") }, // 旗舰护盾占比回到 0.5（与 H 族旗舰同值，便于两族 BOSS 可比）
  /**
   * 🔴 **旗舰武器改判**（**船长 2026-10-02 两句令**，原话照抄）：
   *
   * > ① 「**入侵旗舰的武器伤害降低60%，但是每次开火是三次间隔100ms的射击，目标选择随机。**」
   * > ② （追问"降低 N%"的读法 ⇒ **裁定「甲」：每发 ×(1−N)**；随即**二次改判**）「**再调低一些，改为每发 −70%**」
   *
   * ⇒ **每发** = 原单发 519 × **0.3** = 155.7 → **156**（"降低 N%"落在单发上，不是"一轮总伤"）；
   * **一轮三连总伤 = 156 × 3 = 468 = 原单发 × 0.9**（净砍 10%，同时把"一发一大块"摊成三小发）。
   * 连发排期与逐发选靶见 `FoeShipDef.burst`（本卡 `foeTargeting: 'random'` ⇒ 每发独立重抽）。
   */
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "shotDmg"), // T5 档基线 420 × 角色 1.30 × 0.95（机群让位）= 519 ⇒ **改判后每发 ×0.3**
  hitRate: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意；与 D 族同款写法）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "reloadMs"),
  /**
   * **三连发**（船长 2026-10-02 令，见上面 `shotDmg` 的引文）：一轮装填打 **3** 发、发间隔 **100 ms**，
   * **逐发独立随机选靶**（卡上 `foeTargeting: 'random'`）。落码 = `WeaponSpec.burst`
   * ＋ `combat` 敌方开火段（前两发之后装填重置为 100ms、第三发之后才回 5000ms）。
   */
  burst: { shots: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "burst_shots"), gapMs: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "burst_gapMs") },
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "rangeMaxM"), // 激光·风筝线：上限拉长才有「风筝」可言（2026-10-01 船长令「非常擅长风筝战术」）＋ **同日令「中枢添加5000」**（10500 → 13500）
  falloff: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "falloff"), // 与 D 族同款（船长 2026-09-19「将D族单独调整，远端改为 0.2」）；风筝流要保住远端威力
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-r-corona-nexus", "dmgMix_kinetic") },
  energyForm: 'beam', // 激光（能量·必中）—— 船长 2026-10-01「使用以激光为主的武器」；全仓另一族是 D 守墓古舰
  // **闪现跃迁仪**（**船长 2026-10-01 令**：「激光武器+闪现效果的挂载件」，选「乙：五档全带」）：
  // 本体被命中时拉开交战距离 2,000 m、冷却 **12 秒**（参数选「甲」；冷却经 2026-10-01「下调到5秒」后，**2026-10-03 船长令「将敌人的闪现冷却时间延长到12秒」⇒ 现行 12 秒**）—— 与「风筝」配套：被近身就闪开、重建射程优势。
  // **聚焦阵列**（**船长 2026-10-02 令**：「武器的远端衰减，随时间提高到1（就是无衰减）。」＋改判
  // 「旗舰挂载件的会随波重置」）：它自己武器的远端衰减 0.2 线性爬到 1.0（120 秒到满）、**每波从头爬**；
  // 只影响它自己（不 buff 僚舰）。见 `FoeMountDef.focusArray`。
  mounts: [FOE_MOUNT_IDS.coronaBlink, FOE_MOUNT_IDS.coronaFocusArray, FOE_MOUNT_IDS.coronaOverlayBeacon],
  tactic: 'kite', // 船长令「非常擅长风筝战术」⇒ 全档 kite（改前 T1~T3 是 orbit）

  elite: true, // 显示名挂「精锐」前缀
}
