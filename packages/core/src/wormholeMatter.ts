/**
 * **终局玩法「虫洞」· 谜质储存器**（F3c 批 · 船长 2026-09-13 逐条裁定，分批落码）。
 *
 * 船长原话（照抄）：
 * - 「**现在做，谜质玩家采集后，在货仓内显示为4格的『谜质储存器』，在本次虫洞探索中提供临时增益**」
 * - 「多种效果，除去战斗上的增益（如果增益抗性，为盾甲结构的单抗性），包括探索上的增益：扫描+1.回合数+10.
 *    威胁-5%。每个装置额外打捞/采集等。你可以继续丰富，然后列出让我审查」
 * - 「**威胁类,抗性，回避，敌方命中削减进行封顶**」（其余一律不封顶，**回合数也不封顶**）
 * - 「**实时派生 + 夹紧 + 丢弃提醒**」（回合类装置的口径）
 * - 「**每层保底 1 个谜质格**」
 *
 * 三条共同口径：
 * 1. **一台 = 2×2 = 4 格**形状件（走 `run.hold`，与「遗迹安全货柜」同一套放置 / 拖拽 / 抛弃）；
 * 2. **放在货仓里就生效**——效果一律**现算派生**（本文件不写任何存档字段 ⇒ 零迁移）；
 * 3. **本趟结束随趟消失**（不进仓库、不拆解）。
 *
 * 分批：
 * - **A 批（本文件当前已落）**：探索与作业类 **7 台**——扫描半径 / 回合上限 / 打捞 +堆 / 采集 +堆 /
 *   星云驱散 / 母矿产量 / 舱段扩展；
 * - **B 批（后续，同表继续追加）**：威胁类 3 台（压制力场 / 守卫解析仪 / 撤离掩护器 · **合计 −50% 封顶**）
 *   ＋ 战斗类 12 台（抗性三片 / 追踪 / 回避 / 干扰 / 射程 / 盲区压制 / 齐射溢出 / 弹药增效 /
 *   装填加速 / 弹药退款 / 机群回收网 / 战地维修）。
 *
 * ⚠ 本模块**不 import `wormhole.ts`**（那边要引本文件的派生函数，反向引会成环）：
 * 入参一律取**货仓**（`WormholeHoldState`）或普通字段，不取整趟状态。
 */
import type { WormholeHoldState } from './wormholeHold'

/** 装置的效果类别（**B 批在同一联合里继续追加**，派生函数按类别汇总） */
export type WormholeMatterEffectKind =
  /** 扫描半径 +N 圈 */
  | 'scanRadius'
  /** 回合上限 +N（**实时派生 + 夹紧**：装上就加、卸下就减并把剩余夹到新上限） */
  | 'turnBudget'
  /** 每次打捞 +N 堆（与打捞器台数同链相加） */
  | 'salvagePiles'
  /** 每次采集 +N 堆（与采集器台数同链相加） */
  | 'collectPiles'
  /** 每次扫描**额外**驱散 N 格星云（就近，不额外花回合） */
  | 'nebulaDisperse'
  /** 母矿堆产量 +N%（`per` 写成小数：0.25 = +25%） */
  | 'oreYieldPct'
  /** 货仓有效格数 +N（物理上不超过货仓真实容量） */
  | 'holdCells'

/** 一台谜质储存器的定义 */
export interface WormholeMatterDevice {
  /** 物品 id（与 `packages/data/src/items.ts` 的登记逐字一致） */
  id: string
  /** 玩家可见名（与物品卡同名） */
  name: string
  effect: WormholeMatterEffectKind
  /** 每枚的数值（百分比类写小数：0.25 = +25%） */
  per: number
  /** 一句话作用（玩家向：货仓读数行与卡片用；**不写开发口径**） */
  text: string
}

/**
 * 装置表（A 批 7 台）。
 * ⚠ 效果数值一律**每枚**，多枚按台数线性相加（船长裁定"不设上限"，只有四类封顶，见 B 批）。
 */
export const WORMHOLE_MATTER_DEVICES: readonly WormholeMatterDevice[] = [
  {
    id: 'mat-surveyor',
    name: '深空测绘仪',
    effect: 'scanRadius',
    per: 1,
    text: '扫描半径 +1 圈',
  },
  {
    id: 'mat-chrono',
    name: '时序核心',
    effect: 'turnBudget',
    per: 10,
    text: '本趟回合上限 +10',
  },
  {
    id: 'mat-crane',
    name: '打捞起重机',
    effect: 'salvagePiles',
    per: 1,
    text: '每次打捞 +1 堆',
  },
  {
    id: 'mat-drill',
    name: '采集钻机',
    effect: 'collectPiles',
    per: 1,
    text: '每次采集 +1 堆',
  },
  {
    id: 'mat-nebula',
    name: '星云驱散器',
    effect: 'nebulaDisperse',
    per: 2,
    text: '每次扫描额外驱散 2 格星云',
  },
  {
    id: 'mat-enricher',
    name: '母矿富集器',
    effect: 'oreYieldPct',
    per: 0.25,
    text: '采到的虚空母矿 +25%',
  },
  {
    id: 'mat-expander',
    name: '舱段扩展器',
    effect: 'holdCells',
    per: 8,
    text: '货仓有效格数 +8',
  },
]

/** 全部装置 id（形状表、闸门契约与用例共用一份） */
export const WORMHOLE_MATTER_DEVICE_IDS: readonly string[] = WORMHOLE_MATTER_DEVICES.map((d) => d.id)

const BY_ID: ReadonlyMap<string, WormholeMatterDevice> = new Map(WORMHOLE_MATTER_DEVICES.map((d) => [d.id, d]))

/** 认 id 取定义（不是装置 ⇒ undefined） */
export function wormholeMatterDeviceOf(itemId: string): WormholeMatterDevice | undefined {
  return BY_ID.get(itemId)
}

/** 这件东西是不是谜质储存器 */
export function wormholeIsMatterDevice(itemId: string): boolean {
  return BY_ID.has(itemId)
}

/** 逐台台数（按装置表顺序；界面读数行与用例共用） */
export function wormholeMatterCounts(
  hold: WormholeHoldState | null | undefined,
): ReadonlyArray<{ device: WormholeMatterDevice; count: number }> {
  const byId = new Map<string, number>()
  for (const p of hold?.placements ?? []) {
    if (wormholeIsMatterDevice(p.itemId)) byId.set(p.itemId, (byId.get(p.itemId) ?? 0) + 1)
  }
  return WORMHOLE_MATTER_DEVICES.filter((d) => (byId.get(d.id) ?? 0) > 0).map((d) => ({
    device: d,
    count: byId.get(d.id) ?? 0,
  }))
}

/** 派生出的本趟增益（**全部现算**；缺省 = 无装置时的零值） */
export interface WormholeMatterBuffs {
  /** 装置总台数 */
  devices: number
  /** 扫描半径加成（格） */
  scanRadius: number
  /** 回合上限加成（回合） */
  turnBonus: number
  /** 每次打捞 +堆 */
  salvagePiles: number
  /** 每次采集 +堆 */
  collectPiles: number
  /** 每次扫描额外驱散星云格数 */
  nebulaDisperse: number
  /** 母矿堆产量倍率（1 = 不变） */
  oreYieldMul: number
  /** 货仓有效格数加成 */
  holdCells: number
  /** 逐台明细（界面读数行） */
  list: ReadonlyArray<{ device: WormholeMatterDevice; count: number }>
}

/** 无装置时的零值（调用方不必判空） */
export const WORMHOLE_MATTER_BUFFS_NONE: WormholeMatterBuffs = {
  devices: 0,
  scanRadius: 0,
  turnBonus: 0,
  salvagePiles: 0,
  collectPiles: 0,
  nebulaDisperse: 0,
  oreYieldMul: 1,
  holdCells: 0,
  list: [],
}

/** 按类别把台数 × 每枚值汇成增益（**唯一派生点**：改口径只动这里） */
export function wormholeMatterBuffs(hold: WormholeHoldState | null | undefined): WormholeMatterBuffs {
  const list = wormholeMatterCounts(hold)
  if (list.length === 0) return WORMHOLE_MATTER_BUFFS_NONE
  const out: WormholeMatterBuffs = { ...WORMHOLE_MATTER_BUFFS_NONE, list }
  for (const { device, count } of list) {
    out.devices += count
    const v = device.per * count
    switch (device.effect) {
      case 'scanRadius':
        out.scanRadius += v
        break
      case 'turnBudget':
        out.turnBonus += v
        break
      case 'salvagePiles':
        out.salvagePiles += v
        break
      case 'collectPiles':
        out.collectPiles += v
        break
      case 'nebulaDisperse':
        out.nebulaDisperse += v
        break
      case 'oreYieldPct':
        out.oreYieldMul += v
        break
      case 'holdCells':
        out.holdCells += v
        break
    }
  }
  return out
}

/**
 * **某一格的谜质是哪一台**（层内每格恒定、可复现；不写存档 ⇒ 读档后仍然是同一台）。
 * 散列只用 (种子, 层, 格 key)：同格的装置跨存档 / 跨会话一致。
 */
export function wormholeMatterDeviceAt(seed: number, depth: number, cellKey: string): WormholeMatterDevice {
  let h = (Math.imul(seed | 0, 2654435761) ^ Math.imul(depth | 0, 40503)) >>> 0
  for (let i = 0; i < cellKey.length; i++) h = Math.imul(h ^ cellKey.charCodeAt(i), 16777619) >>> 0
  return WORMHOLE_MATTER_DEVICES[h % WORMHOLE_MATTER_DEVICES.length]!
}

/** 回合类装置：装上一台 = +N 回合；卸下一台 = −N 回合（`per` 已按台数折算） */
export function wormholeMatterTurnDeltaOf(itemId: string): number {
  const d = wormholeMatterDeviceOf(itemId)
  return d && d.effect === 'turnBudget' ? d.per : 0
}

/**
 * **实时派生 + 夹紧**（船长 2026-09-13 裁定）：把一台回合类装置装上 / 卸下时改本趟回合预算。
 * - 装上（`sign = 1`）：上限与剩余**各 +N**；
 * - 卸下（`sign = -1`）：上限 **−N**，剩余**夹到新上限**（`min(剩余, 新上限)`）、且**永不为负**；
 *   ⚠ 剩余不会"倒扣"——丢掉装置只是上限变小，已经花掉的回合不追缴。
 * 非回合类装置 ⇒ 原样返回（调用方可无脑调）。
 */
export function wormholeMatterApplyTurnDelta(
  run: { turnsLeft: number; turnsTotal: number },
  itemId: string,
  sign: 1 | -1,
): void {
  const delta = wormholeMatterTurnDeltaOf(itemId)
  if (delta === 0) return
  run.turnsTotal = Math.max(0, run.turnsTotal + sign * delta)
  run.turnsLeft = Math.max(0, run.turnsLeft + sign * delta)
  if (run.turnsLeft > run.turnsTotal) run.turnsLeft = run.turnsTotal
}

/**
 * **丢弃前的提醒**（船长：「如果玩家丢弃回合相关谜质导致回合数不够，需要提醒玩家」）：
 * 只对回合类装置返回一句话（其余装置返回 null ⇒ 界面照旧直接抛）。
 */
export function wormholeMatterDiscardHint(itemId: string): string | null {
  const delta = wormholeMatterTurnDeltaOf(itemId)
  if (delta === 0) return null
  return `丢掉「${wormholeMatterDeviceOf(itemId)?.name ?? itemId}」会少 ${delta} 回合：可能走不到想去的格子（撤离不受影响，任何回合数都能撤）。`
}
