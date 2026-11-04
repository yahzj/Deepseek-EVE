import { battleArcsFor } from '@whale/core'
/** 战斗界面职责：consumeBattleEvents，保持原调用顺序。 */

import type { DamageType } from '@whale/core'

import { mountsOf } from '../../ui/shipMounts'

import { DRONE_DWELL_MS, DRONE_SHOW_MAX, DRONE_SORTIE_BACK_MS, DRONE_SORTIE_OUT_MS, DRONE_STYLE, droneArcHeight, droneModelOrFallback, dronePathPos, droneRandomOffsets, droneStationFrom, droneTakeoff } from './droneArt'
import type { DroneSortie } from './droneArt'
import { BOLT_LOOK, DMG_COLOR, noseOf, layout, boltGeom, resolveBoltAnchors, droneOwnerAnchor, residentDroneFrom } from './battleViewCore'
import type { Dims, Anchor, BoltV, FlashV } from './battleViewCore'

import type { AcidFx } from './battleAcidFx'

import { dronePoseAt, oneThirdToward, foeDroneStation, foePoseAt } from './battleDrones'

export function consumeBattleEvents({
    arrivals, meAnchorByTag, layFx, battle, lastHitTypeRef, acidDeathsRef,
    deadRef, corpseAtRef, now, acidFxRef, keyRef, foeSizeOf,
    meSizeByTag, meSize, popupAccRef, arcs, blinkRef, dims,
    foeSizesFor, rowFxTags, visDistRef, farM, nearM, foeSortieRef,
    droneDownRef, dronePrevShowRef, droneSortieRef, foeAliveTags, droneSlotRef, foeDroneAliveOf,
    droneCountOf, droneOutward, foeDroneBuffedOf, meShip, foeKey, muzzleCountRef,
    boltsRef, flashRef,
  }: {
arrivals: import('@whale/core').BattleFx[]
meAnchorByTag: Map<string, Anchor>
layFx: { meLeft: number; foeLeft: number; me: Anchor; my: Anchor[]; foe: Anchor[]; sizes: number[]; foeBottom: number; formation: import('./battleViewCore').FoeFormation; usable: number; myBarW?: number; }
battle: import('@whale/core').BattleState
lastHitTypeRef: import('react').MutableRefObject<Map<string, DamageType>>
acidDeathsRef: import('react').MutableRefObject<Set<string>>
deadRef: import('react').MutableRefObject<Set<string>>
corpseAtRef: import('react').MutableRefObject<Map<string, number>>
now: number
acidFxRef: import('react').MutableRefObject<AcidFx[]>
keyRef: import('react').MutableRefObject<number>
foeSizeOf: (tag: string) => number
meSizeByTag: Map<string, number>
meSize: number
popupAccRef: import('react').MutableRefObject<Map<string, { x: number; y: number; amount: number; type: DamageType; miss: boolean; }>>
arcs: NonNullable<ReturnType<typeof battleArcsFor>>
blinkRef: import('react').MutableRefObject<Map<string, { side: "foe" | "me"; vanish: number; move: number; appear: number; segMs: number; }>>
dims: Dims
foeSizesFor: (tags: readonly string[]) => number[]
rowFxTags: string[]
visDistRef: import('react').MutableRefObject<number>
farM: number
nearM: number
foeSortieRef: import('react').MutableRefObject<Map<string, DroneSortie>>
droneDownRef: import('react').MutableRefObject<{ key: number; artId: string; x: number; y: number; tx: number; ty: number; born: number; foe?: boolean; }[]>
dronePrevShowRef: import('react').MutableRefObject<Map<string, number>>
droneSortieRef: import('react').MutableRefObject<Map<string, DroneSortie>>
foeAliveTags: string[]
droneSlotRef: import('react').MutableRefObject<Map<string, number>>
foeDroneAliveOf: (tag: string, artId: string) => number
droneCountOf: Map<string, number>
droneOutward: number
foeDroneBuffedOf: (tag: string) => boolean
meShip: import('@whale/core').ShipDef | undefined
foeKey: string
muzzleCountRef: import('react').MutableRefObject<Map<string, number>>
boltsRef: import('react').MutableRefObject<BoltV[]>
flashRef: import('react').MutableRefObject<FlashV[]>
}) {
if (arrivals.length > 0) {
    // 本帧各机型的"击落落点游标"：同一拍被打掉两架时逐架往前取位（不叠在同一处）
    const downCursor = new Map<string, number>()
    for (const fx of arrivals) {
      if (fx.acidBurst) {
        const anchors = resolveBoltAnchors({ side: 'foe', tag: fx.tag, to: fx.to, rowFxTags,
          meAnchors: meAnchorByTag, meFallback: layFx.me, foeAnchors: layFx.foe })
        const cause = battle.acidBursts?.[fx.tag]?.cause
        const delay = cause === 'killed' ? BOLT_LOOK[lastHitTypeRef.current.get(fx.tag) ?? 'kinetic'].fly : 0
        acidDeathsRef.current.add(fx.tag)
        deadRef.current.add(fx.tag)
        corpseAtRef.current.set(fx.tag, now + delay)
        if (anchors) {
          acidFxRef.current.push({ key: keyRef.current++, tag: fx.tag, kind: 'burst',
            ...anchors.src, size: foeSizeOf(fx.tag), born: now, delay })
          if (fx.to && fx.hit) acidFxRef.current.push({ key: keyRef.current++, tag: fx.to, kind: 'impact',
            ...anchors.dst, size: meSizeByTag.get(fx.to) ?? meSize, born: now, delay })
          if (fx.to) {
            const prev = popupAccRef.current.get(fx.to)
            popupAccRef.current.set(fx.to, { ...anchors.dst, amount: (prev?.amount ?? 0) + (fx.dmg ?? 0),
              type: 'kinetic', miss: (prev?.miss ?? false) || !fx.hit })
          }
        }
        // 同拍多只爆虫只覆盖一份全队附着，伤害事件仍逐只显示。
        for (const unit of arcs.myUnits.filter(unit => unit.alive)) {
          const anchor = meAnchorByTag.get(unit.tag) ?? layFx.me
          acidFxRef.current = acidFxRef.current.filter(effect => effect.kind !== 'coating' || effect.tag !== unit.tag)
          acidFxRef.current.push({ key: keyRef.current++, tag: unit.tag, kind: 'coating',
            ...anchor, size: meSizeByTag.get(unit.tag) ?? meSize, born: now, delay })
        }
        continue
      }
      /**
       * **闪现跃迁演出**（**船长 2026-10-01/02 三次令**）——R 族「瞬光跃迁仪」触发时引擎推这一条
       * （**不是开火**）。与下面 `droneDown` 同款：必须**提前拦下并 continue**。
       *
       * 🔴 **消费引擎的 `atMs` 与三段时刻表**（2026-10-02 修）：
       * 引擎按"同时触发的多个闪现**排队依次发生**"排好每段的三段时刻（消失 / **位移兑现** / 出现），
       * 界面以前一律按"事件到达时刻"登记 ⇒ **同一帧到达的几段会被抹平、一起闪**（排队白排）。
       * 现在按 `(atMs − 当前战斗刻)` 算出"还要等多久才开始播"，并**除以当时的倍速**
       * （引擎的 `atMs` 是**游戏毫秒**，动画跑的是**真实毫秒**）。
       */
      if (fx.blink) {
        /**
         * 🔴 **两侧各查各的表**（**2026-10-02 §35**）：敌方段的时刻表在 `foeBlinkQueue`、
         * 我方段在 `meBlinkQueue`。本批之前**只查敌方那张** ⇒ 我方闪现的事件查不到 ⇒ 演出与光柱
         * **一格都不播**（§35.4 记的现状，船长据此提的需求）。
         */
        const side: 'foe' | 'me' = fx.side === 'me' ? 'me' : 'foe'
        const seg = (side === 'me' ? battle.meBlinkQueue : battle.foeBlinkQueue)?.[fx.tag]
        if (seg) {
          const toReal = (gameMs: number): number =>
            (gameMs - (battle.lastTickGameMs ?? fx.atMs)) / Math.max(0.01, fx.speedX ?? 1)
          const segMs = (seg.appearMs - seg.vanishMs) / Math.max(0.01, fx.speedX ?? 1)
          blinkRef.current.set(fx.tag, {
            side,
            vanish: now + toReal(seg.vanishMs),
            move: now + toReal(seg.moveAtMs),
            appear: now + toReal(seg.appearMs),
            segMs,
          })
        }
        /**
         * 🔴 **光柱不在这里排**（**船长 2026-10-02 第二次报障「闪现特效依旧不存在」的根因**）——
         * 这一段是**渲染体**，而它要等 `setSmoothM` 变号才会跑；闪现期间双方机动常常都归零
         * ⇒ 距离不变 ⇒ **整段演出一次都不重渲染** ⇒ 排期与建 DOM 一起落空。
         * 现在统一由 **RAF 循环**的 `planBlinkPillars` 直接从引擎时刻表排（见那个函数头注）。
         */
        continue
      }
      /**
       * 机群被点防击落（2026-09-10 点防上线）：这条事件**不是开火**——引擎在打空一架时推
       * src='drone' + droneDown 的 fx（见 combat.resolvePointDefense）。此处必须提前拦下：
       * ① 不画弹道、不打命中闪光（否则会在母舰与敌舰之间画出一道不存在的射击）；
       * ② 登记坠落演出——落点取"本帧即将消失的那一架"：引擎的存活架数已经减 1，
       *    渲染层机体数随之减 1，消失的正是上一帧的末位机体（dronePrevShowRef）。
       */
      if (fx.droneDown) {
        /**
         * ⚠ **兜底取机型**（2026-09-26 修）：原先这里是 `droneModelOf` ＋ `if (model)` ⇒ **漏登记的机型
         * 「被打下来也不炸」**（连长针哨戒那次报障的三处之一）。现在与机体层同一把尺：查不到就用
         * 兜底灰机体 ⇒ 坠落/爆炸演出永不静默消失。
         */
        const model = droneModelOrFallback(fx.artId)
        if (model) {
          const artId = fx.artId!
          // ⚠ 布局调用统一为**主树新签名**（2026-09-11 舰种体积 + 2026-09-12 斜向菱形：逐舰体积 `foeSizes` /
          //   阵形由 `layout` 内部按体积推导 / 玩家舰体积 `meSize`）——合并时以主树签名为准。
          const layDown = layout(dims, foeSizesFor(rowFxTags), visDistRef.current, farM, nearM, meSize)
          // **敌机被击落**（2026-09-11 修）：引擎打空一架时也推 droneDown（`side='foe'`）——
          // 但落点必须用**敌机自己**的状态表与姿态函数；旧口径一律走我方 `droneSortieRef` +
          // `dronePoseAt` ⇒ 敌机的爆炸被画到**我方机体那一侧**（船长实测："完全无法察觉"）。
          // lane 取该舰**现存架数**（引擎已减 1，故它就是"刚消失那一架"的位次）。
          if (fx.side === 'foe') {
            // **死亡点不再随相位漂移**（船长 2026-09-11：「敌机**死亡位置**飘忽不定，爆炸动画跟着敌机位置」）：
            // 旧口径连**死亡点**都取"渲染层自己以为的那一轮相位" ⇒ 那一击若落在**收舱段**，
            // 姿态就等于停在敌舰机库口（表现为"刚出机库就炸"）。
            // 现：**起点**仍取它**当时真实所在**（不跳），**终点固定**在「从攻击阵位（您舰旁）
            // 往敌舰机库口返航 1/3 处」⇒ 机体从真实位置滑到那个固定点再炸，位置每次都一致。
            const st = foeSortieRef.current.get(`${fx.tag}:${artId}`)
            const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
            const alive =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.alive ?? 0
            const rangeBuff =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.rangeBuff === true
            const lane = Math.max(0, Math.min(alive, DRONE_SHOW_MAX - 1))
            const pose = foePoseAt(model, lane, st, layDown, elapsed, rangeBuff)
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 52,
              y: 0,
            }
            // ⚠ 与实时阵位**同源**（增程态下不能跳回"我舰旁"）
            const station = foeDroneStation(
              layDown.me,
              layDown.foe[0] ?? layDown.me,
              off,
              rangeBuff,
            )
            const tk = droneTakeoff(lane)
            const home = {
              x: (layDown.foe[0]?.x ?? layDown.me.x) - tk.x,
              y: (layDown.foe[0]?.y ?? layDown.me.y) + tk.y,
            }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: pose.x,
              y: pose.y,
              ...oneThirdToward(station, home),
              born: now,
              foe: true,
            })
          } else {
            /** **我方**机群：键一律走 `舰tag:机型`（2026-09-14「逐舰机群」——僚舰的机体也在这层，
             *  击落演出必须找到**它自己那条舰**的机体位次） */
            const meKey = `${fx.tag ?? 'player'}:${artId}`
            const prevShow =
              downCursor.get(meKey) ?? dronePrevShowRef.current.get(meKey) ?? 1
            const lane = Math.max(0, Math.min(prevShow, DRONE_SHOW_MAX) - 1)
            downCursor.set(meKey, lane)
            const st = droneSortieRef.current.get(meKey);
            // **爆炸点与相位无关**（同上，我方一侧对称）：固定取「从攻击阵位（敌舰旁）
            // 往我舰机库口返航 1/3 处」，不随"当前轮次相位"漂移。
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 46,
              y: 0,
            }
            const foeA = layDown.foe[0] ?? layDown.me
            const station = { x: foeA.x - off.x, y: foeA.y + off.y }
            const tk = droneTakeoff(lane)
            /**
             * **返航/滑行终点 = 这一架自己的母舰机库口**（**2026-09-29 修**；与常驻型开火起点同一处漏项）：
             * 旧口径写死 `layDown.me`（主控锚）⇒ 僚舰的机体被点防击落时，会朝**主控**方向滑并在主控旁炸
             * （"被打下来的是谁的机体"看不出来）。取锚统一走 `droneOwnerAnchor`
             * （主控 / 缺 tag 旧事件 / 单船路径 ⇒ 回落主控锚 ⇒ 逐像素不变）。
             */
            const ownAnchor = droneOwnerAnchor({
              ...(fx.tag !== undefined ? { tag: fx.tag } : {}),
              meAnchors: meAnchorByTag,
              meFallback: layDown.me,
            })
            const home = { x: ownAnchor.x + tk.x, y: ownAnchor.y + tk.y }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: station.x,
              y: station.y,
              ...oneThirdToward(station, home),
              born: now,
            })
          }
        }
        continue
      }
      // V18B（2026-09-05 修复）+ 2026-09-09 二轮：弹道按 fx.to（目标 tag）定位并按"视觉行序"
      // 取位（含演出期尸骸占位）——随机目标下每发飞向各自目标，不受队列撤出/补位影响
      const isMeShot = fx.side === 'me'
      /**
       * ⚠ **2026-09-14 船长报障修复：「多对多战斗里，敌方的弹道依旧瞄准我方最右上角的舰船」**。
       *
       * 旧代码敌方那一支写的是 `src = layFx.foe[aimRowIdx]` + `dst = layFx.me`，两处都塌了：
       * ① `aimRowIdx` 是**拿我方 tag 去查 `rowFxTags`（只含敌方 tag）** ⇒ 恒 `-1` ⇒ 起点塌成 `foe[0]`
       *    （**不是实际开火的那艘敌舰**）；② 落点**写死成 `layFx.me`**（我方主控锚）⇒ 敌方每一发都飞向主控
       *    —— 画面里就是"最右上角那艘"。引擎侧一直是对的（`to: gtgt.spec.tag`，每发开火前重选靶），
       *    所以这是**纯演出层的坐标解析 bug**。
       * 现把解析抽成纯函数 `resolveBoltAnchors`（`battleViewCore` · **两侧对称**：起点 = 实际开火的舰、
       * 落点 = 被瞄准的舰），并由正式工具 `npm run battle:bolt` 做回归守卫。
       */
      const aimTag = isMeShot ? (fx.to ?? foeAliveTags[0]) : fx.to ?? 'player'
      const aimRowIdx = rowFxTags.indexOf(aimTag)
      /** **发射舰**（我方多舰路径按 `fx.tag` 取该舰锚点）——见上方 meAnchorByTag。
       *  ⚠ 2026-09-14「逐舰机群」起**无人机也按发射舰取锚**（fx.tag = 该架所属舰；主控那条仍是 `player`
       *  ⇒ 单船/主控路径逐像素不变）。此前无人机一律回落主控锚 ⇒ 僚舰放飞的机群弹道会从主控出。 */
      const mySrc = isMeShot ? meAnchorByTag.get(fx.tag) : undefined
      /** **敌方发射舰的行号**（`rowFxTags` 只含敌方 ⇒ 只在敌方那一支有意义；我方那一支恒 −1） */
      const shooterRowIdx = isMeShot ? -1 : rowFxTags.indexOf(fx.tag)
      /** **被瞄准的我方舰**（仅敌方那一支用；缺 `fx.to` 或单船路径 ⇒ undefined ⇒ 回落主控） */
      const aimMeAnchor = isMeShot ? undefined : fx.to !== undefined ? meAnchorByTag.get(fx.to) : undefined
      let src: Anchor | undefined
      let dst: Anchor | undefined
      {
        // 我方多舰路径：发射舰锚点表优先（`fx.src='drone'` 的弹道自机群位起飞，故不走这张表）
        const r = resolveBoltAnchors({
          side: isMeShot ? 'me' : 'foe',
          tag: fx.tag,
          ...(fx.to !== undefined ? { to: fx.to } : {}),
          rowFxTags,
          meAnchors: meAnchorByTag,
          meFallback: layFx.me,
          foeAnchors: layFx.foe,
        })
        if (r) {
          src = isMeShot ? (mySrc ?? r.src) : r.src
          dst = isMeShot ? r.dst : (aimMeAnchor ?? r.dst)
        }
      }
      if (!src || !dst) continue
      if (isMeShot && fx.hit) lastHitTypeRef.current.set(aimTag, fx.type) // 记录最近命中形态（击杀延迟用）
      // 舰艏偏移按**该舰实际落画体积**取（2026-09-11 舰种体积：舰艏距中心与舰宽线性，见 noseOf）——
      // 优先取本帧布局的实际值（含溢出收缩），索引缺失才回落到按 tag 推导的体积
      const aimSize = isMeShot
        ? ((aimRowIdx >= 0 ? layFx.sizes[aimRowIdx] : undefined) ?? foeSizeOf(aimTag))
        : ((fx.to !== undefined ? meSizeByTag.get(fx.to) : undefined) ?? meSize) // 敌方那一支的"目标"是我方舰
      /** 我方多舰路径：发射舰的实际落画体积（与 `src` 同一把尺） */
      const myShooterSize = isMeShot ? meSizeByTag.get(fx.tag) : undefined
      const shooterSize =
        myShooterSize ?? ((shooterRowIdx >= 0 ? layFx.sizes[shooterRowIdx] : undefined) ?? foeSizeOf(fx.tag))
      const srcNose = noseOf(isMeShot ? (myShooterSize ?? meSize) : shooterSize)
      const dstNose = noseOf(aimSize)
      // 2026-09-10 船长批：开火点挂真实炮口——按发射者挂点取 muzzle（多炮口轮换），
      // 无挂点/无原生炮（货矿舰等）→ 传 null 回退舰艏前缘；artW = 发射舰实际显示宽
      // 无人机（src='drone'）例外：弹道自**机群当前悬浮位**起飞（不占母舰炮口轮换）
      const dm = fx.src === 'drone' ? droneModelOrFallback(fx.artId) : undefined
      const artW = isMeShot ? (myShooterSize ?? meSize) : shooterSize
      let mounts: ReturnType<typeof mountsOf>
      let muzzlePt: Anchor | null = null
      let from: Anchor | null = null
      let droneDelay = 0
      if (dm) {
        const key = dm.resident ? `res:${fx.artId}` : `fly:${fx.artId}`
        const n = droneSlotRef.current.get(key) ?? 0
        droneSlotRef.current.set(key, n + 1)
        const foeA = layFx.foe[0] ?? layFx.me;
        // **阵位锚点 = "要打的那一方"**（2026-09-11 机群批 S5 二次修正）：
        //   · 我方机群 → 锚在**敌舰**（悬在目标舰旁，打的就是它）；
        //   · 敌方机群 → 锚在**我方舰**（完全镜像：扑到您脸上来打）。
        // ⇒ 两侧出击**都是整段舰间距**的航路（旧口径把敌机也锚在敌舰上 ⇒ 只飞 42~68px，
        //   船长实测反馈"只移动一小段、位置还贴在敌舰左上角"）。
        const anchor = isMeShot ? foeA : layFx.me
        const dir = isMeShot ? 1 : -1;
        // **第二层：敌机也走"出击制"**——敌我**共用同一套状态表口径**（2026-09-11 修正）：
        //   · 我方：键 = `artId`，表 = `droneSortieRef`，架数 = 我方该机型架数；
        //   · 敌方：键 = `tag:artId`，表 = `foeSortieRef`，架数 = **该舰现存架数**。
        // ⚠ 旧版敌机弹道读的是**我方那张表**、又用我方架数 ⇒ 与机体层（读 `foeSortieRef`）的
        //   **时间起点 / 随机阵位 / 道次全对不上** ⇒ 船长实测反馈"弹道和敌机位置不对"。
        const foeDrone = !isMeShot
        /** 键统一成 **`舰tag:机型`**（2026-09-14「逐舰机群」：两侧同构，机体层与弹道层用同一个键） */
        const skey = `${fx.tag}:${fx.artId}`
        const smap = foeDrone ? foeSortieRef.current : droneSortieRef.current
        /** 我方**逐舰**布局（僚舰的机群从自己舰位起飞/返航；主控那条 = `layFx` ⇒ 逐像素不变） */
        const layOwner = foeDrone
          ? layFx
          : fx.tag && fx.tag !== 'player'
            ? { foe: layFx.foe, me: meAnchorByTag.get(fx.tag) ?? layFx.me }
            : layFx
        if (DRONE_STYLE === 'sortie' && !dm.resident) {
          /**
           * 2026-09-10 船长"弹道发射位置和无人机对不上（小概率）"修复——两处确定性缺陷：
           * ① 道次原按 6 取模，但渲染机体数是 min(架数,6)：带 2~5 架时弹道会从"没有机体的道位"发出；
           * ② 无人机已在返航途中开火时，弹道仍从敌侧阵位发出（机体已不在那里）。
           * 现改为：道次按**实际机体数**取模；返航阶段开火则弹道**从无人机当前位置**发出（边退边打）。
           */
          const count = foeDrone
            ? Math.max(
                1,
                Math.min(foeDroneAliveOf(fx.tag!, fx.artId!), DRONE_SHOW_MAX),
              )
            : Math.max(
                1,
                Math.min(droneCountOf.get(skey) ?? 1, DRONE_SHOW_MAX),
              )
          const lane = n % count
          const prev = smap.get(skey)
          const cycleMs =
            DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
          const st =
            !prev || now - prev.startAt >= cycleMs + 40
              ? { startAt: now, offs: droneRandomOffsets(DRONE_SHOW_MAX, droneOutward) }
              : prev
          smap.set(skey, st)
          const off = st.offs[lane % st.offs.length]!
          const elapsed = now - st.startAt
          // **弹道起飞点＝机体同一个阵位**（受击增程后一起后撤；非增程时与原口径逐字相同）
          const station = foeDrone
            ? foeDroneStation(layFx.me, foeA, off, foeDroneBuffedOf(fx.tag!))
            : droneStationFrom(anchor, dir, off)
          if (elapsed < DRONE_SORTIE_OUT_MS) {
            // 仍在出击途中：弹道自阵位出，延到"无人机抵达"那一刻显示
            from = station
            droneDelay = Math.round(DRONE_SORTIE_OUT_MS - elapsed)
          } else if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) {
            // 已到位：阵位出弹，立即显示
            from = station
          } else if (isMeShot) {
            // 返航中（我方）：弹道就从无人机当前位置出（与机体一致）——**按所属舰的布局**取姿态
            from = dronePoseAt(dm, lane, st, layOwner, elapsed)
          } else {
            // 返航中（敌方）：镜像几何——阵位（我方舰旁）→ 敌舰机库口
            const t2 = Math.min(
              1,
              Math.max(
                0,
                (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) /
                  DRONE_SORTIE_BACK_MS,
              ),
            )
            const tk = droneTakeoff(lane)
            const deckAbs = { x: foeA.x - tk.x, y: foeA.y + tk.y }; // 相对敌舰**水平镜像**（敌舰朝向我方）
            from = dronePathPos(
              t2,
              station,
              deckAbs,
              droneArcHeight(lane),
              true,
            )
          }
        } else {
          /**
           * **常驻型（哨戒）无人机的开火起点 = 它自己那艘母舰的伴飞位**（**2026-09-29 修**：舰队战中
           * 「僚舰的无人机攻击没有动画效果」）。
           *
           * ⚠ 旧口径这里写死 `droneHomeStation(dm, …, layFx)`（主控布局）⇒ **僚舰的哨戒机只在悬停、
           * 曳光条却从主控上方凭空冒出**（无头 Chrome 实测：机体在僚舰 +(77,−38)、
           * 弹道起点在主控 +(76,−39) —— 两个偏移一模一样，根因就此坐实）。
           * 现统一走纯函数 `residentDroneFrom`（所属舰锚 ＋ `slots[0]`；单船/主控路径 = 主控锚 ⇒ 逐像素不变），
           * 回归守卫 = `npm run battle:bolt`。
           */
          from = residentDroneFrom({
            ...(fx.tag !== undefined ? { tag: fx.tag } : {}),
            meAnchors: meAnchorByTag,
            meFallback: layFx.me,
            slot: dm.slots[0] ?? { x: 0, y: 0 },
          })
        }
      } else {
        mounts = isMeShot ? mountsOf(meShip?.id, undefined) : mountsOf(undefined, foeKey)
        const mz = mounts?.muzzles
        if (mz && mz.length > 0) {
          const k = isMeShot ? 'me' : fx.tag
          const n = muzzleCountRef.current.get(k) ?? 0
          muzzleCountRef.current.set(k, n + 1)
          muzzlePt = mz[n % mz.length]!
        }
      }
      // 无人机瞄准敌舰**中心点**（2026-09-10 船长八次定）：炮台/激光仍打舰艏侧命中点，无人机不打前缘
      const g = boltGeom(
        fx.side,
        src,
        dst,
        srcNose,
        dm ? 0 : dstNose,
        muzzlePt,
        artW,
        from,
      );
      // **打机群不画弹道**（船长 2026-09-11）：机群已飞到您舰旁，弹道画向敌舰是错的；
      // 攻击感由**炮口闪光**（下面照旧推）+ 机群自身的出击动画表达。
      if (!fx.pd)
        boltsRef.current.push({
          key: keyRef.current++,
          color: DMG_COLOR[fx.type],
          type: fx.type,
          hit: fx.hit,
          x1: g.x1,
          y1: g.y1,
          len: g.len,
          angDeg: g.angDeg,
          born: now,
          ...(dm ? { drone: fx.artId } : {}),
          ...(droneDelay > 0 ? { delay: droneDelay } : {}),
        })
      flashRef.current.push({
        key: keyRef.current++,
        at: now,
        color: DMG_COLOR[fx.type],
        x: g.x1,
        y: g.y1,
        ...(dm ? { small: true } : {}),
        ...(droneDelay > 0 ? { delay: droneDelay } : {}),
      })
      /**
       * **伤害飘字累加**（甲①目标旁 · 甲②同拍同目标累加 · 甲③类型色 + 灰 MISS）：
       * 落点 = 这一发的**目标点**（弹道终点，与弹道同一套几何）；命中取 `fx.hit`，
       * 数字取 `fx.dmg`（引擎逐发结算的**实收**伤害，见 `BattleFx.dmg`）。
       * ⚠ **无伤事件不落飘字**（捕获网连线 / 机群被击落演出都是 `hit: true` 但不带 `dmg`）——
       * 否则会飘出一个「-0」；只有**真未命中**才落灰色 MISS。
       */
      {
        const tx = g.x1 + Math.cos((g.angDeg * Math.PI) / 180) * g.len
        const ty = g.y1 + Math.sin((g.angDeg * Math.PI) / 180) * g.len
        const tkey = fx.to ?? `${Math.round(tx)},${Math.round(ty)}`
        const dmg = typeof fx.dmg === 'number' && Number.isFinite(fx.dmg) ? Math.max(0, fx.dmg) : 0
        const prev = popupAccRef.current.get(tkey)
        popupAccRef.current.set(tkey, {
          x: tx,
          y: ty,
          amount: (prev?.amount ?? 0) + dmg,
          type: fx.type,
          miss: (prev?.miss ?? false) || fx.hit === false,
        })
      }
    }
    if (flashRef.current.length > 6) flashRef.current.splice(0, flashRef.current.length - 6)
  }

}
