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

/** 洞内敌卡的用途：普通节点 / 层末 BOSS / 撤离战（威胁倍率与选靶模式按此分流） */
export type WormholeFoeKind = 'node' | 'boss' | 'extract'

/** 层末 **BOSS** 的威胁倍率（设计稿 §3 表：本层 ×1.2） */
export const WORMHOLE_BOSS_THREAT_MUL = 1.2
/** **撤离战**的威胁倍率（设计稿 §3 表：当层威胁 ×0.8） */
export const WORMHOLE_EXTRACT_THREAT_MUL = 0.8

/**
 * **洞内敌卡的基准强度系数**（F 批校准旋钮 · 2026-09-13）。
 *
 * 为什么需要它：四张洞内敌卡的编成取"舰级自然值"，而**自然值相对设计稿 §4.4 的 4×T3 满配编队太软**
 * ——校准工具（`tools/wormhole-econ.ts`）首跑实测：第 1~12 层**全部 100% 胜率、残血 100%**，
 * 与"搜打撤"要的风险张力不符。故用一个**全局系数**把四张卡的血量与火力一起抬起来
 * （单卡个性另调）；数值由该工具的逐层读数反推，改动后必须重跑该工具并把读数写进设计稿。
 */
export const WORMHOLE_FOE_BASE_STRENGTH_MUL = 5

/** 本层本次交战的**威胁**（普通节点 = 层威胁；BOSS ×1.2；撤离战 ×0.8） */
export function wormholeFoeThreat(depth: number, kind: WormholeFoeKind): number {
  const base = wormholeLayerThreat(depth)
  if (kind === 'boss') return Math.round(base * WORMHOLE_BOSS_THREAT_MUL)
  if (kind === 'extract') return Math.round(base * WORMHOLE_EXTRACT_THREAT_MUL)
  return base
}

/**
 * 洞内敌卡的**轮换顺序**（与 `packages/data/src/wormholeFoes.ts` 的卡表同序）。
 * ⚠ 两处必须一致：`content:check` 有契约钉住（少一张/改名就报错）。
 */
export const WORMHOLE_FOE_CARD_IDS: readonly string[] = [
  'wh-pirate-scout',
  'wh-alien-swarm',
  'wh-grave-watch',
  'wh-exile-blockade',
]

/** 本节点用哪张敌卡（**确定性**：同 `(depth, nodeIndex)` ⇒ 同卡，四族轮换） */
export function wormholeCardIdFor(depth: number, nodeIndex: number): string {
  const d = Math.max(1, Math.floor(depth))
  const i = Math.max(0, Math.floor(nodeIndex))
  const h = Math.abs((d * 31 + i * 7) % WORMHOLE_FOE_CARD_IDS.length)
  return WORMHOLE_FOE_CARD_IDS[h]!
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
): AnomalyDef {
  const target = wormholeFoeThreat(depth, kind)
  const scale = (target / Math.max(1, base.threat)) * WORMHOLE_FOE_BASE_STRENGTH_MUL
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
