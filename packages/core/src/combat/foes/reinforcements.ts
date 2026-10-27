/** 战斗域职责拆分，保持原计算与顺序。 */
import type { UnitSpec } from '../model'
import type { FoeReinforceTrigger, FoeSupportBranch, BattleBalance, SimContext, AnomalyDef } from '../../types'
import { foeGunMaxRangeOf } from '../foeRange'
import { type GameState, addLog } from '../../state'
import { isAlive } from '../combatMath'
import { seedUnit, initFoeDronePools, initFoeRepairPulses } from './state'
import { WORMHOLE_FOE_VOLLEY_STAGGER_MS, pushBattleNotice, BATTLE_ARRIVAL_STAGGER_MS } from '../combatFx'
import { baseFoeTag, FOE_SUPPORT_TAG_RE, supportFoeModelTagOf } from '../foeCard'
import { nextInt } from '../../rng'

/** 本波编成（`curFoes` 全部条目）的**存活剩余总血比例**：分子 = 在场且未全灭的单位的剩余三层血之和，
 *  分母 = 本波编成的**满血总量**（含尚未入场的增援——"残部呼救"要按编制总量看，不是按在场量看）。 */
export function foeResidualHpFrac(b: import('../../state').BattleState, curFoes: readonly UnitSpec[]): number {
  let max = 0
  let cur = 0
  for (const f of curFoes) {
    max += f.hp.s + f.hp.a + f.hp.h
    const u = b.units[f.tag]
    if (u) cur += u.hp.s + u.hp.a + u.hp.h
  }
  return max > 0 ? Math.max(0, cur) / max : 0
}

/** 本场**已击毁的敌方单位数**（三层血全归零即计；尸体留在 `battle.units` 里，故可直接数）。 */
export function foeKillCount(b: import('../../state').BattleState): number {
  let n = 0
  for (const tag of Object.keys(b.units)) {
    const u = b.units[tag]!
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) n += 1
  }
  return n
}

/** 入场触发判定：**任一条件满足即入场**（未写/无效的条件不参与）。
 *  `sec` 走**战斗时钟**（`lastTickGameMs − startedAtGameMs`，与推进器相位同口径、波次演出窗口不计时）。 */
export function reinforceTriggered(
  at: FoeReinforceTrigger,
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): boolean {
  if (at.sec !== undefined && b.lastTickGameMs - b.startedAtGameMs >= at.sec * 1000) return true
  if (at.afterKills !== undefined && foeKillCount(b) >= at.afterKills) return true
  if (at.hpBelow !== undefined && foeResidualHpFrac(b, curFoes) <= at.hpBelow) return true
  return false
}

/** 带「支援呼叫装置」的呼叫者（**存活**才作数）；本卡里 = 守墓王座舰 */
export function supportCallerOf(
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): UnitSpec | undefined {
  for (const spec of curFoes) {
    if (spec.foeSupportCall === undefined) continue
    const u = b.units[spec.tag]
    if (u && u.side === 'foe' && u.hp.s > 0 && u.hp.a > 0 && u.hp.h > 0) return spec
  }
  return undefined
}

/** 呼叫者的**当前有效炮台最远射程**（与 `markFoeGunRangeBuff` 的 reach 同一算式） */
export function supportCallerReachM(b: import('../../state').BattleState, caller: UnitSpec): number {
  return caller.weapons.reduce((m, w) => Math.max(m, foeGunMaxRangeOf(b, caller, w)), 0)
}

/** 已入场的那一支（**含尸体**——尸体留在 `battle.units` 里，故"到场过"永远是"存在"） */
export function arrivedSupportBranch(
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): FoeSupportBranch | null {
  for (const spec of curFoes) {
    const br = spec.foeReinforceBranch
    if (br !== undefined && b.units[spec.tag]) return br
  }
  return null
}

/** 本拍应当到场的那一支（`null` = 还没到判定时刻 / 呼叫者不在场 ⇒ 分支条目一律不进） */
export function resolveSupportBranch(
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): FoeSupportBranch | null {
  const settled = arrivedSupportBranch(b, curFoes)
  if (settled !== null) return settled // 判过就锁死（另一支本场不再出现）
  const caller = supportCallerOf(b, curFoes)
  if (caller === undefined || caller.foeSupportCall === undefined) return null
  const delayMs = Math.max(0, Math.round(caller.foeSupportCall.delaySec * 1000))
  if (b.lastTickGameMs - b.startedAtGameMs < delayMs) return null
  return b.distanceM <= supportCallerReachM(b, caller) ? 'inside' : 'outside'
}

/**
 * **每拍结算「支援舰船召唤」**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，
 * 只不过改为**复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，
 * **每次随机复活一艘**」；**2026-09-26 船长改判**：「…改为每60秒复活2艘船。且必定会复活干扰舰」
 * ⇒ 每次 count 艘 + priorityShipIds 名单（**优先**语义：干扰舰在可补池里就先占名额）；见 `FoeMountDef.reviveEscort`）。
 *
 * 口径（全部由船长选定）：
 * - **召唤者** = 挂了该件的单位（= 入侵母舰），且**必须在场**（它沉了就不再召唤；计时停在原地）；
 * - **节拍** = 每 `everyMs`（60 秒）一次，**首次基准 = 召唤者入场那一刻**（母舰入场才开始有支援可言）；
 * - **池子** = **当前这一波编成里已阵亡**的单位（**召唤者自己除外**）——只补当前波，跨波不补；
 * - **上限** = **不超本波原编成**（活着的 + 已召唤的 ≥ 编成数 ⇒ 本拍不召唤）⇒ 死一个补一个，
 *   玩家打掉得比补得快才能推进；
 * - **满血入场** + 入场窗口（`enteredAtMs`：动画演完才可被选中、首发也推到窗口之后）——
 *   与波次转场/单波增援**同一套演出与窗口口径**；
 * - **表现 = 敌方支援舰船入场**：新 tag **`sup{n}-<原tag>`** ⇒ 界面上是一艘**新单位**（新舰影 +
 *   入场动画），而美术/体积/名称仍按原 tag 解析（`baseFoeTag` 剥壳，见 `foeShipAtTag`）；
 * - **入场即参战**：本函数只写 `battle.units`（**编成表 `curFoes` 一个字段都不动**——槽位/上限/
 *   优先名单全按它算）⇒ 参战列表由调用方用 `foesWithSupport` 重取（开火/选靶/判清波三处同源），
 *   漏了这一步它就只是一具"会显示的摆设"（2026-09-27 玩家报障的根因）；
 * - 随机走 `state.rng`，但**只在挂了本件的战斗里消费** ⇒ 没挂件的战斗随机序列逐字不变。
 * 2026-10-08 巢母主动召唤另走指定型号模板：沿用时钟／支援入场，上限仍为本波原编成。
 */
export function resolveFoeRevive(
  state: GameState,
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
): void {
  if (bal.foeReviveEnabled !== true) return
  const summoner = curFoes.find((f) => f.foeReviveEscort !== undefined || f.foeSummonEscort !== undefined)
  if (summoner === undefined) return
  const summon = summoner.foeSummonEscort
  if (summon?.formationSlots) return
  const config = summon ?? summoner.foeReviveEscort
  if (!config || summon && !summoner.foeSummonTemplate) return
  if (summon && b.ended !== null) return
  if (summoner.foeReviveEscort?.all && b.ended !== null) return
  const rt = b.units[summoner.tag]
  if (!rt || (rt.hp.s <= 0 && rt.hp.a <= 0 && rt.hp.h <= 0)) return
  const everyMs = Math.max(1_000, Math.round(config.everyMs))
  const activeClock = config.activeClock === true
  const clock = activeClock ? b.foeAbilityClocks?.[summoner.tag] ?? 0
    : summoner.foeReviveEscort?.all ? b.lastTickGameMs : nowMs
  if (b.foeReviveAtMs === undefined) b.foeReviveAtMs = activeClock ? everyMs : (rt.enteredAtMs ?? b.startedAtGameMs) + everyMs
  if (clock < b.foeReviveAtMs) return
  /** 到点 ⇒ 推进一格（大步长/离线补算一格一格来，不在一次推进里连刷） */
  b.foeReviveAtMs = clock + everyMs
  if (summon) {
    const alive = foesWithSupport(b, curFoes).filter(foe => isAlive(b, foe.tag)).length
    const quota = Math.min(Math.max(1, Math.round(summon.count)), Math.max(0, curFoes.length - alive))
    for (let i = 0; i < quota; i++) {
      const n = (b.foeReviveCount ?? 0) + 1
      b.foeReviveCount = n
      const template = summoner.foeSummonTemplate!
      const spec = { ...structuredClone(template), tag: `sup${n}-${template.tag}` }
      seedUnit(b, spec, { enterReload: true, arrivedAtMs: b.lastTickGameMs,
        ...(b.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}) })
      initFoeDronePools(b, [spec])
      initFoeRepairPulses(b, [spec])
      pushBattleNotice(b, `敌方支援舰船入场：${spec.name}`)
      addLog(state, 'warn', `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`, 'core.combat.001', { p1: spec.name, p2: n })
    }
    return
  }
  const revive = summoner.foeReviveEscort
  if (!revive) return
  /**
   * **本波"槽位"口径**：一个编成条目 = 一个槽位，槽位里站着的是**原单位或它的支援舰**（`sup{n}-`）。
   * ⚠ 支援舰不是 `curFoes` 里的条目 ⇒ 数"在场数"必须把它们的**剥壳 tag** 一并算上，
   * 否则上限形同虚设（每次到点都能再补一艘，战场无限膨胀）。
   * ⚠⚠ 同理，**参战列表**也得把它们的剥壳 tag 算上（`foesWithSupport`）——本函数只负责"补进场"，
   * "补进来之后它算不算敌人"在调用方（2026-09-27 报障的根因）。
   */
  const specTags = new Set(curFoes.map((f) => f.tag))
  const aliveSlots = new Set<string>()
  for (const [tag, u] of Object.entries(b.units)) {
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) continue
    const slot = baseFoeTag(tag)
    if (specTags.has(slot)) aliveSlots.add(slot)
  }
  /** **编成已满 ⇒ 不召唤**（船长的"不超本波原编成"）；剩余空槽数在下面按 `count` 分配时用 */
  if (aliveSlots.size >= curFoes.length) return
  /**
   * 池子 = **当前波编成里已阵亡、且槽位还空着**的条目（**召唤者自己除外**）——
   * 已阵亡才叫"复活"（必须有尸体），槽位空着才补得进去（同一槽位的支援舰还活着就不重复补）。
   */
  const dead = curFoes.filter(
    (f) =>
      f.foeReviveEscort === undefined &&
      (revive.allowedShipIds === undefined || revive.allowedShipIds.includes(f.foeShipId ?? '')) &&
      b.units[f.tag] !== undefined &&
      !aliveSlots.has(f.tag) &&
      b.units[f.tag]!.hp.s <= 0 &&
      b.units[f.tag]!.hp.a <= 0 &&
      b.units[f.tag]!.hp.h <= 0,
  )
  if (dead.length === 0) return
  /**
   * **本拍补几艘**（**船长 2026-09-26**：「入侵活动中，H族入侵母舰的挂载件复活效果，
   * **改为每60秒复活2艘船**。且**必定会复活干扰舰**」）：
   * - `count`（缺省 1）＝每次上到几艘；实际再受「本波剩余空槽（= 不超本波原编成）」与「可补池」双重封顶；
   * - **优先名单**（`priorityShipIds`，装的是 H 族「墨潮干扰舰」）：名单里的舰只要**在池子里**
   *   （= 阵亡且槽位空着）就**优先占一个名额**（按名单顺序取）；取完再在**剩下的池子**里随机补足；
   *   它活着 / 已补进场（不在池子里）⇒ 名额回落到随机（与"死一个补一个"的上限口径一致）。
   */
  const want = revive.all === true ? dead.length : Math.max(1, Math.round(revive.count ?? 1))
  const room = curFoes.length - aliveSlots.size
  const quota = Math.min(want, room, dead.length)
  if (quota <= 0) return
  const priorityIds = revive.priorityShipIds ?? []
  const picks: UnitSpec[] = []
  let rest = [...dead]
  for (const shipId of priorityIds) {
    if (picks.length >= quota) break
    const at = rest.findIndex((f) => f.shipId === shipId)
    if (at < 0) continue
    picks.push(rest[at]!)
    rest = rest.filter((_, i) => i !== at)
  }
  while (picks.length < quota && rest.length > 0) {
    const at = nextInt(state.rng, rest.length)
    picks.push(rest[at]!)
    rest = rest.filter((_, i) => i !== at)
  }
  for (const pick of picks) {
    const n = (b.foeReviveCount ?? 0) + 1
    b.foeReviveCount = n
    const spec: UnitSpec = { ...pick, tag: `sup${n}-${pick.tag}` }
    seedUnit(b, spec, {
      enterReload: true,
      // 旧H维持全局入场时刻；有效时钟或全部重构按实际推进拍入场，不推迟到预算末尾。
      arrivedAtMs: activeClock || revive.all ? b.lastTickGameMs : state.gameMs,
      ...(b.wormhole ? { foePhaseMs: WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
    })
    // 随新单位补建机群池与修理账本（与波次转场同款；没挂那两件的单位一个键都不建）
    initFoeDronePools(b, [spec])
    initFoeRepairPulses(b, [spec])
    pushBattleNotice(b, `敌方支援舰船入场：${spec.name}`)
    addLog(
      state,
      'warn',
      `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`,
      'core.combat.001',
      { p1: spec.name, p2: n },
    )
  }
}

/**
 * **本波"参战敌阵" = 编成条目 ＋ 已入场的支援舰**（`sup{n}-<原tag>`，见 `resolveFoeRevive`）。
 *
 * 为什么必须有这一层（**2026-09-27 玩家报障**，船长转述：「**增援的敌舰不会攻击也没有效果**」）：
 * `resolveFoeRevive` 是直接 `seedUnit` 进 `battle.units` 的（它不、也不能改 `curFoes` ——
 * 那是编成表，槽位/上限/优先名单全按它算），而**敌人开火、我方选靶、判清波/判胜**三件事
 * 全都只看调用方递进 `stepBattle` 的那份 `foes` ⇒ 支援舰虽然入得了场（有舰影、有血条、
 * 有入场动画），却**一炮不开、谁也打不着它、也不挡清波**——玩家看到的就是"增援入场但毫无作用"。
 *
 * 口径：
 * - **配对靠剥壳回查本波编成**（`baseFoeTag`）：查得到才收（本波召唤的支援舰），查不到
 *   （跨波遗留的尸体/支援舰）一律不收 —— 与"只补当前波"同一条边界；
 * - **一律追加在队尾**，绝不插队：`battle.pdCd` / `pdFocus` 都是**按下标**对齐这份列表的
 *   （见 `resolvePointDefense`），插队会让近防炮冷却与集火锁错位到别的舰上；
 * - 规格由**原条目重建**（`{...base, tag}`）：存档里只有 tag ＋ 血量，规格本来就是这个口径
 *   （换波/读档中断补缺也一样）⇒ **不新增任何存档字段**；
 * - **没挂该件的战斗逐字不变**：`foeReviveCount` 缺省（= 本场一次都没召唤过）直接原样返回，
 *   连数组都不建（与开战/逐拍路径的零变化口径一致）。
 */
export function foesWithSupport(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): UnitSpec[] {
  if (b.foeReviveCount === undefined) return foes as UnitSpec[]
  let extra: UnitSpec[] | null = null
  for (const tag of Object.keys(b.units)) {
    if (!FOE_SUPPORT_TAG_RE.test(tag)) continue
    if (foes.some((f) => f.tag === tag)) continue
    const sourceTag = supportFoeModelTagOf(tag)
    if (sourceTag !== baseFoeTag(tag) && !foes.some(f => f.tag === baseFoeTag(tag))) continue
    const original = foes.find((f) => f.tag === sourceTag)
    const template = original ? undefined : foes.find(f => f.foeSummonTemplate?.tag === sourceTag)?.foeSummonTemplate
    // 同型号援军的网／武器修改互不污染，也不回写下拍重建用的模板。
    const base = original ?? (template ? structuredClone(template) : undefined)
    if (base === undefined) continue
    ;(extra ??= []).push({ ...base, tag })
  }
  return extra === null ? (foes as UnitSpec[]) : [...foes, ...extra]
}

/** 固定舰型按原编成空槽补入，型号取当前波同型规格，沿用支援舰参战与恢复路径。 */
export function resolveFoeSummon(
  state: GameState,
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
): void {
  if (bal.foeReviveEnabled !== true || b.ended !== null) return
  for (const summoner of curFoes) {
    const config = summoner.foeSummonEscort
    if (!config?.formationSlots || !isAlive(b, summoner.tag)) continue
    const model = curFoes.find(foe => foe.foeShipId === config.shipId)
    if (!model) continue
    const rt = b.units[summoner.tag]!
    const everyMs = Math.max(1_000, Math.round(config.everyMs))
    const ledger = b.foeSummonAtMs ?? (b.foeSummonAtMs = {})
    const next = ledger[summoner.tag] ?? (ledger[summoner.tag] = (rt.enteredAtMs ?? b.foeWaveStartMs ?? b.startedAtGameMs) + everyMs)
    if (nowMs < next) continue
    // 满员也消耗本次检查，离线按子步推进，不积攒补舰次数。
    ledger[summoner.tag] = nowMs + everyMs
    const occupied = new Set(Object.keys(b.units).filter(tag => isAlive(b, tag)).map(baseFoeTag))
    const slot = curFoes.find(foe => foe.tag !== summoner.tag && b.units[foe.tag] !== undefined && !occupied.has(foe.tag))
    if (!slot) continue
    const n = (b.foeReviveCount ?? 0) + 1
    b.foeReviveCount = n
    const spec = { ...structuredClone(model), tag: `sup${n}~${model.tag}~${slot.tag}` }
    seedUnit(b, spec, { enterReload: true, arrivedAtMs: nowMs, ...(b.wormhole ? { foePhaseMs: WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}) })
    initFoeDronePools(b, [spec])
    initFoeRepairPulses(b, [spec])
    pushBattleNotice(b, '', 'core.combat.001', { p1: spec.name, p2: n })
    addLog(state, 'warn', `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`, 'core.combat.001', { p1: spec.name, p2: n })
  }
}

/**
 * **每拍结算增援入场**（`advanceBattleFor` 主循环内、`stepBattle` **之前**调用——保证"上一拍刚打死的
 * 单位"本拍就能触发援军，且判胜检查看到的是补入后的编队）。
 * - 总开关关闭 → 直接返回（**零行为变化**：此时建档期也根本没写过 `foeReinforceAt`）；
 * - 已入场判定 = `battle.units` 里已有该 tag（含尸体）→ 不重复补入、不需要任何存档字段；
 * - **分支闸门**（2026-09-19「支援呼叫装置」）：带 `foeReinforceBranch` 的条目，只有与
 *   `resolveSupportBranch` 的判定一致才进（另一支本场永不出现）；
 * - 入场单位走 `enterReload` —— 与波次转场同款"一段自然哑火窗口"（≈一次装填时长）；
 * - 到场另推一条**画面提示**（`battle.notices`，与"受击增程"同一处）；
 * - 距离重开：`bal.foeReinforceReopenFrac`（语义同 `waveReopenFrac`；缺省 0 = 原地入场）。
 */
export function resolveReinforcements(
  state: GameState,
  ctx: SimContext,
  b: import('../../state').BattleState,
  anomaly: AnomalyDef,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  openM: number,
): void {
  if (bal.foeReinforceEnabled !== true) return
  const supportBranch = resolveSupportBranch(b, curFoes)
  const arrived: UnitSpec[] = []
  let arriveIdx = 0
  for (const spec of curFoes) {
    if (b.units[spec.tag]) continue // 已入场（含已阵亡的尸体）
    // 分支闸门：不属本场判定出来的那一支 ⇒ 本场不再考虑（未判出 = null ⇒ 分支条目一律等待）
    if (spec.foeReinforceBranch !== undefined && spec.foeReinforceBranch !== supportBranch) continue
    const at = spec.foeReinforceAt
    if (!at) continue // 开战即在的常规单位（未写 enterAt）
    if (!reinforceTriggered(at, b, curFoes)) continue
    // 入场窗口与界面动画同源（船长 2026-09-14「动画没结束不开火」）：逐舰错峰；
    // 时刻取**全局时钟**（`state.gameMs`）——与转场那一处同理由（战斗时钟可能落后于全局时钟）
    seedUnit(b, spec, {
      enterReload: true,
      arrivedAtMs: state.gameMs + arriveIdx * BATTLE_ARRIVAL_STAGGER_MS,
      ...(b.wormhole ? { foePhaseMs: arriveIdx * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
    })
    arriveIdx += 1
    arrived.push(spec)
  }
  if (arrived.length === 0) return
  // **到场提示**（船长 2026-09-19：支援呼叫装置那一批「开战提示 + 到场提示」）——画面顶部提示位，
  // 与"受击增程"同一处；按名归并计数（同一支里同名多艘写成 ×N）
  const byName = new Map<string, number>()
  for (const s of arrived) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  pushBattleNotice(
    b,
    `敌方增援抵达：${[...byName].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join('、')}`,
  )
  // 距离重开（2026-09-11 船长口径：沿用 waveReopenFrac 语义，缺省 0 = 不重开）
  const reopen = bal.foeReinforceReopenFrac ?? 0
  if (reopen > 0 && Number.isFinite(openM)) {
    b.distanceM = Math.round(openM * reopen + b.distanceM * (1 - reopen))
  }
  // 近防炮调度补位（与波次转场同款：pdCd 与敌编队同序——增援本身就占着 curFoes 里的位置，
  // 故只需要把它的倒计时置成"下一拍判定"，不必重排整个数组）
  if (b.pdCd && b.dronePools) {
    for (const spec of arrived) {
      const i = curFoes.indexOf(spec)
      if (i >= 0 && i < b.pdCd.length) b.pdCd[i] = Math.max(100, Math.round(bal.pdJudgementMs))
    }
  }
  const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
  const names = [...new Set(arrived.map((s) => s.name))].join('、')
  addLog(
    state,
    'warn',
    `⚔ 敌方增援自远处入场（${waveName ? waveName + "·" : ""}${anomaly.name}）：${names} ×${arrived.length} 加入战斗` +
      `${reopen > 0 ? "，重新接近中。" : "。"}`,
  )
}
