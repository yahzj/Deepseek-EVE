/**
 * **战斗档清洗**（2026-10-02 从 `save.ts` 拆出 · 批次 4m · 零行为变化）。
 *
 * 本文件 = 存档归一里的**战斗状态清洗器**（蓝图批准的"纯函数归一器"拆分）：`asRaw` 安全转对象、
 * 战斗字段持久化分类表（编译期键集完整契约）、`cleanBattle` 与全部 clean* 字段清洗件——
 * 只依赖 state 类型 / types（`RawState` 类型从 save 借，`import type` 不构成运行期环）。
 * `save.ts` 原样再导出（先例：fitted.ts），既有引用零改动。
 */

/* 以下为 2026-10-02 批次 4m 从 save.ts 切接过来的整簇（asRaw ~ cleanFx）。 */
import type { RawState } from './save'
import type { BattleFx, BattleShieldFieldLedger, BattleShieldFieldStream, BattleState } from './state'

/** 把未知值安全转成普通对象（非对象一律当空对象） */
export function asRaw(value: unknown): RawState {
  return typeof value === 'object' && value !== null ? (value as RawState) : {}
}

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
type BattleFieldSpec = { kind: 'persist' } | { kind: 'runtime'; why: string }

const BATTLE_FIELDS = {
  foeAcidLayers: { kind: 'persist' },
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

export function cleanBattle(raw: unknown): BattleState | null {
  const b = asRaw(raw)
  const numf = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const numi = (v: unknown, fallback: number): number => Math.max(0, Math.floor(numf(v, fallback)))
  const distance = numf(b.distanceM, NaN)
  if (!Number.isFinite(distance) || distance <= 0) return null
  const unitsRaw = b.units
  const units: Record<string, BattleState['units'][string]> = {}
  if (unitsRaw !== null && typeof unitsRaw === 'object') {
    for (const [tag, uRaw] of Object.entries(unitsRaw as RawState)) {
      if (!tag) continue
      const u = asRaw(uRaw)
      const side = u.side === 'me' || u.side === 'foe' ? u.side : null
      if (!side) continue
      const hpRaw = asRaw(u.hp)
      const weaponsRaw = u.weapons
      const weapons: number[] = []
      if (Array.isArray(weaponsRaw)) {
        for (const cd of weaponsRaw) {
          if (typeof cd === 'number' && Number.isFinite(cd)) weapons.push(Math.max(0, cd))
        }
      }
      if (weapons.length === 0) weapons.push(0)
      const hpMaxRaw = asRaw(u.hpMax)
      const hpMaxOk =
        hpMaxRaw !== null &&
        typeof hpMaxRaw === 'object' &&
        typeof (hpMaxRaw as RawState).s === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).s) &&
        typeof (hpMaxRaw as RawState).a === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).a) &&
        typeof (hpMaxRaw as RawState).h === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).h)
      units[tag] = {
        tag,
        side,
        name: typeof u.name === 'string' && u.name.length > 0 ? u.name : tag,
        hp: {
          s: Math.max(0, numf(hpRaw.s, 0)),
          a: Math.max(0, numf(hpRaw.a, 0)),
          h: Math.max(0, numf(hpRaw.h, 0)),
        },
        ...(hpMaxOk
          ? {
              hpMax: {
                s: Math.max(0, (hpMaxRaw as RawState).s as number),
                a: Math.max(0, (hpMaxRaw as RawState).a as number),
                h: Math.max(0, (hpMaxRaw as RawState).h as number),
              },
            }
          : {}),
        weapons,
        // **入场时刻**（船长 2026-09-14「动画没结束不开火」）：**随档**——战斗时钟 `lastTickGameMs`
        // 也随档 ⇒ 在读入后 `lastTickGameMs − enteredAtMs` 依旧正确（窗口不会因重载而重启或消失）。
        // 老档/无入场动画的单位本字段缺失 ⇒ 视为"窗口已过"（恒可交战，零迁移）。
        ...(typeof u.enteredAtMs === 'number' && Number.isFinite(u.enteredAtMs)
          ? { enteredAtMs: numf(u.enteredAtMs, 0) }
          : {}),
        // **隐秘行动装置的隐身窗口**（2026-09-15 船长）：同样**随档**——窗口是战斗时钟上的一个
        // 截止时刻，而 `lastTickGameMs` 也随档 ⇒ 读档后窗口不会重启、也不会凭空消失。
        // 老档/未装装置的单位缺本字段 ⇒ 恒可被选中（零迁移）。
        ...(typeof u.stealthUntilMs === 'number' && Number.isFinite(u.stealthUntilMs)
          ? { stealthUntilMs: numf(u.stealthUntilMs, 0) }
          : {}),
        // **舰级 id**（2026-09-24 · 旗舰 BOSS 用）：**随档**——它决定"这个单位是不是母舰"，
        // 若读档后丢掉，池子记账就会把这一场算成 0 输出。老档/旧路径缺本字段 ⇒ 不写（零迁移）。
        ...(typeof u.foeShipId === 'string' && u.foeShipId.length > 0 ? { foeShipId: u.foeShipId } : {}),
        // **阵亡时刻**（2026-09-27 船长令「给死亡加个触发挂载点」）：**随档**——它是"这艘敌舰
        // 在玩家的这一场里什么时候被打沉的"事实记录，旗舰留档以它为准；漏了会让"战中读档后母舰已沉"
        // 的事实凭空消失。老档 / 未阵亡的单位缺本字段 ⇒ 不写（零迁移）。
        ...(typeof u.downAtMs === 'number' && Number.isFinite(u.downAtMs) ? { downAtMs: numf(u.downAtMs, 0) } : {}),
      }
    }
  }
  if (Object.keys(units).length === 0) return null
  const ammoRaw = asRaw(b.ammo)
  const statsRaw = asRaw(b.stats)
  const endedRaw = b.ended
  const fx = cleanFx(b.fx, numf)
  // 清洗后的候选值——**只有登记为 `persist` 的字段会被带出**（见 `BATTLE_FIELDS`）
  // 2026-09-12 船长裁定「六项全修」：下面七项**改为随档**，故先清洗成候选值
  /**
   * **敌群覆写**（2026-09-25 加 · 登记为 persist）：逐字段认，坏值一律丢（老档/旧路径缺 ⇒ 不写 ⇒ 零迁移）。
   */
  const foeOverrideRaw = asRaw(b.foeOverride)
  const foeOverride = ((): BattleState['foeOverride'] => {
    if (foeOverrideRaw === null || typeof foeOverrideRaw !== 'object') return undefined
    const out: NonNullable<BattleState['foeOverride']> = {}
    const t = foeOverrideRaw.threat
    if (typeof t === 'number' && Number.isFinite(t)) out.threat = Math.max(1, Math.round(t))
    const s = foeOverrideRaw.strengthMul
    if (typeof s === 'number' && Number.isFinite(s) && s > 0) out.strengthMul = s
    if (foeOverrideRaw.keepCardWaves === true) out.keepCardWaves = true
    /**
     * **BOSS 血条覆写**（2026-09-25）：`bossHp` = 本场满值（池子剩余）、`bossHpMax` = 血条分母
     * （池子总量）、`bossShipId` = 哪条舰级算母舰。
     * ⚠ 原先这三格**一个都没过清洗器** ⇒ 战中读档后母舰血条回落到卡面血（69,592），
     * 池子剩余那份覆写凭空消失（"单场不死/跨场累计"当场失真）。三格都取正数/非空串。
     */
    const bh = foeOverrideRaw.bossHp
    if (typeof bh === 'number' && Number.isFinite(bh) && bh > 0) out.bossHp = Math.round(bh)
    const bhm = foeOverrideRaw.bossHpMax
    if (typeof bhm === 'number' && Number.isFinite(bhm) && bhm > 0) out.bossHpMax = Math.round(bhm)
    /**
     * **母舰三层血的两份读数**（2026-09-25 船长令：「当前血条按 护盾 → 装甲 → 结构 的顺序扣除」）：
     * `bossHpLayers` = 当前值（可含 0 ⇒ 护盾已空）、`bossMaxLayers` = 三层容量（界面分母）。
     * 两份都只收有限且 ≥0 的三个数（缺一不可 ⇒ 半份坏值整块丢掉，退回等比兜底）。
     */
    const layerOf = (raw: unknown): { s: number; a: number; h: number } | undefined => {
      const o = asRaw(raw)
      if (o === null || typeof o !== 'object') return undefined
      const ok = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
      const s = ok(o.s)
      const a = ok(o.a)
      const h = ok(o.h)
      return s !== undefined && a !== undefined && h !== undefined ? { s, a, h } : undefined
    }
    const bhl = layerOf(foeOverrideRaw.bossHpLayers)
    if (bhl !== undefined) out.bossHpLayers = bhl
    const bml = layerOf(foeOverrideRaw.bossMaxLayers)
    if (bml !== undefined) out.bossMaxLayers = bml
    const bsid = foeOverrideRaw.bossShipId
    if (typeof bsid === 'string' && bsid.length > 0) out.bossShipId = bsid
    const w = foeOverrideRaw.waves
    if (Array.isArray(w)) {
      const waves: Array<{ units: number; hpShare: number }> = []
      for (const x of w) {
        const r = asRaw(x)
        if (r === null || typeof r !== 'object') continue
        waves.push({ units: Math.max(1, Math.floor(numf(r.units, 1))), hpShare: Math.max(0, numf(r.hpShare, 1)) })
      }
      if (waves.length > 0) out.waves = waves
    }
    return Object.keys(out).length > 0 ? out : undefined
  })()
  const repair = cleanRepair(b.repair)
  const shieldCharge = cleanShieldCharge(b.shieldCharge)
  /** 逐舰账本（2026-09-16 逐舰维修）：键 = 舰 tag；坏项丢键、整表空 ⇒ undefined（零迁移） */
  const repairBy = cleanLedgerMap(b.repairBy, cleanRepair)
  /**
   * **敌方后勤账本**（2026-09-16 船长）：`{ nextPulseAtMs, pulses, healed }`——整块缺/坏 ⇒ undefined
   * （零迁移：老档在途战斗本来就没有敌方后勤舰）。`pulses`/`healed` 取有限非负整数，`nextPulseAtMs` 可缺省。
   */
  const foeRepair = cleanFoeRepairLedger(b.foeRepair)
  const shieldChargeBy = cleanLedgerMap(b.shieldChargeBy, cleanShieldCharge)
  /**
   * **挂载件「船体修理装置」逐单位账本**（2026-09-24 船长）：键 = 战斗 tag
   * （敌方 tag 形如 `foe-0` / `w1-foe-0`）。值与 `foeRepair` 同形 ⇒ **共用同一条清洗器**。
   * ⚠ **必须随档**（登记表里也是 `persist`）：漏了会让战中重载**敌方修理计时重置 = 白赚一跳**。
   */
  const foeRepairPulses = cleanLedgerMap(b.foeRepairPulses, cleanFoeRepairLedger)
  /** 支援舰召唤计时（2026-09-25）：只收有限正数（时刻）/ 非负整数（次数），坏值丢字段 */
  const foeReviveAtMs =
    typeof b.foeReviveAtMs === 'number' && Number.isFinite(b.foeReviveAtMs) && b.foeReviveAtMs > 0
      ? b.foeReviveAtMs
      : undefined
  const foeReviveCount =
    typeof b.foeReviveCount === 'number' && Number.isFinite(b.foeReviveCount) && b.foeReviveCount > 0
      ? Math.floor(b.foeReviveCount)
      : undefined
  /** 力场账本（2026-09-20 新增；与 `shieldChargeBy` 分开：冷却按件、受益方是全队） */
  const shieldFieldBy = cleanLedgerMap(b.shieldFieldBy, cleanShieldField)
  const dronePools = cleanDronePools(b.dronePools)
  const droneLaunchBy = cleanDroneLaunchBy(b.droneLaunchBy)
  const foeDronePools = cleanFoeDronePools(b.foeDronePools)
  const droneLost = cleanCountMap(b.droneLost)
  const droneLoadAtStart = cleanCountMap(b.droneLoadAtStart)
  /** 逐舰账本（键 = 舰 tag；值是 `机型 → 架数`）：2026-09-14「逐舰机群」新增，老档没有 ⇒ undefined */
  const droneLostBy = cleanCountMapBy(b.droneLostBy)
  const droneLoadAtStartBy = cleanCountMapBy(b.droneLoadAtStartBy)
  /**
   * **无人机储备甲板的复位账**（2026-09-27 船长令）：逐舰一份，**坏值整条丢**（与其余账本同款口径）——
   * `q` 只收非空字符串、`t` 只收**有限非负数或 null**（null = 空闲）、`c` 只收**正数**（周期毫秒）、
   * `v` 走 `cleanCountMap`、`shipId` 非空字符串。四样缺一 ⇒ 这一舰的账整条作废
   * （宁可复位进度归零，也不让脏值把"扣两次库存"那条路走通）。
   */
  const droneRevive = cleanLedgerMap(b.droneRevive, (raw) => {
    const r = asRaw(raw)
    const shipId = typeof r.shipId === 'string' && r.shipId.length > 0 ? r.shipId : undefined
    if (shipId === undefined) return undefined
    const c = Array.isArray(r.c)
      ? r.c.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
      : []
    if (c.length === 0) return undefined
    const q = Array.isArray(r.q) ? r.q.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const tRaw = Array.isArray(r.t) ? r.t : []
    const t: Array<number | undefined> = c.map((_, i) => {
      const x = tRaw[i]
      return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined
    })
    const v = cleanCountMap(r.v) ?? {}
    return { q, t, c, v, shipId }
  })
  /** **复活总预算**（开战库存快照，全队一本）：机型 → 剩余可补架数（坏值整条丢） */
  const droneReviveStock = cleanCountMap(b.droneReviveStock)
  const alienCorrosion = typeof b.alienCorrosion === 'number' && Number.isFinite(b.alienCorrosion) && b.alienCorrosion > 0 ? b.alienCorrosion : undefined
  const acidBursts = cleanLedgerMap(b.acidBursts, raw => {
    const r = asRaw(raw)
    if ((r.cause !== 'attack' && r.cause !== 'killed') || typeof r.atMs !== 'number' || !Number.isFinite(r.atMs) || r.atMs < 0) return undefined
    return { cause: r.cause as 'attack' | 'killed', atMs: r.atMs, resolved: r.resolved !== false }
  })
  const foeHatcheries = cleanLedgerMap(b.foeHatcheries, raw => {
    const r = asRaw(raw)
    if ((r.left !== 'unlimited' && (typeof r.left !== 'number' || !Number.isInteger(r.left) || r.left < 0)) || typeof r.revived !== 'number' || !Number.isInteger(r.revived) || r.revived < 0) return undefined
    const queue: NonNullable<BattleState['foeHatcheries']>[string]['queue'] = []
    for (const raw of Array.isArray(r.queue) ? r.queue : []) {
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) { if (!queue.includes(raw)) queue.push(raw); continue }
      const slot = asRaw(raw)
      if (typeof slot.tag !== 'string' || slot.tag.length === 0 || typeof slot.index !== 'number' || !Number.isInteger(slot.index) || slot.index < 0) continue
      if (!queue.some(i => typeof i !== 'number' && i.tag === slot.tag && i.index === slot.index)) queue.push({ tag: slot.tag, index: slot.index })
    }
    return { left: r.left, revived: r.revived, queue, ...(typeof r.nextAtMs === 'number' && Number.isFinite(r.nextAtMs) && r.nextAtMs >= 0 ? { nextAtMs: r.nextAtMs } : {}) }
  })
  const foeAbilityClocks = cleanLedgerMap(b.foeAbilityClocks, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const foeSummonAtMs = cleanLedgerMap(b.foeSummonAtMs, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const foeDroneRangeBuff = cleanPosNum(b.foeDroneRangeBuff)
  const foeGunRangeBuff = cleanPosNum(b.foeGunRangeBuff)
  /**
   * **我方捕获网两份账本**（2026-09-26）：
   * - `myWebs`（键 = 携带者 tag）：只收 `{ targetTag?: 非空字符串, cooldownUntilMs: 有限非负数 }`；
   * - `foeWebDebuffs`（键 = 被钉敌舰 tag）：保留合法我方捕获网减速；运行时按网手装备复核。
   * 坏值整条丢（与其余账本同款口径）。
   */
  const myWebs = cleanLedgerMap(b.myWebs, (raw) => {
    const r = asRaw(raw)
    const cd = r.cooldownUntilMs
    if (typeof cd !== 'number' || !Number.isFinite(cd) || cd < 0) return undefined
    const tt = typeof r.targetTag === 'string' && r.targetTag.length > 0 ? r.targetTag : undefined
    return { ...(tt !== undefined ? { targetTag: tt } : {}), cooldownUntilMs: cd }
  })
  const foeWebDebuffs = cleanLedgerMap(b.foeWebDebuffs, (raw) => {
    const r = asRaw(raw)
    const byTag = r.byTag
    if (typeof byTag !== 'string' || byTag.length === 0) return undefined
    return {
      byTag,
      slowMul: typeof r.slowMul === 'number' && Number.isFinite(r.slowMul) && r.slowMul > 0 && r.slowMul <= 1 ? r.slowMul : 0.5,
      noThruster: true as const,
      noEvasion: true as const,
      atMs: Math.max(0, numf(r.atMs, 0)),
    }
  })
  /**
   * **损伤管制装置免死状态**（2026-09-25 船长令；登记为 persist）——逐舰认：
   * `lockUntilMs` 取有限正数（游戏钟）、`used` 只认 true；两格都坏的条目丢键，整块空 = undefined。
   * 老档 / 无此件的场次 ⇒ 整块不写（零迁移）。
   */
  const dc = ((): BattleState['dc'] => {
    const raw = asRaw(b.dc)
    if (raw === null || typeof raw !== 'object') return undefined
    const out: NonNullable<BattleState['dc']> = {}
    for (const [tag, v] of Object.entries(raw)) {
      if (tag.length === 0) continue
      const o = asRaw(v)
      if (o === null || typeof o !== 'object') continue
      const entry: { lockUntilMs?: number; used?: boolean } = {}
      const lk = cleanPosNum(o.lockUntilMs)
      if (lk !== undefined && lk > 0) entry.lockUntilMs = Math.round(lk)
      if (o.used === true) entry.used = true
      if (entry.lockUntilMs !== undefined || entry.used === true) out[tag] = entry
    }
    return Object.keys(out).length > 0 ? out : undefined
  })()
  const dcKitsUsed = cleanPosNum(b.dcKitsUsed)
  /** **本场 BOSS 阵亡时刻**（2026-09-27 船长令）：只收非负有限数；坏值/缺省 ⇒ 不写（零迁移） */
  const bossDownAtMs = cleanPosNum(b.bossDownAtMs)
  const cleaned: Partial<Record<keyof BattleState, unknown>> = {
    ...(() => {
      const now = Math.max(0, numf(b.lastTickGameMs, 0))
      const foeAcidLayers = cleanLedgerMap(b.foeAcidLayers, (raw) => {
        if (!Array.isArray(raw)) return undefined
        const layers = raw.flatMap(value => {
          const layer = asRaw(value)
          return typeof layer.cutPct === 'number' && Number.isFinite(layer.cutPct) && layer.cutPct > 0 && layer.cutPct <= 1 &&
            typeof layer.untilMs === 'number' && Number.isFinite(layer.untilMs) && layer.untilMs > now
            ? [{ cutPct: layer.cutPct, untilMs: layer.untilMs }] : []
        })
        return layers.length ? layers : undefined
      })
      return foeAcidLayers === undefined ? {} : { foeAcidLayers }
    })(),
    startedAtGameMs: Math.max(0, Math.floor(numf(b.startedAtGameMs, 0))),
    ...(foeOverride !== undefined ? { foeOverride } : {}),
    lastTickGameMs: Math.max(0, Math.floor(numf(b.lastTickGameMs, 0))),
    distanceM: Math.max(0, distance),
    myDesireM: Math.max(0, numf(b.myDesireM, distance)),
    units,
    ammo: {
      kin: numi(ammoRaw.kin, 0),
      exp: numi(ammoRaw.exp, 0),
      pla: numi(ammoRaw.pla, 0),
    },
    /**
     * **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：只认"三个都是有限非负数"，
     * 缺字段 / 坏值 ⇒ **不写**（读取端在没有它时自动跳过这一项加成，不会把负数退成刷弹）。
     */
    ...(() => {
      const raw = asRaw(b.ammoLoaded)
      const ok =
        typeof raw.kin === 'number' &&
        Number.isFinite(raw.kin) &&
        typeof raw.exp === 'number' &&
        Number.isFinite(raw.exp) &&
        typeof raw.pla === 'number' &&
        Number.isFinite(raw.pla)
      return ok
        ? { ammoLoaded: { kin: Math.max(0, Math.floor(raw.kin as number)), exp: Math.max(0, Math.floor(raw.exp as number)), pla: Math.max(0, Math.floor(raw.pla as number)) } }
        : {}
    })(),
    stats: {
      meShots: numi(statsRaw.meShots, 0),
      meHits: numi(statsRaw.meHits, 0),
      meDmg: Math.max(0, numf(statsRaw.meDmg, 0)),
      foeShots: numi(statsRaw.foeShots, 0),
      foeHits: numi(statsRaw.foeHits, 0),
    },
    fx,
    // 序号续发：以清洗后尾部序号 +1 为基准（旧档无 seq 字段时按序重排，见 cleanFx）
    fxSeq: fx.length > 0 ? fx[fx.length - 1]!.seq + 1 : 0,
    ended: endedRaw === 'me' || endedRaw === 'foe' ? endedRaw : null,
    // 连续作战保险（2026-09-11：由"白名单未收录"改为**随档保留**）——悬赏巡回场次与低安遭遇战都挂它，
    // 战中重载若丢掉这三项，保险会凭空失效（该撤退的场次会继续打到弃船），与"承伤持久化"同一口径。
    ...(typeof b.hullEscapeFrac === 'number' && Number.isFinite(b.hullEscapeFrac)
      ? { hullEscapeFrac: b.hullEscapeFrac }
      : {}),
    ...(b.autoEscaped === true ? { autoEscaped: true } : {}),
    // 2026-09-12：`'cannot-engage'` 也随档（原先只认 'hull' | 'timeout' ⇒ 无法交战脱战的场次重载后
    // 会退化成"结构撤退"口径，战报与结算措辞都不对）
    ...(b.escapeReason === 'hull' || b.escapeReason === 'timeout' || b.escapeReason === 'cannot-engage'
      ? { escapeReason: b.escapeReason }
      : {}),
    // 损伤管制装置免死状态（2026-09-25）：**必须随档**（窗口跨拍；每场一次的口径也不许重载绕过）
    ...(dc !== undefined ? { dc } : {}),
    ...(dcKitsUsed !== undefined && dcKitsUsed > 0 ? { dcKitsUsed: Math.floor(dcKitsUsed) } : {}),
    waveIdx:
      typeof b.waveIdx === 'number' && Number.isFinite(b.waveIdx) && b.waveIdx > 0
        ? Math.floor(b.waveIdx)
        : undefined,
    waveClearAt:
      typeof b.waveClearAt === 'number' && Number.isFinite(b.waveClearAt) && b.waveClearAt > 0
        ? b.waveClearAt
        : undefined,
    // 本波起点（2026-10-02）：随档（见 BATTLE_FIELDS 的登记理由）；坏值/未换波 ⇒ 不写（读端回落开战时刻）
    foeWaveStartMs:
      typeof b.foeWaveStartMs === 'number' && Number.isFinite(b.foeWaveStartMs) && b.foeWaveStartMs > 0
        ? b.foeWaveStartMs
        : undefined,
    // 弹药 MK2（2026-09-09）：本场实装弹 id（键 = 伤害类型；坏值丢键，零迁移）
    ammoIds: cleanAmmoIdMap(b.ammoIds),
    ammoCreditByWeapon: (() => {
      const out: Record<string, number> = {}
      for (const [key, value] of Object.entries(asRaw(b.ammoCreditByWeapon))) {
        const match = /^([A-Za-z][\w-]*)#(\d+):(kinetic|explosive|plasma)$/.exec(key)
        if (!match || !units[match[1]!] || units[match[1]!]!.side !== 'me' || Number(match[2]) >= units[match[1]!]!.weapons.length) continue
        if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1) out[key] = value
      }
      return Object.keys(out).length ? out : undefined
    })(),
    expeditionAmmo: b.expeditionAmmo === undefined ? undefined : (() => {
      const r = asRaw(b.expeditionAmmo)
      const idsByTag: NonNullable<BattleState['expeditionAmmo']>['idsByTag'] = {}
      for (const [tag, ids] of Object.entries(asRaw(r.idsByTag))) idsByTag[tag] = cleanAmmoIdMap(ids) ?? {}
      return {
        stock: cleanCountMap(r.stock) ?? {}, loaded: cleanCountMap(r.loaded) ?? {}, idsByTag,
        ...(r.revivesSettled === true ? { revivesSettled: true } : {}),
      }
    })(),
    // 我方编队（虫洞 D 批）：坏项丢弃、空表 = 不写（= 单船路径，零迁移）
    myFleet: cleanMyFleet(b.myFleet),
    // 虫洞战斗标记（虫洞 F 批）：坏值丢弃（= 退回原卡强度），零迁移
    wormhole: cleanBattleWormhole(b.wormhole),
    // ── 2026-09-12 船长裁定七项（随档）──
    ...(repair !== undefined ? { repair } : {}),
  ...(shieldCharge !== undefined ? { shieldCharge } : {}),
    // ── 2026-09-16 逐舰维修（船长裁定「甲」）：逐舰账本同样**必须随档**（丢了 ⇒ 僚舰的组件凭空消失）──
    ...(repairBy !== undefined ? { repairBy } : {}),
    ...(shieldChargeBy !== undefined ? { shieldChargeBy } : {}),
    // 2026-09-20 力场账本（丢了 ⇒ 战中重载后力场计时重置 = 白赚一跳）
    ...(shieldFieldBy !== undefined ? { shieldFieldBy } : {}),
    // 2026-09-16 敌方后勤账本（丢了 ⇒ 战中重载后敌方修理计时重置）
    ...(foeRepair !== undefined ? { foeRepair } : {}),
    ...(foeRepairPulses !== undefined ? { foeRepairPulses } : {}),
    // 2026-09-25 支援舰召唤计时（丢了 ⇒ 战中重载后计时与序号重置）
    ...(foeReviveAtMs !== undefined ? { foeReviveAtMs } : {}),
    ...(foeReviveCount !== undefined ? { foeReviveCount } : {}),
    // 2026-09-26 我方捕获网（丢了 ⇒ 重载即刷新冷却、可换目标 = 白赚一轮控制）
    ...(myWebs !== undefined ? { myWebs } : {}),
    ...(foeWebDebuffs !== undefined ? { foeWebDebuffs } : {}),
    ...(dronePools !== undefined ? { dronePools } : {}),
    ...(droneLaunchBy !== undefined ? { droneLaunchBy } : {}),
    ...(foeDronePools !== undefined ? { foeDronePools } : {}),
    ...(droneLost !== undefined ? { droneLost } : {}),
    ...(droneLoadAtStart !== undefined ? { droneLoadAtStart } : {}),
    ...(droneLostBy !== undefined ? { droneLostBy } : {}),
    ...(droneLoadAtStartBy !== undefined ? { droneLoadAtStartBy } : {}),
    ...(droneRevive !== undefined ? { droneRevive } : {}),
    ...(droneReviveStock !== undefined ? { droneReviveStock } : {}),
    ...(alienCorrosion !== undefined ? { alienCorrosion } : {}),
    ...(acidBursts !== undefined ? { acidBursts } : {}),
    ...(foeAbilityClocks !== undefined ? { foeAbilityClocks } : {}),
    ...(foeSummonAtMs !== undefined ? { foeSummonAtMs } : {}),
    ...(foeHatcheries !== undefined ? { foeHatcheries } : {}),
    ...(foeDroneRangeBuff !== undefined ? { foeDroneRangeBuff } : {}),
    ...(foeGunRangeBuff !== undefined ? { foeGunRangeBuff } : {}),
    // 2026-09-27 本场 BOSS 阵亡时刻（丢了 ⇒ "玩家亲手打沉"的事实消失，旗舰留档只能靠池子算术反推）
    ...(bossDownAtMs !== undefined ? { bossDownAtMs: Math.round(bossDownAtMs) } : {}),
  }
  // 组装：**只带走登记为 persist 的字段**（漏登记的字段在 typecheck 就会被拦下，见 BATTLE_FIELDS）
  const out: Partial<BattleState> = {}
  for (const key of BATTLE_PERSIST_KEYS) {
    const v = cleaned[key]
    if (v !== undefined) (out as Record<string, unknown>)[key as string] = v
  }
  return out as BattleState
}

/* ── 战斗字段清洗小工具（2026-09-12 船长裁定七项改随档时补；均为"坏值丢弃、不崩、零迁移"口径）── */

/** 非负有限数（坏值 = undefined，调用方决定丢弃或兜底） */
function cleanPosNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** 「字符串 → 架数/枚数」计数表（键非空、值为 ≥0 整数；坏项丢键；空表 = undefined） */
function cleanCountMap(raw: unknown): Record<string, number> | undefined {
  const r = asRaw(raw)
  let out: Record<string, number> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const n = cleanPosNum(v)
    if (n === undefined) continue
    if (!out) out = {}
    out[k] = Math.floor(n)
  }
  return out
}

/**
 * 我方编队（虫洞 D 批）：`Array<{ tag, shipId }>`——坏项丢弃、同 tag 去重、空表 = undefined
 * （= 不写字段 = 单船路径，旧档零迁移）。首条恒为主控（`tag = 'player'`），但**不强制**：
 * 引擎按 tag 认单位，写死了反而会在数据坏掉时整场弃置（宁可少带一艘僚舰也别丢掉整场战斗）。
 */
function cleanMyFleet(raw: unknown): BattleState['myFleet'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: NonNullable<BattleState['myFleet']> = []
  for (const item of raw) {
    const e = asRaw(item)
    const tag = typeof e.tag === 'string' && e.tag.length > 0 ? e.tag : null
    const shipId = typeof e.shipId === 'string' && e.shipId.length > 0 ? e.shipId : null
    if (!tag || !shipId || seen.has(tag)) continue
    seen.add(tag)
    out.push({ tag, shipId })
  }
  return out.length > 0 ? out : undefined
}

/**
 * **虫洞战斗标记**（F 批）：`{ cardId, depth, kind, waves }` —— 坏值一律丢弃
 * （丢了只会退回"原卡强度"，不会崩；`kind` 白名单外 / `cardId` 空 ⇒ 丢弃）。
 */
function cleanBattleWormhole(raw: unknown): BattleState['wormhole'] | undefined {
  const w = asRaw(raw)
  const cardId = typeof w.cardId === 'string' && w.cardId.length > 0 ? w.cardId : null
  const kind =
    w.kind === 'node' || w.kind === 'boss' || w.kind === 'extract' || w.kind === 'ruins' || w.kind === 'spawn' ? w.kind : null
  const depth = cleanPosNum(w.depth)
  const waves = cleanPosNum(w.waves)
  if (!cardId || !kind || depth === undefined || waves === undefined) return undefined
  return {
    cardId,
    kind,
    depth: Math.max(1, Math.floor(depth)),
    waves: Math.max(1, Math.floor(waves)),
    ...(typeof w.expeditionRules === 'number' && Number.isSafeInteger(w.expeditionRules) ? { expeditionRules: w.expeditionRules } : {}),
    ...(w.expeditionRole === 'ordinary' || w.expeditionRole === 'elite' || w.expeditionRole === 'guard' || w.expeditionRole === 'patrol' || w.expeditionRole === 'event' ? { expeditionRole: w.expeditionRole } : {}),
    ...(w.guardSupportDisabled === true ? { guardSupportDisabled: true } : {}),
    ...(w.desireRangeMul === 0.8 ? { desireRangeMul: 0.8 } : {}),
    ...(typeof w.threatMul === 'number' && w.threatMul > 0 && Number.isFinite(w.threatMul) ? { threatMul: w.threatMul } : {}),
    ...(typeof w.foeHitDown === 'number' && w.foeHitDown > 0 && Number.isFinite(w.foeHitDown) ? { foeHitDown: w.foeHitDown } : {}),
    ...(typeof w.blindReduce === 'number' && w.blindReduce > 0 && Number.isFinite(w.blindReduce) ? { blindReduce: w.blindReduce } : {}),
    ...(w.foeMainType === 'kinetic' || w.foeMainType === 'explosive' || w.foeMainType === 'plasma' ? { foeMainType: w.foeMainType } : {}),
    ...(w.volleyOverflow === true ? { volleyOverflow: true } : {}),
  }
}

/** **两层计数表**（`舰tag → (机型 id → 架数)`；2026-09-14「逐舰机群」）：
 *  逐层清洗，空的一律省掉（读不到该字段的老档 = undefined ⇒ 调用方按"只有主控那一份"回落）。 */
function cleanCountMapBy(raw: unknown): Record<string, Record<string, number>> | undefined {
  const r = asRaw(raw)
  let out: Record<string, Record<string, number>> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const inner = cleanCountMap(v)
    if (!inner) continue
    if (!out) out = {}
    out[k] = inner
  }
  return out
}

/** 单架机群生存池条目（三层血齐备才收；机型/闪避/抗性/备用机字段按形状带过） */
function cleanDronePoolEntry(raw: unknown): NonNullable<BattleState['dronePools']>[number] | undefined {
  const e = asRaw(raw)
  const s = cleanPosNum(e.s)
  const a = cleanPosNum(e.a)
  const h = cleanPosNum(e.h)
  if (s === undefined || a === undefined || h === undefined) return undefined
  const artId = typeof e.artId === 'string' && e.artId.length > 0 ? e.artId : undefined
  /** 所属舰 tag（2026-09-14「逐舰机群」）：老档没有 ⇒ 由 `cleanDronePools` 按键回填 */
  const owner = typeof e.owner === 'string' && e.owner.length > 0 ? e.owner : undefined
  const readyAtMs = cleanPosNum(e.readyAtMs)
  const maxS = cleanPosNum(e.maxS)
  const maxA = cleanPosNum(e.maxA)
  const maxH = cleanPosNum(e.maxH)
  return {
    s,
    a,
    h,
    alive: e.alive === true,
    ...(typeof e.launched === 'boolean' ? { launched: e.launched } : {}),
    ...(e.launchRequeued === true ? { launchRequeued: true as const } : {}),
    ...(artId !== undefined ? { artId } : {}),
    ...(owner !== undefined ? { owner } : {}),
    evasion: cleanPosNum(e.evasion) ?? 0,
    // 抗性表按形状带过（本工程自己的数据；形状坏了就丢弃 ⇒ 退化为"无抗性"，不会崩）
    ...(e.resists !== null && typeof e.resists === 'object'
      ? { resists: e.resists as NonNullable<BattleState['dronePools']>[number]['resists'] }
      : {}),
    ...(e.inHangar === true ? { inHangar: true } : {}),
    ...(readyAtMs !== undefined ? { readyAtMs } : {}),
    ...(maxS !== undefined ? { maxS } : {}),
    ...(maxA !== undefined ? { maxA } : {}),
    ...(maxH !== undefined ? { maxH } : {}),
  }
}

function cleanDroneLaunchBy(raw: unknown): BattleState['droneLaunchBy'] {
  const out: NonNullable<BattleState['droneLaunchBy']> = {}
  for (const [tag, value] of Object.entries(asRaw(raw))) {
    if (!/^[A-Za-z][\w-]*$/.test(tag)) continue
    const row = asRaw(value)
    const nextAtMs = cleanPosNum(row.nextAtMs), gapMs = cleanPosNum(row.gapMs)
    if (!Array.isArray(row.q) || nextAtMs === undefined || gapMs === undefined) continue
    const reviveGapMs = cleanPosNum(row.reviveGapMs)
    out[tag] = { q: [...new Set(row.q.filter((k): k is string => typeof k === 'string' && k.startsWith(`${tag}:`) && /^\d+$/.test(k.slice(tag.length + 1))))], nextAtMs, gapMs: Math.max(10, gapMs),
      ...(reviveGapMs !== undefined ? { reviveGapMs: Math.max(10, reviveGapMs) } : {}) }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 我方机群生存池（键 = **`舰tag:武器下标`**；2026-09-14「逐舰机群」起逐舰。
 *  ⚠ **老档的键是纯数字**（下标，只有主控）⇒ 归一成 `player:<下标>`（零迁移、语义不变）；
 *  键形不认识的一律丢弃（脏档不能让它崩）。`owner` 一律以**键**为准回填。 */
function cleanDronePools(raw: unknown): BattleState['dronePools'] | undefined {
  const r = asRaw(raw)
  let out: NonNullable<BattleState['dronePools']> | undefined
  for (const [k, v] of Object.entries(r)) {
    const entry = cleanDronePoolEntry(v)
    if (!entry) continue
    let key: string
    if (/^\d+$/.test(k)) key = `${entry.owner && entry.owner !== 'player' ? entry.owner : 'player'}:${k}`
    else if (/^[A-Za-z][\w-]*:\d+$/.test(k)) key = k
    else continue
    const sep = key.indexOf(':')
    const wi = Number.parseInt(key.slice(sep + 1), 10)
    if (!Number.isFinite(wi) || wi < 0) continue
    if (!out) out = {}
    out[key] = { ...entry, owner: key.slice(0, sep) }
  }
  return out
}

/** 敌机机群生存池（键 = 敌单位 tag；值为"与该单位 drone 条目同序"的逐架池） */
function cleanFoeDronePools(raw: unknown): BattleState['foeDronePools'] | undefined {
  const r = asRaw(raw)
  let out: NonNullable<BattleState['foeDronePools']> | undefined
  for (const [tag, arrRaw] of Object.entries(r)) {
    if (!tag || !Array.isArray(arrRaw)) continue
    const arr: NonNullable<BattleState['foeDronePools']>[string] = []
    for (const one of arrRaw) {
      const entry = cleanDronePoolEntry(one)
      if (entry) arr.push(entry)
    }
    if (arr.length === 0) continue
    if (!out) out = {}
    out[tag] = arr
  }
  return out
}

/** 维修装置运行态（开战写入；**含预载组件账本**——丢了组件会凭空消失、战后无从退回） */
function cleanRepair(raw: unknown): BattleState['repair'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const units: NonNullable<BattleState['repair']>['units'] = []
  if (Array.isArray(r.units)) {
    for (const u of r.units) {
      const it = asRaw(u)
      const moduleId = typeof it.moduleId === 'string' ? it.moduleId : ''
      const kitId = typeof it.kitId === 'string' ? it.kitId : ''
      if (!moduleId || !kitId) continue
      /**
       * **逐台计时器**（**2026-09-21 船长令：不同型号独立回转冷却**）。旧档（在途战斗）没有本字段
       * ⇒ 不写该键 ⇒ `advanceBattleFor` 走迁移分支（借账本那一个 `nextPulseAtMs` 判一次到期，
       * 随后转入逐台计时）。**不升版本**。
       */
      const unitAt = cleanPosNum(it.nextPulseAtMs)
      units.push({
        moduleId,
        kitId,
        ...(it.free === true ? { free: true } : {}),
        armorPerPulse: cleanPosNum(it.armorPerPulse) ?? 0,
        hullPerPulse: cleanPosNum(it.hullPerPulse) ?? 0,
        stopped: it.stopped === true,
        ...(unitAt !== undefined ? { nextPulseAtMs: unitAt } : {}),
      })
    }
  }
  const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
  const kitsUsedByType = cleanCountMap(r.kitsUsedByType)
  return {
    units,
    kits: cleanCountMap(r.kits) ?? {},
    pulses: Math.floor(cleanPosNum(r.pulses) ?? 0),
    kitsUsed: Math.floor(cleanPosNum(r.kitsUsed) ?? 0),
    ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
    ...(kitsUsedByType !== undefined ? { kitsUsedByType } : {}),
  }
}

/**
 * **逐型号脉冲流清洗**（**2026-09-21 船长令：不同型号独立回转冷却**）——两族共用（护盾充能 / 力场）。
 *
 * 两代结构都认：
 * - **新**（本批起）：`streams: [{ modelId, pct, ms, nextPulseAtMs? }, …]`；
 * - **旧**（2026-09-21 之前写下的在途战斗）：`{ pctPerPulse, msPerPulse?, nextPulseAtMs?, pulses }`
 *   ——**一台一路**的合计值 ⇒ 升级成**单路流**：`modelId` 留空串（找不到具体型号，**衰减已含在
 *   `pctPerPulse` 里**、不重算）。**不升存档版本、不改字段名。**
 *
 * ⚠ **比例与间隔都必须为正**（与改前同一条口径）：间隔为 0 / 缺失 ⇒ **该路丢弃** ——
 * 否则脉冲循环里 `nextPulseAtMs += 0` 会原地打转（`guard` 兜底但那是空转）。
 * 本文件**不 import `combat.ts` 的脉冲常量**（`save → combat → state` 会成环）⇒ 不替旧档猜间隔：
 * 旧结构本来就把 `msPerPulse` 写在档里（力场那件一直有），没有就是坏档、丢路。
 * 坏值一律丢路；整表为空 ⇒ `undefined`（不写字段 ⇒ 视为没装该族件）。
 */
function cleanPulseStreams(raw: unknown): BattleShieldFieldStream[] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const out: BattleShieldFieldStream[] = []
  const rawList = Array.isArray(r.streams) ? r.streams : null
  if (rawList) {
    for (const item of rawList) {
      const s = asRaw(item)
      const pct = cleanPosNum(s.pct)
      if (pct === undefined || pct <= 0) continue
      const ms = cleanPosNum(s.ms)
      if (ms === undefined || ms <= 0) continue
      const nextPulseAtMs = cleanPosNum(s.nextPulseAtMs)
      out.push({
        modelId: typeof s.modelId === 'string' ? s.modelId : '',
        pct,
        ms,
        ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
      })
    }
  } else {
    // 旧结构（单路合计值）⇒ 升级为一行流
    const pct = cleanPosNum(r.pctPerPulse)
    const ms = cleanPosNum(r.msPerPulse)
    if (pct !== undefined && pct > 0 && ms !== undefined && ms > 0) {
      const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
      out.push({ modelId: '', pct, ms, ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}) })
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * 护盾充能装置运行态（开战写入；2026-09-14 船长新增件；**2026-09-21 改逐型号多路**）。
 * 清洗口径与 `cleanRepair` 同款：坏值丢键、不崩、零迁移；**比例必须为正**否则视为无装置。
 *
 * ⚠ **本族旧档（单路 `pctPerPulse`）没有 `msPerPulse` 字段**（间隔是全局常量 30 秒、从不落档）
 * ⇒ 旧结构那一支要补上本族常量，否则在途战斗的护盾充能会被整块丢掉。该字面量与
 * `combat.SHIELD_PULSE_MS` 是**同一个数**；`save.ts` 不能 import `combat.ts`（会成环），
 * 故在此**显式写明同源**，并由用例 `pulse-stream-save.test.ts` 钉住两处相等。
 */
const SHIELD_PULSE_MS_FOR_OLD_SAVE = 15_000

function cleanShieldCharge(raw: unknown): BattleState['shieldCharge'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  // 旧档单路结构：`msPerPulse` 不存在 ⇒ 先按本族常量补进副本，再走统一清洗
  const src =
    !Array.isArray(r.streams) && cleanPosNum(r.msPerPulse) === undefined && cleanPosNum(r.pctPerPulse) !== undefined
      ? { ...r, msPerPulse: SHIELD_PULSE_MS_FOR_OLD_SAVE }
      : r
  const streams = cleanPulseStreams(src)
  if (!streams) return undefined
  return { streams, pulses: Math.floor(cleanPosNum(r.pulses) ?? 0) }
}

/**
 * **护盾充能力场运行态**（开战写入；2026-09-20 船长新增件；**2026-09-21 改逐型号多路**）。
 *
 * 清洗口径：坏路丢弃、不崩、零迁移；**比例与间隔都必须为正**，否则视为无装置。
 * 旧档（`pctPerPulse` / `msPerPulse` 单路）由 `cleanPulseStreams` 升级成一行流（两值都在档里）。
 */
function cleanShieldField(raw: unknown): BattleShieldFieldLedger | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const streams = cleanPulseStreams(r)
  if (!streams) return undefined
  return { streams, pulses: Math.floor(cleanPosNum(r.pulses) ?? 0) }
}

/**
 * **单份「修理脉冲账本」清洗**（`{ nextPulseAtMs?, pulses, healed }`）：整块缺/坏 ⇒ `undefined`
 * （零迁移）。`pulses`/`healed` 取有限非负整数（`healed` 允许小数，与累计量同精度），
 * `nextPulseAtMs` 只在正数时写。
 *
 * 两个消费方**共用本函数**（口径不许各写一份）：
 * ① `battle.foeRepair`（敌方后勤舰，2026-09-16）；
 * ② `battle.foeRepairPulses[tag]`（挂载件「船体修理装置」逐单位，2026-09-24）。
 */
function cleanFoeRepairLedger(
  v: unknown,
): NonNullable<import('./state').BattleState['foeRepair']> | undefined {
  const r = asRaw(v)
  if (Object.keys(r).length === 0) return undefined
  const next = typeof r.nextPulseAtMs === 'number' && Number.isFinite(r.nextPulseAtMs) ? r.nextPulseAtMs : 0
  const pulses = typeof r.pulses === 'number' && Number.isFinite(r.pulses) ? Math.max(0, Math.floor(r.pulses)) : 0
  const healed = typeof r.healed === 'number' && Number.isFinite(r.healed) ? Math.max(0, r.healed) : 0
  const out: NonNullable<import('./state').BattleState['foeRepair']> = { pulses, healed }
  if (next > 0) out.nextPulseAtMs = Math.floor(next)
  return out
}

/**
 * **逐舰账本清洗**（2026-09-16 逐舰维修）：键 = 战斗 tag（`player` / `ally-1`…），值走各自的单份清洗器。
 * 坏键/清洗失败的项**丢键**；整表为空 ⇒ `undefined`（不写字段 ⇒ 老读法退化成"只有主控那一份"）。
 */
function cleanLedgerMap<T>(
  raw: unknown,
  cleanOne: (v: unknown) => T | undefined,
): Record<string, T> | undefined {
  const r = asRaw(raw)
  let out: Record<string, T> | undefined
  for (const [tag, v] of Object.entries(r)) {
    if (tag.length === 0) continue
    const one = cleanOne(v)
    if (one === undefined) continue
    if (!out) out = {}
    out[tag] = one
  }
  return out
}

/**
 * 保存数组的安全边界 = 基础槽位上界 + 插件件数上界；不是可装槽位，实装仍由船型/插件校验。
 */
export const PLUG_LIST_MAX = 8
export const RACK_MAX = 7 + PLUG_LIST_MAX

/**
 * 插件 id 列表清洗：非空字符串，保留重复件及位序，截到插件列表安全上界。
 *
 * ⚠ **这是"随档字段两处落笔"的第二处**（约定 §二验证闭环）：引擎侧写 `FleetShipState.plugs`，
 * 清洗器这里必须重建它，否则读档/刷新即丢（`importantTasks.salvagerGift` 的同款前车之鉴）。
 * 空表 ⇒ `undefined`（与 `droneLoad` 同款：没有就不写键，往返幂等）。
 */
export function cleanPlugIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const id = x.trim()
    if (id.length === 0) continue
    out.push(id)
    if (out.length >= PLUG_LIST_MAX) break
  }
  return out.length > 0 ? out : undefined
}

/** 弹药 id 映射清洗（弹药 MK2：kinetic/explosive/plasma 键下的非空字符串 id；坏值丢键） */
export function cleanAmmoIdMap(raw: unknown): Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined {
  const r = asRaw(raw)
  let out: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const v = r[t]
    if (typeof v === 'string' && v.length > 0) {
      if (!out) out = {}
      out[t] = v
    }
  }
  return out
}

/** 清洗战斗可视化事件环（白名单字段；坏事件丢弃，缺失给空）。seq 按环内顺序重排（旧档无 seq 也能续播） */
function cleanFx(raw: unknown, numf: (v: unknown, fallback: number) => number): BattleFx[] {
  const out: BattleFx[] = []
  if (!Array.isArray(raw)) return out
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue
    const ev = e as RawState
    const side = ev.side === 'me' || ev.side === 'foe' ? ev.side : null
    const type =
      ev.type === 'kinetic' || ev.type === 'explosive' || ev.type === 'plasma' ? ev.type : null
    if (!side || !type) continue
    out.push({
      seq: out.length, // 按清洗后顺序重排（保序：环内 atMs 递增）
      atMs: Math.max(0, Math.floor(numf(ev.atMs, 0))),
      side,
      tag: typeof ev.tag === 'string' && ev.tag.length > 0 ? ev.tag : side === 'me' ? 'player' : 'foe-0',
      type,
      hit: ev.hit === true,
      ...(typeof ev.to === 'string' && ev.to.length > 0 ? { to: ev.to } : {}),
      ...(ev.src === 'turret' || ev.src === 'missile' || ev.src === 'laser' || ev.src === 'drone' || ev.src === 'base' ? { src: ev.src } : {}),
      ...(typeof ev.artId === 'string' && ev.artId.length > 0 ? { artId: ev.artId } : {}),
      ...(ev.web === true ? { web: true as const } : {}),
      ...(ev.blink === true ? { blink: true as const } : {}),
      ...(ev.droneDown === true ? { droneDown: true } : {}),
      ...(ev.pd === true ? { pd: true } : {}),
      ...(typeof ev.speedX === 'number' && Number.isFinite(ev.speedX) && ev.speedX > 0 ? { speedX: ev.speedX } : {}),
      ...(ev.acidBurst === true && side === 'foe' && type === 'kinetic'
        ? { acidBurst: true as const, ...(typeof ev.to === 'string' && ev.to.length > 0 ? { to: ev.to } : {}) }
        : {}),
      // 本发实收伤害（2026-09-24 船长令：飘字读数）——坏值/缺省一律不写（UI 只飘 MISS）
      ...(typeof ev.dmg === 'number' && Number.isFinite(ev.dmg) && ev.dmg > 0
        ? { dmg: Math.floor(ev.dmg) }
        : {}),
    })
  }
  // 与逐炮演出缓存的硬上限一致，同拍多炮不在读档时再次裁成48条。
  if (out.length > 512) out.splice(0, out.length - 512)
  return out
}
