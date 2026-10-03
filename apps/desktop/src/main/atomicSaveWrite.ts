import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'

/** 唯一临时文件只属于本次请求；覆盖用 rename，新增备份用排他复制，失败保留原文件。 */
export async function atomicSaveWrite(file: string, text: string, exclusive = false): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`
  let removeTemp = true
  try {
    await fs.writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EEXIST') removeTemp = false
      throw err
    })
    if (exclusive) await fs.copyFile(tmp, file, constants.COPYFILE_EXCL)
    else await fs.rename(tmp, file)
  } finally {
    if (removeTemp) await fs.unlink(tmp).catch(() => {})
  }
}
