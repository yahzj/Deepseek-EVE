/**
 * 序章·苏醒 阶段 4（2026-09-05 船长确认）——教程引导：
 * - 步骤 1..6：右下角「当前目标」任务卡（可最小化/展开；含跳转按钮、跳过入口、×6 教学加速提示）；
 * - 步骤 7：收尾演出覆盖层（全屏文本 → 「开始新的航程」→ finishTutorial → step 99 全解锁）。
 * 锁定策略（页签/按钮级）在 App.tsx 实施；本组件只管展示与跳转意图。
 */
import { useState } from 'react'
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
      '② 星图 →「矿带开采」标签，对丰饶之环(母港)出击采集富凡晶石；',
      '③ 采足交付量（约 1 周期）即自动返港卸货——教学节奏，不用等到满舱。',
      '提示：教学期间航行/采矿加速 ×6。',
    ],
    go: { page: 'ship', shipTab: 'fleet' },
    goLabel: '前往舰船页·切换驾驶',
  },
  2: {
    title: '交付：补给协议·首批矿物',
    lines: [
      '矿石已入库。前往星图「任务中心」→ 重要任务，交付富凡晶石 ×20（仓库扣取）。',
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
      '舰船页 →「AI 指挥」：为沙猫装载基础 AI 核心并指派采矿作业——那是你的第一个分身。',
    ],
    go: { page: 'ship', shipTab: 'ai' },
    goLabel: '前往 AI 指挥',
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
