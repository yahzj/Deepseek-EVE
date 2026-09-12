/**
 * 序章·苏醒 阶段 4（2026-09-05 船长确认；2026-09-11 船长改为**教程融入通讯**）——教程引导：
 *
 * - **七步全文已移进通讯**（每步开始时由**舰载信息库 · 检索重启**发来一封教程通讯，
 *   见 `data/src/tutorialSteps.ts` 与 `data/src/messages.ts` 的 `tut-*`）；本文件**不再有右下角引导卡**。
 * - **睁眼动画结束后不立刻开始教程**（2026-09-11 船长定）：先落到简报态（`ONB_BRIEFING`）——
 *   顶栏只显示「先看通讯」+「前往通讯」+「跳过教程」，玩家在简报那封里点「开始教程」才进第 1 步。
 * - 本文件保留两件事：①**顶部引导条**；②**光圈高亮 + 「点这里」气泡**（按步骤关键字找当前应点的目标）。
 * - 步骤 8：收尾演出覆盖层（全屏文本 → 「开始新的航程」→ finishTutorial → step 99 全解锁）。
 * 锁定策略（页签/按钮级）在 App.tsx 实施；本组件只管展示与跳转意图。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { BRIEFING_INTRO, TUTORIAL_STEPS, TUTORIAL_TOTAL } from '@whale/data'
import { ONB_BRIEFING } from '@whale/core'
import type { GameEngine } from '../game/engine'

export type GuideGo = { page: string; mapTab?: string; shipTab?: string; taskTab?: string }

/** 收尾演出文本（步骤 8）——2026-09-11 随教程文案优化统一口径：主体不分离、不替玩家下判断 */
const EPILOGUE_LINES = [
  '你睁开眼睛的时候，泊位里只有排风扇的低鸣。',
  '章鱼人经营着这座母港——他们买货、修站、发布悬赏，对角落里这艘旧船一无所知。',
  '乘员栏一直是空的。档案只剩碎片：人类的踪迹断在本舰沉睡的某个年代，原因不明。',
  '但本舰记得怎么采矿、怎么修理、怎么开火，甚至还记得「AI 核心操作学」这门手艺。',
  '一艘不该存在的旧时代舰船 AI——是时候去打听人类的下落了。',
]

/** 收尾演出覆盖层（步骤 8；点击文本区逐步显示 → 按钮完成） */
export function TutorialEpilogue({ engine, onDone }: { engine: GameEngine; onDone: () => void }) {
  const [shown, setShown] = useState(1)
  const [finishing, setFinishing] = useState(false)

  const complete = (): void => {
    if (finishing) return
    setFinishing(true)
    const r = engine.prologueFinishShow()
    if (r.ok) onDone()
    else setFinishing(false)
  }

  const all = shown >= EPILOGUE_LINES.length
  return (
    <div className="app-pro-epi" onClick={() => setShown((v) => Math.min(EPILOGUE_LINES.length, v + 1))}>
      <div className="app-pro-epi-inner">
        <div className="app-pro-epi-title">—— 苏醒完成 ——</div>
        {EPILOGUE_LINES.slice(0, shown).map((l, i) => (
          <div key={i} className="app-pro-epi-line">
            {l}
          </div>
        ))}
        {all ? (
          <>
            <div className="app-pro-epi-quest">◆ 重要任务已发布「寻找人类」—— 完成方法未知（目标档案见手册·航行须知）。</div>
            <button className="app-btn is-primary" onClick={complete}>
              开始新的航程
            </button>
          </>
        ) : (
          <div className="app-pro-hint">（点击画面继续）</div>
        )}
      </div>
    </div>
  )
}

/**
 * 教程步骤聚焦条 + 光圈高亮（2026-09-05 船长反馈：玩家找不到"下一步"按钮）：
 * - 顶栏下方居中的操作条：**步骤 N/7** + 当前目标一句话 + 「前往…」跳转 + 「看详情」（开通讯页读全文）+ 「跳过」；
 * - 画面级光圈：按步骤关键字在可见按钮里找当前应点的目标，画高亮框 + "点这里"气泡；
 * - 步骤内分阶段（如 S1：先切沙猫 → 再出击），按引擎状态自动换焦点。
 */
interface StepPlan {
  /** 当前动作一句话（顶栏显示；比通讯正文明快） */
  text: string
  go: GuideGo
  goLabel: string
  targets: string[]
  /**
   * 步骤内的**元素级焦点**（可选；2026-09-11 船长：「步骤 7/7 建议先指引玩家选择副船
   * （高亮对应下拉框）」）——光圈原先只扫 `button`，下拉框（`select`）扫不到；
   * 这里给一个专属口：返回非空即优先指它，返回 null 时回落到 `targets` 关键字。
   */
  selectFirst?: () => Element | null
}

/** 步骤 N 的教程通讯 id（与 `data/src/messages.ts` 的 `tut-<step>` 同源） */
export function tutorialMessageId(step: number): string {
  return `tut-${step}`
}

/** 该步骤自带的页内标签（App 在步骤切换时用它把页面归位；步骤 2 → 任务中心「重要任务」）。
 *  教程数据的读法收在本模块里，App 不必直接依赖 `@whale/data`。 */
export function tutorialTaskTabOf(step: number): string | undefined {
  return TUTORIAL_STEPS.find((s) => s.step === step)?.taskTab
}

function stepPlan(engine: GameEngine, step: number): StepPlan {
  const def = TUTORIAL_STEPS.find((s) => s.step === step)
  const state = engine.state
  // 简报态（睁眼动画刚结束）：不指任何目标按钮，只把玩家推去通讯读简报
  if (step === ONB_BRIEFING) {
    return {
      text: BRIEFING_INTRO.goal,
      go: { page: 'comms' },
      goLabel: '前往通讯',
      targets: [],
    }
  }
  if (step === 1) {
    if (state.shipId !== 'sandcat') {
      return {
        text: '第一步：把驾驶船切换为「沙猫级采矿艇」',
        go: { page: 'ship', shipTab: 'fleet' },
        goLabel: '前往舰船页·切换驾驶',
        targets: ['舰船', '设为驾驶', '切换驾驶'],
      }
    }
    return {
      text: '第二步：出港采集富凡晶石（采足 50 即自动返航）',
      go: { page: 'map', mapTab: 'mine' },
      goLabel: '前往出港·矿带开采',
      targets: ['出港', '矿带开采', '采掘', '出击', '开采'],
    }
  }
  if (!def) return { text: '', go: { page: 'map' }, goLabel: '', targets: [] }
  // 步骤 3（卖矿石）：指引条给明确动作句（2026-09-09 船长反馈——原取 lines[0] 为背景解释，
  // 玩家不知道下一步干嘛）；通讯正文里是完整说明
  if (step === 3) {
    return {
      text: '把矿石换成 ISK：前往「物品」页 → 仓库标签，富凡晶石点「市价卖出」',
      go: { page: 'items' },
      goLabel: def.goLabel,
      targets: ['物品', '仓库', '市价卖出', '卖出'],
    }
  }
  const byStep: Record<number, string[]> = {
    2: ['出港', '任务中心', '交付矿石'],
    4: ['舰船', '港内维修', '维修', '修理'],
    5: ['出港', '常驻悬赏', '演习场驱逐令', '出发'],
    6: ['技能', 'AI 核心操作学'],
    7: ['舰船', 'AI 指挥中心', '指派', '采矿'],
  }
  return {
    text: def.goal,
    go: { page: def.page, mapTab: def.mapTab, shipTab: def.shipTab, taskTab: def.taskTab },
    goLabel: def.goLabel,
    targets: byStep[step] ?? [],
    // 步骤 7 第一阶段：先让玩家在指派表单里选中副船（下拉框），选好后光圈自动落到「指派」按钮
    ...(step === 7 ? { selectFirst: aiAssignShipSelect } : {}),
  }
}

/**
 * 在可见按钮里找当前应点的目标（2026-09-06 船长反馈：光圈方框位置错误——
 * 根因 1：按关键字"首个命中"，常落在左侧常驻导航(出港/舰船)而非页面内的真实按钮；
 * 根因 2：只在步骤切换后定位一次，页面转场/滚动后框不跟随）。
 * 修法：优先排除左侧导航，在页面内容里取**最深的可见命中**（真正的操作按钮）；
 * 找不到才回退到导航按钮；随后由轮询持续跟随位置。
 */
function lastVisibleMatch(keywords: string[], excludeNav: boolean): { el: Element; text: string } | null {
  let best: { el: Element; text: string } | null = null
  for (const el of Array.from(document.querySelectorAll('button'))) {
    if (excludeNav && el.closest('.app-nav-side')) continue
    const t = (el.textContent ?? '').replace(/\s+/g, '')
    if (!keywords.some((kw) => t.includes(kw))) continue
    const r = el.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) continue
    // 部分可见也算（可点）；完全滚出视口才跳过
    if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue
    best = { el, text: (el.textContent ?? '').trim().slice(0, 18) } // DOM 靠后 = 页面内容越深 → 覆盖为最新
  }
  return best
}

function findVisibleTarget(keywords: string[]): { el: Element; text: string } | null {
  if (keywords.length === 0) return null
  // 优先页面内容里的真实按钮；页面不在该处时才高亮左侧导航入口
  return lastVisibleMatch(keywords, true) ?? lastVisibleMatch(keywords, false)
}

/** 元素是否真的在屏内（可点）——`select` 焦点判定用它 */
function isOnScreen(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return false
  return !(r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth)
}

/**
 * 步骤 7 第一阶段（船长 2026-09-11：「建议先指引玩家选择副船（高亮对应下拉框）」）：
 * 「AI 指挥中心」指派表单里的**舰船下拉框**还没选船时，光圈先指它；选好副船后返回 null，
 * 光圈自然回落到本步关键字（「指派」按钮）。下拉框不是按钮，故走 `selectFirst` 这个专属口。
 */
function aiAssignShipSelect(): Element | null {
  const sel = document.querySelector('select[data-ai-ship]')
  if (!sel || (sel as HTMLSelectElement).disabled) return null
  if ((sel as HTMLSelectElement).value !== '') return null
  return isOnScreen(sel) ? sel : null
}

/** 下拉框的「点这里」标签：取 title（ShipPage 写的就是「选择空闲舰船」），没有则取首项文字 */
function selectLabel(el: Element): string {
  const t = (el.getAttribute('title') ?? '').replace(/\s+/g, '')
  if (t) return t.slice(0, 18)
  const first = el.querySelector('option')
  return (first?.textContent ?? '下拉框').trim().slice(0, 18)
}

/**
 * 2026-09-06：手机横屏（.app-root 带 rotate+scale 变换）时，fixed 子元素进入"变换后局部空间"，
 * 与 getBoundingClientRect 的视口坐标不一致 → 高亮框错位。这里把视口框换算回根元素局部坐标。
 * 桌面（无 is-mobile-rot）不换算，行为与以前完全一致。
 * 局部(lx,ly) → 视口：X = L + s·ly；Y = T − s·lx（s=缩放，L/T=根元素 left/top，即 --mob-x/--mob-y）
 */
function rootRotTransform(): { s: number; L: number; T: number } | null {
  const root = document.querySelector<HTMLElement>('.app-root.is-mobile-rot')
  if (!root) return null
  const cs = getComputedStyle(root)
  const s = parseFloat(cs.getPropertyValue('--mob-scale'))
  const L = parseFloat(cs.getPropertyValue('--mob-x'))
  const T = parseFloat(cs.getPropertyValue('--mob-y'))
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(L) || !Number.isFinite(T)) return null
  return { s, L, T }
}

/** 目标按钮视口框 → 高亮框所在坐标空间的 {x(左), y(上), w, h}（手机换算到局部、桌面直接用视口）。
 * 换算用"四角 → 局部坐标 → min/max"取轴对齐盒：仿射逐轴单调，min/max 盒的影像必然恰好等于原视口框，
 * 不依赖旋转方向推断，避免正负号错误。局部(lx,ly)↔视口(X,Y)：X = L + s·ly；Y = T − s·lx。 */
function ringRectFor(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect()
  const rot = rootRotTransform()
  if (!rot) return { x: r.left, y: r.top, w: r.width, h: r.height }
  const { s, L, T } = rot
  const pts = [
    { X: r.left, Y: r.top },
    { X: r.right, Y: r.top },
    { X: r.left, Y: r.bottom },
    { X: r.right, Y: r.bottom },
  ].map((p) => ({ lx: (T - p.Y) / s, ly: (p.X - L) / s }))
  const minX = Math.min(...pts.map((p) => p.lx))
  const maxX = Math.max(...pts.map((p) => p.lx))
  const minY = Math.min(...pts.map((p) => p.ly))
  const maxY = Math.max(...pts.map((p) => p.ly))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 元素是否被某个滚动/裁剪祖先裁掉（页面内滚动容器里滚出视口的按钮 rect 仍在屏内 → 直接画框会"指空"） */
function isClippedByScroll(el: Element): boolean {
  let n = el.parentElement
  while (n && n !== document.body) {
    const cs = getComputedStyle(n)
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
      const er = el.getBoundingClientRect()
      const cr = n.getBoundingClientRect()
      if (er.bottom <= cr.top + 2 || er.top >= cr.bottom - 2 || er.right <= cr.left + 2 || er.left >= cr.right - 2) {
        return true
      }
    }
    n = n.parentElement
  }
  return false
}

export function TutorialSpot({
  engine,
  step,
  onGo,
  onDetail,
  onSkip,
}: {
  engine: GameEngine
  step: number
  onGo: (g: GuideGo) => void
  /** 「看详情」：切到通讯页并选中本步教程通讯（2026-09-11 船长定：教程全文在通讯里） */
  onDetail?: (messageId: string) => void
  /** 「跳过教程」：入口从右下角卡移到顶部引导条（2026-09-11 船长定） */
  onSkip?: () => void
}) {
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null)
  const plan = stepPlan(engine, step)
  // 「点这里」气泡：独立 fixed 元素，按实际尺寸钳制在视口内（2026-09-08 修复：原先估算定位
  // 导致气泡出屏/消失——现在渲染后量得宽高，优先放目标下方，放不下放上方，并水平居中钳制）
  const tipRef = useRef<HTMLDivElement | null>(null)
  const [tipAt, setTipAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!ring) {
      setTipAt(null)
      return
    }
    const el = tipRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    if (rootRotTransform() !== null) {
      setTipAt({ left: ring.x - 4, top: ring.y + ring.h + 8 }) // 旋转模式沿用原位置
      return
    }
    const pad = 8
    let top = ring.y + ring.h + 10
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, ring.y - rect.height - 10)
    const left = Math.min(Math.max(pad, ring.x + ring.w / 2 - rect.width / 2), window.innerWidth - rect.width - pad)
    setTipAt({ left, top })
  }, [ring])

  // 定位光圈：立即定位 + 轮询跟随（页面转场/滚动/布局变动后框始终贴在目标上，2026-09-06 修复"框位置错误"）
  useLayoutEffect(() => {
    const relocate = (): void => {
      // 元素级焦点优先（步骤 7：先指副船下拉框）——它自己会在"已选好"后交还控制权
      const special = plan.selectFirst?.() ?? null
      const hit = special ? { el: special, text: selectLabel(special) } : findVisibleTarget(plan.targets)
      if (!hit) {
        setRing(null)
        return
      }
      const rot = rootRotTransform() !== null
      if (rot && isClippedByScroll(hit.el)) {
        // 目标在内部滚动容器里被裁掉：先滚入视口，下一拍再画框（避免框指在看不见的位置）
        hit.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        setRing(null)
        return
      }
      const box = ringRectFor(hit.el)
      setRing((prev) =>
        prev && prev.x === box.x && prev.y === box.y && prev.w === box.w && prev.h === box.h && prev.label === hit.text
          ? prev
          : { x: box.x, y: box.y, w: box.w, h: box.h, label: hit.text },
      )
    }
    relocate()
    const iv = window.setInterval(relocate, 150)
    window.addEventListener('resize', relocate)
    window.addEventListener('scroll', relocate, true)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('resize', relocate)
      window.removeEventListener('scroll', relocate, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, plan.text])

  const inTutorial = TUTORIAL_STEPS.some((s) => s.step === step)
  const inBriefing = step === ONB_BRIEFING
  return (
    <>
      {plan.text && plan.goLabel ? (
        <div className="app-stepbar">
          {/* 步骤进度（2026-09-11 船长定：按教程内容顺序指引，让玩家知道走到第几步、还剩几步）；
              简报态不显示 N/7——那一步还没开始 */}
          {inTutorial ? (
            <span className="app-stepbar-step">
              步骤 {step}/{TUTORIAL_TOTAL}
            </span>
          ) : null}
          {/* ▸ 独立于文案（2026-09-08 船长定：不计入文案、换行后文本独立对齐排头） */}
          <span className="app-stepbar-mark" aria-hidden="true">
            ▸
          </span>
          <span className="app-stepbar-text">{plan.text}</span>
          <button className="app-btn is-small is-primary app-stepbar-go" onClick={() => onGo(plan.go)}>
            {plan.goLabel} ›
          </button>
          {/* 教程全文在通讯里（2026-09-11 船长定）：这里给一个直达入口，不再放右下角详细卡；
              简报态本身就指向通讯，不再重复放「看详情」 */}
          {onDetail && inTutorial ? (
            <button
              className="app-btn is-small app-stepbar-detail"
              title="打开通讯页，读这一步的完整说明（历史上每一步都留档）"
              onClick={() => onDetail(tutorialMessageId(step))}
            >
              看详情
            </button>
          ) : null}
          {/* 跳过教程：入口从右下角卡移到这里（2026-09-11 船长定） */}
          {onSkip ? (
            <button
              className="app-btn is-small app-stepbar-skip"
              title="跳过教程：立即全额结算奖励并修好鲣鱼"
              onClick={onSkip}
            >
              跳过教程 ›
            </button>
          ) : null}
        </div>
      ) : null}
      {ring ? (
        <div className="app-spot-ring" style={{ left: ring.x - 4, top: ring.y - 4, width: ring.w + 8, height: ring.h + 8 }} />
      ) : null}
      {ring ? (
        <div
          ref={tipRef}
          className="app-spot-bubble"
          style={
            tipAt
              ? { left: tipAt.left, top: tipAt.top, visibility: 'visible' }
              : { left: -9999, top: -9999, visibility: 'hidden' }
          }
        >
          点这里：{ring.label}
        </div>
      ) : null}
    </>
  )
}
