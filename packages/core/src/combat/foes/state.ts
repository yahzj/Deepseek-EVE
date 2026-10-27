/** 战斗域职责拆分，保持原计算与顺序。 */
import type { UnitSpec } from '../model'
import { syncCoronaFleetFocus } from '../coronaFocus'
import { pushBattleNotice, BATTLE_ARRIVAL_FLY_MS } from '../combatFx'
import { foeFamilyHpMulOf } from '../foePower'
import { ceilFinalQuantity } from '../../quantity'
import { clamp } from '../combatMath'

/** （2026-10-02 批次 4h：船体维修装置/护盾脉冲整簇迁到 combatRepair.ts，本文件借回 + 再导出） */

export function createBattleState(
  me: UnitSpec,
  foes: UnitSpec[],
  nowMs: number,
  myDesireM: number,
  /**
   * **僚舰**（虫洞 D 批 · 船长 2026-09-13：一场战斗最多 4 艘我方同时参战）。
   * 缺省 `[]` = **单船路径**（既有 27 张悬赏卡 / 低安遭遇 / AI 副船全走这一档）⇒ 建档内容与
   * 改动前逐字一致（`units` 多出的键只可能是这里传进来的僚舰）。
   */
  myAllies: readonly UnitSpec[] = [],
): import('../../state').BattleState {
  const units: Record<string, import('../../state').BattleState['units'][string]> = {}
  /**
   * **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）。
   * ⚠ **开战首波是内联播种**（本函数不走 `seedUnit`）——首版只在 `seedUnit` 里累积 ⇒
   * **单波战斗的战报/悬停看不到敌方挂载件**（多波/增援才看得到）；这里补上首波这一份。
   */
  const foeMounts: string[] = []
  /**
   * **同序的「双语名对」**（2026-09-24）：与 `foeMounts` **下标对齐**、按**中文名**去重
   * （与上一行的去重键同一把尺）——显示层按当前语言挑一列，见 `BattleScreen.mountNamesTextOf`。
   */
  const foeMountPairs: Array<readonly [string, string]> = []
  for (const spec of [me, ...myAllies, ...foes]) {
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**带入场触发的单位不进开战编队**，
    // 由 `advanceBattleFor` 每拍按条件补入。开关关闭时建档期根本不写 `foeReinforceAt` → 本行永不命中。
    if (spec.foeReinforceAt) continue
    if (spec.side === 'foe') {
      const names = spec.foeMountNames ?? []
      const pairs = spec.foeMountNamePairs ?? []
      for (let i = 0; i < names.length; i++) {
        const n = names[i]!
        if (foeMounts.includes(n)) continue
        foeMounts.push(n)
        foeMountPairs.push(pairs[i] ?? [n, n])
      }
    }
    units[spec.tag] = {
      tag: spec.tag,
      side: spec.side,
      name: spec.name,
      hp: { ...spec.hp },
      hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      // **舰级 id**（2026-09-24）：首波内联播种同样要带上（`flagshipBattleLedger` 认母舰靠它）
      ...(spec.foeShipId !== undefined ? { foeShipId: spec.foeShipId } : {}),
      // 船长2026-10-08：新战斗玩家武器先完成一轮实际装填，敌方首波不变。
      weapons: spec.weapons.map(w => spec.side === 'me' ? Math.max(1, w.reloadMs) : 0),
      /**
       * **隐秘行动装置**（2026-09-15 船长）：开战那一刻起窗——`stealthMs` 由 `createPlayerSpec` 写
       * （装了装置**且未装推进器**才有值）。**只有装了装置的那一艘写本字段**（Q3 甲）⇒
       * 编队其余船、未装装置的场次、敌舰一律零变化。
       */
      ...(spec.stealthMs !== undefined && spec.stealthMs > 0
        ? { stealthUntilMs: nowMs + spec.stealthMs }
        : {}),
    }
  }
  const battle: import('../../state').BattleState = {
    startedAtGameMs: nowMs,
    lastTickGameMs: nowMs,
    distanceM: 0, // 由调用方按 battleOpenM 赋值
    myDesireM,
    units,
    // 开战首波登记下来的敌方挂载件（没挂 = 不写键 ⇒ 老档/无挂载场次零变化）
    ...(foeMounts.length > 0 ? { foeMounts } : {}),
    ...(foeMountPairs.length > 0 ? { foeMountNamePairs: foeMountPairs } : {}),
    ammo: { kin: 0, exp: 0, pla: 0 },
    stats: { meShots: 0, meHits: 0, meDmg: 0, foeShots: 0, foeHits: 0 },
    fx: [],
    fxSeq: 0,
    ended: null,
    /**
     * **逐舰状态表开场即建空表**（2026-09-16 船长「将缺少的一并实现」）：
     * 近防炮的**反应式令牌**与**集火锁**都改为按 `舰tag`（锁再加武器下标）分账。
     * 建空表 = 新战斗一律走逐舰路径；**旧字段**（`droneHitAt` / `mePdFocus`）只服务
     * "本改动之前开的在途战斗"（运行态字段、不随档 ⇒ 零迁移）。
     */
    droneHitAtMeBy: {},
    mePdFocusBy: {},
  }
  syncCoronaFleetFocus(battle, foes)
  return battle
}

/**
 * **开战公告：隐秘行动装置启动**（2026-09-15 船长 · Q6 甲 = 不新增界面，只走战斗内那一条提示）。
 *
 * 落点口径照 2026-09-11 船长的机制提示纪律：「**日志内不用显示提示，将该提示放入战斗画面内显示**
 * （和敌方增援统一下系统，显示位置改为战斗窗口正上方）」⇒ 走 `pushBattleNotice`（画面顶部提示位，
 * 与「敌方增援」「受击增程」同一处），**不写 `addLog`**。
 * 只在**真的有窗口**时推（未装装置的场次一条都不推 ⇒ 既有读数零变化）。
 */
export function announceStealthStart(b: import('../../state').BattleState): void {
  for (const u of Object.values(b.units)) {
    if (u.side !== 'me' || u.stealthUntilMs === undefined) continue
    const sec = Math.max(0, Math.round((u.stealthUntilMs - b.lastTickGameMs) / 1000))
    pushBattleNotice(b, `隐秘行动：${u.name} 进入隐身（${sec} 秒内不被锁定、不被攻击）`)
  }
}

/**
 * **开战提示：敌方呼叫增援**（船长 2026-09-19「支援呼叫装置」批：「**战斗开始20秒后，增援2艘幽灵舰。
 * 如果对方在自己最远射程之外时，增援2艘静滞卫舰。**」）——同 `announceStealthStart` 的口径：
 * 只走**画面顶部提示位**（`battle.notices`，与"敌方增援/受击增程"同一处），不写 `addLog`。
 * 没挂该件的场次一条都不推 ⇒ 既有读数零变化。
 */
export function announceSupportCallStart(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const caller = foes.find((f) => f.foeSupportCall !== undefined)
  if (caller === undefined || caller.foeSupportCall === undefined) return
  const sec = Math.max(0, Math.round(caller.foeSupportCall.delaySec))
  pushBattleNotice(b, `敌方呼叫增援：${sec} 秒后抵达`)
}

/** 按规格把单位补入战斗（多波续刷/读档补缺用；已存在（含 hp 归零的尸体）不覆盖）。
 * enterReload（2026-09-09 波次转场）：增援单位入场需先完成一轮装填（weapons 满倒计时）
 * 才开火——给"增援抵达"一段自然哑火窗口（≈一次装填时长），不改变任何结算语义。 */
/**
 * **入场播种**（船长 2026-09-14：「①乙，初始不可开火，且对洞内洞外都生效」「③补。并且参考①动画没结束不开火」）。
 *
 * 只给**有入场动画**的单位写 `enteredAtMs`（洞内首波敌方跃迁入场 / 每一次波次转场与单波内增援）：
 * - `idx` = 该舰在本批入场里的序（0 起）⇒ 入场时刻含逐舰错峰，与界面 `--arrive-delay` 同一算式；
 * - **它自己的首发也推到窗口之后**：装填取"窗口时长"与自身装填的**较大者**
 *   （波次转场/增援本来就带 `enterReload`，只有"洞内首波原本满装填"这一档会因此变慢）；
 * - `enterReload` 语义不变（`true` = 至少一个自身装填周期）。
 */
export function seedUnit(
  b: import('../../state').BattleState,
  spec: UnitSpec,
  opts: { enterReload?: boolean; arrivedAtMs?: number; foePhaseMs?: number } = {},
): void {
  if (b.units[spec.tag]) return
  // **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）：所有单位都经这里入场
  // （开战首波 / 波次转场 / 增援）⇒ 累积一份"本场出现过"的清单给战报用（运行期字段、不入档）。
  // ⚠ **2026-09-24 起同一份清单带「双语名对」**（键同为中文名 ⇒ 两条数组**下标恒对齐**，
  // 显示层按语言挑一列）；`foeMountNames` 与 `foeMountNamePairs` 缺一不可地一起维护。
  if (spec.side === 'foe' && spec.foeMountNames && spec.foeMountNames.length > 0) {
    const set = new Set(b.foeMounts ?? [])
    const pairs = new Map<string, readonly [string, string]>()
    const oldNames = b.foeMounts ?? []
    const oldPairs = b.foeMountNamePairs ?? []
    for (let i = 0; i < oldNames.length; i++) pairs.set(oldNames[i]!, oldPairs[i] ?? [oldNames[i]!, oldNames[i]!])
    const specPairs = spec.foeMountNamePairs ?? []
    for (let i = 0; i < spec.foeMountNames.length; i++) {
      const n = spec.foeMountNames[i]!
      set.add(n)
      if (!pairs.has(n)) pairs.set(n, specPairs[i] ?? [n, n])
    }
    const merged = [...set]
    b.foeMounts = merged
    b.foeMountNamePairs = merged.map((n) => pairs.get(n) ?? [n, n])
  }
  const windowMs = opts.arrivedAtMs !== undefined ? BATTLE_ARRIVAL_FLY_MS : 0
  /** 首轮相位错开（洞内专属；见 `WORMHOLE_FOE_VOLLEY_STAGGER_MS`）——洞外调用方一律不传 ⇒ 0 */
  const phase = opts.foePhaseMs ?? 0
  b.units[spec.tag] = {
    tag: spec.tag,
    side: spec.side,
    name: spec.name,
    hp: { ...spec.hp },
    hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    ...(spec.foeShipId !== undefined ? { foeShipId: spec.foeShipId } : {}),
    weapons: opts.enterReload
      ? spec.weapons.map((w) => Math.max(1, w.reloadMs, windowMs) + phase)
      : spec.weapons.map(() => phase),
    ...(opts.arrivedAtMs !== undefined ? { enteredAtMs: opts.arrivedAtMs } : {}),
  }
}

/**
 * **建敌机生存池**（2026-09-11 机群批）——按**敌单位 tag** 索引；池数组与本单位 `src:'drone'`
 * 武器条目**同序**（`slot` 顺序、每条展开 `count` 架，与 `createFoeSpecsFromShips` 的展开顺序一致）。
 *
 * - 三层血 / 抗性 / 回避取自**机型表**（`FoeDroneDef.defense`，绝对值）；我方无人机线技能
 *   （耐久学/强化学/规避学）**只作用于我方机群**，敌机不吃——族格由机型表定死，与玩家技能无关；
 * - **开战与每次换波都调用**（每波单位是新对象、tag 也不同 ⇒ 旧波的池自然作废）；
 * - **无 `foeDrones` 的单位不建池**；全场都没有 ⇒ 本字段不写（既有战斗零行为变化）。
 * （2026-10-02 批次 4l 从 combat.ts 迁来：combat 的 advanceBattleFor 仍要调用，转公开）
 */
export function initFoeDronePools(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const pools: Record<string, import('../../state').DronePoolEntry[]> = {}
  for (const f of foes) {
    const slots = f.foeDrones
    if (!slots || slots.length === 0) continue
    const list: import('../../state').DronePoolEntry[] = []
    const mk = (
      drone: (typeof slots)[number]['drone'],
      artId: string,
      inHangar: boolean,
    ): import('../../state').DronePoolEntry => {
      const d = drone.defense
      const hpMul = foeFamilyHpMulOf(drone.family)
      const resists = {
        ...(d.shieldResist ? { shield: d.shieldResist } : {}),
        ...(d.armorResist ? { armor: d.armorResist } : {}),
        ...(d.hullResist ? { hull: d.hullResist } : {}),
      }
      const hpOf = (value: number): number => Math.max(1, ceilFinalQuantity(value * hpMul))
      const s = hpOf(d.shieldHp)
      const a = hpOf(d.armorHp)
      const h = hpOf(d.hullHp)
      return {
        s,
        a,
        h,
        alive: true,
        artId,
        evasion: clamp(0, 0.9, d.evasion ?? 0),
        ...(Object.keys(resists).length > 0 ? { resists } : {}),
        // 满血三层值（备用机补位按此放出）；缺省字段仅供新档，旧档缺省即视为"当前血 = 满血"
        maxS: s,
        maxA: a,
        maxH: h,
        ...(inHangar ? { inHangar: true } : {}),
      }
    }
    for (const ds of slots)
      for (let k = 0; k < Math.max(0, Math.round(ds.count)); k++)
        list.push(mk(ds.drone, ds.drone.id, false))
    // **备用机库**（2026-09-12）：同机型的额外条目，开局全部在库（不出战、不开火、不计存活架数）
    const reserve = f.foeDroneReserve
    const reserveModel = slots[0]?.drone
    if (reserve && reserveModel)
      for (let k = 0; k < Math.max(0, Math.round(reserve.count)); k++)
        list.push(mk(reserveModel, reserveModel.id, true))
    if (list.length > 0) pools[f.tag] = list
  }
  if (Object.keys(pools).length > 0) b.foeDronePools = pools
}

/**
 * **建档「船体修理装置」逐单位账本**（船长 2026-09-24；挂件参数见 `FoeMountDef.repairPulse`）。
 *
 * 幂等：**只为"挂了这件、且账本里还没有"的单位补一条**（首跳 = 开战时刻 + `everyMs`）——
 * 已存在的账本**原样保留**（战中的波次转场、增援入场、逐拍重建都不会把计时重置 ⇒ 不会白赚一跳）。
 * 没有任何单位挂这件时**一个键都不建**（`battle.foeRepairPulses` 保持缺省 ⇒ tick 里那块直接跳过）。
 * （2026-10-02 批次 4l 从 combat.ts 迁来：combat 的 advanceBattleFor 仍要调用，转公开）
 */
export function initFoeRepairPulses(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const need = foes.filter((f) => f.foeRepairPulse !== undefined)
  if (need.length === 0) return
  const ledgers = b.foeRepairPulses ?? {}
  let added = false
  for (const f of need) {
    if (ledgers[f.tag]) continue
    ledgers[f.tag] = {
      nextPulseAtMs: b.startedAtGameMs + Math.max(1, Math.round(f.foeRepairPulse!.everyMs)),
      pulses: 0,
      healed: 0,
    }
    added = true
  }
  if (added) b.foeRepairPulses = ledgers
}
