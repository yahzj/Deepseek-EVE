/**
 * **战报与四档判定**（2026-10-02 从 `combat.ts` 拆出 · 批次 4b · 零行为变化）。
 *
 * 本文件 = 战斗的**统计与图鉴层**：胜率扩散、四档判定、结构化战报唯一构造点、沉船判据单点。
 * 全部**纯 state 读数/写账**（依赖 `combatMath.clamp` 与 `state` 的类型，无战斗引擎内部件）。
 * `combat.ts` 原样再导出（先例：fitted.ts），wormholeBattle / encounters / UI / 用例引用零改动。
 */
import { clamp } from './combatMath'
import type { BattleBreakReason, BattleReportRecord, BattleReportSource, GameState } from './state'

/**
 * 预估胜率扩散（logit 空间线性拉伸，k>1）：
 * - 0.5 为不动点（五五开不变）；
 * - 越高的胜率加成越大（如 0.80 → ~0.90），保证"高胜率=高置信"，玩家不会在显示高胜率时
 *   因模型边缘误差而意外翻车；
 * - 越低的胜率惩罚越重（如 0.20 → ~0.10），杜绝"摸奖"式硬闯高难敌人。
 * 只作用于预估展示与 AI 接单门槛；实际战斗按实时引擎结算（随机性不受影响）。
 */
export function spreadWinChance(p: number, k: number): number {
  const t = clamp(0.001, 0.999, p)
  if (k <= 1) return clamp(0.02, 0.98, t)
  const logit = Math.log(t / (1 - t))
  const s = 1 / (1 + Math.exp(-k * logit))
  return clamp(0.02, 0.98, s)
}

/**
 * **四档判定**（2026-09-14 船长定 · 战报改造）。
 *
 * | 情形 | 判定 |
 * |---|---|
 * | 我方全灭 / 结构归零判负（含弃船） | `defeat` → 界面写「⚠ 失利」 |
 * | 未分胜负就中止（结构撤退 / 打满上限超时 / 无法交战 / 主动撤退） | `break` → 「⚠ 脱离」 |
 * | 胜 + **零沉船 且 机群无净损失** | `great` → 「⚔ 大捷」 |
 * | 胜 + **有沉船 或 机群有净损失** | `pyrrhic` → 「⚔ 惨胜」 |
 *
 * 做成**纯函数**是刻意的：渲染层没有测试运行器（`npm test` 只管 core），而这个判定正是船长
 * 报障的那个点（"损失了舰船也显示大捷"）⇒ 只有放进 core 才拦得住。
 */
export type BattleVerdict = 'great' | 'pyrrhic' | 'defeat' | 'break'

export function battleVerdictOf(r: Pick<BattleReportRecord, 'outcome' | 'shipsLost' | 'dronesGone'>): BattleVerdict {
  if (r.outcome === 'break') return 'break'
  if (r.outcome === 'lose') return 'defeat'
  return r.shipsLost.length > 0 || r.dronesGone > 0 ? 'pyrrhic' : 'great'
}

/**
 * **写一份结构化战报**（2026-09-14 船长定 · 战报改造）——**全仓唯一构造点**。
 *
 * 四个结算点各调一次（悬赏远征胜/败/中止 · 低安遭遇胜/败 · 虫洞胜/负 · AI 副船胜/败），
 * 好处是"派生口径只有一份"：沉船名单、逐舰三层残余、敌方残余、弹药消耗都从 `battle` 现算，
 * 各结算点只负责给 `source` / `outcome` / `breakReason` 与**它自己写的那句日志原文**（`summary`）。
 *
 * 口径要点：
 * - `shipsLost`：**调用方给了就用它**（洞内那边已有船长口径的显示名，含自定义船名），否则从
 *   `battle.units` 里按"我方且三层血合计 ≤ 0"推导（与 `wormholeBattle.sunkShipIds` 同一判据）；
 * - `myUnits`：单船路径 = 只有 `player`；多舰路径 = `myFleet` 顺序（主控在前）；
 * - `foe`：`total` = 本场**参战过**的敌单位数（多波战斗含后续波已刷出的），`alive` = 其中三层血
 *   合计 > 0 的，`hpFrac` = Σ当前 ÷ Σ上限；
 * - `ammoUsed` = 开战预载 − 战后余额（`ammoLoaded` 四条路径都在写 ⇒ 四类战斗都算得出）；
 * - `dronesGone`：从 `state.droneLossReport` 读**净损失**（按时刻配对；AI 副船不写它 ⇒ 0）。
 */
export function captureBattleReport(
  state: GameState,
  battle: import('./state').BattleState,
  opts: {
    source: BattleReportSource
    outcome: 'win' | 'lose' | 'break'
    breakReason?: BattleBreakReason
    /** 本场引擎写的那条日志原文（弹层正文用它 ⇒ 卡片与日志同源） */
    summary: string
    /** 甲案：战报正文的文案 id + 参数（含后续段的 `p{n}Id` 绑定；有 ⇒ 弹层按语言渲染） */
    summaryId?: string
    summaryParams?: Readonly<Record<string, string | number>>
    /** 覆盖"我方沉船名单"（洞内传船长口径的显示名；缺省 = 从 battle.units 推导） */
    shipsLost?: readonly string[]
  },
): BattleReportRecord {
  const entries = battle.myFleet && battle.myFleet.length > 0 ? battle.myFleet : [{ tag: 'player' }]
  const myUnits: BattleReportRecord['myUnits'] = []
  const derivedLost: string[] = []
  for (const e of entries) {
    const u = battle.units[e.tag]
    if (!u) continue
    const max = u.hpMax ?? u.hp
    myUnits.push({ name: u.name, s: u.hp.s, a: u.hp.a, h: u.hp.h, sMax: max.s, aMax: max.a, hMax: max.h })
    if (u.hp.s + u.hp.a + u.hp.h <= 0) derivedLost.push(u.name)
  }
  let foeTotal = 0
  let foeAlive = 0
  let foeCur = 0
  let foeMax = 0
  for (const u of Object.values(battle.units)) {
    if (u.side !== 'foe') continue
    foeTotal += 1
    const cur = u.hp.s + u.hp.a + u.hp.h
    const max = u.hpMax ?? u.hp
    foeCur += cur
    foeMax += max.s + max.a + max.h
    if (cur > 0) foeAlive += 1
  }
  const loaded = battle.ammoLoaded
  const ammoUsed = loaded
    ? {
        kin: Math.max(0, Math.round(loaded.kin - battle.ammo.kin)),
        exp: Math.max(0, Math.round(loaded.exp - battle.ammo.exp)),
        pla: Math.max(0, Math.round(loaded.pla - battle.ammo.pla)),
      }
    : { kin: 0, exp: 0, pla: 0 }
  const dr = state.droneLossReport
  const dronesGone = dr && dr.battleStartedAtGameMs === battle.startedAtGameMs ? Math.max(0, dr.gone) : 0
  const shipsLost = [...new Set((opts.shipsLost ?? derivedLost).filter((n) => n.length > 0))]
  const rec: BattleReportRecord = {
    battleStartedAtGameMs: battle.startedAtGameMs,
    source: opts.source,
    outcome: opts.outcome,
    ...(opts.breakReason !== undefined ? { breakReason: opts.breakReason } : {}),
    durMs: Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs),
    stats: { ...battle.stats },
    shipsLost,
    myUnits,
    foe: { alive: foeAlive, total: foeTotal, hpFrac: foeMax > 0 ? Math.max(0, Math.min(1, foeCur / foeMax)) : 0 },
    // **敌方挂载件名**（2026-09-16 船长：战报也要展示）——由 `seedUnit` 累积（含多波/增援）
    ...(battle.foeMounts && battle.foeMounts.length > 0 ? { foeMounts: [...battle.foeMounts] } : {}),
    // 同序双语名对（2026-09-24）：战报按当前语言挑一列；缺省 ⇒ 回落中文名数组
    ...(battle.foeMountNamePairs && battle.foeMountNamePairs.length > 0
      ? { foeMountNamePairs: [...battle.foeMountNamePairs] }
      : {}),
    ammoUsed,
    dronesGone,
    summary: opts.summary,
    ...(opts.summaryId !== undefined ? { summaryId: opts.summaryId } : {}),
    ...(opts.summaryParams !== undefined ? { summaryParams: opts.summaryParams } : {}),
  }
  state.battleReport = rec
  return rec
}

/**
 * **本场被打沉的我方舰 id 列表**（判据 = 该单位三层血 `s + a + h ≤ 0`）——**唯一判据**。
 *
 * 为什么抽成单点：这条判据原先有**两份**（`wormholeBattle.sunkShipIds` 与 `captureBattleReport`
 * 里的推导），而 `captureBattleReport` 的注释早就写着"与 `wormholeBattle.sunkShipIds` 同一判据"。
 * **2026-09-28 玩家报障「旗舰战里沉船、撤退后沉船被复活带出还能修理」** 正是**第三处（遭遇战）
 * 漏了这条判据**：承伤照常落盘（`persistFleetHullDamage` 如实写出 `durability = 0`），
 * 但没有任何一方按"沉船"处理 ⇒ 船以 0% 结构被带回港、维修即可复原。
 * ⇒ 三处（虫洞 / 遭遇战 / 战报）共用本函数，别再各写一份。
 *
 * ⚠ 多舰场次（编队战）走 `battle.myFleet`（tag → shipId）；**单船场次没有 `myFleet`**
 * ⇒ 回落到 `units['player']`，由调用方传它那艘船的 id（与 `persistFleetHullDamage` 同形）。
 */
export function sunkShipIdsOfBattle(
  battle: import('./state').BattleState | null,
  fallbackShipId?: string,
): string[] {
  const out: string[] = []
  const dead = (hp: { s: number; a: number; h: number } | undefined): boolean =>
    hp !== undefined && hp.s + hp.a + hp.h <= 0
  const fleet = battle?.myFleet ?? []
  if (fleet.length > 0) {
    for (const entry of fleet) {
      if (dead(battle?.units[entry.tag]?.hp)) out.push(entry.shipId)
    }
    return out
  }
  if (fallbackShipId !== undefined && fallbackShipId.length > 0 && dead(battle?.units['player']?.hp)) {
    out.push(fallbackShipId)
  }
  return out
}
