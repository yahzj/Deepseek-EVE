import { constants, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flush, gate, runSaveModule } from './helpers/save-shell'

type Handler = (event?: unknown, value?: unknown) => Promise<unknown>
function mainShell(io: object, ledger: { bumpLedger(seq: number, rescue?: boolean): Promise<object> } = {
  bumpLedger: vi.fn(async () => ({})),
}, directory = '/isolated') {
  const handlers = new Map<string, Handler>()
  runSaveModule('apps/desktop/src/main/index.ts', {
    electron: { app: { getPath: () => directory }, ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) } },
    '@whale/data': { L10N: {} }, 'node:fs': { promises: io, constants },
    './ironmanLedger': { ironmanLedgerStore: () => ledger, ironmanInfoOfSaveText: (text: string) => {
      try { return { seq: JSON.parse(text).state?.ironman?.seq ?? 0 } } catch { return null }
    } },
  })
  return { call: (name: string, value?: unknown) => handlers.get(name)!(null, value), ledger }
}

function memoryFiles() {
  const files = new Map<string, string>()
  const io = {
    writeFile: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
    rename: vi.fn(async (from: string, to: string) => {
      if (!files.has(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      files.set(to, files.get(from)!)
      files.delete(from)
    }),
    readFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return files.get(path)!
    }),
    access: vi.fn(async (path: string) => {
      if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
    copyFile: vi.fn(async (from: string, to: string) => {
      if (files.has(to)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      files.set(to, files.get(from)!)
    }),
    unlink: vi.fn(async (path: string) => { files.delete(path) }),
  }
  return { files, io }
}

describe('C01 桌面生产 IPC 保存事务', () => {
  it('慢 A 未完成时 B 不落盘，回执与自己的内容一致', async () => {
    const { files, io } = memoryFiles()
    const entered = gate(), hold = gate(), holdB = gate()
    io.writeFile.mockImplementation(async (path, text) => {
      files.set(path, text)
      if (text === 'A') { entered.release(); await hold.promise }
      if (text === 'B') await holdB.promise
    })
    const shell = mainShell(io)
    const a = shell.call('save:save', 'A')
    await entered.promise
    const b = shell.call('save:save', 'B').catch((err: Error) => err.message)
    await flush()
    const before = io.writeFile.mock.calls.map(([, text]) => text)
    hold.release()
    expect(await a).toBe(true)
    const atA = files.get(join('/isolated', 'save.json'))
    holdB.release()
    expect(await b).toBe(true)
    expect(before).toEqual(['A'])
    expect(atA).toBe('A')
    expect(files.get(join('/isolated', 'save.json'))).toBe('B')
    expect(io.writeFile.mock.calls[0]![0]).not.toBe(io.writeFile.mock.calls[1]![0])
  })

  it('保存/恢复/无参数备份同序，不自动生成恢复前备份', async () => {
    const { files, io } = memoryFiles()
    const name = 'save-20261003-120000.json'
    files.set(join('/isolated', name), 'RESTORED')
    const entered = gate(), hold = gate()
    io.writeFile.mockImplementation(async (path, text) => {
      files.set(path, text)
      if (text === 'A') { entered.release(); await hold.promise }
    })
    const shell = mainShell(io)
    const a = shell.call('save:save', 'A')
    await entered.promise
    const restore = shell.call('save:restore', name)
    const backup = shell.call('save:backup')
    await flush()
    const before = io.writeFile.mock.calls.map(([, text]) => text)
    hold.release()
    await a
    expect(await restore).toMatchObject({ ok: true })
    const result = await backup as { ok: boolean; name: string }
    expect(before).toEqual(['A'])
    expect(result.ok).toBe(true)
    expect(files.get(join('/isolated', result.name))).toBe('RESTORED')
    expect(io.copyFile).toHaveBeenCalledTimes(1)
  })

  it('主档写失败传播，下一笔继续成功，不残留本次临时文件', async () => {
    const { files, io } = memoryFiles()
    files.set(join('/isolated', 'save.json'), 'OLD')
    io.rename.mockRejectedValueOnce(new Error('disk locked'))
    const shell = mainShell(io)
    await expect(shell.call('save:save', 'FAIL')).rejects.toThrow('disk locked')
    expect(files.get(join('/isolated', 'save.json'))).toBe('OLD')
    expect(await shell.call('save:save', 'NEXT')).toBe(true)
    expect([...files.keys()]).toEqual([join('/isolated', 'save.json')])
  })

  it('回执等待账本事务，而不是只等待主档 rename', async () => {
    const { io } = memoryFiles()
    const entered = gate(), hold = gate()
    let finished = false, received = false
    const shell = mainShell(io, { bumpLedger: vi.fn(async () => {
      entered.release(); await hold.promise; finished = true; return {}
    }) })
    const receipt = shell.call('save:save', '{"state":{"ironman":{"seq":7}}}').then((value) => { received = true; return value })
    await entered.promise
    await flush()
    const early = received
    hold.release()
    expect(await receipt).toBe(true)
    expect(early).toBe(false)
    expect(finished).toBe(true)
  })

  it('精确快照备份不被后一次保存替换，也不倒写主档；同秒备份不覆盖', async () => {
    const { files, io } = memoryFiles()
    const shell = mainShell(io)
    await shell.call('save:save', 'A')
    await shell.call('save:save', 'B')
    const a = await shell.call('save:backup', 'A') as { ok: boolean; name: string }
    const b = await shell.call('save:backup', 'A') as { ok: boolean; name: string }
    expect(a.ok && b.ok).toBe(true)
    expect(a.name).not.toBe(b.name)
    expect(files.get(join('/isolated', a.name))).toBe('A')
    expect(files.get(join('/isolated', 'save.json'))).toBe('B')
  })

  it('非法 IPC 输入拒绝，不触达文件系统', async () => {
    const { io } = memoryFiles()
    const shell = mainShell(io)
    expect(await shell.call('save:save', {})).toBe(false)
    expect(await shell.call('save:save', 'x'.repeat(10 * 1024 * 1024 + 1))).toBe(false)
    expect(await shell.call('save:backup', {})).toMatchObject({ ok: false })
    expect(await shell.call('save:restore', '../save.json')).toMatchObject({ ok: false })
    expect(io.writeFile).not.toHaveBeenCalled()
  })
})

const temporary: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of temporary.splice(0)) {
    const absolute = resolve(dir)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes('whale-save-transaction-')) throw new Error('临时目录越界')
    await fs.rm(absolute, { recursive: true, force: true })
  }
})

describe('C01 真实隔离文件账本', () => {
  async function store() {
    const dir = await fs.mkdtemp(join(tmpdir(), 'whale-save-transaction-'))
    temporary.push(dir)
    const { ironmanLedgerStore } = await import('../../../apps/desktop/src/main/ironmanLedger')
    return { dir, ledger: ironmanLedgerStore(() => dir) }
  }

  it('并发代次与多次救援保留最高值及每次计数，双份一致', async () => {
    const { dir, ledger } = await store()
    await Promise.all([ledger.bumpLedger(9), ledger.bumpLedger(3, true), ledger.bumpLedger(7, true)])
    expect(await ledger.readLedger()).toMatchObject({ seq: 9, rescues: 2 })
    expect(await fs.readFile(join(dir, 'ironman-ledger.json'), 'utf8'))
      .toBe(await fs.readFile(join(dir, 'ironman-ledger.bak.json'), 'utf8'))
    expect((await fs.readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('主进程真实文件保存、精确备份、恢复往返，失败不污染后续请求', async () => {
    const { dir, ledger } = await store()
    const shell = mainShell(fs, ledger, dir)
    const a = '{"state":{"ironman":{"seq":7}}}'
    const b = '{"state":{"ironman":{"seq":8}}}'
    expect(await shell.call('save:save', a)).toBe(true)
    expect(await ledger.readLedger()).toMatchObject({ seq: 7 })
    const next = shell.call('save:save', b)
    const backup = shell.call('save:backup', a)
    await next
    const bp = await backup as { ok: boolean; name: string }
    expect(bp.ok).toBe(true)
    expect(await fs.readFile(join(dir, bp.name), 'utf8')).toBe(a)
    expect(await fs.readFile(join(dir, 'save.json'), 'utf8')).toBe(b)
    expect(await shell.call('save:restore', 'save-20000101-000000.json')).toMatchObject({ ok: false })
    expect(await shell.call('save:restore', bp.name)).toMatchObject({ ok: true })
    expect(await fs.readFile(join(dir, 'save.json'), 'utf8')).toBe(a)
    expect(await ledger.readLedger()).toMatchObject({ seq: 8 })
    expect((await fs.readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('写失败不阻断既有降级政策，但发出诊断；故障消除后可继续', async () => {
    const { dir, ledger } = await store()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fs.mkdir(join(dir, 'ironman-ledger.json'))
    expect(await ledger.bumpLedger(7)).toMatchObject({ seq: 7 })
    expect(warn).toHaveBeenCalled()
    await fs.rmdir(join(dir, 'ironman-ledger.json'))
    await ledger.bumpLedger(8, true)
    expect(await ledger.readLedger()).toMatchObject({ seq: 8, rescues: 1 })
    expect((await fs.readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('账本失败时桌面主档仍成功，回执发生在降级诊断之后', async () => {
    const { dir, ledger } = await store()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fs.mkdir(join(dir, 'ironman-ledger.json'))
    const shell = mainShell(fs, ledger, dir)
    const text = '{"state":{"ironman":{"seq":7}}}'
    expect(await shell.call('save:save', text)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(join(dir, 'save.json'), 'utf8')).toBe(text)
  })
})

describe('唯一临时文件的边界', () => {
  it('极端临时名冲突不删除他人的已有文件', async () => {
    const { files, io } = memoryFiles()
    const file = join('/isolated', 'save.json')
    const tmp = file + '.collision.tmp'
    files.set(tmp, 'OTHER')
    io.writeFile.mockRejectedValueOnce(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }))
    const { atomicSaveWrite } = runSaveModule<{ atomicSaveWrite(file: string, text: string): Promise<void> }>(
      'apps/desktop/src/main/atomicSaveWrite.ts', {
        'node:fs': { promises: io, constants }, 'node:crypto': { randomUUID: () => 'collision' },
      })
    await expect(atomicSaveWrite(file, 'NEW')).rejects.toThrow('EEXIST')
    expect(files.get(tmp)).toBe('OTHER')
    expect(io.unlink).not.toHaveBeenCalled()
  })
})
