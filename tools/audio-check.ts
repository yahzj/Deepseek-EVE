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
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-11-05 · 最后跑过 2026-11-05
 * 判据：档结构版本跨一个大版本，或本域文案/清单/构建入口改动后必须重跑并更新本行。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SFX_CATEGORIES,
  SFX_CATEGORY_NAME_ID,
  SFX_CUES,
  SFX_CUE_IDS,
} from '../apps/desktop/src/renderer/src/game/audio/cues'
import {
  AMBIENT_CROSSFADE_MS,
  BGM_CROSSFADE_MS,
  LOG_CUE_RULES,
  PITCH_JITTER_MAX_CENTS,
  VOLUME_FADE_MS,
  clampPitchJitter,
  clampVolume,
  defaultSfxPrefs,
  effectiveGain,
  isAudioFileName,
  matchLogCue,
  matchSfxFileName,
  parseSfxPrefs,
  pickOtherVariant,
  pickVariant,
  pitchRateFor,
  productionCompletedCount,
  productionSnapshot,
  shouldPlay,
  shouldPlayClickCue,
  sfxFileBase,
} from '../apps/desktop/src/renderer/src/game/audio/rules'
import {
  AMBIENT_BLIP_IDS,
  SCENE_RELATED_CUES,
  SFX_SCENE_NAME_ID,
  SFX_SCENE_ORDER,
  effectiveSfxScene,
  resolveSfxScene,
  sceneAmbientOf,
  sceneBgmOf,
  sceneFlagsFromState,
} from '../apps/desktop/src/renderer/src/game/audio/scene'
import {
  SFX_PLAY_LOG_MAX,
  clearSfxPlayLog,
  recordSfxPlay,
  setSfxPlayLogPaused,
  sfxPlayLog,
} from '../apps/desktop/src/renderer/src/game/audio/playLog'
import {
  SFX_PACK_FORMAT,
  SFX_PACK_VERSION,
  SfxPackError,
  buildSfxPack,
  parseSfxPack,
  sfxPackAssetPath,
  sfxPackDirOf,
  writeSfxPackZip,
} from '../apps/desktop/src/renderer/src/game/audio/sfxPack'
import type { SfxPackSourceFile } from '../apps/desktop/src/renderer/src/game/audio/sfxPack'
import type { SfxCueId } from '../apps/desktop/src/renderer/src/game/audio/cues'
import { installSfxPack } from './audio-install'

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
  if (cue.pitchJitterCents !== undefined) {
    check(Number.isInteger(cue.pitchJitterCents) && cue.pitchJitterCents > 0 && cue.pitchJitterCents <= PITCH_JITTER_MAX_CENTS,
      `${id}：固定音高幅度必须是 1～${PITCH_JITTER_MAX_CENTS} 的整数音分`)
  }
}
for (const category of SFX_CATEGORIES) {
  check(typeof SFX_CATEGORY_NAME_ID[category] === 'string' && SFX_CATEGORY_NAME_ID[category] !== '', `分类 ${category}：缺中文名 id`)
}

/* ═══════════ 二、素材目录 ═══════════ */

const ASSET_ROOT = join(ROOT, 'apps/desktop/src/renderer/src/assets')
const ASSET_DIRS = ['sfx', 'bgm', 'ambient'].map((dir) => join(ASSET_ROOT, dir))
const assetFiles: string[] = []
const covered = new Set<string>()
for (const dir of ASSET_DIRS) {
  if (!existsSync(dir)) continue
  for (const fileName of readdirSync(dir).filter((name) => isAudioFileName(name))) {
    assetFiles.push(fileName)
    const cueId = matchSfxFileName(fileName)
    check(cueId !== null, `素材文件名对不上语义 id（会被忽略）：${fileName}`)
    if (cueId !== null) covered.add(cueId)
  }
}
// BGM/环境 loop 的清单约束：音乐/环境底噪必须 loop，环境点缀必须不是 loop
for (const id of SFX_CUE_IDS) {
  const cue = SFX_CUES[id]
  if (cue.category === 'music') check(cue.loop === true, `BGM 必须 loop：${id}`)
  if (cue.category === 'ambient' && !AMBIENT_BLIP_IDS.includes(id)) check(cue.loop === true, `环境底噪必须 loop：${id}`)
  if (AMBIENT_BLIP_IDS.includes(id)) check(cue.loop !== true, `环境点缀不能 loop：${id}`)
  const fallback = cue.fallback
  if (fallback !== undefined) {
    check(fallback in SFX_CUES, `${id}：fallback 指向不存在的语义 id ${fallback}`)
    check(fallback !== id, `${id}：fallback 不能指向自己`)
  }
}
const missing = SFX_CUE_IDS.filter((id) => !covered.has(id))
if (missing.length > 0) {
  console.log(`· 未接入素材的语义 id（缺 = 静音，不算错误）：${missing.join('、')}`)
}

/* ═══════════ 二·六、音效正式入库包（音效台导出 → audio:install 写入）═══════════ */

/** 构造一条合成覆盖（包格式不解析音频内容，字节只需可辨认） */
function packSource(cueId: SfxCueId, fileName: string, seed: number): SfxPackSourceFile {
  return { cueId, fileName, updatedAt: 1_761_000_000_000, data: new Uint8Array([seed, seed + 1, seed + 2, seed + 3]) }
}

/** 断言某段逻辑必须抛 `SfxPackError`（非法包绝不能写进素材目录） */
function expectPackError(run: () => unknown, label: string): void {
  try {
    run()
    check(false, `入库包：${label}本应被拒绝，实际通过`)
  } catch (err) {
    check(err instanceof SfxPackError && err.errors.length > 0, `入库包：${label}应抛出 SfxPackError（实际 ${err instanceof Error ? err.name : typeof err}）`)
  }
}

const PACK_CREATED_AT = '2026-11-04T00:00:00.000Z'
const packSources: SfxPackSourceFile[] = [
  packSource('invasion-alarm', 'invasion-alarm.wav', 10),
  packSource('bgm-docked', 'bgm-docked.mp3', 20),
  packSource('ambient-blip-comms', 'ambient-blip-comms.ogg', 30),
]
const packBytes = buildSfxPack(packSources, { createdAt: PACK_CREATED_AT })
check(packBytes.length > 0 && packBytes[0] === 0x50 && packBytes[1] === 0x4b, '入库包应是 zip（PK 魔数）')

const parsedPack = parseSfxPack(packBytes)
check(parsedPack.files.length === 3, `入库包解析出 3 条素材（实际 ${parsedPack.files.length}）`)
check(parsedPack.manifest.createdAt === PACK_CREATED_AT && parsedPack.manifest.version === SFX_PACK_VERSION, '入库包 manifest 的版本/生成时间不正确')
const parsedPaths = parsedPack.files.map((entry) => entry.file.path).sort()
check(
  parsedPaths.join(',') === 'ambient/ambient-blip-comms.ogg,bgm/bgm-docked.mp3,sfx/invasion-alarm.wav',
  `入库包路径映射错误（实际 ${parsedPaths.join(',')}）`,
)
for (const id of SFX_CUE_IDS) {
  const category = SFX_CUES[id].category
  const expectedDir = category === 'music' ? 'bgm' : category === 'ambient' ? 'ambient' : 'sfx'
  check(sfxPackDirOf(id) === expectedDir, `${id}：入库目录应为 ${expectedDir}（实际 ${sfxPackDirOf(id)}）`)
}
check(sfxPackAssetPath('bgm-docked', 'mp3') === 'bgm/bgm-docked.mp3', '入库包路径约定错误（bgm）')
check(sfxPackAssetPath('ambient-blip-static', 'm4a') === 'ambient/ambient-blip-static.m4a', '入库包路径约定错误（ambient）')

expectPackError(() => buildSfxPack([packSource('nope' as SfxCueId, 'nope.wav', 1)], { createdAt: PACK_CREATED_AT }), '未知语义 id ')
expectPackError(() => buildSfxPack([packSource('invasion-alarm', 'invasion-alarm.txt', 1)], { createdAt: PACK_CREATED_AT }), '非音频扩展名 ')
expectPackError(
  () => buildSfxPack([packSource('invasion-alarm', 'invasion-alarm.wav', 1), packSource('invasion-alarm', 'invasion-alarm.mp3', 2)], { createdAt: PACK_CREATED_AT }),
  '同一语义 id 重复打包',
)
expectPackError(() => parseSfxPack(packBytes.subarray(0, Math.floor(packBytes.length / 2))), '截断的入库包')

const emptyManifestObject = {
  format: SFX_PACK_FORMAT,
  version: SFX_PACK_VERSION,
  createdAt: PACK_CREATED_AT,
  generator: 'whale-idle-sfx-console',
  assetsRoot: 'apps/desktop/src/renderer/src/assets',
  files: [],
}
const emptyManifest = new TextEncoder().encode(JSON.stringify(emptyManifestObject))
check(parseSfxPack(writeSfxPackZip([{ path: 'manifest.json', data: emptyManifest }])).files.length === 0, '空入库包（0 条）应能解析')
expectPackError(
  () =>
    parseSfxPack(
      writeSfxPackZip([{ path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ ...emptyManifestObject, version: 99 })) }]),
    ),
  '不支持的包版本',
)
expectPackError(
  () =>
    parseSfxPack(
      writeSfxPackZip([
        { path: 'manifest.json', data: emptyManifest },
        { path: 'sfx/invasion-alarm.mp3', data: new Uint8Array([1, 2, 3]) },
      ]),
    ),
  '包内有清单未登记的音频文件',
)

/* 安装到临时目录：只测真实写盘/覆盖/变体清理/预览，不碰仓库素材 */
const installTempRoot = mkdtempSync(join(tmpdir(), 'whale-audio-install-'))
try {
  const first = installSfxPack(packBytes, { assetsRoot: installTempRoot })
  check(first.written.length === 3 && first.overwritten.length === 0, `安装：首次应新增 3 条（实际新增 ${first.written.length} / 覆盖 ${first.overwritten.length}）`)
  check(first.coverage.covered === 3 && first.coverage.total === SFX_CUE_IDS.length, '安装：覆盖度统计错误')
  check(readFileSync(join(installTempRoot, 'sfx', 'invasion-alarm.wav')).length === 4, '安装：素材字节未写入临时目录')

  const second = installSfxPack(packBytes, { assetsRoot: installTempRoot })
  check(second.skipped.length === 3 && second.written.length === 0 && second.overwritten.length === 0, '安装：字节一致应跳过（不重写）')

  // 旧扩展名/变体：写入不同字节时默认清理，避免新旧素材被 manifest 当成多份变体随机混播
  writeFileSync(join(installTempRoot, 'sfx', 'invasion-alarm.1.mp3'), new Uint8Array([9, 9]))
  const changedPack = buildSfxPack([packSource('invasion-alarm', 'invasion-alarm.wav', 11)], { createdAt: PACK_CREATED_AT })
  const changed = installSfxPack(changedPack, { assetsRoot: installTempRoot })
  check(changed.overwritten.includes('sfx/invasion-alarm.wav'), '安装：不同字节应覆盖')
  check(changed.removedVariants.includes('sfx/invasion-alarm.1.mp3'), '安装：默认应移除同事件旧扩展名变体')
  check(!existsSync(join(installTempRoot, 'sfx', 'invasion-alarm.1.mp3')), '安装：旧变体文件应已删除')

  // --keep-variants 保留手工变体（并警告混播）
  writeFileSync(join(installTempRoot, 'sfx', 'invasion-alarm.2.mp3'), new Uint8Array([8, 8]))
  const kept = installSfxPack(buildSfxPack([packSource('invasion-alarm', 'invasion-alarm.wav', 12)], { createdAt: PACK_CREATED_AT }), {
    assetsRoot: installTempRoot,
    keepVariants: true,
  })
  check(kept.removedVariants.length === 0 && existsSync(join(installTempRoot, 'sfx', 'invasion-alarm.2.mp3')), '安装：--keep-variants 应保留旧变体')
  check(kept.warnings.some((warning) => warning.includes('保留旧变体')), '安装：--keep-variants 应给出混播警告')

  // --dry-run 只预览不写
  const dry = installSfxPack(buildSfxPack([packSource('invasion-alarm', 'invasion-alarm.wav', 13)], { createdAt: PACK_CREATED_AT }), {
    assetsRoot: installTempRoot,
    dryRun: true,
  })
  check(dry.dryRun === true && dry.overwritten.includes('sfx/invasion-alarm.wav'), '安装：--dry-run 应报告将覆盖')
  check(readFileSync(join(installTempRoot, 'sfx', 'invasion-alarm.wav'))[0] === 12, '安装：--dry-run 不应写文件')
} finally {
  rmSync(installTempRoot, { recursive: true, force: true })
}

/* ═══════════ 二·五、日志规则必须指向真实 addLog 写入点 ═══════════ */

/**
 * 起因（2026-11-02 独立审查）：`core.planet.004` 只是通讯正文 id、从没被 `addLog` 写过，
 * 之前当日志规则登记 ⇒ 死规则永远不触发，而单纯"id 在 L10N 表里存在"查不出来。
 * 判据（2026-11-02 追加批修正）：规则 id 字面量附近（±12 行）必须出现下面之一：
 * - `addLog(`：直接写的日志；
 * - `errorId`：命令失败原因——core 侧 `addLog(state,'warn',result.error,result.errorId,...)` 统一收口写日志
 *   （操作被拒类 `ui-error` 走的就是这条：规则 id 在源码里只以 `errorId:` 字面量出现，不在 addLog 附近）。
 */
const CORE_SRC = join(ROOT, 'packages/core/src')
const coreFileLines = new Map<string, string[]>()
function walkCore(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkCore(full)
    else if (entry.name.endsWith('.ts')) coreFileLines.set(full, readFileSync(full, 'utf8').split('\n'))
  }
}
walkCore(CORE_SRC)

function ruleIdUsedByCoreLog(id: string): boolean {
  const needle = `'${id}'`
  for (const lines of coreFileLines.values()) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes(needle)) continue
      const from = Math.max(0, i - 12)
      const to = Math.min(lines.length - 1, i + 12)
      for (let j = from; j <= to; j++) {
        if (lines[j]!.includes('addLog(') || lines[j]!.includes('errorId')) return true
      }
    }
  }
  return false
}
for (const id of Object.keys(LOG_CUE_RULES)) {
  check(ruleIdUsedByCoreLog(id), `日志规则指向的 id 在 core 找不到 addLog/errorId 写入点（死规则）：${id}`)
}
console.log(`· 日志规则：${Object.keys(LOG_CUE_RULES).length} 条，逐条核对 core 写入点（addLog / 命令 errorId）`)

/* ═══════════ 三、本地化 ═══════════ */

const tableSrc = readFileSync(join(ROOT, 'packages/data/src/l10n/table.ts'), 'utf8')
const pendingSrc = readFileSync(join(ROOT, 'docs/l10n-pending.md'), 'utf8')

/** 本域用到的全部文案 id（清单名 + 分类名 + 设置分组 + 音效台） */
const UI_L10N_IDS = [
  'ui.sfx.030', 'ui.sfx.031', 'ui.sfx.032', 'ui.sfx.033', 'ui.sfx.035', 'ui.sfx.036', 'ui.sfx.037',
  'ui.sfx.040', 'ui.sfx.041', 'ui.sfx.042', 'ui.sfx.043', 'ui.sfx.044', 'ui.sfx.045', 'ui.sfx.046',
  'ui.sfx.047', 'ui.sfx.048', 'ui.sfx.049', 'ui.sfx.050', 'ui.sfx.051', 'ui.sfx.052', 'ui.sfx.054',
  'ui.sfx.060', 'ui.sfx.061', 'ui.sfx.062', 'ui.sfx.063', 'ui.sfx.065', 'ui.sfx.066', 'ui.sfx.069',
  'ui.sfx.070', 'ui.sfx.071', 'ui.sfx.072', 'ui.sfx.073', 'ui.sfx.074', 'ui.sfx.075',
  'ui.sfx.098', 'ui.sfx.099', 'ui.sfx.100', 'ui.sfx.101', 'ui.sfx.102', 'ui.sfx.103',
  'ui.sfx.104', 'ui.sfx.105', 'ui.sfx.106', 'ui.sfx.107', 'ui.sfx.108', 'ui.sfx.109',
  'ui.sfx.110', 'ui.sfx.111', 'ui.sfx.112', 'ui.sfx.113', 'ui.sfx.114', 'ui.sfx.115',
  'ui.sfx.116', 'ui.sfx.117', 'ui.sfx.118', 'ui.sfx.119', 'ui.sfx.120', 'ui.sfx.121',
  'ui.sfx.122', 'ui.sfx.123', 'ui.sfx.124', 'ui.sfx.125', 'ui.sfx.126', 'ui.sfx.127',
  'ui.sfx.128', 'ui.sfx.129', 'ui.sfx.130', 'ui.sfx.131',
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
check(effectiveGain('combat-fire', defaults) === 0.5, `默认增益：combat-fire 应为 0.5，实际 ${effectiveGain('combat-fire', defaults)}`)
check(effectiveGain('invasion-alarm', defaults) === 0.7, `默认增益：invasion-alarm 应为 0.7，实际 ${effectiveGain('invasion-alarm', defaults)}`)
// 默认音量表（船长 2026-11-05 指定）：总 100% / 音乐 15% / 环境 50% / 警报 70% / 战斗 100% / 生产 50% / 界面 50%
check(
  defaults.master === 1 &&
    defaults.categories.music === 0.15 &&
    defaults.categories.ambient === 0.5 &&
    defaults.categories.alarm === 0.7 &&
    defaults.categories.combat === 1 &&
    defaults.categories.progress === 0.5 &&
    defaults.categories.ui === 0.5,
  `默认音量表应为 总100/音乐15/环境50/警报70/战斗100/生产50/界面50，实际 ${JSON.stringify({ master: defaults.master, ...defaults.categories })}`,
)
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
check(matchLogCue('industry', 'core.lab.023') === 'industry-done', '日志匹配：实验室每批出料（尾批不漏）')
check(matchLogCue('industry', 'core.industry.077', { p2: 3 }) === 'industry-done', '日志匹配：精炼尾批（已完成 3 批）')
check(matchLogCue('industry', 'core.industry.077', { p2: 0 }) === null, '日志匹配：起炉即停（0 批）不播生产完成')
check(matchLogCue('industry', 'core.industry.077') === null, '日志匹配：缺参数不播（尾批规则必须有 p2）')
check(matchLogCue('industry', 'core.industry.083', { p5: 2 }) === 'industry-done', '日志匹配：余量不足停炉（p5 批数）')
check(matchLogCue('trade', 'core.market.022') === 'trade-done', '日志匹配：成交白名单')
check(matchLogCue('trade', 'core.market.014') === null, '日志匹配：撤单不在成交白名单')
check(matchLogCue('trade', undefined) === null, '日志匹配：无 textId 不播（制造开始/建站都是这类）')
check(matchLogCue('trade', 'core.planet.004') === null, '日志匹配：通讯正文 id 不是日志（死规则已删）')
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

/* BGM 每场新战斗重抽变体（2026-11-05 船长裁定 B）：务必避开当前曲目，否则听感上等于没换 */
check(pickOtherVariant(['a', 'b'], 'a', () => 0) === 'b', '重抽变体：两选一时必须给另一条（避开当前）')
check(pickOtherVariant(['a', 'b'], 'b', () => 0) === 'a', '重抽变体：当前是最后一条时给第一条')
check(pickOtherVariant(['a', 'b'], null, () => 0) === 'a', '重抽变体：没有当前曲目时按全表随机')
check(pickOtherVariant(['a', 'b'], 'x', () => 0.9) === 'b', '重抽变体：当前不在表内时按全表随机')
check(pickOtherVariant(['a'], 'a', () => 0) === 'a', '重抽变体：只有一条时原样返回')
check(pickOtherVariant([], null, () => 0) === null, '重抽变体：空表 → null')

/* 音高随机（船长 2026-11-02：1200 音分八度里上下浮动 100 音分） */
check(SFX_CATEGORIES.length === 6, `分类应为 6 类，实际 ${SFX_CATEGORIES.length}`)
check(clampPitchJitter(-5) === 0 && clampPitchJitter(999) === PITCH_JITTER_MAX_CENTS && clampPitchJitter(77.6) === 78, '音高幅度钳制错误')
check(pitchRateFor(0, () => 0) === 1, '音高：0 音分应原调')
check(Math.abs(pitchRateFor(100, () => 0) - Math.pow(2, -100 / 1200)) < 1e-12, '音高：-100 音分速率错误')
check(Math.abs(pitchRateFor(100, () => 1) - Math.pow(2, 100 / 1200)) < 1e-12, '音高：+100 音分速率错误')
check(pitchRateFor(100, () => 0.5) === 1, '音高：中值随机应原调')
check(pitchRateFor(100, () => Number.NaN) === 1, '音高：异常随机源应原调')
check(parseSfxPrefs('{"pitchJitterCents":250}').pitchJitterCents === PITCH_JITTER_MAX_CENTS, '音高偏好：越界应钳到上限')
check(parseSfxPrefs('{}').pitchJitterCents === 100, '音高偏好：默认 ±100 音分')

/* UI 点击音固定 ±50 音分（2026-11-05 船长口径；不受战斗滑条影响） */
check(SFX_CUES['ui-click'].pitchJitterCents === 50, 'UI 点击音应固定 ±50 音分')
check(SFX_CUES['ui-error'].pitchJitterCents === undefined && SFX_CUES['comms-received'].pitchJitterCents === undefined, '其他界面音不应抖动')
check(Math.abs(pitchRateFor(50, () => 0) - Math.pow(2, -50 / 1200)) < 1e-12, '音高：-50 音分速率错误')
check(Math.abs(pitchRateFor(50, () => 1) - Math.pow(2, 50 / 1200)) < 1e-12, '音高：+50 音分速率错误')

/* 点击音与错误音互斥（2026-11-05 船长反馈：ui-error 出现时 ui-click 不应叠响） */
check(shouldPlayClickCue(1000, undefined), '点击互斥：本次会话未响过错误音时应补点击音')
check(!shouldPlayClickCue(1000, 1000) && !shouldPlayClickCue(1000, 1003), '点击互斥：同一击随后弹出错误提示时只留错误音')
check(shouldPlayClickCue(1000, 900), '点击互斥：错误提示早于本次点击时仍应补点击音')

/* 场景解析（BGM/环境层） */
const noScene = { battleOnStage: false, wormholeActive: false, invasionActive: false, docked: false }
check(resolveSfxScene({ ...noScene, battleOnStage: true, wormholeActive: true, invasionActive: true, docked: true }) === 'battle', '场景优先级：战斗最高')
check(resolveSfxScene({ ...noScene, wormholeActive: true, invasionActive: true, docked: true }) === 'wormhole', '场景优先级：虫洞第二')
check(resolveSfxScene({ ...noScene, invasionActive: true, docked: true }) === 'invasion', '场景优先级：入侵第三')
check(resolveSfxScene({ ...noScene, docked: true }) === 'docked', '场景优先级：停靠第四')
check(resolveSfxScene(noScene) === 'space', '场景优先级：其余 = 太空')
check(
  sceneBgmOf('battle') === 'bgm-battle' && sceneBgmOf('wormhole') === 'bgm-wormhole' && sceneBgmOf('invasion') === 'bgm-invasion' &&
    sceneBgmOf('docked') === 'bgm-docked' && sceneBgmOf('space') === 'bgm-space',
  'BGM 场景映射错误',
)
check(
  sceneAmbientOf('docked') === 'ambient-docked' && sceneAmbientOf('battle') === 'ambient-battle' &&
    sceneAmbientOf('space') === 'ambient-space' && sceneAmbientOf('wormhole') === 'ambient-space' && sceneAmbientOf('invasion') === 'ambient-space',
  '环境场景映射错误',
)
check(AMBIENT_BLIP_IDS.length === 3, `环境点缀应 3 条，实际 ${AMBIENT_BLIP_IDS.length}`)
check(sceneFlagsFromState({ awayGalaxy: null, wormhole: { run: null }, weekendEvent: undefined }, false).docked === true, '场景投影：awayGalaxy=null = 停靠')
check(sceneFlagsFromState({ awayGalaxy: 'g1', wormhole: { run: {} } }, false).wormholeActive === true, '场景投影：虫洞进行中')
check(sceneFlagsFromState({ awayGalaxy: 'g1', weekendEvent: { endedAtWallMs: undefined } }, false).invasionActive === true, '场景投影：入侵进行中')
check(sceneFlagsFromState({ awayGalaxy: 'g1', weekendEvent: { endedAtWallMs: 1 } }, false).invasionActive === false, '场景投影：入侵已结束')

const prevSnap = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 2 }], labRuns: [{ id: 5, finishAtGameMs: 1000 }] })
const nextSnap = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 3 }], labRuns: [{ id: 5, finishAtGameMs: 1000 }] })
check(productionCompletedCount(prevSnap, nextSnap) === 1, '生产进度：精炼批数 +1 应记 1 次')
const nextLab = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 3 }], labRuns: [{ id: 5, finishAtGameMs: 2000 }] })
check(productionCompletedCount(nextSnap, nextLab) === 1, '生产进度：实验室换批应记 1 次')
const newRun = productionSnapshot({ refineRuns: [{ id: 1, batchesDone: 3 }, { id: 2, batchesDone: 0 }], labRuns: [{ id: 5, finishAtGameMs: 2000 }, { id: 6, finishAtGameMs: 500 }] })
check(productionCompletedCount(nextLab, newRun) === 0, '生产进度：新开台不应算完成')
check(productionCompletedCount(null, newRun) === 0, '生产进度：首次基线不应补播')

/* ═══════════ 五、音效调试台（2026-11-04 调试批） ═══════════ */

/* 淡变时长：BGM 2.5s / 环境底噪 1.5s / 音量短淡变 250ms（music.ts / ambient.ts / loops.ts 共用） */
check(BGM_CROSSFADE_MS === 2500, `BGM 交叉淡变应为 2.5s，实际 ${BGM_CROSSFADE_MS}ms`)
check(AMBIENT_CROSSFADE_MS === 1500, `环境底噪交叉淡变应保持 1.5s，实际 ${AMBIENT_CROSSFADE_MS}ms`)
check(VOLUME_FADE_MS === 250, `音量短淡变应为 250ms，实际 ${VOLUME_FADE_MS}ms`)
check(VOLUME_FADE_MS < BGM_CROSSFADE_MS, '音量短淡变必须明显短于 BGM 换曲淡变（拖滑条不能跟着慢）')

/* 场景预演：强制场景只改音频，不参与真实场景判定，可清除 */
check(effectiveSfxScene('space', null) === 'space', '场景预演：未强制时应等于真实场景')
check(effectiveSfxScene('space', 'battle') === 'battle', '场景预演：强制场景应优先于真实场景')
check(effectiveSfxScene('docked', 'space') === 'space', '场景预演：强制场景覆盖真实停靠')
check(SFX_SCENE_ORDER.length === 5 && new Set(SFX_SCENE_ORDER).size === 5, `场景顺序应有 5 个互不重复场景，实际 ${SFX_SCENE_ORDER.length}`)
check(SFX_SCENE_ORDER.every((scene) => typeof SFX_SCENE_NAME_ID[scene] === 'string' && SFX_SCENE_NAME_ID[scene] !== ''), '每个场景都要有中文名 id')
const sceneRelatedIds = new Set<string>()
for (const scene of SFX_SCENE_ORDER) {
  const cues = SCENE_RELATED_CUES[scene]
  check(cues.length > 0, `场景 ${scene} 应列出相关事件（音效台参考用）`)
  check(new Set(cues).size === cues.length, `场景 ${scene} 的相关事件有重复`)
  for (const cueId of cues) {
    check(SFX_CUE_IDS.includes(cueId), `场景 ${scene} 的相关事件不是合法语义 id：${cueId}`)
    sceneRelatedIds.add(cueId)
  }
}
check(sceneRelatedIds.size > 0 && sceneRelatedIds.size <= SFX_CUE_IDS.length, '场景相关事件并集应落在 33 条语义清单内')

/* 实时触发日志：只记真实播放、可暂停、环形上限、可清空 */
clearSfxPlayLog()
check(sfxPlayLog().length === 0, '实时日志：清空后应为空')
setSfxPlayLogPaused(false)
recordSfxPlay('ui-click', 'ui', 1000)
recordSfxPlay('combat-fire', 'combat', 1100)
const logged = sfxPlayLog()
check(logged.length === 2, `实时日志：应记录 2 条，实际 ${logged.length}`)
check(logged[logged.length - 1]?.cueId === 'combat-fire' && logged[logged.length - 1]?.category === 'combat', '实时日志：按旧→新记录，最新一条在末尾（面板倒序显示）')
setSfxPlayLogPaused(true)
recordSfxPlay('invasion-alarm', 'alarm', 1200)
check(sfxPlayLog().length === 2, '实时日志：暂停记录后不再新增')
setSfxPlayLogPaused(false)
for (let i = 0; i < 70; i++) recordSfxPlay('ui-click', 'ui', 2000 + i)
check(sfxPlayLog().length === SFX_PLAY_LOG_MAX, `实时日志：环形上限应为 ${SFX_PLAY_LOG_MAX}，实际 ${sfxPlayLog().length}`)
clearSfxPlayLog()
check(sfxPlayLog().length === 0, '实时日志：再次清空应为空')

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
