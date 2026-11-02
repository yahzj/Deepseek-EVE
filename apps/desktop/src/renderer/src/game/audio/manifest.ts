/**
 * **内置音频素材表**（构建时生成，2026-11-02；追加批加入 BGM / 环境目录）。
 *
 * 约定：文件名 = 语义 id（`invasion-alarm.mp3`），同一事件可放多份变体
 * （`combat-fire.1.mp3`、`combat-fire.2.ogg`），播放时随机取一份，音频延长器：
 * - 短音效：`assets/sfx/`（含战斗细分、UI 反馈）；声音变体与回落都在 `cues.ts` 规定；
 * - BGM：`assets/bgm/`（5 条场景循环，长音频）；
 * - 环境：`assets/ambient/`（3 条场景底噪循环 + 3 条随机点缀）。
 *
 * Vite 的 `import.meta.glob` 在**构建时**收表 ⇒ 桌面版与网页版同一套；
 * 缺文件 = 静音（不报错）。**不要改成运行时读目录**：发布包没有可读的外部目录。
 */
import { matchSfxFileName } from './rules'
import type { SfxCueId } from './cues'

type Globbed = Record<string, string>

const SFX_MODULES = import.meta.glob('../../assets/sfx/*.{mp3,ogg,wav,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Globbed
const BGM_MODULES = import.meta.glob('../../assets/bgm/*.{mp3,ogg,wav,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Globbed
const AMBIENT_MODULES = import.meta.glob('../../assets/ambient/*.{mp3,ogg,wav,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Globbed

/** 语义 id → 内置素材 URL 列表（同 id 多个变体按文件名排序，播放随机取一份） */
const BUILTIN_BY_CUE = new Map<SfxCueId, string[]>()

function collect(modules: Globbed): void {
  for (const [path, url] of Object.entries(modules)) {
    const fileName = path.split('/').pop() ?? path
    const cueId = matchSfxFileName(fileName)
    if (cueId === null) continue
    const list = BUILTIN_BY_CUE.get(cueId) ?? []
    list.push(url)
    BUILTIN_BY_CUE.set(cueId, list)
  }
}
collect(SFX_MODULES)
collect(BGM_MODULES)
collect(AMBIENT_MODULES)
for (const urls of BUILTIN_BY_CUE.values()) urls.sort()

/** 某个语义 id 的内置素材（空表 = 这个事件还没有音效，静默） */
export function builtinSfxUrls(cueId: SfxCueId): readonly string[] {
  return BUILTIN_BY_CUE.get(cueId) ?? []
}

/** 内置素材总数（启动自检 / 调试可读） */
export function builtinSfxCount(): number {
  let n = 0
  for (const urls of BUILTIN_BY_CUE.values()) n += urls.length
  return n
}

/** 文件名对不上任何语义 id 的素材（构建时忽略；`audio-check` 会把它报出来） */
export function orphanSfxFileNames(): string[] {
  const out: string[] = []
  for (const modules of [SFX_MODULES, BGM_MODULES, AMBIENT_MODULES]) {
    for (const path of Object.keys(modules)) {
      const fileName = path.split('/').pop() ?? path
      if (matchSfxFileName(fileName) === null) out.push(fileName)
    }
  }
  return out.sort()
}
