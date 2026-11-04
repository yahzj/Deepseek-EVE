import { useRef, type ReactNode } from 'react'
import { useSessionScrollFrom } from '../../ui/sessionView'
import '../../styles-unbox-ledger.css'

/**
 * **工业页的一个子页容器**（2026-09-26）——保活用的 `.ind-pane` ＋ **主列表滚动位置的会话级记忆**。
 *
 * 为什么单开这个小件：滚动体在四个面板里形态不一（精炼炉/造船厂是面板内的 `.app-win-body`，
 * 组装机/蓝图货架是 `Panel` 自己的 `.wui-panel-body`）⇒ 统一由 `useSessionScrollFrom` 从这一层
 * **自→祖先→后代**反查，页面侧不必逐面板知道细节。
 *
 * ⚠ 钩子必须**无条件调用**（Hook 规则）⇒ 这个小件一律渲染 `.ind-pane` 本体（`display: contents`，
 * 布局与改造前逐像素一致），显示与否只由 `off` 决定类名。
 */
export function IndPane({ scrollKey, off, children }: { scrollKey: string; off: boolean; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useSessionScrollFrom(scrollKey, ref)
  return (
    <div className={`ind-pane${off ? ' is-off' : ''}`} ref={ref}>
      {children}
    </div>
  )
}
