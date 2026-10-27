import type { BattleSceneProps } from './sceneTypes'

/** 战斗界面职责：renderBattleScene，保持原调用顺序。 */

import type { CSSProperties } from 'react'
import { fleetDefOf } from '@whale/core'
import type { ShipRole } from '@whale/core'

import { BattleShipSprite } from './battleShipFx'
import { ammoKey } from './battleBlink'

import { DRONE_DWELL_MS, DRONE_SHOW_MAX, DRONE_SORTIE_BACK_MS, DRONE_SORTIE_OUT_MS, DRONE_STYLE, droneModelOrFallback } from './droneArt'
import { DMG_COLOR, DMG_LABEL, ROLE_ACCENT, LAY, sizeOfUnit, ROW2_BAR_DROP, fanPath, ringPath, HpTri } from './battleViewCore'
import { AcidEffect } from './battleAcidFx'
import { cmdText } from '../../i18n/locale'
import { hoverTipProps } from '../../ui/Tooltip'
import { DRONE_DOWN_FREEZE_MS } from './battleDrones'
import { BattleMountLines } from './battleMounts'
import { BattleCycles } from './BattleCycles'

export function renderBattleScene({
    rangeMode, screenRef, stage, onClose, tr, inWormhole,
    retreatAsk, setRetreatAsk, onToast, engine, ended, defeat,
    sceneName, secs, meStats, speedOptions, speedActive, arcs,
    foeCharging, ammoChips, repairLedgers, repairRunning, repairDetail, repairTotal,
    stageRef, fitRef, laneRef, starField, starLayerRefs, dims,
    meGunX, lay, meArcEls, foeGunX, foeInBand, foeR0,
    foeR1, foeColor, mainMeArc, meMainR1, multiMe, myDrawOrder,
    state, meFx, arrivalSide, arriveDxMe, ARRIVAL_FLY_MS, ARRIVAL_STAGGER_MS,
    meFlip, meColRef, meShip, meRole, meSize, combat,
    droneWings, foeWings, droneDownRef, droneBoxRef, droneElsRef, foeSortieRef,
    now, meFxRootRef, foeColRef, foeAnomaly, foeFormation, foeRowBoxes,
    noticeItems, webEls, muzzleEls, boltEls, acidFxRef, meAnchorByTag,
    layFx, popupEls, farM, nearM, visM, pct,
    sliderV, pushDragV, scheduleCommit, flushDrag, dragV, sliderToDesire,
    applyTactic,
  }: BattleSceneProps) {
return (
    /**
     * **战场 = 自己的全屏覆盖层**（2026-09-22 船长令「界面回滚，战斗界面回滚到全屏显示」）。
     *
     * 本批之前就是这一版：`.app-battle-screen { position: fixed; inset: 0; z-index: 100 }`，
     * 关掉它只是收起"观看界面"（战斗在后台照常推进，右上角那枚「⚔ 战斗中」浮动入口可随时点回来）。
     * 窗口化/嵌入主区那一整套（`ui/WinBox.tsx` 的 `is-battle` 用法、`bare` 模式、虫洞面板内嵌）
     * 已封存到分支 `archive/window-embed-20260922`，说明见 `docs/design/archived-window-embed-20260922.md`。
     * ⚠ 保留：慢镜/战报的挂载语义（`App.tsx` 里"打完但战报还没弹"的窗口期必须继续挂着）。
     */
    <div className={`app-battle-screen${rangeMode ? ' is-fitting-range' : ''}`} ref={screenRef}>
      {/**
       * **装不下就等比缩放**（2026-09-25 船长令 · 方案甲；**2026-09-26 改成只缩战场**）：
       * 顶栏／战场／底栏三段现在各自独立——**只有战场**（距离尺 ＋ 车道）按剩余高度缩放
       * （见下面 `.app-bts-stage-fit`），顶栏与底栏保持 1:1 逻辑尺寸。
       * 桌面窗口够高 ⇒ 战场 `k = 1`、高度 100%、无 `transform` ⇒ 与改造前逐像素一致。
       */}
      <div className="app-battle-screen-top">
        {stage === 'live' ? (
          <>
            {/**
             * **「← 最小化」= 收掉观战窗口**（**2026-09-20 船长改判**；按钮文字本身于
             * **2026-09-26** 按船长令由「← 退出战场」改为「← 最小化」——文案沿革见 `.037` 那条注释）。
             *
             * 船长原话（照抄）：「**虫洞内的战斗，允许玩家将战斗窗口最小化。**」
             * ⇒ **作废**本条原先的洞内禁用（旧裁定 2026-09-13：「虫洞中的战斗画面不可以退出」，
             * 当时落成 `disabled={inWormhole}` + 悬停写明原因）。
             *
             * **为什么放开是安全的（改判前查实）**：本按钮只关"观看界面"，**不碰这趟的任何状态**——
             * - 人还在洞里（虫洞面板开着）⇒ `run.attending` 仍为 true ⇒ **战斗照常推进**，
             *   活动栏/右上角「⚔ 战斗中」随时点回来看（与洞外那枚「← 最小化」同款机制，`App.tsx` 的
             *   `inBattle && !battleOpen` 浮动入口）；
             * - 真正"离开虫洞"是**面板的「✕ 关闭」**（那条入口**仍然禁用**，见 `Wormhole.handleClose`）
             *   ⇒ 走 `wormholeLeave`：活动停止、主控释放、洞内一切冻结（回来时战斗时钟整体前移、不补算）。
             *
             * ⚠ **没动的是"不给撤退"**：洞内战斗**一开必须打完**（船长 2026-09-12 第 8 条，
             * 撤离只在层末发起）——最小化 ≠ 撤退，下面那枚「撤退」在洞内依旧不出现。
             */}
            <button className="app-btn is-small" onClick={onClose} title={tr('ui.BattleScreen.105')}>
              {tr("ui.BattleScreen.037")}
            </button>
            {/* 洞内战斗**不给撤退**（船长 2026-09-12 第 8 条：战斗一开必须打完；撤离只在层末发起） */}
            {inWormhole ? (
              <span className="app-dim app-bts-noretreat" title={tr("ui.BattleScreen.038")}>
                {tr("ui.BattleScreen.039")}
              </span>
            ) : (
              <button
                className={`app-btn is-small is-warn${retreatAsk ? ' is-danger' : ''}`}
                title={tr("ui.BattleScreen.040")}
                onClick={() => {
                  if (!retreatAsk) {
                    setRetreatAsk(true)
                    onToast(tr("ui.BattleScreen.085"), true)
                    return
                  }
                  setRetreatAsk(false)
                  const r = engine.retreatNow()
                  if (!r.ok) onToast(cmdText(r) || tr('ui.BattleScreen.101'), true)
                }}
              >
                {retreatAsk ? tr("ui.ActivityBar.024") : tr("ui.BattleScreen.041")}
              </button>
            )}
          </>
        ) : (
          <span className="app-bts-outro-tag">{ended ? (defeat ? tr("ui.BattleScreen.042") : tr("ui.BattleScreen.043")) : ''}</span>
        )}
        <span className="app-gold">{sceneName}</span>
        <span className="app-dim">
          {tr("ui.BattleScreen.044")} {secs}{tr("ui.BattleScreen.045")} {meStats.meShots}{tr("ui.BattleScreen.046")} {meStats.meHits}{tr('ui.BattleScreen.100')} {meStats.foeShots}{tr("ui.BattleScreen.046")} {meStats.foeHits}
        </span>
      </div>
      {/* **顶部读数区**（**2026-09-30 船长令**：「将所有炮和冷却相关的放到屏幕上方」）——
          倍速（仅虫洞出现）→ 敌方射程带/挂载件 ＋ 弹药/修理
          → 武器下拉与逐舰装置周期；整块**不在等比缩放层里**（读数与触控不跟着战场缩，
          口径同 2026-09-26 船长令，见 `ui/battleFit.ts`）。 */}
      <div className="app-bts-topdock">
        <div className="app-bts-dock">
          {/* **洞内倍速**（船长 2026-09-19：位置 = 顶部中间、距离条上方；只显示已解锁档）——
              倍速只压战斗进程，演出动画（入场/转场/击杀慢镜）照原速播，见 `battleShowWindowMs`。
              ⚠ 它留在**缩放层之外**：这是"操作"，不跟着战场一起缩。 */}
          {speedOptions.length > 1 ? (
            <div className="app-bts-speedx">
              <span className="app-dim">{tr("ui.BattleScreen.047")}</span>
              {speedOptions.map((x) => (
                <button
                  key={x}
                  className={`app-btn is-small${x === speedActive ? ' is-active' : ''}`}
                  title={
                    x === 1
                      ? tr("ui.BattleScreen.048")
                      : tr("ui.BattleScreen.086", { x: x })
                  }
                  onClick={() => engine.setWormholeSpeed(x)}
                >
                  ×{x}
                </button>
              ))}
            </div>
          ) : null}
          {!rangeMode && <div className="app-bts-legends">
            {/* 船长2026-10-08实测修订：玩家射程和装填同在武器列表，外部不重复占位。 */}
            {/* 敌方射程（2026-09-11 船长：「敌方的舰船射程不一致，只会显示其中一个的射程」）：
                按**射程带**逐条出 chip（与我方逐武器一条同款），多条带时补「×N 艘」与逐舰悬停说明；
                只有一条带时文本与旧版完全一致（「敌方 X~Ym」）。 */}
            {(arcs.foeBands.length > 0
              ? arcs.foeBands
              : [{ ...arcs.foe, count: 0, names: [] as string[] }]
            ).map((b, bi) => (
              <span
                key={`foe${bi}`}
                className="app-bts-chip is-foe"
                {...hoverTipProps(
                  <>
                    <span className="app-ship-hover-title">
                      {tr("ui.BattleScreen.052")} {b.minM.toLocaleString('zh-CN')}~{b.maxM.toLocaleString('zh-CN')}m
                    </span>
                    <div className="app-info-note">
                      {b.names.length > 0
                        ? tr("ui.BattleScreen.089", { p1: b.names.join(tr("ui.MatterTechTab.017")), p2: b.minM, p3: b.maxM })
                        : tr("ui.BattleScreen.058")}
                    </div>
                    {b.mounts?.length ? <BattleMountLines names={b.mounts} pairs={b.mounts.map(name =>
                      arcs.foeMountNamePairs?.[arcs.foeMounts?.indexOf(name) ?? -1] ?? [name, name])} /> : null}
                  </>,
                )}
              >
                <i style={{ background: DMG_COLOR[b.type] }} />
                {tr("ui.BattleScreen.052")} {b.minM.toLocaleString('zh-CN')}~{b.maxM.toLocaleString('zh-CN')}m
                {/* 艘数量词按语言（2026-09-30 批 5）：原先是裸模板串 `` ×${n} 艘 `` */}
                {b.count > 1 ? tr('ui.BattleScreen.113', { p1: b.count }) : ''}
                <span className={`app-a-chip app-a-${b.type}`}>{DMG_LABEL[b.type]}</span>
              </span>
            ))}
            {/* 敌方冲锋标记（2026-09-10 船长定；**2026-09-14 改逐单位**：可能不止一条在冲）——
                复用同级"运行态 chip"样式（红点 = 告警态），不自造新类。
                ⚠ 冷却不再写死 10 秒：C 族 10 秒、A 族洞内海盗 30 秒（挂载件各自给，见 `FoeMountDef.charge`） */}
            {foeCharging > 0 ? (
              <span className="app-bts-repair is-down" title={tr("ui.BattleScreen.059")}>
                <i /> {tr("ui.BattleScreen.060")}{foeCharging > 1 ? ` ×${foeCharging}` : ''}
              </span>
            ) : null}
            {/* **敌方挂载件**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——有才占位，悬停看全名；
                2026-09-24 起按当前语言取一列（同 `foeMountNamePairs`；缺省回落中文名） */}
            {arcs.foeMounts && arcs.foeMounts.length > 0 ? (
              <span
                className="app-bts-chip is-foe"
                {...hoverTipProps(
                  <>
                    <span className="app-ship-hover-title">{tr("ui.BattleScreen.061")}</span>
                    <BattleMountLines names={arcs.foeMounts} pairs={arcs.foeMountNamePairs} statuses={arcs.gravekeeperStatuses} />
                  </>,
                )}
              >
                <i /> {tr("ui.BattleScreen.061")}
                {` ×${arcs.foeMounts.length}`}
              </span>
            ) : null}
            {ammoChips.length > 0 ? (
              <span className="app-bts-ammo">
                {ammoChips.map((t) => (
                  <span key={t} className={`app-a-chip app-a-${t}`}>
                    {arcs.ammoNames?.[ammoKey(t)] ?? DMG_LABEL[t]}×{arcs.ammo[ammoKey(t)].toLocaleString('zh-CN')}
                  </span>
                ))}
              </span>
            ) : null}
            {repairLedgers.length > 0 ? (
              <span
                className={`app-bts-repair${repairRunning ? "" : " is-down"}`}
                title={
                  (repairRunning
                    ? tr("ui.BattleScreen.062")
                    : tr("ui.BattleScreen.063")) +
                  (repairDetail ? `\n${repairDetail}` : '')
                }
              >
                <i /> {repairRunning ? tr("ui.BattleScreen.064") : tr("ui.BattleScreen.065")}
                <span className="app-dim">{tr("ui.BattleScreen.066")}{repairTotal.toLocaleString('zh-CN')}</span>
              </span>
            ) : null}
          </div>}
          <BattleCycles weapons={arcs.weapons} devices={arcs.devices} />
        </div>
      </div>

      {/* **我方编队条已撤**（2026-09-13 F2b · 交接卡 §3 建议）：4 舰读数改为**直接画在各自的舰影上**
          （舰名 + 三层血条 + 主控徽标 + 沉没灰态）⇒ 同一读数不再出现两遍。
          若船长要留，恢复成"折叠一行"的紧凑读数即可（原实现见 git 历史：`.app-bts-fleet` 那一块）。 */}

      <div className="app-bts-stage" ref={stageRef}>
        {/**
         * **战场内层**（2026-09-26 新增；**2026-09-30 起只剩车道**）：距离尺已按船长令搬到底部
         * （与拖动条合并成一条距离轴）⇒ 本层现在只装车道，**只有它**承接等比缩放
         * （`k = min(1, 战场外层高 ÷ 本层内容高)`；见 `ui/battleFit.ts`）——
         * 顶部读数区（炮/冷却）、页头与底栏保持 1:1 逻辑尺寸 ⇒ 手机上的字与触控不再被二次缩小。
         */}
        <div className="app-bts-stage-fit" ref={fitRef}>

        {/* 战场：两舰列间距 = 引擎真实距离（交火中 100ms 一拍）；弧线 = 武器射程 */}
        <div
          className={`app-bts-lane${defeat ? " is-defeat" : ""}`}
          ref={laneRef}
        >
          {/* 窄屏（手机竖屏）提示：舞台（车道）横向可滑动（`.app-bts-swipehint` 只在 ≤640px 显示） */}
          <span className="app-bts-swipehint">{tr("ui.BattleScreen.055")}</span>
          {/* 星空背景（三层视差、左右无缝循环；位于战场最底层，低对比不干扰分辨） */}
          <div className="app-bts-stars" aria-hidden="true">
            {starField.map(({ cfg, pts }, li) => (
              <div
                key={cfg.cls}
                className={`app-bts-star-layer ${cfg.cls}`}
                ref={(el) => {
                  starLayerRefs.current[li] = el
                }}
              >
                {pts.map((p, k) => (
                  <i key={`a${k}`} className="app-bts-star" style={{ left: p.x, top: p.y, width: p.r, height: p.r, opacity: p.o }} />
                ))}
                {pts.map((p, k) => (
                  <i key={`b${k}`} className="app-bts-star" style={{ left: p.x + Math.max(60, dims.W), top: p.y, width: p.r, height: p.r, opacity: p.o }} />
                ))}
              </div>
            ))}
          </div>
          {/* 入场效果**不再是一层覆盖图形**：改为入场那侧**舰船本体**飞入（我方列见下方 `is-arriving`、
              敌方逐舰见 `foeUnitEls` 的 `is-arriving`）——2026-09-13 船长二次裁定：
              「舰船从屏幕外以减速的形式进场并落到舰船战斗位置。这里只影响动画。不影响舰船实际位置。」
              旧的「泳道中线跃迁环 + 尾迹 + 闪光」覆盖层与此处的挂载点一并删除。 */}
          <svg className="app-bts-arcs" width="100%" height="100%" aria-hidden="true">
            {/* attribute transform（在无 viewBox/CSS-transform 兼容性问题上最可靠）；平滑由 33ms 视觉插值提供 */}
            <g transform={`translate(${meGunX} ${lay.me.y})`}>{meArcEls}</g>
            {!rangeMode && <g transform={`translate(${foeGunX} ${lay.foe[0]?.y ?? 0}) scale(-1 1)`} opacity={foeInBand ? 0.25 : 1}>
              <path d={fanPath(foeR0, foeR1)} style={{ fill: foeColor }} fillOpacity={0.16} />
              <path d={ringPath(foeR1)} fill="none" style={{ stroke: foeColor }} strokeWidth={2.4} strokeOpacity={0.9} />
              {arcs.foe.minM > 0 ? <path d={ringPath(foeR0)} fill="none" style={{ stroke: foeColor }} strokeWidth={1} strokeDasharray="3 5" strokeOpacity={0.5} /> : null}
            </g>}
            {/* 弧端米数刻度：弧长与面板/图例数字一一对应（敌方标签置于组外避免镜像反转） */}
            {mainMeArc && meMainR1 > 0 ? (
              <text className="app-bts-arc-label" x={meGunX + meMainR1 + 4} y={lay.me.y + 4} textAnchor="start">
                {mainMeArc.maxM.toLocaleString('zh-CN')}m
              </text>
            ) : null}
            {!rangeMode && <text className="app-bts-arc-label" x={foeGunX - foeR1 - 4} y={(lay.foe[0]?.y ?? lay.me.y) + 4} textAnchor="end">
              {arcs.foe.maxM.toLocaleString('zh-CN')}m
            </text>}
          </svg>

          {/* 我方舰列 —— 单船（远征 / 遭遇 / 教学）与 **4 舰同屏**（虫洞 F2b）共用这一支。
              · **单船路径**（`myUnits.length === 1`）：渲染与原实现**逐字一致**（同一 class / ref / style），
                ⇒ 观感零变化（交接卡验收第 5 条）；
              · **多舰路径**（虫洞 4 舰）：逐舰一条舰影，**主控保持原位**（距离尺与弹道锚点仍按主控那条舰，
                逐舰锚点是另一批的活）；其余 3 条沿纵队向左错位 `MY_LANE_STAGGER`×序号（近处=主控在最前，
                故 DOM 顺序把主控放最后 = 画在最上层）；
              · 每条各带**舰名 + 三层血条**（同一支 `HpTri`）、主控徽标（沿用编队条样式）、
                **沉没舰位置保留**只转灰（抽走会让其余舰影跳动 —— 验收第 4 条）；
              · 入场动画照旧：整列 `is-arriving` 自左缘外飞入，**逐舰 `--arrive-delay` 错峰**，
                只走 transform/opacity、落点坐标不动（验收第 6 条）。 */}
          {multiMe
            ? myDrawOrder.map(({ u, slot }, drawIdx) => {
                const def = fleetDefOf(state, engine.ctx, u.shipId)
                const role: ShipRole = def?.role ?? 'industrial'
                const spriteSize = sizeOfUnit(def?.tier, false)
                // **镜像斜向菱形**：锚点 = `lay.my[slot]`（主控那条恒等于 `me`，故距离尺/弹道不偏）
                const anchor = lay.my[slot] ?? lay.me
                const left = Math.round(anchor.x - spriteSize / 2)
                const top = Math.round(anchor.y - (spriteSize * 0.46) / 2)
                /** 本舰的闪现三态（§35 全队一起演：同侧同段 ⇒ 逐舰一致） */
                const bk = meFx
                return (
                  <div
                    key={u.tag}
                    /** `data-tag` = 闪现光柱的落点锚（`planBlinkPillars` / `syncBlinkPillarDom` 靠它找舰位） */
                    data-tag={u.tag}
                    className={`app-bts-col is-me${defeat && u.leader ? ' is-crippled' : ''}${u.alive ? '' : ' is-down'}${arrivalSide === 'me' ? ' is-arriving' : ''}${bk.cls}`}
                    style={
                      arrivalSide === 'me'
                        ? ({
                            left,
                            top,
                            '--arrive-dx': `${arriveDxMe}px`,
                            '--arrive-ms': `${ARRIVAL_FLY_MS}ms`,
                            '--arrive-delay': `${(u.leader ? 0 : drawIdx + 1) * ARRIVAL_STAGGER_MS}ms`,
                            ...bk.style,
                          } as CSSProperties)
                        : { left, top, ...bk.style }
                    }
                  >
                    <span className="app-bts-name">
                      {u.name}
                      {u.leader ? <i className="app-bts-fleet-lead">{tr("ui.BattleScreen.031")}</i> : null}
                    </span>
                    <BattleShipSprite
                      /**
                       * ⚠ **画舰影要用 `defId`（船型 id），不是 `shipId`（编队 uid）** ——
                       * 船长 2026-09-14 报障「**在虫洞内，友方舰船的图形不正确**」的真因：
                       * 这里原先传 `u.shipId`（形如 `sh-thresher#3`）⇒ `SHIP_ART['sh-thresher#3']`
                       * 查不到 ⇒ **退回 role 兜底剪影**，洞里 4 条友舰全成了通用轮廓。
                       */
                      shipId={u.defId}
                      role={role}
                      accent={ROLE_ACCENT[role]}
                      size={spriteSize}
                      flip={meFlip}
                      acceleration={u.boosting ? 'boost' : undefined}
                    />
                    {u.alive ? (
                      /**
                       * **血条宽度跟同排间距走**（2026-09-14 船长：「同一排舰船的间距可以再拉开一些，
                       * 目前会遮挡血条上的数字」）：`lay.myBarW` 由 `layout()` 按同排实际间距现算
                       * （= `间距 − 6`，上限 185 即 CSS 默认值）⇒ 邻舰船体压不到血条右端的数字。
                       * 单船路径没有这个值 ⇒ 落回 CSS 的 185px，逐像素不变。
                       */
                      <div className="app-bts-hpWrap" style={lay.myBarW !== undefined ? { width: lay.myBarW } : undefined}>
                        <HpTri hp={u.hp} max={u.hpMax} />
                      </div>
                    ) : (
                      <span className="app-bts-fleet-down">{tr("ui.BattleScreen.056")}</span>
                    )}
                  </div>
                )
              })
            : (
              <div
                /** 单船路径的战 tag 恒为 `player`（见 `combat.ts` 建 `myFleet` 那处）：光柱落点锚 */
                data-tag="player"
                className={`app-bts-col is-me${defeat ? " is-crippled" : ""}${arrivalSide === 'me' ? ' is-arriving' : ''}${meFx.cls}`}
                ref={meColRef}
                style={
                  arrivalSide === 'me'
                    ? ({ left: lay.meLeft, '--arrive-dx': `${arriveDxMe}px`, '--arrive-ms': `${ARRIVAL_FLY_MS}ms`, ...meFx.style } as CSSProperties)
                    : { left: lay.meLeft, ...meFx.style }
                }
              >
                <span className="app-bts-name">{meShip?.name}</span>
                <BattleShipSprite shipId={meShip?.id} role={meRole} accent={ROLE_ACCENT[meRole]} size={meSize} flip={meFlip} acceleration={arcs.myUnits[0]?.boosting ? 'boost' : undefined} />
                <div className="app-bts-hpWrap">
                  <HpTri hp={combat.meHp} max={arcs.maxHp.me} />
                </div>
              </div>
            )}

          {/* 无人机机群（2026-09-10：蜂鸟/赤鸢/猎鹰 起飞即出击-到位开火-立刻返航；雷鸥哨戒常驻伴飞）；
              位置由 rAF 驱动层直接写 transform（见上），此处只负责结构与显隐。
              **2026-09-11 机群批 S5 第二层**：**敌方机群**（警戒机）也进这一层——同一套出击制，
              只是起点换成**敌舰机库口**、阵位落在**两舰之间**、机体**镜像朝向**（敌机朝我）。 */}
          {/* ⚠ **挂载条件必须把'待播的击落演出'也算上**（2026-09-11 船长：「当最后一架敌机判断击毁时，
              该次攻击动画将会消失（没有飞出攻击返航的动画，也没有返航时爆炸的动画）」）——
              旧口径只看'还有活着的机群'：**最后一架被打掉 ⇒ 该机群归零 ⇒ 整层被卸载**
              ⇒ 连它那一轮正在播的**击落定格/滑行/爆炸**一起消失。 */}
          {droneWings.length > 0 ||
          foeWings.length > 0 ||
          droneDownRef.current.length > 0 ? (
            <div
              className="app-bts-drones"
              ref={droneBoxRef}
              aria-hidden="true"
            >
              {droneWings.map((w) => (
                <div
                  key={w.key}
                  className={`app-bts-wing is-${w.phase}${w.phase === "deck" ? " is-deck" : ""}${w.model.resident ? " is-resident" : ""}${DRONE_STYLE === "sortie" ? " is-sortie" : " is-formation"}`}
                >
                  {Array.from({ length: w.show }, (_, i) => (
                    <span
                      key={i}
                      ref={(el) => {
                        const key = `${w.key}|${i}`
                        if (el) droneElsRef.current.set(key, el)
                        else droneElsRef.current.delete(key)
                      }}
                      className="app-bts-drone"
                      style={{ left: 0, top: 0, color: w.model.tint }}
                    >
                      <svg
                        viewBox="-13 -8 26 16"
                        width="22"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      >
                        {w.model.art}
                      </svg>
                    </span>
                  ))}
                  {w.total > w.show ? (
                    <span className="app-bts-drone-more">×{w.total}</span>
                  ) : null}
                </div>
              ))}
              {/* ── **敌方机群（第二层）**：从**敌舰机库口**放出 → 飞抵**两舰之间** → 到位开火 → 掉头返航 ──
                  与我方**同一套出击制**（放出 0.56s / 停留 0.22s / 返航 0.62s · 每架一条弧线），
                  只是**起点换成敌舰**、阵位落在两舰之间（弹道层同口径：`敌舰锚点 − 42~68px`）、
                  **机体镜像朝向**（出海朝我、返航掉头）。本轮起点由弹道层在首次开火时盖章（`foeSortieRef`）。
                  坐标以本层原点（＝我方舰位）为基准——与击落演出 `d.x - lay.me.x` 同源。 */}
              {foeWings.map((w) => {
                // 兜底取机型（2026-09-26）：敌侧同理，漏登记不再整队机体消失
                const model = droneModelOrFallback(w.artId)
                const show = Math.min(w.alive, DRONE_SHOW_MAX);
                // 收舱待命段与我方同款：加 `is-deck` ⇒ CSS `display:none`（不再"停在敌舰甲板上朝右不动"）
                const fst = foeSortieRef.current.get(`${w.tag}:${w.artId}`)
                const fcyc2 =
                  DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
                const fel2 = fst ? now - fst.startAt : Number.POSITIVE_INFINITY
                const onDeck = !fst || fel2 >= fcyc2;
                // 位置**不在这里算**：与本方机群一样交给 rAF 驱动层（`droneDriveRef.wings` 里带 `foe` 的那些），
                // 驱动按 `foePoseAt` 写 transform（含 translate(-50%,-50%) 居中与 scaleX(heading) 朝向）。
                // ⚠ 旧版在这里自己写 left/top ⇒ 机群层盒子只有"我方有机群"时才被平移到我方舰位，
                //   玩家不带无人机时敌机全部落在未平移的盒子里（船长实测：位置错、还随布局漂移）。
                return (
                  <div
                    key={`foe-${w.tag}-${w.artId}`}
                    className={`app-bts-wing is-sortie${onDeck ? " is-deck" : ""}`}
                  >
                    {Array.from({ length: show }, (_, i) => (
                      <span
                        key={i}
                        ref={(el) => {
                          const k = `foe:${w.tag}:${w.artId}|${i}`
                          if (el) droneElsRef.current.set(k, el)
                          else droneElsRef.current.delete(k)
                        }}
                        className="app-bts-drone"
                        style={{ color: model.tint }}
                      >
                        <svg
                          viewBox="-13 -8 26 16"
                          width="22"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        >
                          {model.art}
                        </svg>
                      </span>
                    ))}
                    {w.count > show ? (
                      <span className="app-bts-drone-more">×{w.alive}</span>
                    ) : null}
                  </div>
                )
              })}
              {/* 被点防击落的机体：原位小爆炸 + 碎片下坠（截图位与机体同一坐标系，见 .app-bts-drone-wreck） */}
              {droneDownRef.current.map((d) => {
                // 兜底取机型（2026-09-26）：与坠落登记处同一把尺，漏登记也照样画爆炸
                const model = droneModelOrFallback(d.artId)
                const age = now - d.born;
                // ① **原地定住**（船长 2026-09-11：「所有无人机被判定击落时，在返航到一半的途中
                //    原地停止然后爆炸」）——先让机体**停在被打中的那一刻的位置**约 0.32 秒
                //    （不消失、不动），玩家才看得清"是这一架被打下来了"，然后才炸。
                if (age < DRONE_DOWN_FREEZE_MS) {
                  // ① **继续往回飘 1/3 段**（船长：「爆炸的时间点定在返航到 1/3 的途中」）——
                  //    机体在被打中后的 `DRONE_DOWN_FREEZE_MS` 内从被打中的位置滑向爆炸点，然后才炸。
                  const u = Math.max(
                    0,
                    Math.min(1, age / DRONE_DOWN_FREEZE_MS),
                  )
                  const gx = d.x + (d.tx - d.x) * u
                  const gy = d.y + (d.ty - d.y) * u
                  return (
                    <span
                      key={d.key}
                      className="app-bts-drone"
                      style={{
                        position: 'absolute',
                        left: gx - lay.me.x,
                        top: gy - lay.me.y,
                        color: model.tint,
                        transform: 'translate(-50%, -50%)',
                        opacity: 0.9,
                      }}
                    >
                      <svg
                        viewBox="-13 -8 26 16"
                        width="22"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      >
                        {model.art}
                      </svg>
                    </span>
                  )
                }
                return (
                  <span
                    key={d.key}
                    className={`app-bts-drone-wreck${d.foe ? " is-foe" : ""}`}
                    style={{
                      left: d.tx - lay.me.x,
                      top: d.ty - lay.me.y,
                      color: model.tint,
                    }}
                  >
                    {/* 敌机（警戒机）的击落演出放大 1.5×（2026-09-11 船长：'完全无法察觉'）——
                        族色残铁棕 + 更大的冲击环，让'打下来了'这件事在满屏弹道里也看得见 */}
                    <svg
                      viewBox="-14 -11 28 22"
                      width={d.foe ? 46 : 30}
                      height={d.foe ? 37 : 24}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={d.foe ? 1.6 : 1.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {/* **效果 A：白色高亮扩散环**（船长 2026-09-11 选定）——比族色环更亮、线更粗，
                          在满屏弹道里一眼能看见'这一架没了' */}
                      <circle
                        className="app-bts-wreck-ring"
                        cx="0"
                        cy="0"
                        r="5"
                        /* ⚠ 走 style（属性不认 var()）：亮底下"白描边"看不见 ⇒ 用主题里最亮的文字色当高光 */
                        style={{ stroke: 'rgb(var(--wui-text-hi))' }}
                        strokeWidth="2.4"
                      />
                      {/* 冲击环（向外扩散淡出） */}
                      <circle className="app-bts-wreck-ring" cx="0" cy="0" r="5" />
                      {/* 爆散射线（八向短线） */}
                      <path className="app-bts-wreck-rays" d="M0 -6 L0 -10 M4.4 -4.4 L7.4 -7.4 M6 0 L10 0 M4.4 4.4 L7.4 7.4 M0 6 L0 10 M-4.4 4.4 L-7.4 7.4 M-6 0 L-10 0 M-4.4 -4.4 L-7.4 -7.4" />
                      {/* 崩落碎屑（三片，各自下坠） */}
                      <path className="app-bts-wreck-bit" d="M-3 -1 l2.6 1.2 l-2.6 1.6 z" />
                      <path className="app-bts-wreck-bit is-b" d="M1.6 -2.2 l2.4 1 l-2.2 1.8 z" />
                      <path className="app-bts-wreck-bit is-c" d="M-0.6 2 l2.2 1 l-2 1.6 z" />
                    </svg>
                  </span>
                )
              })}
            </div>
          ) : null}

          {/* 🔴 **我方闪现光柱宿主**（**2026-10-02 §35**）：零尺寸、钉在舞台原点。
              为什么另起一层：敌方有 `.app-bts-col.is-foe` 当公共列盒，**我方舰列是逐舰绝对定位的
              兄弟节点、没有公共盒**；而光柱又**不能挂进我方舰船那一列**（那一列在等待段挂着
              `opacity: 0`，子元素会被一起压成全透明 —— §32 敌方那次的同一个坑）。
              ⚠ 本层自身零尺寸且在原点 ⇒ 里面按 `offsetLeft/offsetTop` 定位的光柱与我方舰位逐像素对齐。 */}
          <div className="app-bts-fxhost" ref={meFxRootRef} aria-hidden="true" />

          {/* 敌方舰列（2026-09-11 船长③：血条跟着各舰走——已随各舰渲染，列底不再竖排血条；
              尸骸原位占槽演出见 foeUnitEls） */}
          <div className="app-bts-col is-foe" ref={foeColRef} style={{ left: lay.foeLeft, ...(foeAnomaly?.foeFamily === 'C' && foeAnomaly.region === 'inv' ? { width: foeFormation.rowW, maxWidth: 'none' } : {}) }}>
            {/* 整行 `margin-top` = 下沉补偿（抬升超出上方留白时才非 0，现值 0）——与 layout 的基线同源 */}
            {/* **敌列阵形：斜向菱形**（2026-09-12 船长「2×2 菱形 → 斜向菱形、第二排向右偏移」选丙②）：
                两排各若干舰，**第二排右移半格 + 下移一个舰高**（`layout` 的阵形几何是唯一出处）；
                外层定宽块 = 编队总宽（由列宽推得），列高固定为单排行高 ⇒ DOM 与锚点逐像素对齐。
                ⚠ **2026-09-25 修船长报障「从上往下数第二排敌人的左右间距拉开一些，右边舰船的血条会
                遮挡左边舰船的数字」**：每一排改成**列盒**铺法（`foeRowBoxesOf`：逐列定宽盒 ＋ 盒间距
                `ROW_GAP`，舰在盒内居中）—— **列盒中心恒等于 `layout()` 的锚点**。旧写法是平铺 flex
                （`gap: 4px`）＋ 逐舰 `marginLeft` 居中 ⇒ 同排内逐舰向左累积偏差（"窄舰坐宽列"时可达
                上百 px），血条宽度却按锚点算 ⇒ 第二排右舰血条压住左舰血条的数字。 */}
            <div style={{ width: foeFormation.rowW }}>
              <div className="app-bts-shipRow" style={{ minHeight: foeFormation.rowH, gap: LAY.ROW_GAP }}>
                {foeRowBoxes(0)}
              </div>
              {foeFormation.rows === 2 ? (
                <div
                  className="app-bts-shipRow"
                  /* 2026-09-13 船长：「第二排下移，目前会挡住第一排血条（敌我都移动）」——
                     第二排容器再加 `ROW2_BAR_DROP`（一条血条高 + 6 缝隙，与 `layout` 的锚点同源同值），
                     让第二排舰体顶边落到第一排血条**之下**；第一排容器一律不动。 */
                  style={{
                    minHeight: foeFormation.rowH,
                    marginLeft: foeFormation.shift,
                    marginTop: ROW2_BAR_DROP,
                    gap: LAY.ROW_GAP,
                  }}
                >
                  {foeRowBoxes(1)}
                </div>
              ) : null}
            </div>
            {/* **机库余量**（2026-09-12 船长：由"敌舰列下方一行 chip"改为**跟着各舰名字**显示
                「图标 ×N」——见 `hangarBadgeOf`）：此处不再单独出一行。 */}
          </div>

          {/* **战斗窗口正上方提示位**（2026-09-11 船长：与"敌方增援"统一下系统、位置由"敌舰上方"
              改到**战斗窗口正上方**）：波次增援 + 引擎推来的战斗提示（如受击增程）共用这一处。 */}
          {noticeItems.length > 0 ? (
            <div className="app-bts-notices">
              {noticeItems.map((n) => (
                <span key={n.key} className="app-bts-wave-hint">
                  {n.text}
                </span>
              ))}
            </div>
          ) : null}

          {/* **劫掠捕获网连线**（船长 2026-09-16）：持续态，画在弹道层**之下**，不挡弹道 */}
          {webEls}
          {/* 开火闪光 + 弹道 + 撞点特效（最上层） */}
          {muzzleEls}
          {boltEls}
          <div className="app-bts-acid-layer" aria-hidden="true">
            {acidFxRef.current.map(effect => {
              const anchor = effect.kind === 'burst' ? effect : meAnchorByTag.get(effect.tag) ?? layFx.me
              return <AcidEffect key={effect.key} effect={{ ...effect, x: anchor.x, y: anchor.y }} />
            })}
          </div>
          {/* 伤害飘字层（2026-09-24 船长令）：叠在弹道之上、不吃点击（CSS 里 pointer-events:none） */}
          {popupEls}
        </div>
        </div>
      </div>

      {/* 底部：距离轴（2026-09-30 船长令：原上方的距离条搬下来）＋ 战术三键；
          战斗已结束时轴与按钮一并禁用，等战报 */}
      <div className="app-battle-controls">
        <div className="app-bts-dock">
          {/* **距离轴**（**2026-09-30 船长令**：「原本屏幕上方的距离条挪到下方，和下方我方控制距离的
              拖动条合并（显示以上方距离条为准，只将拖动按钮挪过去）」）——
              轴 = 原距离尺整条（双方速度 / 远端·近端 / 刻度 ＋ 双方射程带 ＋ **当前距离游标与米数**，
              实时照旧）；**拖动旋钮** = 原滑条手柄，叠在同一条刻度上（改的是"期望交距"）；
              期望交距的米数读数照旧常驻（2026-09-29 船长报障「数值不见了」那条不撤）。 */}
          <div className="app-bts-axisRow">
            {/* 距离轴（游标式）：左 = 远（拉开）→ 右 = 近（贴脸）；**拖动旋钮就叠在这条刻度上**，
               与当前距离游标同轴同比例（2026-09-30 船长令：原来的上下两条合成这一条）。 */}
            <div className="app-bts-ruler">
              {/* **双方速度**（2026-09-16 船长：「在上方的距离条两端的上方分别显示敌我的战斗速度」；
                  同日裁「只修改战斗显示数值，实际数值不变动」）：
                  左端 = 我方（舰队在左）· 右端 = 敌方；口径 = **与装配页「机动速度」同一把尺**
                  （单位速度 × 机动倍率，逐单位平均；我方点火期含推进器倍率、敌方冲锋期含冲锋倍率）。
                  缺省（未开火/老档）不显示这一行。 */}
              {arcs.meSpeedMps !== undefined || arcs.foeSpeedMps !== undefined ? (
                <div className="app-bts-ruler-speed">
                  <span
                    className="app-bts-speed is-me"
                    title={tr("ui.BattleScreen.049")}
                  >
                    {tr("ui.BattleScreen.050")} {Math.round(arcs.meSpeedMps ?? 0).toLocaleString('zh-CN')} m/s
                  </span>
                  <span
                    className="app-bts-speed is-foe"
                    title={tr("ui.BattleScreen.051")}
                  >
                    {tr("ui.BattleScreen.052")} {Math.round(arcs.foeSpeedMps ?? 0).toLocaleString('zh-CN')} m/s ▶
                  </span>
                </div>
              ) : null}
              <div className="app-bts-ruler-head">
                <span className="app-dim">{tr("ui.BattleScreen.053")} {Math.round(farM).toLocaleString('zh-CN')}m）</span>
                <span className="app-dim">{tr("ui.BattleScreen.054")} {Math.round(nearM).toLocaleString('zh-CN')}m）▶</span>
              </div>
              <div className="app-bts-axisTrack">
                <div
                  className="app-bts-scale"
                  /* 无障碍（2026-09-26 I4，2026-09-30 挪位）：尺是纯图形读数 ⇒ 给一个语义标签；
                   语义标签现在挂在**刻度**上而不是整条尺上——拖动旋钮是叠在刻度上的真控件，
                   role="img" 若留在外层会把它一起吞掉（读屏不可达）。 */
                  role="img"
                  aria-label={tr("ui.BattleScreen.112", {
                    p1: Math.round(visM).toLocaleString('zh-CN'),
                    p2: Math.round(farM).toLocaleString('zh-CN'),
                    p3: Math.round(nearM).toLocaleString('zh-CN'),
                  })}
                >
                  <i className="app-bts-zone is-me" style={{ left: `${pct(mainMeArc?.maxM ?? farM)}%`, width: `${Math.max(0.6, pct(mainMeArc?.minM ?? 0) - pct(mainMeArc?.maxM ?? farM))}%` }} title={tr("ui.BattleScreen.087", { p1: mainMeArc?.minM ?? 0, p2: mainMeArc?.maxM ?? 0 })} />
                  <i className="app-bts-zone is-foe" style={{ left: `${pct(arcs.foe.maxM)}%`, width: `${Math.max(0.6, pct(arcs.foe.minM) - pct(arcs.foe.maxM))}%` }} title={tr("ui.BattleScreen.088", { p1: arcs.foe.minM, p2: arcs.foe.maxM })} />
                  <i className="app-bts-tick" style={{ left: '25%' }} />
                  <i className="app-bts-tick" style={{ left: '50%' }} />
                  <i className="app-bts-tick" style={{ left: '75%' }} />
                  <i className="app-bts-cursor" style={{ left: `${pct(visM)}%` }} title={tr("ui.BattleScreen.070")} />
                  <span className="app-bts-cur-chip" style={{ left: `${pct(visM)}%` }}>
                    {Math.round(visM).toLocaleString('zh-CN')}m
                  </span>
                </div>
                {/* **拖动旋钮**（2026-09-30 船长令：「只将拖动按钮挪过去」）——就是原来那根滑条，
                  事件与节流逻辑一字未动（拖它改的是"期望交距"，不是当前距离）。 */}
                <input
                  type="range"
                  className="app-battle-range app-bts-range app-bts-knob"
                  min={0}
                  max={1000}
                  /**
                    * **步长 1**（2026-09-13 船长反馈"一格一格"）：原 `step=5` 只有 201 个落点——
                    * 在洞内这种 5 千多米的量程上，一格 ≈ 27m，慢拖时肉眼就是"跳格"。
                    * 1 ⇒ 1001 个落点（约 5m/格），拖动与读数都跟手。
                    */
                  step={1}
                  disabled={ended || rangeMode}
                  value={Math.min(1000, Math.max(0, sliderV))}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    // **每帧最多重绘一次**（2026-09-13 性能修）：高回报率鼠标一次拖动能来几百个
                    // input 事件，逐个 setState 会把整棵战场（我方 4 舰 + SVG 弧 + 事件环）重渲染几百次
                    // ⇒ 顿挫。这里合并到 rAF：画面最多 60 次/秒，提交仍按 160ms 节流。
                    pushDragV(v)
                    scheduleCommit(v)
                  }}
                  onPointerUp={flushDrag}
                  onPointerCancel={flushDrag}
                  onBlur={flushDrag}
                  onKeyUp={flushDrag}
                  title={tr("ui.BattleScreen.069")}
                />
              </div>
            </div>
            {!rangeMode && <span className="app-gold app-bts-desire">
              {tr("ui.BattleScreen.072")} {(dragV === null ? Math.round(combat.myDesireM) : sliderToDesire(sliderV)).toLocaleString('zh-CN')}m
            </span>}
          </div>
          {!rangeMode && <div className="app-bts-ops">
            <span className="app-battle-tacs">
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('assault')}>{tr("ui.BattleScreen.073")}</button>
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('mid')}>{tr("ui.BattleScreen.074")}</button>
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('kite')}>{tr("ui.BattleScreen.075")}</button>
            </span>
            <span className="app-dim app-bts-note">
              {ended
                ? tr("ui.BattleScreen.076")
                : tr("ui.BattleScreen.077")}
            </span>
          </div>}
        </div>
      </div>
      {/* /app-battle-screen 收口（2026-09-26：整屏等比缩放已撤，改成只缩战场 `.app-bts-stage-fit`） */}
    </div>
  )

}
