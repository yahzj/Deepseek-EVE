/**
 * 性能自动采集驱动（2026-09-08 诊断工具，船长批准的全场景本机跑分方案）。
 *
 * 触发：仅当 preload 注入了 window.__autoperf（Electron 环境变量 WHALE_AUTOPERF=JSON 场景表）
 * 才会运行；普通玩家路径完全不会加载额外逻辑。配合 WHALE_PERF_USERDATA 隔离存档目录，
 * 不碰真实存档。结束后把 perfHub.report() JSON 打到控制台（主进程以 ELECTRON_ENABLE_LOGGING=1
 * 捕获 stdout），随后自动关闭窗口退出。
 *
 * 场景字段：{ name, seconds, page?（左导航文字，如 工业/市场）, battle?（尝试真实远征战斗） }
 */
import type { GameEngine } from './engine'
import { perfHub } from './perf'

export interface AutoPerfSpec {
  scenes: Array<{ name: string; seconds: number; page?: string; battle?: boolean }>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 按文字找左侧导航按钮（首次匹配；找不到返回 null） */
function navButton(label: string): HTMLButtonElement | null {
  const nodes = document.querySelectorAll<HTMLButtonElement>('.app-nav-side button')
  for (const b of nodes) {
    if ((b.textContent ?? '').trim().includes(label)) return b
  }
  return null
}

/**
 * 尝试开一场真实远征战斗：
 * - 对目录里每个异常依次尝试（自动补齐：星系已探索 / 声望拉满兜底）；
 * - 远星系会先进"去程"相位 → 直接把到港时刻压到下一拍，尽快进入 100ms 战斗泵；
 * 返回是否已开战。
 */
async function tryStartBattle(engine: GameEngine): Promise<boolean> {
  const st = engine.state
  if (st.expedition.active) return st.expedition.phase === 'battle'
  for (const a of engine.allAnomalies) {
    if (a.galaxyId && !st.exploredGalaxies.includes(a.galaxyId)) st.exploredGalaxies.push(a.galaxyId)
    for (const k of Object.keys(st.standings)) st.standings[k] = Math.max(st.standings[k] ?? 0, 10)
    const r = engine.startExpeditionAt(a.id)
    if (!r.ok) continue
    const exp = st.expedition
    if (exp.active && exp.phase === 'out') {
      // 去程有航行时间：直接压到下一拍边界（引擎按 100ms 泵切片开战）
      exp.finishAtGameMs = st.gameMs + 1
    }
    return true
  }
  console.log('AUTOPERF_WARN 未能发起任何远征（目录可能为空或全部被前置拒绝）')
  return false
}

/** 跑完一个场景段（固定墙钟时长；战斗段尝试维持战斗直到超时） */
async function runScene(engine: GameEngine, sc: { name: string; seconds: number; page?: string; battle?: boolean }): Promise<void> {
  if (sc.page) {
    const b = navButton(sc.page)
    if (b) b.click()
    await sleep(1500) // 页面切换 + 首次渲染稳定
  }
  perfHub.beginScene(sc.name)
  const deadline = Date.now() + sc.seconds * 1000
  if (sc.battle) {
    let lastTry = 0
    while (Date.now() < deadline) {
      const exp = engine.state.expedition
      const inBattle = exp.active && exp.phase === 'battle' && !!exp.battle
      if (!inBattle && Date.now() - lastTry > 2_000) {
        lastTry = Date.now()
        // 打完一场后等结算/返航落定，再补开下一场，直到场景时长跑满
        if (!exp.active && engine.state.awayGalaxy === null) {
          const ok = await tryStartBattle(engine)
          if (ok) console.log('AUTOPERF_INFO 战斗已开启，计时中…')
        }
      }
      await sleep(500)
    }
  } else {
    await sleep(sc.seconds * 1000)
  }
  perfHub.endScene()
  await sleep(500)
}

/** 主入口：main.tsx 在 App 挂载后调用（仅自动采集模式） */
export async function runAutoPerf(engine: GameEngine, spec: AutoPerfSpec): Promise<void> {
  if (!spec || !Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    console.log('AUTOPERF_REPORT_INVALID 场景表为空')
    return
  }
  perfHub.activate()
  // 等主界面挂载（最多 20s）
  for (let i = 0; i < 200 && !document.querySelector('.app-root'); i++) await sleep(100)
  await sleep(2_500) // 首屏/演出稳定
  for (const sc of spec.scenes) {
    console.log(`AUTOPERF_INFO 场景开始 ${sc.name}（${sc.seconds}s${sc.battle ? ' · 战斗' : ''}）`)
    await runScene(engine, sc)
  }
  const rep = perfHub.report()
  console.log('AUTOPERF_REPORT_BEGIN')
  console.log(JSON.stringify(rep))
  console.log('AUTOPERF_REPORT_END')
  await sleep(400)
  window.close()
}
