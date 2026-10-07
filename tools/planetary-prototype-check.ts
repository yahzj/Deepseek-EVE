/** 用法：npx tsx tools/planetary-prototype-check.ts；--file只读指定测试档。
 * 版本自检：游戏v0.1.0 · 存档结构v31 · 最后核对2026-10-07 · 最后跑过2026-10-07。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createInitialState, loadSaveFile, serializeSaveFile } from '@whale/core'
import { injectPlanetaryTestState, planetaryFixtureReport } from './planetary-test-fixture'

const fileIndex = process.argv.indexOf('--file')
if (fileIndex >= 0 && !process.argv[fileIndex + 1]) throw new Error('--file需要测试档路径')
const state = fileIndex >= 0
  ? loadSaveFile(readFileSync(resolve(process.argv[fileIndex + 1]!), 'utf8')).state
  : createInitialState({ name: '星球规则验收', seed: 7, nowWallMs: 0 })
if (fileIndex < 0) injectPlanetaryTestState(state)
const back = loadSaveFile(serializeSaveFile(state, state.savedAtWallMs)).state
if (!isDeepStrictEqual(state.planetary, back.planetary)) throw new Error('星球状态往返改变')
if (!back.planetary) throw new Error('测试档没有星球规则状态')
console.log(JSON.stringify(planetaryFixtureReport(back), null, 2))
console.log('星球原型：勘探视图、环境、建设校验、相邻与存档往返通过；玩家入口未接入。')
