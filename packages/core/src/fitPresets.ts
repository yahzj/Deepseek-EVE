/**
 * **装配方案（预设）**：保存当前装配 / 按方案一键换装
 * （2026-09-14 船长拍板；入口在装配页「装配目标」栏右侧）。
 *
 * 口径（船长四问四答 + 一处追加；**上限 2026-09-17 船长：「舰船的装配方案数量上限拓展到10套」**）：
 * ① **按船型归口**（`defId`）——同型号任意一艘（含以后新建的）都能套用；
 * ② **每个船型最多 10 套**（`FIT_PRESET_MAX`；原 3 套），名称玩家自定（默认「方案 N」，见 `FIT_PRESET_NAME_MAX`）；
 * ③ 存 **三类槽位装备（高/中/低 逐位）＋ 无人机舱装载**；**不存**弹药档位（那仍在装配页手动设）；
 * ④ 套用 = **先卸光再装**——目标船现有装备全卸回装备库、无人机退回仓库，再按方案装；
 * ⑤ 装备库不足 / CPU 超预算 / 机舱不足时 **尽力装 + 逐条提示**（装上的保留，未装的逐条写进结果与日志）。
 * ⑥ **方案明细可查**（船长 2026-09-17：「**允许玩家查看装备方案内用了哪些装备**」）⇒ 单点
 *   `fitPresetDetailOf(preset, ctx, ship)` 出「三类槽位逐位（含空位）＋ 无人机舱装载」，
 *   界面（装配页方案浮层）只负责渲染，不自己拼名字。
 *
 * ⚠ **取舍（如实登记，2026-09-14 船长选定的语义）**：先卸光 + 尽力装 ⇒ **方案凑不齐时，
 * 套用后可能比套用前更差**（旧装配已回库）。结果小结与日志会逐条列出缺什么、哪几件未装。
 *
 * **装配顺序**（结果可复现，且避免"假超载"）：**扩容件（`cpuBonus > 0`）→ 高 → 中 → 低 → 无人机**。
 * 理由：协处理器给 CPU 预算，先装才不会让后面的件被误判超载；`fitModule` 自带四道校验
 * （进洞锁定 / 装备库有货 / 位可用 / CPU 预算）⇒ 逐件调用即"中间态永不超载"。
 *
 * **存档**：`GameState.fitPresets?: Record<defId, ShipFitPreset[]>`（兼容字段，老档缺省 = 空）。
 * 规范化在 `save.ts`（结构清洗：条目上限 / 名称去空白限长 / 位数组裁到 ≤7 / 无人机正整数）；
 * **下架或未知的装备 id 不在这里丢**——套用时计入"未装"清单逐条报出（规范化层拿不到内容表）。
 */
import { addLog, shipLockedReason } from './state'
import type { CommandResult } from './engine'
import type { GameState, ShipFitPreset } from './state'
import type { RackSlot, SimContext } from './types'
import { rackBays, shipSlotsOf } from './labels'
import { addModule, adjustDroneLoad, countModule, fitModule, trimDroneLoadToBay } from './equipment'
import { addWare } from './inventory'
import { fleetDefOf } from './instances'

/** 每个船型最多存几套（船长 2026-09-14：3 套 ⇒ **2026-09-17「上限拓展到10套」**） */
export const FIT_PRESET_MAX = 10
/** 方案名长度上限（玩家自定；超长截断） */
export const FIT_PRESET_NAME_MAX = 12
/** 槽类顺序（卸下 / 装配 / 展示统一走它：高 → 中 → 低） */
const RACK_ORDER: readonly RackSlot[] = ['high', 'mid', 'low']

/** 某船型的方案列表（无 = 空数组；调用方不要直接改返回值） */
export function fitPresetsOf(state: GameState, defId: string): readonly ShipFitPreset[] {
  return state.fitPresets?.[defId] ?? []
}

/** 方案摘要（界面列表用）：「装备 8 件（高 4 / 中 2 / 低 2）· 无人机 2 型 5 架」 */
export function fitPresetBrief(preset: ShipFitPreset): string {
  const count = (a: Array<string | null> | undefined): number => (a ?? []).filter((x) => x !== null && x !== '').length
  const high = count(preset.fitted.high)
  const mid = count(preset.fitted.mid)
  const low = count(preset.fitted.low)
  const load = preset.droneLoad ?? {}
  const drones = Object.values(load).reduce((s, n) => s + n, 0)
  const parts = [`装备 ${high + mid + low} 件（高 ${high} / 中 ${mid} / 低 ${low}）`]
  if (drones > 0) parts.push(`无人机 ${Object.keys(load).length} 型 ${drones} 架`)
  return parts.join(' · ')
}

/**
 * **方案明细（界面「明细」展开用）**：逐位列出三类槽位装了什么 ＋ 无人机舱装载
 * （船长 2026-09-17：「**允许玩家查看装备方案内用了哪些装备**」；两问两答取甲：
 * 行内展开 · 逐位列含空位）。
 *
 * 口径：
 * - **按目标船的槽位布局铺满**（`shipSlotsOf(ship)`）⇒ 空位显示为「空」（`name: '空'`、`id: null`），
 *   玩家能一眼看出"这位没装"；方案数组比船位少的那几位也照样铺成空位。
 * - **未知 / 已下架的件不隐藏**：`missing: true` ＋ `name` 回落成 id —— 与套用时"逐条报未装"同一口径
 *   （悄悄吞掉会让玩家以为方案里没有它）。
 * - **超出本船槽位的方案位**（船型槽位被改小过）单独计数 `overflow`：套用时按 `Math.min` 忽略，
 *   这里如实报出来。
 * - 无人机按「机型 × 架」列出（机型名走 `ctx.items`，未知机型同样标 `missing`）。
 */
export interface FitPresetSlotLine {
  rack: RackSlot
  /** 位次（**1 起**，界面直接显示「高 1」） */
  index: number
  /** 件 id（空位 = null） */
  id: string | null
  /** 件名（空位 = 「空」；未知/下架件回落成 id） */
  name: string
  /** 未知 / 已下架的件（界面据此染色提示） */
  missing: boolean
}
export interface FitPresetDroneLine {
  id: string
  name: string
  count: number
  missing: boolean
}
export interface FitPresetDetail {
  slots: FitPresetSlotLine[]
  drones: FitPresetDroneLine[]
  /** 超出本船槽位、套用时会忽略的方案位数 */
  overflow: number
}

export function fitPresetDetailOf(
  preset: ShipFitPreset,
  ctx: SimContext,
  ship: { slots?: import('./types').ShipSlots },
): FitPresetDetail {
  const bays = shipSlotsOf(ship)
  const slots: FitPresetSlotLine[] = []
  let overflow = 0
  for (const rack of RACK_ORDER) {
    const src = preset.fitted[rack] ?? []
    const baysN = bays[rack]
    if (src.length > baysN) overflow += src.length - baysN
    for (let i = 0; i < baysN; i++) {
      const raw = src[i]
      const id = raw === null || raw === undefined || raw === '' ? null : raw
      const def = id === null ? undefined : ctx.modules.get(id)
      slots.push({
        rack,
        index: i + 1,
        id,
        name: id === null ? '空' : (def?.name ?? id),
        missing: id !== null && def === undefined,
      })
    }
  }
  const drones: FitPresetDroneLine[] = Object.entries(preset.droneLoad ?? {})
    .filter(([, n]) => n > 0)
    .map(([id, count]) => {
      const def = ctx.items.get(id)
      return { id, name: def?.name ?? id, count, missing: def === undefined }
    })
  return { slots, drones, overflow }
}

/** 裁掉位数组尾部的空位（方案存"紧凑形状"，套用时按目标船槽位布局对齐） */
function trimFitted(fitted: { high: Array<string | null>; mid: Array<string | null>; low: Array<string | null> }): ShipFitPreset['fitted'] {
  const trim = (a: Array<string | null>): Array<string | null> => {
    const out = [...a]
    while (out.length > 0 && (out[out.length - 1] === null || out[out.length - 1] === '')) out.pop()
    return out.map((x) => (x === '' ? null : x))
  }
  return { high: trim(fitted.high), mid: trim(fitted.mid), low: trim(fitted.low) }
}

/** 默认方案名：第一个没被占用的「方案 N」 */
function defaultName(list: readonly ShipFitPreset[]): string {
  const taken = new Set(list.map((p) => p.name))
  for (let i = 1; i <= FIT_PRESET_MAX + 1; i++) {
    const name = `方案 ${i}`
    if (!taken.has(name)) return name
  }
  return `方案 ${list.length + 1}`
}

/**
 * **采集"当前装配"**（保存与替换共用）：`shipId` 那艘船的实装 = 三类槽位 ＋ 无人机舱装载。
 * 空装配（三类槽位与机舱都空）**拒绝**——与 `save.ts` 清洗的「全空方案丢弃」对齐。
 */
function captureFit(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  what: string,
): {
  ok: true
  fitted: ShipFitPreset['fitted']
  droneLoad: Record<string, number>
} | { ok: false; error: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const lock = shipLockedReason(state, shipId, what)
  if (lock) return { ok: false, error: lock }
  const shipDef = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!shipDef || !fleet) {
    return { ok: false, error: '舰队里找不到该舰船，无法保存装配方案。', errorId: 'core.fitPresets.001' }
  }
  const loadRaw = fleet.droneLoad ?? {}
  const droneLoad: Record<string, number> = {}
  for (const [id, n] of Object.entries(loadRaw)) if (n > 0) droneLoad[id] = n
  const fitted = trimFitted(fleet.fitted)
  if (fitted.high.length + fitted.mid.length + fitted.low.length === 0 && Object.keys(droneLoad).length === 0) {
    return {
      ok: false,
      error: '这艘船现在没装任何装备、机舱也是空的：先装几件再保存（要清空装配请用「一键卸下全部装备」）。',
      errorId: 'core.fitPresets.004',
    }
  }
  return { ok: true, fitted, droneLoad }
}

/**
 * 玩家指令：**保存当前装配为方案**（`shipId` 那艘船的实装 = 三类槽位 + 无人机舱装载）。
 * `name` 缺省 = 「方案 N」；同名 = **覆盖**（满套时仍可覆盖同名，不必先删）。
 */
export function saveFitPreset(state: GameState, ctx: SimContext, shipId: string, name?: string): CommandResult {
  const shipDef = fleetDefOf(state, ctx, shipId)
  if (!shipDef) {
    return { ok: false, error: '舰队里找不到该舰船，无法保存装配方案。', errorId: 'core.fitPresets.001' }
  }
  const list = [...fitPresetsOf(state, shipDef.id)]
  const wanted = (name ?? '').trim().slice(0, FIT_PRESET_NAME_MAX)
  const finalName = wanted.length > 0 ? wanted : defaultName(list)
  const at = list.findIndex((p) => p.name === finalName)
  if (at < 0 && list.length >= FIT_PRESET_MAX) {
    return {
      ok: false,
      error: `「${shipDef.name}」已有 ${FIT_PRESET_MAX} 套装配方案：先删掉一套，或用一个同名方案覆盖它。`,
      errorId: 'core.fitPresets.005',
      errorParams: { p1: shipDef.name, p2: FIT_PRESET_MAX },
    }
  }
  const cap = captureFit(state, ctx, shipId, '保存它的装配方案')
  if (!cap.ok) return { ok: false, error: cap.error }
  const preset: ShipFitPreset = {
    name: finalName,
    fitted: cap.fitted,
    ...(Object.keys(cap.droneLoad).length > 0 ? { droneLoad: cap.droneLoad } : {}),
  }
  if (at >= 0) list[at] = preset
  else list.push(preset)
  state.fitPresets = { ...(state.fitPresets ?? {}), [shipDef.id]: list }
  addLog(state, 'info', `已保存装配方案「${finalName}」（${shipDef.name} · ${fitPresetBrief(preset)}）。`, 'core.fitPresets.009', {
    p1: finalName,
    p2: shipDef.name,
    p3: fitPresetBrief(preset),
  })
  return { ok: true }
}

/**
 * 玩家指令：**用当前装配覆盖指定的那套方案**（船长 2026-09-19：「给方案加个替换按钮，点击后将当前装配
 * 覆盖进目标方案，覆盖之前需要玩家确认」）。
 *
 * 与 `saveFitPreset` 的区别：**不新建、不改名、不改位置**——只把 `index` 那套的"内容"换成本船的实装；
 * 方案名原样保留（玩家点的是哪一套就更新哪一套）。空装配同样拒绝（沿用 `captureFit` 的判据）。
 * ⚠ 界面侧负责"覆盖前确认"（两步/弹窗），core 这层只做覆盖本身。
 */
export function overwriteFitPreset(state: GameState, ctx: SimContext, shipId: string, index: number): CommandResult {
  const shipDef = fleetDefOf(state, ctx, shipId)
  if (!shipDef) {
    return { ok: false, error: '舰队里找不到该舰船，无法替换装配方案。', errorId: 'core.fitPresets.002' }
  }
  const list = [...fitPresetsOf(state, shipDef.id)]
  const target = list[index]
  if (!target) return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006' }
  const cap = captureFit(state, ctx, shipId, '保存它的装配方案')
  if (!cap.ok) return { ok: false, error: cap.error }
  const preset: ShipFitPreset = {
    name: target.name, // 名称与位置都保持原样
    fitted: cap.fitted,
    ...(Object.keys(cap.droneLoad).length > 0 ? { droneLoad: cap.droneLoad } : {}),
  }
  list[index] = preset
  state.fitPresets = { ...(state.fitPresets ?? {}), [shipDef.id]: list }
  addLog(
    state,
    'info',
    `已用当前装配覆盖方案「${target.name}」（${shipDef.name} · ${fitPresetBrief(preset)}）。`,
    'core.fitPresets.013',
    { p1: target.name, p2: shipDef.name, p3: fitPresetBrief(preset) },
  )
  return { ok: true }
}

/** 玩家指令：重命名某船型的第 `index` 套方案（同名拒绝；空白拒绝） */
export function renameFitPreset(state: GameState, defId: string, index: number, name: string): CommandResult {
  const list = [...fitPresetsOf(state, defId)]
  const preset = list[index]
  if (!preset) return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006' }
  const finalName = name.trim().slice(0, FIT_PRESET_NAME_MAX)
  if (finalName.length === 0) return { ok: false, error: '方案名不能为空。', errorId: 'core.fitPresets.007' }
  if (list.some((p, i) => i !== index && p.name === finalName)) {
    return {
      ok: false,
      error: `已有同名方案「${finalName}」：换个名字，或直接覆盖那一条。`,
      errorId: 'core.fitPresets.008',
      errorParams: { p1: finalName },
    }
  }
  const old = preset.name
  list[index] = { ...preset, name: finalName }
  state.fitPresets = { ...(state.fitPresets ?? {}), [defId]: list }
  addLog(state, 'info', `装配方案「${old}」已改名为「${finalName}」。`, 'core.fitPresets.010', { p1: old, p2: finalName })
  return { ok: true }
}

/** 玩家指令：删除某船型的第 `index` 套方案（删空则连键一起清掉） */
export function deleteFitPreset(state: GameState, defId: string, index: number): CommandResult {
  const list = [...fitPresetsOf(state, defId)]
  const preset = list[index]
  if (!preset) return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006' }
  list.splice(index, 1)
  const next = { ...(state.fitPresets ?? {}) }
  if (list.length > 0) next[defId] = list
  else delete next[defId]
  // 删空 ⇒ **连字段一起清掉**（回到"老档形状"：存盘里不出现空表，老档往返逐字一致）
  state.fitPresets = Object.keys(next).length > 0 ? next : undefined
  addLog(state, 'info', `已删除装配方案「${preset.name}」。`, 'core.fitPresets.011', { p1: preset.name })
  return { ok: true }
}

/** 「一键卸下全部装备」的结果（`removed` = 实际卸下件数） */
export interface UnfitAllResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  removed: number
}

/**
 * 玩家指令：**卸下目标船的全部装备**（放回装备库），并顺手按机舱容量整理无人机装载。
 * `quiet` = 不写"已卸下 N 件"日志（套用方案时由套用小结统一写）。
 *
 * ⚠ 不走 `unfitAt`：那条命令会为防 CPU 套利拒绝"卸下后超载"的单件操作（卸协处理器时会发生），
 * 而**全卸**的终态是 0 占用、不可能超载 ⇒ 这里直接清位 + 回库。
 * ⚠ **锁判定放在函数内**（不只靠 `applyFitPreset` 的入口判定）：装配页的「一键卸下全部装备」
 * 按钮直接调本函数（船长 2026-09-13：进洞船只所有行为都锁定，包括维修）。
 */
export function unfitAllModules(state: GameState, ctx: SimContext, shipId: string, quiet = false): UnfitAllResult {
  const lock = shipLockedReason(state, shipId, '卸下它的装备')
  if (lock) return { ok: false, error: lock, removed: 0 }
  const fleet = state.fleet[shipId]
  const fitted = fleet?.fitted
  if (!fitted) return { ok: true, removed: 0 }
  let removed = 0
  for (const rack of RACK_ORDER) {
    const bays = rackBays(fitted, rack)
    for (let i = 0; i < bays.length; i++) {
      const id = bays[i]
      if (id === null || id === undefined || id === '') continue
      bays[i] = null
      addModule(state, id)
      removed += 1
    }
  }
  if (removed > 0) {
    // 槽位变少/舱容变小 ⇒ 超出的无人机自动退回仓库（与 repair 链同口径）
    trimDroneLoadToBay(state, ctx, shipId)
    if (!quiet) {
      addLog(
        state,
        'info',
        `已卸下全部装备 ${removed} 件（放回装备库），甲板扩容器一并卸下。`,
        'core.fitPresets.012',
        { p1: removed },
      )
    }
  }
  return { ok: true, removed }
}

/** 玩家指令：把目标船无人机舱里的无人机全部退回仓库；返回退回的架数 */
export function clearDroneLoad(state: GameState, ctx: SimContext, shipId: string): number {
  const fleet = state.fleet[shipId]
  const load = fleet?.droneLoad ?? {}
  let out = 0
  for (const [id, n] of Object.entries(load)) {
    if (n > 0) {
      addWare(state, id, n)
      out += n
    }
  }
  if (fleet && out > 0) fleet.droneLoad = undefined
  return out
}

/** 套用方案的结果（`summary` 直接给界面弹提示用） */
export interface FitPresetApplyResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  /** 玩家可见一行小结（成功时一定有） */
  summary: string
}

/**
 * 玩家指令：**套用方案**（先卸光再装；尽力装 + 逐条提示）。
 * 目标是**同型号**的任意一艘（方案按 `defId` 归口；本船的槽位布局与方案对齐：
 * 方案超出的位丢弃、方案不足的位留空）。
 */
export function applyFitPreset(state: GameState, ctx: SimContext, shipId: string, index: number): FitPresetApplyResult {
  const lock = shipLockedReason(state, shipId, '换装')
  if (lock) return { ok: false, error: lock, summary: '' }
  const shipDef = fleetDefOf(state, ctx, shipId)
  if (!shipDef) return { ok: false, error: '舰队里找不到该舰船，无法套用装配方案。', summary: '' }
  const preset = fitPresetsOf(state, shipDef.id)[index]
  if (!preset) {
    return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006', summary: '' }
  }

  // ① 先卸光（装备回库 + 无人机退仓）
  const removed = unfitAllModules(state, ctx, shipId, true).removed
  const dronesOut = clearDroneLoad(state, ctx, shipId)

  // ② 装配清单：按目标船槽位布局对齐 + 扩容件优先 + 高→中→低 位序
  const slots = shipSlotsOf(shipDef)
  const jobs: Array<{ rack: RackSlot; index: number; moduleId: string }> = []
  for (const rack of RACK_ORDER) {
    const src = preset.fitted[rack] ?? []
    const want = Math.min(src.length, slots[rack])
    for (let i = 0; i < want; i++) {
      const id = src[i]
      if (id !== null && id !== undefined && id !== '') jobs.push({ rack, index: i, moduleId: id })
    }
  }
  const boost = (j: { moduleId: string }): number => ((ctx.modules.get(j.moduleId)?.cpuBonus ?? 0) > 0 ? 1 : 0)
  jobs.sort(
    (a, b) =>
      boost(b) - boost(a) ||
      RACK_ORDER.indexOf(a.rack) - RACK_ORDER.indexOf(b.rack) ||
      a.index - b.index,
  )

  const missing: string[] = []
  const blocked: string[] = []
  let installed = 0
  for (const j of jobs) {
    const def = ctx.modules.get(j.moduleId)
    if (!def) {
      blocked.push(`未知装备（${j.moduleId}）`)
      continue
    }
    if (countModule(state, j.moduleId) < 1) {
      missing.push(def.name)
      continue
    }
    // 位可用 + 装备库有货都先过了 ⇒ 这里失败基本只剩 CPU 预算（直接把原因抄给玩家）
    const res = fitModule(state, j.moduleId, ctx, { rack: j.rack, index: j.index, shipId })
    if (res.ok) installed += 1
    else blocked.push(`${def.name}：${res.error ?? '未能装上'}`)
  }

  // ③ 无人机按方案装载（仓库数量 / 机舱容量 / CPU 预算三重校验在 adjustDroneLoad 内）
  let dronesIn = 0
  const droneFail: string[] = []
  for (const [droneId, n] of Object.entries(preset.droneLoad ?? {})) {
    if (n <= 0) continue
    const def = ctx.items.get(droneId)
    if (!def) {
      droneFail.push(`未知机型（${droneId}）×${n}`)
      continue
    }
    const res = adjustDroneLoad(state, ctx, droneId, n, shipId)
    if (res.ok) dronesIn += n
    else droneFail.push(`${def.name}×${n}：${res.error ?? '未能装入'}`)
  }

  const bits = [`卸下 ${removed} 件`, `装上 ${installed} 件`]
  if (dronesOut > 0) bits.push(`退回无人机 ${dronesOut} 架`)
  if (dronesIn > 0) bits.push(`装入无人机 ${dronesIn} 架`)
  if (missing.length > 0) bits.push(`装备库缺 ${missing.length} 件（${missing.join('、')}）`)
  if (blocked.length > 0) bits.push(`${blocked.length} 件未装（${blocked.join('；')}）`)
  if (droneFail.length > 0) bits.push(`无人机未装（${droneFail.join('；')}）`)
  const summary = `已套用「${preset.name}」（${shipDef.name}）：${bits.join(' · ')}`
  const imperfect = missing.length > 0 || blocked.length > 0 || droneFail.length > 0
  addLog(state, imperfect ? 'warn' : 'info', `${summary}。`)
  return { ok: true, summary }
}
