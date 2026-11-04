import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

/** 执行完整主进程入口，只替换Electron与文件系统边界，不重写窗口配置。 */
function boot(env: Record<string, string | undefined> = {}) {
  const options: Array<{ webPreferences: { backgroundThrottling?: boolean } }> = []
  const switches: string[] = []
  const order: string[] = []
  const loadFile = vi.fn(), loadURL = vi.fn(), setPath = vi.fn()
  class BrowserWindow {
    static getAllWindows = () => []
    constructor(opts: (typeof options)[number]) { options.push(opts); order.push('window') }
    on = vi.fn()
    show = vi.fn()
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() }
    loadFile = loadFile
    loadURL = loadURL
  }
  const app = { setName: vi.fn(), setPath, on: vi.fn(), quit: vi.fn(),
    commandLine: { appendSwitch: (value: string) => { switches.push(value); order.push(value) } },
    whenReady: () => ({ then: (fn: () => void) => { order.push('ready'); fn() } }),
  }
  const deps: Record<string, unknown> = {
    electron: { app, BrowserWindow, dialog: {}, ipcMain: { handle: vi.fn() },
      screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) } },
    'node:fs': { constants: {}, promises: {} },
    'node:path': { join },
    '@whale/data': { L10N: {}, l10nEntryText: vi.fn() },
    '../shared/saveQueue': { createSaveQueue: () => vi.fn() },
    './atomicSaveWrite': { atomicSaveWrite: vi.fn() },
    './ironmanLedger': { ironmanLedgerStore: () => ({}), ironmanInfoOfSaveText: vi.fn() },
  }
  const source = readFileSync(new URL('../../../apps/desktop/src/main/index.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(js, { exports: {}, __dirname: '/isolated-app/main', process: { env, platform: 'win32' },
    require: (id: string) => {
      if (!(id in deps)) throw new Error(`未隔离的依赖：${id}`)
      return deps[id]
    },
  }, { timeout: 2000 })
  return { options, switches, order, loadFile, loadURL, setPath }
}

describe('桌面正常启动的后台运行策略', () => {
  it.each([{}, { WHALE_AUTOPERF: '1' }, { ELECTRON_RENDERER_URL: 'http://localhost:5173' }])('普通、诊断与开发启动均不节流主窗口：%j', env => {
    const result = boot(env)
    expect(result.options).toHaveLength(1)
    expect(result.options[0]!.webPreferences.backgroundThrottling).toBe(false)
    expect(result.switches).toEqual(['disable-background-timer-throttling', 'disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'])
    for (const flag of result.switches) expect(result.order.indexOf(flag)).toBeLessThan(result.order.indexOf('ready'))
    expect(result.setPath).not.toHaveBeenCalled()
  })

  it('隔离目录仍只在显式指定时使用，非性能模式也能回归玩家路径', () => {
    const result = boot({ WHALE_PERF_USERDATA: '/isolated-test-profile' })
    expect(result.setPath).toHaveBeenCalledTimes(1)
    expect(result.setPath).toHaveBeenCalledWith('userData', '/isolated-test-profile')
    expect(result.options[0]!.webPreferences.backgroundThrottling).toBe(false)
    expect(result.loadFile).toHaveBeenCalledOnce()
    expect(result.loadURL).not.toHaveBeenCalled()
  })
})
