import { useEffect, useRef, useState } from 'react'
import type { ExchangeClient, RoundInfo } from '../client'
import { T, TF } from '../texts'

const POLL_MS = 1_000
const REFRESH_CD_MS = 10_000

function formatMmss(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1_000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`
}

export interface RoundBadgeProps {
  client: ExchangeClient
  onNewRound: () => void
  onRefreshMarket?: () => void
}

export function RoundBadge({ client, onNewRound, onRefreshMarket }: RoundBadgeProps) {
  const supportsRound = typeof client.getRound === 'function'
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [lastRefreshAt, setLastRefreshAt] = useState(0)
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

  if (!supportsRound || round === null) return null

  const serverNow = now + (offsetRef.current ?? 0)
  const remainingMs = Math.max(0, round.nextRoundAt - serverNow)
  const lockMs = Math.max(0, round.lockSec) * 1_000
  const locked = round.locked || remainingMs <= lockMs
  const warn = !locked && remainingMs <= 30_000
  const mmss = formatMmss(remainingMs)
  const usedOrders = Math.max(0, Math.round(round.usedOrders ?? 0))
  const maxOrders = Math.max(1, Math.round(round.maxOrders))

  const refreshable = typeof onRefreshMarket === 'function'
  const cooling = refreshable && now - lastRefreshAt < REFRESH_CD_MS
  const badgeClass = `ex-source-badge ex-round-clock-badge${locked ? ' is-locked' : warn ? ' is-warn' : ''}`
  const badgeTitle = locked ? T.roundLockedHint : T.roundBadgeHint
  const clock = (
    <span className="ex-round-clock">
      {locked ? `${T.roundLocked} ${mmss}` : `${T.roundSettleIn} ${mmss}`}
    </span>
  )

  return (
    <div className="ex-round-badge-group">
      {refreshable ? (
        <button
          type="button"
          className={badgeClass}
          title={badgeTitle}
          disabled={cooling}
          onClick={() => {
            if (cooling) return
            setLastRefreshAt(Date.now())
            onRefreshMarket?.()
          }}
        >
          {clock}
        </button>
      ) : (
        <span className={badgeClass} title={badgeTitle} role="timer">
          {clock}
        </span>
      )}
      <span
        className="ex-source-badge ex-round-quota-badge"
        title="本回合剩余委托笔数（每回合上限 10 笔）"
      >
        <span className="ex-round-quota">{TF.roundQuota(usedOrders, maxOrders)}</span>
      </span>
    </div>
  )
}
