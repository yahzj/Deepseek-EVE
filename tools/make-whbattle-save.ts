/**
 * **造一份「洞内战斗进行中」的可载入真档**（正式工具，2026-09-22 入库）。
 *
 * 为什么要它：无头探针要验"洞内战斗内嵌在虫洞探索界面里"，就得有一份**合法**的洞内战斗档。
 * 先试的两条路都不行：
 * ① 手捏 `run.battle`——`wormholeBattleViewOf` 要按这一趟的编队/威胁重建视图，手捏的单位对不上；
 * ② 把远征战斗对象搬进 `run.battle`——同上，**战斗组件一渲染就抛错、整块面板被 React 收回**
 *    （2026-09-22 实测：面板挂载即消失，查了很久才定位到是夹具不合法，不是宿主接线的问题）。
 *
 * 做法（全程走引擎正规路径，不手捏战斗）：载入一份**真档**（网格层、人在洞里）→ 把玩家挪到
 * "舰船信号"格 → 调 core 的 `wormholeStartBattle(state, ctx, 'node')` 开打 → `serializeSaveFile` 存盘。
 * 产出的档一举两得：**探针夹具** ＋ **船长可直接载入验收的测试档**（约定 §9 那道门槛）。
 *
 * 用法：`npm run save:whbattle`（产出 `docs/test-saves/test-save-wh-battle-<时间戳>.json`）
 * ⚠ 产出的档带了"刚刚"的 `savedAtWallMs`（不写会被离线结算把这局战斗当场跑掉）。
 * ⚠ **探针 `npm run ui:actwin` 的 `wh-battle` 格引用的是某一份固定档**（当前
 * `test-save-wh-battle-202609220658.json`）：重跑本工具会产出**新时间戳**的档 ⇒
 * 要同步改那一格的 `file`，否则探针会拿旧档去测（旧档一样能用，只是内容停在那一刻）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-22**（当日核对：网格层找 `place=ship` 格 → `wormholeStartBattle` 开打 → 存盘）
 *   - 本工具最后跑过：**2026-09-22**
 *   - 判据：`CURRENT_STATE_VERSION − v31 ≥ 2` ⇒ **必须重跑核对**；此外 `wormholeStartBattle` 签名 /
 *     网格层 `grid.pos` 形态（`HexCell`，不是数组下标）一旦改动 ⇒ 也须重跑。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, serializeSaveFile, wormholeStartBattle } from '@whale/core'
import { buildSimContext } from '@whale/data'

const DIR = join(process.cwd(), 'docs', 'test-saves')
const SRC = 'test-save-wh-intercept-20260916-124604.json'

const file = JSON.parse(readFileSync(join(DIR, SRC), 'utf8')) as Record<string, unknown>
// 时间戳改成"刚刚" ⇒ 打开时没有离线结算（洞内战斗是瞬时态，被离线跑掉就白造了）
file.savedAtWallMs = Date.now()
const raw = (file.state ?? file) as Record<string, unknown>
raw.wallMs = Date.now()

const state = loadSaveFile(JSON.stringify(file)).state
const ctx = buildSimContext('zh')
const run = state.wormhole.run
if (!run) throw new Error('源档不在虫洞里')
const grid = run.grid
if (!grid) throw new Error('源档不是网格层（老线性层没有 place=ship 的格子）')

/** `pos` 是 `HexCell`（`{q,r}` 之类），不是数组下标 ⇒ 要按格键找"舰船信号"格 */
const cells = grid.cells
const keyOf = (c: { q?: number; r?: number; key?: string }): string => c.key ?? `${c.q},${c.r}`
console.log('当前位置：', JSON.stringify(grid.pos), ' 格键=', keyOf(grid.pos as never), ' 共', cells.length, '格')
const shipCell = cells.find((c) => c.place === 'ship')
console.log('舰船信号格：', shipCell ? keyOf(shipCell as never) : '(本层没有)')
if (!shipCell) throw new Error('这份档的网格里没有 place=ship 的格子')
grid.pos = shipCell

const r = wormholeStartBattle(state, ctx, 'node')
console.log('开打：', r.ok ? '成功' : `失败 ${r.errorId ?? ''} ${r.error ?? ''}`)
if (!r.ok) process.exit(1)
const b = state.wormhole.run?.battle
console.log(
  '战斗：距离=%s 单位=%s 我方=%s',
  Math.round(b?.distanceM ?? 0),
  Object.keys(b?.units ?? {}).join('/'),
  Object.values(b?.units ?? {})
    .filter((u) => u.side === 'me')
    .map((u) => u.name)
    .join(' + '),
)

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
const out = `test-save-wh-battle-${stamp}.json`
writeFileSync(join(DIR, out), serializeSaveFile(state, Date.now()), 'utf8')
console.log('已写出：docs/test-saves/' + out)
