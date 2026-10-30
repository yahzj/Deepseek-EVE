import { UNBOX_CYCLE_MS } from '@whale/core'
import { Glyph } from '../../ui/Glyphs'
import { AiWorkFx, industryWorkKindOf } from '../../ui/aiWorkFx'
import { RowGlyph } from '../../ui/itemView'
import { IconBtn } from '../../ui/hud'
import { aiCoreText } from '../../ui/labelsText'
import { SUB_ALL, WRECK_SUBS, wreckTierOf } from '../../ui/itemSubs'
import { hoverTipProps } from '../../ui/Tooltip'
import { tr, cmdText } from '../../i18n/locale'
import { FEED_TABS } from './hudTypes'
import { RefineShareRing } from './RefineShareRing'
import { AiCorePick } from './AiCorePick'
import type { IndustryHudModel } from './useIndustryHud'

type HudRefiningProps = Pick<IndustryHudModel, 'production' | 'ringSegments' | 'rateBase' | 'rateMax' | 'rate' | 'runs' | 'stationCap' | 'ratePos' | 'foldStation' | 'setFoldStation' | 'engine' | 'core' | 'usableCores' | 'setCoreSel' | 'ctx' | 'stationTip' | 'onToast' | 'feedShown' | 'feedTab' | 'setFeedTab' | 'setFeedSub' | 'feedSub' | 'feedKwRaw' | 'setFeedKwRaw' | 'feedTip' | 'feedShortOf' | 'manualNote' | 'startFeed'>

export function HudRefining({ production, ringSegments, rateBase, rateMax, rate, runs, stationCap, ratePos, foldStation, setFoldStation, engine, core, usableCores, setCoreSel, ctx, stationTip, onToast, feedShown, feedTab, setFeedTab, setFeedSub, feedSub, feedKwRaw, setFeedKwRaw, feedTip, feedShortOf, manualNote, startFeed }: HudRefiningProps) {
  return (
(
          <div className="hud-grid two">
            {/* ── 左列：产出读数（上）＋ 工位矩阵（下）── */}
            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-eff" size={13} color="currentColor" /> {tr('ui.hud.051')}
                  <span className="hud-tiny" style={{ marginLeft: 8 }}>
                    {tr('ui.hud.126', { p1: Math.round(production.total).toLocaleString('zh-CN') })}
                  </span>
                </h3>
                <div className="hud-row" style={{ alignItems: 'center', gap: 16 }}>
                  {/* 圆环 = 各资源**产值/h 占比**的多段环（技能 Part-to-Whole：≤5 段＋「其他」、非颜色单一载体） */}
                  <RefineShareRing segments={ringSegments} total={production.total} />
                  <div style={{ minWidth: 148, flex: 1 }}>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.127')}</span>
                      <b>{Math.round(rateBase * 100)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.128')}</span>
                      <b>{Math.round(rateMax * 100)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.129')}</span>
                      <b>{Math.round(rate * 100)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.053')}</span>
                      <b>
                        {runs.length} / {stationCap}
                      </b>
                    </div>
                  </div>
                </div>
                {/* 倍率区间条：**两端有文字**（技能口径）+ 当前值刻度；不再用无目标的 Bullet */}
                <div className="hud-range" title={tr('ui.hud.130', { p1: Math.round(rate * 100) })}>
                  <span className="hud-tiny">{Math.round(rateBase * 100)}%</span>
                  <span className="hud-bar">
                    <i style={{ ['--v' as string]: Math.round(ratePos * 100) }} />
                    <em className="hud-range-tick" style={{ left: `${ratePos * 100}%` }} />
                  </span>
                  <span className="hud-tiny">{Math.round(rateMax * 100)}%</span>
                </div>
              </div>

              <div className={`hud-panel${foldStation ? ' is-folded' : ''}`}>
                {/* 标题行 = 标题 ＋ 右侧折叠按钮（**2026-09-30 船长令**：工位窗口可最小化成标题栏）。
                    无障碍：真 `<button>` ＋ `aria-expanded` ＋ `aria-controls`（指向正文 id），
                    名字用稳定的面板名，动作提示走 `title`（全仓 Tooltip 接管）。 */}
                <h3 className="hud-panel-head">
                  <Glyph name="ico-furnace" size={13} color="currentColor" />
                  <span className="hud-panel-title">{tr('ui.hud.041')}</span>
                  <IconBtn
                    glyph={foldStation ? 'ico-unfold' : 'ico-fold'}
                    title={foldStation ? tr('ui.hud.142') : tr('ui.hud.141')}
                    ariaLabel={tr('ui.hud.041')}
                    ariaExpanded={!foldStation}
                    ariaControls="hud-station-body"
                    onClick={() => setFoldStation((v) => !v)}
                  />
                </h3>
                {foldStation ? null : (
                <div id="hud-station-body">
                {/* **「优先使用的 AI」**（2026-09-30 船长令：「放在队列的顶部选择」）——
                    工位表就是精炼的"队列"，选择器坐它顶部（改前挂在同一窗口的**底部**，
                    实测 y 1190–1219 已在 940 视口之外，要滚才够得着）。 */}
                <AiCorePick engine={engine} suffix="refine" core={core} usableCores={usableCores} onPick={setCoreSel} pilotNote />
                {/* ⚠ `is-station` = 「首列是动图、主列是资源名」的窄表可压缩档（**2026-09-30 船长报障**：
                    这张表原先按 132px 首列 + 132px 主列 + 130px 进度列排版 ⇒ 最小宽 690px，
                    比左列还宽 ⇒ 整块按 690px 固定排版、不随窗口缩放，右边被右列盖住。
                    ⚠ 同日第三批船长令：「**工作最左侧不要显示工位编号**」＋「将精炼的动图应用到工位内」
                    ⇒ 首列从"工位号"改成 **AI 指挥中心那套精炼/回收动画**（同一实现 `AiWorkFx`，
                    判据 `industryWorkKindOf` 单点），编号下屏、改在悬停卡与「停炉」提示里出现。
                    档位定义见 `_hud-industry.css` 的 `.hud-table.is-station`） */}
                <table className="hud-table is-station">
                  <thead>
                    <tr>
                      <th className="hud-fx-cell" aria-label={tr('ui.hud.147')} />
                      <th>{tr('ui.hud.042')}</th>
                      <th>{tr('ui.hud.131')}</th>
                      <th className="n">{tr('ui.hud.043')}</th>
                      <th className="hud-cell-bar">{tr('ui.hud.044')}</th>
                      <th className="n">{tr('ui.hud.045')}</th>
                      <th className="act" />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="hud-tiny">{tr('ui.hud.046')}</td>
                      </tr>
                    ) : null}
                    {runs.map((v) => {
                      const def = v.itemId !== null ? ctx.items.get(v.itemId) : undefined
                      return (
                        <tr key={v.id} {...hoverTipProps(stationTip(v))}>
                          {/* 精炼/回收动画（AI 指挥中心同一份实现；固定尺寸槽位 ⇒ 行高不跳动） */}
                          <td className="hud-fx-cell">
                            <AiWorkFx kind={industryWorkKindOf(v.itemId, ctx.items)} />
                          </td>
                          {/* ⚠ 图标 2026-09-30 修（船长报障「工位那边资源图标是错误的」）：
                              原先这里挂的是**劳动者**图标（船/核心），现在挂**资源自身**的类别图标 */}
                          <td className="hud-cell-main">
                            <span className="hud-row" style={{ gap: 6 }}>
                              {def !== undefined ? <RowGlyph glyph={def.kind} /> : <RowGlyph glyph="ico-feed" />}
                              <span>{v.itemName}</span>
                            </span>
                          </td>
                          <td>
                            <span className="hud-chip">
                              <Glyph name={v.worker === 'pilot' ? 'nav-ship' : 'ai-core'} size={11} color="currentColor" />
                              {v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)}
                            </span>
                          </td>
                          <td className="n">{v.batchUnits.toLocaleString('zh-CN')}</td>
                          <td className="hud-cell-bar">
                            <span className="hud-bar scan">
                              <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                            </span>
                          </td>
                          <td className="n">{Math.round(v.cycleMs / 100) / 10}s</td>
                          <td className="act">
                            <IconBtn
                              glyph="ico-stop"
                              /* 编号下屏后，「停炉」提示要带上工位号（免得停错炉时无从核对） */
                              title={tr('ui.hud.047', { p1: String(v.id).padStart(2, '0') })}
                              onClick={() => {
                                const r = engine.stopRefineRunAt(v.id)
                                if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
                              }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
                )}
              </div>
            </div>

            {/* ── 右列：投料（三族 ＋ 两级筛选 ＋ 搜索）＋ 资源构成表 ── */}
            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-feed" size={13} color="currentColor" /> {tr('ui.hud.056')}
                  <span className="hud-tiny" style={{ marginLeft: 8 }}>{feedShown.length}</span>
                </h3>
                <div className="hud-chips">
                  {FEED_TABS.map((f) => (
                    <button
                      key={f.k}
                      className={`hud-chip${feedTab === f.k ? ' is-acc' : ''}`}
                      aria-pressed={feedTab === f.k}
                      onClick={() => {
                        setFeedTab(f.k)
                        setFeedSub(SUB_ALL)
                      }}
                    >
                      <Glyph name={f.glyph} size={11} color="currentColor" /> {tr(f.id)}
                    </button>
                  ))}
                </div>
                {/* 二级子筛选（按一级档换候选：可精炼资源按资源大类 / 残骸按档位；货柜无子类） */}
                {feedTab === 'ore' ? (
                  <div className="hud-chips">
                    {['ore', 'gas', 'ice'].map((k, i) => (
                      <button
                        key={k}
                        className={`hud-chip${feedSub === k ? ' is-acc' : ''}`}
                        aria-pressed={feedSub === k}
                        onClick={() => setFeedSub(feedSub === k ? SUB_ALL : k)}
                      >
                        {tr(`ui.IndustryPage.00${5 + i}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {feedTab === 'wreck' ? (
                  <div className="hud-chips">
                    {WRECK_SUBS.map((s) => (
                      <button
                        key={s.key}
                        className={`hud-chip${feedSub === s.key ? ' is-acc' : ''}`}
                        aria-pressed={feedSub === s.key}
                        onClick={() => setFeedSub(feedSub === s.key ? SUB_ALL : s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  className="hud-search"
                  value={feedKwRaw}
                  placeholder={tr('ui.hud.132')}
                  aria-label={tr('ui.hud.132')}
                  onChange={(e) => setFeedKwRaw(e.target.value)}
                />
                {feedShown.length === 0 ? (
                  /* 技能口径（Search · No Results）：空结果要给**下一步建议**，不是一句"0 条" */
                  <div className="hud-empty">{tr('ui.hud.133')}</div>
                ) : (
                  <table className="hud-table">
                    <tbody>
                      {feedShown.map(({ def, have, aiHave }) => (
                        <tr key={def.id} className={have <= 0 ? 'is-dim' : ''} {...hoverTipProps(feedTip(def, have))}>
                          <td>
                            <span className="hud-row" style={{ gap: 6 }}>
                              <RowGlyph glyph={def.kind} />
                              <span>{def.name}</span>
                              {def.kind === 'wreck' ? (
                                <span className="hud-chip">{tr(`ui.IndustryPage.00${wreckTierOf(def.id) === 'rare' ? 9 : 8}`)}</span>
                              ) : null}
                              {def.kind === 'container' ? (
                                <span className="hud-chip">{Math.round(UNBOX_CYCLE_MS / 1000)}s</span>
                              ) : null}
                            </span>
                            {/* 缺料：**不靠悬停也看得见**（船长同日令；触屏没有 hover）——红字 ＋ 真值「缺 N」；
                                **单独起一行**（船长同日追加：「缺料的文本也单独起一行」），不挤在资源名后面 */}
                            {feedShortOf(def, have) !== null ? (
                              <span className="hud-row-short">{feedShortOf(def, have)}</span>
                            ) : null}
                          </td>
                          <td className="n hud-tiny">{Math.floor(have).toLocaleString('zh-CN')}</td>
                          <td className="act">
                            <IconBtn
                              glyph="ico-play"
                              title={manualNote ?? tr('ui.hud.057', { p1: def.name })}
                              disabled={have <= 0 || manualNote !== null}
                              onClick={() => startFeed(def, 'pilot')}
                            />
                          </td>
                          <td className="act">
                            <IconBtn
                              glyph="ai-core"
                              title={tr('ui.hud.058', { p1: def.name })}
                              disabled={aiHave <= 0 || core === null}
                              onClick={() => core !== null && startFeed(def, core)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-eff" size={13} color="currentColor" /> {tr('ui.hud.121')}
                </h3>
                {production.rows.length === 0 ? (
                  <div className="hud-empty">{tr('ui.hud.134')}</div>
                ) : (
                  <table className="hud-table">
                    <thead>
                      <tr>
                        <th>{tr('ui.hud.042')}</th>
                        <th className="n">{tr('ui.hud.135')}</th>
                        <th className="n">{tr('ui.hud.136')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ringSegments.map((seg, i) => {
                        const share = production.total > 0 ? (seg.isk / production.total) * 100 : 0
                        return (
                          <tr key={seg.key}>
                            <td>
                              <span className="hud-row" style={{ gap: 6 }}>
                                <i className="hud-seg-dot" data-seg={i} />
                                <span>{seg.label}</span>
                              </span>
                            </td>
                            <td className="n">{Math.round(seg.isk).toLocaleString('zh-CN')}</td>
                            <td className="n">{share.toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )
  )
}
