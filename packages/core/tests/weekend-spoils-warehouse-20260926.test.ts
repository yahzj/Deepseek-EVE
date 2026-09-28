/**
 * **入侵战利品落点与账实一致**（2026-09-26 船长批「甲」· 起因＝船长报障
 * 「有玩家反应，其没有拿到黑匣，但是报告中显示有获取黑匣」）。
 *
 * 病根两条（都在本文件里钉住）：
 * ① **落点走偏**：旗舰黑匣/稀有残骸原走 `addItem` ⇒ 进**当时驾驶船的货舱**，而「物品」页只列仓库
 *    （`ItemsPage` 只读 `state.warehouse.items`）⇒ 玩家在物品页永远看不到；货舱又只在"远征返航进港"
 *    那一刻才自动卸货 ⇒ 返航途中换船/损船就再也回不来。设计稿 Q4 的口径一直是「**黑匣入库**」，
 *    同 id 的黑匣从打捞回收那条路也本来就在仓库里（`salvaging.ts` 的 `addWare`）。
 * ② **账实可分离**：`weekendGrantRewards` 原先**无条件**把"已获得"记进台账（不看实物是否真写进去），
 *    而 `addItem` 在"驾驶船不在舰队里"时会**静默丢弃**（`cargoOfShip` 返回临时空对象）。
 *
 * 口径（船长批「甲」）：**战利品一律入物品仓库** · 返回/记账取**实际入账量** ·
 * `addItem` 不再静默丢弃（兜底入仓库）· 「见过黑匣」只在确实入库后置位。
 *
 * **2026-09-28 追加一段**（船长令「按你推荐来」⇒ 甲案）：**到手台账 `rewardLedger` 随档**
 * —— 同一类漏（没进清洗器 ⇒ 读一次档就归零），后果见 `killed()` 后面那两条用例。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { serializeSaveFile, loadSaveFile } from '../src/index'
import { addItem, countItem, countWare } from '../src/inventory'
import { blackboxSeenOf } from '../src/blackbox'
import {
  WEEKEND_FLAGSHIP_WRECK,
  weekendApplyBattleOutcome,
  weekendGrantRewards,
  weekendRareWreckUnits,
  weekendSettleAndGrant,
} from '../src/weekendBattle'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'

/** 造一场 H 族入侵（与 `weekend-wiring` 同形；H 族 = 有共享血池的 BOSS 族） */
function invaded(seed = 21): ReturnType<typeof createInitialState> {
  const s = createInitialState({ nowWallMs: 0, seed })
  s.debugQuick = true
  const ev: WeekendEventState = {
    seq: 9,
    startedAtWallMs: Date.now(),
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return s
}

describe('入侵战利品 · 落点 = 物品仓库（2026-09-26 船长批「甲」）', () => {
  it('① `addItem` 兜底：驾驶船不在舰队里 ⇒ 进物品仓库（原先静默丢弃）', () => {
    const s = invaded()
    const box0 = countWare(s, 'blackbox-h')
    /** 制造"当前驾驶船不在舰队里"的异常档（`cargoOfShip` 的容错分支） */
    s.shipId = 'ship-does-not-exist'
    expect(countItem(s, 'blackbox-h'), '这种档上货舱读数是 0（临时空对象）').toBe(0)
    expect(addItem(s, 'blackbox-h', 1), '不再静默丢弃：兜底入仓库').toBe(true)
    expect(countWare(s, 'blackbox-h') - box0, '黑匣真的到手了（在仓库里）').toBe(1)
    /**
     * 「见过黑匣」= 兑换商店 / 组装机「舰船插件」档的解锁判据 —— 只在**确实入库**后置位。
     * （改前：件被丢弃、标记照置位 ⇒ 玩家没黑匣却已经解锁。）
     */
    expect(blackboxSeenOf(s), '确实入库 ⇒ 照常置位').toBe(true)
  })

  it('② `addItem` 正常路径不变：进当前驾驶船的货舱（采矿/打捞的战利品口径不受影响）', () => {
    const s = invaded()
    const cargo0 = countItem(s, 'wreck-rare-h-hi')
    const ware0 = countWare(s, 'wreck-rare-h-hi')
    expect(addItem(s, 'wreck-rare-h-hi', 30)).toBe(true)
    expect(countItem(s, 'wreck-rare-h-hi') - cargo0, '货舱 +30').toBe(30)
    expect(countWare(s, 'wreck-rare-h-hi'), '仓库不动').toBe(ware0)
  })

  it('③ 台账号 = 实数：掷中却没落地 ⇒ 一律按实际入账记账（`weekendGrantRewards` 返回值）', () => {
    const s = invaded()
    const ware0 = countWare(s, 'wreck-rare-h-hi')
    /** 没给物品 id（契约破损）⇒ 不发、也不许"当作发了" */
    const miss = weekendGrantRewards(s, { wreck: 90, blackBox: true })
    expect(miss.wreck, '残骸实发 0').toBe(0)
    expect(miss.blackBox, '黑匣照发 1').toBe(1)
    expect(countWare(s, 'wreck-rare-h-hi'), '仓库里没有凭空多出的残骸').toBe(ware0)
    expect(countWare(s, 'blackbox-h'), '黑匣确实落进仓库').toBe(1)
  })

  it('④ 击沉旗舰 ⇒ 黑匣与残骸落仓库 · 结算快照（面板/结算信）的件数 = 仓库实数', () => {
    const s = invaded()
    weekendNoteContribution(s.weekendEvent!, GID, 1) // 外围夺回 ⇒ 核心门禁解开
    weekendNoteContribution(s.weekendEvent!, CORE, 1) // 核心条满 ⇒ 旗舰现身
    const wareBox0 = countWare(s, 'blackbox-h')
    const wareWreck0 = countWare(s, 'wreck-rare-h-hi')
    weekendNoteFlagshipDamage(s.weekendEvent!, WEEKEND_FLAGSHIP_POOL_HP, 1001)
    const now = Date.now()
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, now, null, { kind: 'flagship', galaxyId: CORE })
    expect(r?.wreck, '击沉旗舰照发稀有残骸 ×3 件').toBe(weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK))
    /** 活动在击沉那一刻结束 ⇒ 结束结算写快照（结算面板与结算通讯读它） */
    const settled = weekendSettleAndGrant(s, ctx, now)
    expect(settled, '结束结算要跑').not.toBeNull()
    const snap = s.weekendLastResult!
    const boxGot = countWare(s, 'blackbox-h') - wareBox0
    const wreckGot = countWare(s, 'wreck-rare-h-hi') - wareWreck0
    expect(boxGot, '黑匣 ×1 到手（仓库）').toBe(1)
    expect(snap.blackBox, '快照里的黑匣数 = 仓库实数').toBe(boxGot)
    expect(snap.wreck, '快照里的残骸总数 = 仓库实数').toBe(wreckGot)
    expect(s.fleet[s.shipId]?.cargo?.['blackbox-h'] ?? 0, '货舱里没有黑匣（玩家不会去货舱白找）').toBe(0)
  })
})

/**
 * **到手台账随档**（**2026-09-28 船长令「按你推荐来」⇒ 甲案**）。
 *
 * 病根与上面那两条同族：`rewardLedger` **原先没进清洗器**（`save.ts` 里 0 引用）⇒ 读一次档就归零。
 * 它有两个读者，各自出问题：
 * - `weekendSettleAndGrant` 的**迟到补发**（`boxAtSettle` ＝ 台账里没有黑匣 ∧ 掷骰掷中了）**只靠它幂等**
 *   ⇒「击沉 → 发匣（台账记 1）→ 关游戏 → 读档（台账归 0）→ 结算」会**再发一枚**（本组用例钉住）；
 * - 结算面板与结算通讯的奖励清单（"说的与发的逐值一致"）⇒ 读档后清单整片归零。
 */
describe('到手台账随档（2026-09-28 甲案）', () => {
  /** 走到"刚击沉旗舰、活动已结束但**还没结算**"那一刻（＝夹在两次存档之间的状态） */
  function killed(seed = 21): ReturnType<typeof createInitialState> {
    const s = invaded(seed)
    weekendNoteContribution(s.weekendEvent!, GID, 1)
    weekendNoteContribution(s.weekendEvent!, CORE, 1)
    weekendNoteFlagshipDamage(s.weekendEvent!, WEEKEND_FLAGSHIP_POOL_HP, 1001)
    weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, Date.now(), null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    return s
  }

  it('⑤ 台账随档往返：三格与逐星系那本都还在（原先读档即归 0）', () => {
    const s = killed()
    const led = s.weekendEvent!.rewardLedger!
    expect(led.blackBox, '击沉即时发的黑匣已记账').toBe(1)
    expect(led.wreck, '至少含旗舰那 3 件（夺回奖那几笔也在这本账里）').toBeGreaterThanOrEqual(
      weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK),
    )
    const back = loadSaveFile(serializeSaveFile(s)).state
    const led2 = back.weekendEvent!.rewardLedger
    expect(led2, '读回来还在').toBeDefined()
    expect(led2!.isk).toBe(led.isk)
    expect(led2!.wreck).toBe(led.wreck)
    expect(led2!.blackBox).toBe(led.blackBox)
    expect(led2!.byGalaxy, '逐星系那本也随档').toEqual(led.byGalaxy)
  })

  it('⑥ **回归**：读档后再结算，不会再补发第二枚黑匣', () => {
    const s = killed()
    const box0 = countWare(s, 'blackbox-h')
    expect(box0, '击沉即时发 1 枚').toBe(1)
    /** 关游戏 → 重新读档（结算还没跑）——改前这本账在这里归零 ⇒ 结算会按"掷中了却没发"再补一枚 */
    const back = loadSaveFile(serializeSaveFile(s)).state
    expect(countWare(back, 'blackbox-h'), '读档不吞掉已到手的黑匣').toBe(1)
    expect(weekendSettleAndGrant(back, ctx, Date.now()), '这次读档后照常结算').not.toBeNull()
    expect(countWare(back, 'blackbox-h'), '结算不再补发第二枚').toBe(1)
    expect(back.weekendLastResult?.blackBox, '快照里也就是 1 枚').toBe(1)
  })
})
