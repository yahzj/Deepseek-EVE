/**
 * **每族一件黑匣**（**2026-10-02 船长令「甲」**；起因 = 船长转述玩家报障，原话照抄）：
 *
 * > 「**光环入侵结束给的黑匣还是墨潮的**」
 *
 * ## 真因
 *
 * 发放侧把黑匣 id **写死**成 H 族那一件（`weekendBattle.weekendGrantRewards` 里
 * `addWare(state, WEEKEND_BLACKBOX_ITEM_ID, 1)`，常量 = `blackbox-h`），而入侵有**两族**
 * （`WEEKEND_BOSS_FAMILIES = ['H', 'R']`，R 族「光环科技」2026-10-01 建族）⇒ **R 族打完自家旗舰，
 * 拿到的是墨潮那件**：名字、卖价、料值、图鉴归类全是 H 的（玩家报障现场）。
 * 三条发放入口都写死：击沉那一拍（`weekendApplyBattleOutcome`）· 结算补发
 * （`weekendSettleAndGrant`）· 对账补发（`weekendComms.reconcileWeekendBlackBox`）。
 *
 * ## 修法（按族取 · 唯一取数口）
 *
 * `blackbox.blackBoxItemIdOfFamily(族)` = 约定 `blackbox-<族小写>`（H ⇒ `blackbox-h`，R ⇒ `blackbox-r`），
 * 内容侧每族登记一件（`data/items.ts` 的 `WEEKEND_TROPHIES`）⇒ 三条入口、结算快照
 * （`WeekendResultSnapshot.blackBoxItemId`）与结算信（`weekendRewardLinesOf`）全部同源。
 * 12 张舰船插件图纸照旧只认"任意黑匣"（三件互为替代，`core/manufacturing.ts` 的 `MATERIAL_GROUPS`）。
 *
 * 本文件锁九件事：① 内容侧登记（物品/市场/稀有度/中英）② 取数口与"内容破损回落"③④ **两族各自
 * 端到端击杀**（R ⇒ 光环匣且墨潮匣为 0；H ⇒ 墨潮匣，回归）⑤ 结算补发路 ⑥ 结算信清单与老快照
 * ⑦ 对账补发路 ⑧ 存档往返与手改档白名单 ⑨ 装配侧（R 匣顶料 · 真扣 · 入库即解锁插件门类）
 * ⑩ 文案（12 张图纸说明 + 两条界面文案不再点名墨潮）。
 */
import { describe, expect, it } from 'vitest'
import {
  BLUEPRINTS,
  EN_BLUEPRINTS,
  EN_ITEMS,
  ITEMS,
  L10N,
  RARITY_TIER,
  buildSimContext,
} from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  BLACKBOX_ITEM_IDS,
  PLUG_BLACKBOX_ITEM_ID,
  blackBoxItemIdForFamily,
  blackBoxItemIdOfFamily,
  isBlackboxItem,
  plugCraftLockReasonOf,
  plugCraftUnlockedOf,
} from '../src/blackbox'
import { loadSaveFile, marketGoodOf, serializeSaveFile } from '../src/index'
import { addWare, countWare } from '../src/inventory'
import { materialGroupIdsOf, missingMaterials, startManufacturing } from '../src/manufacturing'
import { WEEKEND_FLAGSHIP_POOL_HP, weekendCoreCandidates, weekendFlagshipView } from '../src/weekendEvent'
import { weekendApplyBattleOutcome, weekendFlagshipSpecOf, weekendSettleAndGrant } from '../src/weekendBattle'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { advanceBattleFor } from '../src/combat'
import { reconcileWeekendBlackBox, weekendRewardLinesOf } from '../src/weekendComms'

const ctx = buildSimContext()
const H = 3_600_000
const T0 = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()
const NOW = T0 + H
const R_MOTHER = 'foe-r-corona-nexus'
const H_MOTHER = 'foe-h-ink-flagship'
/** 真数据里的插件图纸（料单里那一项写的是 `blackbox-h`） */
const BP = 'bp-plug-shield-plate'
/** 池子只剩 400：这一场打掉 400 就击沉（照 `flagship-family-identity-20261002` 的脚手架） */
const LEFT = 400

function world(family: 'H' | 'R', left = LEFT): { s: GameState; core: string } {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  const core = weekendCoreCandidates(s, ctx)[0]!
  s.weekendEvent = {
    seq: 1,
    startedAtWallMs: T0,
    coreId: core,
    peripheryIds: [],
    family,
    contributed: { [core]: 1 },
    flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    flagshipHpDone: WEEKEND_FLAGSHIP_POOL_HP - left,
  }
  return { s, core }
}

/** 摆一份"上一场战果"快照（面板与结算信读它） */
function snapshotOf(s: GameState, blackBox: number, blackBoxItemId?: string): void {
  s.weekendLastResult = {
    seq: 1,
    family: 'R',
    coreId: s.weekendEvent!.coreId,
    endedAtWallMs: NOW,
    flagshipOutcome: 'player',
    share: 1,
    tier: 'A',
    galaxies: [],
    isk: 0,
    wreck: 0,
    blackBox,
    ...(blackBoxItemId !== undefined ? { blackBoxItemId } : {}),
  }
}

/**
 * **真战斗打到"这一场把池子打空"**（走真引擎那条路：开旗舰战 → 推进到母舰在场 → 扣掉最后那点血
 * → `weekendApplyBattleOutcome` 结算）——返回这一局，供断言"发的是哪一件匣"。
 */
function killFlagship(family: 'H' | 'R'): GameState {
  const { s, core } = world(family)
  expect(weekendFlagshipView(s, s.weekendEvent!, NOW, NOW).shown, '开打前旗舰在场（池子还剩 400）').toBe(true)
  const spec = weekendFlagshipSpecOf(s, ctx, NOW)!
  const battle = weekendStartFlagshipBattle(s, ctx, NOW, [s.shipId])!
  ;(battle as unknown as { waveIdx: number }).waveIdx = 3
  s.gameMs = battle.startedAtGameMs
  advanceBattleFor(s, ctx, battle, s.shipId, spec.cardId)
  const mother = family === 'R' ? R_MOTHER : H_MOTHER
  const u = Object.values(battle.units).find(
    (x) => x.side === 'foe' && (x as { foeShipId?: string }).foeShipId === mother,
  )
  expect(u, `${family} 族母舰在第 4 波压轴`).toBeTruthy()
  /** 扣掉最后那点血（台账量的是"单位 hpMax − hp" ⇒ 与真实开火同一条量法） */
  u!.hp = { ...u!.hp, h: 0 }
  weekendApplyBattleOutcome(s, ctx, spec.cardId, true, NOW, battle, { galaxyId: core, kind: 'flagship' })
  return s
}

describe('① 内容侧：每族登记一件黑匣（R 族「光环旗舰黑匣」）', () => {
  it('物品登记：`blackbox-r` 与墨潮那件同构（kind / 体积 / 卖价）', () => {
    const r = ITEMS.find((i) => i.id === 'blackbox-r')!
    const h = ITEMS.find((i) => i.id === 'blackbox-h')!
    expect(r, '`blackbox-r` 已登记').toBeTruthy()
    expect(r.name).toBe('光环旗舰黑匣')
    expect(r.kind).toBe('blackbox')
    expect(r.unitM3).toBe(h.unitM3)
    expect(r.baseSellPriceIsk, '与墨潮那件同价（8,000 万）').toBe(h.baseSellPriceIsk)
    expect(isBlackboxItem('blackbox-r'), 'core 单点按 id 前缀认它').toBe(true)
    expect(BLACKBOX_ITEM_IDS, '三件都在名单里（族匣 ×2 ＋ 通用）').toEqual([
      PLUG_BLACKBOX_ITEM_ID,
      'blackbox-r',
      'blackbox-universal',
    ])
  })

  it('市场行 / 稀有度 / 中英覆盖齐备（只收不卖 · 奇货档 80,000,000）', () => {
    const g = marketGoodOf(ctx, 'item', 'blackbox-r')!
    expect(g).toBeTruthy()
    expect(g.rarity).toBe('exotic')
    expect(g.playerBuyable).toBe(false)
    expect(g.basePrice).toBe(80_000_000)
    expect(RARITY_TIER['blackbox-r'], '与墨潮那件同档（奇货层 4）').toBe(4)
    expect(EN_ITEMS['blackbox-r']?.name).toBe('Corona Flagship Black Box')
    expect(EN_ITEMS['blackbox-r']?.description, '英文说明非空').toBeTruthy()
  })
})

describe('② 取数口：族 → 匣 id（唯一）＋ 内容破损时的回落', () => {
  it('`blackBoxItemIdOfFamily` 按 `blackbox-<族小写>` 取；两族各一件', () => {
    expect(blackBoxItemIdOfFamily('H')).toBe('blackbox-h')
    expect(blackBoxItemIdOfFamily('R')).toBe('blackbox-r')
  })

  it('内容破损（该族匣不在表里）⇒ 退回落款墨潮匣，绝不让这一枚发不出去', () => {
    expect(blackBoxItemIdForFamily('R', (id) => ctx.items.has(id)), '正常 ⇒ 光环匣').toBe('blackbox-r')
    expect(blackBoxItemIdForFamily('R', () => false), '表里没有 ⇒ 落款').toBe(PLUG_BLACKBOX_ITEM_ID)
    expect(blackBoxItemIdForFamily('R'), '不给探针 ⇒ 不探（按约定取）').toBe('blackbox-r')
  })
})

describe('③④ 端到端：击杀旗舰发的是"这一族那件"', () => {
  it('③ R 族（光环）：**入的是 `blackbox-r`，`blackbox-h` 一枚都没有**（报障现场）', () => {
    const s = killFlagship('R')
    expect(countWare(s, 'blackbox-r'), '光环旗舰黑匣 ×1').toBe(1)
    expect(countWare(s, 'blackbox-h'), '**改前这里 = 1（就是玩家报障的那一枚）**').toBe(0)
    expect(s.weekendEvent!.endedAtWallMs, '击杀 ⇒ 本期封盘').toBe(NOW)
    console.log(
      `  [读数] R 族击杀：blackbox-r=${countWare(s, 'blackbox-r')} · blackbox-h=${countWare(s, 'blackbox-h')}`,
    )
  })

  it('④ H 族（墨潮）：照旧发 `blackbox-h`（回归，不被这次改动带偏）', () => {
    const s = killFlagship('H')
    expect(countWare(s, 'blackbox-h'), '墨潮旗舰黑匣 ×1').toBe(1)
    expect(countWare(s, 'blackbox-r'), '光环匣一枚都没有').toBe(0)
  })

  it('③之补 幂等：击沉那一拍已结清 ⇒ 随后的结算**不会补第二枚**', () => {
    const s = killFlagship('R')
    weekendSettleAndGrant(s, ctx, NOW)
    expect(countWare(s, 'blackbox-r'), '还是 1 枚').toBe(1)
    expect(countWare(s, 'blackbox-h'), '也没有混进墨潮匣').toBe(0)
  })
})

describe('⑤⑥ 结算补发与结算信：快照记的是"真发的那一件"', () => {
  it('⑤ 结算补发路：R 场"击杀了却没结清" ⇒ 补的是光环匣，且快照记下 id', () => {
    const { s } = world('R')
    const ev = s.weekendEvent!
    ev.flagshipHpDone = 10
    ev.flagshipDown = 'player'
    ev.endedAtWallMs = NOW
    expect(weekendSettleAndGrant(s, ctx, NOW)).not.toBeNull()
    expect(countWare(s, 'blackbox-r'), '补 1 枚光环匣').toBe(1)
    expect(countWare(s, 'blackbox-h'), '不是墨潮匣').toBe(0)
    expect(s.weekendLastResult?.blackBoxItemId, '快照记下是哪一件').toBe('blackbox-r')
  })

  it('⑥ 结算信/面板清单：报的是光环匣（点物品名走真实物品表）', () => {
    const { s } = world('R')
    snapshotOf(s, 1, 'blackbox-r')
    expect(weekendRewardLinesOf(s.weekendLastResult!)).toEqual([{ itemId: 'blackbox-r', qty: 1 }])
    expect(ctx.items.get('blackbox-r')!.name, '信里点出来的名字').toBe('光环旗舰黑匣')
  })

  it('⑥之补 老快照（本批之前结束的场次）⇒ 按落款墨潮匣报，不回改历史读数', () => {
    const { s } = world('R')
    snapshotOf(s, 1)
    expect(weekendRewardLinesOf(s.weekendLastResult!)).toEqual([{ itemId: 'blackbox-h', qty: 1 }])
  })
})

describe('⑦ 对账补发：按本场族补', () => {
  it('R 场"有留档 · 没结清" ⇒ 补光环匣，并把快照那一栏一起写上', () => {
    const { s } = world('R')
    const ev = s.weekendEvent!
    ev.flagshipDown = 'player'
    ev.endedAtWallMs = NOW
    snapshotOf(s, 0)
    expect(reconcileWeekendBlackBox(s), '该补').toBe(true)
    expect(countWare(s, 'blackbox-r'), '补的是光环匣').toBe(1)
    expect(s.weekendLastResult!.blackBox, '面板那一栏 +1').toBe(1)
    expect(s.weekendLastResult!.blackBoxItemId, '面板也知道是哪一件').toBe('blackbox-r')
    expect(reconcileWeekendBlackBox(s), '第二次 ⇒ 不再补').toBe(false)
  })

  it('⑦之补 占位族那套老口径（A/C/G）**没有**自己的匣 ⇒ 按落款墨潮匣发，不会"永远补不出去"', () => {
    const { s } = world('R')
    const ev = s.weekendEvent!
    ;(ev as unknown as { family: string }).family = 'A'
    ev.flagshipDown = 'player'
    ev.endedAtWallMs = NOW
    snapshotOf(s, 0)
    expect(reconcileWeekendBlackBox(s), '该补').toBe(true)
    expect(countWare(s, 'blackbox-h'), '落款墨潮匣（与本批改动之前逐字一致）').toBe(1)
    expect(countWare(s, 'blackbox-r')).toBe(0)
  })
})

describe('⑧ 存档：`blackBoxItemId` 随档往返 · 手改档白名单', () => {
  it('随档往返（面板与信件读它）', () => {
    const { s } = world('R')
    snapshotOf(s, 1, 'blackbox-r')
    const back = loadSaveFile(serializeSaveFile(s)).state
    expect(back.weekendLastResult?.blackBoxItemId).toBe('blackbox-r')
  })

  it('手改档塞进来的非黑匣 id ⇒ 丢弃（面板不会把原文当物品名印出来）', () => {
    const { s } = world('R')
    snapshotOf(s, 1, 'blackbox-r')
    const raw = JSON.parse(serializeSaveFile(s)) as {
      state: { weekendLastResult: { blackBoxItemId?: unknown } }
    }
    raw.state.weekendLastResult.blackBoxItemId = 'min-voidcrystal'
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.weekendLastResult?.blackBoxItemId, '判据 = isBlackboxItem（按 id 前缀）').toBeUndefined()
  })
})

describe('⑨ 装配侧：光环匣同样顶料 · 同样解锁插件门类', () => {
  it('三件互为替代（等价组），R 匣能顶 12 张插件图纸那项料', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
    s.debugQuick = true
    s.learnedRecipes.push(BP)
    const bp = ctx.blueprints.get(BP)!
    for (const m of bp.materials) {
      if (m.itemId === 'blackbox-h') continue
      addWare(s, m.itemId, m.count * 2)
    }
    const spec = { materials: bp.materials, buildSeconds: bp.buildSeconds, buildCostIsk: bp.buildCostIsk }
    expect(missingMaterials(s, ctx, spec).length, '没黑匣 ⇒ 缺料').toBeGreaterThan(0)
    addWare(s, 'blackbox-r', 1)
    expect(missingMaterials(s, ctx, spec), '给一枚光环匣 ⇒ 不缺料').toEqual([])
    expect(materialGroupIdsOf('blackbox-h'), '同一等价组（组序仍是通用最先）').toContain('blackbox-r')
    const start = startManufacturing(s, BP, 'pilot', ctx)
    expect(start.ok, `开工成功（错误：${start.ok ? '' : start.error}）`).toBe(true)
    expect(countWare(s, 'blackbox-r'), '真扣掉那一枚光环匣').toBe(0)
  })

  it('光环匣入库即解锁"舰船插件"门类；锁着时的拒因文案已泛化', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
    s.blackboxSeen = false
    expect(plugCraftUnlockedOf(s), '没黑匣 ⇒ 锁着').toBe(false)
    expect(plugCraftLockReasonOf(s)?.textId, 'textId 指向真界面读的那条（090 是精炼炉的"本炉料余"）').toBe(
      'ui.IndustryPage.116',
    )
    addWare(s, 'blackbox-r', 1)
    expect(plugCraftUnlockedOf(s), '光环匣同样解锁（按 id 前缀置位）').toBe(true)
    expect(plugCraftLockReasonOf(s), '解锁后没有拒因').toBeNull()
  })
})

describe('⑩ 文案：黑匣不再是"墨潮专属"', () => {
  it('12 张插件图纸说明 = 「须先取得任意黑匣」（中英同步）', () => {
    const plugs = BLUEPRINTS.filter((b) => b.id.startsWith('bp-plug-'))
    expect(plugs.length, '12 张').toBe(12)
    for (const bp of plugs) {
      expect(bp.description, `${bp.id} 中文说明`).toContain('须先取得任意黑匣')
      expect(bp.description.includes('墨潮'), `${bp.id} 不再点名墨潮`).toBe(false)
      expect(EN_BLUEPRINTS[bp.id]?.description, `${bp.id} 英文说明`).toContain('any black box')
    }
  })

  it('界面文案：解锁提示与"通用黑匣顶料"那句都已泛化（中英）', () => {
    expect(L10N['ui.IndustryPage.116']!.zh).toBe('取得第一个黑匣后解锁')
    expect(L10N['ui.IndustryPage.116']!.en).toBe('Unlocks after you obtain your first black box')
    expect(L10N['ui.IndustryPage.142']!.zh, '不再只说与墨潮那件互为替代').toContain('各族的旗舰黑匣')
    expect(L10N['ui.IndustryPage.142']!.en).toContain('any flagship black box')
  })
})
