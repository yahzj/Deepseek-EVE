import type { GameEngine } from './engine'
import { perfHub } from './perf'

export interface AutoPerfSpec {
  scenes: Array<{ name: string; seconds: number; page?: string; battle?: boolean }>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function auditScrollGeometry(): void {
  const page = document.querySelector<HTMLElement>('.app-page-content')
  if (!page) return
  const info = (el: HTMLElement, tag: string): string =>
    `${tag} clientH=${Math.round(el.clientHeight)} scrollH=${Math.round(el.scrollHeight)} overflow=${getComputedStyle(el).overflowY}`
  console.log(`AUDIT page: ${info(page, 'page-content')}`)
  const stack = page.querySelector<HTMLElement>(':scope > .page-stack')
  if (stack) console.log(`AUDIT ${info(stack, 'page-stack')}`)
  page.querySelectorAll<HTMLElement>('.wui-panel').forEach((panel, i) => {
    const body = panel.querySelector<HTMLElement>(':scope > .wui-panel-body')
    const title = panel.querySelector('.wui-panel-title')?.textContent ?? `panel${i}`
    console.log(`AUDIT panel=${title} h=${Math.round(panel.clientHeight)}/${Math.round(panel.scrollHeight)}`)
    if (body) console.log(`AUDIT body-of=${title} h=${Math.round(body.clientHeight)}/${Math.round(body.scrollHeight)} ov=${getComputedStyle(body).overflowY}`)
  })
  page.querySelectorAll<HTMLElement>('.app-belt-grid,.app-ano-list,.app-inv-list,.app-shelf-grid,.app-mkt-list').forEach((el) => {
    console.log(`AUDIT list.${el.className.split(' ')[0]} ${info(el, 'list')}`)
  })
}

function navButton(label: string): HTMLButtonElement | null {
  const nodes = document.querySelectorAll<HTMLButtonElement>('.app-nav-side button')
  for (const b of nodes) {
    if ((b.textContent ?? '').trim().includes(label)) return b
  }
  return null
}

async function tryStartBattle(engine: GameEngine): Promise<boolean> {
  const st = engine.state
  if (st.expedition.active) return st.expedition.phase === 'battle'
  for (const a of engine.allAnomalies) {
    if (a.galaxyId && !st.exploredGalaxies.includes(a.galaxyId)) st.exploredGalaxies.push(a.galaxyId)
    st.standingsEarned = st.standingsEarned ?? {}
    for (const k of new Set([...Object.keys(st.standings), 'dsi'])) {
      st.standings[k] = Math.max(st.standings[k] ?? 0, 10)
      st.standingsEarned[k] = Math.max(st.standingsEarned[k] ?? 0, 10)
    }
    const r = engine.startExpeditionAt(a.id, a.galaxyId)
    if (!r.ok) continue
    const exp = st.expedition
    if (exp.active && exp.phase === 'out') {
      exp.finishAtGameMs = st.gameMs + 1
    }
    return true
  }
  console.log('AUTOPERF_WARN 未能发起任何远征（目录可能为空或全部被前置拒绝）')
  return false
}

async function runScene(
  engine: GameEngine,
  sc: { name: string; seconds: number; page?: string; subtab?: string; auditScroll?: boolean; battle?: boolean },
): Promise<void> {
  if (sc.page) {
    const b = navButton(sc.page)
    if (b) b.click()
    await sleep(1500)
  }
  if (sc.subtab) {
    const nodes = document.querySelectorAll<HTMLButtonElement>('.app-subtabs button, .app-task-tabs button')
    for (const t of nodes) {
      if ((t.textContent ?? '').includes(sc.subtab)) {
        t.click()
        break
      }
    }
    await sleep(1200)
  }
  if (sc.auditScroll) auditScrollGeometry()
  perfHub.beginScene(sc.name)
  const deadline = Date.now() + sc.seconds * 1000
  if (sc.battle) {
    let lastTry = 0
    while (Date.now() < deadline) {
      const exp = engine.state.expedition
      const inBattle = exp.active && exp.phase === 'battle' && !!exp.battle
      if (!inBattle && Date.now() - lastTry > 2_000) {
        lastTry = Date.now()
        if (!exp.active && engine.state.awayGalaxy === null) {
          const ok = await tryStartBattle(engine)
          if (ok)
  console.log('AUTOPERF_INFO 战斗已开启，计时中…')
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

export async function runAutoPerf(engine: GameEngine, spec: AutoPerfSpec): Promise<void> {
  if (!spec || !Array.isArray(spec.scenes) || spec.scenes.length === 0) {
  console.log('AUTOPERF_REPORT_INVALID 场景表为空')
    return
  }
  perfHub.activate()
  for (let i = 0; i < 200 && !document.querySelector('.app-root'); i++) await sleep(100)
  await sleep(2_500)
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
