/**
 * 序章·苏醒（2026-09-05 船长拍板）——新档开场演出：黑屏 → 醒来 → 系统自检 →
 * 自检结论（乘员失踪/船体受损/记忆损坏）→ 回忆系统名称（默认 PRTS）→ 进入采集步骤。
 * 演出阶段引擎时间冻结（step 0）；右上角常驻「跳过」= 全额结算（core skipTutorial）。
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

export function PrologueScreen({ engine }: { engine: GameEngine }) {
  const [phase, setPhase] = useState<Phase>('wake')
  const [shown, setShown] = useState(0) // boot 已显示条数
  const [name, setName] = useState('PRTS')
  const [err, setErr] = useState('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const startBoot = (): void => {
    setPhase('boot')
    setShown(0)
  }

  // boot 逐条滚动
  useEffect(() => {
    if (phase !== 'boot') return
    if (shown >= CHECK_LINES.length) {
      // 自检条目全部滚完后停留 ~1.5s（船长 2026-09-05：让玩家看清结果）再出结论卡
      const t = window.setTimeout(() => setPhase('diag'), 1500)
      timerRef.current = t
      return () => window.clearTimeout(t)
    }
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
    // “睁眼”转场后再唤醒（引擎写入呼号并进入采集步骤）
    setPhase('open')
    window.setTimeout(() => {
      const r = engine.prologueAwaken(name)
      if (!r.ok) setErr(r.error ?? '写入失败')
    }, 1400)
  }

  return (
    <div className="app-prologue" onClick={() => (phase === 'boot' ? setShown(CHECK_LINES.length) : undefined)}>
      <div className="app-prologue-inner">
        {phase === 'wake' ? (
          <div className="app-pro-wake">
            <div className="app-pro-dim">未知年代 · 隐秘泊位</div>
            <button className="app-pro-wake-btn" onClick={startBoot}>
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
            {shown < CHECK_LINES.length ? <div className="app-pro-cursor">▌</div> : null}
            <div className="app-pro-hint">（点击画面可跳过自检动画）</div>
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
            <button className="app-btn is-primary" onClick={() => setPhase('name')}>
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
      {phase === 'open' ? (
        /* “睁眼”转场：黑暗中的一线光睁成视界（船长 2026-09-05 定） */
        <div className="app-pro-open" onClick={(e) => e.stopPropagation()}>
          <div className="app-pro-eye" />
          <div className="app-pro-lid is-top" />
          <div className="app-pro-lid is-bottom" />
          <div className="app-pro-flash" />
        </div>
      ) : null}
      {err && phase === 'wake' ? <div className="app-pro-err">{err}</div> : null}
      {phase !== 'open' ? (
        <button className="app-pro-skip" onClick={skip} title="跳过教程：立即全额结算奖励并修好隼枭">
          跳过教程 ›
        </button>
      ) : null}
    </div>
  )
}
