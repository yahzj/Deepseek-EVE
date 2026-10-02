/**
 * **单族舰船图形看图页**（2026-10-03 立 · 二号；由 2026-10-03 画 R 族时的一次性探针转正）。
 *
 * 用途：把**指定一族的敌舰**逐舰渲染成一张自包含 HTML（＋每舰一个独立 SVG 文件），
 * 供船长目测定形、也供我这边"改一版看一版"迭代（`art:ships` 总览页是**全仓 45 艘**，
 * 改一族时太散；本工具只出这一族）。
 *
 * 用法：
 *   `npx tsx tools/shipart-family.ts R`        # 默认 R
 *   `npm run art:family -- R`                  # 同一件事
 * 产物（`tools/_ui-artifacts/`，gitignore 目录）：
 *   `<family>-ships.html` · `<family>-ships.png`（PNG 需另跑一次无头浏览器，见下）·
 *   `<family>-<舰级短名>.svg`（放大 3× 的独立资产，双击可看）
 *
 * 渲染口径**照抄引擎**（`ui/ShipSprite.tsx`）：`viewBox 0 0 240 110` ·
 * `<g stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">` ＋ 三个类
 * （`.shipart-panel` / `.shipart-acc` / `.shipart-accf`）；族色取 `ui/tones.ts` 的
 * `FOE_ACCENT[族]`，其真值在各主题的 `--wui-tone-<族>` 三元组里（本工具取**深色主题**那一条）。
 *
 * ⚠ 图形与挂点都是**从源码取**（`shipArtFoe.tsx` / `shipMounts.ts`），不另写一份；
 * 图上标出的黄方块＝引擎挂点、红圆点＝炮口挂点，只作**读数**用（不是画面元素）。
 * ⚠ 观感审查权在船长（约定 §九）：本工具只负责"把形画出来给人看"。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { FOE_SHIP_ART } from '../apps/desktop/src/renderer/src/ui/shipArtFoe'
import { FOE_SHIP_MOUNTS } from '../apps/desktop/src/renderer/src/ui/shipMounts'

const ROOT = process.cwd()
const FAMILY = (process.argv[2] ?? 'R').toUpperCase()

/** 族色真值：从主题色板里读 `--wui-tone-<族>` 的**深色主题**那条（空格三元组 → #rrggbb） */
function accentOf(family: string): string {
  const css = readFileSync(join(ROOT, 'packages', 'ui', 'src', 'index.css'), 'utf8')
  const all = [...css.matchAll(new RegExp(`--wui-tone-${family}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`, 'g'))]
  const first = all[0]
  if (!first) return '#9fb3b8'
  const [r, g, b] = [first[1]!, first[2]!, first[3]!].map((v) => Number(v))
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`
}
const ACCENT = accentOf(FAMILY)

/** 逐舰中文名/档位：从数据表取（`packages/data/src/foe-ships.ts` 文本抽取，与 art:ships 同款做法） */
function foeShipsOf(family: string): { id: string; name: string; tier: number }[] {
  const src = readFileSync(join(ROOT, 'packages', 'data', 'src', 'foe-ships.ts'), 'utf8')
  const out: { id: string; name: string; tier: number }[] = []
  for (const m of src.matchAll(/id: '(foe-[a-z0-9-]+)',\s*\n\s*name: '([^']+)',\s*\n\s*family: '([A-Z])',[\s\S]{0,600}?hullClassTier: (\d)/g)) {
    if (m[3] !== family) continue
    out.push({ id: m[1]!, name: m[2]!, tier: Number(m[4]) })
  }
  return out.sort((a, b) => a.tier - b.tier)
}

function svgOf(id: string, withMounts: boolean): string {
  const art = renderToStaticMarkup(FOE_SHIP_ART[id] as never)
  const mounts = FOE_SHIP_MOUNTS[id]
  const marks: string[] = []
  if (withMounts && mounts) {
    for (const e of mounts.engines) {
      marks.push(`<rect x="${e.x - 2.4}" y="${e.y - 2.4}" width="4.8" height="4.8" fill="#ffd166" stroke="none"/>`)
    }
    for (const m of mounts.muzzles) {
      marks.push(`<circle cx="${m.x}" cy="${m.y}" r="2.6" fill="#ff7b7b" stroke="none"/>`)
    }
  }
  return (
    `<svg viewBox="0 0 240 110" width="100%" height="100%" fill="none">` +
    `<g stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" style="color:${ACCENT}">` +
    art +
    marks.join('') +
    `</g></svg>`
  )
}

const ships = foeShipsOf(FAMILY)
if (ships.length === 0) {
  console.error(`❌ 族 ${FAMILY} 在舰级表里没有条目（只支持有 foe-ships 条目的族：A~H / R）`)
  process.exit(1)
}
const missing = ships.filter((s) => FOE_SHIP_ART[s.id] === undefined)

const OUT = join(ROOT, 'tools', '_ui-artifacts')
mkdirSync(OUT, { recursive: true })

/** ① 每舰一个独立 SVG（成品资产，放大 3×） */
for (const s of ships) {
  if (FOE_SHIP_ART[s.id] === undefined) continue
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 110" width="720" height="330" fill="none">\n` +
    `  <style>.shipart-panel{stroke-width:1;opacity:.4;fill:none}.shipart-acc{stroke-width:1.6;fill:none}.shipart-accf{fill:currentColor;stroke:none}</style>\n` +
    `  <g stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" style="color:${ACCENT}">\n` +
    `    ${renderToStaticMarkup(FOE_SHIP_ART[s.id] as never)}\n` +
    `  </g>\n</svg>\n`
  writeFileSync(join(OUT, `${FAMILY.toLowerCase()}-${s.id.replace(/^foe-[a-z]-/, '')}.svg`), svg, 'utf8')
}

const cards = ships
  .map((s) => {
    if (FOE_SHIP_ART[s.id] === undefined) {
      return `<section class="card miss"><b>${s.name}</b>（${s.id}）**缺逐舰形** —— 会落 role 兜底剪影</section>`
    }
    const m = FOE_SHIP_MOUNTS[s.id]
    return `
  <section class="card">
    <div class="head"><span class="name">${s.name}</span><span class="tier">T${s.tier}</span>
      <span class="spec">${s.id}</span></div>
    <div class="big">${svgOf(s.id, true)}</div>
    <div class="row">
      <div class="smallwrap"><div class="lab">战斗尺寸（140px 宽）</div><div class="small">${svgOf(s.id, false)}</div></div>
      <div class="meta">
        <div class="lab">挂点（喷口 <i class="eng"></i>${m ? m.engines.length : 0} · 炮口 <i class="muz"></i>${m ? m.muzzles.length : 0}）</div>
        <p class="mono">引擎 ${m ? m.engines.map((e) => `${e.x},${e.y}`).join(' · ') : '（未登记）'}<br>
           炮口 ${m ? m.muzzles.map((x) => `${x.x},${x.y}`).join(' · ') : '（未登记）'}</p>
      </div>
    </div>
  </section>`
  })
  .join('\n')

const strip = `<div class="strip">${ships
  .map((s) => `<div class="sc"><div class="sn">${s.name}</div>${FOE_SHIP_ART[s.id] ? svgOf(s.id, false) : ''}</div>`)
  .join('')}</div>`

const html = `<!doctype html><meta charset="utf-8"><title>${FAMILY} 族舰船图形 · 逐舰线稿</title>
<style>
  body{margin:0;padding:26px 30px 40px;background:#0a0f14;color:#cfe3ea;
       font:14px/1.6 "Microsoft YaHei UI","Segoe UI",system-ui,sans-serif}
  h1{font-size:19px;margin:0 0 4px;color:#eaf6fa}
  .sub{color:#7f9aa6;font-size:12.5px;margin-bottom:18px} .sub b{color:${ACCENT}}
  .shipart-panel{stroke-width:1;opacity:.4;fill:none}
  .shipart-acc{stroke-width:1.6;fill:none}
  .shipart-accf{fill:currentColor;stroke:none}
  .strip{display:flex;gap:10px;align-items:flex-end;background:#0c141a;border:1px solid #152129;
         border-radius:10px;padding:12px 14px;margin-bottom:18px}
  .sc{flex:1;text-align:center} .sc svg{display:block;width:100%;height:auto}
  .sn{font-size:11.5px;color:#8fb3bf;margin-bottom:4px}
  .card{background:linear-gradient(180deg,#0e161d,#0b1218);border:1px solid #17242d;border-radius:10px;
        padding:14px 18px 16px;margin-bottom:16px}
  .card.miss{border-color:#5a2b2b;color:#ffb3b3}
  .head{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}
  .name{font-size:16px;color:${ACCENT};font-weight:700;letter-spacing:.5px}
  .tier{font-size:12.5px;color:#8fb3bf} .spec{font-size:11.5px;color:#6f8b96;margin-left:auto}
  .big{background:#0c141a;border:1px solid #152129;border-radius:8px;max-width:820px;margin:0 auto}
  .big svg{display:block;width:100%;height:auto}
  .row{display:flex;gap:18px;margin-top:10px}
  .smallwrap{flex:0 0 168px} .small{width:140px;background:#0c141a;border:1px solid #152129;border-radius:6px}
  .small svg{display:block;width:100%;height:auto}
  .meta{flex:1} .lab{font-size:11.5px;color:#6f8b96;margin:6px 0 2px} p{margin:0;color:#b9d2da}
  .mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:#8fb3bf}
  i.eng,i.muz{display:inline-block;width:8px;height:8px;margin:0 3px 0 5px;vertical-align:-1px}
  i.eng{background:#ffd166} i.muz{background:#ff7b7b;border-radius:50%}
</style>
<h1>${FAMILY} 族舰船图形 · 逐舰线稿（${ships.length} 条）</h1>
<div class="sub">族色 <b>${ACCENT}</b>（<code>--wui-tone-${FAMILY}</code> 深色主题）· 画布 240×110 · 舰艏朝右 ·
主线宽 2.2 · <b>黄方块＝引擎挂点、红圆点＝炮口挂点</b>（读数用）· 生成：<code>npm run art:family -- ${FAMILY}</code></div>
${strip}
${cards}
${missing.length > 0 ? `<div class="sub">⚠ 缺逐舰形 ${missing.length} 条：${missing.map((m) => m.name).join(' · ')}</div>` : ''}
<div class="sub">⚠ 观感审查权在船长（约定 §九）：好不好看、够不够"这一族"由您判。</div>
`
writeFileSync(join(OUT, `${FAMILY.toLowerCase()}-ships.html`), html, 'utf8')
console.log(
  `✅ 已写出 ${FAMILY} 族看图页：${join(OUT, `${FAMILY.toLowerCase()}-ships.html`)}` +
    `（${ships.length} 条 · 缺逐舰形 ${missing.length} 条 · 族色 ${ACCENT}）`,
)
