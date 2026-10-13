import { describe, expect, it } from 'vitest'
import { ANNOUNCEMENTS, L10N, l10nEntryText } from '@whale/data'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const approved = [
  '玩家与敌方舰船的护盾、装甲和结构血量整体提高约50%，舰船插件的固定血量加成同步提高；常规护盾恢复比例相应下调，无人机血量、固定维修数值与特殊回满效果不变。',
  '新开启的入侵旗舰共享血池提高至30万；已经锁定的血池保持原值，已累计的伤害与贡献保留。',
  '玩家舰船装配任意有效高槽装备后禁用基础舰炮，拆空高槽后恢复；舰载武器在近盲区内仍可开火，对舰伤害降为正常的30%，无人机与近防对机群的规则不变。',
  '玩家出勤期间可进行仓库交易与逆向研究；装卸货物、出售船上货物和站内维修按目标舰停靠状态检查，空闲副船不受主控位置影响，母港与已建成副站适用相同规则。',
  '玩家从采矿或打捞切换至站内作业、长途运输或建站交付时，舰船按原航程返港，到港后自动检查条件并启动；待办随存档保留，活动栏可取消待办，取消后舰船仍继续返港。',
]

describe('船长批准的血量与作业公告', () => {
  it('首条公告和五条正文逐字采用批准稿，ID唯一', () => {
    const row = ANNOUNCEMENTS[0]!
    expect(row).toMatchObject({ id: 'ann-ship-hp-station-20261013', title: '舰船血量提升与作业优化', date: '2026-10-13', tag: '数值' })
    expect(row.bullets).toEqual(approved)
    expect(row.bulletIds).toEqual(['ano.hpStation.003', 'ano.hpStation.004', 'ano.hpStation.005', 'ano.hpStation.006', 'ano.hpStation.007'])
    expect(new Set(ANNOUNCEMENTS.map(entry => entry.id)).size).toBe(ANNOUNCEMENTS.length)
  })

  it('唯一表接线，未授权英文只登记并回退中文', () => {
    const row = ANNOUNCEMENTS[0]!
    const ids = [row.titleId!, row.tagId!, ...row.bulletIds!]
    expect(ids.map(id => L10N[id]!.zh)).toEqual([row.title, row.tag, ...approved])
    for (const id of ids) {
      expect(L10N[id]).toMatchObject({ en: '', enDeferred: true })
      expect(l10nEntryText(L10N[id]!, 'en')).toBe(L10N[id]!.zh)
    }
  })

  it('仅顶部新增获批公告，固定合入基线的全部历史正文与顺序不改', () => {
    const source = execFileSync('git', ['show', '70ccd2bb:packages/data/src/announcements.ts'], {
      cwd: new URL('../../../', import.meta.url), encoding: 'utf8', windowsHide: true,
    })
    const scope = { exports: {} as { ANNOUNCEMENTS: typeof ANNOUNCEMENTS }, require: () => ({ L10N }) }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, scope)
    expect(JSON.parse(JSON.stringify(ANNOUNCEMENTS.slice(1)))).toEqual(JSON.parse(JSON.stringify(scope.exports.ANNOUNCEMENTS)))
  })
})
