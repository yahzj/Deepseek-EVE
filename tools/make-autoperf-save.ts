/**
 * 生成"性能自动采集"用的初始存档（2026-09-08 诊断工具）。
 *
 * 用途：自动跑分（tools/run-autoperf.ps1）启动 Electron 前，先把一份干净、无教程锁
 * （prologue=false → onboarding.step=-1）的经典开局存档写入隔离 userData 目录，
 * 保证挂机/翻页/战斗场景数据干净可复现；自动采集绝不碰真实存档。
 *
 * 用法：npx tsx tools/make-autoperf-save.ts <save.json 输出路径>
 */
import { writeFileSync } from 'node:fs'
import { createInitialState, serializeSaveFile } from '@whale/core'

const out = process.argv[2]
if (!out) {
  console.error('用法: npx tsx tools/make-autoperf-save.ts <save.json 输出路径>')
  process.exit(1)
}
const state = createInitialState({ nowWallMs: Date.now(), seed: 20260908, prologue: false })
writeFileSync(out, serializeSaveFile(state), 'utf8')
console.log('autoperf 初始存档已生成: ' + out)
