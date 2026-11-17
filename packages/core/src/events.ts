import { ceilFinalQuantity } from './quantity'
import { addLog } from './state'
import type { GameState } from './state'
import type { MarketGoodDef, SimContext } from './types'
import { nextInt, nextRandom, pickWeighted } from './rng'
import { rollLowSecAmbush } from './encounters'
import { ensureMarket, goodName, levelOf } from './market'
import { DSI_FACTION_ID, standingOf } from './standing'

export const EVENT_TAG = '✦'

interface FlavorEntry {
  text: string
  id?: string
  iskMin?: number
  iskMax?: number
}


const MISC_EVENTS: readonly FlavorEntry[] = [
  { id: 'core.events.003', text: '深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。', iskMin: 900, iskMax: 2700 },
  { id: 'core.events.004', text: '一段协会广播：祝所有矿工满载而归，本周咖啡补给半价。', iskMin: 240, iskMax: 500 },
  { id: 'core.events.005', text: '雷达扫到星门脉冲余波，导航阵列自动微调，省下一点燃料钱。', iskMin: 450, iskMax: 1200 },
  { id: 'core.events.006', text: '流浪信标闪了几下就熄灭了，像是某个老船长的遗言。' },
  { id: 'core.events.007', text: '货舱角落里滚出一枚旧硬币，上面印着早已消失的联邦徽记。', iskMin: 200, iskMax: 600 },
  { id: 'core.events.008', text: '远处一颗超新星的余光掠过舷窗，美丽得像一场无声的告别。' },
  { id: 'core.events.009', text: '回收了一团纠缠态原矿碎屑，黑市商贩愿意出价收购。', iskMin: 600, iskMax: 1800 },
  { id: 'core.events.010', text: '小行星带里传来规律的回声——可能是某种生物的歌声。' },
  { id: 'core.events.011', text: '你的 AI 副船在维护日志里留了一首打油诗。' },
  { id: 'core.events.012', text: '协会送来一批压缩空气罐头，说是上次事故的补偿。', iskMin: 200, iskMax: 400 },
  { id: 'core.events.013', text: '舷窗上粘着一只不知名的星际藤壶，拿去换了点零钱。', iskMin: 450, iskMax: 1050 },
  { id: 'core.events.014', text: '某个匿名账户给你转了一笔钱，备注只有两个字：谢谢。', iskMin: 1600, iskMax: 4800 },
  { id: 'core.events.015', text: '深空无线电里有人在放六十年前的老歌。' },
  { id: 'core.events.016', text: '检修时发现逃生舱里有半瓶没喝完的古老威士忌。', iskMin: 600, iskMax: 1500 },
  { id: 'core.events.017', text: '一颗微型陨石擦过船壳，留下一个幸运的凹痕。' },
  { id: 'core.events.018', text: '星图角落多了一个闪点，再仔细看又消失了。' },
  { id: 'core.events.019', text: '补给站的自动售货机多找了你几个硬币。', iskMin: 160, iskMax: 300 },
  { id: 'core.events.020', text: '你在杂物箱里找到一张旧式配给券——居然还在兑付期内。', iskMin: 900, iskMax: 2400 },
  { id: 'core.events.021', text: '附近的碎石带里飘着一块涂鸦板，画着一艘歪歪扭扭的鲸鱼船。' },
  { id: 'core.events.022', text: '老矿工发来一条消息：那片矿带我又补探了一次，坐标发你了。' },
  { id: 'core.events.023', text: '驾驶舱的盆栽开花了，据说能带来好运。' },
  { id: 'core.events.024', text: '回收站传来哗啦一声——里面是别人扔掉的整套旧书。' },
  { id: 'core.events.025', text: '休眠舱数据里有段前主人的语音备忘，提到某处藏着一笔应急金。', iskMin: 2000, iskMax: 6000 },
  { id: 'core.events.026', text: '星门守卫巡逻艇朝你鸣笛致意，像老邻居一样。' },
  { id: 'core.events.027', text: '远方的星系间有场没头没尾的烟花秀。' },
  { id: 'core.events.028', text: '某艘游商船甩卖库存，你顺手捡了个便宜。', iskMin: 750, iskMax: 2100 },
  { id: 'core.events.029', text: '你的名字被写进了协会月刊的“本周深空故事”栏目（没有稿费）。' },
  { id: 'core.events.030', text: '推进器喷嘴里卡着一颗幸运星形状的鹅卵石。' },
  { id: 'core.events.031', text: '有人在广播里点歌送给你，虽然你根本不认识他。' },
  { id: 'core.events.032', text: '旧货商看走眼，把一块高纯度样品当废料卖给了你。', iskMin: 1400, iskMax: 4000 },
  { id: 'core.events.033', text: '舰桥值班闹钟响了三次，你才发现它从没修好过。' },
  { id: 'core.events.034', text: '一只流浪机械蜘蛛爬进船舱，帮你清了通风管。' },
  { id: 'core.events.035', text: '协会对全星域发布通告：感谢你上周帮忙清理航道（附小额奖金）。', iskMin: 1200, iskMax: 2400 },
  { id: 'core.events.036', text: '你把一罐过期咖啡寄给了远方的笔友，他回寄了一箱当地特产。', iskMin: 200, iskMax: 600 },
  { id: 'core.events.037', text: '一颗彗星刚好从你头顶掠过——据说看到的人会走一整天好运。' },
]


const VOYAGE_EVENTS: readonly FlavorEntry[] = [  { text: '跃迁通道里闪过一艘幽灵船的轮廓，三秒后一切如常。' },
  { id: 'core.events.038', text: '舰桥日志：今天只遇到一群迷路的矿工无人机，帮它们指了路。' },
  { id: 'core.events.039', text: '航线上漂着一座废弃导航灯塔，你顺手修好了它的信标。', iskMin: 450, iskMax: 1200 },
  { id: 'core.events.040', text: '穿过一片宇宙尘埃后，船壳像镀了一层银。' },
  { id: 'core.events.041', text: '气象广播：前方星云有间歇性辐射暴，你绕了个小弯。' },
  { id: 'core.events.042', text: '在轨道残骸里捞到一枚完好的推进器喷嘴，修修补补能卖钱。', iskMin: 750, iskMax: 2100 },
  { id: 'core.events.043', text: '某颗行星的阴影里有规律的光点——大概只是采矿平台。' },
  { id: 'core.events.044', text: '你的领航 AI 讲了一个关于鲸鱼的冷笑话，你笑了三秒。' },
  { id: 'core.events.045', text: '途中偶遇一支迁徙的星际水母群，场面壮观。' },
  { id: 'core.events.046', text: '旧航道的浮标被撞歪了，你把它推回原位。' },
  { id: 'core.events.047', text: '一封来自“深空慢递”的信终于送到：是你五年前的自己寄的。' },
  { id: 'core.events.048', text: '跳跃引擎的嗡鸣声比平时低了一个调，听起来很舒服。' },
  { id: 'core.events.049', text: '你在某个废弃站台上捡到一张手绘星图，标注着“金矿在此”。' },
  { id: 'core.events.050', text: '远处有两艘商船并排航行，像两只并肩的鲸鱼。' },
  { id: 'core.events.051', text: '航道管理员发来感谢电：你报修的那段航标已更新。', iskMin: 200, iskMax: 500 },
  { id: 'core.events.052', text: '补给舰的货舱门坏了一半，你用胶带和铁丝帮它固定。', iskMin: 200, iskMax: 600 },
  { id: 'core.events.053', text: '舷窗外飘过一大片冰晶，折射出彩虹般的碎光。' },
  { id: 'core.events.054', text: '你在休息室找到一本别人落下的航行日记，读到凌晨。' },
  { id: 'core.events.055', text: '一队路过的太空拾荒者朝你挥了挥手。' },
  { id: 'core.events.056', text: '前方出现未知引力井，你谨慎地绕行——好奇心差点害死猫。' },
  { id: 'core.events.057', text: '船体外的天线挂住了一只睡着的太空鸟（大概是某种仿生机器人）。' },
  { id: 'core.events.058', text: '路过的货船船长跟你分享了他的午饭配方：压缩饼干炖罐头。' },
  { id: 'core.events.059', text: '你成功避开了一块涂了警告漆的岩礁，几乎是贴着它的边缘滑过去的。' },
  { id: 'core.events.060', text: '一条加密消息指向某个坐标，打开后是一幅涂鸦——诈骗犯也懂浪漫。' },
  { id: 'core.events.061', text: '航行仪短暂失灵，几秒后自己恢复了——虚惊一场。' },
  { id: 'core.events.062', text: '你帮助一艘失去动力的拖网船脱困，对方给了你一条新鲜的电鱼。', iskMin: 600, iskMax: 1500 },
  { id: 'core.events.063', text: '深空有一段短暂的“寂静带”，引擎声消失的十秒里世界很安静。' },
  { id: 'core.events.064', text: '某颗气态巨行星的云层里，闪电像城市夜景一样连绵不绝。' },
  { id: 'core.events.065', text: '返航途中你看到自己的家港灯光，心里突然踏实了。' },
  { id: 'core.events.066', text: '舱外作业时手套掉了一只，它飘在身后像一面小旗。' },
  { id: 'core.events.067', text: '协会测量船请你当临时向导，付了一笔咨询费。', iskMin: 900, iskMax: 2700 },
  { id: 'core.events.068', text: '你在一颗小行星的背阴面发现了一片废弃的旧采矿架。' },
  { id: 'core.events.069', text: '有人把“深空平安”四个字刻在航标背面，你拍照留念。' },
  { id: 'core.events.070', text: '跳跃完成的一瞬间，舷窗外的星图像被重新洗过一样。' },
  { id: 'core.events.071', text: '你给新来的 AI 副船起了个名字，它好像很高兴。' },
]


export const EXPLORE_EVENTS: readonly FlavorEntry[] = [
  { id: 'core.events.072', text: '深空信标里存着一段旧航路日志——协会情报处付了一笔整理费。', iskMin: 1600, iskMax: 4800 },
  { id: 'core.events.073', text: '云层里发现一座废弃的古代观测站，你带回一组完好透镜。', iskMin: 900, iskMax: 2700 },
  { id: 'core.events.074', text: '扫描波束反射回一串规律信号——像是某种导航网格，已归档。' },
  { id: 'core.events.075', text: '未知残骸里弹出一只休眠的信使无人机，愿意为你跑腿。', iskMin: 300, iskMax: 1200 },
  { id: 'core.events.076', text: '探测到微弱的引力涟漪：前方可能存在未被标记的质量体。' },
  { id: 'core.events.077', text: '捡到一枚外壳刻着陌生文字的数据库，黑市愿意收购。', iskMin: 2000, iskMax: 6000 },
  { id: 'core.events.078', text: '星云边缘的尘埃里有规律的空洞——像是巨物穿行过的痕迹。' },
  { id: 'core.events.079', text: '扫描仪捕捉到一段古老求救信号，破译后是一张藏宝坐标。', iskMin: 900, iskMax: 2400 },
  { id: 'core.events.080', text: '一颗冰封的小行星表面刻着导航箭头，指向更深处。' },
  { id: 'core.events.081', text: '你回收了半个跃迁引擎原型，协会工程部出价收购。', iskMin: 3200, iskMax: 8000 },
  { id: 'core.events.082', text: '远处的虚影闪烁了一下——是海市蜃楼，还是别的什么？' },
  { id: 'core.events.083', text: '一队神秘浮标沿着未知航线排开，你把坐标记进了星图。', iskMin: 600, iskMax: 1800 },
]


export function eventCadenceFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['galactic-happenings'] ?? 0)
  return Math.max(0, 1 - 0.08 * lv)
}

function rollGapMs(state: GameState, ctx: SimContext): number {
  const ev = ctx.balance.events
  const u = Math.pow(nextRandom(state.rng), ev.gapPower)
  const raw = ev.minGapMs + (ev.maxGapMs - ev.minGapMs) * u
  return Math.max(0, Math.round(raw * eventCadenceFactor(state)))
}

export function ensureEventSchedule(state: GameState, ctx: SimContext): void {
  if (ctx.balance.events.enabled !== false && state.events.nextAtGameMs <= 0) state.events.nextAtGameMs = state.gameMs + rollGapMs(state, ctx)
}

function clampPrice(ctx: SimContext, def: MarketGoodDef, raw: number): number {
  const bal = ctx.balance.market
  return ceilFinalQuantity(Math.min(def.basePrice * bal.maxPriceRatio, Math.max(def.basePrice * bal.minPriceRatio, raw)))
}

function logEvent(
  state: GameState,
  text: string,
  amount?: number,
  id?: string,
  params?: Record<string, string | number>,
): void {
  const hasAmount = amount !== undefined && amount > 0
  const amountNote = hasAmount ? `（+${amount.toLocaleString('zh-CN')} 信用点）` : ''
  const body: Record<string, string | number> = {
    p1: text,
    p2: '',
    ...(params ?? {}),
    ...(id !== undefined ? { p1Id: id } : {}),
  }
  addLog(state, 'event', `✦ ${text}${amountNote}`, 'core.events.001', {
    ...body,
    ...(hasAmount ? { p2: amountNote, p2Id: 'core.events.002', p2p1: amount.toLocaleString('zh-CN') } : {}),
  })
}

export function exploredRewardMul(state: GameState, ev: { exploreBonusPerGalaxy: number; exploreBonusCap: number }): number {
  return 1 + Math.min(ev.exploreBonusCap, state.exploredGalaxies.length * ev.exploreBonusPerGalaxy)
}

export function fireFlavor(state: GameState, ctx: SimContext, table: readonly FlavorEntry[], offline = false): void {
  const entry = table[nextInt(state.rng, table.length)]!
  let amount: number | undefined
  if (entry.iskMin !== undefined && entry.iskMax !== undefined) {
    const divLv = Math.min(5, state.skills.trained['event-dividend'] ?? 0)
    let raw = entry.iskMin + nextInt(state.rng, entry.iskMax - entry.iskMin + 1)
    raw = ceilFinalQuantity(raw * exploredRewardMul(state, ctx.balance.events))
    amount = divLv > 0 ? ceilFinalQuantity(raw * (1 + 0.15 * divLv)) : raw
    if (!offline) state.wallet.isk += amount
  }
  if (offline) return
  logEvent(state, entry.text, amount, entry.id)
}


function poolGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter((g) => g.kind === 'item' && g.poolTarget !== undefined && g.poolTarget > 0)
}

function rareGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter((g) => !g.unreleased && g.kind !== 'aicore' && g.rarity !== 'common' && g.kind !== 'item' &&
    (g.playerBuyable !== false || g.playerSellable !== false))
}
export function fireMarketShockEvent(state: GameState, ctx: SimContext, offline = false): void {
  ensureMarket(state, ctx)
  const goods = poolGoods(ctx)
  const variant = goods.length > 0 ? nextInt(state.rng, 4) : 2
  const mk = state.market
  const bal = ctx.balance.market

  if (variant === 0) {
    const def = goods[nextInt(state.rng, goods.length)]!
    if (!offline) {
      mk.pools[def.key]!.shock += 0.1
      logEvent(state, `协会发布收购周通告：「${goodName(ctx, def.key)}」热度上升，行情看涨。`, undefined, 'core.events.084', { p1p1: goodName(ctx, def.key) })
    }
  } else if (variant === 1) {
    const def = goods[nextInt(state.rng, goods.length)]!
    if (!offline) {
      mk.pools[def.key]!.shock -= 0.08
      mk.pools[def.key]!.q += Math.round(def.poolTarget! * 0.15)
      logEvent(state, `站台倾销潮：有人集中抛售「${goodName(ctx, def.key)}」，价格被压低。`, undefined, 'core.events.085', { p1p1: goodName(ctx, def.key) })
    }
  } else if (variant === 2) {
    for (const def of goods) {
      const drift = (nextRandom(state.rng) - 0.5) * 0.06
      if (!offline) mk.pools[def.key]!.shock += drift
    }
    if (!offline) logEvent(state, '短波行情：星域市场出现整体小幅波动，各商品价格轻微漂移。', undefined, 'core.events.086')
  } else {
    const def = goods[nextInt(state.rng, goods.length)]!
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget! / 120))
    const qty = Math.max(10, ceilFinalQuantity(flow * (30 + nextRandom(state.rng) * 30)))
    const level = levelOf(state, ctx, def.key)
    const buy = nextInt(state.rng, 2) === 0
    if (buy && def.playerSellable !== false) {
      const price = clampPrice(ctx, def, ceilFinalQuantity(level * (0.99 + nextRandom(state.rng) * 0.02)))
      if (offline) return
      mk.npcBuy[def.key]!.push({ price, qty, expiresAtGameMs: state.gameMs + bal.orderLifeMs.common })
      logEvent(state, `突现大宗收购：有人以 ${price.toLocaleString('zh-CN')} 信用点/单位求购「${goodName(ctx, def.key)}」×${qty.toLocaleString('zh-CN')}（20 分钟内有效）。`, undefined, 'core.events.087', { p1p1: price.toLocaleString('zh-CN'), p1p2: goodName(ctx, def.key), p1p3: qty.toLocaleString('zh-CN') })
    } else if (!buy && def.playerBuyable !== false) {
      const price = clampPrice(ctx, def, Math.max(ceilFinalQuantity(level * (1.05 + nextRandom(state.rng) * 0.02)), level + 1))
      if (offline) return
      mk.npcSell[def.key]!.push({ price, qty, expiresAtGameMs: state.gameMs + bal.orderLifeMs.common })
      logEvent(state, `突现大宗抛售：有人以 ${price.toLocaleString('zh-CN')} 信用点/单位放出「${goodName(ctx, def.key)}」×${qty.toLocaleString('zh-CN')}（20 分钟内有效）。`, undefined, 'core.events.088', { p1p1: price.toLocaleString('zh-CN'), p1p2: goodName(ctx, def.key), p1p3: qty.toLocaleString('zh-CN') })
    }
  }
}

export const BLACK_MARKET_LIFE_MS = 8 * 60_000
export const BLACK_MARKET_STANDING_REQ = 100
export function fireMarketOrderEvent(state: GameState, ctx: SimContext, offline = false): void {
  ensureMarket(state, ctx)
  const goods = rareGoods(ctx)
  if (goods.length === 0) {
    fireFlavor(state, ctx, MISC_EVENTS, offline)
    return
  }
  const def = goods[nextInt(state.rng, goods.length)]!
  const mk = state.market
  const level = levelOf(state, ctx, def.key)
  const name = goodName(ctx, def.key)

  const wantsSupply = nextInt(state.rng, 2) === 0
  const canSupply = def.playerBuyable !== false && standingOf(state, DSI_FACTION_ID) >= BLACK_MARKET_STANDING_REQ
  const canBuy = def.playerSellable !== false
  if (canSupply && (wantsSupply || !canBuy)) {
    const mul = 1.8 + nextRandom(state.rng) * 0.2
    const price = clampPrice(ctx, def, ceilFinalQuantity(level * mul))
    if (offline) return
    mk.npcSell[def.key]!.push({ price, qty: 1, expiresAtGameMs: state.gameMs + BLACK_MARKET_LIFE_MS })
    logEvent(
      state,
      `黑市商人挂出一件「${name}」：开价 ${price.toLocaleString('zh-CN')} 信用点（约为行情价 ×${mul.toFixed(1)} 的溢价现货），仅存 ${Math.round(BLACK_MARKET_LIFE_MS / 60_000)} 分钟，手慢无——急用免蹲货，不差钱可出手。`,
      undefined,
      'core.events.089',
      { p1p1: name, p1p2: price.toLocaleString('zh-CN'), p1p3: mul.toFixed(1), p1p4: Math.round(BLACK_MARKET_LIFE_MS / 60_000) },
    )
  } else if (canBuy) {
    const lifeMs = ctx.balance.market.orderLifeMs[def.rarity]
    const price = clampPrice(ctx, def, ceilFinalQuantity(level * (1.0 + nextRandom(state.rng) * 0.35)))
    if (offline) return
    mk.npcBuy[def.key]!.push({ price, qty: 1, expiresAtGameMs: state.gameMs + lifeMs })
    logEvent(
      state,
      `神秘买家以 ${price.toLocaleString('zh-CN')} 信用点的天价求购「${name}」×1——远高于常态收购价，约 ${Math.round(lifeMs / 60_000)} 分钟内有效。`,
      undefined,
      'core.events.090',
      { p1p1: price.toLocaleString('zh-CN'), p1p2: name, p1p3: Math.round(lifeMs / 60_000) },
    )
  }
}

export function fireOneEvent(state: GameState, ctx: SimContext, offline = false): void {
  const b = ctx.balance.events
  if (state.scanning.active) {
    fireFlavor(state, ctx, EXPLORE_EVENTS, offline)
    return
  }
  const weights = [b.miscWeight, b.voyageWeight, b.marketShockWeight, b.marketOrderWeight]
  const kind = pickWeighted(state.rng, [0, 1, 2, 3], (i) => weights[i] ?? 0) ?? 3
  if (kind === 0) {
    fireFlavor(state, ctx, MISC_EVENTS, offline)
  } else if (kind === 1) {
    fireFlavor(state, ctx, VOYAGE_EVENTS, offline)
  } else if (kind === 2) {
    fireMarketShockEvent(state, ctx, offline)
  } else {
    fireMarketOrderEvent(state, ctx, offline)
  }
}

export function advanceEvents(state: GameState, deltaMs: number, ctx: SimContext, offline = false): void {
  if (deltaMs <= 0) return
  if (ctx.balance.events.enabled === false) return
  const ev = state.events
  if (ev.nextAtGameMs <= 0) {
    ev.nextAtGameMs = Math.max(0, state.gameMs - deltaMs) + rollGapMs(state, ctx)
  }
  const boost = state.scanning.active ? Math.max(0, ctx.balance.events.exploreBoost) : 0
  if (boost > 0 && ev.nextAtGameMs > 0) {
    ev.nextAtGameMs = Math.max(ev.nextAtGameMs - Math.round(deltaMs * boost), state.gameMs - deltaMs + 1)
  }
  let guard = 0
  while (ev.nextAtGameMs <= state.gameMs && guard < 200) {
    guard++
    if (!rollLowSecAmbush(state, ctx, eventCadenceFactor(state))) {
      fireOneEvent(state, ctx, offline)
    }
    ev.nextAtGameMs += rollGapMs(state, ctx)
  }
}
