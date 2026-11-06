/**
 * **下注按钮「成功才响自己的音」回归**（2026-11-06 船长）：
 * 「简单投资界面中的下注按钮，不能下注要只能播放 ui-error，不能播放他原本的触发的声音的时候还播放 ui-error，
 *  成功了才触发他自己的声音。」
 *
 * 判定逻辑抽在 `game/audio/rules.ts`（`clickCueFor` / `shouldPlayClickCue`）：DOM 点击与 AudioContext
 * 在 Node 里跑不起来，所以这里测**纯规则** + **源码契约**（按钮声明、成功回执位置、全局监听接线），
 * 三处任何一处被改坏都会红。
 *
 * 跑法：`node --import tsx --test tools/ui-sfx-success-only.test.ts`
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { clickCueFor, shouldPlayClickCue } from '../apps/desktop/src/renderer/src/game/audio/rules'

/** 用测试文件自己的位置定根，不依赖调用时的工作目录 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8')

/** 取一段源码：从 `start` 起，到 `end` 前（找不到就断言失败，避免契约测试静默空转） */
function section(src: string, start: string, end: string): string {
  const from = src.indexOf(start)
  assert.ok(from >= 0, `源码里找不到片段起点：${start}`)
  const to = src.indexOf(end, from + start.length)
  assert.ok(to > from, `源码里找不到片段终点：${end}`)
  return src.slice(from, to)
}

test('点击瞬间：成功模式的按钮不排任何音，其它交易所按钮仍点击即响', () => {
  // 极简下注（data-sfx-on="success"）：点击这一拍返回 null，成功音由 notifyUiAction 事后播放
  assert.equal(clickCueFor('exchange-bet', true), null)
  // 入金/出金/买入/卖出等既有按钮行为不变：用自带动作音替代 ui-click
  assert.equal(clickCueFor('exchange-bet', false), 'exchange-bet')
  assert.equal(clickCueFor('exchange-deposit', false), 'exchange-deposit')
  assert.equal(clickCueFor('exchange-sell', false), 'exchange-sell')
  // 未声明或 id 拼错：回落 ui-click（与旧行为一致）
  assert.equal(clickCueFor(null, false), 'ui-click')
  assert.equal(clickCueFor('exchange-bte', false), 'ui-click')
  // 成功模式优先：即使 id 拼错，点击这一拍也不该出声
  assert.equal(clickCueFor('exchange-bte', true), null)
})

test('三条路径的音效序列：成功只响 exchange-bet，两种失败都只响 ui-error', () => {
  /**
   * 用规则复刻「点击这一拍排队 → 回执回来后的判定」：
   * - `local-reject`：未填金额/现金不足等本地校验，toast 与点击同刻；
   * - `async-reject`：回合锁单/配额满/服务端拒绝/网络错误，toast 晚于点击。
   */
  const cuesFor = (outcome: 'ok' | 'local-reject' | 'async-reject'): string[] => {
    const clickAt = 1000
    const cues: string[] = []
    const clickCue = clickCueFor('exchange-bet', true)
    const errorAt = outcome === 'ok' ? undefined : outcome === 'local-reject' ? clickAt : clickAt + 40
    const actionAt = outcome === 'ok' ? clickAt + 40 : undefined
    if (errorAt !== undefined) cues.push('ui-error')
    if (clickCue !== null && shouldPlayClickCue(clickAt, errorAt, actionAt)) cues.push(clickCue)
    if (actionAt !== undefined) cues.push('exchange-bet')
    return cues
  }
  assert.deepEqual(cuesFor('ok'), ['exchange-bet'])
  assert.deepEqual(cuesFor('local-reject'), ['ui-error'])
  assert.deepEqual(cuesFor('async-reject'), ['ui-error'])
})

test('同一击不叠两声：错误音或动作音不早于点击时刻时，不再补点击音', () => {
  assert.equal(shouldPlayClickCue(1000, undefined), true, '本会话没响过错误音 → 补点击音')
  assert.equal(shouldPlayClickCue(1000, 1000), false, '同步拒绝：错误音与点击同刻 → 只留错误音')
  assert.equal(shouldPlayClickCue(1000, 1003), false, '异步拒绝：错误音晚于点击 → 只留错误音')
  assert.equal(shouldPlayClickCue(1000, 900), true, '上一击的错误不牵连这一击')
  assert.equal(shouldPlayClickCue(1000, undefined, 1000), false, '这一击已播动作音 → 不再补点击音')
  assert.equal(shouldPlayClickCue(1000, undefined, 900), true, '旧动作音不牵连这一击')
  assert.equal(shouldPlayClickCue(1000, 1000, 1000), false, '错误音 + 动作音同刻 → 也不补点击音')
})

test('SimpleTrade 契约：主按钮声明成功模式，动作音只在 placeOrder 回执后、进度满格前播放', () => {
  const src = read('apps/desktop/src/renderer/src/features/exchange/components/SimpleTrade.tsx')
  // 两个属性缺一不可：少了 data-sfx-on 会退回「点击即响」，成功时变成两声叠响
  assert.equal((src.match(/data-sfx=/g) ?? []).length, 1, '主按钮应是 SimpleTrade 里唯一声明 data-sfx 的按钮')
  assert.match(src, /data-sfx="exchange-bet"/)
  assert.match(src, /data-sfx-on="success"/)

  const buy = section(src, 'const handleBuy = async', 'const handleShort = async')
  const short = section(src, 'const handleShort = async', 'const handleKeyDown')
  const branches = [
    ['买多', buy, 'buyProgress'],
    ['看跌', short, 'shortProgress'],
  ] as const
  for (const [label, block, progress] of branches) {
    const placeAt = block.indexOf('await client.placeOrder')
    const cueAt = block.indexOf("notifyUiAction('exchange-bet')")
    const doneAt = block.indexOf(`await ${progress}.finish()`)
    const catchAt = block.indexOf('} catch')
    assert.ok(placeAt >= 0, `${label}：找不到 placeOrder 调用`)
    assert.ok(cueAt > placeAt, `${label}：动作音必须在 placeOrder 成功回执之后`)
    assert.ok(doneAt > cueAt, `${label}：动作音不能被进度满格动画挡住`)
    assert.ok(catchAt > 0, `${label}：缺少 catch 分支`)
    assert.ok(!block.slice(catchAt).includes('notifyUiAction'), `${label}：失败分支绝不能播动作音`)
    assert.ok(!block.slice(0, placeAt).includes('notifyUiAction'), `${label}：本地校验拒绝不能播动作音`)
  }
  // 全局只该有这两处：以后在 busy / showGuard / catch 里补一声就会被这条拦住
  assert.equal((src.match(/notifyUiAction\(/g) ?? []).length, 2, 'notifyUiAction 只应在两个成功分支各调用一次')
})

test('全局点击监听契约：读 data-sfx-on、成功模式不排队、动作音参与互斥', () => {
  const src = read('apps/desktop/src/renderer/src/game/audio/uiFeedback.ts')
  assert.match(src, /button\.getAttribute\('data-sfx-on'\) === 'success'/, '成功模式要按属性值判定')
  assert.match(src, /const cue = clickCueFor\(/, '点击音判定必须走纯规则 clickCueFor')
  assert.match(src, /if \(cue === null\) return/, '成功模式点击这一拍必须直接返回，不排任何音')
  assert.match(src, /shouldPlayClickCue\(clickAtMs, lastErrorAtMs, lastActionAtMs\)/, '延后判定要同时看错误音与动作音')
  assert.match(src, /export function notifyUiAction\(cue: SfxCueId\)/, '业务动作音入口')
  assert.match(src, /lastActionAtMs = nowMs\(\)/, '动作音必须记录时刻，供点击音互斥使用')
})
