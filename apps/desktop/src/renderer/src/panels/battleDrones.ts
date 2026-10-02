/**
 * 战斗界面 · 无人机几何域（2026-10-02 从 `panels/BattleScreen.tsx` 拆出 · 批次 4u · 零行为变化）。
 *
 * 本文件 = 敌我无人机与挂载件悬停文案的**纯几何/文案件**：挂载件悬停明文（foeMountsTipOf）、
 * 我方机群姿态（droneHomeStation/dronePoseAt）、击落爆炸点（oneThirdToward ＋ 冻结时长）、
 * 敌方机群镜像（foeDroneStation/foePoseAt，含受击增程外推）。`BattleScreen.tsx` 借回使用；
 * 只依赖 droneArt/foeBrief/battleViewCore（纯类型边）与 i18n ⇒ 运行期零回边。
 */
import type { DroneModel, DroneSortie } from '../ui/droneArt'
import {
  DRONE_SHOW_MAX,
  DRONE_STYLE,
  DRONE_SORTIE_OUT_MS,
  DRONE_DWELL_MS,
  DRONE_SORTIE_BACK_MS,
  droneTakeoff,
  droneArcHeight,
  droneStationFrom,
  dronePathPos,
} from '../ui/droneArt'
import type { Anchor } from './battleViewCore'
import { mountEffectTextByName } from '../ui/foeBrief'
import { tr, mountNamesTextOf } from '../i18n/locale'

/**
 * **敌方挂载件的悬停明文**（**2026-09-26 船长报障**：「**战斗画面，玩家鼠标悬停敌方挂载件时，
 * 不应该复读一遍相同的文字，应该进行挂载件的大致效果说明**」）。
 *
 * 病根：芯片上**已经印着装置名**（`mountNamesTextOf(...)` 那一段就是可见正文），
 * 而原来的 `title` 又把同一串名字拼一遍 ⇒ 悬停等于什么都没说。
 *
 * 现口径：**逐件「装置名 ＋ 该件的明文效果」**（效果文案复用势力图鉴那套 `ui.foeIntro.10x`，
 * 由 `foeBrief.mountEffectText*` 从 `FOE_MOUNTS` 的**效果字段现算** ⇒ 与战斗里真正生效的是同一件事）；
 * 某件确实只有名字、没有任何机制（`mountEffectText` 返回 null）⇒ **只显示名字**（不复读效果，也不留空）。
 *
 * ⚠ 语言：效果文案走 `tr(id)`（随语言切），装置名走既有的 `mountNamesTextOf`（core 的双语名对）。
 */
export function foeMountsTipOf(
  names: readonly string[],
  pairs?: ReadonlyArray<readonly [string, string]>,
): string {
  const shown = mountNamesTextOf(names, pairs)
  return names
    .map((n, i) => {
      const eff = mountEffectTextByName(n)
      const label = shown[i] ?? n
      return eff === null || eff.length === 0 ? label : `${label} — ${eff}`
    })
    .join(tr('ui.MatterTechTab.017'))
}

/**
 * 无人机阵位（绝对画面 px；2026-09-10 船长二次定）：
 * - 出击制（默认 `sortie`）= 飞到敌舰侧的攻击阵位开火（哨戒常驻型例外：始终随母舰下方伴飞）；
 * - 机群制（保留 `formation`）= 母舰上侧编队巡飞，弹道自编队位起飞。
 */
/**
 * 无人机停泊/编队位（绝对画面 px）——供**机群制**与**哨戒常驻型**使用：
 * 机群制 = 母舰上侧编队位；哨戒 = 母舰上方伴飞位；出击制（放飞型）由每轮的随机阵位给出（见 droneRandomOffsets）。
 */
export function droneHomeStation(model: DroneModel, lane: number, lay: { me: Anchor; foe: Anchor[] }): Anchor {
  const slot = model.slots[lane % Math.max(1, Math.min(model.slots.length, DRONE_SHOW_MAX))] ?? model.slots[0]!
  return { x: lay.me.x + slot.x, y: lay.me.y + slot.y }
}

/**
 * 无人机姿态（绝对画面 px + 朝向；2026-09-10 船长"无人机移动不连贯"修复）：
 * 位置不再依赖 React 重渲染（33ms 循环仅在距离变化时才 setState → 敌舰就位后无人机只剩 10Hz 通知刷新，
 * 表现为 10fps 步进）。本函数被 **rAF 循环**直接调用，把 transform 写进 DOM → 恒定 60fps 平滑。
 */
export function dronePoseAt(
  model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
): { x: number; y: number; heading: number } {
  const base = DRONE_STYLE === 'sortie' && !model.resident ? droneTakeoff(lane) : model.slots[lane % model.slots.length]!
  const baseAbs = { x: lay.me.x + base.x, y: lay.me.y + base.y }
  const arc = droneArcHeight(lane)
  const foeA = lay.foe[0] ?? lay.me
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 46, y: 0 }
  const station =
    DRONE_STYLE === 'sortie' && !model.resident ? droneStationFrom(foeA, 1, off) : droneHomeStation(model, lane, lay)
  if (DRONE_STYLE === 'sortie' && !model.resident) {
    if (elapsed < DRONE_SORTIE_OUT_MS) {
      const t = Math.min(1, Math.max(0, elapsed / DRONE_SORTIE_OUT_MS))
      const p = dronePathPos(t, baseAbs, station, arc, false)
      return { x: p.x, y: p.y, heading: 1 }
    }
    if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) return { x: station.x, y: station.y, heading: 1 } // 到位驻留
    const t = Math.min(1, Math.max(0, (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) / DRONE_SORTIE_BACK_MS))
    const p = dronePathPos(t, station, baseAbs, arc, true)
    return { x: p.x, y: p.y, heading: -1 } // 返航：掉头
  }
  return { x: station.x, y: station.y, heading: 1 }
}

/** 被击落的无人机**滑向爆炸点**的时长（毫秒）。船长 2026-09-11：「**爆炸的时间点定在返航到 1/3
 *  的途中**，这样才更能看清」——击落后机体**继续朝自己的母舰方向飘 1/3 段**再炸（不是原地炸），
 *  这样爆炸点与'被打中的那一刻'分开，玩家更容易看清是哪一架没了。
 *  取值 = 返航航段（`DRONE_SORTIE_BACK_MS`）的 1/3。 */
export const DRONE_DOWN_FREEZE_MS = Math.round(DRONE_SORTIE_BACK_MS / 3)

/** 击落后的**爆炸点**：从被打中的位置朝自己的母舰方向**挪 1/3 段**（船长「返航到 1/3 的途中」）。 */
export function oneThirdToward(
  from: { x: number; y: number },
  home: { x: number; y: number },
): { tx: number; ty: number } {
  return {
    tx: from.x + (home.x - from.x) / 3,
    ty: from.y + (home.y - from.y) / 3,
  }
}

/** **敌机阵位**（受击增程的视觉落点）：平时 = **我舰旁**（`lay.me + off`，镜像几何）；
 *  增程触发后**沿"我舰 → 敌舰"方向外推**——外推量 = 该方向的 55%、**上限 260px**
 *  （敌舰锚点本身在画面内 ⇒ 外推后仍在可视区内，不会把机体推出战场）。
 *  ⚠ 击杀落点与实时阵位**共用本函数**（否则死亡动画会跳回未增程的位置）。 */
export function foeDroneStation(
  me: Anchor,
  foeA: Anchor,
  off: { x: number; y: number },
  rangeBuff: boolean,
): { x: number; y: number } {
  const base = { x: me.x + off.x, y: me.y + off.y }
  if (!rangeBuff) return base
  const dx = foeA.x - me.x
  const dy = foeA.y - me.y
  const len = Math.hypot(dx, dy) || 1
  const step = Math.min(260, len * 0.55)
  return { x: base.x + (dx / len) * step, y: base.y + (dy / len) * step }
}

/**
 * **敌方机群姿态**（2026-09-11 机群批 S5）——我方 `dronePoseAt` 的**完整镜像**：
 * 起点 = **敌舰机库口**（`droneTakeoff` 偏移相对敌舰**水平镜像**），阵位 = **我方舰旁**（`lay.me + off`）
 * ——因为敌方机群打的是**我方舰**，锚点就是'要打的那一方'（与我方机群锚敌舰同一条口径）。
 * 朝向：出海/驻留 `heading = -1`（朝我）· 返航 `heading = +1`（掉头）。
 *
 * **受击增程**（2026-09-11 船长：「受到攻击后，大幅提高无人机射程（提高 400%）」）：
 * 触发后阵位由 `foeDroneStation` 外推 ⇒ **机体明显后撤、出击/攻击线拉长**（机群视觉上"改打远距"）。
 */
export function foePoseAt(
  model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
  rangeBuff = false,
): { x: number; y: number; heading: number } {
  const foeA = lay.foe[0] ?? lay.me
  const tk = droneTakeoff(lane)
  const deck = { x: foeA.x - tk.x, y: foeA.y + tk.y }
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 52, y: 0 }
  const station = foeDroneStation(lay.me, foeA, off, rangeBuff)
  const arc = droneArcHeight(lane)
  if (elapsed < DRONE_SORTIE_OUT_MS) {
    const t = Math.min(1, Math.max(0, elapsed / DRONE_SORTIE_OUT_MS))
    return { ...dronePathPos(t, deck, station, arc, false), heading: -1 }
  }
  if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS)
    return { x: station.x, y: station.y, heading: -1 }
  const t = Math.min(
    1,
    Math.max(
      0,
      (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) / DRONE_SORTIE_BACK_MS,
    ),
  )
  return { ...dronePathPos(t, station, deck, arc, true), heading: 1 }
}
