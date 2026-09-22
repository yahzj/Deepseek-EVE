/**
 * **技能树坐标工作台 · 逐列比对**（**2026-09-22 建**）——把船长改过的
 * `content-csv/skilltree-workbench.xlsx` 与**当前代码**逐列比，把差异全部打印出来。
 *
 * **为什么要这个工具**（起因是一次真事故）：首次回写时我只比了 **名称 / rank / 坐标** 三列，
 * 把「**前置**」当"读数"跳过了 ⇒ 船长在表里改的 `采矿舰操作 ← 采矿舰入门学` **没被采用**，
 * 直到他本人发现。本工具把**五个可改列一次比全**（名称 / rank / 前置 / 技能书 / 大类 ＋ 坐标），
 * 并点名"表里有、代码里认不出的名字"⇒ 回写前跑一次就不会再漏。
 *
 * 用法：`npm run skilltree:diff`（只读，不改任何文件）
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-22 · 最后跑过 2026-09-22
 */
import ExcelJS from 'exceljs'
import { SKILLS, SKILL_BRANCHES } from '@whale/data'
import { layoutBook } from '../apps/desktop/src/renderer/src/ui/skillTreeLayout'

async function main(): Promise<void> {
  const byId = new Map(SKILLS.map((s) => [s.id, s]))
  const idByName = new Map(SKILLS.map((s) => [s.name, s.id]))

  /** 当前代码算出来的坐标（供与表里的 x/y 比） */
  const codePos = new Map<string, { x: number; y: number }>()
  for (const br of SKILL_BRANCHES) {
    const lay = layoutBook(
      br.id,
      SKILLS.filter((s) => s.branch === br.id),
    )
    for (const n of lay.nodes) codePos.set(n.def.id, { x: n.x, y: n.y })
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('content-csv/skilltree-workbench.xlsx')
  const ws = wb.getWorksheet('技能节点坐标')
  if (!ws) throw new Error('找不到工作表「技能节点坐标」')

  /** 前置串 → id 列表：`、`/`,`/`，`/`/` 分隔；`（根）`/空 = 无前置 */
  const parsePrereq = (text: string): { ids: string[]; unknown: string[] } => {
    if (text === '' || text === '（根）' || text === '-' || text === '—') return { ids: [], unknown: [] }
    const parts = text
      .split(/[、,，/／|]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== '（根）')
    const ids: string[] = []
    const unknown: string[] = []
    for (const p of parts) {
      const id = idByName.get(p)
      if (id) ids.push(id)
      else unknown.push(p)
    }
    return { ids, unknown }
  }

  const out = { name: [] as string[], rank: [] as string[], branch: [] as string[], group: [] as string[], pre: [] as string[], pos: [] as string[] }
  const unknown: string[] = []
  let rows = 0
  let missingInSheet = 0

  const seen = new Set<string>()
  ws.eachRow((row, n) => {
    if (n === 1) return
    const v = row.values.slice(1).map((x) => (x === null || x === undefined ? '' : x))
    const id = String(v[1] ?? '').trim()
    if (!id) return
    const cur = byId.get(id)
    if (!cur) {
      out.name.push(`（表里的 id 代码里没有：${id}）`)
      return
    }
    rows += 1
    seen.add(id)
    const sheetName = String(v[2] ?? '').trim()
    const sheetRank = Number(v[5])
    const sheetBranch = String(v[3] ?? '').trim()
    const sheetGroup = String(v[4] ?? '').trim()
    const sheetPre = String(v[10] ?? '').trim()
    const sheetX = Number(v[8])
    const sheetY = Number(v[9])
    if (cur.name !== sheetName) out.name.push(`${id}：代码「${cur.name}」 ↔ 表里「${sheetName}」`)
    if (cur.rank !== sheetRank) out.rank.push(`${id}（${cur.name}）：代码 ${cur.rank} ↔ 表里 ${sheetRank}`)
    if ((cur.branch ?? '') !== sheetBranch) out.branch.push(`${id}（${cur.name}）：代码 ${cur.branch ?? '（无）'} ↔ 表里 ${sheetBranch}`)
    const brGroup = SKILL_BRANCHES.find((b) => b.id === sheetBranch)?.group
    if (brGroup !== undefined && brGroup !== sheetGroup) out.group.push(`${id}（${cur.name}）：技能书属「${brGroup}」↔ 表里「${sheetGroup}」`)
    const parsed = parsePrereq(sheetPre)
    for (const u of parsed.unknown) unknown.push(`${id}（${cur.name}）→「${u}」`)
    const curPre = [...(cur.prereq ?? [])].sort().join(',')
    if (curPre !== [...parsed.ids].sort().join(',')) {
      const nm = (ids: string): string =>
        ids
          .split(',')
          .filter(Boolean)
          .map((i) => byId.get(i)?.name ?? i)
          .join('、') || '（根）'
      out.pre.push(`${id}（${cur.name}）：代码[${nm(curPre)}] ↔ 表里[${nm([...parsed.ids].sort().join(','))}]`)
    }
    const cp = codePos.get(id)
    if (cp && (cp.x !== sheetX || cp.y !== sheetY)) out.pos.push(`${id}（${cur.name}）：代码(${cp.x}, ${cp.y}) ↔ 表里(${sheetX}, ${sheetY})`)
  })
  for (const s of SKILLS) if (!seen.has(s.id)) missingInSheet += 1

  console.log(`技能树工作台逐列比对：表里 ${rows} 行 · 代码 ${SKILLS.length} 条 · 表里缺行 ${missingInSheet}`)
  const show = (title: string, list: string[]): void => {
    console.log(`\n【${title}】${list.length} 处`)
    for (const l of list) console.log(`  · ${l}`)
  }
  show('名称', out.name)
  show('rank', out.rank)
  show('技能书', out.branch)
  show('大类（技能书归属与表里不符）', out.group)
  show('**前置**（可改列 · 上次就是漏了这一列）', out.pre)
  show('坐标 x/y（表里改过 ⇒ 回写进 `skillTreePositions.ts`）', out.pos)
  if (unknown.length > 0) show('⚠ 前置里认不出的名字（请用技能表里的正式名）', unknown)

  const total = out.name.length + out.rank.length + out.branch.length + out.group.length + out.pre.length + out.pos.length
  console.log(total === 0 ? '\n✅ 表与代码完全一致（没有待回写的改动）' : `\n共 ${total} 处待回写（名称/rank/技能书/前置均写进 skills.ts；坐标写进 skillTreePositions.ts）`)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
