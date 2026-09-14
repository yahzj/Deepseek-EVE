/**
 * **终局玩法「虫洞」· 层曲线与洞内敌卡派生**（F 批 · 2026-09-13）。
 *
 * 拆成独立模块的原因：本文件被**引擎（`combat.ts` 的 `advanceBattleFor`）**与**副本状态机
 * （`wormhole.ts`）**同时需要，而 `combat.ts` 不能反向依赖 `wormhole.ts`（状态机里有大量副本语义）。
 * 依赖方向固定为：`wormholeFoes.ts`（纯函数，只吃类型） ← `wormhole.ts` / `combat.ts`。
 *
 * 口径：设计稿 `docs/design/wormhole-extraction-endgame-20260912.md`
 * §3（节点/层末 BOSS 表）· §4（威胁与收益曲线）· §九 Q11（收益涨得比难度快）。
 */
import type { AnomalyDef, FoeShipSlot } from './types'
import type { WormholeFamily } from './state'

/* ═══════════ 一、层曲线（威胁 / 收益） ═══════════ */

/** 第 1 层基准威胁 */
export const WORMHOLE_THREAT_BASE = 45
/** 每层**威胁**增幅（等比 ×1.16 ⇒ 层 1~3 = 45/52/61，与设计稿"≈45~60"同量级） */
export const WORMHOLE_THREAT_GROWTH = 0.16
/** 每层**收益**增幅（等比 ×1.2）。**必须大于威胁增幅** —— 船长 2026-09-13：
 *  「深层收益应该比难度曲线要更高」⇒ 用等比而非加法，才能让"单位威胁收益"**逐层严格上升**
 *  （若威胁用 +9 加法，层 1→2 的威胁增幅恰好 20%、与收益打平，头两层看不出"更赚"）。 */
export const WORMHOLE_REWARD_GROWTH = 0.2
/** 兼容取整：每层威胁的**名义**增量（= 45×0.16 ≈ 7，落在设计稿"+8~10"附近，供文档/读数引用） */
export const WORMHOLE_THREAT_PER_LAYER = Math.round(WORMHOLE_THREAT_BASE * WORMHOLE_THREAT_GROWTH)

/** 第 `depth` 层的威胁（层 1 = 45，每层 ×1.16，取整） */
export function wormholeLayerThreat(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.round(WORMHOLE_THREAT_BASE * Math.pow(1 + WORMHOLE_THREAT_GROWTH, d - 1))
}

/** 第 `depth` 层的收益系数（层 1 = 1.0，每层 ×1.2）——**涨得比威胁快** */
export function wormholeLayerRewardMul(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.pow(1 + WORMHOLE_REWARD_GROWTH, d - 1)
}

/** 每层节点数（船长定：2~3 个；层 1~2 取 2、层 3 起取 3——越深越长，与收益曲线同向） */
export function wormholeNodesPerLayer(depth: number): number {
  return Math.max(1, Math.floor(depth)) <= 2 ? 2 : 3
}

/* ═══════════ 二、洞内敌卡派生（按层换算威胁） ═══════════ */

/** 洞内敌卡的用途：普通节点 / 层末 BOSS / 撤离战 / **遗迹收尾战**（威胁倍率与选靶模式按此分流） */
export type WormholeFoeKind = 'node' | 'boss' | 'extract' | 'ruins'

/** 层末 **BOSS** 的威胁倍率（设计稿 §3 表：本层 ×1.2） */
export const WORMHOLE_BOSS_THREAT_MUL = 1.2
/** **撤离战**的威胁倍率（设计稿 §3 表：当层威胁 ×0.8）——**只用于层 2 的基准**，见下 */
export const WORMHOLE_EXTRACT_THREAT_MUL = 0.8

/**
 * **撤离战威胁 = 线性**（船长 2026-09-13 裁定：「**撤离威胁按线性**」，回应"线性还是等比"那一问）。
 *
 * 口径：**层 2 = 42**（= 层 2 威胁 52 × 0.8，与改判前的层 2 读数一致），之后**每层 +7**
 * （7 = 层增量的名义值 `WORMHOLE_THREAT_PER_LAYER`）——即"与前进的层数成正比"。
 * 层 1 没有拦截舰队（`WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH = 2`），本函数对层 1 也按层 2 取值，
 * 免得别处误用出负数。
 *
 * 为什么不像节点战那样等比（×1.16/层）：撤离战是"拿了就跑"的拦截，等比到深处会指数翻上去
 * （层 8 等比 102 / 线性 84、层 12 等比 158 / 线性 112）——**节点战照旧等比**（那才是"越深越硬"），
 * 只有撤离这一路改成线性。
 */
export const WORMHOLE_EXTRACT_THREAT_BASE = Math.round(
  WORMHOLE_THREAT_BASE * (1 + WORMHOLE_THREAT_GROWTH) * WORMHOLE_EXTRACT_THREAT_MUL, // 层 2 = 52 × 0.8 = 42
)
/** 撤离战**每层增量**（线性；= 层增量名义值 7） */
export const WORMHOLE_EXTRACT_THREAT_PER_LAYER = WORMHOLE_THREAT_PER_LAYER

/** 第 `depth` 层**撤离战**的威胁（线性：层 2 = 42、层 3 = 49、层 4 = 56……层 8 = 84） */
export function wormholeExtractThreat(depth: number): number {
  const d = Math.max(2, Math.floor(depth))
  return WORMHOLE_EXTRACT_THREAT_BASE + WORMHOLE_EXTRACT_THREAT_PER_LAYER * (d - 2)
}

/** **遗迹收尾战**的威胁倍率（船长：「打捞结束时，大概率会触发一场**高难度**战斗」⇒ 比普通地点战高一档） */
export const WORMHOLE_RUINS_THREAT_MUL = 1.3

/**
 * **洞内敌卡的基准强度系数**（F 批校准旋钮 · 2026-09-13）。
 *
 * 含义 = 洞内敌卡的**总血预算**相对"单船威胁曲线"（`foeHpOfThreat(威胁)`）的放大倍数。
 * 为什么需要它：那条曲线是**单船**口径（一张悬赏卡对一艘玩家船），而洞内是 **4 舰对 4 舰**
 * ⇒ 直接用曲线值会让敌人被四倍火力瞬间抹掉（F1 校准实测：第 1~12 层 100% 胜、残血 100%）。
 * 数值由 `tools/wormhole-econ.ts` 按船长 2026-09-13 给的难度基准反推：
 * **参考编队 4×巡洋 MK2 —— 第 1 层轻松打过（允许战损）· 第 2 层战损加重 · 再深有概率损失船**；
 * 改动后必须重跑该工具并把读数写进设计稿。
 */
export const WORMHOLE_FOE_BASE_STRENGTH_MUL = 10

/** 某张敌卡的**自然总血**（按编成条目的舰级绝对值 × 条数，不含派生缩放） */
export function wormholeNaturalHp(base: AnomalyDef): number {
  return (base.ships ?? []).reduce(
    (n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
    0,
  )
}

/**
 * 本层本次交战的**威胁**（普通节点 = 层威胁；BOSS ×1.2；**撤离战 = 线性曲线**；遗迹收尾战 ×1.3）
 */
export function wormholeFoeThreat(depth: number, kind: WormholeFoeKind): number {
  const base = wormholeLayerThreat(depth)
  if (kind === 'boss') return Math.round(base * WORMHOLE_BOSS_THREAT_MUL)
  if (kind === 'extract') return wormholeExtractThreat(depth)
  if (kind === 'ruins') return Math.round(base * WORMHOLE_RUINS_THREAT_MUL)
  return base
}

/**
 * 洞内敌卡的**轮换顺序**（与 `packages/data/src/wormholeFoes.ts` 的卡表同序）。
 * ⚠ 两处必须一致：`content:check` 有契约钉住（少一张/改名就报错）。
 *
 * 2026-09-13 补第五张 **E 族「巨构残响」**（船长：「虫洞专属掉落按种族库走，蓝图也是按种族库。
 * 你顺便补上空缺的种族。」）⇒ 五族各有一张洞内卡，按族掉落池才"每族都有来源"。
 */
export const WORMHOLE_FOE_CARD_IDS: readonly string[] = [
  'wh-pirate-scout',
  'wh-alien-swarm',
  'wh-grave-watch',
  'wh-exile-blockade',
  'wh-titan-echo',
]

/** 本节点用哪张敌卡（**确定性**：同 `(depth, nodeIndex)` ⇒ 同卡，四族轮换） */
export function wormholeCardIdFor(depth: number, nodeIndex: number): string {
  const d = Math.max(1, Math.floor(depth))
  const i = Math.max(0, Math.floor(nodeIndex))
  const h = Math.abs((d * 31 + i * 7) % WORMHOLE_FOE_CARD_IDS.length)
  return WORMHOLE_FOE_CARD_IDS[h]!
}

/* ═══════════ 敌族锁定（丁 · 船长 2026-09-14 定案） ═══════════ */

/** **族 → 洞内敌卡**（1:1；族字母沿用敌卡数据里的 `foeFamily`） */
export const WORMHOLE_FAMILY_CARD: Readonly<Record<WormholeFamily, string>> = {
  A: 'wh-pirate-scout',
  C: 'wh-alien-swarm',
  D: 'wh-grave-watch',
  E: 'wh-titan-echo',
  G: 'wh-exile-blockade',
}

/** 族徽色调（界面用；与 `Glyphs.tsx` 的 `fam-*` 徽记同键） */
export const WORMHOLE_FAMILY_GLYPH: Readonly<Record<WormholeFamily, string>> = {
  A: 'fam-a',
  C: 'fam-c',
  D: 'fam-d',
  E: 'fam-e',
  G: 'fam-g',
}

/** 五族（抽取顺序；等概率） */
export const WORMHOLE_FAMILY_ORDER: readonly WormholeFamily[] = ['A', 'C', 'D', 'E', 'G']

/**
 * **一处虫洞锁定的敌族**（确定性：同 `seed` 必得同族，**等概率**五分之一）。
 * 老档/调试入口没有该字段 ⇒ 现算，永远一致、不重掷。
 */
export function wormholeFamilyOfSeed(seed: number): WormholeFamily {
  const s = Math.abs(Math.floor(seed)) % 1_000_000_007
  const h = Math.abs((s * 1103515245 + 12345) % WORMHOLE_FAMILY_ORDER.length)
  return WORMHOLE_FAMILY_ORDER[h]!
}

/** **本趟/本处的敌卡**（族锁定后整趟一张卡；`family` 缺省 ⇒ 按种子现算；两者都缺 ⇒ 按 1 兜底） */
export function wormholeCardIdOfFamily(family: WormholeFamily | undefined, seed: number | undefined): string {
  return WORMHOLE_FAMILY_CARD[family ?? wormholeFamilyOfSeed(seed ?? 1)]
}

/**
 * **把洞内敌卡按层派生**（不改数据文件，与窝点派生 `lairAnomalyOf` 同款做法）：
 * - 威胁：`wormholeFoeThreat(depth, kind)`；
 * - 舰级路径的**绝对值缩放**：按「锚点威胁 → 目标威胁」的比例同乘每个条目的 `hpMul` / `dmgMul`
 *   （保住"威胁 = 战力标尺"；单发/射程/编成/战术一律不动）；
 * - **波数**：节点的 `waves` 表达"同一编成分 N 波进场" ⇒ 血与火力各摊 `1/N`、按 `slot.wave` 分波
 *   （总战力守恒，与设计稿 §3 表"同一威胁带里分几波"一致）；
 * - **选靶模式**（船长 2026-09-13 定）：普通节点 = 卡上标的那个；**BOSS 一律「打最大的」**；
 *   撤离战沿用卡口径。
 * 旧路径卡（没写 `ships`）不缩放条目，只改 `threat`（曲线自己会算血与火力）。
 */
export function wormholeAnomalyOf(
  base: AnomalyDef,
  depth: number,
  kind: WormholeFoeKind,
  waves: number,
  /**
   * - `hpBudget`：**本场敌卡的期望总血**（由引擎按威胁曲线 × `WORMHOLE_FOE_BASE_STRENGTH_MUL` 算好传进来；
   *   不给 = 用本卡的"自然总血" ⇒ 只做威胁字段的换算，不缩放条目）。
   * - `strengthMul`：**校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   */
  opts?: { hpBudget?: number; strengthMul?: number },
): AnomalyDef {
  const target = wormholeFoeThreat(depth, kind)
  const natural = Math.max(1, wormholeNaturalHp(base))
  const budget = (opts?.hpBudget ?? natural) * (opts?.strengthMul ?? 1)
  // **按卡归一**：把每张卡的总血**压到同一个预算**上（各卡的"坦克/脆皮"性格由原编成的血比保留），
  // 同时**同比例**缩放火力 ⇒ 卡间强度不再悬殊（"威胁 = 战力标尺"由构造保证）。
  const scale = budget / natural
  const nWaves = Math.max(1, Math.floor(waves))
  const per = 1 / nWaves
  const slots = base.ships ?? []
  const ships: readonly FoeShipSlot[] | undefined =
    slots.length === 0
      ? base.ships
      : slots.flatMap((slot) =>
          Array.from({ length: nWaves }, (_, i) => ({
            ...slot,
            wave: i,
            hpMul: (slot.hpMul ?? 1) * scale * per,
            dmgMul: (slot.dmgMul ?? 1) * scale * per,
            ...(slot.firepowerAnchor !== undefined
              ? { firepowerAnchor: Math.max(1, Math.round(slot.firepowerAnchor * scale * per)) }
              : {}),
          })),
        )
  /** 每波单位数（`waves[]` 只驱动"打几波"，编成由 `slot.wave` 决定；这里给出与实际一致的读数） */
  const perWaveUnits = (ships ?? []).length
    ? Array.from({ length: nWaves }, (_, i) =>
        (ships ?? [])
          .filter((s) => (s.wave ?? 0) === i)
          .reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0),
      )
    : []
  return {
    ...base,
    name:
      kind === 'boss'
        ? `${base.name} · 第 ${depth} 层守卫`
        : kind === 'extract'
          ? `${base.name} · 撤离拦截`
          : `${base.name} · 第 ${depth} 层`,
    threat: target,
    ...(perWaveUnits.length > 0
      ? {
          ships,
          waves: perWaveUnits.map((units) => ({ units: Math.max(1, units), hpShare: 1 })),
        }
      : {}),
    // 层末 BOSS 专挑最大的船（船长 2026-09-13 的五模式里，「打最大的」落在 BOSS 上）
    foeTargeting: kind === 'boss' ? 'largest' : (base.foeTargeting ?? 'random'),
  }
}
