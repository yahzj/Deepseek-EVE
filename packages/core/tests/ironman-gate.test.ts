/**
 * **铁人装载闸门的回归用例**（**2026-09-24 船长裁定**：「**铁人为什么导入普通档会拒绝才是问题，
 * 不应该导入铁人存档才拒绝吗**」）。
 *
 * 背景（玩家报障）：原调用点写的是 `ironmanOn(当前档) || ironmanOn(来档)` ⇒ 只要当前这局开着铁人，
 * **普通档（代次恒 0）** 一定小于阈值 `max(当前代次, 账本代次)` ⇒ 玩家永远导不进自己的普通旧档。
 * 现口径：**闸门只按"来档"判** —— 来档是铁人档且代次落后才拒绝；来档是普通档一律放行。
 *
 * 本文件钉四件事（判据在 core 的 `ironmanLoadVerdict`，是唯一实现）：
 * ① **来档普通 ⇒ 放行**，哪怕当前是铁人（用"当前代次/账本都很高"来表达"当前这局是铁人"）；
 * ② 来档铁人 + 代次落后 ⇒ **拒绝**（防读档回滚；也顺带挡住"关铁人后把旧铁人档导回来"）；
 * ③ 来档铁人 + 代次追平/更高 ⇒ 放行；
 * ④ 来档铁人 + 落后但**档龄 ≥ 48 小时** ⇒ 救援放行；账本不可用（`ledgerSeq = 0`）时仍按当前档代次判，**不许静默放行**。
 */
import { describe, expect, it } from 'vitest'
import { IRONMAN_RESCUE_MIN_AGE_MS, ironmanLoadVerdict } from '../src/ironman'

/** 任意固定墙钟（用例只关心相对差） */
const NOW = 1_800_000_000_000

describe('铁人装载闸门（只按来档判·2026-09-24 船长裁定）', () => {
  it('① 来档是普通档 ⇒ 放行（当前这局是铁人也不拦：普通档代次恒 0 是正常现象，不是回滚）', () => {
    const v = ironmanLoadVerdict({
      ironman: false, // ← 来档不是铁人档
      incomingSeq: 0, // 普通档代次恒 0
      currentSeq: 5000, // 当前这局是铁人（代次已很高）
      ledgerSeq: 5000, // 账本也高
      incomingSavedAtWallMs: NOW - 60_000,
      nowWallMs: NOW,
    })
    expect(v).toEqual({ ok: true, rescue: false })
  })

  it('② 来档是铁人档且代次落后 ⇒ 拒绝，并把阈值回给界面', () => {
    const v = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 4,
      currentSeq: 9,
      ledgerSeq: 7,
      incomingSavedAtWallMs: NOW - 60_000,
      nowWallMs: NOW,
    })
    expect(v).toEqual({ ok: false, reason: 'rolled-back', threshold: 9 })
  })

  it('③ 来档是铁人档、代次追平或更高 ⇒ 放行（自己这份档永远能自由导入）', () => {
    const same = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 9,
      currentSeq: 9,
      ledgerSeq: 7,
      incomingSavedAtWallMs: NOW - 60_000,
      nowWallMs: NOW,
    })
    expect(same).toEqual({ ok: true, rescue: false })
    const newer = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 12,
      currentSeq: 9,
      ledgerSeq: 7,
      incomingSavedAtWallMs: NOW - 60_000,
      nowWallMs: NOW,
    })
    expect(newer).toEqual({ ok: true, rescue: false })
  })

  it('④ 来档铁人 + 落后但档龄 ≥ 48 小时 ⇒ 救援放行；不到 48 小时 ⇒ 仍拒绝', () => {
    const old = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 1,
      currentSeq: 9,
      ledgerSeq: 9,
      incomingSavedAtWallMs: NOW - IRONMAN_RESCUE_MIN_AGE_MS - 1,
      nowWallMs: NOW,
    })
    expect(old).toEqual({ ok: true, rescue: true })
    const young = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 1,
      currentSeq: 9,
      ledgerSeq: 9,
      incomingSavedAtWallMs: NOW - IRONMAN_RESCUE_MIN_AGE_MS + 60_000,
      nowWallMs: NOW,
    })
    expect(young.ok).toBe(false)
  })

  it('⑤ 账本不可用（ledgerSeq = 0）时仍按当前档代次判 —— 不许静默放行', () => {
    const v = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 5,
      currentSeq: 7,
      ledgerSeq: 0, // 账本读不到（旧主进程没有 ironman:ledger）
      incomingSavedAtWallMs: NOW - 60_000,
      nowWallMs: NOW,
    })
    expect(v).toEqual({ ok: false, reason: 'rolled-back', threshold: 7 })
  })
})
