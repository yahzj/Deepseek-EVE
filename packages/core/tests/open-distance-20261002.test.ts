/**
 * **开场距离 = 开战距离公式，与 R 族族格 / 期望距离 / 按星系记忆无关**
 * （**船长 2026-10-03 报障**：「**开场双方距离的规则已经很明确了，现在的情况是BUG**」）。
 *
 * 规则出处 = `docs/design/desire-band-20260915.md`（船长 2026-09-15 裁定）：
 * ① 开场距离 = `battleOpenM` = 双方所有武器最远射程 ×1.0 ＋ 缓冲 `max(100m, 10%)`；
 * ② 期望距离只决定**稳态**；③ 该文档 §二「**明确不动的**」清单第一条就是**开战距离公式**。
 *
 * 旧 bug（两条，都在 `combat.ts` 的开战处，单船与编队两条路径各一份）：
 * - `battle.distanceM = rDesire ?? openM` ⇒ R 族场次**用族格值当开场距离** ⇒ 一开场就贴脸
 *   （船长实测：回音荒区 **512 m**）；
 * - `battle.myDesireM = rDesire` ⇒ 用**敌人**的偏好改写**我方**期望距离，与船长原话
 *   「**这个机制是给敌人用的……并不是玩家使用的**」直接冲突。
 *
 * ⚠ 之前**没有任何用例守着这两条**（改完 3012 条全绿、零用例变红）—— 本文件就是补这个洞。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, startFleetBattleFor } from '../src/index'

const ctx = buildSimContext()
/** R 族（光环）入侵卡之一 —— 族格生效的场次 */
const R_CARD = 'corona-drift'
/** 非 R 族对照（既有各族应零行为变化） */
const PLAIN_CARD = 'ano-pirate-post'
/** 开战参数（与既有 R 族用例同款：单节点、单波） */
const OPEN_OPTS = { depth: 4, kind: 'node' as const, waves: 1 }

function openBattle(cardId: string, desireM: number): { distanceM: number; myDesireM: number } {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  const ids: string[] = [addShipToFleet(s, 'sh-thresher')]
  s.shipId = ids[0]!
  s.fleet[ids[0]!]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
  /** ⚠ 件必须在库里才算装上（少了这一行 ⇒ 回落基础舰炮、`openM` 会按 4,770 算 —— 第一版夹具就踩了这个） */
  s.moduleBay['mod-laser-3'] = 1
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) s.warehouse.items[a] = 9_000
  const b = startFleetBattleFor(s, ctx, ids, cardId, 0, desireM, OPEN_OPTS)
  expect(b, `开战应成功（${cardId}）`).toBeTruthy()
  return { distanceM: b!.distanceM, myDesireM: b!.myDesireM }
}

describe('开场距离的规则（2026-10-03 船长报障修）', () => {
  /**
   * ⚠ **如实登记：本文件目前只守得住"② 我方期望距离不被族格改写"那一条。**
   *
   * ①（"R 族开场 = 开战距离公式、不是族格值"）我**没能写出可判别的用例**：本夹具里 `openM` 恒读到
   * ~5,250（= 基础舰炮 4,770 ×1.1），**换装（MK3 激光 / 把件放进 `moduleBay`）都不改变它** ⇒ 夹具里
   * `rDesire ≈ openM ≈ 5,355`，改前改后同值、**判别不出来**（写一条恒绿的断言等于没守）。
   * 船长实测那场能判别，是因为他用**动能炮台**（近界 700）⇒ 族格"钻盲区"值 ≈ 600，而 `openM` 在 5,000 以上。
   * ⇒ 待办：找一条**换装真能影响 `openM`** 的夹具（疑似要走编队 ＋ 真实装备路径），再把 ① 补上。
   */
  it('① R 族不改写我方期望距离（族格只给敌人用）', () => {
    const r = openBattle(R_CARD, 1_500)
    expect(r.myDesireM, '显式设定的期望距离应原样保留（旧 bug 会被族格改成贴脸值）').toBe(1_500)
    console.log(`  [读数] R 族（${R_CARD}）开场距离 ${r.distanceM} m · 我方期望 ${r.myDesireM} m`)
  })

  it('② 非 R 族对照：期望距离照旧、开局在射程外', () => {
    const p = openBattle(PLAIN_CARD, 1_500)
    expect(p.myDesireM, '非 R 族期望距离照旧').toBe(1_500)
    expect(p.distanceM, '非 R 族开局应远大于贴脸值（> 1,000 m）').toBeGreaterThan(1_000)
  })
})
