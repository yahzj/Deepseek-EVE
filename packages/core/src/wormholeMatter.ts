/**
 * **终局玩法「虫洞」· 谜质储存器**（F3c 批 · 船长 2026-09-13 逐条裁定，分批落码）。
 *
 * 船长原话（照抄）：
 * - 「**现在做，谜质玩家采集后，在货仓内显示为4格的『谜质储存器』，在本次虫洞探索中提供临时增益**」
 * - 「多种效果，除去战斗上的增益（如果增益抗性，为盾甲结构的单抗性），包括探索上的增益：扫描+1.回合数+10.
 *    威胁-5%。每个装置额外打捞/采集等。你可以继续丰富，然后列出让我审查」
 * - 「战斗相关可以根据现有的机制和属性继续扩充」
 * - 「**威胁类,抗性，回避，敌方命中削减进行封顶**」（其余一律不封顶，**回合数也不封顶**）
 * - 「**实时派生 + 夹紧 + 丢弃提醒**」（回合类装置的口径）·「**每层保底 1 个谜质格**」
 * - 「近盲带抑制器好像对我方没有效果吧？」（**对**：`blindDmgMul` 只作用于敌方 ⇒ 改防御向「盲区压制器」）
 * - 「齐射协调仪改为溢出火力会转移到其他敌舰」（新机制，B2 批）·「战地维修单元同时修复护甲」（B2 批）
 *
 * 三条共同口径：
 * 1. **一台 = 2×2 = 4 格**形状件（走 `run.hold`，与「遗迹安全货柜」同一套放置 / 拖拽 / 抛弃）；
 * 2. **放在货仓里就生效**——效果一律**现算派生**（本文件不写任何存档字段 ⇒ 零迁移）；
 * 3. **本趟结束随趟消失**（不进仓库、不拆解）。
 *
 * 分批：
 * - **A 批（已落）**：探索与作业类 **7 台**；
 * - **B1 批（已落）**：威胁类 3 台 ＋ 战斗类 10 台（静态增益：抗性 / 命中 / 回避 / 干扰 / 射程 / 盲区 /
 *   弹药增效 / 装填）；
 * - **B2 批（未落）**：齐射溢出转移（新机制）· 弹药退款 · 机群回收网 · 战地维修（装甲＋结构）。
 *
 * ⚠ 本模块**不 import `wormhole.ts` / `combat.ts`**（那边要引本文件的派生函数，反向引会成环）：
 * 入参一律取**货仓**（`WormholeHoldState`）或普通字段，不取整趟状态。
 */
import type { WormholeHoldState } from './wormholeHold'

/** 装置的效果类别 */
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
  /* ── B1：威胁类（船长：「威胁类,抗性，回避，敌方命中削减进行封顶」）── */
  /** 本层威胁 −N%（节点 / 守卫 / 撤离**三处同源**；与下面两条合计 **−50% 封顶**） */
  | 'threatAll'
  /** **层末守卫**威胁额外 −N%（只作用于 `kind === 'boss'`，计入同一个 −50% 合计） */
  | 'threatBoss'
  /** ⚠ **已退役（2026-09-15 撤离战取消）**：撤离战威胁额外 −N%（旧口径只作用于 `kind === 'extract'`） */
  | 'threatExtract'
  /* ── B1：战斗类（现算：开战时按货仓里的台数算好）── */
  /** 护盾层对**敌队主伤害系**的缺口 +N（走既有"缺口削减"合成，三层上限 0.9 不变） */
  | 'resistShield'
  /** 装甲层同上 */
  | 'resistArmor'
  /** 结构层同上 */
  | 'resistHull'
  /** 我方命中加成 +N（不封顶） */
  | 'hitBonus'
  /** 我方回避 +N（**合计 +0.25 封顶**） */
  | 'evasion'
  /** 敌方命中加成 −N（**合计 −0.25 封顶**） */
  | 'enemyHitDown'
  /** 全武器射程 +N%（不封顶） */
  | 'weaponRangePct'
  /** 敌方**近盲带伤害比例** −N/台（下限 0：贴脸缠斗时敌人打得更轻） */
  | 'blindReduce'
  /** 我方单发伤害 +N%（不封顶） */
  | 'damagePct'
  /** 武器装填周期 −N%（不封顶；物理上周期 > 0） */
  | 'reloadPct'
  /* ── B2：战后收口与新机制 ── */
  /** **齐射溢出转移**（1 台即生效，多台不叠加）：打死后多余的那一截火力转给下一艘存活敌舰 */
  | 'volleyOverflow'
  /** 战后**弹药退款** +N%（按本场打出去的弹药折算；物理上限 100%） */
  | 'ammoRefundPct'
  /** **机群回收率** +N 个百分点（物理上限 100%） */
  | 'droneRecoveryPct'
  /** 战后**战地维修**：装甲与结构各 +N%（物理上限 100%） */
  | 'fieldRepairPct'

/** 一台谜质储存器的定义 */
export interface WormholeMatterDevice {
  /** 物品 id（与 `packages/data/src/items.ts` 的登记逐字一致） */
  id: string
  /** 玩家可见名（与物品卡同名） */
  name: string
  /** **货仓格里的短标签**（2 字；格子里只有图标 + 它，悬停才给全名与效果） */
  short: string
  effect: WormholeMatterEffectKind
  /** 每枚的数值（百分比类写小数：0.25 = +25%） */
  per: number
  /** 一句话作用（玩家向：货仓读数行与卡片用；**不写开发口径**） */
  text: string
  /**
   * ⚠ **退役留档**（2026-09-15 起）：为 true 的装置**不再从谜质里抽出**（见 `WORMHOLE_MATTER_DRAW_POOL`），
   * 但**条目与物品卡保留**（老档货仓里可能正带着它；`content:check` 的谜质契约也要求 core 表与 data 表一致）。
   * 首个退役项 = 撤离掩护器（撤离战取消）。
   */
  retired?: boolean
}

/** 四类封顶里的"威胁"档（船长 2026-09-13 点名的四类；其余一律不封顶） */
export const WORMHOLE_MATTER_THREAT_FLOOR_MUL = 0.5
/** 我方回避的**加成**上限 */
export const WORMHOLE_MATTER_EVASION_CAP = 0.25
/** 敌方命中**削减**上限 */
export const WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP = 0.25
/** 抗性沿用既有上限（每层每系 0.9；不新增旋钮） */
export const WORMHOLE_MATTER_RESIST_CAP = 0.9

/**
 * 装置表（A 批 7 台 ＋ B1 批 13 台）。
 * ⚠ 效果数值一律**每枚**，多枚按台数线性相加；四类封顶在 `wormholeMatterBuffs` 里统一夹。
 */
export const WORMHOLE_MATTER_DEVICES: readonly WormholeMatterDevice[] = [
  /* ── A 批：探索与作业 ── */
  {
    id: 'mat-surveyor',
    short: '测绘',
    name: '深空测绘仪',
    effect: 'scanRadius',
    per: 1,
    text: '扫描半径 +1 圈',
  },
  {
    id: 'mat-chrono',
    short: '时序',
    name: '时序核心',
    effect: 'turnBudget',
    per: 10,
    text: '本趟回合上限 +10',
  },
  {
    id: 'mat-crane',
    short: '起重',
    name: '打捞起重机',
    effect: 'salvagePiles',
    per: 1,
    text: '每次打捞 +1 堆',
  },
  {
    id: 'mat-drill',
    short: '钻机',
    name: '采集钻机',
    effect: 'collectPiles',
    per: 1,
    text: '每次采集 +1 堆',
  },
  {
    id: 'mat-nebula',
    short: '驱散',
    name: '星云驱散器',
    effect: 'nebulaDisperse',
    per: 2,
    text: '每次扫描额外驱散 2 格星云',
  },
  {
    id: 'mat-enricher',
    short: '富集',
    name: '母矿富集器',
    effect: 'oreYieldPct',
    per: 0.25,
    text: '采到的虚空母矿 +25%',
  },
  {
    id: 'mat-expander',
    short: '扩展',
    name: '舱段扩展器',
    effect: 'holdCells',
    per: 8,
    text: '货仓有效格数 +8',
  },
  /* ── B1 批：威胁类（两档合计 −50% 封顶）── */
  {
    id: 'mat-suppressor',
    short: '压制',
    name: '压制力场',
    effect: 'threatAll',
    per: 0.05,
    text: '本层威胁 −5%（节点 / 守卫同源）',
  },
  {
    id: 'mat-boss-analyzer',
    short: '解析',
    name: '守卫解析仪',
    effect: 'threatBoss',
    per: 0.1,
    text: '层末守卫威胁 −10%',
  },
  {
    /**
     * ⚠ **已退役（2026-09-15 船长「虫洞的撤离战取消吧」）**：撤离战整条退役 ⇒ 本装置**不再从谜质里抽出**
     * （`WORMHOLE_MATTER_DRAW_POOL` 已排除退役项）。
     *
     * 条目与物品卡**保留不删**，两个理由：① 老档货仓里可能正带着它（谜质是本趟限定物），删了会变成
     * "读不懂的东西"；② `content:check` 的「谜质契约」要求 core 装置表与 data 物品表（`kind: 'matter'`）
     * 逐字一致。⇒ 保留 = **退役留档**（照 B 族/F 族与退役窝点卡的先例），其效果列已无消费者。
     */
    id: 'mat-extract-cover',
    short: '掩护',
    name: '撤离掩护器',
    effect: 'threatExtract',
    per: 0.1,
    text: '谜质凝成的一层薄壳：已不再提供增益',
    retired: true,
  },
  /* ── B1 批：战斗类 ── */
  {
    id: 'mat-shield-res',
    short: '盾谐',
    name: '护盾谐振片',
    effect: 'resistShield',
    per: 0.1,
    text: '护盾对敌方主伤害系抗性 +10 点（只作用护盾）',
  },
  {
    id: 'mat-armor-res',
    short: '甲固',
    name: '装甲强化片',
    effect: 'resistArmor',
    per: 0.1,
    text: '装甲对敌方主伤害系抗性 +10 点（只作用装甲）',
  },
  {
    id: 'mat-hull-res',
    short: '构固',
    name: '结构加固片',
    effect: 'resistHull',
    per: 0.1,
    text: '结构对敌方主伤害系抗性 +10 点（只作用结构）',
  },
  {
    id: 'mat-tracker',
    short: '追踪',
    name: '追踪阵列',
    effect: 'hitBonus',
    per: 0.05,
    text: '我方命中 +0.05',
  },
  {
    id: 'mat-gyro',
    short: '陀螺',
    name: '陀螺稳定器',
    effect: 'evasion',
    per: 0.05,
    text: '我方回避 +0.05（最多 +0.25）',
  },
  {
    id: 'mat-jammer',
    short: '干扰',
    name: '干扰发射器',
    effect: 'enemyHitDown',
    per: 0.05,
    text: '敌方命中 −0.05（最多 −0.25）',
  },
  {
    id: 'mat-rangefinder',
    short: '射程',
    name: '射程扩展器',
    effect: 'weaponRangePct',
    per: 0.1,
    text: '全武器射程 +10%',
  },
  {
    id: 'mat-blindspot',
    short: '盲区',
    name: '盲区压制器',
    effect: 'blindReduce',
    per: 0.05,
    text: '敌方贴脸开火的伤害比例 −0.05',
  },
  {
    id: 'mat-ammo-dmg',
    short: '弹效',
    name: '弹药增效器',
    effect: 'damagePct',
    per: 0.08,
    text: '我方单发伤害 +8%',
  },
  {
    id: 'mat-reload',
    short: '装填',
    name: '装填加速器',
    effect: 'reloadPct',
    per: 0.08,
    text: '武器装填周期 −8%',
  },
  /* ── B2 批：战后收口与新机制 ── */
  {
    id: 'mat-volley',
    short: '齐射',
    name: '齐射协调仪',
    effect: 'volleyOverflow',
    per: 1,
    text: '齐射打死后，多余的火力转给下一艘敌舰',
  },
  {
    id: 'mat-ammo-back',
    short: '回收',
    name: '弹药回收装置',
    effect: 'ammoRefundPct',
    per: 0.25,
    text: '战后弹药退款 +25%（按本场打出去的折算）',
  },
  {
    id: 'mat-drone-net',
    short: '机网',
    name: '机群回收网',
    effect: 'droneRecoveryPct',
    per: 0.1,
    text: '机群回收率 +10 个百分点',
  },
  {
    id: 'mat-field-repair',
    short: '维修',
    name: '战地维修单元',
    effect: 'fieldRepairPct',
    per: 0.05,
    text: '战后装甲与结构各 +5%（不耗货仓组件）',
  },
]

/** 全部装置 id（形状表、闸门契约与用例共用一份） */
export const WORMHOLE_MATTER_DEVICE_IDS: readonly string[] = WORMHOLE_MATTER_DEVICES.map((d) => d.id)

/**
 * **抽取池**（= 出谜质时按散列取哪一台的来源）：**排除退役项**。
 *
 * ⚠ 2026-09-15：撤离掩护器退役 ⇒ 它仍在 `WORMHOLE_MATTER_DEVICES`（老档要读得懂、契约要求两表一致），
 * 但**不再会掉出来**。新增退役项只需在表里标 `retired: true`，池子自动跟随。
 */
export const WORMHOLE_MATTER_DRAW_POOL: readonly WormholeMatterDevice[] = WORMHOLE_MATTER_DEVICES.filter(
  (d) => d.retired !== true,
)

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
  /* ── B1：威胁（按用途分档；`node` = 层内节点战，`boss` = 层末守卫）── */
  /** 压制力场那部分（两档同源；1 = 不减） */
  threatNodeMul: number
  /** 守卫那部分（只作用 boss 档） */
  threatBossMul: number
  /** ⚠ **已退役（2026-09-15 撤离战取消）**：撤离那部分（旧口径只作用 extract 档）——无消费者 */
  threatExtractMul: number
  /* ── B1：战斗静态增益 ── */
  /** 三层对"敌队主伤害系"的缺口（各自 0.9 封顶；合成走既有"缺口削减"） */
  resistShield: number
  resistArmor: number
  resistHull: number
  /** 我方命中加成（不封顶） */
  hitBonus: number
  /** 我方回避加成（**+0.25 封顶**） */
  evasion: number
  /** 敌方命中削减（**−0.25 封顶**） */
  enemyHitDown: number
  /** 全武器射程加成（不封顶） */
  weaponRangePct: number
  /** 敌方近盲带伤害比例削减（**总量**，下限 0） */
  blindReduce: number
  /** 我方单发伤害加成（不封顶） */
  damagePct: number
  /** 武器装填周期削减（不封顶；物理上周期仍 > 0） */
  reloadPct: number
  /* ── B2：战后收口与新机制 ── */
  /** **齐射溢出转移**是否生效（1 台即开；多台不叠加） */
  volleyOverflow: boolean
  /** 战后弹药退款比例（0~1；物理上限 100%） */
  ammoRefundPct: number
  /** 机群回收率加成（0~1；物理上限 100%） */
  droneRecoveryPct: number
  /** 战地维修：装甲 / 结构各回复比例（0~1；物理上限 100%） */
  fieldRepairPct: number
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
  threatNodeMul: 1,
  threatBossMul: 1,
  threatExtractMul: 1,
  resistShield: 0,
  resistArmor: 0,
  resistHull: 0,
  hitBonus: 0,
  evasion: 0,
  enemyHitDown: 0,
  weaponRangePct: 0,
  blindReduce: 0,
  damagePct: 0,
  reloadPct: 0,
  volleyOverflow: false,
  ammoRefundPct: 0,
  droneRecoveryPct: 0,
  fieldRepairPct: 0,
  list: [],
}

/**
 * 某用途的**威胁倍率**（各档独立算、**各自 −50% 封顶**）：
 * 「压制力场」两档同源（节点 / 守卫），「守卫解析仪」只加在 boss 档。
 *
 * ⚠ 2026-09-15：`'extract'` 档随撤离战**一并退役** —— 形参保留只为兼容老档调用点，
 * `threatExtractMul` 已无产出源（撤离掩护器退役）。单位口径 = **乘数**（0.5 = 威胁减半），
 * 调用方 `Math.round(基础威胁 × mul)`。
 */
export function wormholeMatterThreatMul(buffs: WormholeMatterBuffs, kind: 'node' | 'boss' | 'extract'): number {
  const extra = kind === 'boss' ? buffs.threatBossMul : kind === 'extract' ? buffs.threatExtractMul : 1
  const mul = buffs.threatNodeMul * extra
  return Math.max(WORMHOLE_MATTER_THREAT_FLOOR_MUL, Math.min(1, mul))
}

/** 按类别把台数 × 每枚值汇成增益（**唯一派生点**：改口径只动这里；四类封顶也在这里夹） */
export function wormholeMatterBuffs(hold: WormholeHoldState | null | undefined): WormholeMatterBuffs {
  const list = wormholeMatterCounts(hold)
  if (list.length === 0) return WORMHOLE_MATTER_BUFFS_NONE
  const out: WormholeMatterBuffs = { ...WORMHOLE_MATTER_BUFFS_NONE, list }
  /** 三条威胁类各自的"减威胁"总量（先累加，最后按档合成并夹 −50%） */
  let threatAll = 0
  let threatBoss = 0
  let threatExtract = 0
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
      case 'threatAll':
        threatAll += v
        break
      case 'threatBoss':
        threatBoss += v
        break
      case 'threatExtract':
        // ⚠ 已退役（2026-09-15 撤离战取消）：保留累加只为读得懂老档的装置账，无消费者
        threatExtract += v
        break
      case 'resistShield':
        out.resistShield += v
        break
      case 'resistArmor':
        out.resistArmor += v
        break
      case 'resistHull':
        out.resistHull += v
        break
      case 'hitBonus':
        out.hitBonus += v
        break
      case 'evasion':
        out.evasion += v
        break
      case 'enemyHitDown':
        out.enemyHitDown += v
        break
      case 'weaponRangePct':
        out.weaponRangePct += v
        break
      case 'blindReduce':
        out.blindReduce += v
        break
      case 'damagePct':
        out.damagePct += v
        break
      case 'reloadPct':
        out.reloadPct += v
        break
      case 'volleyOverflow':
        out.volleyOverflow = true
        break
      case 'ammoRefundPct':
        out.ammoRefundPct += v
        break
      case 'droneRecoveryPct':
        out.droneRecoveryPct += v
        break
      case 'fieldRepairPct':
        out.fieldRepairPct += v
        break
    }
  }
  // ── 四类封顶（船长点名的那四类；其余不封顶）──
  out.threatNodeMul = 1 - threatAll
  out.threatBossMul = 1 - threatBoss
  out.threatExtractMul = 1 - threatExtract
  out.resistShield = Math.min(WORMHOLE_MATTER_RESIST_CAP, out.resistShield)
  out.resistArmor = Math.min(WORMHOLE_MATTER_RESIST_CAP, out.resistArmor)
  out.resistHull = Math.min(WORMHOLE_MATTER_RESIST_CAP, out.resistHull)
  out.evasion = Math.min(WORMHOLE_MATTER_EVASION_CAP, out.evasion)
  out.enemyHitDown = Math.min(WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP, out.enemyHitDown)
  // 近盲带比例不能被压到负数（物理边界：它本身是个倍率）
  out.blindReduce = Math.max(0, out.blindReduce)
  // 战后收口三项：**物理上限 100%**（不是平衡封顶——比例类不可能超过 1）
  out.ammoRefundPct = Math.min(1, out.ammoRefundPct)
  out.droneRecoveryPct = Math.min(1, out.droneRecoveryPct)
  out.fieldRepairPct = Math.min(1, out.fieldRepairPct)
  return out
}

/**
 * **某一格的谜质是哪一台**（层内每格恒定、可复现；不写存档 ⇒ 读档后仍然是同一台）。
 * 散列只用 (种子, 层, 格 key)：同格的装置跨存档 / 跨会话一致。
 *
 * ⚠ 取的是 **`WORMHOLE_MATTER_DRAW_POOL`（已排除退役项）**：2026-09-15 起撤离掩护器不再掉出。
 */
export function wormholeMatterDeviceAt(seed: number, depth: number, cellKey: string): WormholeMatterDevice {
  let h = (Math.imul(seed | 0, 2654435761) ^ Math.imul(depth | 0, 40503)) >>> 0
  for (let i = 0; i < cellKey.length; i++) h = Math.imul(h ^ cellKey.charCodeAt(i), 16777619) >>> 0
  return WORMHOLE_MATTER_DRAW_POOL[h % WORMHOLE_MATTER_DRAW_POOL.length]!
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
