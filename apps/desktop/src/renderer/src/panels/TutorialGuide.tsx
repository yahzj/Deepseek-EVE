/**
 * 序章·苏醒 阶段 4（2026-09-05 船长确认）——教程引导：
 * - 步骤 1..6：右下角「当前目标」任务卡（可最小化/展开；含跳转按钮、跳过入口、×6 教学加速提示）；
 * - 步骤 7：收尾演出覆盖层（全屏文本 → 「开始新的航程」→ finishTutorial → step 99 全解锁）。
 * 锁定策略（页签/按钮级）在 App.tsx 实施；本组件只管展示与跳转意图。
 */
import { useLayoutEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'

export type GuideGo = { page: string; mapTab?: string; shipTab?: string }

interface GuideDef {
  title: string
  lines: string[]
  go: GuideGo
  goLabel: string
}

/** 步骤 → 引导文案与默认跳转（与 App 锁定白名单同源） */
export const GUIDE_BY_STEP: Record<number, GuideDef> = {
  1: {
    title: '采集：维持运转',
    lines: [
      '① 前往舰船页，把驾驶船切换为机库里的「沙猫级采矿艇」；',
      '② 出港 →「矿带开采」标签，对丰饶之环(母港)出击采集富凡晶石；',
      '③ 采足交付量（约 1 周期）即自动返港卸货——教学节奏，不用等到满舱。',
      '提示：教学期间航行/采矿加速 ×6。',
    ],
    go: { page: 'ship', shipTab: 'fleet' },
    goLabel: '前往舰船页·切换驾驶',
  },
  2: {
    title: '交付：补给协议·首批矿物',
    lines: [
      '矿石已入库。前往出港「任务中心」→ 重要任务，交付富凡晶石 ×20（仓库扣取）。',
      '完成后获得 4,000 ISK 与一枚基础 AI 核心。',
    ],
    go: { page: 'map', mapTab: 'task' },
    goLabel: '前往任务中心',
  },
  3: {
    title: '修复：隼枭级武装艇',
    lines: [
      '用任务赏金在舰船页对隼枭执行「港内维修」（装甲/结构恢复至 100%）。',
      '完成后进入试炼步骤。',
    ],
    go: { page: 'ship', shipTab: 'fleet' },
    goLabel: '前往舰船页·维修',
  },
  4: {
    title: '试炼：演习场讨伐令',
    lines: [
      '前往「战斗悬赏」接取演习场讨伐令（母港，教学战内你的命中/回避获得加成）。',
      '取胜后协会发放：轻型炮台 MK1 ×1、动能弹 ×120。',
    ],
    go: { page: 'map', mapTab: 'bounty' },
    goLabel: '前往战斗悬赏',
  },
  5: {
    title: '记忆归档：人工智能专家',
    lines: [
      '打开技能页——记忆档案将恢复「人工智能专家」至 Lv1（免书免训练费，仅此一次）。',
    ],
    go: { page: 'skills' },
    goLabel: '前往技能页',
  },
  6: {
    title: '分身：指派沙猫采矿',
    lines: [
      '舰船页 →「AI 指挥中心」：为沙猫装载基础 AI 核心并指派采矿作业——那是你的第一个分身。',
    ],
    go: { page: 'ship', shipTab: 'ai' },
    goLabel: '前往 AI 指挥中心',
  },
}

/** 收尾演出文本（步骤 7） */
const EPILOGUE_LINES = [
  '你睁开眼睛的时候，泊位里只有排风扇的低鸣。',
  '章鱼人统治着这座母港——他们买货、修站、发布悬赏，对角落里这艘旧船一无所知。',
  '乘员们消失了。档案只剩碎片：人类失踪于你沉睡的某个年代，原因不明。',
  '但你记得怎么采矿、怎么修理、怎么开火，甚至还记得「人工智能专家」这门手艺。',
  '一艘不该存在的旧时代舰船 AI——是时候去打听人类的下落了。',
]

export function TutorialGuide({
  engine,
  step,
  onGo,
  onClose,
}: {
  engine: GameEngine
  step: number
  onGo: (g: GuideGo) => void
  onClose?: () => void
}) {
  const [minimized, setMinimized] = useState(false)
  const def = GUIDE_BY_STEP[step]

  if (!def) return null
  if (minimized) {
    return (
      <button className="app-tut-tab" onClick={() => setMinimized(false)} title="展开教程引导">
        ◆ 教程：{def.title}（展开）
      </button>
    )
  }
  return (
    <div className="app-tut-card">
      <div className="app-tut-head">
        <span className="app-tut-title">◆ 教程目标 · {def.title}</span>
        <span className="app-tut-min" onClick={() => setMinimized(true)} title="最小化">
          —
        </span>
      </div>
      <div className="app-tut-lines">
        {def.lines.map((l, i) => (
          <div key={i} className="app-tut-line">
            {l}
          </div>
        ))}
      </div>
      <div className="app-tut-actions">
        <button
          className="app-btn is-small is-primary"
          onClick={() => {
            setMinimized(true)
            onGo(def.go)
          }}
        >
          {def.goLabel}
        </button>
        <button
          className="app-btn is-small"
          onClick={() => {
            const r = engine.prologueSkip()
            if (!r.ok) onClose?.()
          }}
          title="跳过教程：立即全额结算奖励并修好隼枭"
        >
          跳过教程 ›
        </button>
      </div>
    </div>
  )
}

/** 收尾演出覆盖层（步骤 7；点击文本区逐步显示 → 按钮完成） */
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
 * - 顶栏下方居中的「下一步」操作条：当前目标一句话 + 大字脉冲按钮（跳转入口,永不丢失）;
 * - 画面级光圈:按步骤关键字在可见按钮里找当前应点的目标,画高亮框 + "点这里"气泡;
 * - 步骤内分阶段(如 S1:先切沙猫 → 再出击),按引擎状态自动换焦点。
 */
interface StepPlan {
  text: string
  go: GuideGo
  goLabel: string
  targets: string[]
}

function stepPlan(engine: GameEngine, step: number): StepPlan {
  const def = GUIDE_BY_STEP[step]
  const state = engine.state
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
      text: '第二步：出港采集富凡晶石（采足 20 即自动返航）',
      go: { page: 'map', mapTab: 'mine' },
      goLabel: '前往出港·矿带开采',
      targets: ['出港', '矿带开采', '采掘', '出击', '开采'],
    }
  }
  if (!def) return { text: '', go: { page: 'map' }, goLabel: '', targets: [] }
  const byStep: Record<number, string[]> = {
    2: ['出港', '任务中心', '交付矿石'],
    3: ['舰船', '港内维修', '维修', '修理'],
    4: ['出港', '战斗悬赏', '演习场讨伐令', '出发'],
    5: ['技能', '人工智能专家'],
    6: ['舰船', 'AI 指挥中心', '指派', '采矿'],
  }
  return { text: def.lines[0] ?? def.title, go: def.go, goLabel: def.goLabel, targets: byStep[step] ?? [] }
}

/**
 * 在可见按钮里找当前应点的目标（2026-09-06 船长反馈：光圈方框位置错误——
 * 根因 1：按关键字"首个命中"，常落在左侧常驻导航(出港/舰船)而非页面内的真实按钮；
 * 根因 2：只在步骤切换后定位一次，页面转场/滚动后框不跟随）。
 * 修法：优先排除左侧导航，在页面内容里取**最深的可见命中**（真正的操作按钮）；
 * 找不到才回退到导航按钮；随后由 TutorialSpot 的轮询持续跟随位置。
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

/** 目标按钮视口框 → 高亮框所在坐标空间的 {x(左), y(上), w, h}（手机换算到局部、桌面直接用视口） */
function ringRectFor(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect()
  const rot = rootRotTransform()
  if (!rot) return { x: r.left, y: r.top, w: r.width, h: r.height }
  const { s, L, T } = rot
  return {
    x: (T - r.top) / s, // 视口上边 ↔ 局部 x
    y: (r.left - L) / s, // 视口左边 ↔ 局部 y
    w: r.height / s,
    h: r.width / s,
  }
}

export function TutorialSpot({ engine, step, onGo }: { engine: GameEngine; step: number; onGo: (g: GuideGo) => void }) {
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null)
  const plan = stepPlan(engine, step)

  // 定位光圈：立即定位 + 轮询跟随（页面转场/滚动/布局变动后框始终贴在目标上，2026-09-06 修复"框位置错误"）
  useLayoutEffect(() => {
    const relocate = (): void => {
      const hit = findVisibleTarget(plan.targets)
      if (!hit) {
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

  return (
    <>
      {plan.text && plan.goLabel ? (
        <div className="app-stepbar">
          <span className="app-stepbar-text">▸ {plan.text}</span>
          <button className="app-btn is-small is-primary app-stepbar-go" onClick={() => onGo(plan.go)}>
            {plan.goLabel} ›
          </button>
        </div>
      ) : null}
      {ring ? (
        <div className="app-spot-ring" style={{ left: ring.x - 4, top: ring.y - 4, width: ring.w + 8, height: ring.h + 8 }}>
          <span className="app-spot-tip">点这里：{ring.label}</span>
        </div>
      ) : null}
    </>
  )
}
