/**
 * 交易所 Mock · 无头驱动（AI「低思考档」试玩批次，2026-11-03）
 *
 * 用途：不启动 Electron / 不接服务器 / 不改 UI，在 Node 里直接驱动
 * `features/exchange/mock/MockExchangeClient.ts`，产出可复现的场景快照与 AI 决策回放。
 *
 * 三种模式：
 *   npx tsx tools/_exchange-headless.ts --snapshot 20
 *       生成 20 份互相独立的场景（独立种子 + 独立暖场 tick），写
 *       `_exchange-scenarios.json` 与 `_exchange-scenarios-prompt.md`。
 *   npx tsx tools/_exchange-headless.ts --apply _exchange-scenarios-hold-actions.json
 *       读取 AI 决策（每份场景一个动作），逐份用同一种子重建场景、执行动作、
 *       手动推进 1440 拍（= 1 个「任务书分钟日」，见 forwardMinutes 注释），
 *       写 `_exchange-ai-result.json`。
 *   npx tsx tools/_exchange-headless.ts --selftest
 *       同种子连续生成两次快照，逐字节比对 JSON/Markdown，打印结果。
 *
 * 硬约束（与任务书一致）：
 * - 不新增依赖：只用 node: 内置模块；
 * - 不发起任何网络请求；
 * - 不修改既有文件、不改 package.json、不 commit；
 * - 所有随机都走 Mock 自己的 `createRng(seed)`（该文件本身禁止 Math.random）。
 *
 * 本文件是**一次性试玩探针**，`_` 前缀表示不入库为正规定时任务。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* ═══════════════════════ 常量与路径 ═══════════════════════ */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MOCK_ENTRY = resolve(
  ROOT,
  'apps/desktop/src/renderer/src/features/exchange/mock/MockExchangeClient.ts',
)
const SCENARIO_JSON = resolve(ROOT, '_exchange-scenarios.json')
const SCENARIO_PROMPT = resolve(ROOT, '_exchange-scenarios-prompt.md')
const RESULT_JSON = resolve(ROOT, '_exchange-ai-result.json')

/**
 * 冻结“现在”。
 *
 * 为什么必须冻结：Mock 构造函数用 `Date.now()` 决定 startTs，K 线历史/快照 ts 都跟它走；
 * 不冻结的话同种子两次运行的输出会差出实际耗时，`--selftest` 的逐字节一致就永远失败。
 * 取 2026-11-03 09:30（Asia/Shanghai）这个原型开张时刻，只是为了让时间戳读起来正常。
 */
const FIXED_NOW = Date.UTC(2026, 10, 3, 1, 30, 0)
/** 场景基线种子（不同场景再叠加 id × 104729，保证互不共享随机流） */
const BASE_SEED = 20261103
/** Mock 原型启动资金，见 MockExchangeClient.ts 的 START_CASH */
const START_CASH = 10_000_000
/**
 * 决策回放的推进拍数。
 *
 * 口径说明：Mock 的行情是「1 拍 = 1 秒」，同时 `TICKS_PER_GAME_DAY = 60`（60 拍 = 1 游戏日）。
 * 任务书写 `forwardMinutes(1440)`（1 游戏日），本工具把 1 个「分钟刻度」按 1 拍推进，
 * 因此 1440 拍 = 24 个游戏日（约 70 次随机事件、24 次分红），足以把持仓的浮动/强平风险跑出来；
 * 若按真实 1440 分钟 = 86400 拍，则 20 个场景的耗时和日志都会失控。
 */
const FORWARD_TICKS = 1440
const DEFAULT_SCENARIO_COUNT = 20
const MAX_SCENARIO_COUNT = 100
const CODES = ['SMHI', 'UGMC', 'OJLS', 'ABSI'] as const
const LEVERAGES = [2, 5, 10, 20, 50] as const

/* ═══════════════════════ 类型（只描述本工具用到的面） ═══════════════════════ */

type PreActionKind = 'none' | 'spot' | 'long' | 'short'

interface PreAction {
  kind: PreActionKind
  notional: number
  leverage: number
}

/** 场景配方：重建一份场景所需的最小、可序列化信息 */
interface ScenarioRecipe {
  id: number
  seed: number
  focus: string
  /** 暖场拍数：让每份场景停在不同的 tick / 行情状态 */
  warmupTicks: number
  /** 暖场后先做一笔“背景仓位”，再走这么多拍，让仓位带上浮动盈亏 */
  gapTicks: number
  preAction: PreAction
}

/** 无头驱动用到的 Mock 面（动态 import 后不做编译期类型绑定，避免把 renderer 类型拖进来） */
interface MockClient {
  contractVersion: number
  getSnapshot(code: string): {
    ts: number
    tick: number
    index: { value: number; changePct: number; high: number; low: number }
    stocks: StockQuoteLike[]
    quote: StockQuoteLike
    book: BookSnapshotLike
    account: AccountLike
    orders: unknown[]
    news: NewsLike[]
    feeRate: number
  }
  getAccount(): Promise<AccountLike>
  placeOrder(req: Record<string, unknown>): Promise<OrderLike>
  closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void>
  on(type: string, cb: (payload: unknown) => void): () => void
}

interface StockQuoteLike {
  code: string
  nameKey: string
  sector: string
  price: number
  open: number
  high: number
  low: number
  prevClose: number
  changePct: number
  volume24h: number
  maxLeverage: number
  shortable: boolean
  anchor: number
  floatShares: number
}

interface BookLevelLike {
  price: number
  qty: number
}

interface BookSnapshotLike {
  code: string
  bids: BookLevelLike[]
  asks: BookLevelLike[]
  ts: number
}

interface PositionLike {
  id: string
  code: string
  side: 'long' | 'short'
  qty: number
  avgEntry: number
  leverage: number
  margin: number
  unrealizedPnl: number
  liquidationPrice: number
  liquidationDistancePct?: number
}

interface HoldingLike {
  code: string
  qty: number
  avgCost: number
  value: number
  availableQty?: number
}

interface AccountLike {
  cash: number
  frozen: number
  debt: number
  equity: number
  marginRatio: number
  creditGrade: number
  positions: PositionLike[]
  pendingWithdrawals: unknown[]
  holdings: HoldingLike[]
}

interface NewsLike {
  id: string
  ts: number
  title: string
  body: string
  tone: 'good' | 'bad' | 'warn' | 'info'
  codes: string[]
}

interface OrderLike {
  id: string
  status: string
  filledQty?: number
  qty: number
  qtyRemaining: number
  avgFillPrice?: number
}

type ActionKind = 'buy_spot' | 'buy_long' | 'buy_short' | 'sell' | 'close' | 'hold'

interface AiAction {
  id: number
  action: ActionKind
  code: string
  notional?: number
  leverage?: number
}

interface ActionOutcome {
  executed: boolean
  filled: boolean
  status: string | null
  filledQty: number
  avgFillPrice: number | null
  closedQty: number
  error: { code: string; message: string } | null
  note: string
}

/* ═══════════════════════ Node / 浏览器 shim ═══════════════════════ */

/**
 * 内存版 localStorage：Mock 的 `readPersisted()` / `persist()` 只认这几个方法。
 * 每建一个场景前清空，保证 20 份场景互相独立、不会读到上一份的持久化状态。
 */
class MemoryStorage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
}

let memoryStorage: MemoryStorage | null = null

/**
 * 必须在动态 import Mock 之前调用。
 *
 * 覆盖点来自 Mock 的四个浏览器依赖：
 * - `window.setInterval`：构造函数里 `startEngine()` 会立刻建 1 秒定时器（模块单例常驻语义）。
 *   无头模式要**手动时钟**，所以 shim 成“只发一个 id、不真正调度”的假定时器；
 *   否则进程会被 interval 吊住，且真实时钟会与 Date.now 冻结产生错位。
 * - `window.addEventListener('pagehide')`：页面卸载落盘，无头不需要。
 * - `document.visibilityState` + `visibilitychange`：切前台补算，无头不需要（永不触发）。
 * - `window.localStorage`：Mock 的模拟盘持久化；这里给内存版，场景之间手动 clear()。
 */
function installBrowserShims(): void {
  const g = globalThis as Record<string, unknown>
  let timerSeq = 0
  const storage = new MemoryStorage()
  memoryStorage = storage

  Date.now = () => FIXED_NOW

  g.window = globalThis
  g.localStorage = storage
  g.setInterval = () => {
    timerSeq += 1
    return timerSeq
  }
  g.clearInterval = () => {
    /* 假定时器没有真实句柄，clear 是空操作 */
  }
  g.addEventListener = () => {
    /* pagehide 等事件在无头模式不会发生 */
  }
  g.removeEventListener = () => {
    /* 同上 */
  }
  g.document = {
    visibilityState: 'visible',
    addEventListener: () => {
      /* visibilitychange 永不触发 */
    },
    removeEventListener: () => {
      /* 同上 */
    },
  }
}

function clearStorage(): void {
  memoryStorage?.clear()
}

/* ═══════════════════════ Mock 装载与手动时钟 ═══════════════════════ */

type MockCtor = new (seed?: number) => MockClient
let MockClass: MockCtor | null = null

async function loadMockClass(): Promise<MockCtor> {
  if (MockClass) return MockClass
  const mod = (await import(pathToFileURL(MOCK_ENTRY).href)) as { MockExchangeClient?: MockCtor }
  if (typeof mod.MockExchangeClient !== 'function') {
    throw new Error(`无法从 ${MOCK_ENTRY} 找到 MockExchangeClient 导出`)
  }
  MockClass = mod.MockExchangeClient
  return MockClass
}

/**
 * 建一个干净的 Mock 实例，并**立刻接管时钟**。
 *
 * 风险提示：`advance()` 是 TypeScript `private`，只在编译期受限，运行时仍可调用。
 * 这是本工具唯一依赖私有实现的地方；Mock 若把 `advance` 改名/改成异步/改签名，
 * 本工具会直接报错（好过静默丢拍）。见 `_exchangeheadless-run.md` 的已知风险。
 */
async function newMockClient(seed: number): Promise<MockClient> {
  clearStorage()
  const Ctor = await loadMockClass()
  const client = new Ctor(seed)
  // 双保险：shim 的 setInterval 已是假定时器，这里再把私有 timer 置空，
  // 明确表示“引擎由本工具手动推进”，任何后续 start() 也不会创建真实定时器。
  const anyClient = client as unknown as { timer: number | null }
  if (anyClient.timer !== null) {
    ;(globalThis as unknown as { clearInterval: (id: number) => void }).clearInterval(anyClient.timer)
    anyClient.timer = null
  }
  return client
}

/** 手动推进 n 拍（唯一私有 API 入口；n 必须为正整数） */
function advance(client: MockClient, n: number): void {
  if (!Number.isInteger(n) || n <= 0) return
  ;(client as unknown as { advance: (count: number) => void }).advance(n)
}

/**
 * 任务书要求的 `forwardMinutes(n)`：把 n 个“分钟刻度”推进为 n 拍。
 * 口径与取舍见文件头 `FORWARD_TICKS` 注释。
 */
function forwardMinutes(client: MockClient, n: number): void {
  advance(client, n)
}

/* ═══════════════════════ 数字与文本格式 ═══════════════════════ */

function r2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function r4(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 固定 2 位小数 + 千分位（不依赖 Intl，保证任何 Node locale 下文本一致） */
function fmt2(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  const negative = v < 0
  const [intPart, decPart] = Math.abs(v).toFixed(2).split('.')
  return `${negative ? '-' : ''}${group(intPart ?? '0')}.${decPart ?? '00'}`
}

/** 整数千分位（股数 / 成交量） */
function fmtInt(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  const negative = v < 0
  return `${negative ? '-' : ''}${group(String(Math.abs(v)))}`
}

function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${r2(n).toFixed(2)}%`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 本机时区的 HH:MM:SS（与原型页面 `format.clock` 同口径） */
function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/* ═══════════════════════ 场景配方 ═══════════════════════ */

/**
 * 生成第 id 份场景的配方（纯函数，只依赖 id）。
 *
 * 独立性：种子 = 基线 + id × 104729（质数步长，避免相邻种子的随机流相近），
 * 每份都 new 一个 Mock 实例，互不共享 Map / RNG / localStorage。
 * 差异性：暖场 tick 随 id 增长（约 67～884 拍），预热动作按 id % 4 轮换
 * （空仓 / 现货 / 多 / 空），让场景卡里的账户状态也有变化。
 */
function recipeFor(id: number): ScenarioRecipe {
  const focus = CODES[(id - 1) % CODES.length]!
  const kindIndex = id % 4 // 1=spot, 2=long, 3=short, 0=none
  const kind: PreActionKind =
    kindIndex === 0 ? 'none' : kindIndex === 1 ? 'spot' : kindIndex === 2 ? 'long' : 'short'
  const notional =
    kind === 'spot' ? 250_000 + (id % 5) * 120_000 : 90_000 + ((id * 3) % 4) * 55_000
  // 预热仓位只为让 sell/close 有对象可操作，不代表 AI 的杠杆选择：
  // 只用 2x/5x，且快照间隔压到 3~6 拍，避免暖场波动在快照前就把仓位打掉
  //（否则卡上写着“预热开空 20x”，持仓栏却是空的）。
  const leverage = id % 2 === 0 ? 5 : 2
  return {
    id,
    seed: (BASE_SEED + id * 104729) >>> 0,
    focus,
    warmupTicks: 24 + id * 43,
    gapTicks: 3 + ((id * 5) % 4),
    preAction: { kind, notional, leverage },
  }
}

/* ═══════════════════════ 场景重建 ═══════════════════════ */

/**
 * 暖场交易：模拟“玩家进场前已经有的仓位”，让 `sell` / `close` 有对象可操作。
 * 用市价单，数量按当前盘口第一档折算；同一配方在 --snapshot 与 --apply 中走同一函数，
 * 因此重建结果逐位一致。
 */
async function runPreAction(client: MockClient, recipe: ScenarioRecipe): Promise<void> {
  const pre = recipe.preAction
  if (pre.kind === 'none') return
  const snap = client.getSnapshot(recipe.focus)
  const fee = snap.feeRate
  const ask = snap.book.asks[0]?.price ?? snap.quote.price
  const bid = snap.book.bids[0]?.price ?? snap.quote.price
  if (pre.kind === 'spot') {
    const qty = Math.max(1, Math.floor(pre.notional / (ask * (1 + fee))))
    await client.placeOrder({
      clientOrderId: `SETUP-${recipe.id}-spot`,
      code: recipe.focus,
      side: 'buy',
      type: 'market',
      tif: 'IOC',
      qty,
    })
    return
  }
  const side = pre.kind === 'long' ? 'buy' : 'sell'
  const ref = pre.kind === 'long' ? ask : bid
  const qty = Math.max(1, Math.floor(pre.notional / (ref * (1 / pre.leverage + fee))))
  await client.placeOrder({
    clientOrderId: `SETUP-${recipe.id}-${pre.kind}`,
    code: recipe.focus,
    side,
    type: 'market',
    tif: 'IOC',
    qty,
    leverage: pre.leverage,
  })
}

/** 按配方重建到快照时点：暖场 tick → 背景仓位 → 再走 gap 拍 */
async function buildClientFromRecipe(recipe: ScenarioRecipe): Promise<MockClient> {
  const client = await newMockClient(recipe.seed)
  advance(client, recipe.warmupTicks)
  await runPreAction(client, recipe)
  advance(client, recipe.gapTicks)
  return client
}

/**
 * 状态指纹：重建场景后先比对，确认 Mock 实现没变。
 * 只取对后续决策有影响的状态（tick/价格/现金/持仓/快讯 id），
 * 不含 K 线等大体量缓存。
 */
async function fingerprint(client: MockClient, focus: string): Promise<string> {
  const snapshot = client.getSnapshot(focus)
  const account = await client.getAccount()
  const payload = {
    tick: snapshot.tick,
    prices: snapshot.stocks.map((s) => [s.code, r2(s.price)]),
    cash: r2(account.cash),
    holdings: account.holdings.map((h) => [h.code, h.qty, r2(h.avgCost)]),
    positions: account.positions.map((p) => [
      p.code,
      p.side,
      p.qty,
      r2(p.avgEntry),
      p.leverage,
    ]),
    news: snapshot.news.map((n) => n.id),
  }
  return sha256(JSON.stringify(payload)).slice(0, 16)
}

/* ═══════════════════════ 场景快照 ═══════════════════════ */

interface Scenario {
  id: number
  focus: string
  fingerprint: string
  recipe: ScenarioRecipe
  tick: number
  ts: number
  index: { value: number; changePct: number; high: number; low: number }
  stocks: StockQuoteLike[]
  books: Record<string, BookSnapshotLike>
  account: AccountLike
  orders: unknown[]
  news: NewsLike[]
}

async function buildScenario(id: number): Promise<Scenario> {
  const recipe = recipeFor(id)
  const client = await buildClientFromRecipe(recipe)
  const snapshot = client.getSnapshot(recipe.focus)

  const books: Record<string, BookSnapshotLike> = {}
  for (const code of CODES) books[code] = client.getSnapshot(code).book

  const acc = snapshot.account
  const account: AccountLike = {
    cash: r2(acc.cash),
    frozen: r2(acc.frozen),
    debt: r2(acc.debt),
    equity: r2(acc.equity),
    marginRatio: r4(acc.marginRatio),
    creditGrade: acc.creditGrade,
    pendingWithdrawals: [],
    positions: acc.positions.map((p) => ({
      ...p,
      avgEntry: r2(p.avgEntry),
      margin: r2(p.margin),
      unrealizedPnl: r2(p.unrealizedPnl),
      liquidationPrice: r2(p.liquidationPrice),
      liquidationDistancePct: r2(p.liquidationDistancePct ?? 0),
    })),
    holdings: acc.holdings.map((h) => ({
      ...h,
      avgCost: r2(h.avgCost),
      value: r2(h.value),
    })),
  }

  return {
    id,
    focus: recipe.focus,
    fingerprint: await fingerprint(client, recipe.focus),
    recipe,
    tick: snapshot.tick,
    ts: snapshot.ts,
    index: {
      value: r2(snapshot.index.value),
      changePct: r4(snapshot.index.changePct),
      high: r2(snapshot.index.high),
      low: r2(snapshot.index.low),
    },
    stocks: snapshot.stocks.map((s) => ({
      code: s.code,
      nameKey: s.nameKey,
      sector: s.sector,
      price: r2(s.price),
      open: r2(s.open),
      high: r2(s.high),
      low: r2(s.low),
      prevClose: r2(s.prevClose),
      changePct: r4(s.changePct),
      volume24h: Math.round(s.volume24h),
      maxLeverage: s.maxLeverage,
      shortable: s.shortable,
      anchor: r2(s.anchor),
      floatShares: s.floatShares,
    })),
    books: Object.fromEntries(
      CODES.map((code) => [
        code,
        {
          code,
          bids: books[code]!.bids.map((l) => ({ price: r2(l.price), qty: l.qty })),
          asks: books[code]!.asks.map((l) => ({ price: r2(l.price), qty: l.qty })),
          ts: books[code]!.ts,
        },
      ]),
    ),
    account,
    orders: snapshot.orders,
    news: snapshot.news.slice(0, 3).map((n) => ({ ...n })),
  }
}

/* ═══════════════════════ Markdown 场景卡 ═══════════════════════ */

const ACTION_LEGEND =
  'buy_spot（市价买现货）｜buy_long（市价开多）｜buy_short（市价开空）｜sell（市价卖现货）｜close（市价平杠杆仓）｜hold（不操作）'

function describePreAction(recipe: ScenarioRecipe): string {
  const pre = recipe.preAction
  if (pre.kind === 'none') return '无（空仓入场）'
  if (pre.kind === 'spot') return `市价买入 ${recipe.focus} 现货 ${fmtInt(pre.notional)} cr`
  return `市价开${pre.kind === 'long' ? '多' : '空'} ${recipe.focus} ${pre.leverage}x，保证金 ${fmtInt(pre.notional)} cr`
}

function renderBookLines(code: string, book: BookSnapshotLike): string[] {
  const one = (side: string, levels: BookLevelLike[]): string =>
    `- ${code} ${side} ${levels.map((l) => `${fmt2(l.price)}×${fmtInt(l.qty)}`).join(' ')}`
  return [one('买', book.bids), one('卖', book.asks)]
}

function renderScenarioCard(sc: Scenario): string {
  const lines: string[] = []
  lines.push(`## 场景 ${pad2(sc.id)} ｜ 焦点 ${sc.focus} ｜ tick ${sc.tick}`)
  lines.push(
    `> 种子 ${sc.recipe.seed} · 暖场 ${sc.recipe.warmupTicks} 拍 · 预热动作：${describePreAction(sc.recipe)} · 快照间隔 ${sc.recipe.gapTicks} 拍 · 指纹 ${sc.fingerprint}`,
  )
  lines.push(
    `指数 ${fmt2(sc.index.value)}（${signedPct(sc.index.changePct)}）｜四家标的现价与涨跌：`,
  )

  for (const s of sc.stocks) {
    lines.push(
      `- ${s.code} ${s.nameKey}/${s.sector} 现价 ${fmt2(s.price)} 涨跌 ${signedPct(s.changePct)} 开 ${fmt2(s.open)} 高 ${fmt2(s.high)} 低 ${fmt2(s.low)}`,
    )
  }

  lines.push('五档盘口（价格×股数）：')
  for (const code of CODES) lines.push(...renderBookLines(code, sc.books[code]!))

  const marginUsed = sc.account.positions.reduce((sum, p) => sum + p.margin, 0)
  const holdingsValue = sc.account.holdings.reduce((sum, h) => sum + h.value, 0)
  lines.push(
    `账户：现金 ${fmt2(sc.account.cash)} · 权益 ${fmt2(sc.account.equity)} · 冻结 ${fmt2(sc.account.frozen)} · 保证金占用 ${fmt2(marginUsed)} · 现货市值 ${fmt2(holdingsValue)}`,
  )

  if (sc.account.positions.length === 0) {
    lines.push('持仓（杠杆）：无')
  } else {
    for (const p of sc.account.positions) {
      lines.push(
        `持仓（杠杆）：${p.code} ${p.side === 'long' ? '多' : '空'} ${fmtInt(p.qty)} 股 @ ${fmt2(p.avgEntry)} ${p.leverage}x · 保证金 ${fmt2(p.margin)} · 浮盈 ${fmt2(p.unrealizedPnl)} · 强平价 ${fmt2(p.liquidationPrice)}（距 ${fmt2(p.liquidationDistancePct ?? 0)}%）`,
      )
    }
  }

  if (sc.account.holdings.length === 0) {
    lines.push('现货：无')
  } else {
    for (const h of sc.account.holdings) {
      lines.push(
        `现货：${h.code} ${fmtInt(h.qty)} 股 @ 成本 ${fmt2(h.avgCost)} · 市值 ${fmt2(h.value)} · 可卖 ${fmtInt(h.availableQty ?? 0)}`,
      )
    }
  }

  lines.push('快讯（最近 3 条）：')
  if (sc.news.length === 0) lines.push('- 无')
  else
    for (const n of sc.news) {
      lines.push(`- ${formatClock(n.ts)} [${n.tone}] ${n.title}：${n.body}`)
    }

  lines.push(`可选动作：${ACTION_LEGEND}`)
  lines.push(
    `参数：code ∈ ${CODES.join(' / ')}；notional=信用点（现货=买入额，杠杆=保证金，默认 200000）；leverage ∈ 2 / 5 / 10 / 20 / 50（默认 5）`,
  )
  lines.push(
    `作答：{"id":${sc.id},"action":"buy_spot","code":"${sc.focus}","notional":200000,"leverage":5}`,
  )
  return lines.join('\n')
}

function renderPromptHeader(count: number): string {
  return [
    '# 交易所 Mock · AI 试玩场景卡',
    '',
    `- 来源：\`tools/_exchange-headless.ts --snapshot ${count}\`（无头驱动 Mock，虚拟资金，不写游戏存档）`,
    `- 场景数：${count}；每份独立种子、独立暖场 tick，账户与行情状态互不共享。`,
    `- 时间口径：1 拍 = 1 秒；Mock 内 60 拍 = 1 游戏日。回放窗口 1440 拍 = 24 个游戏日。`,
    '- 每份场景只能选 **一个** 动作；`id` 必须与场景号一致。',
    '- `notional` 表示信用点：现货买入=投入金额，杠杆开仓=投入保证金；可选，默认 200000。',
    '- `leverage` 只能取 2 / 5 / 10 / 20 / 50；UGMC、OJLS 最高 20x。',
    '- `sell` 的 `notional` 可选：省略=卖掉该标的全部可卖现货。`close` 不需要 notional/leverage。',
    '- `hold` 可只写 `{"id":N,"action":"hold","code":"SMHI"}` 占位。',
    '',
    '批量作答格式（JSON 数组或包一层 `actions` 都可）：',
    '```json',
    '{ "actions": [ {"id":1,"action":"hold","code":"SMHI"} ] }',
    '```',
    '',
    '---',
    '',
  ].join('\n')
}

function renderPrompt(scenarios: Scenario[]): string {
  const cards = scenarios.map((s) => renderScenarioCard(s)).join('\n\n---\n\n')
  return `${renderPromptHeader(scenarios.length)}${cards}\n`
}

/* ═══════════════════════ --snapshot ═══════════════════════ */

interface ScenarioBundle {
  data: Record<string, unknown>
  jsonText: string
  promptText: string
  scenarios: Scenario[]
}

async function buildScenarios(count: number): Promise<ScenarioBundle> {
  const scenarios: Scenario[] = []
  for (let id = 1; id <= count; id++) {
    const scenario = await buildScenario(id)
    scenarios.push(scenario)
    console.log(
      `[snapshot] ${id}/${count} tick=${scenario.tick} focus=${scenario.focus} equity=${fmt2(scenario.account.equity)} 指纹=${scenario.fingerprint}`,
    )
  }
  const data: Record<string, unknown> = {
    meta: {
      format: 'exchange-scenarios/v1',
      generatedBy: 'tools/_exchange-headless.ts',
      note: '交易所 Mock 无头场景快照：每份独立种子，可用 --apply 按 recipe 逐份重建。',
      contractVersion: 1,
      fixedNow: FIXED_NOW,
      fixedNowLocal: '2026-11-03 09:30:00 +08:00',
      baseSeed: BASE_SEED,
      count,
      mockSaveKey: 'whale-idle:exch-mock',
      forwardTicks: FORWARD_TICKS,
      ticksPerGameDay: 60,
      actionsSchema: {
        id: '1..N，与场景 id 一致',
        action: ['buy_spot', 'buy_long', 'buy_short', 'sell', 'close', 'hold'],
        code: [...CODES],
        notional: 'number，可选；现货=投入信用点，杠杆=保证金',
        leverage: [...LEVERAGES],
      },
    },
    scenarios,
  }
  const jsonText = `${JSON.stringify(data, null, 2)}\n`
  const promptText = renderPrompt(scenarios)
  return { data, jsonText, promptText, scenarios }
}

async function runSnapshot(count: number): Promise<void> {
  const startedAt = performance.now()
  const bundle = await buildScenarios(count)
  writeFileSync(SCENARIO_JSON, bundle.jsonText, 'utf8')
  writeFileSync(SCENARIO_PROMPT, bundle.promptText, 'utf8')
  const elapsed = performance.now() - startedAt
  const jsonBytes = Buffer.byteLength(bundle.jsonText, 'utf8')
  const promptBytes = Buffer.byteLength(bundle.promptText, 'utf8')
  console.log(`[snapshot] 写入 ${SCENARIO_JSON}（${jsonBytes} 字节）`)
  console.log(`[snapshot] 写入 ${SCENARIO_PROMPT}（${promptBytes} 字节）`)
  console.log(`[snapshot] 完成：${count} 份，耗时 ${elapsed.toFixed(0)} ms`)
  console.log('[snapshot] 场景卡样例（前 15 行）：')
  console.log(
    bundle.promptText
      .split('\n')
      .slice(0, 15)
      .map((line) => `  ${line}`)
      .join('\n'),
  )
}

/* ═══════════════════════ --selftest ═══════════════════════ */

async function runSelftest(): Promise<void> {
  const startedAt = performance.now()
  console.log('[selftest] 第一次生成 20 份场景…')
  const first = await buildScenarios(DEFAULT_SCENARIO_COUNT)
  console.log('[selftest] 第二次生成 20 份场景…')
  const second = await buildScenarios(DEFAULT_SCENARIO_COUNT)

  const jsonSame = first.jsonText === second.jsonText
  const promptSame = first.promptText === second.promptText
  const jsonBytes = Buffer.from(first.jsonText, 'utf8')
  const promptBytes = Buffer.from(first.promptText, 'utf8')
  const jsonByteSame = jsonBytes.equals(Buffer.from(second.jsonText, 'utf8'))
  const promptByteSame = promptBytes.equals(Buffer.from(second.promptText, 'utf8'))
  const ticks = first.scenarios.map((s) => s.tick)
  const uniqueTicks = new Set(ticks).size

  console.log(`[selftest] JSON 字符串一致: ${jsonSame}；UTF-8 字节一致: ${jsonByteSame}`)
  console.log(`[selftest] Markdown 字符串一致: ${promptSame}；UTF-8 字节一致: ${promptByteSame}`)
  console.log(
    `[selftest] 场景数=${first.scenarios.length} 唯一 tick 数=${uniqueTicks} tick 区间=[${Math.min(...ticks)}, ${Math.max(...ticks)}]`,
  )
  console.log(`[selftest] JSON SHA-256: ${sha256(first.jsonText)}`)
  console.log(`[selftest] Markdown SHA-256: ${sha256(first.promptText)}`)

  const pass = jsonSame && promptSame && jsonByteSame && promptByteSame
  const elapsed = performance.now() - startedAt
  console.log(`[selftest] 结果: ${pass ? 'PASS（逐字节一致）' : 'FAIL（两次输出不一致）'}，耗时 ${elapsed.toFixed(0)} ms`)
  if (!pass) process.exitCode = 1
}

/* ═══════════════════════ --apply ═══════════════════════ */

function parseActionList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions)) {
    return (raw as { actions: unknown[] }).actions
  }
  throw new Error('动作文件必须是 JSON 数组，或 {"actions":[...]} 对象')
}

function normalizeAction(raw: unknown, validIds: Set<number>): AiAction {
  if (!raw || typeof raw !== 'object') throw new Error('动作项必须是对象')
  const item = raw as Record<string, unknown>
  const id = Number(item.id)
  if (!Number.isInteger(id) || !validIds.has(id)) {
    throw new Error(`动作 id 非法：${String(item.id)}（应为 1..${Math.max(...validIds)}）`)
  }
  const action = String(item.action ?? '') as ActionKind
  if (!['buy_spot', 'buy_long', 'buy_short', 'sell', 'close', 'hold'].includes(action)) {
    throw new Error(`场景 ${id} 的 action 非法：${String(item.action)}`)
  }
  const code = item.code === undefined || item.code === null ? '' : String(item.code)
  if (action === 'hold') {
    return { id, action, code: CODES.includes(code as (typeof CODES)[number]) ? code : 'SMHI' }
  }
  if (!CODES.includes(code as (typeof CODES)[number])) {
    throw new Error(`场景 ${id} 的 code 非法：${code || '(缺失)'}（应为 ${CODES.join('/')}）`)
  }
  const out: AiAction = { id, action, code }
  if (item.notional !== undefined && item.notional !== null) {
    const notional = Number(item.notional)
    if (!Number.isFinite(notional) || notional <= 0) {
      throw new Error(`场景 ${id} 的 notional 非法：${String(item.notional)}`)
    }
    out.notional = notional
  }
  if (item.leverage !== undefined && item.leverage !== null) {
    const leverage = Number(item.leverage)
    if (!LEVERAGES.includes(leverage as (typeof LEVERAGES)[number])) {
      throw new Error(`场景 ${id} 的 leverage 非法：${String(item.leverage)}（应为 ${LEVERAGES.join('/')}）`)
    }
    out.leverage = leverage
  }
  return out
}

function readActions(path: string, validIds: Set<number>): Map<number, AiAction> {
  if (!existsSync(path)) throw new Error(`动作文件不存在：${path}`)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  const list = parseActionList(raw)
  const byId = new Map<number, AiAction>()
  for (const entry of list) {
    const action = normalizeAction(entry, validIds)
    if (byId.has(action.id)) throw new Error(`动作 id 重复：${action.id}`)
    byId.set(action.id, action)
  }
  return byId
}

function errorOf(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const anyError = error as { code?: unknown; message?: unknown }
    return {
      code: typeof anyError.code === 'string' ? anyError.code : 'unknown',
      message: typeof anyError.message === 'string' ? anyError.message : String(error),
    }
  }
  return { code: 'unknown', message: String(error) }
}

/**
 * 在当前场景状态执行一个 AI 动作。
 * 买入一律用市价单：Mock 的杠杆单是 IOC（吃不完即撤），限价不穿价会直接报 no_liquidity，
 * 对“低思考档 AI”的验收没有意义；市价单更接近“想买就买”的决策语义。
 */
async function executeAction(
  client: MockClient,
  scenario: Scenario,
  action: AiAction,
): Promise<ActionOutcome> {
  if (action.action === 'hold') {
    return {
      executed: true,
      filled: false,
      status: 'hold',
      filledQty: 0,
      avgFillPrice: null,
      closedQty: 0,
      error: null,
      note: '不操作',
    }
  }

  const code = action.code
  const snap = client.getSnapshot(code)
  const quote = snap.stocks.find((s) => s.code === code) ?? snap.quote
  const fee = snap.feeRate
  const ask = snap.book.asks[0]?.price ?? quote.price
  const bid = snap.book.bids[0]?.price ?? quote.price
  const account = await client.getAccount()

  if (action.action === 'buy_spot') {
    const notional = action.notional ?? 200_000
    const qty = Math.floor(notional / (ask * (1 + fee)))
    if (qty < 1) throw new Error(`资金不足：${fmtInt(notional)} cr 买不到 1 股 ${code}`)
    const order = await client.placeOrder({
      clientOrderId: `AI-${scenario.id}-buy_spot`,
      code,
      side: 'buy',
      type: 'market',
      tif: 'IOC',
      qty,
    })
    return orderOutcome(order, '市价买入现货')
  }

  if (action.action === 'buy_long' || action.action === 'buy_short') {
    const leverage = action.leverage ?? 5
    if (leverage > quote.maxLeverage) {
      throw new Error(`杠杆超限：${code} 最高 ${quote.maxLeverage}x，请求 ${leverage}x`)
    }
    const notional = action.notional ?? 200_000
    const ref = action.action === 'buy_long' ? ask : bid
    const qty = Math.floor(notional / (ref * (1 / leverage + fee)))
    if (qty < 1) throw new Error(`保证金不足：${fmtInt(notional)} cr 开不到 1 股 ${code}`)
    const order = await client.placeOrder({
      clientOrderId: `AI-${scenario.id}-${action.action}`,
      code,
      side: action.action === 'buy_long' ? 'buy' : 'sell',
      type: 'market',
      tif: 'IOC',
      qty,
      leverage,
    })
    return orderOutcome(order, `市价开${action.action === 'buy_long' ? '多' : '空'} ${leverage}x`)
  }

  if (action.action === 'sell') {
    const holding = account.holdings.find((h) => h.code === code)
    const available = holding?.availableQty ?? holding?.qty ?? 0
    if (available < 1) throw new Error(`没有可卖现货：${code}`)
    const qty =
      action.notional === undefined
        ? Math.floor(available)
        : Math.min(Math.floor(available), Math.floor(action.notional / bid))
    if (qty < 1) throw new Error(`卖出数量不足：${code} 可卖 ${fmtInt(available)} 股`)
    const order = await client.placeOrder({
      clientOrderId: `AI-${scenario.id}-sell`,
      code,
      side: 'sell',
      type: 'market',
      tif: 'IOC',
      qty,
    })
    return orderOutcome(order, '市价卖出')
  }

  // close
  const candidates = account.positions.filter((p) => p.code === code)
  if (candidates.length === 0) throw new Error(`没有可平仓位：${code}`)
  const position = [...candidates].sort((a, b) => b.qty - a.qty)[0]!
  await client.closePosition(code, position.side, position.qty)
  return {
    executed: true,
    filled: true,
    status: 'closed',
    filledQty: position.qty,
    avgFillPrice: null,
    closedQty: position.qty,
    error: null,
    note: `市价平${position.side === 'long' ? '多' : '空'} ${position.leverage}x`,
  }
}

function orderOutcome(order: OrderLike, note: string): ActionOutcome {
  return {
    executed: true,
    filled: (order.filledQty ?? 0) > 0,
    status: order.status,
    filledQty: order.filledQty ?? order.qty - order.qtyRemaining,
    avgFillPrice: order.avgFillPrice === undefined ? null : r2(order.avgFillPrice),
    closedQty: 0,
    error: null,
    note,
  }
}

interface TrackResult {
  marginCalls: Array<{ code: string; side: 'long' | 'short'; qty: number; fullyClosed: boolean }>
  maxDrawdown: number
  maxDrawdownPct: number
  peakEquity: number
  troughEquity: number
}

/**
 * 推进 N 拍并逐拍记录权益。
 *
 * 为什么逐拍 `advance(1)` 而不是一次 `advance(1440)`：
 * ① 最大回撤需要权益曲线，只有逐拍采样才准确；
 * ② Mock 的 `advance(count)` 在 count>1 时置 silent=true，会**抑制 margin_call 广播**，
 *    一次推进就检测不到爆仓。逐拍调用的开销可接受（见运行记录）。
 */
async function forwardWithTracking(client: MockClient, ticks: number, startEquity: number): Promise<TrackResult> {
  const marginCalls: TrackResult['marginCalls'] = []
  const unsubscribe = client.on('margin_call', (payload) => {
    const p = payload as { code?: string; side?: 'long' | 'short'; qty?: number; fullyClosed?: boolean }
    marginCalls.push({
      code: p.code ?? '',
      side: p.side ?? 'long',
      qty: p.qty ?? 0,
      fullyClosed: p.fullyClosed === true,
    })
  })

  let peak = startEquity
  let trough = startEquity
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (let i = 0; i < ticks; i++) {
    forwardMinutes(client, 1)
    const equity = (await client.getAccount()).equity
    if (equity > peak) peak = equity
    if (equity < trough) trough = equity
    const drawdown = peak - equity
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0
    }
  }
  unsubscribe()
  return { marginCalls, maxDrawdown, maxDrawdownPct, peakEquity: peak, troughEquity: trough }
}

function summarizePositions(account: AccountLike): unknown[] {
  return account.positions.map((p) => ({
    code: p.code,
    side: p.side,
    qty: p.qty,
    avgEntry: r2(p.avgEntry),
    leverage: p.leverage,
    margin: r2(p.margin),
    unrealizedPnl: r2(p.unrealizedPnl),
    liquidationPrice: r2(p.liquidationPrice),
  }))
}

async function runApply(actionsPath: string): Promise<void> {
  if (!existsSync(SCENARIO_JSON)) {
    throw new Error(`找不到 ${SCENARIO_JSON}，请先运行 --snapshot ${DEFAULT_SCENARIO_COUNT}`)
  }
  const data = JSON.parse(readFileSync(SCENARIO_JSON, 'utf8')) as {
    meta?: { format?: string }
    scenarios?: Scenario[]
  }
  if (data.meta?.format !== 'exchange-scenarios/v1' || !Array.isArray(data.scenarios)) {
    throw new Error('场景文件格式不符（meta.format 应为 exchange-scenarios/v1）')
  }
  const scenarios = data.scenarios
  const validIds = new Set(scenarios.map((s) => s.id))
  const actions = readActions(actionsPath, validIds)
  const startedAt = performance.now()
  const results: unknown[] = []
  let executedCount = 0
  let filledCount = 0
  let blownUpCount = 0

  for (const [index, scenario] of scenarios.entries()) {
    const action =
      actions.get(scenario.id) ??
      ({ id: scenario.id, action: 'hold', code: 'SMHI' } satisfies AiAction)
    const label = `[apply] ${index + 1}/${scenarios.length} 场景 ${scenario.id} ${action.action} ${action.code}`
    console.log(`${label} 重建中…`)

    const client = await buildClientFromRecipe(scenario.recipe)
    const rebuiltFingerprint = await fingerprint(client, scenario.focus)
    if (rebuiltFingerprint !== scenario.fingerprint) {
      throw new Error(
        `场景 ${scenario.id} 重建指纹不一致（文件 ${scenario.fingerprint} / 实际 ${rebuiltFingerprint}）：Mock 实现可能已变更，请重跑 --snapshot ${scenarios.length}`,
      )
    }

    const before = await client.getAccount()
    let outcome: ActionOutcome
    try {
      outcome = await executeAction(client, scenario, action)
    } catch (error) {
      const info = errorOf(error)
      outcome = {
        executed: false,
        filled: false,
        status: 'error',
        filledQty: 0,
        avgFillPrice: null,
        closedQty: 0,
        error: info,
        note: '执行失败',
      }
    }
    const after = await client.getAccount()
    const track = await forwardWithTracking(client, FORWARD_TICKS, after.equity)
    const end = await client.getAccount()

    const liquidated = track.marginCalls.length > 0
    const liquidatedFully = track.marginCalls.some((c) => c.fullyClosed)
    const blownUp = liquidatedFully || end.equity <= 0
    const pnl = end.equity - after.equity
    const result = {
      id: scenario.id,
      focus: scenario.focus,
      recipe: scenario.recipe,
      tickStart: scenario.tick,
      tickEnd: scenario.tick + FORWARD_TICKS,
      action,
      executed: outcome.executed,
      filled: outcome.filled,
      orderStatus: outcome.status,
      filledQty: outcome.filledQty,
      avgFillPrice: outcome.avgFillPrice,
      closedQty: outcome.closedQty,
      error: outcome.error,
      note: outcome.note,
      equityBeforeAction: r2(before.equity),
      equityAfterAction: r2(after.equity),
      equityEnd: r2(end.equity),
      pnl: r2(pnl),
      pnlPct: r4(after.equity > 0 ? (pnl / after.equity) * 100 : 0),
      totalPnl: r2(end.equity - START_CASH),
      marginCallCount: track.marginCalls.length,
      liquidated,
      liquidatedFully,
      blownUp,
      maxDrawdown: r2(track.maxDrawdown),
      maxDrawdownPct: r4(track.maxDrawdownPct),
      peakEquity: r2(track.peakEquity),
      troughEquity: r2(track.troughEquity),
      positionsStart: summarizePositions(before),
      positionsEnd: summarizePositions(end),
      holdingsEnd: end.holdings.map((h) => ({
        code: h.code,
        qty: h.qty,
        avgCost: r2(h.avgCost),
        value: r2(h.value),
      })),
    }
    results.push(result)

    if (outcome.executed) executedCount += 1
    if (outcome.filled) filledCount += 1
    if (blownUp) blownUpCount += 1
    const filledText = outcome.filled ? '成交' : '未成交'
    const errorText = outcome.error ? `（${outcome.error.code}: ${outcome.error.message}）` : ''
    console.log(
      `  ${label} ${filledText}${errorText} 期末权益 ${fmt2(end.equity)} 盈亏 ${fmt2(pnl)} 回撤 ${fmt2(track.maxDrawdownPct)}% 强平 ${track.marginCalls.length} 次`,
    )
  }

  const meta = {
    format: 'exchange-ai-result/v1',
    generatedBy: 'tools/_exchange-headless.ts',
    note: '每个场景在快照时点执行一个动作，然后手动推进 1440 拍（24 个游戏日）。pnl 是动作后权益到期末权益的差；totalPnl 相对 10,000,000 初始资金。',
    actionsFile: actionsPath,
    scenarioFile: SCENARIO_JSON,
    scenarioCount: scenarios.length,
    forwardTicks: FORWARD_TICKS,
    startCash: START_CASH,
    definitions: {
      pnl: 'equityEnd - equityAfterAction（本次动作持有期盈亏）',
      totalPnl: 'equityEnd - 10,000,000',
      maxDrawdown: '动作后权益曲线的最大峰值回撤（信用点，正数）',
      maxDrawdownPct: '最大回撤百分比（正数）',
      blownUp: '窗口内至少一个仓位被强平清空（fullyClosed），或期末权益 ≤ 0',
    },
    executedCount,
    filledCount,
    blownUpCount,
  }
  const elapsed = performance.now() - startedAt
  writeFileSync(RESULT_JSON, `${JSON.stringify({ meta, results }, null, 2)}\n`, 'utf8')
  console.log(`[apply] 写入 ${RESULT_JSON}`)
  console.log(
    `[apply] 完成：${results.length} 份，执行成功 ${executedCount}，有成交 ${filledCount}，爆仓 ${blownUpCount}，耗时 ${elapsed.toFixed(0)} ms`,
  )
}

/* ═══════════════════════ CLI ═══════════════════════ */

function printHelp(): void {
  console.log(
    [
      '交易所 Mock 无头驱动',
      '',
      '用法：',
      '  npx tsx tools/_exchange-headless.ts --snapshot 20',
      '  npx tsx tools/_exchange-headless.ts --apply <actions.json>',
      '  npx tsx tools/_exchange-headless.ts --selftest',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const mode = argv[0]
  if (!mode || mode === '--help' || mode === '-h') {
    printHelp()
    return
  }
  if (mode !== '--snapshot' && mode !== '--apply' && mode !== '--selftest') {
    throw new Error(`未知模式：${mode}`)
  }

  // shim 必须早于 Mock 的动态 import（Mock 构造函数会立刻访问 window/document）
  installBrowserShims()

  if (mode === '--snapshot') {
    const rawCount = argv[1] === undefined ? DEFAULT_SCENARIO_COUNT : Number(argv[1])
    if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > MAX_SCENARIO_COUNT) {
      throw new Error(`场景数必须是 1..${MAX_SCENARIO_COUNT} 的整数`)
    }
    await runSnapshot(rawCount)
    return
  }
  if (mode === '--apply') {
    const actionsPath = argv[1]
    if (!actionsPath) throw new Error('--apply 需要动作文件路径')
    await runApply(resolve(process.cwd(), actionsPath))
    return
  }
  await runSelftest()
}

main().catch((error: unknown) => {
  console.error(`[error] ${errorOf(error).message}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exitCode = 1
})
