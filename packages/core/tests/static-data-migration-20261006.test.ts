import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { FRAGMENT_RECIPES, fragmentItemIdOf, WRECK_GROUPS, wreckItemIdOf, rareWreckItemIdOf } from '../src/index'
import ts from 'typescript'
import ExcelJS from 'exceljs'
import * as ships from '../../data/src/ships'
import * as modules from '../../data/src/modules'
import * as plugs from '../../data/src/plugs'
import * as items from '../../data/src/items'
import * as market from '../../data/src/marketCatalog'
import { staticDataGroup } from '../../data/src/staticData'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { tableOf, normalizeHead } from '../../../tools/content-schema'
import { applyStaticChanges, planStaticImport } from '../../../tools/content-import'

const BASELINE = 'f30834cfdf26c7090876d21b450029218a268ab8'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const raw = { ships, modules, plugs, items, market }
type Snapshot = {
  raw: Record<keyof typeof raw, Record<string, unknown>>
  zh: ReturnType<typeof buildSimContext>
  en: ReturnType<typeof buildSimContext>
}
let baseline: Snapshot

// 只读固定Git提交的完整依赖图，不借用工作树里的迁移后数据或个人存档。
async function baselineSnapshot(): Promise<Snapshot> {
  const files = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', BASELINE], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  }).trim().split('\n'))
  const sourceCache = new Map<string, string>()
  const result = await build({
    stdin: {
      contents: [
        ...Object.keys(raw).map(name => `import * as ${name} from './packages/data/src/${name === 'market' ? 'marketCatalog' : name}';`),
        "import { buildSimContext } from './packages/data/src/context';",
        'export const snapshot = { raw: { ships, modules, plugs, items, market }, zh: buildSimContext(), en: buildSimContext("en") };',
      ].join('\n'),
      resolveDir: root, sourcefile: 'migration-baseline.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', target: 'es2022', write: false,
    plugins: [{
      name: 'fixed-git-baseline',
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, args => {
          let base: string
          if (args.path === '@whale/core') base = 'packages/core/src/index'
          else if (args.path === '@whale/data') base = 'packages/data/src/index'
          else if (args.path.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(args.importer || 'migration-baseline.ts'), args.path))
          else throw new Error(`基线出现未登记依赖：${args.importer} -> ${args.path}`)
          const path = [base, `${base}.ts`, `${base}.json`, `${base}/index.ts`].find(candidate => files.has(candidate))
          if (!path) throw new Error(`Git基线缺少依赖：${base}`)
          return { path, namespace: 'fixed-git' }
        })
        buildApi.onLoad({ filter: /.*/, namespace: 'fixed-git' }, args => {
          let contents = sourceCache.get(args.path)
          if (contents === undefined) {
            contents = execFileSync('git', ['show', `${BASELINE}:${args.path}`], {
              cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
            })
            sourceCache.set(args.path, contents)
          }
          return { contents, loader: args.path.endsWith('.json') ? 'json' : 'ts' }
        })
      },
    }],
  })
  const module = { exports: {} as { snapshot: Snapshot } }
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, require: createRequire(import.meta.url) }, {
    filename: 'migration-baseline.cjs', timeout: 10_000,
  })
  return module.exports.snapshot
}

// Map/数组顺序参与比较；对象按键比较且显式undefined不能混同于未设置。
function comparable(value: unknown): unknown {
  if (value === undefined) return { $undefined: true }
  if (Array.isArray(value)) return value.map(comparable)
  if (Object.prototype.toString.call(value) === '[object Map]') {
    return { $map: [...(value as Map<unknown, unknown>)].map(([key, row]) => [comparable(key), comparable(row)]) }
  }
  if (Object.prototype.toString.call(value) === '[object Set]') return { $set: [...(value as Set<unknown>)].map(comparable) }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [key, comparable(row)]))
  }
  return value
}

function constants(exports: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(exports).filter(([, value]) => typeof value !== 'function'))
}

// 全值冻结仅用于本次搬表验收；日常调参不运行，显式DATA_MIGRATION_VERIFY=1才启用。
describe.skipIf(process.env.DATA_MIGRATION_VERIFY !== '1')('迁移专用验收（常规跳过，DATA_MIGRATION_VERIFY=1启用）', () => {
  beforeAll(async () => { baseline = await baselineSnapshot() }, 60_000)

  it.each(Object.keys(raw) as Array<keyof typeof raw>)('%s 全部原始常量导出保留值、顺序和未设置字段', name => {
    expect(comparable(constants(raw[name]))).toEqual(comparable(constants(baseline.raw[name])))
  })

  it.each(['zh', 'en'] as const)('%s 完整ctx的所有目录键、顺序、文本、参数、派生与过滤逐项相等', locale => {
    const current = buildSimContext(locale)
    expect(Object.keys(current).sort()).toEqual(Object.keys(baseline[locale]).sort())
    for (const [key, value] of Object.entries(current)) {
      expect(comparable(value), `ctx.${key}/${locale}`).toEqual(comparable(baseline[locale][key as keyof typeof current]))
    }
  })

  it('默认语言与显式zh一致，插件槽、派生残骸/碎片和过滤结果仍来自原规则', () => {
    expect(comparable(buildSimContext())).toEqual(comparable(buildSimContext('zh')))
    const ctx = buildSimContext()
    expect(ships.SHIPS.map(ship => [ship.id, ship.plugSlots]))
      .toEqual(Array.from(baseline.raw.ships.SHIPS as typeof ships.SHIPS, ship => [ship.id, ship.plugSlots]))
    expect([...ctx.items.keys()].filter(id => id.startsWith('wreck-') || id.startsWith('frag-')))
      .toEqual([...baseline.zh.items.keys()].filter(id => id.startsWith('wreck-') || id.startsWith('frag-')))
    expect([...ctx.marketGoods.keys()]).toEqual([...baseline.zh.marketGoods.keys()])
  })
})

function sourceFile(name: keyof typeof raw): string {
  return `packages/data/src/${name === 'market' ? 'marketCatalog' : name}.ts`
}

function staticSource(name: keyof typeof raw): string {
  return readFileSync(join(root, `packages/data/src/static/${name}.json`), 'utf8')
}

describe('日常JSON装配守恒（随当前参数，不冻结迁移日数值）', () => {
  it.each(Object.keys(raw) as Array<keyof typeof raw>)('%s JSON字段逐项进入原分组，TS绑定不复制静态参数', name => {
    const document = JSON.parse(staticSource(name)) as DataDocument
    const sf = ts.createSourceFile(sourceFile(name), readFileSync(join(root, sourceFile(name)), 'utf8'), ts.ScriptTarget.Latest, true)
    for (const [group, rows] of Object.entries(document.groups)) {
      const groupName = group.replace(/_\d+$/, '')
      const assembled = (raw[name] as Record<string, unknown>)[groupName] as Array<Record<string, unknown>>
      const declaration = sf.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])
        .find(d => d.name.getText(sf) === `${group}_TEXT_BINDINGS`)!
      expect(declaration, group).toBeDefined()
      const binding = declaration.initializer as ts.ObjectLiteralExpression
      const ids = new Set<string>()
      let previous = -1
      for (const row of rows) {
        const id = String(row.id ?? row.key)
        expect(ids.has(id), `${name}/${id}重复`).toBe(false)
        ids.add(id)
        const index = assembled.findIndex(current => (current.id ?? current.key) === id)
        expect(index, `${group}/${id}顺序`).toBeGreaterThan(previous)
        previous = index
        const entry = binding.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.name) && p.name.text === id)!
        expect(entry, `${group}/${id}绑定`).toBeDefined()
        const fields = (entry.initializer as ts.ObjectLiteralExpression).properties.filter(ts.isPropertyAssignment).map(p => p.name.getText(sf))
        for (const [field, value] of Object.entries(row)) {
          expect(fields, `${id}/${field}重复权威`).not.toContain(field)
          expect(comparable(assembled[index]![field]), `${group}/${id}/${field}`).toEqual(comparable(value))
        }
        expect(row).not.toHaveProperty('name')
        expect(row).not.toHaveProperty('description')
      }
    }
  })

  it('装配保留未设置、显式0、false、空数组及顺序，文本绑定覆盖仅发生在代码', () => {
    const document: DataDocument = { format: 'whale-static-data', version: 1, table: 'items', groups: {
      EXAMPLE: [{ id: 'second', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 0, exclusive: false, refine: [] }, { id: 'first', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 5 }],
    } }
    const assembled = staticDataGroup<Record<string, unknown>>(document, 'EXAMPLE', { second: { name: 'two' }, first: { name: 'one' } })
    expect(assembled).toEqual([{ id: 'second', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 0, exclusive: false, refine: [], name: 'two' }, { id: 'first', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 5, name: 'one' }])
    expect(Object.hasOwn(assembled[1]!, 'maxRangeM')).toBe(false)
    expect(document.groups.EXAMPLE).toEqual([{ id: 'second', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 0, exclusive: false, refine: [] }, { id: 'first', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 5 }])
  })

  it('ctx默认zh、目录顺序、按档插件槽和市场过滤跟随当前表与规则', () => {
    const ctx = buildSimContext()
    expect(comparable(ctx)).toEqual(comparable(buildSimContext('zh')))
    expect([...ctx.ships.keys()]).toEqual(ships.SHIPS.map(ship => ship.id))
    expect([...ctx.modules.keys()]).toEqual(modules.MODULES.map(module => module.id))
    expect(modules.MODULES.filter(module => module.slot === 'plug')).toEqual(plugs.SHIP_PLUGS)
    for (const ship of ships.SHIPS) expect(ship.plugSlots, ship.id).toBe(ships.PLUG_SLOTS_BY_TIER[ship.tier])
    expect([...ctx.marketGoods.keys()]).toEqual(market.MARKET_GOODS.filter(row => row.unreleased !== true).map(row => row.key))
    expect(market.WRECK_BUY_GOODS.map(row => row.key)).toEqual(WRECK_GROUPS.filter(group => group.region !== 'wh').map(group => wreckItemIdOf(group.key)))
    for (const group of WRECK_GROUPS) {
      expect(ctx.items.has(wreckItemIdOf(group.key))).toBe(true)
      expect(ctx.items.has(rareWreckItemIdOf(group.key))).toBe(true)
    }
    expect([...ctx.items.keys()].filter(id => id.startsWith('frag-')))
      .toEqual(Object.keys(FRAGMENT_RECIPES).filter(id => ctx.modules.has(id)).map(fragmentItemIdOf))
  })
})

type TableName = keyof typeof raw
function importFixture(name: TableName, columns: string[], edits: Record<string, Record<string, string>> = {}) {
  const spec = tableOf(name)!
  const headIdx = new Map(spec.cols.filter(col => col.k === 'id' || columns.includes(col.p)).map((col, index) => [col.head, index]))
  const list = name === 'market' ? market.MARKET_GOODS : name === 'ships' ? ships.SHIPS : name === 'items' ? items.ITEMS :
    name === 'plugs' ? plugs.SHIP_PLUGS : modules.MODULES.filter(module => module.slot !== 'plug')
  const data = [...new Set(list.map(row => 'key' in row ? row.key : row.id))].map(id => {
    const row = new Array<string>(headIdx.size).fill('')
    row[0] = id
    for (const col of spec.cols) {
      const index = headIdx.get(col.head)
      if (index !== undefined && edits[id]?.[col.p] !== undefined) row[index] = edits[id]![col.p]!
    }
    return row
  })
  const source = staticSource(name)
  const sources = new Map([[sourceFile(name), readFileSync(join(root, sourceFile(name)), 'utf8')]])
  return { spec, source, sources, data, headIdx, plan: () => planStaticImport(spec, source, sources, data, headIdx) }
}

describe('旧内容CLI · JSON规划和局部回写', () => {
  it.each(['ships', 'modules', 'plugs', 'items', 'market'] as const)('%s 空值保持原JSON，迁移后不要求旧TS对象块', name => {
    const fixture = importFixture(name, [])
    const plan = fixture.plan()
    expect(plan.errors).toEqual([])
    expect(plan.changes).toEqual([])
    expect(applyStaticChanges(fixture.source, plan.changes)).toBe(fixture.source)
  })

  it('按主键拒绝未知、缺失和重复ID', () => {
    const fixture = importFixture('ships', ['cargoM3'])
    fixture.data[0]![0] = 'not-an-existing-id'
    expect(fixture.plan().errors.join('\n')).toMatch(/不存在的主键.*not-an-existing-id/)
    expect(fixture.plan().errors.join('\n')).toMatch(/CSV 缺失/)
    fixture.data[0]![0] = fixture.data[1]![0]!
    expect(fixture.plan().errors.join('\n')).toMatch(/主键重复/)
  })

  it('源JSON复用静态类型契约，null、未知字段和错误类型即使CSV空值也拒绝', () => {
    const fixture = importFixture('ships', [])
    for (const fields of [{ cargoM3: null }, { unknownParameter: 1 }, { cargoM3: '800' }]) {
      const document = JSON.parse(fixture.source) as DataDocument
      Object.assign(Object.values(document.groups).flat()[0]!, fields)
      const plan = planStaticImport(fixture.spec, JSON.stringify(document), fixture.sources, fixture.data, fixture.headIdx)
      expect(plan.errors.join('\n')).toContain('字段不存在或类型不符')
      expect(plan.changes).toEqual([])
    }
    const plan = planStaticImport(fixture.spec, 'null', fixture.sources, fixture.data, fixture.headIdx)
    expect(plan.errors).toEqual(['静态数据必须为对象'])
  })

  it('候选JSON也过静态类型契约，旧列校验不能放行未知键或超安全范围数字', () => {
    const fixture = importFixture('ships', ['cargoM3'], { sandcat: { cargoM3: String(Number.MAX_SAFE_INTEGER + 1) } })
    expect(fixture.plan().errors.join('\n')).toContain('数值超出安全范围')
    const spec = { ...fixture.spec, cols: [...fixture.spec.cols, { head: 'unknownParameter', p: 'unknownParameter', k: 'num' as const }] }
    const headIdx = new Map(fixture.headIdx)
    headIdx.set('unknownParameter', headIdx.size)
    const data = fixture.data.map(row => [row[0]!, '', row[0] === 'sandcat' ? '1' : ''])
    const plan = planStaticImport(spec, fixture.source, fixture.sources, data, headIdx)
    expect(plan.errors.join('\n')).toContain('unknownParameter：字段不存在或类型不符')
  })

  it('类型契约允许新增已登记但当前行未设置的可选键，不限制为现有属性集合', () => {
    const fixture = importFixture('items', ['exclusive'], { 'ore-veldspar': { exclusive: 'false' } })
    const document = JSON.parse(fixture.source) as DataDocument
    delete Object.values(document.groups).flat().find(row => row.id === 'ore-veldspar')!.exclusive
    const plan = planStaticImport(fixture.spec, JSON.stringify(document), fixture.sources, fixture.data, fixture.headIdx)
    expect(plan.errors).toEqual([])
    expect(plan.changes).toEqual([{ kind: 'set', rowId: 'ore-veldspar', prop: 'exclusive', value: false }])
  })

  it('数值、布尔、枚举、列表及引用复用旧列校验，JSON只记录实际字段变化', () => {
    const kind = items.ITEMS.find(item => item.id === 'ore-veldspar')!.kind
    const fixture = importFixture('items', ['unitM3', 'exclusive', 'kind', 'refine'], {
      'ore-veldspar': { unitM3: '2', exclusive: 'false', kind, refine: 'min-tritanium×3' },
    })
    const plan = fixture.plan()
    expect(plan.errors).toEqual([])
    const output = JSON.parse(applyStaticChanges(fixture.source, plan.changes)) as DataDocument
    const row = Object.values(output.groups).flat().find(row => row.id === 'ore-veldspar')!
    expect(row).toMatchObject({ unitM3: 2, exclusive: false, kind, refine: [{ mineralId: 'min-tritanium', perOre: 3 }] })
    expect(plan.changes.some(change => change.prop === 'kind')).toBe(false)
    const bad = importFixture('items', ['unitM3', 'exclusive', 'kind', 'refine'], {
      'ore-veldspar': { unitM3: 'NaN', exclusive: 'maybe', kind: 'not-a-kind', refine: 'missing-id×0' },
    }).plan()
    expect(bad.errors.join('\n')).toMatch(/不是数字/)
    expect(bad.errors.join('\n')).toMatch(/须填 是\/否/)
    expect(bad.errors.join('\n')).toMatch(/非法枚举/)
    expect(bad.errors.join('\n')).toMatch(/引用了不存在的 id/)
    expect(bad.errors.join('\n')).toMatch(/不得小于/)
  })

  it('多列抗性和槽位合并不丢兄弟键，单个数字只替换原JSON对应值', () => {
    const before = ships.SHIPS.find(ship => ship.id === 'sandcat')!.slots!
    const fixture = importFixture('ships', ['slots.high', 'slots.mid'], { sandcat: {
      'slots.high': String(before.high + 1), 'slots.mid': String(before.mid + 1),
    } })
    const plan = fixture.plan()
    expect(plan.errors).toEqual([])
    expect(plan.changes).toHaveLength(1)
    const output = applyStaticChanges(fixture.source, plan.changes)
    expect(output).toBe(fixture.source.replace(`"high": ${before.high}`, `"high": ${before.high + 1}`).replace(`"mid": ${before.mid}`, `"mid": ${before.mid + 1}`))
    expect(JSON.parse(output).groups.SHIPS_0[0].slots).toEqual({ ...before, high: before.high + 1, mid: before.mid + 1 })
  })

  it('减号删除可选JSON字段；空单元格保持值；TS文本和表达式连减号也只读', () => {
    const fixture = importFixture('ships', ['name', 'description', 'hitBonus', 'cargoM3'], {
      sandcat: { name: 'not-a-new-name', description: '-', hitBonus: '-', cargoM3: '' },
    })
    const document = JSON.parse(fixture.source) as DataDocument
    Object.values(document.groups).flat().find(row => row.id === 'sandcat')!.hitBonus = 0.1
    const source = JSON.stringify(document, null, 2)
    const plan = planStaticImport(fixture.spec, source, fixture.sources, fixture.data, fixture.headIdx)
    expect(plan.errors).toEqual([])
    expect(plan.changes).toEqual([{ kind: 'del', rowId: 'sandcat', prop: 'hitBonus' }])
    expect(plan.readOnly).toHaveLength(2)
    const row = JSON.parse(applyStaticChanges(source, plan.changes)).groups.SHIPS_0[0]
    expect(row).not.toHaveProperty('hitBonus')
    expect(row.cargoM3).toBe(ships.SHIPS[0]!.cargoM3)
    const expression = importFixture('market', ['limitedSupplyEveryMs'], { 'min-voidcrystal': { limitedSupplyEveryMs: '-' } }).plan()
    expect(expression.errors).toEqual([])
    expect(expression.changes).toEqual([])
    expect(expression.readOnly.join('\n')).toContain('limitedSupplyEveryMs')
    expect(importFixture('market', ['limitedSupplyEveryMs'], { 'min-voidcrystal': { limitedSupplyEveryMs: 'NaN' } }).plan().errors.join('\n')).toContain('不是数字')
  })

  it('市场全部代码派生卡只读，旧表头别名仍可定位JSON价格列', () => {
    const fixture = importFixture('market', ['basePrice'], { 'wreck-a-hi': { basePrice: '123' }, 'plug-shield-plate': { basePrice: '123' } })
    const plan = fixture.plan()
    expect(plan.errors).toEqual([])
    expect(plan.changes).toEqual([])
    expect(plan.derivedSkipped).toBeGreaterThan(0)
    const oldHead = normalizeHead('空间站售价ISK(0=自带/仅制造)')
    expect(tableOf('ships')!.cols.find(col => col.head === oldHead)!.p).toBe('priceIsk')
  })
})

function invokeCli(fixture: ReturnType<typeof importFixture>, path: string, cwd = root, dryRun = true) {
  const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist/cli.mjs')
  const result = spawnSync(process.execPath, [tsxCli, join(root, 'tools/content-import.ts'), fixture.spec.name, path, ...(dryRun ? ['--dry-run'] : [])], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
  expect(result.error).toBeUndefined()
  return { status: result.status, output: result.stdout + result.stderr }
}

function runCli(fixture: ReturnType<typeof importFixture>, write?: { failValidation: boolean }) {
  const directory = mkdtempSync(join(tmpdir(), 'whale-static-import-'))
  const csv = join(directory, 'data.csv')
  const quote = (cell: string) => `"${cell.replaceAll('"', '""')}"`
  try {
    writeFileSync(csv, [Array.from(fixture.headIdx.keys()), ...fixture.data].map(row => row.map(quote).join(',')).join('\r\n'), 'utf8')
    if (!write) return invokeCli(fixture, csv)
    const path = join(directory, `packages/data/src/static/${fixture.spec.name}.json`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, fixture.source, 'utf8')
    for (const [source, text] of fixture.sources) writeFileSync(join(directory, source), text, 'utf8')
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/core', 'packages/data'],
      scripts: { 'content:check': write.failValidation ? 'node -e "process.exit(1)"' : 'node --version' },
    }), 'utf8')
    for (const name of ['core', 'data']) {
      mkdirSync(join(directory, `packages/${name}`), { recursive: true })
      writeFileSync(join(directory, `packages/${name}/package.json`), JSON.stringify({ name: `@whale/${name}`, version: '0.0.0', scripts: { typecheck: 'node --version' } }), 'utf8')
    }
    const result = invokeCli(fixture, csv, directory, false)
    const backups = join(directory, 'content-csv/backups')
    const saved = existsSync(backups) ? readdirSync(backups).flatMap(folder => readdirSync(join(backups, folder)).map(file => readFileSync(join(backups, folder, file), 'utf8'))) : []
    return { ...result, written: readFileSync(path, 'utf8'), saved,
      sources: new Map([...fixture.sources.keys()].map(source => [source, readFileSync(join(directory, source), 'utf8')])),
    }
  } finally {
    // 只删除本用例刚创建的临时目录，不触碰工作树中的数据或导出件。
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('旧内容CLI · 真入口与临时目录事务（不写权威数据）', () => {
  it('dry-run显示JSON数字变更，JSON和TS字节不变', () => {
    const fixture = importFixture('ships', ['cargoM3'], { sandcat: { cargoM3: String(ships.SHIPS[0]!.cargoM3 + 1) } })
    const result = runCli(fixture)
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('计划改动 1 处')
    expect(result.output).toContain('--dry-run')
    expect(staticSource('ships')).toBe(fixture.source)
    expect(readFileSync(join(root, sourceFile('ships')), 'utf8')).toBe(fixture.sources.get(sourceFile('ships')))
  }, 40_000)

  it('未知ID整批拒绝，空值和表达式不覆写保持旧CLI语义', () => {
    const unknown = importFixture('ships', ['cargoM3'])
    unknown.data[0]![0] = 'invalid-new-id'
    const rejected = runCli(unknown)
    expect(rejected.status, rejected.output).toBe(1)
    expect(rejected.output).toContain('未写入任何改动')
    const unchanged = runCli(importFixture('market', ['limitedSupplyEveryMs'], { 'min-voidcrystal': { limitedSupplyEveryMs: '-' } }))
    expect(unchanged.status, unchanged.output).toBe(0)
    expect(unchanged.output).toContain('表达式')
    expect(unchanged.output).toContain('无差异')
  }, 60_000)

  it('xlsx加载与旧表头别名仍可修改JSON价格字段', async () => {
    const fixture = importFixture('items', ['baseSellPriceIsk'], {
      'ore-veldspar': { baseSellPriceIsk: String(items.ITEMS.find(item => item.id === 'ore-veldspar')!.baseSellPriceIsk! + 1) },
    })
    const directory = mkdtempSync(join(tmpdir(), 'whale-static-xlsx-'))
    try {
      const path = join(directory, 'data.xlsx')
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('items')
      sheet.addRow([...fixture.headIdx.keys()].map(head => head === '空间站收购价信用点' ? '空间站收购价ISK' : head))
      sheet.addRows(fixture.data)
      await workbook.xlsx.writeFile(path)
      const result = invokeCli(fixture, path)
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain('旧表头')
      expect(result.output).toContain('计划改动 1 处')
      expect(staticSource('items')).toBe(fixture.source)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 40_000)

  it.each([false, true])('临时目录真回写：校验失败=%s，备份原文且不改TS，失败时恢复', failValidation => {
    const fixture = importFixture('ships', ['cargoM3'], { sandcat: { cargoM3: String(ships.SHIPS[0]!.cargoM3 + 1) } })
    const result = runCli(fixture, { failValidation })
    expect(result.status, result.output).toBe(failValidation ? 1 : 0)
    expect('saved' in result && result.saved).toEqual([fixture.source])
    expect('sources' in result && result.sources).toEqual(fixture.sources)
    expect('written' in result && result.written).toBe(failValidation ? fixture.source : applyStaticChanges(fixture.source, fixture.plan().changes))
    if (failValidation) expect(result.output).toContain('本次JSON写入已恢复')
    expect(staticSource('ships')).toBe(fixture.source)
  }, 40_000)
})
