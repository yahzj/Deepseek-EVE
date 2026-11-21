import { useRef, type ReactNode } from 'react'
import { useSessionScrollFrom } from '../../ui/sessionView'
import '../../styles-unbox-ledger.css'

export function IndPane({ scrollKey, off, children }: { scrollKey: string; off: boolean; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useSessionScrollFrom(scrollKey, ref)
  return (
    <div className={`ind-pane${off ? ' is-off' : ''}`} ref={ref}>
      {children}
    </div>
  )
}
