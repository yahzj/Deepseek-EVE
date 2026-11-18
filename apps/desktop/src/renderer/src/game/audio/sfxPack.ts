import { SFX_CUES, sfxConsoleGroupOf } from './cues'
import type { SfxConsoleGroup, SfxCueId } from './cues'

export const SFX_PACK_FORMAT = 'whale-idle-sfx-pack' as const
export const SFX_PACK_VERSION = 1 as const
export const SFX_PACK_MANIFEST_PATH = 'manifest.json'
export const SFX_PACK_README_PATH = 'README.txt'
export const SFX_PACK_ASSETS_ROOT = 'apps/desktop/src/renderer/src/assets'

export const SFX_PACK_EXTS = ['mp3', 'ogg', 'wav', 'm4a'] as const
export type SfxPackExt = (typeof SFX_PACK_EXTS)[number]

export type SfxAssetDir = 'sfx' | 'bgm' | 'ambient'

const DIR_BY_GROUP: Record<SfxConsoleGroup, SfxAssetDir> = {
  sfx: 'sfx',
  music: 'bgm',
  ambient: 'ambient',
}

export function sfxPackDirOf(cueId: SfxCueId): SfxAssetDir {
  return DIR_BY_GROUP[sfxConsoleGroupOf(SFX_CUES[cueId].category)]
}

export function sfxPackAssetPath(cueId: SfxCueId, ext: SfxPackExt): string {
  return `${sfxPackDirOf(cueId)}/${cueId}.${ext}`
}

export interface SfxPackFile {
  readonly path: string
  readonly dir: SfxAssetDir
  readonly cueId: SfxCueId
  readonly fileName: string
  readonly ext: SfxPackExt
  readonly bytes: number
  readonly updatedAt: number
}

export interface SfxPackManifest {
  readonly format: typeof SFX_PACK_FORMAT
  readonly version: typeof SFX_PACK_VERSION
  readonly createdAt: string
  readonly generator: 'whale-idle-sfx-console'
  readonly assetsRoot: string
  readonly files: readonly SfxPackFile[]
}

export interface SfxPackSourceFile {
  readonly cueId: SfxCueId
  readonly fileName: string
  readonly updatedAt: number
  readonly data: Uint8Array
}

export interface ParsedSfxPack {
  readonly manifest: SfxPackManifest
  readonly files: readonly { readonly file: SfxPackFile; readonly data: Uint8Array }[]
}

export class SfxPackError extends Error {
  readonly errors: readonly string[]

  constructor(errors: readonly string[]) {
    super(errors.join('；'))
    this.name = 'SfxPackError'
    this.errors = errors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function audioExtOf(fileName: string): SfxPackExt | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  if (match === null) return null
  const ext = match[1]!.toLowerCase()
  return (SFX_PACK_EXTS as readonly string[]).includes(ext) ? (ext as SfxPackExt) : null
}


const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

const MAX_PACK_ENTRIES = 128
const MAX_PACK_BYTES = 256 * 1024 * 1024

interface ZipEntry {
  readonly path: string
  readonly data: Uint8Array
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8')
const ZIP_FLAG_UTF8 = 0x0800

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function localHeader(nameBytes: Uint8Array, crc: number, size: number): Uint8Array {
  const header = new Uint8Array(30)
  const dv = new DataView(header.buffer)
  dv.setUint32(0, 0x04034b50, true)
  dv.setUint16(4, 20, true)
  dv.setUint16(6, ZIP_FLAG_UTF8, true)
  dv.setUint16(8, 0, true)
  dv.setUint16(10, DOS_TIME, true)
  dv.setUint16(12, DOS_DATE, true)
  dv.setUint32(14, crc, true)
  dv.setUint32(18, size, true)
  dv.setUint32(22, size, true)
  dv.setUint16(26, nameBytes.length, true)
  dv.setUint16(28, 0, true)
  return header
}

function centralHeader(nameBytes: Uint8Array, crc: number, size: number, localOffset: number): Uint8Array {
  const header = new Uint8Array(46)
  const dv = new DataView(header.buffer)
  dv.setUint32(0, 0x02014b50, true)
  dv.setUint16(4, 20, true)
  dv.setUint16(6, 20, true)
  dv.setUint16(8, ZIP_FLAG_UTF8, true)
  dv.setUint16(10, 0, true)
  dv.setUint16(12, DOS_TIME, true)
  dv.setUint16(14, DOS_DATE, true)
  dv.setUint32(16, crc, true)
  dv.setUint32(20, size, true)
  dv.setUint32(24, size, true)
  dv.setUint16(28, nameBytes.length, true)
  dv.setUint16(30, 0, true)
  dv.setUint16(32, 0, true)
  dv.setUint16(34, 0, true)
  dv.setUint16(36, 0, true)
  dv.setUint32(38, 0, true)
  dv.setUint32(42, localOffset, true)
  return header
}

function endOfCentralDirectory(entryCount: number, cdSize: number, cdOffset: number): Uint8Array {
  const footer = new Uint8Array(22)
  const dv = new DataView(footer.buffer)
  dv.setUint32(0, 0x06054b50, true)
  dv.setUint16(4, 0, true)
  dv.setUint16(6, 0, true)
  dv.setUint16(8, entryCount, true)
  dv.setUint16(10, entryCount, true)
  dv.setUint32(12, cdSize, true)
  dv.setUint32(16, cdOffset, true)
  dv.setUint16(20, 0, true)
  return footer
}

export function writeSfxPackZip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = UTF8_ENCODER.encode(entry.path)
    const crc = crc32(entry.data)
    const local = localHeader(nameBytes, crc, entry.data.length)
    chunks.push(local, nameBytes, entry.data)
    central.push(centralHeader(nameBytes, crc, entry.data.length, offset))
    central.push(nameBytes)
    offset += local.length + nameBytes.length + entry.data.length
  }
  const cdOffset = offset
  const centralBytes = concatBytes(central)
  return concatBytes([...chunks, centralBytes, endOfCentralDirectory(entries.length, centralBytes.length, cdOffset)])
}

export function readSfxPackZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) throw new Error('入库包为空或过短，不是合法 zip')
  if (bytes.length > MAX_PACK_BYTES) throw new Error(`入库包超过 ${MAX_PACK_BYTES} 字节上限`)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 zip 目录结尾（EOCD）')

  const entryCount = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  if (entryCount > MAX_PACK_ENTRIES) throw new Error(`条目数 ${entryCount} 超过上限 ${MAX_PACK_ENTRIES}`)
  if (cdOffset + cdSize > bytes.length) throw new Error('zip 中央目录越界')

  const entries: ZipEntry[] = []
  let pos = cdOffset
  for (let index = 0; index < entryCount; index++) {
    if (pos + 46 > bytes.length || dv.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`第 ${index + 1} 个中央目录条目损坏`)
    }
    const flags = dv.getUint16(pos + 8, true)
    const method = dv.getUint16(pos + 10, true)
    const crc = dv.getUint32(pos + 16, true)
    const size = dv.getUint32(pos + 24, true)
    const nameLen = dv.getUint16(pos + 28, true)
    const extraLen = dv.getUint16(pos + 30, true)
    const commentLen = dv.getUint16(pos + 32, true)
    const localOffset = dv.getUint32(pos + 42, true)
    const nameStart = pos + 46
    if (nameStart + nameLen > bytes.length) throw new Error(`第 ${index + 1} 个条目文件名越界`)
    const path = UTF8_DECODER.decode(bytes.subarray(nameStart, nameStart + nameLen))
    pos = nameStart + nameLen + extraLen + commentLen

    if ((flags & 0x0001) !== 0) throw new Error(`${path}：不支持加密条目`)
    if ((flags & 0x0008) !== 0) throw new Error(`${path}：不支持 data descriptor`)
    if (method !== 0) throw new Error(`${path}：只支持 store（不压缩）条目`)
    if (localOffset + 30 > bytes.length || dv.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`${path}：本地文件头损坏`)
    }
    const localNameLen = dv.getUint16(localOffset + 26, true)
    const localExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart + size > bytes.length) throw new Error(`${path}：文件数据越界`)
    const data = bytes.subarray(dataStart, dataStart + size)
    if (crc32(data) !== crc) throw new Error(`${path}：CRC 校验失败（包损坏）`)
    entries.push({ path, data })
  }
  return entries
}


function packReadme(count: number, createdAt: string): string {
  return `大鲸鱼-深空放置 · 音效正式入库包
生成时间：${createdAt}
包含事件：${count} 条

用法（在仓库根目录运行）：
  npm run audio:install
  # 不带参数会自动找本机最近下载的 whale-sfx-pack-*.zip；也可显式指定：
  npm run audio:install -- "C:\\path\\to\\whale-sfx-pack-XXXXXXXX-XXXXXX.zip"

工具会按 manifest.json 校验语义 id、目标目录、扩展名与字节数后写入
${SFX_PACK_ASSETS_ROOT}/{sfx,bgm,ambient}/。
  --dry-run        只预览，不写文件
  --keep-variants  保留同一事件的旧扩展名文件（默认会移除，避免新旧素材随机混播）

入库后：
  1) npm run audio:check    声音系统自检
  2) 设置 →「声音」→「音效台」→「全部清除」：本机覆盖会优先于正式素材，清掉后才听到刚入库的文件
  3) git status 核对新增素材与来源（版权/授权按 assets 目录 README 登记）后提交
`
}

function utf8(text: string): Uint8Array {
  return UTF8_ENCODER.encode(text)
}

export function buildSfxPack(files: readonly SfxPackSourceFile[], options: { readonly createdAt: string }): Uint8Array {
  const errors: string[] = []
  const seen = new Set<string>()
  const manifestFiles: SfxPackFile[] = []
  const assetEntries: ZipEntry[] = []
  for (const source of files) {
    if (typeof source.cueId !== 'string' || !(source.cueId in SFX_CUES)) {
      errors.push(`未知语义 id：${String(source.cueId)}（先登记 cues.ts）`)
      continue
    }
    const cueId = source.cueId as SfxCueId
    const ext = audioExtOf(source.fileName)
    if (ext === null) {
      errors.push(`${source.fileName}：不是支持的音频扩展名（${SFX_PACK_EXTS.join('/')}）`)
      continue
    }
    if (seen.has(cueId)) {
      errors.push(`语义 id 重复：${cueId}（一个事件只能打一条）`)
      continue
    }
    seen.add(cueId)
    const manifestFile: SfxPackFile = {
      path: sfxPackAssetPath(cueId, ext),
      dir: sfxPackDirOf(cueId),
      cueId,
      fileName: source.fileName,
      ext,
      bytes: source.data.length,
      updatedAt: source.updatedAt,
    }
    manifestFiles.push(manifestFile)
    assetEntries.push({ path: manifestFile.path, data: source.data })
  }
  if (errors.length > 0) throw new SfxPackError(errors)

  manifestFiles.sort((a, b) => a.path.localeCompare(b.path))
  assetEntries.sort((a, b) => a.path.localeCompare(b.path))
  const manifest: SfxPackManifest = {
    format: SFX_PACK_FORMAT,
    version: SFX_PACK_VERSION,
    createdAt: options.createdAt,
    generator: 'whale-idle-sfx-console',
    assetsRoot: SFX_PACK_ASSETS_ROOT,
    files: manifestFiles,
  }
  const entries: ZipEntry[] = [
    { path: SFX_PACK_MANIFEST_PATH, data: utf8(`${JSON.stringify(manifest, null, 2)}\n`) },
    { path: SFX_PACK_README_PATH, data: utf8(packReadme(manifestFiles.length, options.createdAt)) },
    ...assetEntries,
  ]
  return writeSfxPackZip(entries)
}

function isManifestFile(value: unknown, errors: string[], index: number): value is SfxPackFile {
  if (!isRecord(value)) {
    errors.push(`manifest.files[${index}] 不是对象`)
    return false
  }
  if (typeof value.path !== 'string' || typeof value.dir !== 'string' || typeof value.cueId !== 'string') {
    errors.push(`manifest.files[${index}] 缺 path/dir/cueId`)
    return false
  }
  if (typeof value.fileName !== 'string' || typeof value.ext !== 'string') {
    errors.push(`manifest.files[${index}] 缺 fileName/ext`)
    return false
  }
  if (typeof value.bytes !== 'number' || !Number.isInteger(value.bytes) || value.bytes < 0) {
    errors.push(`manifest.files[${index}] 的 bytes 非法`)
    return false
  }
  if (typeof value.updatedAt !== 'number') {
    errors.push(`manifest.files[${index}] 的 updatedAt 非法`)
    return false
  }
  return true
}

export function parseSfxPack(bytes: Uint8Array): ParsedSfxPack {
  let zipEntries: ZipEntry[]
  try {
    zipEntries = readSfxPackZip(bytes)
  } catch (err) {
    throw new SfxPackError([err instanceof Error ? err.message : String(err)])
  }
  const errors: string[] = []
  const byPath = new Map(zipEntries.map((entry) => [entry.path, entry.data]))
  const manifestBytes = byPath.get(SFX_PACK_MANIFEST_PATH)
  if (manifestBytes === undefined) throw new SfxPackError([`入库包缺少 ${SFX_PACK_MANIFEST_PATH}`])

  let raw: unknown
  try {
    raw = JSON.parse(UTF8_DECODER.decode(manifestBytes))
  } catch {
    throw new SfxPackError([`${SFX_PACK_MANIFEST_PATH} 不是合法 JSON`])
  }
  if (!isRecord(raw) || !Array.isArray(raw.files)) {
    throw new SfxPackError([`${SFX_PACK_MANIFEST_PATH} 结构不符合格式`])
  }
  if (raw.format !== SFX_PACK_FORMAT) errors.push(`不是音效入库包（format=${String(raw.format)}）`)
  if (raw.version !== SFX_PACK_VERSION) errors.push(`不支持的包版本 ${String(raw.version)}（本工具只认 v${SFX_PACK_VERSION}）`)
  if (typeof raw.createdAt !== 'string') errors.push('manifest.createdAt 缺失')
  if (raw.assetsRoot !== SFX_PACK_ASSETS_ROOT) errors.push(`manifest.assetsRoot 不是仓库素材根：${String(raw.assetsRoot)}`)

  const files: { file: SfxPackFile; data: Uint8Array }[] = []
  const declared = new Set<string>()
  const usedCues = new Set<string>()
  const rawFiles = raw.files as unknown[]
  for (let index = 0; index < rawFiles.length; index++) {
    const entry = rawFiles[index]
    if (!isManifestFile(entry, errors, index)) continue
    if (!(entry.cueId in SFX_CUES)) {
      errors.push(`清单里的语义 id 未知：${entry.cueId}`)
      continue
    }
    const cueId = entry.cueId as SfxCueId
    if (usedCues.has(cueId)) errors.push(`清单里语义 id 重复：${cueId}`)
    usedCues.add(cueId)
    const ext = (SFX_PACK_EXTS as readonly string[]).includes(entry.ext) ? (entry.ext as SfxPackExt) : null
    if (ext === null) {
      errors.push(`${cueId}：扩展名 ${entry.ext} 不是支持的音频格式`)
      continue
    }
    const expectedPath = sfxPackAssetPath(cueId, ext)
    if (entry.path !== expectedPath) errors.push(`${cueId}：清单路径 ${entry.path} 与约定不符（应为 ${expectedPath}）`)
    if (entry.dir !== sfxPackDirOf(cueId)) errors.push(`${cueId}：目录 ${entry.dir} 与分类不符（应为 ${sfxPackDirOf(cueId)}）`)
    if (declared.has(entry.path)) errors.push(`清单路径重复：${entry.path}`)
    declared.add(entry.path)
    const data = byPath.get(expectedPath)
    if (data === undefined) {
      errors.push(`${cueId}：包里缺少文件 ${expectedPath}`)
      continue
    }
    if (data.length !== entry.bytes) errors.push(`${cueId}：${expectedPath} 字节数不符（清单 ${entry.bytes}，实际 ${data.length}）`)
    files.push({ file: { ...entry, path: expectedPath, dir: sfxPackDirOf(cueId), ext }, data })
  }
  for (const path of byPath.keys()) {
    if (path === SFX_PACK_MANIFEST_PATH || path === SFX_PACK_README_PATH) continue
    if (audioExtOf(path) !== null && !declared.has(path)) errors.push(`包内有清单未登记的音频文件：${path}`)
  }
  if (errors.length > 0) throw new SfxPackError(errors)

  const manifest: SfxPackManifest = {
    format: SFX_PACK_FORMAT,
    version: SFX_PACK_VERSION,
    createdAt: raw.createdAt as string,
    generator: 'whale-idle-sfx-console',
    assetsRoot: SFX_PACK_ASSETS_ROOT,
    files: files.map((f) => f.file),
  }
  return { manifest, files }
}
