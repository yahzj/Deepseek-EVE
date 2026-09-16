/**
 * 舰船图形总览页生成器（2026-09-16 立 · 三号）。
 *
 * 用途：把所有舰船的**战斗图形**渲染成一张静态 HTML 总览页（一族一节、逐艘一格），
 * 供**船长目测**或新人比对——不必凑齐舰队/进战斗，也不必逐艘进游戏找。
 * 起因：2026-09-16 船长报障「新增的舰船没有SVG图形」——那批船在存档里不易凑齐，
 * 逐艘进游戏看代价太高；本页是那次补图批顺手留下的**复用件**（每加一批船重跑一次即可）。
 *
 * 用法：`npm run art:ships`（或 `npx tsx tools/shipart-preview.ts`）
 * 产物：`tools/_ui-artifacts/shipart-preview.html`（gitignore 目录，浏览器直接打开）
 *
 * 做法：**直接从源码文本抽**——船表读 `packages/data/src/ships.ts`，图形读
 * `apps/desktop/.../ui/shipArt*.tsx`（JSX 转 SVG：`className`→`class`、驼峰属性→连字符）。
 * 为什么不 import：UI 侧是无扩展名导入 + JSX，tools 里 require 解析不通；文本抽取还能保证
 * 预览页与真源**同源**（改形后重跑即同步）。
 *
 * ⚠ 本页只是**看形**（240×110 本地坐标 + 主轮廓/面板线/族色件三套类），
 * 不含战斗布局、引擎尾焰与体量阶梯 ⇒ **不代替真机验收**（观感审查权在船长）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = process.cwd()
const UI = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src', 'ui')

/** 舰种族色（与 `ui/shipArt` 的 ROLE_ACCENT 同值；预览页只用于上色，不参与游戏逻辑） */
const ROLE_ACCENT: Record<string, string> = {
  armed: '#ff8373', // 掠食者武装
  industrial: '#5ee6c8', // 鲸盟采矿
  armored: '#cdd6e0', // 甲壳重装
  hauler: '#ffd166', // 货运
}
const ROLE_LABEL: Record<string, string> = {
  armed: '掠食者武装',
  industrial: '鲸盟采矿',
  armored: '甲壳重装',
  hauler: '货运',
}
/** 2026-09-16 补图批（页面上打 ★；此后新加的船改这张表或忽略即可） */
const NEW_BATCH = new Set([
  'sh-wh-a-frigate',
  'sh-wh-a-destroyer',
  'sh-wh-a-cruiser',
  'sh-wh-c-frigate',
  'sh-wh-c-destroyer',
  'sh-wh-c-cruiser',
  'sh-wh-d-frigate',
  'sh-wh-d-destroyer',
  'sh-wh-d-cruiser',
  'sh-wh-e-frigate',
  'sh-wh-e-destroyer',
  'sh-wh-e-carrier',
  'sh-wh-g-frigate',
  'sh-wh-g-destroyer',
  'sh-wh-g-cruiser',
  'sh-nautilus',
  'sh-megalodon',
  'sh-dunkleosteus',
])

interface Row {
  id: string
  name: string
  tier: number
  role: string
}

/** 船表：按 `{ id: '…' … },` 切块取 id/name/tier/role（⚠ 源码是 CRLF，切块正则要容 `\r`） */
function readShips(): Row[] {
  const src = readFileSync(join(ROOT, 'packages', 'data', 'src', 'ships.ts'), 'utf8')
  const rows: Row[] = []
  for (const block of src.split(/\r?\n  \{\r?\n/).slice(1)) {
    const id = block.match(/id:\s*'([a-z0-9-]+)'/)?.[1]
    const name = block.match(/name:\s*'([^']+)'/)?.[1]
    if (!id || !name) continue
    const tier = Number(block.match(/tier:\s*(\d)/)?.[1] ?? 0)
    const role = block.match(/role:\s*'([a-z]+)'/)?.[1] ?? 'armed'
    rows.push({ id, name, tier, role })
  }
  return rows
}

const artSrc = ['shipArt.tsx', 'shipArtData.tsx', 'shipArtWh.tsx']
  .map((f) => (existsSync(join(UI, f)) ? readFileSync(join(UI, f), 'utf8') : ''))
  .join('\n')

/** 抽一艘船的形（JSX → SVG 片段）；抽不到返回 null */
function artInner(id: string): string | null {
  const m = artSrc.match(new RegExp(`["']${id}["']\\s*:\\s*\\(\\s*<g>([\\s\\S]*?)</g>\\s*\\),`))
  if (!m) return null
  return m[1]!
    .replace(/\/\*[\s\S]*?\*\//g, '') // JSX 注释
    .replace(/className=/g, 'class=')
    .replace(/strokeWidth=/g, 'stroke-width=')
    .replace(/strokeLinejoin=/g, 'stroke-linejoin=')
    .replace(/strokeDasharray=/g, 'stroke-dasharray=')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('')
}

const ships = readShips()
let missing = 0
const byRole = new Map<string, Row[]>()
for (const s of ships) {
  const list = byRole.get(s.role) ?? []
  list.push(s)
  byRole.set(s.role, list)
}

const sections: string[] = []
for (const role of ['armed', 'armored', 'hauler', 'industrial']) {
  const list = byRole.get(role)
  if (!list || list.length === 0) continue
  const cells = list.map((s) => {
    const inner = artInner(s.id)
    if (!inner) {
      missing += 1
      return `<div class="cell is-miss"><div class="miss">缺形：${s.name}<span class="id">${s.id}</span></div></div>`
    }
    const star = NEW_BATCH.has(s.id) ? '<b class="star">★</b>' : ''
    return (
      `<div class="cell">` +
      `<svg viewBox="0 0 240 110" width="384" height="176" fill="none">` +
      `<g stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" style="color:${ROLE_ACCENT[role]}">${inner}</g>` +
      `</svg><div class="name">${star}${s.name}<span class="id">${s.id} · T${s.tier || '?'}</span></div></div>`
    )
  })
  sections.push(`<h2>${ROLE_LABEL[role] ?? role}（${list.length} 艘）</h2><div class="grid">${cells.join('')}</div>`)
}

const html = `<!doctype html><meta charset="utf-8"><title>舰船战斗图形总览 · ${ships.length} 艘</title>
<style>
 body{background:#0b0f16;color:#dfe7f2;font:13px/1.5 "Microsoft YaHei",sans-serif;margin:0;padding:18px}
 h1{font-size:16px;margin:0 0 4px}
 h2{font-size:13px;color:#9fb4cc;margin:18px 0 8px;border-left:3px solid #2c3e55;padding-left:8px}
 p{color:#8fa3bb;margin:0 0 6px}
 .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
 .cell{background:#111823;border:1px solid #1e2a3a;border-radius:6px;padding:6px;display:flex;flex-direction:column;align-items:center}
 .cell.is-miss{border-color:#5a2a2a}
 .name{margin-top:2px;font-weight:700} .id{color:#7f93aa;font-weight:400;margin-left:6px;font-size:11px}
 .star{color:#ffd166;margin-right:4px}
 .miss{color:#ff7b6b;padding:36px}
 /* 与 styles.css 的 .shipart-* 同款（本页自带一份，独立于应用样式） */
 .shipart-panel{stroke-width:1;opacity:.4;fill:none}
 .shipart-acc{stroke-width:1.6;fill:none}
 .shipart-accf{fill:currentColor;stroke:none}
 .shipart-volt{stroke:#5fd0ff;stroke-width:1.4;fill:none;opacity:.85}
 .shipart-volt-g{stroke:#8dff9e;stroke-width:1.5;fill:none;opacity:.9}
 .shipart-volt-i{stroke:#8fc7ff;stroke-width:1.5;fill:none;opacity:.9}
 .shipart-fill-g{fill:#8dff9e;stroke:none;opacity:.9}
 .shipart-fill-i{fill:#8fc7ff;stroke:none;opacity:.9}
</style>
<h1>舰船战斗图形总览 · ${ships.length} 艘（240×110 本地坐标 · 舰首朝右）</h1>
<p>★ = 2026-09-16 补图批。只画形，不含战斗布局、引擎尾焰与体量阶梯；族色件为固定色（C 巢群磷光绿 / D 陵墓冷青），主轮廓随舰种族色。</p>
${sections.join('')}`

const out = join(ROOT, 'tools', '_ui-artifacts', 'shipart-preview.html')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html, 'utf8')
console.log(`已写出舰船图形总览：${out}（${ships.length} 艘，缺形 ${missing} 艘）`)
