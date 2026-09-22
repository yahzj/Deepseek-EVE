/**
 * **主控活动切换的单点判据**（**2026-09-21 船长令**：「**关于主控切换不同活动，现在依旧很混乱。有的需要玩家
 * 先取消当前活动才能切换，有的又可以直接切换，有的还需要警告后切换。你帮我统计下。我希望统一为能够直接切换
 * （自动取消当前活动），像长途运输这种高收益高周期的才加一个警告。**」＋同日追加：**「处在战斗中的时候也设置
 * 为不可取消」**＋三答：**远征/快递写进警告档 · 开炉开线取消即丢弃进度 · 换驾驶与进洞纳入同一条单点**）。
 *
 * 现状（改前）＝三档并存：① 绝大多数入口**硬拒**（9 个 `start*` 各写一套 busy 检查，散布 30+ 处）
 * ② 只有「换驾驶」与「进洞」**自动停** ③ 警告态只在长途运输那一族。本模块把**判据**收成一处：
 *
 * | 档 | 成员 | 行为 |
 * |---|---|---|
 * | `AUTO_HALT` | 采矿 · 打捞 · 扫描虫洞 · 掩护巡逻 · 亲自开炉 · 亲自开线 | **直接切**：自动停掉它（代价见下表）＋记一条日志，然后照常开始新活动 |
 * | `WARN_KINDS` | **长途运输**（高收益高周期）· **远征** · **快递投送** | **先警告**：首击弹警告（写清将停谁、代价是什么），二击执行；⚠ **远征/快递在途不可中断** ⇒ 警告之后仍是拒（文案按警告口径讲清代价） |
 * | `LOCKED`（状态类） | **战斗中** · 人在虫洞里 · 换港返航途中 | **一律拒**：这些状态不可被"切活动"打断（连站内的"亲自开炉/开线"也拒——主控正在打仗） |
 *
 * 各活动的**取消代价**（统一日志里写清）：采矿/打捞 = 本趟货留在船上并返港 · 扫描虫洞 = 进度保留 ·
 * 掩护巡逻 = 召回回港 · 亲自开炉/开线 = **停炉/停线，当前那批进度丢弃**（船长 2026-09-21 定）·
 * 长途运输 = 本段报酬拿不到。
 *
 * ⚠ **本模块只出判据，不执行停机**：`gateMainActivity` 返回"该停谁/该警告什么/为什么拒"，由各入口用**既有的**
 * 取消函数落地（`miningHalt` / `salvageHalt` / `haulingHalt` / `wormholeScanHalt` / `cancelStandby` /
 * `stopRefineRun` / `cancelManufacturing`）——这样语义只有一份、也不制造模块环。
 */
import type { GameState } from './state'

/** 主控活动（9 项；与活动栏、`pilotUnavailableReason`、各 `start*` 入口一一对应） */
export type MainActivityKind =
  | 'mining'
  | 'salvaging'
  | 'hauling'
  | 'wormholeScan'
  | 'standby'
  | 'refine'
  | 'manufacturing'
  | 'expedition'
  | 'deliver'

/** 直接切（自动停掉；船长 2026-09-21：「统一为能够直接切换（自动取消当前活动）」） */
export const AUTO_HALT_KINDS: readonly MainActivityKind[] = [
  'mining',
  'salvaging',
  'wormholeScan',
  'standby',
  'refine',
  'manufacturing',
]

/** 先警告再执行（船长：「像长途运输这种高收益高周期的才加一个警告」＋「1 写进警告」＝远征/快递同档） */
export const WARN_KINDS: readonly MainActivityKind[] = ['hauling', 'expedition', 'deliver']

/**
 * 该活动**在途时能不能被中断**：`true` = 警告后可由玩家确认中断（长途运输：本段报酬拿不到）·
 * `false` = 警告之后**仍是拒**（远征在途不可停、快递投送不可取消 —— 船长 2026-09-21 定的口径）。
 */
export const INTERRUPTIBLE: Readonly<Record<MainActivityKind, boolean>> = {
  mining: true,
  salvaging: true,
  hauling: true,
  wormholeScan: true,
  standby: true,
  refine: true,
  manufacturing: true,
  expedition: false,
  deliver: false,
}

/** 每项的取消代价（写进统一日志与警告；措辞按现行游戏语义，不写原因解释） */
export const HALT_COST: Readonly<Record<MainActivityKind, string>> = {
  mining: '本趟原矿留在船上，舰船返港',
  salvaging: '本趟残骸留在船上，舰船返港',
  hauling: '本段报酬拿不到（报酬到站才结）',
  wormholeScan: '扫描进度保留',
  standby: '舰船召回母港',
  refine: '停炉——当前那一批的进度丢弃',
  manufacturing: '停线——当前那一批的进度丢弃',
  expedition: '远征无法中断',
  deliver: '投送不可取消',
}

/** 活动名（统一文案里用；与活动栏的写法一致） */
export const KIND_LABEL: Readonly<Record<MainActivityKind, string>> = {
  mining: '开采',
  salvaging: '打捞',
  hauling: '长途运输',
  wormholeScan: '扫描虫洞',
  standby: '掩护巡逻',
  refine: '亲自开炉',
  manufacturing: '亲自开线',
  expedition: '远征',
  deliver: '快递投送',
}

/** 现在占着主控的是哪一项（没有 ⇒ null）。判据与活动栏同源（`state` 上的那几个 active 位） */
export function mainActivityOf(state: GameState): MainActivityKind | null {
  if (state.mining.active) return 'mining'
  if (state.salvaging.active) return 'salvaging'
  if (state.hauling.active) return 'hauling'
  if (state.standby.active) return 'standby'
  if (state.wormholeScan?.active === true) return 'wormholeScan'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return 'refine'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return 'manufacturing'
  if (state.expedition.active) return 'expedition'
  if (state.sideTasks.deliver !== null) return 'deliver'
  return null
}

/**
 * **不可被打断的状态**（与"哪个活动在跑"无关的那几种；船长 2026-09-21：「处在战斗中的时候也设置为不可取消」）。
 * 返回中文理由（给玩家看），没有 ⇒ null。
 */
export function cannotInterruptReason(state: GameState): string | null {
  // ① 战斗中：三处战斗槽（远征实时战 / 低安遭遇战 / 洞内战）——洞内另有"不可撤退"那条既有裁定
  if (state.expedition.battle !== null) return '战斗中：这一场打完才能切换主控活动。'
  /**
   * 低安遭遇战：**只有打在主控船上的那一场**才拦（`encounter.shipId === state.shipId`）——
   * 副船遇袭不占主控活动位，主控照常可以换活干（与 `pilotUnavailableReason` 的口径一致）。
   */
  if (state.encounter.active && state.encounter.battle !== null && state.encounter.shipId === state.shipId) {
    return '战斗中：这一场打完才能切换主控活动。'
  }
  if (state.wormhole.run?.battle != null) return '战斗中：这一场打完才能切换主控活动。'
  // ② 人在虫洞里（进洞 = 主控的一个活动；别的活动开不了）
  if (state.wormhole.run != null) return '人在虫洞里：先撤离（或打完本层）才能切换主控活动。'
  // ③ 换港返航途中（瞬时到站，等一拍就好）
  if (state.transit.active) return '换港返航途中：抵达后就能切换主控活动。'
  return null
}

export interface GateVerdict {
  /**
   * - `ok` = 主控空着，直接开始；
   * - `halt` = **直接切**：先把 `halted` 那项自动停掉（代价见 `HALT_COST`），再开始；
   * - `confirm` = **先警告**：写清"将停谁、代价是什么"，玩家确认后执行（`interruptible: false` 时确认也没用，
   *   仍按 `reject` 处理——远征/快递）；
   * - `reject` = 不能切（战斗中 / 洞里 / 返航途中，或在途且不可中断的活动）。
   */
  action: 'ok' | 'halt' | 'confirm' | 'reject'
  /** `halt`/`confirm`/`reject` 时：占着主控的那一项 */
  current?: MainActivityKind
  /** `confirm`/`reject` 时：给玩家看的一句话（已含代价） */
  message?: string
  /** `confirm` 时：确认后是否真能中断（false ⇒ 界面上按 reject 呈现：置灰 + 理由） */
  interruptible?: boolean
}

/**
 * **开始一项主控活动前的唯一判据**（各 `start*` 入口调用它，再按 `action` 落地）。
 *
 * ⚠ 调用顺序要求：**先过完"新活动自己的前置校验"，再调本函数**——否则会出现"先停了玩家的活、
 * 再告诉他这活开不了"（现行几条链里已有这条纪律，见 `hauling.startHauling` 的注释）。
 */
export function gateMainActivity(state: GameState, next: MainActivityKind): GateVerdict {
  const locked = cannotInterruptReason(state)
  if (locked !== null) return { action: 'reject', message: locked }
  const current = mainActivityOf(state)
  if (current === null || current === next) return { action: 'ok' }
  const cost = HALT_COST[current]
  const label = KIND_LABEL[current]
  if (AUTO_HALT_KINDS.includes(current)) return { action: 'halt', current }
  const interruptible = INTERRUPTIBLE[current] === true
  const message = interruptible
    ? `${label}进行中：切换会中断它——${cost}。确认后自动停止并开始新活动。`
    : `${label}进行中：${cost}——这一趟不能中断，等它结束再切换。`
  return { action: interruptible ? 'confirm' : 'reject', current, message, interruptible }
}
