/**
 * **网页版「本地存档文件」体检**（2026-09-25 建；船长令：网页版存档除浏览器默认存储外，
 * **优先保存到本地文件**，「就跟我本地运行一样」）。
 *
 * 要量的是七件事（不达标即退出码 1）：
 *   ① 未绑定：状态显示"未绑定"，落盘只写浏览器存储（不碰文件）；
 *   ② 绑定：设置里点「绑定本地存档文件」后，状态显示文件名 ＋ 已连接；
 *   ③ 双写：此后每次落盘，**文件内容与浏览器存储内容一致**（比 `savedAtWallMs`）；
 *   ④ 优先读·文件更新：把一份"更新的"存档直接写进文件 → 重载后游戏读到的是**文件那份**
 *      （可观察：钱包余额 = 我们塞进去的哨兵值）；
 *   ⑤ 优先读·浏览器更新：把文件改成"更旧的" → 重载后读到的是**浏览器那份**（甲案：按 savedAtWallMs 取较新）；
 *   ⑥ 解绑：状态回到"未绑定"，落盘不再写文件；
 *   ⑦ 不支持（Safari/Firefox 那种没有 `showSaveFilePicker` 的环境）：设置里那枚按钮禁用、
 *      说明可见，且游戏照常以浏览器存储运行。
 *
 * 手法：**只假扮系统"另存为"对话框**（`window.showSaveFilePicker` 返回一个 **真正的 OPFS 文件句柄**），
 * 其余全走真实代码路径（IndexedDB 存句柄、`createWritable` 写、`getFile` 读）。
 * 无头浏览器无法操作原生对话框，这是唯一被替换的一环 —— 替换物仍是真 `FileSystemFileHandle`。
 *
 * 运行前置（同 `save-guard-check`）：
 *   1) 网页版已构建并在跑：`npm run build --prefix web` ＋ `npm run preview --prefix web -- --port 4199 --strictPort`；
 *   2) 自己的无头 Chrome（CDP 默认 9333；非默认端口、记 PID、收尾只 kill 自己那一个）。
 *      ⚠ 本工具会注册"文档开头注入脚本"：**崩过一次要换新浏览器再跑**。
 *
 * 用法：`npm run save:webfile-check`
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-25 · 最后跑过 2026-09-25
 */
const APP = process.env.UI_APP_URL ?? 'http://localhost:4199/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'

type R = Record<string, unknown>
class Cdp {
  private seq = 0
  private readonly w = new Map<number, { res: (v: R) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: R }
      const t = m.id !== undefined ? this.w.get(m.id) : undefined
      if (!t || m.id === undefined) return
      this.w.delete(m.id)
      if (m.error) t.rej(new Error(JSON.stringify(m.error)))
      else t.res(m.result ?? {})
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const list = (await (await fetch(`${url}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error('没有页面 target')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true })
      ws.addEventListener('error', () => rej(new Error('连不上 CDP')), { once: true })
    })
    return new Cdp(ws)
  }
  send(method: string, params: R = {}): Promise<R> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<R>((res, rej) => this.w.set(id, { res, rej }))
  }
  async js<T>(expr: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as {
      exceptionDetails?: { text?: string }
      result?: { value?: unknown }
    }
    if (r.exceptionDetails) throw new Error(`页面报错：${r.exceptionDetails.text ?? ''}`)
    return r.result?.value as T
  }
  close(): void {
    this.ws.close()
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 假扮"另存为"对话框：返回一个**真的** OPFS 文件句柄（其余代码路径全真） */
const FAKE_PICKER = `(() => {
  window.showSaveFilePicker = async () => {
    const root = await navigator.storage.getDirectory()
    return await root.getFileHandle('whale-save.json', { create: true })
  }
})()`
/** ⑦ 不支持的环境：把 API 拿掉 */
const NO_PICKER = `(() => { delete window.showSaveFilePicker })()`

/** 页面内读数：存储状态行 ＋ 那枚本地文件按钮 ＋ OPFS 文件里的存档 */
const READ = `(async () => {
  const rows = [...document.querySelectorAll('.app-settings-row')]
  const row = rows.find((r) => (r.querySelector('.app-settings-label')?.textContent || '').includes('存储状态'))
  const btns = row ? [...row.querySelectorAll('button')] : []
  let fileText = null
  try {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle('whale-save.json', { create: false })
    fileText = await (await fh.getFile()).text()
  } catch { /* 文件还不存在：预期 */ }
  const api = window.__bridgeFileApi // 由探针注入：暴露桥上的 saveFile 组
  return {
    支持: !!(row && btns.every((b) => !b.disabled)) ? true : undefined,
    状态行: row?.querySelector('.app-settings-desc')?.textContent?.trim() ?? '(无这一行)',
    按钮: btns.map((b) => ({ 文案: (b.textContent || '').trim(), 禁用: b.disabled })),
    文件字节: fileText === null ? null : fileText.length,
    文件时刻: fileText === null ? null : (JSON.parse(fileText).savedAtWallMs ?? null),
    文件钱包: fileText === null ? null : (JSON.parse(fileText).state?.wallet?.isk ?? null),
    浏览器时刻: (() => { try { const t = localStorage.getItem('whale:idle:save'); return t ? JSON.parse(t).savedAtWallMs : null } catch { return null } })(),
    浏览器钱包: (() => { try { const t = localStorage.getItem('whale:idle:save'); return t ? JSON.parse(t).state?.wallet?.isk : null } catch { return null } })(),
    界面钱包: (document.querySelector('.app-wallet')?.textContent || '').trim().slice(0, 40),
    告警条: (document.querySelector('.app-toast')?.textContent || '').trim().slice(0, 50),
    apiPresent: !!api,
  }
})()`

const OPEN_SETTINGS = `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '设置'); if (b) { b.click(); return true } return false })()`
const CLOSE_SETTINGS = `(() => { const b = [...document.querySelectorAll('.app-modal-head button, .app-modal button')].find((x) => /✕|关闭/.test(x.textContent || '')); if (b) { b.click(); return true } return false })()`
/** 点设置里某一枚按钮（按文案匹配） */
const clickBtn = (label: string): string => `(() => {
  const b = [...document.querySelectorAll('.app-settings-row button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(label)})
  if (b) { b.click(); return true }
  return false
})()`

/** 往 OPFS 文件里直接塞一份存档（用来演"文件更新/更旧"两种情形） */
const seedFile = (isk: number, wall: number): string => `(async () => {
  const root = await navigator.storage.getDirectory()
  const fh = await root.getFileHandle('whale-save.json', { create: true })
  const w = await fh.createWritable()
  const lsText = localStorage.getItem('whale:idle:save')
  const obj = JSON.parse(lsText)
  obj.savedAtWallMs = ${wall}
  obj.state.wallet.isk = ${isk}
  await w.write(JSON.stringify(obj))
  await w.close()
  return 'ok'
})()`

let injectId: string | null = null
async function setInject(cdp: Cdp, src: string | null): Promise<void> {
  if (injectId !== null) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injectId })
    injectId = null
  }
  if (src !== null) {
    const r = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src })) as { identifier?: string }
    injectId = r.identifier ?? null
  }
}
async function boot(cdp: Cdp): Promise<void> {
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 90; i++) {
    if (await cdp.js<boolean>(`document.readyState === 'complete' && !!window.localStorage`)) break
    await sleep(120)
  }
  for (let i = 0; i < 120; i++) {
    if (await cdp.js<boolean>(`!!document.querySelector('.app-nav-side')`)) break
    await sleep(150)
  }
  await sleep(700)
}

const problems: string[] = []
function check(ok: boolean, msg: string): void {
  console.log(`   ${ok ? '✅' : '❌'} ${msg}`)
  if (!ok) problems.push(msg)
}

async function main(): Promise<void> {
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  // 清场：干净 origin（换新句柄/旧文件一律清掉）
  await setInject(cdp, null)
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 60; i++) {
    if (await cdp.js<boolean>(`document.readyState === 'complete'`)) break
    await sleep(120)
  }
  await cdp.js(`(async () => {
    localStorage.clear()
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) { try { await root.removeEntry(name, { recursive: true }) } catch {} }
    const dbs = await indexedDB.databases()
    for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name)
    return 'ok'
  })()`)

  console.log('① 未绑定：状态 + 只写浏览器存储')
  await setInject(cdp, FAKE_PICKER)
  await boot(cdp)
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(500)
  let r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  check(String(r.状态行).includes('本地文件 未绑定'), '状态行显示「本地文件 未绑定」')
  check(Array.isArray(r.按钮) && (r.按钮 as Array<{ 文案: string }>).some((b) => b.文案 === '绑定本地存档文件'), '有「绑定本地存档文件」按钮')
  check(r.文件字节 === null, '未绑定时不碰文件（文件不存在）')
  await cdp.js<boolean>(clickBtn('保存'))
  await sleep(1200)
  r = await cdp.js<R>(READ)
  check(r.文件字节 === null && r.浏览器时刻 !== null, '落盘只写浏览器存储')

  console.log('\n② 绑定（点设置里的按钮）')
  await cdp.js<boolean>(clickBtn('绑定本地存档文件'))
  await sleep(1500)
  r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  check(Array.isArray(r.按钮) && (r.按钮 as Array<{ 文案: string }>).some((b) => b.文案 === '解绑'), '绑定后按钮变成「解绑」')
  check(String(r.状态行).includes('whale-save.json') && String(r.状态行).includes('已连接'), '状态行显示文件名 ＋ 已连接')
  check(r.文件字节 !== null && r.文件时刻 === r.浏览器时刻, '绑定时把当前存档写进了文件（时刻一致）')

  console.log('\n③ 双写：再落一次盘 ⇒ 文件与浏览器存储一致')
  await cdp.js<boolean>(clickBtn('保存'))
  await sleep(1200)
  r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  check(r.文件时刻 !== null && r.文件时刻 === r.浏览器时刻, '双写：文件时刻 = 浏览器存储时刻')

  console.log('\n④ 优先读·文件更新 ⇒ 读到文件那份（哨兵钱包 111222333）')
  await cdp.js(seedFile(111_222_333, Date.now() + 60_000))
  await cdp.js<boolean>(CLOSE_SETTINGS)
  await boot(cdp) // 重载
  r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  check(String(r.界面钱包).includes('111,222,333') || String(r.界面钱包).includes('111222333'), '界面钱包 = 文件里的哨兵值（文件更优先）')

  console.log('\n⑤ 优先读·文件更旧 ⇒ 读到浏览器那份（甲案：按 savedAtWallMs 取较新）')
  const lsWall = Number(r.浏览器时刻 ?? 0)
  await cdp.js(seedFile(999_888_777, lsWall - 120_000))
  await boot(cdp)
  r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  check(!String(r.界面钱包).includes('999,888,777') && !String(r.界面钱包).includes('999888777'), '界面钱包不是文件里那个旧哨兵（浏览器那份获胜）')

  console.log('\n⑥ 解绑：状态回到未绑定，落盘不再写文件')
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(400)
  await cdp.js<boolean>(clickBtn('解绑'))
  await sleep(1200)
  r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  check(String(r.状态行).includes('本地文件 未绑定'), '解绑后状态行回到「本地文件 未绑定」')
  const before = r.文件时刻
  await cdp.js<boolean>(clickBtn('保存'))
  await sleep(1200)
  r = await cdp.js<R>(READ)
  check(r.文件时刻 === before, '解绑后落盘不再改文件')

  console.log('\n⑦ 不支持的环境（没有 showSaveFilePicker：Safari/Firefox 那种）')
  await setInject(cdp, NO_PICKER)
  await boot(cdp)
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(500)
  r = await cdp.js<R>(READ)
  console.log('   ' + JSON.stringify(r))
  const bindBtn = (r.按钮 as Array<{ 文案: string; 禁用: boolean }>).find((b) => b.文案 === '绑定本地存档文件')
  check(!!bindBtn && bindBtn.禁用, '按钮存在但**禁用**')
  check(String(r.状态行).includes('不支持直接写本地文件'), '状态行给出说明（用 Chrome/Edge 或定期导出）')
  check(r.浏览器时刻 !== null, '游戏仍以浏览器存储正常运行')

  cdp.close()
  if (problems.length > 0) {
    console.log(`\n❌ 不达标 ${problems.length} 项：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('\n✅ 七项全过：绑定/双写/优先读（甲案）/解绑/不支持环境 都符合预期。')
  }
}

main().catch((e: unknown) => {
  console.error(`体检失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
