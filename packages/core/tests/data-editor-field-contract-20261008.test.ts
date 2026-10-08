import { describe, expect, it } from 'vitest'
import fields from '../../data/src/staticFieldTypes.json'
import market from '../../data/src/static/market.json'
import { staticDocumentIssues } from '../../data/src/staticData'
import { planDocuments, validateDocument } from '../../../tools/data-editor-schema'
import type { DataDocument, DataTable } from '../../../tools/data-editor-contract'

describe('独立编辑器项目字段契约', () => {
  it('最新市场允许出售及黑市字段可读，错误类型和未知字段仍拒绝', () => {
    expect(validateDocument(market, 'market')).toEqual([])
    const doc = structuredClone(market) as DataDocument
    const row = Object.values(doc.groups)[0]![0]!
    row.playerSellable = true
    row.blackMarketBuyable = false
    expect(validateDocument(doc, 'market', fields)).toEqual([])
    row.blackMarketBuyable = 1
    expect(validateDocument(doc, 'market', fields).some(issue => issue.message.includes('类型'))).toBe(true)
    row.blackMarketBuyable = false
    row.unknownTradeFlag = true
    expect(staticDocumentIssues(doc, fields).some(issue => issue.includes('字段不存在'))).toBe(true)
  })

  it('契约显式传入而不污染默认校验或另一项目，计划校验使用同一份契约', () => {
    const current = structuredClone(fields)
    const legacy = structuredClone(fields)
    const { blackMarketBuyable: _removed, ...legacyMarket } = legacy.market
    legacy.market = legacyMarket as typeof legacy.market
    const doc: DataDocument = { format: 'whale-static-data', version: 1, table: 'market',
      groups: { test: [{ key: 'fixture', kind: 'item', refId: 'fixture', rarity: 'common', basePrice: 100, blackMarketBuyable: true }] } }
    expect(validateDocument(doc, 'market', current)).toEqual([])
    expect(validateDocument(doc, 'market', legacy).length).toBeGreaterThan(0)
    expect(validateDocument(doc, 'market')).toEqual([])
    const documents = { market: doc } as Record<DataTable, DataDocument>
    expect(planDocuments(documents, [], current).issues).toEqual([])
    expect(planDocuments(documents, [], legacy).issues.length).toBeGreaterThan(0)
    expect(doc.groups.test![0]!.blackMarketBuyable).toBe(true)
  })
})
