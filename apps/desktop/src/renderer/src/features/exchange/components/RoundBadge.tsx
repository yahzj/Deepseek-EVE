/**
 * 回合倒计时徽标（回合制交易舱的公共时钟）。
 *
 * 为什么单独成件：回合制下「距结算还有多久」「本回合还能下几单」是跨面板的公共读数，
 * 顶栏徽标是唯一不随视图模式（极简 / 专业）切换的位置；逻辑独立也避免 `ExchangePage` 继续变胖。
 *
 * 数据来源：`client.getRound()`（可选方法，Mock 不实现 ⇒ 模拟盘直接不渲染）。
 * - 挂载后每 1000ms 拉一次 `/round`，剩余时间 = 服务端 `nextRoundAt` − 校准后的本地时间；
 * - `serverTime` 只在首次成功响应时校准一次偏移，避免每秒重算带来的倒计时抖动；
 * - `roundNo` 变化时回调 `onNewRound()`，由页面复用现有的 bump（重渲染 / 重拉快照）机制；
 * - 卸载时清 interval，离开页面后不再继续打接口。
 */
import { useEffect, useRef, useState } from 'react'
import type { ExchangeClient, RoundInfo } from '../client'
import { T, TF } from '../texts'

/** 轮询间隔：与倒计时刷新同频，1 秒一次 */
const POLL_MS = 1_000

/** 剩余毫秒 → mm:ss（向上取整，避免刚进新回合就显示少 1 秒） */
function formatMmss(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1_000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`
}

export interface RoundBadgeProps {
  client: ExchangeClient
  /** 进入新回合：页面重拉快照 / 重渲染（复用 ExchangePage 的 bump） */
  onNewRound: () => void
}

export function RoundBadge({ client, onNewRound }: RoundBadgeProps) {
  const supportsRound = typeof client.getRound === 'function'
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [now, setNow] = useState(() => Date.now())
  /** 服务器时间 − 本机时间（毫秒）：首次成功响应校准一次，之后沿用 */
  const offsetRef = useRef<number | null>(null)
  const lastRoundNoRef = useRef<number | null>(null)
  const onNewRoundRef = useRef(onNewRound)
  onNewRoundRef.current = onNewRound

  useEffect(() => {
    const fetchRound = client.getRound
    if (typeof fetchRound !== 'function') return
    let alive = true
    let inflight = false

    const poll = (): void => {
      // 上一发还没回来就跳过本轮，避免慢请求乱序覆盖新回合读数
      if (inflight) return
      inflight = true
      fetchRound
        .call(client)
        .then((info) => {
          if (!alive) return
          if (offsetRef.current === null) offsetRef.current = info.serverTime - Date.now()
          if (lastRoundNoRef.current !== null && lastRoundNoRef.current !== info.roundNo) {
            onNewRoundRef.current()
          }
          lastRoundNoRef.current = info.roundNo
          setRound(info)
        })
        .catch(() => {
          // 网络抖动：保留上一份读数，本地倒计时照常走，等下一次轮询
        })
        .finally(() => {
          inflight = false
        })
    }

    poll()
    const timer = setInterval(() => {
      setNow(Date.now())
      poll()
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [client])

  // 模拟盘 / 尚未拿到首帧：不占位
  if (!supportsRound || round === null) return null

  const serverNow = now + (offsetRef.current ?? 0)
  const remainingMs = Math.max(0, round.nextRoundAt - serverNow)
  const lockMs = Math.max(0, round.lockSec) * 1_000
  const locked = round.locked || remainingMs <= lockMs
  /** 锁定前 30 秒进黄色提醒档：只变色不闪，锁定档才红色闪烁（2026-11-04 船长令） */
  const warn = !locked && remainingMs <= 30_000
  const mmss = formatMmss(remainingMs)
  const usedOrders = Math.max(0, Math.round(round.usedOrders ?? 0))
  const maxOrders = Math.max(1, Math.round(round.maxOrders))

  return (
    <div className="ex-round-badge-group">
      <span
        className={`ex-source-badge ex-round-clock-badge${locked ? ' is-locked' : warn ? ' is-warn' : ''}`}
        title={locked ? T.roundLockedHint : T.roundBadgeHint}
        role="timer"
      >
        <span className="ex-round-clock">
          {locked ? `${T.roundLocked} ${mmss}` : `${T.roundSettleIn} ${mmss}`}
        </span>
      </span>
      <span
        className="ex-source-badge ex-round-quota-badge"
        title="本回合剩余委托笔数（每回合上限 10 笔）"
      >
        <span className="ex-round-quota">{TF.roundQuota(usedOrders, maxOrders)}</span>
      </span>
    </div>
  )
}
