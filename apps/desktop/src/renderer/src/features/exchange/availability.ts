/**
 * 交易所可用性探测（2026-11-09 船长令：服务器没有了要能「一键关闭股票系统」）。
 *
 * 机制：客户端周期探测交易所公开端点 `/api/exchange/meta`；**连续失败 3 次**判定不可用，
 * 主导航与活动栏的股市入口自动隐藏；服务恢复后下一次探测成功即自动出现。
 * 因此「一键关闭」= 停掉交易所服务（或断开其端口）——玩家端入口自动消失，无需发版。
 *
 * 探测路径为什么不用 `/health`：nginx 只把 `/api/exchange/` 转发给交易所（8788），
 * 根路径 `/health` 落到 Node 主服务（8787）——Node 活着时它永远 200，测不出交易所死活。
 * 探测走 RendererTransport（与交易所客户端同一通道，含主备地址回退），守「不直接 fetch」约定。
 *
 * 未知状态（首次探测未完成）按「可用」处理，避免入口首帧闪现后消失。
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_CLOUD_SERVER, FALLBACK_CLOUD_SERVER, readCloudPreferences } from '../cloud/preferences'
import { RendererTransport } from './http/RendererTransport'

const PROBE_INTERVAL_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000
const FAIL_THRESHOLD = 3

let available = true
let failures = 0
let started = false
let timer: number | null = null
const listeners = new Set<() => void>()

function setAvailable(next: boolean): void {
  if (available === next) return
  available = next
  for (const callback of listeners) callback()
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('exchange probe timeout')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timeout)
        reject(err)
      },
    )
  })
}

async function probe(): Promise<void> {
  const prefs = readCloudPreferences()
  const configured = typeof prefs.server === 'string' ? prefs.server.trim() : ''
  const serverUrl = configured === '' ? DEFAULT_CLOUD_SERVER : configured
  try {
    const transport = new RendererTransport({
      serverUrl,
      fallbackServerUrl: FALLBACK_CLOUD_SERVER,
      allowAnonymous: true,
    })
    await withTimeout(transport.request({ method: 'GET', path: '/api/exchange/meta' }), PROBE_TIMEOUT_MS)
    failures = 0
    setAvailable(true)
  } catch {
    failures += 1
    if (failures >= FAIL_THRESHOLD) setAvailable(false)
  }
}

function ensureStarted(): void {
  if (started) return
  started = true
  void probe()
  timer = window.setInterval(() => {
    void probe()
  }, PROBE_INTERVAL_MS)
}

function subscribe(callback: () => void): () => void {
  ensureStarted()
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
    // 定时器保持全局运行：入口在多处订阅，全部卸载（切出游戏）也不中断探测，
    // 否则再次进入时会先用旧的可用状态渲染。
  }
}

function getSnapshot(): boolean {
  return available
}

/** 交易所当前是否可用（入口据此显示/隐藏）。 */
export function useExchangeAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** 诊断/测试用：重置探测状态。 */
export function resetExchangeAvailabilityForTest(): void {
  available = true
  failures = 0
  started = false
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  listeners.clear()
}
