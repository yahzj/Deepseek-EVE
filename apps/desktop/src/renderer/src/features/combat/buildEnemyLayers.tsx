import { battleArcsFor } from '@whale/core'
/** 战斗界面职责：buildEnemyLayers，保持原调用顺序。 */

import type { CSSProperties, ReactNode } from 'react'
import { foeShipIdOfTag } from '@whale/core'

import { foeAcidRowsOf } from '@whale/core'

import { BattleShipSprite } from './battleShipFx'

import { FOE_ACCENT } from '../../ui/shipArt'
import { UI_TONES } from '../../ui/tones'

import { Glyph, ICO_TONES } from '../../ui/Glyphs'

import { LAY, foeHangarByTag, foeHangarTotal, foeRowBoxesOf, BOOM_LIFE, clamp01, HpTri } from './battleViewCore'
import type { Anchor } from './battleViewCore'

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
lay: { meLeft: number; foeLeft: number; me: Anchor; my: Anchor[]; foe: Anchor[]; sizes: number[]; foeBottom: number; formation: import('./battleViewCore').FoeFormation; usable: number; myBarW?: number; }
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
/**
   * **机库备用机**（2026-09-12 船长：「关于战斗画面的后备机库，将其显示在名字边上，采用图标乘以数字的形式」
   * → 追加选定「**乙**：显示**全队合计**」）。
   *
   * 引擎按舰报 `hangar`（在库待命、战损后按 `respawnMs` 满血放出的架数）。
   * ⚠ **按舰取一次、不能累加**：同一艘舰的多个机型条目上带的是**同一个按舰数值**
   *   （`battleView` 里 `hangarN` 是每舰一个，却盖在 `byArt` 的**每一条**上）⇒ 逐条累加会翻倍。
   * 显示口径 = **全队合计**（各舰之和，如奥罗 = 5+5+5 = 15）挂在**主体**名字右边的「图标 ×N」上
   *   （主体不带库时退首个带库的舰；无备用机不占位）；图标用既有 `drone-rack`。
   */
  const hangarByTag = foeHangarByTag(arcs.foeDrones ?? [])
  const hangarTotal = foeHangarTotal(arcs.foeDrones ?? [])
  const hangarCarrierTag =
    foeRowTags.find((t) => isFoeMainTag(t) && (hangarByTag.get(t) ?? 0) > 0) ??
    foeRowTags.find((t) => (hangarByTag.get(t) ?? 0) > 0) ??
    null
  const hangarBadgeOf = (tag: string): ReactNode => {
    const hatchery = battle.foeHatcheries?.[tag]
    const hp = battle.units[tag]?.hp
    // ⟪文案调整 2026-10-06⟫ 无限模式用符号显示，避免开发侧枚举直接出现在玩家界面。
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

  /* 敌方单位行（2026-09-09 二轮：存活单位 + 演出期尸骸同队列渲染）——
     尸骸占原槽整段演出：boomAt（致死弹道着弹）前原样停留 → 灰化 + 爆炸环 → 原位淡出；
     撤出只发生在整批尸骸全部演完的瞬间（一次收拢，见 scanDroppable），存活舰补位收拢
     不再压着爆炸/淡出动画走，多个单位同时阵亡也不再互相挤位叠加。
     2026-09-10 性能修复（船长"击毁敌人后画面明显卡顿"）：存活与尸骸**共用同一套 DOM 结构**
     （此前两个分支结构不同 → 击毁瞬间整份舰体 SVG 被卸载重建，正是卡顿主因）——
     现只切换 class（is-corpse）与淡出透明度，舰体矢量始终不被重建。 */
  /** 敌方机群（2026-09-11 机群批 S5）：按敌单位 tag 取该舰的警戒机群（机型 / 机库 / 现存架数）＋
   *  **逐舰体积/血条几何**（主树 2026-09-11 舰种体积 + 血条跟舰；2026-09-12 斜向菱形阵形） */
  const acidRows = new Map(foeAcidRowsOf(battle).map(row => [row.tag, row]))
  const foeUnitEls = foeRowTags.map((tag, rowIdx) => {
    const acid = acidRows.get(tag)
    const isMain = isFoeMainTag(tag)
    /** 该舰体积（px；2026-09-11 舰种体积 = 舰级档阶梯，旧路径卡回落 170/90） */
    const size = lay.sizes[rowIdx] ?? LAY.MAIN
    /** 该舰机位（2026-09-12 斜向菱形：第 2/4/6… 艘在第二排＝右移半格 + 下移一个舰高） */
    const slot = foeFormation.slots[rowIdx] ?? { col: 0, row: 0 as const, dx: 0, raise: 0 }
    /** 第二排：舰名改由血条标签承载（浮空舰名会压在**第一排**的舰体上） */
    const isRank2 = slot.row === 1
    /** 该舰血条几何（2026-09-11 船长③：血条跟着各舰走——贴各自舰下，拥挤时该排内竖排） */
    const bar = foeBarGeoms[rowIdx] ?? { width: 185, dx: 0, dy: 0 }
    /** 该舰**舰级 id**（2026-09-26：逐舰线稿按舰级 id 取形——30 条敌舰各画各的，
     *  同一场里"主舰/护卫/电子舰"不再共用一张族形。旧路径卡（无 `anomaly.ships`）→ null ⇒ 回落族形） */
    const foeShipId = foeShipIdOfTag(foeAnomaly, tag)
    const ba = corpseAtRef.current.get(tag)
    const sinceBoom = ba === undefined ? -1 : now - ba
    const corpseOn = sinceBoom >= 0 // 致死弹道着弹后才是真尸骸；着弹前原样停留
    const acidDeath = acidDeathsRef.current.has(tag)
    const locked = !corpseOn && tag === combat.lockTag
    /**
     * 🔴 **闪现跃迁演出 · 三段**（**船长 2026-10-01 原话 ＋ 2026-10-02 实机修正**）：
     *
     * > 「**发生过程需要搭配动画效果：闪现开始-播放动画的同时舰船消失-等待发生时间-在新位置播放动画
     * > 同时舰船出现**」＋「**我原先中间插入的发生时间等待怎么被取消了？移动的时间节点应该放在
     * > 发生时间的等待处**」
     *
     * 三段**各占整段的 1/3**（时刻由引擎给，见 fx 登记那处）：
     * - `blinkHide`：**消失**段（`vanish → move`）——淡出，且**位置仍是旧位置**；
     * - 中间段（`move → appear`）：**不可见**（不挂任何类 ⇒ 无动画 ⇒ 停在已换好的新位置且全透明）；
     * - `blinkOn`：**出现**段（`appear → appear + 1/3`）——在新位置淡入。
     */
    const blinkSeg = blinkSegOfSide('foe')
    /** 消失段动画时长 = 整段的 1/3（出现段已按船长令取消动画） */
    const blinkAnimMs = blinkSeg === undefined ? 0 : blinkSeg.segMs / 3
    /** ① 消失段（`vanish → move`）：播淡出，**位置仍是旧位置** */
    const blinkOut = blinkSeg !== undefined && now >= blinkSeg.vanish && now < blinkSeg.move
    /** ② 等待段（`move → appear`）：**不可见**（引擎已在这一瞬把位置换好） */
    const blinkWait = blinkSeg !== undefined && now >= blinkSeg.move && now < blinkSeg.appear
    /**
     * ③ **出现：不再播任何动画**（**船长 2026-10-02 令**：「**既然基线动画重新生效会再播一遍，那么就取消
     * ③ 出现部分的视觉表现**」）——到点**直接显示**在新位置，视觉交给两根光柱。
     *
     * ⚠ 光柱**不走这里**（**2026-10-02 两次实机报障后的定型**：船长「并没有看到特效」/「特效依旧不存在」）——
     * 它由 **RAF 循环**的 `planBlinkPillars` ＋ `syncBlinkPillarDom` 排期并建 DOM，
     * 而且**挂在列盒**上（不是本单位里：本单位在等待段 `opacity: 0`，子元素会被一起压成全透明）。
     */
    const blinkOn = false
    const boomLive = corpseOn && sinceBoom < BOOM_LIFE
    const fadeT = sinceBoom >= BOOM_LIFE ? clamp01((sinceBoom - BOOM_LIFE) / WRECK_FADE_MS) : 0
    /** 本舰是否正在**飞入**（逐舰入场：首波按 `arrivalSide`，此后按引擎 `enteredAtMs`） */
    const arriving = foeArriving(tag)
    return (
      <div
        key={tag}
        data-tag={tag}
        className={`app-bts-unit${corpseOn ? ' is-corpse' : ''}${locked ? ' is-locked' : ''}${arriving ? ' is-arriving' : ''}${blinkOn ? ' is-blink' : ''}${blinkOut ? ' is-blink-out' : ''}${blinkWait ? ' is-blink-hidden' : ''}`}
        /* 列盒内的水平居中 + **舰位与锚点同源**（2026-09-25 修船长报障「第二排右舰血条压住左舰
           数字」）：本单位的宽度由外层**列盒**给定（= 本列列宽），舰在盒内居中 ⇒ 舰中心 ==
           `foeColLeft(列) + 列宽/2`（= `layout()` 的锚点）。旧写法（`marginLeft = (列宽−舰宽)/2`
           ＋ 平铺 flex 的 4px 缝）在同排内逐舰向左累积偏差（窄舰坐宽列时可达上百 px）⇒ 血条互压。
           `flexShrink: 0`：盒宽即列宽，绝不许被压窄（压窄就等于又跟锚点错位）。 */
        style={{
          width: foeFormation.colW[slot.col] ?? size,
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
          <span className="app-bts-name" style={{ color: isMain ? UI_TONES.foeNameMain : UI_TONES.foeName }}>
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
            style={{ width: bar.width, marginLeft: bar.dx, marginTop: bar.dy + 2 }}
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

  /**
   * **敌方某一排的 DOM**（2026-09-25 修船长报障「第二排右舰血条压住左舰数字」）：
   * 逐列一个**定宽盒**（宽 = 本列列宽），盒里的单位由 `foeRowBoxesOf` 给的下标取。
   * 于是"盒中心" = `foeColLeft(列) + 列宽/2`，与 `layout()` 算出的锚点**逐字同式** ⇒ 舰体、
   * 血条（宽度按锚点算）、弹道/弹着/无人机锚点全部重新对齐。
   * ⚠ 盒宽即列宽 ⇒ `flexShrink: 0`（不许被压窄）。
   */
  const foeRowBoxes = (row: 0 | 1): ReactNode[] =>
    foeRowBoxesOf(foeFormation, row, foeRowTags.length).map((b) => (
      <div
        key={b.col}
        style={{ width: b.width, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', flexShrink: 0 }}
      >
        {b.unit >= 0 ? foeUnitEls[b.unit] : null}
      </div>
    ))
return { foeRowBoxes }
}
