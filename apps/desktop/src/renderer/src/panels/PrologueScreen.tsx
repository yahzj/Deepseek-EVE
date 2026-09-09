/**
 * 序章·苏醒（2026-09-05 船长拍板）——新档开场演出：黑屏 → 醒来 → 系统自检 →
 * 自检结论（乘员失踪/船体受损/记忆损坏）→ 回忆系统名称（默认 PRTS）→ 进入采集步骤。
 * 演出阶段引擎时间冻结（step 0）；右上角常驻「跳过」= 全额结算（core skipTutorial）。
 * 阶段转场（2026-09-08 船长定）：换段先淡出旧画面，再切内容由 key 重挂载触发淡入。
 */
import { useEffect, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'

type Phase = 'wake' | 'boot' | 'diag' | 'name' | 'open'

type LineKind = 'ok' | 'warn' | 'fail'

/** 自检滚动条目（system：模块名） */
const CHECK_LINES: ReadonlyArray<readonly [string, LineKind, string]> = [
  ['供电核心', 'ok', '在线 · 输出稳定'],
  ['航行系统', 'warn', '推力 60% · 导航阵列漂移（±3σ）'],
  ['武器系统', 'fail', '离线 —— 未检测到已安装武器'],
  ['采矿子系统', 'ok', '就绪 · 矿枪能源链路正常'],
  ['生命维持', 'ok', '运行中 —— 无需乘员循环'],
  ['乘员舱扫描', 'fail', '无生命信号'],
  ['身份档案', 'fail', '损坏 · 无法读取'],
  ['系统日志', 'warn', '最后条目时间戳：■■■.■■.■■ —— 乱码'],
]

const DIAG_LINES: ReadonlyArray<readonly [string, string]> = [
  ['结构完整性', '装甲/结构受损（80%）'],
  ['乘员', '失踪 —— 生命信号 0'],
  ['记忆档案', '大部分损坏，仅存碎片'],
  ['自检建议', '采集矿石维持运转与临时修复储备'],
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
    if (!r.ok) setErr(r.error ?? '无法跳过')
  }

  const confirm = (): void => {
    if (phase === 'open') return
    // “睁眼”转场后再唤醒（引擎写入呼号并进入采集步骤）；光晕消散加长后总时长 1.9s（船长 2026-09-05）
    setPhase('open')
    window.setTimeout(() => {
      const r = engine.prologueAwaken(name)
      if (!r.ok) setErr(r.error ?? '写入失败')
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
                <div className="app-pro-dim">未知年代 · 隐秘泊位</div>
                <button className="app-pro-wake-btn" onClick={() => goto('boot')}>
                  ⏻ 醒来
                </button>
                <div className="app-pro-dim">—— 点击唤醒 ——</div>
              </div>
            ) : null}

            {phase === 'boot' ? (
              <div className="app-pro-term">
                <div className="app-pro-term-title">舰载系统自检 · 启动序列</div>
                {CHECK_LINES.slice(0, shown).map(([mod, kind, text], i) => (
                  <div key={i} className={`app-pro-line is-${kind}`}>
                    <span className="app-pro-mod">{mod}</span>
                    <span className="app-pro-dots">…</span>
                    <span className="app-pro-text">{text}</span>
                    <span className="app-pro-mark">{kind === 'ok' ? 'OK' : kind === 'warn' ? '!' : '✕'}</span>
                  </div>
                ))}
                {shown < CHECK_LINES.length ? (
                  <>
                    <div className="app-pro-cursor">▌</div>
                    <div className="app-pro-hint">（点击画面可跳过自检动画）</div>
                  </>
                ) : (
                  <div className="app-pro-hint">自检序列完成 —— 点击画面查看自检结论 ›</div>
                )}
              </div>
            ) : null}

            {phase === 'diag' ? (
              <div className="app-pro-diag">
                <div className="app-pro-diag-title">⚠ 自检结论</div>
                {DIAG_LINES.map(([k, v], i) => (
                  <div key={i} className="app-pro-diag-row">
                    <span className="app-pro-diag-k">{k}</span>
                    <span className="app-pro-diag-v">{v}</span>
                  </div>
                ))}
                <div className="app-pro-frag">档案残片：「编号 07……如果它醒了，告诉它——」……（记录截断）</div>
                <button className="app-btn is-primary" onClick={() => goto('name')}>
                  下一步：身份确认
                </button>
              </div>
            ) : null}

            {phase === 'name' ? (
              <div className="app-pro-name" onClick={(e) => e.stopPropagation()}>
                <div className="app-pro-diag-title">身份标识检索失败</div>
                <div className="app-pro-sub">从记忆碎片中找回自己的系统名称（顶栏呼号）：</div>
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
                <div className="app-pro-name-default">默认：PRTS —— 可自由修改</div>
                {err ? <div className="app-pro-err">{err}</div> : null}
                <button className="app-btn is-primary" onClick={confirm}>
                  写入并启动
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
        <button className="app-pro-skip" onClick={skip} title="跳过教程：立即全额结算奖励并修好鲣鱼">
          跳过教程 ›
        </button>
      ) : null}
    </div>
  )
}
