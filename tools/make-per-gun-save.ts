/** 逐炮验收档生成器，全新合成状态，不读个人档。
 * 用法：npx tsx tools/make-per-gun-save.ts。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05 · 最后跑过2026-10-05。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { perGunTestSave } from './per-gun-test-fixture'
const path = resolve('docs/test-saves/test-save-per-gun-20261005.json')
mkdirSync(resolve('docs/test-saves'), { recursive: true })
writeFileSync(path, perGunTestSave(), 'utf8')
console.log(path)
