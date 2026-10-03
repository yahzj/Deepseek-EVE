/**
 * **本机调试模式放行铁人装载闸门**（**2026-10-03 船长令**，原话照抄）：
 *
 * > 「**新增，调试模式允许载入铁人存档**」
 *
 * 三问裁定（船长）：① **备份恢复 ＋ 导入 两条路都放行**（两条路共用渲染层 `engine.ironmanLoadCheck`
 * 这一个入口 ⇒ 判据只需在 core 加一格）；② 判据**只用本机调试门禁** `debugEnabled()`
 * （= 本机门禁 ∧ 本机 `localStorage['whale-idle:debug']` ⇒ **发布版恒 false**，玩家侧不可达）；
 * ③ **不记救援**（不写救援账，`rescue` 恒 false）。
 *
 * 本文件钉四件（判据本体 = core 的 `ironmanLoadVerdict`，渲染层只传 `bypass`）：
 * ① 旁路开 ⇒ 铁人旧档（代次落后、又不到 48h 救援龄）**放行**，且**不记救援**；
 * ② 旁路缺省 ⇒ **照旧拒绝**（回归：这条口子不许把闸门默认关掉）；
 * ③ 旁路开 ⇒ 也不会把"放行"说成救援（`rescue === false`，与船长选的"不记救援"一致）；
 * ④ 普通档不受影响（旁路开/关都放行）—— 即旁路只多开一扇门，不改既有判定。
 */
import { describe, expect, it } from 'vitest'
import { IRONMAN_RESCUE_MIN_AGE_MS, ironmanLoadVerdict } from '../src/ironman'

const NOW = 1_800_000_000_000
/** 铁人旧档：代次落后（3 < 7）且**不到救援龄**（1 小时前）⇒ 默认必被拒 */
const staleIronman = {
  ironman: true,
  incomingSeq: 3,
  currentSeq: 7,
  ledgerSeq: 7,
  incomingSavedAtWallMs: NOW - 3_600_000,
  nowWallMs: NOW,
}

describe('调试模式载入铁人存档（2026-10-03 船长令「按你推荐」）', () => {
  it('① 旁路开 ⇒ 铁人旧档**放行**（默认这条路是被拒的）', () => {
    const off = ironmanLoadVerdict({ ...staleIronman })
    expect(off.ok, '旁路缺省 ⇒ 照旧拒绝（先确认这条档在默认口径下确实过不去）').toBe(false)
    expect(off.ok === false && off.reason, '拒因 = 代次回滚').toBe('rolled-back')

    const on = ironmanLoadVerdict({ ...staleIronman, bypass: true })
    expect(on.ok, '旁路开 ⇒ 放行').toBe(true)
    expect(on.ok === true && on.rescue, '**不记救援**（船长三答之③）').toBe(false)
  })

  it('② 旁路缺省 ⇒ 判定**逐字不变**（连"48h 救援"那条也照旧）', () => {
    expect(ironmanLoadVerdict({ ...staleIronman }).ok).toBe(false)
    const rescueAge = ironmanLoadVerdict({
      ...staleIronman,
      incomingSavedAtWallMs: NOW - IRONMAN_RESCUE_MIN_AGE_MS - 3_600_000,
    })
    expect(rescueAge.ok, '两天前的旧档 ⇒ 救援放行（既有规则不动）').toBe(true)
    expect(rescueAge.ok === true && rescueAge.rescue, '默认那条才记救援').toBe(true)
  })

  it('③ 旁路开时"同代/更新代"照旧放行（旁路不改变既有放行路）', () => {
    const same = ironmanLoadVerdict({ ...staleIronman, incomingSeq: 7, bypass: true })
    expect(same.ok && !same.rescue).toBe(true)
  })

  it('④ 普通档不受影响（旁路开与不开都放行，且都不算救援）', () => {
    const plain = { ...staleIronman, ironman: false, incomingSeq: 0 }
    const off = ironmanLoadVerdict({ ...plain })
    const on = ironmanLoadVerdict({ ...plain, bypass: true })
    expect(off.ok && !off.rescue, '普通档 · 旁路缺省').toBe(true)
    expect(on.ok && !on.rescue, '普通档 · 旁路开').toBe(true)
  })

  it('⑤ 读数：同一条铁人旧档在两种判据下的结果', () => {
    const off = ironmanLoadVerdict({ ...staleIronman })
    const on = ironmanLoadVerdict({ ...staleIronman, bypass: true })
    console.log(
      `  [读数] 铁人旧档（代次 3 < 7、保存于 1 小时前）：默认 = ${off.ok ? '放行' : '拒绝（阈值 7）'} · 调试旁路 = ${on.ok ? '放行' : '拒绝'}`,
    )
    expect(on.ok).toBe(true)
  })
})
