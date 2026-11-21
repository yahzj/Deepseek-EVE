import { battleArcsFor } from '@whale/core'

import type { CSSProperties, ReactNode } from 'react'
import { foeShipIdOfTag } from '@whale/core'

import { foeAcidRowsOf } from '@whale/core'

import { BattleShipSprite } from './battleShipFx'

import { FOE_ACCENT } from '../../ui/shipArt'
import { UI_TONES } from '../../ui/tones'

import { Glyph, ICO_TONES } from '../../ui/Glyphs'

import { LAY, foeHangarByTag, foeHangarTotal, foeRowBoxesOf, BOOM_LIFE, clamp01, HpTri } from './battleViewCore'

import { hoverTipProps } from '../../ui/Tooltip'

export function buildEnemyLayers({
    arcs, foeRowTags, isFoeMainTag, battle, tr, lay,
    foeFormation, foeBarGeoms, foeAnomaly, corpseAtRef, now, acidDeathsRef,
    combat, blinkSegOfSide, WRECK_FADE_MS, foeArriving, arriveDxFoe, ARRIVAL_FLY_MS,
    arrivalSide, ARRIVAL_STAGGER_MS, foeKey, foeFlip, foeNameOf,
  }: {
arcs: NonNullable<ReturnType<typeof battleArcsFor>>
foeRowTags: string[]
isFoeMainTag: (tag: string) => boolean
battle: import('@whale/core').BattleState
tr: (id: string, params?: Record<string, string | number>) => string
lay: ReturnType<typeof import('./battleViewCore').layout>
foeFormation: import('./battleViewCore').FoeFormation
foeBarGeoms: import('./battleViewCore').BarGeom[]
foeAnomaly: import('@whale/core').AnomalyDef | undefined
corpseAtRef: import('react').MutableRefObject<Map<string, number>>
now: number
acidDeathsRef: import('react').MutableRefObject<Set<string>>
combat: { distanceM: number; myDesireM: number; meHp: { s: number; a: number; h: number; }; foeHp: Record<string, { s: number; a: number; h: number; name: string; }>; shots: number; hits: number; lockTag: string | null; }
blinkSegOfSide: (side: "foe" | "me") => { vanish: number; move: number; appear: number; segMs: number; } | undefined
WRECK_FADE_MS: 520
foeArriving: (tag: string) => boolean
arriveDxFoe: (i: number) => number
ARRIVAL_FLY_MS: 950
arrivalSide: "me" | "foe" | null
ARRIVAL_STAGGER_MS: 60
foeKey: string
foeFlip: boolean
foeNameOf: (tag: string) => string
}) {
  const hangarByTag = foeHangarByTag(arcs.foeDrones ?? [])
  const hangarTotal = foeHangarTotal(arcs.foeDrones ?? [])
  const hangarCarrierTag =
    foeRowTags.find((t) => isFoeMainTag(t) && (hangarByTag.get(t) ?? 0) > 0) ??
    foeRowTags.find((t) => (hangarByTag.get(t) ?? 0) > 0) ??
    null
  const hangarBadgeOf = (tag: string): ReactNode => {
    const hatchery = battle.foeHatcheries?.[tag]
    const hp = battle.units[tag]?.hp
    if (hatchery && hp && hp.s + hp.a + hp.h > 0) return <span className="app-bts-hangar" title={tr('ui.alien.005', { p1: hatchery.left === 'unlimited' ? tr('ui.alien.006') : hatchery.left, p2: hatchery.revived })}><span className="app-ico"><Glyph name="drone-rack" size={11} color={ICO_TONES['drone-rack']} /></span>×{hatchery.left === 'unlimited' ? '\u221e' : hatchery.left}</span>
    if (tag !== hangarCarrierTag || hangarTotal <= 0) return null
    return (
      <span
        className="app-bts-hangar"
        title={tr("ui.BattleScreen.035")}
      >
        <span className="app-ico">
          <Glyph name="drone-rack" size={11} color={ICO_TONES['drone-rack']} />
        </span>
        ×{hangarTotal}
      </span>
    )
  }

  const acidRows = new Map(foeAcidRowsOf(battle).map(row => [row.tag, row]))
  const foeUnitEls = foeRowTags.map((tag, rowIdx) => {
    const acid = acidRows.get(tag)
    const isMain = isFoeMainTag(tag)
    const size = lay.sizes[rowIdx] ?? LAY.MAIN
    const slot = foeFormation.slots[rowIdx] ?? { col: 0, row: 0 as const, dx: 0, raise: 0 }
    const isRank2 = !lay.dense && slot.row === 1
    const bar = foeBarGeoms[rowIdx] ?? { width: 185, dx: 0, dy: 0 }
    const foeShipId = foeShipIdOfTag(foeAnomaly, tag)
    const ba = corpseAtRef.current.get(tag)
    const sinceBoom = ba === undefined ? -1 : now - ba
    const corpseOn = sinceBoom >= 0
    const acidDeath = acidDeathsRef.current.has(tag)
    const locked = !corpseOn && tag === combat.lockTag
    const blinkSeg = blinkSegOfSide('foe')
    const blinkAnimMs = blinkSeg === undefined ? 0 : blinkSeg.segMs / 3
    const blinkOut = blinkSeg !== undefined && now >= blinkSeg.vanish && now < blinkSeg.move
    const blinkWait = blinkSeg !== undefined && now >= blinkSeg.move && now < blinkSeg.appear
    const blinkOn = false
    const boomLive = corpseOn && sinceBoom < BOOM_LIFE
    const fadeT = sinceBoom >= BOOM_LIFE ? clamp01((sinceBoom - BOOM_LIFE) / WRECK_FADE_MS) : 0
    const arriving = foeArriving(tag)
    return (
      <div
        key={tag}
        data-tag={tag}
        className={`app-bts-unit${corpseOn ? ' is-corpse' : ''}${locked ? ' is-locked' : ''}${arriving ? ' is-arriving' : ''}${blinkOn ? ' is-blink' : ''}${blinkOut ? ' is-blink-out' : ''}${blinkWait ? ' is-blink-hidden' : ''}`}
        style={{
          width: foeFormation.colW[slot.col] ?? size,
          ...(lay.dense ? { position: 'absolute' as const, left: lay.foe[rowIdx]!.x - lay.foeLeft - size / 2,
            top: lay.foe[rowIdx]!.y - LAY.TOP - size * .23, width: size } : {}),
          justifyContent: 'center',
          flexShrink: 0,
          ...(arriving
            ? ({
                '--arrive-dx': `${arriveDxFoe(rowIdx)}px`,
                '--arrive-ms': `${ARRIVAL_FLY_MS}ms`,
                // 逐舰错峰：首波仍按行序（`arrivalSide` 那档，与改造前一致）；此后**已烘进 `enteredAtMs`**
                // （引擎写的就是"本条舰的入场时刻"）⇒ 界面不再重复叠一层延迟
                '--arrive-delay': `${arrivalSide === 'foe' ? rowIdx * ARRIVAL_STAGGER_MS : 0}ms`,
              } as CSSProperties)
            : {}),
          /**
           * **闪现的"消失"淡出时长**（**船长 2026-10-02 旋钮**）：只在消失段给 `--blink-ms`
           * （= 整段的 1/3），三份 `styles*.css` 的 `app-bts-blink-out` 读它
           * ⇒ **改 `balance.battle.foeBlinkProcessMs` 就够，界面零改动**。
           */
          ...(blinkOut ? ({ '--blink-ms': `${blinkAnimMs}ms` } as CSSProperties) : {}),
        }}
      >
        {/* 淡出作用于舰体容器（外层 .app-bts-unit 有入场动画 fill 占位，透明度须压在子层）；
            尸骸灰化 = accent 传灰（2026-09-10 性能：不再用 CSS 滤镜重新栅格化整份舰体矢量） */}
        <span className="app-bts-corpse" style={acidDeath && corpseOn ? { opacity: 0 } : fadeT > 0 ? { opacity: Math.max(0, 1 - fadeT) } : undefined}>
          <BattleShipSprite
            shipId={foeShipId ?? undefined}
            foeKey={foeKey}
            flip={foeFlip}
            accent={corpseOn ? UI_TONES.corpse : FOE_ACCENT[foeKey] ?? '#ff8373'}
            size={size}
            acceleration={arcs.foeChargingTags.includes(tag) ? 'charge' : undefined}
          />
        </span>
        {/**
         * 🔴 **闪现光柱不在 JSX 里**（**2026-10-02 两次实机报障「并没有看到特效」/「特效依旧不存在」后的定型**）——
         * 它由 **RAF 循环**的 `planBlinkPillars`（按引擎 `foeBlinkQueue` 排期）＋ `syncBlinkPillarDom`
         * （到点建/按时摘）直接操作 DOM：**排期不经过 React**（闪现时双方机动常常都归零 ⇒ 距离不变
         * ⇒ 不重渲染），**DOM 也不挂在本单位里**（本单位在等待段 `opacity: 0`，子元素会被一起压成全透明
         * ⇒ 挂列盒当兄弟节点）。形状（52 道竖线 / 渐变 / 上下渐隐）见模块级的 `buildBlinkPillarEl`。
         */}
        {/* 舰名：**第一排**浮在舰体上方（与改动前一致）；**第二排**（其上方是第一排的舰体）改由该舰血条标签承载
            机库备用机（图标 ×N）跟在**各自的名字右边**（2026-09-12 船长） */}
        {!isRank2 ? (
          <span className="app-bts-name" title={foeNameOf(tag)} style={{ color: isMain ? UI_TONES.foeNameMain : UI_TONES.foeName,
            ...(lay.dense && foeRowTags.length > 4 ? { maxWidth: Math.min(110, foeFormation.colW[slot.col]! - 8) } : {}) }}>
            {locked ? `◈ ${foeNameOf(tag)}` : foeNameOf(tag)}
            {hangarBadgeOf(tag)}
          </span>
        ) : null}
        {acid || (arcs.webLinks ?? []).some(link => link.to === tag) ? <span className="app-bts-web-status"
          {...hoverTipProps(<>{acid ? <div>{tr('ui.alienLoot.005', { p1: acid.name, p2: acid.count, p3: acid.nextSeconds })}</div> : null}{(arcs.webLinks ?? []).filter(link => link.to === tag).map(link => <div key={link.from}>
            {tr('ui.battleCycles.021', { from: link.fromName, to: link.toName, pct: Math.round(link.slowPct * 100) })}
          </div>)}</>)}>{acid ? tr('ui.alienLoot.001') : tr('ui.battleCycles.022')}</span> : null}
        {/* 血条（2026-09-11 船长③）：贴在本舰正下方（绝对定位，不参与行内布局）；
            尸骸不显示血条（与改造前"只给存活单位画条"一致） */}
        {!corpseOn ? (
          <span
            className="app-bts-hpWrap is-unitBar"
            style={lay.dense ? { width: Math.min(112, foeFormation.colW[slot.col]! - 8), marginTop: 2 } : { width: bar.width, marginLeft: bar.dx, marginTop: bar.dy + 2 }}
          >
            <HpTri
              hp={combat.foeHp[tag]!}
              max={arcs.maxHp.foe[tag] ?? { s: 0, a: 0, h: 0 }}
              label={
                isRank2 ? (
                  <>
                    {locked ? '◈ ' : ''}
                    {foeNameOf(tag)}
                    {hangarBadgeOf(tag)}
                  </>
                ) : undefined
              }
            />
          </span>
        ) : null}
        {/* 敌方机群由**机群层**统一出海（第二层，见 `.app-bts-drones` 内的 foeWings 渲染） */}
        {boomLive && !acidDeath ? (
          <span className="app-bts-boom">
            <i className="b-core" />
            <i className="b-ring" />
            <i className="b-ring r2" />
          </span>
        ) : null}
      </div>
    )
  })

  const foeRowBoxes = (row: 0 | 1): ReactNode[] =>
    lay.dense ? (row === 0 ? foeUnitEls : []) : foeRowBoxesOf(foeFormation, row, foeRowTags.length).map((b) => (
      <div
        key={b.col}
        style={{ width: b.width, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', flexShrink: 0 }}
      >
        {b.unit >= 0 ? foeUnitEls[b.unit] : null}
      </div>
    ))
return { foeRowBoxes }
}
