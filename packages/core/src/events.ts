/**
 * 随机事件系统（V11，设计已确认）：
 *
 * 规则（中文说明）：
 * - 到达式触发：记录 state.events.nextAtGameMs；每次触发后掷下一个间隔
 *   I = minGap + (maxGap-minGap)×u^gapPower（默认 10 + 20×u² 分钟）：
 *   间隔最短 10 分钟、硬上限 30 分钟（到点必触发，即 30 分钟 = 100%）；
 *   间隔越短概率越低（密度随间隔递增），平均约 17 分钟；
 * - 在线每秒 tick 与离线大推进同一条推进路径（advanceEvents），
 *   离线跨多件会循环连续触发并各自掷间隔；rng 序列固定 → 回档重放一致；
 * - 四类事件：宇宙杂讯/奇遇（40）、航行叙事（35）、市场行情突变动（15）、
 *   市场奇货（10，稀有品突现供应单 / 极高价收购单）；权重见 balance.events；
 * - 市场类事件直接写 NPC 订单簿/冲击/池（事件单有寿命，随窗口过期清理）；
 *   商品名一律走 goodName（不引用物品表，兼容任何数据导入）；
 * - 事件日志统一加 "✦ " 前缀（桌面端据此弹小卡）；
 * - 零物品表依赖；存档只新增 events.nextAtGameMs 一个字段（v11）。
 */
import { addLog } from './state'
import type { GameState } from './state'
import type { MarketGoodDef, SimContext } from './types'
import { nextInt, nextRandom } from './rng'
import { rollLowSecAmbush } from './encounters'
import { ensureMarket, goodName, levelOf } from './market'

/** 事件日志前缀（桌面端用它在新增日志里识别事件弹卡） */
export const EVENT_TAG = '✦'

/** 纯文本类事件条目（奇遇/航行叙事共用形状） */
interface FlavorEntry {
  text: string
  /** 可选小额 ISK 收益区间（不含税，即时入账） */
  iskMin?: number
  iskMax?: number
}

/* ═══════════ 宇宙杂讯 / 奇遇（35 条） ═══════════ */

const MISC_EVENTS: readonly FlavorEntry[] = [
  { text: '深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。', iskMin: 300, iskMax: 900 },
  { text: '一段协会广播：祝所有矿工满载而归，本周咖啡补给半价。', iskMin: 120, iskMax: 250 },
  { text: '雷达扫到星门脉冲余波，导航阵列自动微调，省下一点燃料钱。', iskMin: 150, iskMax: 400 },
  { text: '流浪信标闪了几下就熄灭了，像是某个老船长的遗言。' },
  { text: '货舱角落里滚出一枚旧硬币，上面印着早已消失的联邦徽记。', iskMin: 100, iskMax: 300 },
  { text: '远处一颗超新星的余光掠过舷窗，美丽得像一场无声的告别。' },
  { text: '回收了一团纠缠态矿石碎屑，黑市商贩愿意出价收购。', iskMin: 200, iskMax: 600 },
  { text: '小行星带里传来规律的回声——可能是某种生物的歌声。' },
  { text: '你的 AI 副船在维护日志里留了一首打油诗。' },
  { text: '协会送来一批压缩空气罐头，说是上次事故的补偿。', iskMin: 100, iskMax: 200 },
  { text: '舷窗上粘着一只不知名的星际藤壶，拿去换了点零钱。', iskMin: 150, iskMax: 350 },
  { text: '某个匿名账户给你转了一笔钱，备注只有两个字：谢谢。', iskMin: 400, iskMax: 1200 },
  { text: '深空无线电里有人在放六十年前的老歌。' },
  { text: '检修时发现逃生舱里有半瓶没喝完的古老威士忌。', iskMin: 200, iskMax: 500 },
  { text: '一颗微型陨石擦过船壳，留下一个幸运的凹痕。' },
  { text: '星图角落多了一个闪点，再仔细看又消失了。' },
  { text: '补给站的自动售货机多找了你几个硬币。', iskMin: 80, iskMax: 150 },
  { text: '你在杂物箱里找到一张过期的抽奖券——居然还能兑奖。', iskMin: 300, iskMax: 800 },
  { text: '附近的碎石带里飘着一块涂鸦板，画着一艘歪歪扭扭的鲸鱼船。' },
  { text: '老矿工发来一条消息：那片矿带我又补探了一次，坐标发你了。' },
  { text: '驾驶舱的盆栽开花了，据说能带来好运。' },
  { text: '回收站传来哗啦一声——里面是别人扔掉的整套旧书。' },
  { text: '休眠舱数据里有段前主人的语音备忘，提到某处藏着一笔应急金。', iskMin: 500, iskMax: 1500 },
  { text: '星门守卫巡逻艇朝你鸣笛致意，像老邻居一样。' },
  { text: '远方的星系间有场没头没尾的烟花秀。' },
  { text: '某艘游商船甩卖库存，你顺手捡了个便宜。', iskMin: 250, iskMax: 700 },
  { text: '你的名字被写进了协会月刊的“本周深空故事”栏目（没有稿费）。' },
  { text: '推进器喷嘴里卡着一颗幸运星形状的鹅卵石。' },
  { text: '有人在广播里点歌送给你，虽然你根本不认识他。' },
  { text: '旧货商看走眼，把一块高纯度样品当废料卖给了你。', iskMin: 350, iskMax: 1000 },
  { text: '舰桥值班闹钟响了三次，你才发现它从没修好过。' },
  { text: '一只流浪机械蜘蛛爬进船舱，帮你清了通风管。' },
  { text: '协会对全星域发布通告：感谢你上周帮忙清理航道（附小额奖金）。', iskMin: 400, iskMax: 800 },
  { text: '你把一罐过期咖啡寄给了远方的笔友，他回寄了一箱当地特产。', iskMin: 100, iskMax: 300 },
  { text: '一颗彗星刚好从你头顶掠过——据说看到的人会走一整天好运。' },
]

/* ═══════════ 航行叙事 / 舰桥日志（35 条） ═══════════ */

const VOYAGE_EVENTS: readonly FlavorEntry[] = [  { text: '跃迁通道里闪过一艘幽灵船的轮廓，三秒后一切如常。' },
  { text: '舰桥日志：今天只遇到一群迷路的矿工无人机，帮它们指了路。' },
  { text: '航线上漂着一座废弃导航灯塔，你顺手修好了它的信标。', iskMin: 150, iskMax: 400 },
  { text: '穿过一片宇宙尘埃后，船壳像镀了一层银。' },
  { text: '气象广播：前方星云有间歇性辐射暴，你绕了个小弯。' },
  { text: '在轨道残骸里捞到一枚完好的推进器喷嘴，修修补补能卖钱。', iskMin: 250, iskMax: 700 },
  { text: '某颗行星的阴影里有规律的光点——大概只是采矿平台。' },
  { text: '你的领航 AI 讲了一个关于鲸鱼的冷笑话，你笑了三秒。' },
  { text: '途中偶遇一支迁徙的星际水母群，场面壮观。' },
  { text: '旧航道的浮标被撞歪了，你把它推回原位。' },
  { text: '一封来自“深空慢递”的信终于送到：是你五年前的自己寄的。' },
  { text: '跳跃引擎的嗡鸣声比平时低了一个调，听起来很舒服。' },
  { text: '你在某个废弃站台上捡到一张手绘星图，标注着“金矿在此”。' },
  { text: '远处有两艘商船并排航行，像两只并肩的鲸鱼。' },
  { text: '航道管理员发来感谢电：你报修的那段航标已更新。', iskMin: 100, iskMax: 250 },
  { text: '补给舰的货舱门坏了一半，你用胶带和铁丝帮它固定。', iskMin: 100, iskMax: 300 },
  { text: '舷窗外飘过一大片冰晶，折射出彩虹般的碎光。' },
  { text: '你在休息室找到一本别人落下的航行日记，读到凌晨。' },
  { text: '一群流浪汉（其实是太空拾荒者）朝你挥了挥手。' },
  { text: '前方出现未知引力井，你谨慎地绕行——好奇心差点害死猫。' },
  { text: '船体外的天线挂住了一只睡着的太空鸟（大概是某种仿生机器人）。' },
  { text: '路过的货船长跟你分享了他的午饭配方：压缩饼干炖罐头。' },
  { text: '你成功避开了一块涂了警告漆的岩礁，像玩了一次极限漂移。' },
  { text: '一条加密消息指向某个坐标，打开后是一幅涂鸦——诈骗犯也懂浪漫。' },
  { text: '航行仪显示前方有 0.03% 概率的随机故障，它真的发生了。' },
  { text: '你帮助一艘失去动力的拖网船脱困，对方给了你一条新鲜的电鱼。', iskMin: 200, iskMax: 500 },
  { text: '深空有一段短暂的“寂静带”，引擎声消失的十秒里世界很安静。' },
  { text: '某颗气态巨行星的云层里，闪电像城市夜景一样连绵不绝。' },
  { text: '返航途中你看到自己的家港灯光，心里突然踏实了。' },
  { text: '舱外作业时手套掉了一只，它飘在身后像一面小旗。' },
  { text: '协会测量船请你当临时向导，付了一笔咨询费。', iskMin: 300, iskMax: 900 },
  { text: '你在一颗小行星的背阴面发现了一片废弃的旧采矿架。' },
  { text: '有人把“深空平安”四个字刻在航标背面，你拍照留念。' },
  { text: '跳跃完成的一瞬间，舷窗外的星图像被重新洗过一样。' },
  { text: '你给新来的 AI 副船起了个名字，它好像很高兴。' },
]

/* ═══════════ 探索发现（V13：扫描探索作业期间专用，12 条） ═══════════ */

/** 导出供测试/文档核对（扫描期间到点事件强制从本池抽取） */
export const EXPLORE_EVENTS: readonly FlavorEntry[] = [
  { text: '深空信标里存着一段旧航路日志——协会情报处付了一笔整理费。', iskMin: 400, iskMax: 1200 },
  { text: '云层里发现一座废弃的古代观测站，你带回一组完好透镜。', iskMin: 300, iskMax: 900 },
  { text: '扫描波束反射回一串规律信号——像是某种导航网格，已归档。' },
  { text: '未知残骸里弹出一只休眠的信使无人机，愿意为你跑腿。', iskMin: 100, iskMax: 400 },
  { text: '探测到微弱的引力涟漪：前方可能存在未被标记的质量体。' },
  { text: '捡到一枚外壳刻着陌生文字的数据库，黑市愿意收购。', iskMin: 500, iskMax: 1500 },
  { text: '星云边缘的尘埃里有规律的空洞——像是巨物穿行过的痕迹。' },
  { text: '扫描仪捕捉到一段古老求救信号，破译后是一张藏宝坐标。', iskMin: 300, iskMax: 800 },
  { text: '一颗冰封的小行星表面刻着导航箭头，指向更深处。' },
  { text: '你回收了半个跃迁引擎原型，协会工程部出价收购。', iskMin: 800, iskMax: 2000 },
  { text: '远处的虚影闪烁了一下——是海市蜃楼，还是别的什么？' },
  { text: '一队神秘浮标沿着未知航线排开，你把坐标记进了星图。', iskMin: 200, iskMax: 600 },
]

/* ═══════════ 工具 ═══════════ */

function rollGapMs(state: GameState, ctx: SimContext): number {
  const ev = ctx.balance.events
  const u = Math.pow(nextRandom(state.rng), ev.gapPower)
  return Math.round(ev.minGapMs + (ev.maxGapMs - ev.minGapMs) * u)
}

function clampPrice(ctx: SimContext, def: MarketGoodDef, raw: number): number {
  const bal = ctx.balance.market
  return Math.round(Math.min(def.basePrice * bal.maxPriceRatio, Math.max(def.basePrice * bal.minPriceRatio, raw)))
}

/** 日志里统一写事件文本（金额自动附注） */
function logEvent(state: GameState, text: string, amount?: number): void {
  addLog(state, 'info', `✦ ${text}${amount !== undefined && amount > 0 ? `（+${amount.toLocaleString('zh-CN')} ISK）` : ''}`)
}

function fireFlavor(state: GameState, table: readonly FlavorEntry[]): void {
  const entry = table[nextInt(state.rng, table.length)]!
  let amount: number | undefined
  if (entry.iskMin !== undefined && entry.iskMax !== undefined) {
    amount = entry.iskMin + nextInt(state.rng, entry.iskMax - entry.iskMin + 1)
    state.wallet.isk += amount
  }
  logEvent(state, entry.text, amount)
}

/* ═══════════ 市场类事件 ═══════════ */

/** 常驻池商品（行情突变动对象） */
function poolGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter((g) => g.kind === 'item' && g.poolTarget !== undefined && g.poolTarget > 0)
}

/** 稀有/限定商品（模块/蓝图/船，不含 AI 核心）：市场奇货对象 */
function rareGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter((g) => g.kind !== 'aicore' && g.rarity !== 'common' && g.kind !== 'item')
}

/**
 * 市场大类 A：行情突变动（公开导出，测试可直接调用）。
 * 变体：0 协会收购周（+冲击）/ 1 站台倾销潮（−冲击 + 池淤积）/ 2 短波行情（全池微扰）/
 *       3 突现大宗单（大额收购或抛售单，20 分钟有效）。
 */
export function fireMarketShockEvent(state: GameState, ctx: SimContext): void {
  ensureMarket(state, ctx) // 市场簿/池未开盘时先开盘（事件可能在首个市场窗口前触发）
  const goods = poolGoods(ctx)
  const variant = goods.length > 0 ? nextInt(state.rng, 4) : 2
  const mk = state.market
  const bal = ctx.balance.market

  if (variant === 0) {
    const def = goods[nextInt(state.rng, goods.length)]!
    mk.pools[def.key]!.shock += 0.1
    logEvent(state, `协会发布收购周通告：「${goodName(ctx, def.key)}」热度上升，行情看涨。`)
  } else if (variant === 1) {
    const def = goods[nextInt(state.rng, goods.length)]!
    mk.pools[def.key]!.shock -= 0.08
    mk.pools[def.key]!.q += Math.round(def.poolTarget! * 0.15)
    logEvent(state, `站台倾销潮：有人集中抛售「${goodName(ctx, def.key)}」，价格被压低。`)
  } else if (variant === 2) {
    for (const def of goods) {
      const mk2 = mk.pools[def.key]!
      const drift = (nextRandom(state.rng) - 0.5) * 0.06
      mk2.shock += drift
    }
    logEvent(state, '短波行情：星域市场出现整体小幅波动，各商品价格轻微漂移。')
  } else {
    const def = goods[nextInt(state.rng, goods.length)]!
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget! / 120))
    const qty = Math.max(10, Math.round(flow * (30 + nextRandom(state.rng) * 30)))
    const level = levelOf(state, ctx, def.key)
    const buy = nextInt(state.rng, 2) === 0
    if (buy) {
      const price = clampPrice(ctx, def, Math.round(level * (0.99 + nextRandom(state.rng) * 0.02)))
      mk.npcBuy[def.key]!.push({ price, qty, expiresAtGameMs: state.gameMs + bal.orderLifeMs.common })
      logEvent(state, `突现大宗收购：有人以 ${price.toLocaleString('zh-CN')} ISK/单位求购「${goodName(ctx, def.key)}」×${qty.toLocaleString('zh-CN')}（20 分钟内有效）。`)
    } else {
      const price = clampPrice(ctx, def, Math.max(Math.round(level * (1.05 + nextRandom(state.rng) * 0.02)), level + 1))
      mk.npcSell[def.key]!.push({ price, qty, expiresAtGameMs: state.gameMs + bal.orderLifeMs.common })
      logEvent(state, `突现大宗抛售：有人以 ${price.toLocaleString('zh-CN')} ISK/单位放出「${goodName(ctx, def.key)}」×${qty.toLocaleString('zh-CN')}（20 分钟内有效）。`)
    }
  }
}

/**
 * 市场大类 B：市场奇货（公开导出，测试可直接调用）。
 * 变体：0 神秘出货（稀有/限定商品当场刷一件供应单，随稀有度寿命过期）/
 *       1 神秘买家（以近乎现货价的天价收购稀有/限定商品 ×1）。
 */
export function fireMarketOrderEvent(state: GameState, ctx: SimContext): void {
  ensureMarket(state, ctx)
  const goods = rareGoods(ctx)
  if (goods.length === 0) {
    // 目录里没有稀有货（测试环境等）：退回奇遇文本，保持事件系统可用
    fireFlavor(state, MISC_EVENTS)
    return
  }
  const def = goods[nextInt(state.rng, goods.length)]!
  const mk = state.market
  const lifeMs = ctx.balance.market.orderLifeMs[def.rarity]
  const lifeMin = Math.round(lifeMs / 60_000)
  const level = levelOf(state, ctx, def.key)
  const name = goodName(ctx, def.key)

  if (nextInt(state.rng, 2) === 0) {
    const price = clampPrice(ctx, def, Math.round(level * (0.95 + nextRandom(state.rng) * 0.1)))
    mk.npcSell[def.key]!.push({ price, qty: 1, expiresAtGameMs: state.gameMs + lifeMs })
    logEvent(state, `黑市商人突然挂出一件「${name}」：${price.toLocaleString('zh-CN')} ISK，仅存约 ${lifeMin} 分钟，手慢无。`)
  } else {
    const price = clampPrice(ctx, def, Math.round(level * (1.0 + nextRandom(state.rng) * 0.35)))
    mk.npcBuy[def.key]!.push({ price, qty: 1, expiresAtGameMs: state.gameMs + lifeMs })
    logEvent(state, `神秘买家以 ${price.toLocaleString('zh-CN')} ISK 的天价求购「${name}」×1——远高于常态收购价，约 ${lifeMin} 分钟内有效。`)
  }
}

/** 按类别权重掷一次事件并执行（advanceEvents 与测试通用） */
export function fireOneEvent(state: GameState, ctx: SimContext): void {
  const b = ctx.balance.events
  // V13：扫描探索作业进行期间，到点事件强制走「探索发现」池
  if (state.scanning.active) {
    fireFlavor(state, EXPLORE_EVENTS)
    return
  }
  const total = b.miscWeight + b.voyageWeight + b.marketShockWeight + b.marketOrderWeight
  let r = nextRandom(state.rng) * total
  if ((r -= b.miscWeight) < 0) {
    fireFlavor(state, MISC_EVENTS)
  } else if ((r -= b.voyageWeight) < 0) {
    fireFlavor(state, VOYAGE_EVENTS)
  } else if ((r -= b.marketShockWeight) < 0) {
    fireMarketShockEvent(state, ctx)
  } else {
    fireMarketOrderEvent(state, ctx)
  }
}

/**
 * 随机事件推进器（引擎在 gameMs 前移后调用）：
 * 未播种则从本次推进起点播种首个触发时刻；随后循环触发所有到期事件。
 */
export function advanceEvents(state: GameState, deltaMs: number, ctx: SimContext): void {
  if (deltaMs <= 0) return
  if (ctx.balance.events.enabled === false) return // 测试等场景可整体关闭事件流
  const ev = state.events
  // 未播种则从本次推进起点播种首个触发时刻（须在加速之前，避免把 0 当未播种）
  if (ev.nextAtGameMs <= 0) {
    ev.nextAtGameMs = Math.max(0, state.gameMs - deltaMs) + rollGapMs(state, ctx)
  }
  // V13：扫描探索期间，事件倒计时按 exploreBoost 额外推进（事件来得更快）
  const boost = state.scanning.active ? Math.max(0, ctx.balance.events.exploreBoost) : 0
  if (boost > 0 && ev.nextAtGameMs > 0) {
    ev.nextAtGameMs = Math.max(ev.nextAtGameMs - Math.round(deltaMs * boost), state.gameMs - deltaMs + 1)
  }
  let guard = 0
  while (ev.nextAtGameMs <= state.gameMs && guard < 200) {
    guard++
    // B1（船长 2026-09-04 定稿）：低安遭遇占用随机事件时机——事件到点先判遇袭；
    // 命中则本次事件机会被遭遇占用（本段不再抽随机事件）
    if (!rollLowSecAmbush(state, ctx)) {
      fireOneEvent(state, ctx)
    }
    ev.nextAtGameMs += rollGapMs(state, ctx)
  }
}
