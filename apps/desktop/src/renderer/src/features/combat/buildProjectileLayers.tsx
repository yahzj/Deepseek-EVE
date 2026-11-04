import { battleArcsFor } from '@whale/core'
/** 战斗界面职责：buildProjectileLayers，保持原调用顺序。 */

import type { CSSProperties } from 'react'

import type { DamageType } from '@whale/core'

import { DRONE_FLY_MUL, droneModelOrFallback } from './droneArt'

import { BOLT_LOOK, DMG_COLOR, POPUP_LIFE } from './battleViewCore'
import type { Dims, Anchor, BoltV, FlashV } from './battleViewCore'

export function buildProjectileLayers({ rowFxTags, layFx, multiMe, meAnchorByTag, arcs, tr, popupsRef, dims, popupClock, boltsRef, flashRef }: {
rowFxTags: string[]
layFx: { meLeft: number; foeLeft: number; me: Anchor; my: Anchor[]; foe: Anchor[]; sizes: number[]; foeBottom: number; formation: import('./battleViewCore').FoeFormation; usable: number; myBarW?: number; }
multiMe: boolean
meAnchorByTag: Map<string, Anchor>
arcs: NonNullable<ReturnType<typeof battleArcsFor>>
tr: (id: string, params?: Record<string, string | number>) => string
popupsRef: import('react').MutableRefObject<{ key: number; target: string; slot: number; x: number; y: number; born: number; amount: number; type: DamageType; miss: boolean; }[]>
dims: Dims
popupClock: number
boltsRef: import('react').MutableRefObject<BoltV[]>
flashRef: import('react').MutableRefObject<FlashV[]>
}) {
/**
   * **劫掠捕获网连线**（船长 2026-09-16：「动画效果为一根蓝色的光速连着命中舰船」）：
   * 与弹道**同一套几何**（锚点 + 夹角 + 长度），但**不发散也不消失**——只要引擎账本里还有这条网就一直画，
   * 击杀发动者后 `arcs.webLinks` 自然为空、连线当帧消失。样式沿用同级 `.app-bts-bolt` 那套（不新造机制）。
   * ⚠ 两端语义（船长 2026-09-17 定稿：「**亮端留在被钉舰、羽化端朝敌人**」）：
   * `from` = 发动者（劫掠电子舰 · 敌人）＝连线元素 0% 端 ⇒ **羽化淡出**；
   * `to` = 被钉住的我方舰 ＝ 100% 端 ⇒ **最亮 + 外发光**（渐变方向只在 `styles.css` 的 `.app-bts-web-bar`）。
   */
  const foeAnchorByTag = new Map<string, { x: number; y: number }>()
  rowFxTags.forEach((tag, i) => {
    const a = layFx.foe[i]
    if (a) foeAnchorByTag.set(tag, a)
  })
  const meAnchorOfTag = (tag: string): { x: number; y: number } | undefined =>
    multiMe ? meAnchorByTag.get(tag) : tag === 'player' ? layFx.me : undefined
  const webEls = (arcs.webLinks ?? []).flatMap((l) => {
    const from = foeAnchorByTag.get(l.from) ?? meAnchorOfTag(l.from)
    const to = meAnchorOfTag(l.to) ?? foeAnchorByTag.get(l.to)
    if (!from || !to) return []
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.max(8, Math.hypot(dx, dy))
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI
    return [
      <div
        key={`web-${l.from}-${l.to}`}
        data-web-from={l.from} data-web-to={l.to}
        className="app-bts-web"
        style={{ left: from.x, top: from.y, transform: `rotate(${ang}deg)` }}
        title={tr('ui.battleCycles.021', { from: l.fromName, to: l.toName, pct: Math.round(l.slowPct * 100) })}
      >
        <i className="app-bts-web-bar" style={{ width: len }} />
      </div>,
    ]
  })

  /**
   * 伤害飘字元素（存活 = 模块级 `POPUP_LIFE`，见 `battleViewCore`；战斗时钟口径 ⇒ 倍速跟着快、暂停冻结）。
   * ⚠ 常量**不许**写成这里的组件内 `const`：函数前段的清理 `.filter(...)` 会先读到它而崩（详见常量处注释）。
   */
  const popupEls = popupsRef.current.map((p) => {
    // `miss` = 本拍该目标**一点伤害都没有**（真未命中）；有伤害就出数字（同拍里夹杂未命中也不影响）
    const miss = p.miss
    return (
      <span
        key={`pop-${p.key}`}
        className={`app-bts-pop${miss ? ' is-miss' : ''}`}
        style={{
          left: `${Math.max(60, Math.min(dims.W - 60, p.x + ((p.slot % 3) - 1) * 100))}px`,
          top: `${Math.max(24, p.y - 76 - Math.floor(p.slot / 3) * 34)}px`,
          // 甲③：伤害数字用**伤害类型色**（与弹点同色），MISS 用灰色（--wui-dim，不新造色）
          color: miss ? 'rgb(var(--wui-dim))' : DMG_COLOR[p.type],
          animationDuration: `${POPUP_LIFE}ms`,
          animationDelay: `-${Math.max(0, popupClock - p.born)}ms`,
          animationPlayState: 'paused',
        }}
      >
        {miss ? tr('ui.BattleScreen.107') : `-${p.amount.toLocaleString('zh-CN')}`}
      </span>
    )
  })
  const boltEls = boltsRef.current.map((bv) => {
    const look = BOLT_LOOK[bv.type] ?? BOLT_LOOK.kinetic
    const color = bv.color
    const barBg =
      look.dash !== null
        ? `repeating-linear-gradient(90deg, ${color} 0 ${look.dash - 4}px, transparent ${look.dash - 4}px ${look.dash}px)`
        : `linear-gradient(90deg, ${color} 0%, ${color}cc 60%, transparent 100%)`
    const beamLine = bv.type === 'plasma' ? (
      <i
        className="app-bts-beamline"
        style={{
          width: bv.len,
          borderColor: color,
          boxShadow: `0 0 6px ${color}`,
          animationDuration: `${look.fly}ms`,
        }}
      />
    ) : null
    const dm = bv.drone ? droneModelOrFallback(bv.drone) : undefined
    // 无人机弹道（2026-09-10）：飞行时长按机型系数（哨戒更长、其余提速 DRONE_FLY_MUL）；
    // 蜂鸟/赤鸢/猎鹰 = 可见小曳光点（--fly = 行程 px）；哨戒 = 仿主舰的**细曳光条**（更细，不发小弹点）
    const flyMs = dm ? Math.max(60, Math.round(look.fly * (dm.bolt.flyMul ?? DRONE_FLY_MUL))) : look.fly
    if (dm && dm.bolt.style === 'beam') {
      return (
        <div key={bv.key} className={`app-bts-bolt is-${bv.type} is-drone is-sentry`} style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
          <i
            className="app-bts-bolt-bar"
            style={{
              width: bv.len,
              height: dm.bolt.width,
              top: -dm.bolt.width / 2,
              background: barBg,
              boxShadow: `0 0 6px ${color}`,
              animationDuration: `${flyMs}ms`,
              animationDelay: `${bv.delay ?? 0}ms`,
            }}
          />
          <i
            className={`app-bts-puff${bv.hit ? " is-hit" : " is-miss"} is-small`}
            style={{
              left: bv.len,
              top: 0,
              borderColor: color,
              boxShadow: `0 0 10px ${color}`,
              animationDelay: `${(bv.delay ?? 0) + flyMs}ms`,
              animationDuration: bv.type === 'plasma' ? '180ms' : '420ms',
            }}
          />
        </div>
      )
    }
    if (dm) {
      return (
        <div key={bv.key} className={`app-bts-bolt is-${bv.type} is-drone`} style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
          <i
            className="app-bts-bolt-dot"
            style={
              {
                background: color,
                boxShadow: `0 0 6px ${color}, 0 0 12px ${color}66`,
                animationDuration: `${flyMs}ms`,
                animationDelay: `${bv.delay ?? 0}ms`,
                '--fly': `${Math.max(24, bv.len)}px`,
                '--dot': `${dm.bolt.width + 3}px`,
              } as CSSProperties
            }
          />
          <i
            className={`app-bts-puff${bv.hit ? " is-hit" : " is-miss"} is-small`}
            style={{
              left: bv.len,
              top: 0,
              borderColor: color,
              boxShadow: `0 0 10px ${color}`,
              animationDelay: `${(bv.delay ?? 0) + flyMs}ms`,
              animationDuration: bv.type === 'plasma' ? '180ms' : '420ms',
            }}
          />
        </div>
      )
    }
    return (
      <div key={bv.key} className={`app-bts-bolt is-${bv.type}`} style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
        <i
          className="app-bts-bolt-bar"
          style={{
            width: bv.len,
            height: bv.type === 'plasma' ? 1 : bv.type === 'explosive' ? 6 : 4,
            top: bv.type === 'plasma' ? 0 : -2,
            background: barBg,
            boxShadow: `0 0 8px ${color}`,
            animationDuration: `${look.fly}ms`,
          }}
        />
        {beamLine}
        <i
          className={`app-bts-puff${bv.hit ? " is-hit" : " is-miss"}`}
          style={{
            left: bv.len,
            top: 0,
            borderColor: color,
            boxShadow: `0 0 10px ${color}`,
            animationDelay: `${look.fly}ms`,
            animationDuration: bv.type === 'plasma' ? '180ms' : '420ms',
          }}
        />
      </div>
    )
  })
  const muzzleEls = flashRef.current.map((f) => (
    <i
      key={f.key}
      className={`app-bts-muzzle${f.small ? " is-small" : ""}`}
      style={{
        left: f.x,
        top: f.y,
        color: f.color,
        animationDelay: `${f.delay ?? 0}ms`,
      }}
    />
  ))
return { webEls, popupEls, boltEls, muzzleEls }
}
