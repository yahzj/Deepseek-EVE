import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  buildSimContext, EN_ANOMALIES, EN_ITEMS, EN_MATTER_TECH_NOTES, EN_MODULES, EN_SHIPS, EN_SKILLS,
  ITEMS, MATTER_TECH_NODES, SHIPS, SKILLS,
} from '@whale/data'
import { L10N } from '../../data/src/l10n/table'
import { signalSpaceTextId, SIGNAL_SPACE_TEXT_IDS } from '../src/explorationText'
import { resolveFoeMounts } from '../src/foeMounts'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createInitialState } from '../src/state'
import { wormholeScanBonusOf } from '../src/wormhole'
import { wormholeExpeditionCard } from '../src/wormholeExpeditionFoes'
import {
  migratedWreckItemId, wreckGroupOfItemId, WRECK_FAMILY_NAMES, WRECK_GROUPS, WRECK_REGION_LABELS, WRECK_YIELD_TIER_MUL,
} from '../src/wreckGroups'

// 船长指定旧玩法来源；只读固定提交，不读取主树或物化另一份工作区。
const SOURCE_COMMIT = 'c5f8be8346e2bde9b1e738e7ddbfd5ca4740d519'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const modules = new Map<string, Record<string, unknown>>()

function baselineModule(path: string): Record<string, unknown> {
  const cached = modules.get(path)
  if (cached) return cached
  const source = execFileSync('git', ['show', `${SOURCE_COMMIT}:${path}`], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  })
  const exports: Record<string, unknown> = {}
  modules.set(path, exports)
  const code = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === '@whale/core') {
        return { ...baselineModule('packages/core/src/wreckGroups.ts'), resolveFoeMounts }
      }
      if (id.startsWith('.')) return baselineModule(posix.join(posix.dirname(path), `${id}.ts`))
      throw new Error(`基线读取出现未登记依赖：${path} -> ${id}`)
    },
  }, { filename: path, timeout: 1000 })
  return exports
}

const baseSkills = baselineModule('packages/data/src/skills.ts').SKILLS as typeof SKILLS
const baseShips = baselineModule('packages/data/src/ships.ts').SHIPS as typeof SHIPS
const baseTech = baselineModule('packages/data/src/matterTech.ts').MATTER_TECH_NODES as typeof MATTER_TECH_NODES
const baseWrecks = baselineModule('packages/core/src/wreckGroups.ts').WRECK_GROUPS as typeof WRECK_GROUPS
const baseItems = baselineModule('packages/data/src/items.ts').ITEMS as typeof ITEMS
const baseEn = baselineModule('packages/data/src/l10n.ts') as typeof import('../../data/src/l10n')
const zh = buildSimContext('zh')
const en = buildSimContext('en')
const skillIds = ['signal-analysis', 'cartography', 'signal-filtering', 'galactic-happenings', 'event-dividend', 'chart-archive']
const shipIds = ['sh-nautilus', 'sh-wh-a-frigate', 'sh-wh-d-frigate', 'sh-wh-g-frigate']
const highlights = (text: string) => text.match(/⟦[^⟧]*⟧/g) ?? []
const numbers = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? []

function without(row: object, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)))
}

function sameData(
  current: readonly { id: string }[], original: readonly { id: string }[], textFields: readonly string[],
): void {
  expect(current.map((row) => row.id)).toEqual(original.map((row) => row.id))
  const byId = new Map(original.map((row) => [row.id, row]))
  for (const row of current) expect(without(row, textFields), row.id).toEqual(without(byId.get(row.id)!, textFields))
}

describe('信号空间内容 · 固定来源与纯文案边界', () => {
  it('英文覆盖层所有已映射说明都物化新ID，不再裸读旧ID或依赖运行时改名', () => {
    const path = new URL('../../data/src/l10n.ts', import.meta.url)
    const ast = ts.createSourceFile('l10n.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const oldIds: string[] = []
    const mappedIds: string[] = []
    const targets = new Set(Object.values(SIGNAL_SPACE_TEXT_IDS))
    const visit = (node: ts.Node): void => {
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'L10N') {
        const id = node.argumentExpression
        expect(ts.isStringLiteral(id), node.getText(ast)).toBe(true)
        if (ts.isStringLiteral(id)) {
          if (SIGNAL_SPACE_TEXT_IDS[id.text]) oldIds.push(id.text)
          if (targets.has(id.text)) {
            mappedIds.push(id.text)
            expect(L10N[id.text], id.text).toBeDefined()
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(oldIds).toEqual([])
    expect(mappedIds).toHaveLength(33)
  })

  it('技能仅六条说明改词：名称、档位、前置、训练时间与中英高亮数字都与来源一致', () => {
    sameData(SKILLS, baseSkills, ['description'])
    expect(SKILLS.filter((row, i) => row.description !== baseSkills[i]!.description).map((row) => row.id)).toEqual(skillIds)
    for (const row of SKILLS) {
      const original = baseSkills.find((before) => before.id === row.id)!
      expect(highlights(row.description), row.id).toEqual(highlights(original.description))
      expect(numbers(row.description), row.id).toEqual(numbers(original.description))
      expect(EN_SKILLS[row.id]!.name, row.id).toBe(baseEn.EN_SKILLS[row.id]!.name)
      expect(highlights(EN_SKILLS[row.id]!.description!), row.id).toEqual(highlights(baseEn.EN_SKILLS[row.id]!.description!))
    }
    for (const id of skillIds) {
      expect(zh.skills.get(id)!.description).toContain('信号空间')
      expect(en.skills.get(id)!.description).toContain('Signal Space')
      expect(zh.skills.get(id)!.description).not.toMatch(/虫洞|洞里/)
    }
  })

  it('四艘扫描舰只改说明：全部舰船数据与来源一致，半径仍按编队相加', () => {
    sameData(SHIPS, baseShips, ['description'])
    expect(SHIPS.filter((row, i) => row.description !== baseShips[i]!.description).map((row) => row.id)).toEqual(shipIds)
    for (const id of shipIds) {
      expect(zh.ships.get(id)!.wormholeScanRadiusBonus).toBe(1)
      expect(zh.ships.get(id)!.description).toContain('空间内扫描范围一圈')
      expect(en.ships.get(id)!.description).toContain('scan range inside the space by one ring')
      expect(EN_SHIPS[id]!.name).toBe(baseEn.EN_SHIPS[id]!.name)
    }
    expect(wormholeScanBonusOf(zh, shipIds)).toBe(4)
    expect(wormholeScanBonusOf(en, shipIds)).toBe(4)
  })

  it('谜质科技全部标识、效果、费用与前置不变，共享说明不伪限定为旧玩法', () => {
    sameData(MATTER_TECH_NODES, baseTech, ['note'])
    for (const node of MATTER_TECH_NODES) {
      const before = baseTech.find((row) => row.id === node.id)!
      expect(numbers(node.note), node.id).toEqual(numbers(before.note))
      expect(numbers(EN_MATTER_TECH_NOTES[node.id]!), node.id).toEqual(numbers(baseEn.EN_MATTER_TECH_NOTES[node.id]!))
      expect(node.note, node.id).not.toMatch(/虫洞|洞内/)
      expect(EN_MATTER_TECH_NOTES[node.id]!, node.id).not.toMatch(/wormhole/i)
      if (node.id === 'mt-explore-scan') {
        expect(node.note).toContain('扫描信号空间')
        expect(EN_MATTER_TECH_NOTES[node.id]).toContain('Scan for Signal Spaces')
      } else {
        expect(node.note, node.id).not.toContain('信号空间')
        expect(EN_MATTER_TECH_NOTES[node.id]!, node.id).not.toContain('Signal Space')
      }
    }
  })

  it('五族残骸只改地区显示：组标识、枚举、成员、池、档位、威胁和数量乘数不变', () => {
    expect(WRECK_GROUPS.map((row) => without(row, ['name', 'rareName', 'note'])))
      .toEqual(baseWrecks.map((row) => without(row, ['name', 'rareName', 'note'])))
    const baseWreckModule = baselineModule('packages/core/src/wreckGroups.ts')
    expect(WRECK_FAMILY_NAMES).toEqual(baseWreckModule.WRECK_FAMILY_NAMES)
    expect(WRECK_YIELD_TIER_MUL).toEqual(baseWreckModule.WRECK_YIELD_TIER_MUL)
    expect(WRECK_REGION_LABELS).toEqual({ ...(baseWreckModule.WRECK_REGION_LABELS as object), wh: '信号空间' })
    expect(WRECK_GROUPS.filter((row) => row.region === 'wh')).toHaveLength(5)
    for (const row of WRECK_GROUPS) {
      const before = baseWrecks.find((group) => group.key === row.key)!
      for (const field of ['name', 'rareName', 'note'] as const) {
        expect(row[field], `${row.key}/${field}`).toBe(row.region === 'wh' ? before[field].replace('虫洞', '信号空间') : before[field])
      }
      if (row.region !== 'wh') continue
      for (const id of [`wreck-${row.key}`, `wreck-rare-${row.key}`]) {
        expect(zh.items.get(id)!.name).toContain('（信号空间）')
        expect(en.items.get(id)!.name).toContain('(Signal Space)')
        expect(en.items.get(id)!.description).toContain('(Signal Space)')
        expect(without(en.items.get(id)!, ['name', 'description'])).toEqual(without(zh.items.get(id)!, ['name', 'description']))
      }
      for (const member of row.members) {
        expect(wreckGroupOfItemId(`wreck-${member}`)!.key).toBe(row.key)
        expect(migratedWreckItemId(`wreck-rare-${member}`)).toBe(`wreck-rare-${row.key}`)
      }
    }
  })

  it('旧资产数值与配方不变；模块及谜质装置说明取新ID，历史正文仍可读取', () => {
    const addedAmmo = new Set(['ammo-kinetic-3', 'ammo-explosive-3', 'ammo-plasma-3'])
    expect(ITEMS.filter(item => addedAmmo.has(item.id)).map(item => item.id).sort()).toEqual([...addedAmmo].sort())
    sameData(ITEMS.filter(item => !addedAmmo.has(item.id)), baseItems, ['name', 'description'])
    expect(EN_ITEMS['mat-wh-essence']!.name).toBe('Signal Enigma')
    for (const [id, text] of Object.entries(EN_ITEMS)) {
      if (addedAmmo.has(id)) continue
      expect(text.name, id).toBe(id === 'mat-wh-essence' ? 'Signal Enigma' : baseEn.EN_ITEMS[id]!.name)
    }
    for (const [id, text] of Object.entries(EN_MODULES)) expect(text.name, id).toBe(baseEn.EN_MODULES[id]!.name)
    for (const id of ['mod.copy.001', 'mod.copy.002', 'mod.copy.044', 'item.copy.008']) {
      expect(L10N[id]!.en).toMatch(/wormhole/i)
      expect(L10N[signalSpaceTextId(id)]!.en).toContain('Signal Space')
      expect(signalSpaceTextId(id, 2)).toBe(id)
    }
    expect(EN_MODULES['mod-miner-1']!.description).toBe(L10N[signalSpaceTextId('mod.copy.001')]!.en)
    expect(EN_MODULES['mod-salvager-1']!.description).toBe(L10N[signalSpaceTextId('mod.copy.044')]!.en)
    for (const item of ITEMS.filter((row) => row.id.startsWith('mat-') && row.id !== 'mat-wh-essence')) {
      expect(EN_ITEMS[item.id]!.description, item.id).toContain('Signal Enigma')
      expect(EN_ITEMS[item.id]!.description, item.id).not.toContain('Wormhole Enigma')
    }
  })

  it('新虫洞克隆的敌卡说明不冒充旧来源，十五张敌卡名称不改', () => {
    const ids = Object.keys(EN_ANOMALIES).filter((id) => id.startsWith('wh-'))
    expect(ids).toHaveLength(15)
    for (const id of ids) {
      expect(EN_ANOMALIES[id]!.name).toBe(baseEn.EN_ANOMALIES[id]!.name)
      expect(EN_ANOMALIES[id]!.description).toContain('Encounter inside the space')
      expect(EN_ANOMALIES[id]!.description).not.toMatch(/wormhole|Signal Space/i)
    }
    const future = wormholeExpeditionCard(en, 'A', 1, 'ordinary')
    expect(future.description).toBe(EN_ANOMALIES['wh-pirate-scout']!.description)
  })

  it('改名前库存与舰载货保存往返不丢：谜质、五族普通/稀有残骸及旧每卡ID都可读', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    const cargo = state.fleet[state.shipId]!.cargo
    const legacy: Record<string, number> = { 'mat-wh-essence': 7 }
    for (const item of ITEMS.filter((row) => row.id.startsWith('mat-') && row.id !== 'mat-wh-essence')) legacy[item.id] = 2
    for (const row of WRECK_GROUPS.filter((group) => group.region === 'wh')) {
      legacy[`wreck-${row.key}`] = 100
      legacy[`wreck-rare-${row.key}`] = 30
      legacy[`wreck-${row.members[0]}`] = 20
      legacy[`wreck-rare-${row.members[0]}`] = 30
    }
    Object.assign(state.warehouse.items, legacy)
    Object.assign(cargo, legacy)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    for (const [id, units] of Object.entries(legacy)) {
      expect(loaded.warehouse.items[id], id).toBe(units)
      expect(loaded.fleet[loaded.shipId]!.cargo[id], id).toBe(units)
      if (id.startsWith('wreck-')) expect(wreckGroupOfItemId(id), id).not.toBeNull()
      else expect(zh.items.has(id) && en.items.has(id), id).toBe(true)
    }
  })

  it('v27每卡残骸仍迁移到同一组并合并数量，谜质装置与析出物不换标识', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    const cargo = state.fleet[state.shipId]!.cargo
    const legacy: Record<string, number> = { 'mat-wh-essence': 7, 'mat-surveyor': 2 }
    for (const row of WRECK_GROUPS.filter((group) => group.region === 'wh')) {
      row.members.forEach((id, i) => {
        legacy[`wreck-${id}`] = (i + 1) * 10
        legacy[`wreck-rare-${id}`] = 30
      })
    }
    Object.assign(state.warehouse.items, legacy)
    Object.assign(cargo, legacy)
    const file = JSON.parse(serializeSaveFile(state, 0))
    file.version = 27
    file.state.version = 27
    const loaded = loadSaveFile(JSON.stringify(file)).state
    for (const pocket of [loaded.warehouse.items, loaded.fleet[loaded.shipId]!.cargo]) {
      expect(pocket['mat-wh-essence']).toBe(7)
      expect(pocket['mat-surveyor']).toBe(2)
      for (const row of WRECK_GROUPS.filter((group) => group.region === 'wh')) {
        expect(pocket[`wreck-${row.key}`], row.key).toBe(60)
        expect(pocket[`wreck-rare-${row.key}`], row.key).toBe(90)
        for (const member of row.members) {
          expect(pocket[`wreck-${member}`]).toBeUndefined()
          expect(pocket[`wreck-rare-${member}`]).toBeUndefined()
        }
      }
    }
  })
})
