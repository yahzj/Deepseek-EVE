/** 战斗界面职责：useBattleLifecycle，保持原调用顺序。 */
import { useEffect } from 'react'

import { createPlayerSpec, thrusterPhase } from '@whale/core'
import type { BattleReportRecord, DroneLossReport } from '@whale/core'

import type { GameEngine } from '../../game/engine'

import { planBlinkPillars, syncBlinkPillarDom } from './battleBlink'
import type { BlinkPillarFx } from './battleBlink'

import type { DroneModel, DroneSortie } from './droneArt'
import { STAR_LAYERS, clamp01, layout } from './battleViewCore'
import type { Dims, Stage, OutroSnap } from './battleViewCore'

import type { AcidFx } from './battleAcidFx'

import { dronePoseAt, foePoseAt } from './battleDrones'

type BattleHandle = {
  startedAtGameMs: number
  /** 上一拍时刻（`thrusterPhase` 与平滑循环都读） */
  lastTickGameMs: number
  distanceM: number
  myDesireM: number
  myFleet?: Array<{ tag: string; shipId: string }>
}
export function useBattleLifecycle({
    onDone, onClose, battle, stage, outroRef, setStage,
    combatView, state, droneReportRef, battleReportRef, reportTextRef, tr,
    onReport, prevBattleIdRef, deadRef, corpseAtRef, acidFxRef, acidDeathsRef,
    acidFxWakeAtRef, prevHpRef, hpInitRef, engine, meSpeedRef, battleRef,
    pausedRef, battleStartRef, moveSnapRef, visDistRef, blinkSeenRef, blinkFxRef,
    widthCheckRef, foeColRef, meColRef, dimsRef, measureRef, setSmoothM,
    refreshAcidFx, stageRef, meFxRootRef, starStateRef, thrusterCycleRef, thrusterBoostRef,
    starOffRef, starLayerRefs, droneDriveRef, droneBoxRef, droneWritesRef, droneElsRef,
    laneRef, setDims, flushTimerRef, dragValRef, mapRef,
  }: {
onDone: (() => void) | undefined
onClose: () => void
battle: import('@whale/core').BattleState | null
stage: Stage
outroRef: import('react').MutableRefObject<OutroSnap | null>
setStage: import('react').Dispatch<import('react').SetStateAction<Stage>>
combatView: { distanceM: number; myDesireM: number; meHp: { s: number; a: number; h: number; }; foeHp: Record<string, { s: number; a: number; h: number; name: string; }>; shots: number; hits: number; lockTag: string | null; } | null
state: import('@whale/core').GameState
droneReportRef: import('react').MutableRefObject<DroneLossReport | null>
battleReportRef: import('react').MutableRefObject<BattleReportRecord | null>
reportTextRef: import('react').MutableRefObject<string>
tr: (id: string, params?: Record<string, string | number>) => string
onReport: (() => boolean) | undefined
prevBattleIdRef: import('react').MutableRefObject<number | null>
deadRef: import('react').MutableRefObject<Set<string>>
corpseAtRef: import('react').MutableRefObject<Map<string, number>>
acidFxRef: import('react').MutableRefObject<AcidFx[]>
acidDeathsRef: import('react').MutableRefObject<Set<string>>
acidFxWakeAtRef: import('react').MutableRefObject<number>
prevHpRef: import('react').MutableRefObject<Map<string, number>>
hpInitRef: import('react').MutableRefObject<boolean>
engine: Pick<GameEngine, "state" | "ctx" | "wormholeSpeedActive" | "wormholeSpeedOptions" | "setWormholeSpeed" | "battleSetDesireAt" | "retreatNow">
meSpeedRef: import('react').MutableRefObject<number>
battleRef: import('react').MutableRefObject<BattleHandle | null>
pausedRef: import('react').MutableRefObject<boolean>
battleStartRef: import('react').MutableRefObject<number>
moveSnapRef: import('react').MutableRefObject<{ prev: { m: number; w: number; } | null; cur: { m: number; w: number; } | null; }>
visDistRef: import('react').MutableRefObject<number>
blinkSeenRef: import('react').MutableRefObject<Set<string>>
blinkFxRef: import('react').MutableRefObject<BlinkPillarFx[]>
widthCheckRef: import('react').MutableRefObject<number>
foeColRef: import('react').RefObject<HTMLDivElement>
meColRef: import('react').RefObject<HTMLDivElement>
dimsRef: import('react').MutableRefObject<Dims>
measureRef: import('react').MutableRefObject<() => void>
setSmoothM: import('react').Dispatch<import('react').SetStateAction<number | null>>
refreshAcidFx: import('react').Dispatch<import('react').SetStateAction<number>>
stageRef: import('react').RefObject<HTMLDivElement>
meFxRootRef: import('react').RefObject<HTMLDivElement>
starStateRef: import('react').MutableRefObject<{ v: number; dir: number; }>
thrusterCycleRef: import('react').MutableRefObject<{ boostMs: number; cooldownMs: number; } | undefined>
thrusterBoostRef: import('react').MutableRefObject<number>
starOffRef: import('react').MutableRefObject<number[]>
starLayerRefs: import('react').MutableRefObject<(HTMLDivElement | null)[]>
droneDriveRef: import('react').MutableRefObject<{ foeSizes: number[]; meSize: number; farM: number; nearM: number; wings: Array<{ key?: string; owner?: string; artId: string; model: DroneModel; show: number; st?: DroneSortie; deck: boolean; foe?: string; rangeBuff?: boolean; }>; meAnchors: Map<string, { x: number; y: number; }>; }>
droneBoxRef: import('react').RefObject<HTMLDivElement>
droneWritesRef: import('react').MutableRefObject<Map<string, string>>
droneElsRef: import('react').MutableRefObject<Map<string, HTMLSpanElement>>
laneRef: import('react').RefObject<HTMLDivElement>
setDims: import('react').Dispatch<import('react').SetStateAction<Dims>>
flushTimerRef: import('react').MutableRefObject<number | null>
dragValRef: import('react').MutableRefObject<number | null>
mapRef: import('react').MutableRefObject<{ farM: number; nearM: number; }>
}) {
/**
   * **这一屏的使命结束**（2026-09-22）：战报关掉了、或压根没有战报可播 ⇒ 通知宿主撤销挂载
   * （不传 `onDone` 的老调用方回落到"只关屏"，行为与改造前一致）。
   */
  const finish = (): void => {
    if (onDone) onDone()
    else onClose()
  }
  useEffect(() => {
    const ended = battle?.ended ?? null
    if (stage === 'live') {
      if (ended) {
        // 引擎刚分出胜负（killcam 窗口内）：记快照，开始演出
        outroRef.current = {
          kind: ended,
          atWall: performance.now(),
          startedAtGameMs: battle!.startedAtGameMs,
          durMs: Math.max(0, battle!.lastTickGameMs - battle!.startedAtGameMs),
          meShots: battle!.stats.meShots,
          meHits: battle!.stats.meHits,
          meDmg: battle!.stats.meDmg,
          foeShots: battle!.stats.foeShots,
          foeHits: battle!.stats.foeHits,
          // 机群战损（2026-09-10）：战报弹层要显示"机群损失"行——结算后战场数据会清空，
          // 必须在分出胜负的这一刻快照下来（battleArcsFor 的 droneLost 届时已取不到）
          ...(battle!.droneLost && Object.keys(battle!.droneLost).length > 0 ? { droneLost: { ...battle!.droneLost } } : {}),
          // 虫洞战斗的用途（船长 2026-09-14：撤离战的战报不该弹——结算后 battle 清空，故此刻快照）
          // ⚠ 2026-09-15 撤离战退役 ⇒ 这一档只剩**老档**里正在打的撤离战会命中（新趟不再有）
          ...(battle!.wormhole ? { wormholeKind: battle!.wormhole.kind } : {}),
        }
        setStage('outro')
      } else if (!combatView) {
        // 未见到分出胜负战斗就结束了（离线恢复等）：直接关屏，战报看日志
        finish()
      }
    } else if (stage === 'outro' && !combatView) {
      /**
       * **撤离战不弹战报**（船长 2026-09-14：「离开虫洞的战斗也会弹出战斗报告（这一场战斗不应该弹出）」）：
       * 那一场由虫洞的**结算单**（`run.lastSettle`）说话，战报只会把结算挡住 ⇒ 直接关屏。
       * 注意：战报**日志**照旧写在事件日志里（留档），这里只跳过弹层。
       *
       * ⚠ 2026-09-15 撤离战退役 ⇒ 这一档如今**只有老档**里正在打的撤离战会命中（新趟不再有撤离战）。
       */
      if (outroRef.current?.wormholeKind === 'extract') {
        finish()
        return
      }
      // 引擎已结算（killcam 走完）→ 战报文本（resolve 日志已写入）
      const snap = outroRef.current
      // 机群战损结算结果（2026-09-11）：结算刚在这一刻完成，读取结构化结果；
      // 用战斗起手时刻配对，避免并行战斗（AI 副船等）的结果串场
      const dr = state.droneLossReport ?? null
      droneReportRef.current =
        dr && (!snap || dr.battleStartedAtGameMs === snap.startedAtGameMs) ? dr : null
      /**
       * **结构化战报**（2026-09-14 船长定 · 战报改造）：引擎在结算时写了一份 `state.battleReport`，
       * 弹层直接读它 —— 取代原先"在日志里找含『战报』二字的那条"（那条做法对洞内/遭遇/无法交战
       * **三类战斗全部取不到正文**，而且标题只看胜负 ⇒ 沉了船也写「大捷」）。
       * 配对口径同 `droneLossReport`：起手时刻对不上就是别的战斗写的 ⇒ 回落兜底句，绝不串场。
       */
      const br = state.battleReport ?? null
      battleReportRef.current = br && (!snap || br.battleStartedAtGameMs === snap.startedAtGameMs) ? br : null
      reportTextRef.current =
        (battleReportRef.current?.summaryId !== undefined
          ? tr(battleReportRef.current.summaryId, battleReportRef.current.summaryParams as Record<string, string | number> | undefined)
          : battleReportRef.current?.summary) ??
        (snap?.kind === 'me' ? tr("ui.BattleScreen.005") : tr("ui.BattleScreen.006"))
      setStage('report')
      /**
       * **问宿主"这一屏要不要上"**（2026-09-22）：玩家看过这一场 ⇒ 宿主把屏叫回来（战斗中退出过的
       * 玩家不漏战报）；宿主不要（没看过的自动战斗）⇒ 本屏没有播战报的余地，直接收尾卸载，
       * 免得留下一块**看不见却一直挂着**的屏（33ms 循环会空转到下一次开战）。
       */
      if (!(onReport?.() ?? true)) finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, battle?.ended, combatView === null])

  /**
   * **换了一场战斗 ⇒ 阶段机复位**（2026-09-22 · 加固）。
   *
   * 治的是什么：`stage` 原先只在 live→outro、outro→report 两处被 set、**从不回到 `live`**。
   * 而本组件是"按需挂载、跨战斗存活"的（宿主 `App.tsx` 的挂载条件 `battleMounted` 要一直挂到
   * 战报播完为止）。于是只要**旧战报还挂着时又开一场**（优化清剿的自动远征、AI 副船、
   * 以后任何自动开战），屏幕会一直显示**上一场**的战报，新战斗在幕后台跑、玩家只能干等它结束
   * —— 与 2026-09-22 玩家报障「进入战斗后直接出现结算画面，战斗却在后台跑」同一类现象。
   *
   * ⚠ **只在"新战斗的身份出现"时复位**：战报期宿主的 `battle` 会变成 `undefined`
   * （引擎已清 `run.battle` / `expedition.battle`），若把 `undefined` 也当"换场"，
   * 刚进 report 就会被立刻打回 live ⇒ **战报又丢了**（这道 `=== undefined` 守卫是必须的）。
   * 身份口径 = `startedAtGameMs`，与本文件其它几处（33ms 循环、预登记）同一把尺。
   */
  useEffect(() => {
    const id = battle?.startedAtGameMs
    if (id === undefined) return
    if (prevBattleIdRef.current === id) return
    prevBattleIdRef.current = id
    outroRef.current = null
    setStage('live')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  // 战报自动关闭：report 展示 20 秒后自动返回（按钮可随时提前关闭）
  // 2026-09-11 船长：「战斗报告持续时间延长」6 秒 → 12 秒；
  // 2026-09-14（战报改造）：内容又多了三行（我方损失 / 双方残余 / 弹药消耗）⇒ 12 秒 → **20 秒**
  useEffect(() => {
    if (stage !== 'report') return
    const t = window.setTimeout(() => finish(), 20_000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  /**
   * 已被摧毁敌方单位的**进场预登记**（2026-09-10 船长："多舰船战斗时退出战斗界面再进来，
   * 已被摧毁的敌人会重新出现（血量0）"修复）：
   * deadRef/corpseAtRef 都是组件局部状态，最小化战场即卸载清空；再进来时引擎里 hp 已归零的敌人
   * 会被当成存活单位重新渲染。现于**每次战斗开始（含重进战场）**按 battle.units 真值预登记：
   * 已摧毁 → 直接视为"已撤出队列"（无残骸演出登记 → 不再出队，也不会重放爆炸）。
   * 同时清空血量缓存并重置首帧标记，避免把"进场时的既成伤亡"误判成本帧新阵亡。
   */
  useEffect(() => {
    // ⚠ 2026-09-14 修：此前写死 `engine.state.expedition.battle` ⇒ **洞内那场恒为 null**，
    //   预登记整段不跑 ⇒ 洞内"退出战斗界面再进来，血量 0 的敌人重新出现"（2026-09-10 修过的同款
    //   BUG 当年只在洞外修好）。现取**本场已解析的 `battle`**（远征 or 洞内）。
    const b = battle
    if (!b) return
    deadRef.current = new Set(
      Object.values(b.units)
        .filter((u) => u.side === 'foe' && u.hp.s + u.hp.a + u.hp.h <= 0)
        .map((u) => u.tag),
    )
    corpseAtRef.current.clear()
    acidFxRef.current = []
    acidDeathsRef.current.clear()
    acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
    prevHpRef.current.clear()
    hpInitRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  // 星空视差速率：基准 = 驾驶船基础战斗速度（装配/技能静态）——每帧再按推进器点火态放大（见 33ms 循环）
  useEffect(() => {
    // ⚠ 2026-09-14 修：同上，洞内战里这里恒早退 ⇒ 星场基准速度一直停在缺省值。
    //   锚船与 33ms 循环**同一口径**（洞内 = 编队首舰）。
    if (!battle) return
    const anchorId = battle.myFleet?.[0]?.shipId ?? engine.state.shipId
    const spec = createPlayerSpec(engine.state, engine.ctx, anchorId)
    meSpeedRef.current = spec?.speedMps ?? 200
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  // 视觉插值：引擎每 ~100ms 一拍；本循环 33ms 在两拍间线性插值，舰列/弧/游标平滑移动
  // ⚠ **句柄取 `battleRef`（远征 or 洞内）**：原先写死 `engine.state.expedition.battle` ⇒
  //   洞内那场在这里恒为 null，插值整段不跑 ⇒ 船每 100ms 才动一次（船长"移动有顿挫感，不顺滑"）。
  useEffect(() => {
    const iv = window.setInterval(() => {
      const b = battleRef.current
      const now = performance.now()
      if (!b) return
      if (pausedRef.current) return
      // **换了战斗**（开战/换节点/换层）：清视觉账本，并同步星场速率的基准船速（洞内 = 编队首舰）
      if (b.startedAtGameMs !== battleStartRef.current) {
        battleStartRef.current = b.startedAtGameMs
        moveSnapRef.current = { prev: null, cur: null }
        visDistRef.current = 0
        corpseAtRef.current.clear()
        acidFxRef.current = []
        acidDeathsRef.current.clear()
        acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
        prevHpRef.current.clear()
        hpInitRef.current = false
        /** ⚠ 闪现光柱的两本账也要清（`fxSeq` 与 `foeBlinkQueue` 都是**逐场**的） */
        blinkSeenRef.current.clear()
        for (const p of blinkFxRef.current) p.el?.remove()
        blinkFxRef.current.length = 0
        const anchorId = b.myFleet?.[0]?.shipId ?? engine.state.shipId
        const spec = createPlayerSpec(engine.state, engine.ctx, anchorId)
        meSpeedRef.current = spec?.speedMps ?? 200
      }
      const s = moveSnapRef.current
      if (!s.cur || s.cur.m !== b.distanceM) {
        if (s.cur && s.cur.m !== b.distanceM) s.prev = s.cur
        else s.prev = null
        s.cur = { m: b.distanceM, w: now }
      }
      let vis = s.cur.m
      if (s.prev && s.cur.m !== s.prev.m) {
        const t = clamp01((now - s.cur.w) / 100)
        vis = s.prev.m + (s.cur.m - s.prev.m) * t
      }
      visDistRef.current = vis // 供无人机 rAF 驱动使用（与舰列/弧同一插值距离）
      /* 列宽核对（~330ms 一次）：编队数量变化会改变敌列 DOM 宽度，若不重测则锚点偏移、
         弹道落点偏右（2026-09-10 船长"击毁小型敌人后无人机落弹位置有误"）。放在本循环而非
         useEffect，是因为渲染体在 `!view.combat` 时会提前 return，守卫之后不得再出现 hook。 */
      if (++widthCheckRef.current >= 10) {
        widthCheckRef.current = 0
        const fw = foeColRef.current?.offsetWidth
        const mw = meColRef.current?.offsetWidth
        if ((fw && Math.abs(fw - dimsRef.current.foeW) > 2) || (mw && Math.abs(mw - dimsRef.current.meW) > 2)) {
          measureRef.current()
        }
      }
      setSmoothM((old) => (old === null || Math.abs(old - vis) >= 0.05 ? vis : old))
      // 静止交距下也清理专属爆发，避免演完的机位留在队列里。
      if (now >= acidFxWakeAtRef.current) {
        acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
        refreshAcidFx(tick => tick + 1)
      }
      /**
       * 🔴 **闪现光柱：排期 ＋ 建/删 DOM**（**船长 2026-10-02 两次实机报障**）——
       * 两件事都必须在这里做（RAF、**不走 React**）：演出期间距离**可能整段不变**
       * （敌舰刚闪到自己的期望距离、我方也在期望距离上 ⇒ 双方机动都归零）⇒ `setSmoothM` 不触发
       * 重渲染 ⇒ "推入 ref 等渲染"永远出不来。⚠ 用 `performance.now()` 口径（本表的 `at/until` 就是它）。
       */
      planBlinkPillars(b, blinkSeenRef.current, blinkFxRef.current, now, {
        /** ⚠ 传的是**查舰位那棵树**（敌方 = 敌列盒、我方 = 舞台），**不是**光柱宿主 ——
         *  我方宿主 `meFxRootRef` 是空层、里面没有舰，拿它枚举会一艘都找不到。 */
        foe: foeColRef.current,
        me: stageRef.current,
      })
      /** ⚠ 两侧各建各删（`side` 过滤）；我方"查舰位"用舞台、"插光柱"用宿主（§35 拆开的那两个角色） */
      syncBlinkPillarDom(blinkFxRef.current, foeColRef.current, now, 'foe')
      syncBlinkPillarDom(blinkFxRef.current, stageRef.current, now, 'me', meFxRootRef.current)

      // ── 背景视差滚动（2026-09-05 船长规则）：玩家前进（船向右、朝敌接近）→ 星空向左流；
      // 后退（想拉开、船向左退）→ 星空向右流。速度与「驾驶船战斗速度」挂钩（技能已折算）——
      // 2026-09-10 推进器周期化后：点火期额外乘爆发倍率（星空跑得更快 = 加速的直观反馈）。
      const st = starStateRef.current
      const gap = b.myDesireM - b.distanceM // <0 = 想接近（前进/向右）；>0 = 想拉开（后退/向左）
      if (Math.abs(gap) > 2) st.dir = gap < 0 ? 1 : -1 // +1 = 星空向左流 / −1 = 向右流
      const boostNow = thrusterPhase(b, engine.ctx.balance.battle, thrusterCycleRef.current).boosting
        ? thrusterBoostRef.current
        : 0
      const vMag = Math.min(320, 40 + meSpeedRef.current * (1 + boostNow) * 0.32) // 40px/s 底速 + 船速比例
      const target = st.dir * vMag
      st.v += (target - st.v) * 0.12 // 速度连续渐变
      const offs = starOffRef.current
      const W = Math.max(1, dimsRef.current.W)
      for (let i = 0; i < STAR_LAYERS.length; i++) {
        offs[i] = (offs[i] + st.v * STAR_LAYERS[i].mult * 0.033) % W
        if (offs[i] < 0) offs[i] += W
        const el = starLayerRefs.current[i]
        if (el) el.style.transform = `translate3d(${-offs[i].toFixed(1)}px, 0, 0)`
      }
    }, 33)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 无人机位置驱动（rAF，恒定 60fps；与 React 重渲染节奏解耦） */
  useEffect(() => {
    let alive = true
    let raf = 0
    const drive = (): void => {
      if (!alive) return
      const d = droneDriveRef.current
      if (!pausedRef.current && d.wings.length > 0) {
        const layLoop = layout(dimsRef.current, d.foeSizes, visDistRef.current, d.farM, d.nearM, d.meSize)
        const box = droneBoxRef.current
        const w0 = droneWritesRef.current
        if (box) {
          const tb = `translate3d(${layLoop.me.x.toFixed(1)}px, ${layLoop.me.y.toFixed(1)}px, 0)`
          if (w0.get('@box') !== tb) {
            box.style.transform = tb
            w0.set('@box', tb)
          }
        }
        const nowMs = performance.now()
        for (const w of d.wings) {
          if (w.deck) continue // 收舱（display:none）不写位置
          const elapsed = w.st ? nowMs - w.st.startAt : Number.POSITIVE_INFINITY
          /**
           * **逐舰锚**（2026-09-14「逐舰机群」）：僚舰的机群挂在自己舰位旁 ⇒ 姿态按**该舰**的布局算
           * （把 `me` 换成该舰锚，敌侧锚沿用同一份）。主控那条 = 旧口径的 `layLoop`（逐像素不变）；
           * 外层盒子的平移仍以主控锚为基准（机体坐标是相对主控锚的差值）。
           */
          const own = w.owner && w.owner !== 'player' ? d.meAnchors.get(w.owner) : undefined
          const layW = own ? { foe: layLoop.foe, me: own } : layLoop
          for (let i = 0; i < w.show; i++) {
            const key = w.foe
              ? `foe:${w.foe}:${w.artId}|${i}`
              : `${w.key ?? w.artId}|${i}`
            const el = droneElsRef.current.get(key)
            if (!el) continue
            const pose = w.foe
              ? foePoseAt(w.model, i, w.st, layLoop, elapsed, w.rangeBuff === true)
              : dronePoseAt(w.model, i, w.st, layW, elapsed)
            const t = `translate3d(${(pose.x - layLoop.me.x).toFixed(1)}px, ${(pose.y - layLoop.me.y).toFixed(1)}px, 0) translate(-50%, -50%) scaleX(${pose.heading})`
            if (w0.get(key) !== t) {
              el.style.transform = t
              w0.set(key, t)
            }
          }
        }
      }
      raf = window.requestAnimationFrame(drive)
    }
    raf = window.requestAnimationFrame(drive)
    return () => {
      alive = false
      window.cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 尺寸测量（列宽由固定内容决定；窗口变化只影响 lane 宽）
   *  2026-09-10：列宽会随编队数量变化（击毁僚舰/波次增援），故除 resize 外由 33ms 循环按需重测 */
  useEffect(() => {
    const measure = (): void => {
      const lane = laneRef.current
      if (!lane) return
      const next: Dims = {
        W: lane.clientWidth || 1200,
        H: lane.clientHeight || 460,
        meW: meColRef.current?.offsetWidth || 330,
        foeW: foeColRef.current?.offsetWidth || 330,
      }
      setDims((d) =>
        d.W === next.W && d.H === next.H && d.meW === next.meW && d.foeW === next.foeW ? d : next,
      )
    }
    measureRef.current = measure
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 卸载 / 切出前冲刷未提交的滑条
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
      const v = dragValRef.current
      const m = mapRef.current
      if (v !== null && m.farM > 1) {
        engine.battleSetDesireAt(Math.round(m.farM - (v / 1000) * (m.farM - m.nearM)))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
return { finish }
}
