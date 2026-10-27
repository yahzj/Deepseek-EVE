/** 战斗域：cards，从原引擎按职责迁移，保持结算顺序。 */
import type { GameState } from '../state'
import type { AnomalyDef, SimContext } from '../types'
import { type LairTier, lairAnomalyOf, factionAnomalyOf } from '../lairs'
import type { FoeOverride } from './model'
import type { Hp3 } from './combatMath'
import { type WormholeExpeditionFoeCard, wormholeExpeditionCard, wormholeExpeditionModifyCard } from '../wormholeExpeditionFoes'
import { WORMHOLE_TIER_THREAT_MUL, wormholeTierOfCard, wormholeSkippedBranch, wormholeAnomalyOf, wormholeCardThreatOf, WORMHOLE_FOE_BASE_STRENGTH_MUL } from '../wormholeFoes'
import { createFoeSpecs } from './foes/catalog'
import { foeHpOfThreat } from './foePower'

/**
 * 敌冲锋状态机（2026-09-10 定；结束条件 2026-09-11 改判；触发条件 2026-09-14 加"乙"；
 * **2026-09-14 同日晚些时候船长再改判：逐单位 + 自身命中解除 + 冷却 10 秒**）。
 *
 * **触发两条取或**：① 够不着（距离在**自己武器射程之外**）② **距离 > 期望交距 + 1,000**
 * （船长「冲锋按乙方案来」）→ 该单位**自己**加速（机动 ×倍率，仍走拔河公式）。
 * **解除两条取或**：① **自身炮台命中我方**（船长：「冲锋解除机制为自身攻击命中后解除冲锋状态，
 * 并进入 10 秒冷却」）② 压到期望交距 `arrived`（2026-09-11 口径，**留作兜底**）。
 * 解除后该单位进 `foeChargeCooldownMs`（**本批由 20 秒改判为 10 秒**）冷却，期满且再次满足触发条件才重启。
 *
 * ⚠ **逐单位**（2026-09-14 船长：「现在多单位的战斗速度难道不是取速度全队平均值吗？那么**各自触发
 * 冲锋的提速**应该没什么问题吧？」＋「给小虫子添加冲锋，倍率为 1.5」）：每个挂资格的单位各持一份
 * 「在冲 / 冷却到某时刻」（`b.foeCharges[tag]`），互不顶替——原编队级单标志下，先命中那条会把
 * 别的冲锋者的状态一并清掉。
 * ⚠ **倍率不外溢**（2026-09-11 船长：「冲锋还是按照**巨兽自己的速度**算…**哪怕是冲锋也是按照巨兽速度**」）：
 * 加速只乘进**该单位自己**那一项（见 `stepBattle` 的"逐单位乘各自倍率 → 取平均"）。
 * 只对挂了 `foeCanCharge` 的敌人生效——资格有**两条互相独立**的来源（见 `createFoeSpecsFromShips`）：
 * **舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件）与**老路**（威胁 ≥ `foeChargeThreatFloor`
 * 且战术 = brawl，受总开关 `foeChargeEnabled` 约束）；无总时长上限。
 *
 * ⚠ **2026-09-16 船长报障「洞内被 C 族贴上后拉不开距离」——查实与本机制无关，别再当 BUG 修**：
 * 定向实测（洞内 C 族卡、敌命中率临时置 1）：敌炮命中那一拍**照常解除并进 10 秒冷却**，洞内外同源。
 * 拉不开距离的真因是**机动拔河**（距离 = 双方各朝自己期望值推，推力 = 各自机动），
 * 关键数字见下（**按现行数据**，「C 族三卡改编成」并入 main 之后）：
 * - **敌方**：洞内 C 族 = 星髓成虫 **398** / 孢群异虫 **400** / 噬口巨兽 **297**（编队均速 364~399；
 *   冲锋 ×1.5 / ×3 ⇒ **598~891**）。⚠ 改版前洞里是**畸变/星髓幼虫 544（冲锋 816）**——那批幼虫
 *   现已从洞内三卡退场（仍留悬赏线），**"被钉死"的历史读数出自那一版编成**。
 * - **我方**：T3 巡洋基础 **272**，推进 MK2 点火 **435** / MK3 点火 **544**。
 * - **实测（现行编成 · 4×长尾鲨）**：满炮装 MK3 能把距离从 3,220 拉到 **4,169** 再赢下（拉得开）；
 *   摸金装 MK2 在 2,454~3,158 之间徘徊（不再单向被压）。最快档护卫舰（点火 864）轻松保持 ~4,700 m，
 *   但中层卡的**孢群机群**会扑上来打 ⇒ 纯风筝不再零风险。
 * - **距离仍受两条洞内口径约束**：近战怪按 2026-09-13 规则**开局就站在玩家中距档（3,220 m）**；
 *   **冲锋触发线 = 敌期望交距（C 族 ~540）+ 1,000 ≈ 1,540 m** ⇒ 想常驻在这条线之外，得靠推进器/快船。
 * **船长 2026-09-16 裁定：戊案——现状即设计，不改**；对策在配船与信息提示，不在改机制。
 *
 * 历史 BUG（2026-09-14 船长报障「冲锋到达目标距离后并不会解除」）：当时解除条件**只有** `arrived`，
 * 而"我方更快、且期望交距更远"时距离会**停在期望交距之上**（拔河平衡点：我方外拉 = 敌方内推），
 * `arrived` 永不可达 ⇒ 冲锋永不解除、冷却永不启动。本批加的**命中解除**就是这条 BUG 的出口
 * （在冲的单位既然已经进射程，炮台迟早打中）；`arrived` 仍留作兜底。
 */
/**
 * **劫掠捕获网：把四层效果施加到被钉的我方规格上**（船长 2026-09-16 两句话的落点）。
 *
 * 语义 = **只改这一份规格**（不改存档、不改数据）：战斗机动 ×`slowMul`、推进器倍率清零、
 * 闪避归零、每条武器**两端各减** `rangeDownM`（近界下限 1m、远界下限 2m）。
 * 三处调用（缺一不可）：① 触发那一发**当场**施加（这一发的命中判定就该看到闪避 0）；
 * ② `buildMyUnitSpecs` 每拍重建后施加（否则下一拍又"复活"）；③ 视图 `battleArcsFor`（面板/射程带同尺）。
 */
/**
 * **记下"这一场有哪些敌方舰级"**（船长 2026-09-16：「**在玩家第一次遭遇劫掠电子舰之后**…给玩家发送一封
 * 通讯，介绍劫掠电子舰的捕获网」）。出口唯一：两处开战入口（单船 `startBattleFor` / 编队 `startFleetBattleFor`）
 * 各调一次 ⇒ 通讯触发器只读 `state.foeShipSeen`，不必在别处再判"遇到过没有"。
 * ⚠ 只认**这一场敌卡编成里出现过的舰级**（含派生卡的编成）——与"这卡有没有它"同源。
 */
export function noteFoeShipsSeen(state: GameState, anomaly: AnomalyDef): void {
  const slots = anomaly.ships
  if (!slots || slots.length === 0) return
  let next: Record<string, true> | null = null
  for (const slot of slots) {
    const id = slot.ship?.id
    if (!id || state.foeShipSeen?.[id] === true) continue
    next = next ?? { ...(state.foeShipSeen ?? {}) }
    next[id] = true
  }
  if (next) state.foeShipSeen = next
}

/**
 * 到港开战通用组装（主控与 AI 共用）：建状态 + 预载弹药；返回 battle 或 null（记录缺失）。
 * atGameMs = 开战时刻（应传"到港时刻"，让离线大推进能把后续时间全部推完）。
 * desireM = 玩家期望距离偏好（缺省 = 主武器有效射程中点）。 */
/** 本场战斗的目标卡（2026-09-10）：赏金任务·窝点按 tier 现场派生强化卡（威胁/波次/僚机/名称）；
 *  敌对派系活跃（factionActive）= 当日选中星系的常驻悬赏威胁 ×1.1；
 *  普通悬赏、低安遭遇（都没设）一律返回原卡。战斗构建、推进、展示共用此口，避免口径漂移。 */
export function battleAnomalyOf(
  ctx: SimContext,
  anomalyId: string | null | undefined,
  lairTier?: LairTier,
  factionActive?: boolean,
): AnomalyDef | undefined {
  const base = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  if (!base) return undefined
  const card = lairTier ? lairAnomalyOf(base, lairTier, ctx.balance.battle) : base
  return factionActive ? factionAnomalyOf(card) : card
}

/** 把覆写应用到派生出来的敌卡上（纯函数；`override` 缺省或字段缺省 ⇒ 原样返回） */
export function applyFoeOverride<T>(anomaly: T, override?: FoeOverride): T {
  if (!anomaly || !override) return anomaly
  const next = { ...(anomaly as Record<string, unknown>) }
  if (override.threat !== undefined && Number.isFinite(override.threat)) next.threat = Math.max(1, Math.round(override.threat))
  if (override.keepCardWaves !== true && override.waves !== undefined && override.waves.length > 0) next.waves = override.waves
  const strengthMul = override.strengthMul
  if (strengthMul !== undefined && Number.isFinite(strengthMul) && strengthMul > 0 && strengthMul !== 1) {
    const ships = next.ships
    if (Array.isArray(ships)) {
      next.ships = ships.map((raw) => {
        const slot = raw as { hpMul?: number; dmgMul?: number; firepowerAnchor?: number }
        const out: Record<string, unknown> = {
          ...slot,
          hpMul: (slot.hpMul ?? 1) * strengthMul,
          dmgMul: (slot.dmgMul ?? 1) * strengthMul,
        }
        // 总火力锚点（写了才有）：按同一倍率缩放——**不许按自然合计重算**（它是船长有意钉住的总量；例外只有取整平局）
        if (slot.firepowerAnchor !== undefined) out.firepowerAnchor = Math.max(1, Math.round(slot.firepowerAnchor * strengthMul))
        return out
      })
    }
  }
  /**
   * **BOSS 血条覆写**（在强度倍率之后 · 取绝对值）：`hpMul = bossHp ÷ 舰级血` ⇒ 建档满血 = `bossHp`。
   * 池子里"玩家已打掉的量"不在这里扣（那由 `weekendFlagshipHpRemaining` 在开战时算好传进来）。
   */
  const bossHp = override.bossHp
  const bossShipId = override.bossShipId
  if (bossHp !== undefined && Number.isFinite(bossHp) && bossHp > 0 && typeof bossShipId === 'string' && bossShipId.length > 0) {
    const ships = next.ships
    if (Array.isArray(ships)) {
      next.ships = ships.map((raw) => {
        const slot = raw as { ship?: { id?: string; hp?: number; split?: Hp3 }; split?: Hp3 }
        if (slot.ship?.id !== bossShipId) return raw
        const classHp = Math.max(1, slot.ship.hp ?? 1)
        /**
         * ⚠ **三层血按 护盾 → 装甲 → 结构 的顺序扣**（船长 2026-09-25）：`bossHpLayers` 是"当前值"，
         * 拆成 `split` 覆写 ⇒ 建档后 `hp = bossHp × split` 逐层等于它；没给 ⇒ 保持卡面 `split`（等比分摊）。
         */
        const layers = override.bossHpLayers
        const layerSplit =
          layers !== undefined
            ? { s: Math.max(0, layers.s) / bossHp, a: Math.max(0, layers.a) / bossHp, h: Math.max(0, layers.h) / bossHp }
            : undefined
        const split = slot.split ?? slot.ship?.split ?? { s: 0.2, a: 0.55, h: 0.25 }
        const hpOverride = layers !== undefined
          ? { s: Math.max(0, layers.s), a: Math.max(0, layers.a), h: Math.max(0, layers.h) }
          : { s: bossHp * split.s, a: bossHp * split.a, h: bossHp * split.h }
        return { ...(raw as object), hpMul: bossHp / classHp, hpOverride, ...(layerSplit !== undefined ? { split: layerSplit } : {}) }
      })
    }
  }
  return next as T
}

/**
 * **洞内敌卡的派生单点**（F 批 · 2026-09-13）：开战与逐拍重建**必须走同一处**，
 * 否则会出现"建档给了一套数值、逐拍又换一套"的静默错位——
 * 首版就是这么错的：`advanceBattleFor` 漏了总血预算 ⇒ 敌人**血是强化后的、炮还是自然值**
 * （探针实测：敌总血 11,168、单发 1,336，实战里每发只掉 6~7 点，整场残血 100%）。
 */
/**
 * `wormholeDerivedAnomaly` 的一层记忆（见该函数注释；键 = 卡 id|层|用途|波数|强度覆写）。
 * 只存最近一份：一局里同时只会有一种用途在场（节点/守卫/撤离），换键即重算。
 */
export let wormholeDerivedMemo: { key: string; card: AnomalyDef } | null = null

export const expeditionDerivedMemo = new WeakMap<SimContext, Map<string, WormholeExpeditionFoeCard>>()

export function wormholeDerivedAnomaly(
  ctx: SimContext,
  baseCard: AnomalyDef,
  spec: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    strengthMul?: number
    /** 谜质：威胁乘数（缺省 1）+ 敌方命中/近盲带削减（见 `battle.wormhole` 的字段说明） */
    threatMul?: number
    foeHitDown?: number
    blindReduce?: number
  },
): AnomalyDef {
  if (spec.expeditionRules !== undefined) {
    if (spec.expeditionRules !== 2) throw new Error('wormhole-expedition-unsupported-rules')
    const family = baseCard.foeFamily
    if (family !== 'A' && family !== 'C' && family !== 'D' && family !== 'E' && family !== 'G') throw new Error('wormhole-expedition-family-invalid')
    const role = spec.expeditionRole ?? (spec.kind === 'boss' ? 'guard' : spec.kind === 'spawn' ? 'patrol' : 'ordinary')
    const key = JSON.stringify([family, spec.depth, role, spec.guardSupportDisabled, spec.threatMul, spec.foeHitDown, spec.blindReduce])
    const cache = expeditionDerivedMemo.get(ctx) ?? new Map<string, WormholeExpeditionFoeCard>()
    if (!expeditionDerivedMemo.has(ctx)) expeditionDerivedMemo.set(ctx, cache)
    const old = cache.get(key)
    if (old) return old
    const base = wormholeExpeditionCard(ctx, family, spec.depth, role, spec.guardSupportDisabled)
    const card = wormholeExpeditionModifyCard(base, ctx.balance.battle, spec)
    if (cache.size >= 64) cache.clear()
    cache.set(key, card)
    return card
  }
  /**
   * **一层记忆（2026-09-13 性能修）**：本函数被**每 100ms 一拍**（战斗推进）＋**每次重渲染**
   * （战场视图 `wormholeBattleViewOf`）调用，每次都克隆/缩放整张敌卡与槽位 ⇒ 拖距离条那种
   * 高频重渲染下会顶出顿挫（船长："依旧还是有顿挫感"、"参考洞外战斗的距离调整"）。
   * 入参只由 `(卡 id, 层, 用途, 波数, 强度覆写, 谜质三项)` 决定 ⇒ **同键复用上一份**（调用方都只读不写）。
   */
  const threatMul = spec.threatMul ?? 1
  /**
   * **分层"威胁预算"修正**（2026-09-16 船长改口径：「档位血量修正改为威胁预算修正，比例降为 1 : 1.05 : 1.1」）：
   * 档位由**卡 id 反查**（`wormholeTierOfCard`）⇒ 不进存档、老档零迁移；
   * 查不到（不是洞内卡）⇒ 1（= 与旧口径逐字一致）。
   */
  const tierThreatMul = WORMHOLE_TIER_THREAT_MUL[wormholeTierOfCard(baseCard.id) ?? 'shallow']
  /**
   * **该卡的自然总火力**（含机群）——决定它的"自然血/火力比 `r`"（甲案口径：血与火力按 `r` 反算）。
   * 用**未派生**的卡建一遍规格即可（与派生无关，纯卡面事实）；同一张卡只算一次（记忆在派生记忆里）。
   *
   * ⚠ **互斥支援分支只记一支**（2026-09-19「支援呼叫装置」批）：与 `wormholeNaturalHp` **同一个函数**
   * 取"被排除的那一支" ⇒ 血与火力两侧口径一致（两支都算会让本卡比同层同档弱约 24%）。
   */
  const naturalDps = (() => {
    const skip = wormholeSkippedBranch(baseCard)
    let dps = 0
    for (const f of createFoeSpecs(baseCard, ctx.balance.battle)) {
      if (skip !== null && f.foeReinforceBranch === skip) continue
      for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    return dps
  })()
  const zero = (v: number | undefined): string => (v === undefined || v === 0 ? '' : String(v))
  const memoKey = `${baseCard.id}|${spec.depth}|${spec.kind}|${spec.waves}|${spec.strengthMul ?? ''}|${threatMul}|${tierThreatMul}|${zero(spec.foeHitDown)}|${zero(spec.blindReduce)}`
  if (wormholeDerivedMemo !== null && wormholeDerivedMemo.key === memoKey) return wormholeDerivedMemo.card
  const derived = wormholeAnomalyOf(baseCard, spec.depth, spec.kind, spec.waves, {
    // **本层本档的"血尺度"**（单船威胁曲线 × **洞内强度系数**——4 舰对 4 舰口径 × **谜质威胁乘数**）；
    // 新口径下它经平方化成"威胁预算 T"，再由卡的自然比拆成血与火力（见 `wormholeAnomalyOf`）。
    // ⚠ 威胁取 `wormholeCardThreatOf`（= 层威胁 × 本卡补偿；挂了「支援呼叫装置」的卡有 ×1.1）
    // ——与 `wormholeAnomalyOf` 写进派生卡的 `threat` **同一个数** ⇒ 标尺与预算同源。
    hpBudget:
      foeHpOfThreat(wormholeCardThreatOf(baseCard, spec.depth, spec.kind), ctx.balance.battle) *
      WORMHOLE_FOE_BASE_STRENGTH_MUL *
      threatMul,
    tierThreatMul,
    naturalDps,
    ...(spec.strengthMul !== undefined ? { strengthMul: spec.strengthMul } : {}),
  })
  /**
   * **谜质 B1：敌方削弱折进派生卡**（这样**所有** `createFoeSpecs` 调用点自动生效——
   * 开战、逐拍重建、下一波补刷、战场视图都读同一张派生卡，不必各处再补一次）：
   * `foeHitRate` 直接减（命中率是**概率**，按绝对值减、下限 0）；`blindDmgMul` 同样按绝对值减。
   */
  const foeHitDown = spec.foeHitDown ?? 0
  const blindReduce = spec.blindReduce ?? 0
  const card: AnomalyDef =
    foeHitDown > 0 || blindReduce > 0
      ? {
          ...derived,
          ...(foeHitDown > 0 ? { foeHitRate: Math.max(0, (derived.foeHitRate ?? ctx.balance.battle.foeHitRate) - foeHitDown) } : {}),
          ...(blindReduce > 0 ? { blindDmgMul: Math.max(0, (derived.blindDmgMul ?? 0.3) - blindReduce) } : {}),
        }
      : derived
  wormholeDerivedMemo = { key: memoKey, card }
  return card
}
