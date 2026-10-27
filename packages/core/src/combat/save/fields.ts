/** 战斗域职责拆分，保持原计算与顺序。 */
import type { BattleState } from '../../state'

/** V12：清洗战斗状态（只存动态量；字段损坏即整体弃置返回 null，引擎会在交火阶段重建） */
/**
 * **战斗字段持久化分类表**（2026-09-12 审计 A3）——`BattleState` 的**每一个字段**都必须在这里登记
 * 自己是"随档持久化"还是"运行态（有意不入档）"，**漏登记编译期就报错**（`satisfies` 要求键集
 * 与 `keyof BattleState` 完全一致）——代替此前那种"手抄一份白名单、加了字段忘了收录"的漂移方式
 * （2026-09-11 就漏过 `hullEscapeFrac`：保险字段没随档保留 ⇒ 战中重载凭空失效）。
 *
 * ⚠ **分类的判据**：**战中重载后引擎还要不要拿它续算**。要 ⇒ `persist`（清洗后原样带回）；
 * 只是表现层/短窗缓存、或本来就"重载即重置"的循环 ⇒ `runtime`，但**必须写明理由**。
 * ⚠ 载入侧只认登记表（`BATTLE_PERSIST_KEYS`）⇒ 新增字段若忘记分类，**typecheck 直接失败**。
 */
export type BattleFieldSpec = { kind: 'persist' } | { kind: 'runtime'; why: string }

export const BATTLE_FIELDS = {
  rangeMemory: { kind: 'persist' },
  foeAcidLayers: { kind: 'persist' },
  foeRebirths: { kind: 'persist' },
  meRebirths: { kind: 'persist' },
  meCrisisActive: { kind: 'persist' },
  meRailStacks: { kind: 'persist' },
  foeCoatingLayers: { kind: 'runtime', why: '永陵级守墓镀层装甲的五秒逐层状态，重载后按当前战斗状态重新开始' },
  foeShieldCapacitorActive: { kind: 'runtime', why: '永陵级护盾蓄能模式只存在于当前战斗，战斗重载按本场重建' },
  foeShieldCapacitorAttacks: { kind: 'runtime', why: '永陵级各武器蓄能攻击层数只存在于当前战斗' },
  alienCorrosion: { kind: 'persist' },
  acidBursts: { kind: 'persist' },
  foeAbilityClocks: { kind: 'persist' },
  foeHatcheries: { kind: 'persist' },
  /* ── 随档持久化：战中重载必须原样续算 ── */
  startedAtGameMs: { kind: 'persist' },
  lastTickGameMs: { kind: 'persist' },
  distanceM: { kind: 'persist' },
  myDesireM: { kind: 'persist' },
  units: { kind: 'persist' },
  ammo: { kind: 'persist' },
  ammoCreditByWeapon: { kind: 'persist' },
  // F3c B2：开战预载量（谜质「弹药回收装置」战后按「预载 − 余额」算已耗）——随档，免得中途读档后加成失效
  ammoLoaded: { kind: 'persist' },
  ammoIds: { kind: 'persist' },
  expeditionAmmo: { kind: 'persist' },
  stats: { kind: 'persist' },
  fx: { kind: 'persist' },
  // ⚠ **派生字段**：载入侧不读存档里的旧值，而是按清洗后的 fx 环尾部重算（`尾序号 + 1`），
  // 这样旧档（无 seq）也能续播；故"往返相等"对它不适用，用例单独断言派生式。
  fxSeq: { kind: 'persist' },
  ended: { kind: 'persist' },
  hullEscapeFrac: { kind: 'persist' },
  waveIdx: { kind: 'persist' },
  waveClearAt: { kind: 'persist' },
  // **本波起点**（2026-10-02 加）：**必须随档** —— 「聚焦阵列」的远端衰减爬升按它计时，
  // 丢了会让战中重载后的计时锚掉回 `startedAtGameMs` ⇒ BOSS 的衰减**凭空跳到满**（等于白赚）。
  // 与 `waveIdx` / `waveClearAt` 同一口径（都是"本波循环"的锚点，重载必须原样续算）。
  foeWaveStartMs: { kind: 'persist' },
  autoEscaped: { kind: 'persist' },
  escapeReason: { kind: 'persist' },
  // **损伤管制装置 · 免死状态**（2026-09-25 船长令）：**必须随档** —— 丢了会让"战中重载"后
  // 同一个窗口里结构不再受保护、或本场第二次启动（每场一次的口径被绕过），与 `hullEscapeFrac` 同类。
  dc: { kind: 'persist' },
  dcKitsUsed: { kind: 'persist' },
  // **我方编队**（虫洞 D 批 · 2026-09-13）：**必须随档** —— 丢了会让战中重载的多舰战斗
  // 退化成单船（僚舰凭空消失、结算按 1 艘算），与 `hullEscapeFrac` 当年漏登记同类后果。
  myFleet: { kind: 'persist' },
  // **虫洞战斗标记**（虫洞 F 批 · 2026-09-13）：**必须随档** —— 逐拍按它重建派生敌卡；
  // 丢了会让战中重载的洞内战斗**退回原卡强度**（层数缩放消失，越深越弱的怪事）。
  wormhole: { kind: 'persist' },
  /* ── 2026-09-12 船长裁定（A3 盘点后「六项全修」）：以下七项由 runtime **改为随档** ──
   * 判据仍是"战中重载后引擎要不要续算"，只是这些原来漏了，而漏掉的后果是真缺陷： */
  repair: { kind: 'persist' }, // 维修装置快照 + **预载组件账本**（丢了 ⇒ 组件凭空消失、战后无从退回）
  shieldCharge: { kind: 'persist' }, // 护盾充能装置快照 + 15 秒脉冲计时（丢了 ⇒ 重载后计时重置 = 白赚一跳）
  // 2026-09-16 船长裁定「甲：逐舰维修」：逐舰账本（键 = 舰 tag）——同 `repair`/`shieldCharge` 的理由，
  // 且**必须随档**：漏了会让僚舰的预载组件与计时在战中重载后凭空消失（与 `myFleet` 漏登记的后果同类）。
  repairBy: { kind: 'persist' },
  shieldChargeBy: { kind: 'persist' },
  // 2026-09-20 船长：护盾充能力场账本（每 N 秒一跳的计时 + 累计跳数）——**必须随档**：
  // 漏了会让战中重载后力场计时重置（= 白赚一跳），与 `shieldCharge` 同理。
  shieldFieldBy: { kind: 'persist' },
  // 2026-09-16 船长：敌方后勤账本（每 5 秒一跳的计时 + 累计修复量）——**必须随档**：
  // 漏了会让战中重载后敌方修理计时重置（= 白赚一跳），与 `repair`/`shieldCharge` 同理。
  foeRepair: { kind: 'persist' },
  // 2026-09-24 船长：挂载件「船体修理装置」逐单位脉冲账本（键 = 战斗 tag）——**必须随档**：
  // 漏了会让战中重载后敌方修理计时重置（= 白赚一跳），与 `repair`/`shieldCharge`/`foeRepair` 同理
  // （2026-09-22「随档字段两处落笔」规则：写入点 = combat.initFoeRepairPulses，白名单 = cleanBattle）。
  foeRepairPulses: { kind: 'persist' },
  // 2026-09-25 船长令：挂载件「支援舰船召唤装置」（2026-09-26 起**每 60 秒复活 2 艘**、干扰舰优先）——
  // **必须随档**：漏了会让战中重载后召唤计时与"已召唤次数"一起重置（= 白赚一次支援 + 支援舰 tag
  // 序号回退可能撞名），与 `foeRepairPulses`/`foeRepair`/`repair` 同理。
  // （写入点 = combat.resolveFoeRevive，白名单 = cleanBattle。）
  foeReviveAtMs: { kind: 'persist' },
  foeReviveCount: { kind: 'persist' },
  foeSummonAtMs: { kind: 'persist' },
  foeFocusArrays: { kind: 'runtime', why: '当前波聚焦来源由敌舰规格重建，增益按波时钟与来源存活状态现算' },
  dronePools: { kind: 'persist' }, // 我方机群生存池（丢了 ⇒ 重载后无人机不再会被击落）
  droneLaunchBy: { kind: 'persist' },
  foeDronePools: { kind: 'persist' }, // 敌机生存池（丢了 ⇒ 重载后敌方机群整支消失）
  droneLost: { kind: 'persist' }, // 本场已击落架数（丢了 ⇒ 可反复重载规避机群战损）
  droneLoadAtStart: { kind: 'persist' }, // 开战机群快照（丢了 ⇒ 战后"战损过半"判定失效）
  // 2026-09-14 船长「逐舰机群」：逐舰战损账本 + 逐舰开战快照（`舰tag → 机型 → 架数`）
  droneLostBy: { kind: 'persist' },
  droneLoadAtStartBy: { kind: 'persist' },
  // 2026-09-27 船长令：挂载件「无人机储备甲板」（战中复位周期装置）——
  // **必须随档**：漏了会让战中重载后**待补队列清空、在跑的周期全部归零**（= 免费重置复位进度），
  // 而复活消耗的是**开战快照**（`droneReviveStock`）⇒ 预算也会被重拍回满（同一批货能反复补）。
  // 写入点 = combat/droneRevive，白名单 = cleanBattle。
  droneRevive: { kind: 'persist' },
  // **开战库存快照＝复活总预算**（全队一本）：丢了 ⇒ 重载后按当时的库存**重拍一份**（= 白赚预算）
  droneReviveStock: { kind: 'persist' },
  foeDroneRangeBuff: { kind: 'persist' }, // E 族受击增程：一次触发、本场永久（丢了 ⇒ 机制静默重置）
  foeGunRangeBuff: { kind: 'persist' }, // D 族炮台受击增程：同上
  // 2026-09-26 船长令：我方「墨潮捕获网」（H 族势力装备 · 周期装置）——
  // **必须随档**：漏了会让战中重载后"冷却进度"清零、网立刻重新张（= 白赚一轮控制），
  // 且被钉目标也会丢（重载即可换目标）。写入点 = combat.advanceMyCaptureWebs，白名单 = cleanBattle。
  myWebs: { kind: 'persist' },
  foeWebDebuffs: { kind: 'persist' },
  /* ── 运行态（有意不入档，逐条写明理由） ── */
  foeCharges: {
    kind: 'runtime',
    why: '敌冲锋循环（2026-09-14 起逐单位：在冲 / 冷却到某时刻）：落在"重载即重置循环"口径内（2026-09-10 起即如此，登记备查）',
  },
  foeBlinks: {
    kind: 'runtime',
    why: '敌「闪现跃迁」冷却（2026-10-01 加：R 族「瞬光跃迁仪」——本体被命中时拉开交战距离；冷却 12 秒，2026-10-03 船长令由 5 秒延长到 12 秒）：与 `foeCharges` 同一口径，落在"重载即重置循环"内 ⇒ 有意不入档',
  },
  foeBlinkJumps: {
    kind: 'runtime',
    why: '敌「闪现」旁路记账：最近一次跳了多远（2026-10-01 加，纯展示/读数用，不进任何算式）：与 `foeBlinks` 同一口径 ⇒ 有意不入档；缺省不写键 ⇒ 旧档零迁移',
  },
  foeBlinkQueue: {
    kind: 'runtime',
    why: '敌「闪现」演出队列（2026-10-01 加，船长令：闪现要有发生时间 + 多个排队 + 消失/出现动画）：与 `foeBlinks` 同一口径 ⇒ 有意不入档；缺省不写键 ⇒ 旧档零迁移',
  },
  meOverlayReload: {
    kind: 'runtime',
    why: '我方「叠光同款装填自加速」的当前装填间隔（2026-10-01 加：R 族势力特色激光炮 mod-lair-laser-r——每开一火 −300ms、下限 600ms）：与 `foeOverlayReload` 同一口径，落在"重载即重置循环"内 ⇒ 有意不入档',
  },
  meBlinks: {
    kind: 'runtime',
    why: '我方「跃迁规避装置」的闪现冷却（2026-10-01 加：R 族中槽件 mod-lair-blink-r——被命中时拉开 2,000m，冷却 12 秒）：与 `foeBlinks` 同一口径，落在"重载即重置循环"内 ⇒ 有意不入档',
  },
  meBurstFired: {
    kind: 'runtime',
    why: '我方「三连射」本轮已发数（2026-10-03 加：R 族势力特色激光炮 mod-lair-beam-r「三叉戟光束炮」——一轮 3 发、发间隔 100ms、每发各扣弹）：与 `meOverlayReload` / `foeBurstFired` 同一口径，落在"重载即重置循环"内（最多重来一轮）⇒ 有意不入档；缺省不写键 ⇒ 旧档零迁移',
  },
  meBlinkQueue: {
    kind: 'runtime',
    why: '我方「闪现」演出队列（2026-10-02 §35 加，船长令：闪现演出扩到触发者所在全队 + 禁火对称化）：与 `foeBlinkQueue` / `meBlinks` 同一口径 ⇒ 有意不入档；缺省不写键 ⇒ 旧档零迁移',
  },
  foeOverlayReload: {
    kind: 'runtime',
    why: '敌「叠光装置」的当前装填间隔与已折算的闪现次数（2026-10-01 加：R 族 T3 叠光级——每次攻击/闪现后装填间隔 −400ms、下限 500ms，伤害 ×0.3）：与 `foeCharges` / `foeBlinks` 同一口径，落在"重载即重置循环"内 ⇒ 有意不入档',
  },
  foeBurstFired: {
    kind: 'runtime',
    why: '敌「连发」本轮已发数（2026-10-02 加：R 族 T5 光环中枢那把三连发武器——每轮 3 发、发间隔 100ms、逐发随机选靶）：与 `foeBlinks` / `foeOverlayReload` 同一口径，落在"重载即重置循环"内（最多重来一轮）⇒ 有意不入档；缺省不写键 ⇒ 旧档零迁移',
  },
  foeStandbyTick: {
    kind: 'runtime',
    why: '敌「待机护盾阵列」的本拍就绪快照（2026-10-03 加，船长裁定「同一拍整次齐射都算」）：每拍开头由 stepBattle 重盖一次，重载后按当时的 `foeBlinks` 重算本拍 ⇒ 与 `foeBlinks` 同一口径，有意不入档；缺省不写键 ⇒ 旧档零迁移',
  },
  foeChargeEnteredAtMs: { kind: 'runtime', why: '2026-09-11 已停用字段，只为不改存档形状而保留声明' },  meSpeedMps: {
    kind: 'runtime',
    why: '双方战斗机动速度（2026-09-16 加）：逐拍重算，只给距离条两端显示 ⇒ 不入档',
  },
  foeSpeedMps: {
    kind: 'runtime',
    why: '同上（敌方那份）',
  },
  meWebDebuffs: {
    kind: 'runtime',
    why: '劫掠捕获网：我方被钉住的状态（2026-09-16 加）——运行期、随战斗结束即消，不入档',
  },
  foeWebFired: {
    kind: 'runtime',
    why: '劫掠捕获网：同一艘电子舰整场只发一次的账本（2026-09-16 加）——运行期',
  },
  meFoeRangeDebuff: {
    kind: 'runtime',
    why: '电子舰压制敌舰射程的削减率（2026-09-18 加）——由编队现算、建档与每拍各重算一次，不入档（读档后自动重建）',
  },
  foeMounts: {
    kind: 'runtime',
    why: '敌方挂载件名清单（2026-09-16 加）：只给战报/悬停渲染；战中重载即由 seedUnit 重建 ⇒ 不入档',
  },
  foeMountNamePairs: {
    kind: 'runtime',
    why: '同上那份清单的「双语名对」（2026-09-24 加）：纯显示快照，随 foeMounts 一起由 seedUnit 重建 ⇒ 不入档',
  },
  meVolleyDmg: {
    kind: 'runtime',
    why: '我方"不被一击带走"保险的逐拍承伤账本（船长 2026-09-16）：跨拍即重置，重载即清空 ⇒ 不入档',
  },
  meVolleyWindow: { kind: 'runtime', why: '100ms齐射保险窗口标记，随本拍承伤账一起重建' },
  droneHitAt: { kind: 'runtime', why: '反应式防空的最近受击时刻：短窗缓存，超窗即脱锁' },
  // 2026-09-16 近防炮逐舰（船长「将缺少的一并实现」）：令牌与集火锁都按 `舰tag` 分账，
  // 与上面两条同款 —— 短窗运行态，重载即重置（设计即零迁移）。
  droneHitAtMeBy: { kind: 'runtime', why: '反应式防空令牌（我方逐舰）：短窗缓存，超窗即脱锁' },
  notices: { kind: 'runtime', why: '战斗画面提示条：纯表现层，限时自动消失、不留档' },
  pdCd: { kind: 'runtime', why: '近防炮调度冷却（当前波）：重载即重置为可开火' },
  pdFocus: { kind: 'runtime', why: '近防炮集火锁定：缺省 = 下一拍按优先级重选（2026-09-12 设计即零迁移）' },
  mePdFocus: { kind: 'runtime', why: '我方近防炮集火锁定（P-40）：同上，缺省 = 每拍按优先级重选（零迁移）' },
  mePdFocusBy: { kind: 'runtime', why: '我方近防炮集火锁定（2026-09-16 逐舰版，键 = 舰tag:武器下标）：同上' },
  mePdAnsweredBy: {
    kind: 'runtime',
    why: '近防炮逐门"这次挨打已还过手"记账（2026-09-17 修复：多门近防炮只有一门开火）：跨拍缓存，超窗即失效',
  },
  // 洞内战斗倍速（2026-09-19 谜质科技「时间压缩矩阵」）：两者都是**每拍现算**的展示/口径字段，
  // 落档反而会"把离线前的倍速带到读档后" ⇒ 一律 runtime；老档缺省 = 1× / 老口径（零迁移）。
  speedX: { kind: 'runtime', why: '本场生效倍速：由前台心跳每拍传入并夹紧，不落档（离线结算恒 1×）' },
  speedAxis: { kind: 'runtime', why: '倍速时间轴锚点（全局时钟 ↔ 战斗时钟配对）：每拍收尾刷新，落档无意义' },
  // 敌群覆写（2026-09-25 加）：**必须随档**——`advanceBattleFor` 每拍从 ctx 重建敌卡，覆写不存就会
  // "只有第 0 波吃到"（多波卡的后续波弹回满强度：遇袭 ×0.75 的 2 波卡首当其冲）。老档缺省 = 无覆写（零迁移）。
  foeOverride: { kind: 'persist' },
  /**
   * **本场 BOSS 被打沉的时刻**（**2026-09-27 船长令**：「给死亡加个触发挂载点」）——**必须随档**：
   * 它就是"玩家的这一场战斗把母舰打沉了"的**事实**；漏了会让"战中读档后母舰已沉"凭空消失，
   * 旗舰留档（`WeekendEventState.flagshipPlayerKill`）也就无从抄写。写入点 = `combat.applyFoeUnitDamage`
   * （敌舰伤害唯一收口）。老档/本场没有 BOSS ⇒ 不写（零迁移）。
   */
  bossDownAtMs: { kind: 'persist' },
} satisfies Record<keyof BattleState, BattleFieldSpec>

/** **必须随档持久化**的战斗字段键（用例据此逐字段守"重载不丢"；顺序 = 登记表顺序） */
export const BATTLE_PERSIST_KEYS: ReadonlyArray<keyof BattleState> = Object.entries(BATTLE_FIELDS)
  .filter(([, spec]) => spec.kind === 'persist')
  .map(([key]) => key as keyof BattleState)
