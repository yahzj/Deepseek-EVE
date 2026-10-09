/** 生成异形装备验收档，不读个人档、不改默认存档。
 * 用法：npx tsx tools/make-alien-loot-save.ts。
 * 版本自检：游戏v0.1.0 / 存档v31，2026-10-09核对与运行。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { alienLootTestSave } from './alien-loot-test-fixture'
const path = resolve('docs/test-saves/test-save-alien-loot-20261009.json')
mkdirSync(resolve('docs/test-saves'), { recursive: true })
writeFileSync(path, alienLootTestSave(), 'utf8')
console.log(path)
