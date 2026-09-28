/**
 * 批一「矿业大类拆分」回归（**2026-09-27 船长令**：「我打算把采矿从工业中独立出去。」＋大类名选定「矿业」）。
 *
 * 口径：新大类「矿业」= 采矿（`b-mine` 5 条）＋ 采矿舰操作（`b-indship` 2 条），共 **7 条**；
 * 工业由 28 条降为 **21 条**；技能总数仍 **88 条**（本批不增删技能）。
 *
 * 为什么要用例守着：`content-check` 的「技能书契约」要求**技能书的大类 = 技能自身的大类**，
 * 那是工具侧的护栏；搬大类是"数据里散着 10 处 group 字段"的改动，本用例把它在单测里再钉一遍，
 * 顺手防"多搬一条 / 少搬一条 / 只改书不改技能"这三种半成品状态。
 */
import { describe, expect, it } from 'vitest'
import { L10N, SKILLS, SKILL_BRANCHES, SKILL_GROUPS } from '@whale/data'

describe('矿业大类拆分（2026-09-27）', () => {
  it('大类清单 8 项，「矿业」排在「工业」之后', () => {
    expect(SKILL_GROUPS).toEqual(['舰船', '工业', '矿业', '战斗', '工程', '贸易', '探索', '物流'])
  })

  it('矿业 7 条 · 工业 31 条 · 总数 106 条', () => {
    // ⚠ 批一当时是「工业 21 条 · 总数 88 条」；批二（18 条 R4/R5 上位）把 10 条挂进工业、8 条挂进战斗 ⇒ 现值如下
    expect(SKILLS.filter((s) => s.group === '矿业').length).toBe(7)
    expect(SKILLS.filter((s) => s.group === '工业').length).toBe(31)
    expect(SKILLS.length).toBe(106)
  })

  it('矿业七条点名核对（防顺手多搬或少搬）', () => {
    expect(
      SKILLS.filter((s) => s.group === '矿业')
        .map((s) => s.id)
        .sort(),
    ).toEqual([
      'astro-geology',
      'deep-hole-blasting',
      'deep-space-harvesting',
      'industrial-ops',
      'mining',
      'mining-frigate',
      'rich-vein-prospecting',
    ])
  })

  it('两本技能书改挂矿业，且与所含技能的大类一致（与技能书契约同口径）', () => {
    expect(
      SKILL_BRANCHES.filter((b) => b.group === '矿业')
        .map((b) => b.id)
        .sort(),
    ).toEqual(['b-indship', 'b-mine'])
    for (const id of ['b-mine', 'b-indship']) {
      const owned = SKILLS.filter((s) => s.branch === id)
      expect(owned.length, id).toBeGreaterThan(0)
      for (const s of owned) expect(s.group, s.id).toBe('矿业')
    }
  })

  it('大类名走 id 映射：`ui.labelsText.070` 中英齐', () => {
    expect(L10N['ui.labelsText.070']?.zh).toBe('矿业')
    expect(L10N['ui.labelsText.070']?.en).toBe('Mining Industry')
  })
})
