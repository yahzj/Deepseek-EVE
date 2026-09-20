/**
 * 序章·苏醒（2026-09-05 船长拍板）——新档开场演出：黑屏 → 醒来 → 系统自检 →
 * 自检结论（乘员失踪/船体受损/记忆损坏）→ 回忆系统名称（默认 PRTS）→ 进入采集步骤。
 * 演出阶段引擎时间冻结（step 0）；右上角常驻「跳过」= 直接结束序章（core skipPrologue，无奖励结算）。
 * 阶段转场（2026-09-08 船长定）：换段先淡出旧画面，再切内容由 key 重挂载触发淡入。
 */
import { useEffect, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'

type Phase = 'wake' | 'boot' | 'diag' | 'name' | 'open'

type LineKind = 'ok' | 'warn' | 'fail'

/** 自检滚动条目（system：模块名） */
const CHECK_LINES: ReadonlyArray<readonly [string, LineKind, string]> = [
  [tr("ui.PrologueScreen.001"), 'ok', tr("ui.PrologueScreen.002")],
  [tr("ui.PrologueScreen.003"), 'warn', tr("ui.PrologueScreen.004")],
  [tr("ui.PrologueScreen.005"), 'fail', tr("ui.PrologueScreen.006")],
  [tr("ui.PrologueScreen.007"), 'ok', tr("ui.PrologueScreen.008")],
  [tr("ui.PrologueScreen.009"), 'ok', tr("ui.PrologueScreen.010")],
  [tr("ui.PrologueScreen.011"), 'fail', tr("ui.PrologueScreen.012")],
  [tr("ui.PrologueScreen.013"), 'fail', tr("ui.PrologueScreen.014")],
  [tr("ui.PrologueScreen.015"), 'warn', tr("ui.PrologueScreen.016")],
]

const DIAG_LINES: ReadonlyArray<readonly [string, string]> = [
  [tr("ui.PrologueScreen.017"), tr("ui.PrologueScreen.018")],
  [tr("ui.PrologueScreen.019"), tr("ui.PrologueScreen.020")],
  [tr("ui.PrologueScreen.021"), tr("ui.PrologueScreen.022")],
  [tr("ui.PrologueScreen.023"), tr("ui.PrologueScreen.024")],
]

const LINE_MS = 130
/** 阶段转场：旧画面淡出时长（2026-09-08 船长定：开场动画之间加淡入淡出） */
const FADE_MS = 220

export function PrologueScreen({ engine }: { engine: GameEngine }) {
  const [phase, setPhase] = useState<Phase>('wake')
  const [shown, setShown] = useState(0) // boot 已显示条数
  const [name, setName] = useState('PRTS')
  const [err, setErr] = useState('')
  const timerRef = useRef<number | null>(null)
  // 淡出中标志 + 待切入阶段（2026-09-08：换段先 .is-fading 淡出 FADE_MS，再切内容触发淡入）
  const [fading, setFading] = useState(false)
  const nextPhaseRef = useRef<Phase | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  /** 阶段切换统一入口：淡出 →（FADE_MS 后）换阶段 → key 重挂载触发淡入 */
  const goto = (p: Phase): void => {
    if (fading) return
    nextPhaseRef.current = p
    setFading(true)
  }

  useEffect(() => {
    if (!fading) return
    const t = window.setTimeout(() => {
      const p = nextPhaseRef.current
      nextPhaseRef.current = null
      if (p === 'boot') setShown(0) // boot 重播时自检行数归零
      if (p) setPhase(p)
      setFading(false)
    }, FADE_MS)
    timerRef.current = t
    return () => window.clearTimeout(t)
  }, [fading])

  // boot 逐条滚动；全部条目滚完后等待玩家点击确认，再进入自检结论（2026-09-08 船长定：
  // 不再 1.5s 自动跳转——自检列表需玩家确认后才会弹出后续的警告结论界面）
  useEffect(() => {
    if (phase !== 'boot') return
    if (shown >= CHECK_LINES.length) return
    const t = window.setTimeout(() => setShown((v) => v + 1), LINE_MS)
    timerRef.current = t
    return () => window.clearTimeout(t)
  }, [phase, shown])

  const skip = (): void => {
    const r = engine.prologueSkip()
    if (!r.ok) setErr(cmdText(r) || '无法跳过')
  }

  const confirm = (): void => {
    if (phase === 'open') return
    // “睁眼”转场后再唤醒（引擎写入呼号并结束序章）；光晕消散加长后总时长 1.9s（船长 2026-09-05）
    setPhase('open')
    window.setTimeout(() => {
      const r = engine.prologueAwaken(name)
      if (!r.ok) setErr(cmdText(r) || '写入失败')
    }, 1900)
  }

  return (
    <div
      className={`app-prologue${phase === 'open' ? ' is-eye' : ''}`}
      onClick={() => {
        if (phase !== 'boot') return
        if (shown < CHECK_LINES.length) setShown(CHECK_LINES.length) // 播放中点击 = 跳过动画
        else goto('diag') // 已播完：玩家确认 → 弹出自检结论（2026-09-08 船长定）
      }}
    >
      <div className="app-prologue-inner">
        {phase !== 'open' ? (
          /* key=阶段：重挂载触发淡入；fading 时旧画面保持并加 .is-fading 淡出（2026-09-08 船长定转场） */
          <div key={phase} className={`app-pro-stage${fading ? ' is-fading' : ''}`}>
            {phase === 'wake' ? (
              <div className="app-pro-wake">
                <div className="app-pro-dim">{tr("ui.PrologueScreen.025")}</div>
                <button className="app-pro-wake-btn" onClick={() => goto('boot')}>
                  {tr("ui.PrologueScreen.026")}
                </button>
                <div className="app-pro-dim">{tr("ui.PrologueScreen.027")}</div>
              </div>
            ) : null}

            {phase === 'boot' ? (
              <div className="app-pro-term">
                <div className="app-pro-term-title">{tr("ui.PrologueScreen.028")}</div>
                {CHECK_LINES.slice(0, shown).map(([mod, kind, text], i) => (
                  <div key={i} className={`app-pro-line is-${kind}`}>
                    <span className="app-pro-mod">{mod}</span>
                    <span className="app-pro-dots">…</span>
                    <span className="app-pro-text">{text}</span>
                    <span className="app-pro-mark">{kind === 'ok' ? tr("ui.PrologueScreen.029") : kind === 'warn' ? '!' : '✕'}</span>
                  </div>
                ))}
                {shown < CHECK_LINES.length ? (
                  <>
                    <div className="app-pro-cursor">▌</div>
                    <div className="app-pro-hint">{tr("ui.PrologueScreen.030")}</div>
                  </>
                ) : (
                  <div className="app-pro-hint">{tr("ui.PrologueScreen.031")}</div>
                )}
              </div>
            ) : null}

            {phase === 'diag' ? (
              <div className="app-pro-diag">
                <div className="app-pro-diag-title">{tr("ui.PrologueScreen.032")}</div>
                {DIAG_LINES.map(([k, v], i) => (
                  <div key={i} className="app-pro-diag-row">
                    <span className="app-pro-diag-k">{k}</span>
                    <span className="app-pro-diag-v">{v}</span>
                  </div>
                ))}
                <div className="app-pro-frag">{tr("ui.PrologueScreen.033")}</div>
                <button className="app-btn is-primary" onClick={() => goto('name')}>
                  {tr("ui.PrologueScreen.034")}
                </button>
              </div>
            ) : null}

            {phase === 'name' ? (
              <div className="app-pro-name" onClick={(e) => e.stopPropagation()}>
                <div className="app-pro-diag-title">{tr("ui.PrologueScreen.035")}</div>
                <div className="app-pro-sub">{tr("ui.PrologueScreen.036")}</div>
                <input
                  className="app-input app-pro-input"
                  value={name}
                  maxLength={12}
                  onChange={(e) => {
                    setName(e.target.value)
                    setErr('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirm()
                  }}
                  autoFocus
                />
                <div className="app-pro-name-default">{tr("ui.PrologueScreen.037")}</div>
                {err ? <div className="app-pro-err">{err}</div> : null}
                <button className="app-btn is-primary" onClick={confirm}>
                  {tr("ui.PrologueScreen.038")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {phase === 'open' ? (
        /* “睁眼”转场：横向白线延伸至屏幕两端 → 光晕出现时黑底开始转透明，
           1.4s(引擎写入呼号)恰好 100% 透明（船长 2026-09-05 优化） */
        <div className="app-pro-open" onClick={(e) => e.stopPropagation()}>
          <div className="app-pro-bg" />
          <div className="app-pro-iris" />
          <div className="app-pro-slit" />
        </div>
      ) : null}
      {err && phase === 'wake' ? <div className="app-pro-err">{err}</div> : null}
      {phase !== 'open' ? (
        <button className="app-pro-skip" onClick={skip} title={tr("ui.PrologueScreen.039")}>
          {tr("ui.PrologueScreen.040")}
        </button>
      ) : null}
    </div>
  )
}
