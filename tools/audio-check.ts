/**
 * **声音系统自检**（2026-11-02）—— 可复跑工具，不跑浏览器。
 *
 * 检查四类**会静默坏掉**的东西：
 * 1. 语义清单本身：id 形态、分类合法、增益/节流/并发有限且合理；
 * 2. 素材目录：`assets/sfx/` 里每个音频文件都能对上一个语义 id（孤儿文件会报错）；
 *    缺素材不算错（缺 = 静音），但会打印"未接入"清单，方便船长补文件；
 * 3. 本地化：清单/设置/音效台用到的每个文案 id 都在 `L10N` 表里，且待译标记与
 *    `docs/l10n-pending.md` 登记成对（与 `l10n:check` 同一条纪律，这里只覆盖本域）；
 * 4. 纯规则确定性用例：日志匹配、文件名匹配、音量换算、节流、生产进度增量。
 *
 * 用法：`npm run audio:check`
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-11-02 · 最后跑过 2026-11-02
 * 判据：档结构版本跨一个大版本，或本域文案/清单/构建入口改动后必须重跑并更新本行。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  SFX_CATEGORIES,
  SFX_CATEGORY_NAME_ID,
  SFX_CUES,
  SFX_CUE_IDS,
} from '../apps/desktop/src/renderer/src/game/audio/cues'
import {
  clampVolume,
  defaultSfxPrefs,
  effectiveGain,
  isAudioFileName,
  matchLogCue,
  matchSfxFileName,
  parseSfxPrefs,
  pickVariant,
  productionCompletedCount,
  productionSnapshot,
  shouldPlay,
  sfxFileBase,
} from '../apps/desktop/src/renderer/src/game/audio/rules'

const ROOT = process.cwd()
const failures: string[] = []

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message)
}

/* ═══════════ 一、语义清单 ═══════════ */

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const CATEGORY_SET = new Set<string>(SFX_CATEGORIES)
for (const id of SFX_CUE_IDS) {
  const cue = SFX_CUES[id]
  check(ID_RE.test(id), `语义 id 形态不合规：${id}`)
  check(CATEGORY_SET.has(cue.category), `${id}：未知分类 ${cue.category}`)
  check(Number.isFinite(cue.gain) && cue.gain > 0 && cue.gain <= 1.5, `${id}：gain 必须在 (0, 1.5]，实际 ${cue.gain}`)
  check(Number.isFinite(cue.minGapMs) && cue.minGapMs >= 0, `${id}：minGapMs 必须 ≥ 0，实际 ${cue.minGapMs}`)
  check(Number.isInteger(cue.maxConcurrent) && cue.maxConcurrent >= 1, `${id}：maxConcurrent 必须是正整数，实际 ${cue.maxConcurrent}`)
  check(typeof cue.nameId === 'string' && cue.nameId !== '', `${id}：缺中文名 id`)
}
for (const category of SFX_CATEGORIES) {
  check(typeof SFX_CATEGORY_NAME_ID[category] === 'string' && SFX_CATEGORY_NAME_ID[category] !== '', `分类 ${category}：缺中文名 id`)
}

/* ═══════════ 二、素材目录 ═══════════ */

const SFX_DIR = join(ROOT, 'apps/desktop/src/renderer/src/assets/sfx')
const assetFiles = readdirSync(SFX_DIR).filter((name) => isAudioFileName(name))
const covered = new Set<string>()
for (const fileName of assetFiles) {
  const cueId = matchSfxFileName(fileName)
  check(cueId !== null, `素材文件名对不上语义 id（会被忽略）：${fileName}`)
  if (cueId !== null) covered.add(cueId)
}
const missing = SFX_CUE_IDS.filter((id) => !covered.has(id))
if (missing.length > 0) {
  console.log(`· 未接入素材的语义 id（缺 = 静音，不算错误）：${missing.join('、')}`)
}

/* ═══════════ 三、本地化 ═══════════ */

const tableSrc = readFileSync(join(ROOT, 'packages/data/src/l10n/table.ts'), 'utf8')
const pendingSrc = readFileSync(join(ROOT, 'docs/l10n-pending.md'), 'utf8')

/** 本域用到的全部文案 id（清单名 + 分类名 + 设置分组 + 音效台） */
const UI_L10N_IDS = [
  'ui.sfx.030', 'ui.sfx.031', 'ui.sfx.032', 'ui.sfx.033', 'ui.sfx.035', 'ui.sfx.036', 'ui.sfx.037',
  'ui.sfx.040', 'ui.sfx.041', 'ui.sfx.042', 'ui.sfx.043', 'ui.sfx.044', 'ui.sfx.045', 'ui.sfx.046',
  'ui.sfx.047', 'ui.sfx.048', 'ui.sfx.049', 'ui.sfx.050', 'ui.sfx.051', 'ui.sfx.052', 'ui.sfx.054',
]
const allL10nIds = new Set<string>([...SFX_CUE_IDS.map((id) => SFX_CUES[id].nameId), ...SFX_CATEGORIES.map((c) => SFX_CATEGORY_NAME_ID[c]), ...UI_L10N_IDS])

for (const id of allL10nIds) {
  const line = tableSrc.split('\n').find((l) => l.trimStart().startsWith(`'${id}':`))
  check(line !== undefined, `本地化表缺条目：${id}`)
  if (line === undefined) continue
  check(line.includes('enDeferred: true'), `${id}：未授权英文时应写 en: '' + enDeferred: true`)
  const pendingRow = new RegExp(`^\\| \`${id.replace(/\./g, '\\.')}\` \\|[^\\n]*\\| 待本地化 \\|\\s*$`, 'm')
  check(pendingRow.test(pendingSrc), `${id}：enDeferred 未在 docs/l10n-pending.md 登记为「待本地化」`)
}

/* ═══════════ 四、纯规则确定性用例 ═══════════ */

const defaults = defaultSfxPrefs()
const muted = { ...defaults, muted: true }
check(effectiveGain('combat-fire', defaults) === 0.21, `默认增益：combat-fire 应为 0.21，实际 ${effectiveGain('combat-fire', defaults)}`)
check(effectiveGain('invasion-alarm', defaults) === 0.7, `默认增益：invasion-alarm 应为 0.7，实际 ${effectiveGain('invasion-alarm', defaults)}`)
check(effectiveGain('combat-fire', muted) === 0, '静音时所有音效增益必须为 0')
check(clampVolume(-1) === 0 && clampVolume(2) === 1 && clampVolume(Number.NaN) === 0, '音量钳制边界错误')

const parsed = parseSfxPrefs('{"muted":true,"master":0.3,"categories":{"combat":0.2}}')
check(parsed.muted === true && parsed.master === 0.3 && parsed.categories.combat === 0.2, '偏好 JSON 读取：逐字段应生效')
check(parsed.categories.alarm === defaults.categories.alarm, '偏好 JSON 读取：缺失字段应回落默认')
check(parseSfxPrefs('not json').master === defaults.master, '坏 JSON 应整套回落默认')
check(parseSfxPrefs('{"master":9}').master === 1, '越界音量应钳到 1')

check(shouldPlay(undefined, 1000, 100) === true, '节流：从未播放过应放行')
check(shouldPlay(950, 1000, 100) === false, '节流：间隔不足应拦截')
check(shouldPlay(900, 1000, 100) === true, '节流：间隔足够应放行')

check(matchLogCue('levelup', 'core.engine.002') === 'skill-done', '日志匹配：训练完成')
check(matchLogCue('industry', 'core.manufacturing.014') === 'industry-done', '日志匹配：制造完成')
check(matchLogCue('trade', 'core.market.022') === 'trade-done', '日志匹配：成交类（按分类兜底）')
check(matchLogCue('warn', 'core.combat.003') === null, '日志匹配：警告类不应出声')
check(matchLogCue('system', 'core.simulation.002') === null, '日志匹配：系统结算不应出声')

check(matchSfxFileName('invasion-alarm.mp3') === 'invasion-alarm', '文件名匹配：基本形态')
check(matchSfxFileName('Invasion-Alarm.OGG') === 'invasion-alarm', '文件名匹配：大小写不敏感')
check(matchSfxFileName('combat-fire.2.mp3') === 'combat-fire', '文件名匹配：序号变体')
check(matchSfxFileName('unknown-event.mp3') === null, '文件名匹配：未知事件应为 null')
check(matchSfxFileName('invasion-alarm.txt') === null, '文件名匹配：非音频扩展名应为 null')
check(sfxFileBase('A.1.MP3') === 'a.1', '文件名基名去扩展名错误')

check(pickVariant(['a', 'b'], () => 0) === 'a', '变体随机：0 → 第一份')
check(pickVariant(['a', 'b'], () => 0.999) === 'b', '变体随机：接近 1 → 最后一份')
check(pickVariant([], () => 0) === null, '变体随机：空表 → null')

const prevSnap = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 2 }], labRuns: [{ id: 5, finishAtGameMs: 1000 }] })
const nextSnap = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 3 }], labRuns: [{ id: 5, finishAtGameMs: 1000 }] })
check(productionCompletedCount(prevSnap, nextSnap) === 1, '生产进度：精炼批数 +1 应记 1 次')
const nextLab = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 3 }], labRuns: [{ id: 5, finishAtGameMs: 2000 }] })
check(productionCompletedCount(nextSnap, nextLab) === 1, '生产进度：实验室换批应记 1 次')
const newRun = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 3 }, { id: 2, batchesDone: 0 }], labRuns: [{ id: 5, finishAtGameMs: 2000 }, { id: 6, finishAtGameMs: 500 }] })
check(productionCompletedCount(nextLab, newRun) === 0, '生产进度：新开台不应算完成')
check(productionCompletedCount(null, newRun) === 0, '生产进度：首次基线不应补播')

/* ═══════════ 输出 ═══════════ */

console.log(`· 语义清单：${SFX_CUE_IDS.length} 个事件 · ${SFX_CATEGORIES.length} 个分类`)
console.log(`· 素材目录：${assetFiles.length} 个音频文件 · 覆盖 ${covered.size}/${SFX_CUE_IDS.length} 个事件`)
console.log(`· 本地化：本域 ${allL10nIds.size} 条 id（待译登记逐条核对）`)
if (failures.length > 0) {
  console.error(`\n✗ 声音系统自检失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ 声音系统自检通过')
