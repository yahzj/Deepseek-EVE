/** 功能域职责拆分，保持原计算与顺序。 */
import type { BattleState, GameState } from '../../state'
import type { WormholeRunState } from '../../wormhole'
import type { WormholeFoeKind } from '../../wormholeFoes'
import type { SimContext, AnomalyDef } from '../../types'
import { repairUsageText, wormholeDerivedAnomaly } from '../../combat'
import { weekendFlagshipEncounterOf } from '../../weekendBattle'

/** 本场战斗的**编队残血比例**（我方三层血合计 ÷ 满值合计；用于战报与结算读数） */
export function fleetHpFrac(battle: BattleState): number {
  let cur = 0
  let max = 0
  for (const entry of battle.myFleet ?? []) {
    const u = battle.units[entry.tag]
    if (!u) continue
    cur += u.hp.s + u.hp.a + u.hp.h
    max += (u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0)
  }
  return max > 0 ? cur / max : 0
}

/**
 * **洞内战报**（一句话，与结算同源）：交火时长 / 双方开火与命中 / 编队残血。
 * 只在洞内推（远征有自己的战报链），纯日志、不影响任何数值。
 */
export function wormholeBattleReport(
  run: WormholeRunState,
  battle: BattleState,
  kind: WormholeFoeKind,
  ctx: SimContext,
): { text: string; textId: string; textParams: Record<string, string | number> } {
  const sec = Math.max(0, Math.round((battle.lastTickGameMs - battle.startedAtGameMs) / 1000))
  const s = battle.stats
  const frac = Math.round(fleetHpFrac(battle) * 100)
  // 对手称呼（「第 N 层守卫」等）自带中文词 + 数字 ⇒ 两步渲染：给它一个 id，外层拿译文当参数
  const what = kind === 'boss'
    ? `第 ${run.depth} 层守卫`
    : kind === 'extract'
      ? // ⚠ 仅老档（撤离战 2026-09-15 退役）：文案避开已退役的机制名「撤离战」，写「撤离」
        '撤离'
      : kind === 'ruins'
        ? `第 ${run.depth} 层遗迹守军`
        : run.grid
          ? `第 ${run.depth} 层地点`
          : `第 ${run.depth} 层节点`
  const whatId =
    kind === 'boss'
      ? 'core.wormholeBattle.024'
      : kind === 'extract'
        ? 'core.wormholeBattle.025'
        : kind === 'ruins'
          ? 'core.wormholeBattle.026'
          : run.grid
            ? 'core.wormholeBattle.027'
            : 'core.wormholeBattle.028'
  // 尾巴（与远征/遭遇同款口径）：船体维修装置消耗——洞内同样吃这套后勤，不写就等于白用
  // ⚠「船体维修装置 + 消耗清单」是 `repairUsageText` 的派生串（自建中文），按既定边界留在中文
  const repair = repairUsageText(battle, ctx)
  const tail = repair.length > 0 ? ` · 船体维修装置${repair}` : ''
  const text =
    `🕳 ${what}交火结束：${sec}s · 我方开火 ${s.meShots}/命中 ${s.meHits} · 敌方开火 ${s.foeShots}/命中 ${s.foeHits} · ` +
    `编队残血 ${frac}%${tail}。`
  return {
    text,
    // 尾段（维修消耗）可空 ⇒ 空段不入链：有尾巴时句号另起一段，没尾巴时用"带句号"的基础模板
    textId: tail === '' ? 'core.wormholeBattle.029' : 'core.wormholeBattle.030',
    textParams:
      tail === ''
        ? { p1: what, p1Id: whatId, p1p1: run.depth, p2: sec, p3: s.meShots, p4: s.meHits, p5: s.foeShots, p6: s.foeHits, p7: frac }
        : {
            p1: what,
            p1Id: whatId,
            p1p1: run.depth,
            p2: sec,
            p3: s.meShots,
            p4: s.meHits,
            p5: s.foeShots,
            p6: s.foeHits,
            p7: frac,
            p8: repair,
            /**
             * ⚠ **槽内参数 `p8p1` 必须一起喂**（**2026-09-29 实障修正**）：
             * `core.wormholeBattle.031` 就是 `{p1}`，渲染层按 `p8p1` 取它 ——
             * 只给 `p8Id` 会让那一槽原样漏出 `{p1}`（战报尾巴变成「船体维修装置{p1}」）。
             * 同款范式：`events.ts` 的 `p2p1`、`market.ts` 的 `p4p1`。
             */
            p8p1: repair,
            p8Id: 'core.wormholeBattle.031',
            p9: '。',
            p9Id: 'core.state.042',
          },
  }
}

/**
 * **本场战斗的敌卡**（2026-09-14 修船长报障「虫洞内的战斗，敌方舰船动画不对 / **敌方的战斗动画图形
 * 和敌族对不上** / 战斗开始位置似乎不对」）——视图侧取敌卡的**唯一点**：
 * - 洞内交火 = `run.battle` 的**按层派生卡**（`wormholeDerivedAnomaly`，与推进/射程弧/血条同一张）；
 * - 洞外 = 远征/窝点卡（`expedition.anomalyId`，**逐字保持旧口径**）。
 *
 * 为什么必须由 core 出这一个点：洞内战斗的宿主是 `run.battle`（**不占** `expedition.battle`、敌卡也不落
 * 在 `expedition.anomalyId`）⇒ 界面凡"只认远征"的读法在洞里会**静默取到 `undefined`**，而照样渲染：
 * 敌舰族形落到兜底族（A 海盗 ⇒ 洞里 C/D/E/G 族全画成海盗舰体与动画）、舰种体积回落 170/90，
 * 而体积又喂给 `layout()` 的机位/米制跨度 ⇒ 动画、图形、开局机位一起错。界面一律读本函数，
 * **不许再各自猜宿主**（`content:check`「战斗宿主双口径契约」会扫 BattleScreen 的直读）。
 */
export function battleFoeAnomaly(state: GameState, ctx: SimContext): AnomalyDef | undefined {
  const whBattle = state.wormhole.run?.battle
  if (whBattle?.wormhole) {
    const base = ctx.anomalies.get(whBattle.wormhole.cardId)
    if (base) return wormholeDerivedAnomaly(ctx, base, whBattle.wormhole)
  }
  /**
   * **第三个宿主：入侵旗舰战**（2026-09-25 加；船长报障「旗舰战无法进入战斗画面」）——
   * 它同样**不占** `expedition` 槽（承载在遭遇槽 `state.encounter.battle`，且是编队战）⇒
   * 只认远征的读法在它眼里恒为 `undefined`（族形/舰种体积/机位一起错，与洞内那次的病根一模一样）。
   * 敌卡 = 该族旗舰卡（遭遇槽里的 `anomalyId` 本就是它，直接取即可）。
   */
  if (weekendFlagshipEncounterOf(state, state.encounter) && state.encounter.battle) {
    const card = state.encounter.anomalyId !== null ? ctx.anomalies.get(state.encounter.anomalyId) : undefined
    if (card) return card
  }
  return state.expedition.anomalyId ? ctx.anomalies.get(state.expedition.anomalyId) : undefined
}

/**
 * **洞内战斗的视图上下文**（F2 · 2026-09-13）：战斗窗口拿它渲染洞内战斗
 * （战斗宿主在 `run.battle`、敌卡按层派生、我方编队逐舰）。
 * 无洞内战斗返回 `null`（界面照旧走远征口径）。
 */
export function wormholeBattleViewOf(
  state: GameState,
  ctx: SimContext,
): {
  battle: BattleState
  anomaly: AnomalyDef
  /** 视图锚 = 主控（`myFleet` 首条的船型 uid；缺省退 `state.shipId`） */
  leaderShipId: string
  /** 顶部标题用：`虫洞 · 第 N 层` / `虫洞 · 第 N 层守卫` / `虫洞 · 撤离战` */
  name: string
  /** 与 `expeditionStatus().combat` 同形（战斗窗口两套来源共用一套渲染） */
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    lockTag: string | null
  } | null
} | null {
  const run = state.wormhole.run
  const battle = run?.battle
  if (!run || !battle) return null
  const spec = battle.wormhole
  const base = spec ? ctx.anomalies.get(spec.cardId) : undefined
  if (!spec || !base) return null
  // 走**引擎同源**那一处（wormholeDerivedAnomaly）：既保证视图与推进同口径，也吃到它的一层记忆
  //（本函数每次重渲染都会被调一次；拖动距离条时高频重渲染 ⇒ 重建整张敌卡会顶出顿挫）
  const anomaly = wormholeDerivedAnomaly(ctx, base, spec)
  const leaderShipId = battle.myFleet?.[0]?.shipId ?? state.shipId
  const leaderRt = battle.units[battle.myFleet?.[0]?.tag ?? 'player']
  const foeHp: Record<string, { s: number; a: number; h: number; name: string }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    /**
     * ⚠ **阵亡的敌舰也要留在 `foeHp` 里**（**同一处缺陷两人先后各修了一次**，两条记录都留着：
     * 船长 2026-09-13 报障「战斗中，敌方没有爆炸动画」→ 一号修；船长同日裁定「**②和洞外一致**」→ 二号修）。
     *
     * **成因（口径层）**：战斗界面判定"这一拍刚被击毁"的口径是——**迭代 `foeHp` 的键**、看某个 tag
     * 的血量总和从 >0 掉到 0（`BattleScreen` 的 `foeTags = Object.keys(combat.foeHp)` → `prevHpRef`）。
     * 洞外那条（`expeditionStatus`）**只按 `side` 收**（阵亡者照样给、血量 0），这里原先把"血量已归零"
     * 的敌舰**过滤掉了** ⇒ tag 从 `foeHp` 里消失、迭代根本走不到它 ⇒ **爆炸演出永远不触发**
     * （所以只有洞内没爆炸；实测：节点战 2 次击杀、界面 0 次出现过 0 血单位）。
     * **修法**：**按 `side` 收，不按血量收**（血量归零的条目照样给出去，界面自己会用 `deadRef`
     * 把尸骸登记成"演出中"）——与洞外同口径。
     */
    if (u.side !== 'foe') continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  const kindLabel =
    spec.kind === 'boss'
      ? '层末守卫'
      : spec.kind === 'extract'
        ? // ⚠ 仅老档（撤离战 2026-09-15 退役）：标题避开已退役的机制名
          '撤离'
        : spec.kind === 'ruins'
          ? `第 ${spec.depth} 层遗迹守军`
          : `第 ${spec.depth} 层`
  return {
    battle,
    anomaly,
    leaderShipId,
    name: `虫洞 · ${kindLabel}`,
    // ⚠ **`ended` 之后仍要给 `combat`**：与远征同款——分胜负那一刻要留"击杀慢镜/战报演出"窗口，
    // 提前返回 null 会让战斗界面**直接卸载**（首版实测：战斗一结束画面就没了、战报没机会播）。
    combat: {
      distanceM: battle.distanceM,
      myDesireM: battle.myDesireM,
      meHp: leaderRt ? { ...leaderRt.hp } : { s: 0, a: 0, h: 0 },
      foeHp,
      shots: battle.stats.meShots,
      hits: battle.stats.meHits,
      // 锁定装置的集火目标：洞内沿用同一读法（主控装了锁定件才非空）
      lockTag: null,
    },
  }
}
