/**
 * **存档存储体检与告警单点**（2026-09-25 船长令 · 甲＋乙＋丙＋丁）。
 *
 * 起因（玩家报障）：「**玩家反应，他的 macbook 关掉游戏后存档就丢失了**」→ 追问后确认是 **Safari**、
 * **下午玩的当晚就没了**（⇒ 排除 Safari 那条「7 天不访问清站点数据」）。我们这边查出的责任链：
 * - 网页版的存档存在**浏览器 localStorage** 里（`game/storage.ts` 的 `localStorageBridge`，键 `whale:idle:save`）；
 * - 写失败时 `setWithBudget` 吞掉异常 ⇒ `persist()` 返回 false，而**自动存档 130+ 处全是 `void this.persist()`**
 *   ⇒ **返回值没人看**，玩家侧一个提示都没有；
 * - 启动时**没有任何**"这台机器能不能写存档"的体检，也不识别隐私窗口 / 禁用站点数据。
 * ⇒ 玩家体验 = 玩一下午一切正常、关掉就没了。
 *
 * 本模块负责四件事（对应船长 2026-09-25 定的四条）：
 *   ① **启动体检（甲）**：写-读-删一个探针键（桌面端改走一次**只读** IPC，绝不碰真档）；
 *      不通就交给 App 弹**一次**玩家可见告警，并在设置里显示状态；
 *   ② **写入失败告警（甲）**：`persist()` 失败时**每局只提醒一次**（不刷屏）；
 *   ③ **申请持久化（乙）**：`navigator.storage.persist()`——Chromium 生效、Safari 静默跳过；
 *   ④ **暂停写入（丁）**：旧档读取失败时由引擎挂起写入（`engine.allowSaveAfterLoadError` 放行），
 *      免得"一时读不出来"的旧档被新档盖掉。
 *
 * ⚠ 体检与告警都**不改任何档**：探针键用完即删；桌面端只读。
 */
import { tr } from '../i18n/locale'

/** 探针键（网页版专用；写完立即删） */
const PROBE_KEY = 'whale:idle:storage-probe'

/** 体检结果 */
export interface SaveStorageProbe {
  /** 存档落在哪：桌面端 = 本机文件；网页版 = 本浏览器 */
  kind: 'file' | 'browser'
  /** 能不能写（网页版 = 探针写读删走通；桌面端 = 桥应答且列表可读） */
  ok: boolean
  /** 浏览器是否给了持久化（`navigator.storage.persisted()`；桌面端恒 true、量不到则 null） */
  persisted: boolean | null
}

let probe: SaveStorageProbe | null = null
/** 每局只提醒一次（两类告警各自一次） */
let warnedUnavailable = false
let warnedWriteFailed = false
const listeners = new Set<(msg: string) => void>()

/** App 挂载时订阅（返回值 = 退订） */
export function subscribeSaveAlert(cb: (msg: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(msg: string): void {
  for (const cb of listeners) cb(msg)
}

/** 启动体检（main.tsx 在 `engine.start()` **之前** await 一次） */
export async function probeSaveStorage(): Promise<SaveStorageProbe> {
  const desktop = typeof window !== 'undefined' && window.whale !== undefined
  if (desktop) {
    // 桌面端：只读探一次（列出备份即证明桥与数据目录都在；**不写**，免得碰到真档）
    let ok = false
    try {
      const r = await window.whale.listBackups()
      ok = r.ok
    } catch {
      ok = false
    }
    probe = { kind: 'file', ok, persisted: true }
    return probe
  }

  // 网页版：写-读-删走一遍（隐私窗口 / 禁用站点数据会在这里抛错）
  let ok = false
  try {
    const ls = window.localStorage
    ls.setItem(PROBE_KEY, '1')
    ok = ls.getItem(PROBE_KEY) === '1'
    ls.removeItem(PROBE_KEY)
  } catch {
    ok = false
  }
  probe = { kind: 'browser', ok, persisted: await readPersisted() }
  if (ok) void requestPersistentStorage() // 乙：能写就顺手申请持久化
  return probe
}

/** 读一次"是否已获持久化"（量不到 ⇒ null，界面不显示这一项） */
async function readPersisted(): Promise<boolean | null> {
  try {
    const s = navigator.storage
    if (!s || typeof s.persisted !== 'function') return null
    return await s.persisted()
  } catch {
    return null
  }
}

/** 已体检结果（未体检 ⇒ null；设置面板读它显示状态） */
export function saveStorageProbe(): SaveStorageProbe | null {
  return probe
}

/**
 * **乙 · 申请持久化存储**：Chromium 系会按"站点参与度"授予；Safari 没有 `persist` ⇒ 静默跳过。
 * 落盘成功后再调一次（参与度够了的那次才会真的授予）。
 */
export async function requestPersistentStorage(): Promise<void> {
  if (typeof window === 'undefined' || window.whale !== undefined) return
  try {
    const s = navigator.storage
    if (!s || typeof s.persist !== 'function') return
    if (probe && probe.persisted !== true) {
      await s.persist()
      probe = { ...probe, persisted: await readPersisted() }
    }
  } catch {
    /* 存储被禁：忽略（体检已经报过不可写） */
  }
}

/** **甲 · 启动体检不通**：每局提醒一次（App 订阅后弹提示） */
export function noteStorageUnavailable(): void {
  if (warnedUnavailable) return
  warnedUnavailable = true
  emit(tr('ui.saveGuard.008'))
}

/** **甲 · 写入失败**：每局提醒一次 */
export function noteSaveWriteFailed(): void {
  if (warnedWriteFailed) return
  warnedWriteFailed = true
  emit(tr('ui.saveGuard.009'))
}

/** 单测/探针用：清掉"每局一次"的标记（生产路径不调） */
export function resetSaveGuardForTest(): void {
  warnedUnavailable = false
  warnedWriteFailed = false
  probe = null
}
