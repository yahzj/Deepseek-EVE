import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { FOE_LAIR_GEAR } from '../src/lairs'
import { buildSimContext, buildFactionCards, FACTION_CODEX, FACTION_CODEX_ORDER, FOE_SHIPS, factionOfExclusive, MODULES, ITEMS, SHIPS, BLUEPRINTS, SHIP_BLUEPRINTS, type FactionCard } from '@whale/data'

describe('势力图鉴最终展示完整性', () => {
  it.each(['zh', 'en'] as const)('%s七族所有引用按件型可解析且只展示一次，归属一致', locale => {
    const ctx = buildSimContext(locale)
    const before = JSON.stringify({ registry: FACTION_CODEX, lair: FOE_LAIR_GEAR })
    const seen = new Map<string, string>()
    const cards = buildFactionCards(FOE_SHIPS, Object.fromEntries(FOE_SHIPS.map(foe => [foe.id, true as const])))
    expect(cards.map(card => card.family)).toEqual(FACTION_CODEX_ORDER)
    for (const card of cards) {
      expect(card.unlocked).toBe(true)
      for (const id of card.modules) expect(ctx.modules.has(id) || ctx.items.has(id), `${card.family}/${id}`).toBe(true)
      for (const id of card.ships) expect(ctx.ships.has(id), `${card.family}/${id}`).toBe(true)
      for (const id of card.blueprints) expect(ctx.blueprints.has(id) || ctx.shipBlueprints.has(id), `${card.family}/${id}`).toBe(true)
      for (const id of [...card.modules, ...card.ships, ...card.blueprints]) {
        expect(seen.has(id), `${id}:${seen.get(id)}/${card.family}`).toBe(false)
        expect(factionOfExclusive(id), id).toBe(card.family)
        seen.set(id, card.family)
      }
      for (const id of FOE_LAIR_GEAR[card.family]) {
        expect((ctx.blueprints.has(id) ? card.blueprints : card.modules).filter(key => key === id), id).toHaveLength(1)
      }
      for (const bp of ctx.blueprints.values()) {
        if (card.modules.includes(bp.moduleId ?? bp.itemId ?? '')) expect(card.blueprints, bp.id).toContain(bp.id)
      }
      for (const bp of ctx.shipBlueprints.values()) {
        if (card.ships.includes(bp.shipId)) expect(card.blueprints, bp.id).toContain(bp.id)
      }
    }
    expect(JSON.stringify({ registry: FACTION_CODEX, lair: FOE_LAIR_GEAR })).toBe(before)
  })

  it('只补14件装备和1张图纸，原有内容相对顺序不变，H/R及无人机不重复', () => {
    const counts: Record<string, [number, number]> = { A: [3, 0], C: [3, 0], D: [3, 0], E: [3, 0], G: [2, 1], H: [0, 0], R: [0, 0] }
    let modulesAdded = 0, blueprintsAdded = 0
    for (const card of buildFactionCards(FOE_SHIPS, undefined)) {
      const registered = FACTION_CODEX[card.family]!
      expect(card.modules.slice(0, registered.modules.length)).toEqual(registered.modules)
      expect(card.blueprints.slice(0, registered.blueprints.length)).toEqual(registered.blueprints)
      const added = [card.modules.length - registered.modules.length, card.blueprints.length - registered.blueprints.length]
      expect(added, card.family).toEqual(counts[card.family])
      modulesAdded += added[0]!
      blueprintsAdded += added[1]!
    }
    expect([modulesAdded, blueprintsAdded]).toEqual([14, 1])
    const cards = buildFactionCards(FOE_SHIPS, undefined)
    expect(cards.find(card => card.family === 'C')!.modules).toContain('mod-lair-armor-c')
    expect(cards.find(card => card.family === 'G')!.blueprints).toContain('bp-lair-g-drone')
    expect(cards.find(card => card.family === 'G')!.modules).not.toContain('bp-lair-g-drone')
  })

  it('无遭遇不解锁，遇到一型只解锁本族，解锁不受是否持有装备影响', () => {
    expect(buildFactionCards(FOE_SHIPS, undefined).every(card => !card.unlocked && card.seenCount === 0)).toBe(true)
    const foe = FOE_SHIPS.find(foe => foe.family === 'C')!
    const cards = buildFactionCards(FOE_SHIPS, { [foe.id]: true })
    expect(cards.filter(card => card.unlocked).map(card => card.family)).toEqual(['C'])
    const c = cards.find(card => card.family === 'C')!
    expect(c.seenCount).toBe(1)
    for (const id of FOE_LAIR_GEAR.C) expect(c.modules).toContain(id)
  })

  it('窝点权威池新增模块或图纸时展示自动跟随，不改静态登记', () => {
    const before = FOE_LAIR_GEAR.C
    try {
      FOE_LAIR_GEAR.C = [...before, 'mod-lair-test-c', 'bp-lair-test-c', 'sbp-lair-test-c', 'mod-lair-armor-c']
      const card = buildFactionCards(FOE_SHIPS, undefined).find(card => card.family === 'C')!
      expect(card.modules).toContain('mod-lair-test-c')
      expect(card.modules.filter(id => id === 'mod-lair-armor-c')).toHaveLength(1)
      expect(card.blueprints).toContain('bp-lair-test-c')
      expect(card.blueprints).toContain('sbp-lair-test-c')
      expect(card.modules).not.toContain('bp-lair-test-c')
      expect(card.modules).not.toContain('sbp-lair-test-c')
    } finally {
      FOE_LAIR_GEAR.C = before
    }
  })
})

describe('势力图鉴内容护栏能发现展示回归', () => {
  const source = readFileSync(new URL('../../../tools/content-check.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('content-check.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'checkFactionExclusive')!
  const code = ts.transpileModule(`${fn.getText(ast)}\ncheckFactionExclusive()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText

  function issuesWith(change: (cards: FactionCard[]) => void): string[] {
    const issues: string[] = []
    const cards = buildFactionCards(FOE_SHIPS, undefined).map(card => ({ ...card, modules: [...card.modules], ships: [...card.ships], blueprints: [...card.blueprints] }))
    change(cards)
    runInNewContext(code, {
      FACTION_CODEX, FACTION_CODEX_ORDER, FOE_SHIPS, FOE_LAIR_GEAR, MODULES, ITEMS, SHIPS, BLUEPRINTS, SHIP_BLUEPRINTS,
      buildFactionCards: () => cards,
      check: (pass: boolean, message: string) => { if (!pass) issues.push(message) },
      console: { log: () => {} },
    })
    return issues
  }

  it('当前完整清单无错误，生体甲壳板漏展示时直接报红', () => {
    expect(issuesWith(() => {})).toEqual([])
    expect(issuesWith(cards => {
      const c = cards.find(card => card.family === 'C')!
      c.modules = c.modules.filter(id => id !== 'mod-lair-armor-c')
    })).toContain('势力图鉴展示契约：C的窝点专属mod-lair-armor-c未进入对应展示栏')
  })

  it('图纸漏收或错放装备栏均报红，不会被族徽反查掩盖', () => {
    const missing = issuesWith(cards => {
      const g = cards.find(card => card.family === 'G')!
      g.blueprints = g.blueprints.filter(id => id !== 'bp-lair-g-drone')
    })
    expect(missing.some(issue => issue.includes('bp-lair-g-drone'))).toBe(true)
    const wrong = issuesWith(cards => {
      const g = cards.find(card => card.family === 'G')!
      g.blueprints = g.blueprints.filter(id => id !== 'bp-lair-g-drone')
      g.modules = [...g.modules, 'bp-lair-g-drone']
    })
    expect(wrong).toContain('势力图鉴展示契约：G/装备/bp-lair-g-drone 无对应定义或放错栏位')
  })

  it('失效引用和跨势力重复展示均报红', () => {
    const issues = issuesWith(cards => {
      const a = cards.find(card => card.family === 'A')!
      a.modules = [...a.modules, 'mod-missing-test', 'mod-lair-armor-c']
    })
    expect(issues).toContain('势力图鉴展示契约：A/装备/mod-missing-test 无对应定义或放错栏位')
    expect(issues.some(issue => issue.includes('mod-lair-armor-c') && issue.includes('重复展示'))).toBe(true)
  })
})
