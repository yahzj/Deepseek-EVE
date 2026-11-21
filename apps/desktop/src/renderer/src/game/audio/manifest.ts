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

export function builtinSfxUrls(cueId: SfxCueId): readonly string[] {
  return BUILTIN_BY_CUE.get(cueId) ?? []
}

export function builtinSfxCount(): number {
  let n = 0
  for (const urls of BUILTIN_BY_CUE.values()) n += urls.length
  return n
}

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
