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
import { addLog, haltActivityForSwitch } from './state'

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

/**
 * 现在占着主控的是哪一项（没有 ⇒ null）。判据与活动栏同源（`state` 上的那几个 active 位）。
 * ⚠ **顺序刻意与 `activity.shipBusyLabel` 的主控分支逐项对齐**（同一把尺、同一优先级）——
 * 以后加档两处必须一起加（用例 `activity-gate.test.ts` 的矩阵会钉住）。
 */
export function mainActivityOf(state: GameState): MainActivityKind | null {
  if (state.mining.active) return 'mining'
  if (state.salvaging.active) return 'salvaging'
  if (state.hauling.active) return 'hauling'
  if (state.sideTasks.deliver !== null) return 'deliver'
  if (state.standby.active) return 'standby'
  if (state.wormholeScan?.active === true) return 'wormholeScan'
  if (state.expedition.active) return 'expedition'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return 'refine'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return 'manufacturing'
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
  /**
   * ② 人在虫洞里（进洞 = 主控的一个活动；别的活动开不了）。
   * ⚠ **判据含 `attending`**（与 `state.wormholePilotHoldReason` 同一把尺）：**临时离开虫洞界面
   * ⇒ 活动停止、主控立刻释放**（船长 2026-09-13 批准）——这时 `run` 还在、但可以去做别的。
   */
  if (state.wormhole.run != null && state.wormhole.run.attending === true) {
    return '人在虫洞里：先撤离（或打完本层）才能切换主控活动。'
  }
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
  /** 上面那句话的 id 与参数（界面走 `cmdText` 取当前语言；`p1/p2` 是活动名与代价） */
  messageId?: string
  messageParams?: Readonly<Record<string, string>>
  /** `confirm` 时：确认后是否真能中断（false ⇒ 界面上按 reject 呈现：置灰 + 理由） */
  interruptible?: boolean
}

/** `gateMainActivity` 的 `action: 'confirm'` 那句话用了这个 id ⇒ 界面据此"首击警告、二击执行" */
export const ACTIVITY_CONFIRM_ID = 'core.activityGate.002'

/**
 * **统一日志：已自动停止「X」：代价。**（`halt` 落地时由入口调用一次；文案与 id 都在这里，免得各写一份）
 *
 * `detail`（可选）= 那一趟的具体读数/去向（「本趟 12 单位钛，货物留在船上」「已扫 7 分钟」这类）——
 * 只在进洞那条路径上传（它原先的日志自带这些读数，改用统一日志后不能把这些信息丢掉）。
 */
export function logAutoHalt(state: GameState, kind: MainActivityKind, detail?: string): void {
  const p1 = KIND_LABEL[kind]
  const p2 = HALT_COST[kind]
  if (detail !== undefined && detail.length > 0) {
    addLog(state, 'warn', `已自动停止「${p1}」：${p2}。（${detail}）`, 'core.activityGate.007', { p1, p2, p3: detail })
    return
  }
  addLog(state, 'warn', `已自动停止「${p1}」：${p2}。`, 'core.activityGate.001', { p1, p2 })
}

/**
 * **开始一项主控活动前的唯一判据**（各 `start*` 入口调用它，再按 `action` 落地）。
 *
 * ⚠ 调用顺序要求：**先过完"新活动自己的前置校验"，再调本函数**——否则会出现"先停了玩家的活、
 * 再告诉他这活开不了"（现行几条链里已有这条纪律，见 `hauling.startHauling` 的注释）。
 */
export function gateMainActivity(state: GameState, next: MainActivityKind): GateVerdict {
  return verdictOf(state, next)
}

/**
 * 判据本体：`next = null` 表示**这次的切入点没有"新活动"可命名**（换驾驶 / 进洞——它们不是九项之一，
 * 但同样要"先把手上的活收掉"）⇒ 不适用"同项直接放行"那一条。
 */
function verdictOf(state: GameState, next: MainActivityKind | null): GateVerdict {
  const locked = cannotInterruptReason(state)
  if (locked !== null) {
    /** 三种锁定态各有自己的 id（界面按当前语言渲染；`error` 那份中文原串只作兜底） */
    const id = locked.includes('战斗中')
      ? 'core.activityGate.004'
      : locked.includes('虫洞')
        ? 'core.activityGate.005'
        : 'core.activityGate.006'
    return { action: 'reject', message: locked, messageId: id }
  }
  const current = mainActivityOf(state)
  if (current === null) return { action: 'ok' }
  if (next !== null && current === next) return { action: 'ok' }
  const cost = HALT_COST[current]
  const label = KIND_LABEL[current]
  if (AUTO_HALT_KINDS.includes(current)) return { action: 'halt', current }
  const interruptible = INTERRUPTIBLE[current] === true
  const messageId = interruptible ? ACTIVITY_CONFIRM_ID : 'core.activityGate.003'
  const message = interruptible
    ? `${label}进行中：切换会中断它——${cost}。再点一次即确认：自动停止并开始新活动。`
    : `${label}进行中：${cost}——这一趟不能中断，等它结束再切换。`
  return { action: interruptible ? 'confirm' : 'reject', current, message, messageId, messageParams: { p1: label, p2: cost }, interruptible }
}

/**
 * **换驾驶 / 进洞**这类"没有新活动名"的切入点：照同一条判据裁决"能不能动手"。
 *
 * `warnConfirmed = true` = 界面**已经做过两段确认**（换驾驶的 `switchAskId` · 进洞的 `enterHaulAsk`，
 * 都在动手指令之前弹过「会中断长途运输」的警告）⇒ 长途运输那一档直接落成 `halt`；false ⇒ 返回 `confirm`
 * 交界面去问（不新造交互，沿用 2026-09-20 那套）。
 */
export function gateMainActivityHandoff(state: GameState, warnConfirmed = true): GateVerdict {
  const v = verdictOf(state, null)
  if (v.action === 'confirm' && warnConfirmed && v.current !== undefined) {
    return { action: 'halt', current: v.current }
  }
  return v
}

/** 入口把它原样返回给界面时的形状（与 `engine.CommandResult` 的前三个字段同构） */
export interface ActivityGateSkip {
  ok: false
  error: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
}

function skipOf(v: GateVerdict): ActivityGateSkip {
  return {
    ok: false,
    error: v.message ?? '',
    ...(v.messageId !== undefined ? { errorId: v.messageId } : {}),
    ...(v.messageParams !== undefined ? { errorParams: v.messageParams } : {}),
  }
}

/**
 * **九项 `start*` 入口的唯一落地口**：判据 → 该停的停掉（＋统一日志）→ 告诉入口能不能开工。
 *
 * 返回值：`null` = 可以照常开工（需要自动停机的，这里已经停好并记了日志）；
 * 非 null = **原样返回给界面**（`confirm` 与 `reject` 都按"没开工"处理——`confirm` 那句 warning 由界面
 * 两段确认消化，见 `ACTIVITY_CONFIRM_ID`）。
 */
export function applyActivityGate(state: GameState, next: MainActivityKind): ActivityGateSkip | null {
  const v = gateMainActivity(state, next)
  if (v.action === 'ok') return null
  if (v.action === 'halt') {
    if (v.current !== undefined) haltAndLog(state, v.current)
    return null
  }
  return skipOf(v)
}

/**
 * **换驾驶 / 进洞的唯一落地口**：判据 → 该停的停掉（＋统一日志）。`null` = 可以动手。
 * ⚠ 采矿/打捞在"换驾驶"那条路上有**自己的善后**（旧船按阶段自动返航卸货，见 `shipyard.changeShip`）
 * ⇒ 那条路只用本函数**判据**（`gateMainActivityHandoff`），不要用它替你停机。
 */
export function applyActivityHandoff(state: GameState, warnConfirmed = true): ActivityGateSkip | null {
  const v = gateMainActivityHandoff(state, warnConfirmed)
  if (v.action === 'ok') return null
  if (v.action === 'halt') {
    if (v.current !== undefined) haltAndLog(state, v.current)
    return null
  }
  return skipOf(v)
}

/**
 * **玩家确认"中断当前活动"**（两段确认的第二下 / 界面通用收尾）：停掉它并按统一口径记一条日志。
 * 返回被停掉的那一项（没得停 ⇒ null）。不碰"本就不可中断"的远征/快递（那两项永远走拒绝）。
 */
export function haltCurrentActivity(state: GameState): MainActivityKind | null {
  const current = mainActivityOf(state)
  if (current === null) return null
  if (!AUTO_HALT_KINDS.includes(current) && INTERRUPTIBLE[current] !== true) return null
  haltAndLog(state, current)
  return current
}

/** 停机 + 统一日志（两件事永远成对 ⇒ 收成一处，免得哪条路径漏写日志） */
function haltAndLog(state: GameState, kind: MainActivityKind): void {
  haltActivityForSwitch(state, kind)
  logAutoHalt(state, kind)
}
