/**
 * **内置音效素材表**（构建时生成，2026-11-02）。
 *
 * 约定：素材放在 `apps/desktop/src/renderer/src/assets/sfx/`，文件名 = 语义 id
 * （`invasion-alarm.mp3`）；同一事件可放多份变体（`combat-fire.1.mp3`、`combat-fire.2.ogg`），
 * 播放时随机取一份。Vite 的 `import.meta.glob` 在**构建时**收表 ⇒ 桌面版与网页版同一套，
 * 两端的资源 URL 由各自构建器生成（桌面打包后是 `file://`，网页是 https）。
 *
 * ⚠ **不要改成运行时读目录**：发布版（网页 / Steam 包）没有可读的外部目录；
 * 船长本机"快速换音效"走音效台的**本机覆盖层**（`overrides.ts`，IndexedDB），不经过本文件。
 */
import { matchSfxFileName } from './rules'
import type { SfxCueId } from './cues'

/** 构建时收进来的全部素材（key = 相对本文件的路径，value = 可用 URL） */
const BUILTIN_MODULES = import.meta.glob('../../assets/sfx/*.{mp3,ogg,wav,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** 语义 id → 内置素材 URL 列表（同 id 多个变体按文件名排序，播放随机取一份） */
const BUILTIN_BY_CUE = new Map<SfxCueId, string[]>()

for (const [path, url] of Object.entries(BUILTIN_MODULES)) {
  const fileName = path.split('/').pop() ?? path
  const cueId = matchSfxFileName(fileName)
  if (cueId === null) continue
  const list = BUILTIN_BY_CUE.get(cueId) ?? []
  list.push(url)
  BUILTIN_BY_CUE.set(cueId, list)
}
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
  for (const path of Object.keys(BUILTIN_MODULES)) {
    const fileName = path.split('/').pop() ?? path
    if (matchSfxFileName(fileName) === null) out.push(fileName)
  }
  return out.sort()
}
