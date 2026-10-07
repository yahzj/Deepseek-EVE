import type { ComponentProps } from 'react'
import { ShipSprite } from '../ui/ShipSprite'
import { mountsOf } from '../ui/shipMounts'

/** 战斗专用舰影；缺省不加速，非战斗组件保持原样。 */
export function BattleShipSprite({ acceleration, ...props }: ComponentProps<typeof ShipSprite> & {
  acceleration?: 'boost' | 'charge'
}) {
  const size = props.size ?? 150
  const active = props.engine !== false ? acceleration : undefined
  const mounts = active ? mountsOf(props.shipId, props.foeKey) : undefined
  // 未录挂点沿用舰影的单喷口回退；显式空喷口的有机体不造机械喷焰。
  const engines = mounts?.engines ?? [{ x: 29, y: 51.6 }]
  return (
    <span className="app-bts-ship" data-acceleration={active} style={{ width: size, height: Math.round(size * .46) }}>
      <ShipSprite {...props} engine={active ? false : props.engine} />
      {active ? (
        <svg className={`app-bts-acceleration is-${active}`} viewBox="0 0 240 110" aria-hidden="true">
          <g style={{ color: props.accent, transform: `scale(${props.flip ? -1 : 1}, 1)`, transformOrigin: '120px 55px' }}>
            {engines.map((port, index) => (
              <g key={index} transform={`translate(${port.x - 5} ${port.y})`}>
                <g className="accel-flame">
                  <path className="accel-core" d="M0 -4 L-17 -6 L-34 0 L-17 6 L0 4 Z" />
                  <path className="accel-edge" d="M0 -8 L-20 -10 L-43 0 L-20 10 L0 8" />
                </g>
              </g>
            ))}
            <g className="accel-lines">
              {active === 'charge' ? (
                <>
                  <path d="M12 9 L66 9 L76 14 M30 101 L82 101 L92 96 M51 3 L103 3" />
                  <path className="accel-bow" d="M185 14 L211 25 L194 29 M185 96 L211 85 L194 81" />
                </>
              ) : <path d="M16 14 L58 14 M27 96 L69 96 M42 7 L76 7" />}
            </g>
          </g>
        </svg>
      ) : null}
    </span>
  )
}
