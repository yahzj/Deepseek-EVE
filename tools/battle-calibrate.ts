/**
 * V18/C4 战斗校准工具（替代 V12 旧版）：真实模拟胜率矩阵。
 *
 * 用法：npx tsx tools/battle-calibrate.ts
 * - 对每条"船 × 装配 × 技能档"跑 SEEDS 场确定性实战（advanceBattleFor 推到分出胜负/
 *   时间上限），输出平均胜率 % + 平均交火秒数 + 我方平均残血% —— 校准依据 = 真实结算，
 *   不是稳态近似（接近期/射程错位/随机目标都如实计入）。
 * - 装配行：裸船 / 三族 MK1·MK2·MK3 / 三形态混装演示 / 支援件满 / 无人机流 D1-D3
 *   （2026-09-08 二号 C6：此前校准从未覆盖无人机——见 LOADOUTS 无人机段）。
 * - 技能档：无技能 / 中位技能（战斗系 Lv3）/ 全战斗技能 5。
 * - **可选开关 `--charge`**（2026-09-10 船长「这几个需要先跑通战斗再决策」）：**只把本工具的上下文**
 *   里 `foeChargeEnabled` 置 true，用来跑"高威胁近战敌突进若启用了会怎样"的对照矩阵。
 *   **不动引擎默认值**（balance 里仍是 false = 未实装）——纯测量，供决策，不改游戏。
 * - **可选开关 `--proposal`**（2026-09-10 船长「决定对速度进行重新调整」）：按提案的**敌速重标口径**
 *   替换全 26 卡敌速（`PROPOSED_FOE_SPEED`），并可叠加 `--dps=<值>`（foeDpsPerThreat）与
 *   `--hpmul=<倍率>`（逐卡总血同乘）做灵敏度扫描。**同样只改本工具上下文**：引擎默认值与
 *   `data/anomalies.ts` 一律不动 —— 纯预演，供船长审核后再落码。
 *
 * - **标准复核配置集 `--std`（2026-09-11 船长采纳 = 正式口径）**：跑 **A0~A3 四行** × 全 26 卡 × SEEDS，
 *   每格报 **胜率/时长/残血/终局交距/最近交距/我开火/敌开火(头目)/敌开火(杂鱼合计)**。
 *   **纪律：判定"敌人强弱"必须至少跑满 A0~A3 四行**——单跑 A0（中距对射）得出的残血/胜率
 *   会被距离口径污染（详见 `docs/design/foe-baseline-audit-20260911.md` §四）。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { ANOMALIES, SHIPS, buildSimContext } from '@whale/data'
import { advanceBattleFor, createFoeSpecs, createPlayerSpec, foeDesiredRange, foeHpOfThreat, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const BASE_CTX = buildSimContext()
/** 敌突进对照开关（只影响本工具；引擎默认仍是"未实装"） */
const CHARGE_ON = process.argv.includes('--charge')
/** 敌速重标提案预演开关（只影响本工具；引擎与 data 一律不动） */
const PROPOSAL = process.argv.includes('--proposal')

/* ══════════ 下一批预演：战术改判 + 族系冲突（2026-09-10 船长「推进下一批」）══════════
 * `--tactic`：按族系特色改判个别卡的战术。改战术会**连带射程带（TACTIC_RANGE × 成长）、
 * 期望交距（tacticDesireFactor）、速度口径**三件一起变，故本表同时给出改判后的敌速。
 * `--gk=orbit|kite` 用于对"坟场守墓人改到哪一档"做 A/B（默认 orbit）。 */
const TACTIC_ON = process.argv.includes('--tactic')
/** 血量求解：在"中位技能 × S2 灰鲭鲨"参考行上，对每张卡二分求"打完剩 TARGET% 残血"所需的 foeHpOverride */
const SOLVE_HP = process.argv.includes('--solve-hp')
/** 火力扫描：两张能量卡按"基础单发 × 系数"扫一遍看承伤（系数经 `foeShotDmg` 直写落码） */
const DMG_SWEEP = process.argv.includes('--dmg-sweep')
const HP_TARGET_PCT = 45
/** 求解目标：`rem` = 打完剩 TARGET% 残血（orbit/kite 口径）；`dur` = 时长命中该段 D(T)（brawl 口径） */
const HP_SOLVE_MODE: 'rem' | 'dur' = process.argv.includes('--solve-dur') ? 'dur' : 'rem'
const GK_TACTIC = (process.argv.find((a) => a.startsWith('--gk='))?.slice(5) ?? 'orbit') as 'orbit' | 'kite'
const PROPOSED_TACTIC: Record<string, 'brawl' | 'orbit' | 'kite'> = {
  // D 族「守墓古舰」= 残破古典长舰 + 12 km 必中点名炮 → 不该在 2.8 km 贴脸
  'ano-gravekeeper': GK_TACTIC,
  // C 族「异形生物」= 有机曲线 + 螯颚 + 酸液喷吐器 → 「噬口」应贴脸吞噬
  'ano-maw-hunt': 'brawl',
}
/** 改判后的敌速（存储值）：按该战术的新口径带落值 */
const PROPOSED_TACTIC_SPEED: Record<string, number> = {
  'ano-gravekeeper': GK_TACTIC === 'kite' ? 234 : 345, // kite 0.80× / orbit 1.18×
  'ano-maw-hunt': 426, // brawl 1.46×（威胁 80）
}

/**
 * 敌速重标提案（2026-09-10 船长裁决：**固定锚定** + **参考"速度中位线的船只"**；近战卡逐张审核）。
 *
 * ⚠ **本表已于 2026-09-10 落码到 `packages/data/src/anomalies.ts`**（26 张卡全部逐卡显式给值），
 * 故 `--proposal` 现在的输出应与不带开关的基线**逐格一致**——它同时充当"落码一致性自检"；
 * 开关保留给下一轮重标做 A/B 预演（改本表即可，不动 data）。
 *
 * **基准船** = 船池按 `maxSpeedMps` 排序取中位（工具运行时自己算，池子变了基准跟着变）——
 * 当前 = **长尾鲨级导弹巡洋舰**（船速 272 / 敏捷 0.54）→ **基准战斗机动 = 272 ×0.6×(1+(0.54−0.5)×2×0.15)
 * ≈ 165.2 m/s**（无技能、不装推进器）。
 * 比率定义 = **敌战斗机动 ÷ 基准战斗机动**；换算 `存储速度 = 比率 × 基准战斗机动 ÷ 0.564`
 * （敌方敏捷固定 0.3 → 战斗机动 = 存储值 ×0.6×0.94）。
 * s = clamp((威胁−6)/90, 0, 1)：brawl 低段缓坡 1.10/1.15/1.20（T6/T10/T12）→ 1.25+0.25·s（→1.50×）；
 * orbit 0.95+0.25·s（→1.20×）。kite 维持现状（0.69~0.80×）。
 */
const REF_SHIP = [...SHIPS].sort((a, b) => (a.maxSpeedMps ?? 0) - (b.maxSpeedMps ?? 0))[
  Math.floor(SHIPS.length / 2)
]!
const REF_COMBAT = (REF_SHIP.maxSpeedMps ?? 0) * 0.6 * (1 + ((REF_SHIP.agility ?? 0.5) - 0.5) * 2 * 0.15)
/** 敌速存储值换算：战斗机动 → 存储值（敌敏捷 0.3） */
const spin = (r: number): number => Math.round((REF_COMBAT * r) / (0.6 * 0.94))
/** 威胁 → 归一化位置 s = clamp((T−6)/90, 0, 1) */
const sOf = (t: number): number => Math.min(1, Math.max(0, (t - 6) / 90))
/** brawl 目标比率（2026-09-10 船长：①低段缓坡 T6 1.10 / T10 1.15 / T12 1.20；②高段不压反提 → 斜率 0.15→0.25，T96 = 1.50） */
const brawlR = (t: number): number => {
  if (t <= 6) return 1.1
  if (t <= 10) return 1.15
  if (t <= 12) return 1.2
  return 1.25 + 0.25 * sOf(t)
}
/** orbit 目标比率（2026-09-10 船长③：高段不降 → 上限随 brawl 一起上翘到 1.20，E 段基本维持现状） */
const orbitR = (t: number): number => 0.95 + 0.25 * sOf(t)

const PROPOSED_FOE_SPEED: Record<string, number> = {
  // brawl（11 张）：低段缓坡 1.10/1.15/1.20 → 1.25→1.50×
  'ano-training': spin(brawlR(6)),
  'ano-harbor-escort': spin(brawlR(10)),
  'ano-pirate-post': spin(brawlR(12)),
  'ano-shard-bandits': spin(brawlR(20)),
  'enc-pirate-3': spin(brawlR(40)),
  'ano-chasm-aberrations': spin(brawlR(58)),
  // ⚠ **E 族两张已迁入舰级路径**（泰坦残骸勘探 2026-09-11 · 奥罗武装残骸群 2026-09-12）：
  //   舰级路径的速度 / 血量由 `FoeShipDef`（`speedRatio` / `hp`）供给，本表的 `foeSpeedMps` 与
  //   `foeHpOverride` 对它们**不再生效**（`--proposal` 目前只对旧路径卡有意义）——两行留档不动，
  //   待旧卡全部迁完再统一清理本表。
  'ano-titan-wreck': spin(brawlR(60)),
  'ano-auro-raiders': spin(brawlR(62)),
  'enc-pirate-4': spin(brawlR(70)),
  'ano-starcore-boss': spin(brawlR(72)),
  'ano-gravekeeper': spin(brawlR(88)),
  // orbit（10 张）：0.95→1.20×
  'enc-pirate-1': spin(orbitR(10)),
  'ano-abandoned-platform': spin(orbitR(16)),
  'ano-lantern-saboteurs': spin(orbitR(22)),
  'enc-pirate-2': spin(orbitR(22)),
  'ano-cinder-siege': spin(orbitR(42)),
  'ano-echo-haunt': spin(orbitR(52)),
  'ano-nadir-static': spin(orbitR(66)),
  'ano-maw-hunt': spin(orbitR(80)),
  'ano-voidedge-warden': spin(orbitR(88)),
  'ano-vault-sentinel': spin(orbitR(96)),
  // kite（5 张）：维持现状
  'ano-haze-ambush': 201,
  'ano-redring-raiders': 204,
  'ano-abyss-guard': 234,
  'ano-ghost-signal': 234,
  'ano-mirage-hijackers': 235,
}

function argNum(name: string): number | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return undefined
  const v = Number(hit.slice(name.length + 3))
  return Number.isFinite(v) ? v : undefined
}
const PROPOSAL_DPS = argNum('dps')
const PROPOSAL_HP_MUL = argNum('hpmul')
/** 只对 brawl（近战）卡生效的总血乘数——用于"速度上调后近战卡血量该压多少"的灵敏度扫描 */
const PROPOSAL_BRAWL_HP_MUL = argNum('brawlmul')

/** 组装本工具上下文：只有被开关点名的部分会被覆盖，其余与出厂一致 */
function buildCtx(): SimContext {
  let c = BASE_CTX
  if (CHARGE_ON) {
    c = { ...c, balance: { ...c.balance, battle: { ...c.balance.battle, foeChargeEnabled: true } } }
  }
  if (PROPOSAL) {
    const battle = { ...c.balance.battle, foeSpeedCapMul: 1.55 }
    if (PROPOSAL_DPS !== undefined) battle.foeDpsPerThreat = PROPOSAL_DPS
    const anomalies = new Map(c.anomalies)
    for (const [id, a] of c.anomalies) {
      const next = { ...a }
      const spd = PROPOSED_FOE_SPEED[id]
      if (spd !== undefined) next.foeSpeedMps = spd
      const mul = (a.tactic ?? 'orbit') === 'brawl' ? PROPOSAL_BRAWL_HP_MUL : PROPOSAL_HP_MUL
      if (mul !== undefined) {
        next.foeHpOverride = Math.round((a.foeHpOverride ?? foeHpOfThreat(a.threat, battle)) * mul)
      }
      anomalies.set(id, next)
    }
    c = { ...c, anomalies, balance: { ...c.balance, battle } }
  }
  if (TACTIC_ON) {
    const anomalies = new Map(c.anomalies)
    for (const [id, tac] of Object.entries(PROPOSED_TACTIC)) {
      const a = anomalies.get(id)
      if (!a) continue
      const next = { ...a, tactic: tac }
      const spd = PROPOSED_TACTIC_SPEED[id]
      if (spd !== undefined) next.foeSpeedMps = spd
      anomalies.set(id, next)
    }
    c = { ...c, anomalies }
  }
  return c
}

const ctx: SimContext = buildCtx()
const SEEDS = [1, 7, 13, 29, 51]

type Loadout = {
  name: string
  ship: string
  high: string[]
  mid?: string[]
  low?: string[]
  drones?: Record<string, number>
  /** 弹药 MK2（2026-09-09）：本行开战预载弹档（装配档位 ammoPref；缺省 = 基础弹） */
  ammoTier?: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>>
}
const LOADOUTS: Loadout[] = [
  { name: '裸船(基础舰炮)', ship: 'sh-falconet', high: [] },
  { name: '鲣鱼+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'] },
  { name: '鲣鱼+动能MK3', ship: 'sh-falconet', high: ['mod-turret-kin-3'] },
  { name: '鲣鱼+导弹MK3', ship: 'sh-falconet', high: ['mod-missile-3'] },
  { name: '鲣鱼+激光MK3', ship: 'sh-falconet', high: ['mod-laser-3'] },
  { name: '虎鲨三族混装(2kin2+laser2+missile2)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'] },
  { name: '虎鲨2kin2+支援(索敌/陀螺/稳定)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-rof-2'] },
  { name: '鲸王+动能MK3×3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'] },
  /* ── P1 阶段锚行（2026-09-06 战力拉长设计稿：威胁重标按"阶段真实可及配装"标定）── */
  { name: 'S1 虎鲨4×MK2', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-1'] }, // 2026-09-09 敌速口径（船长）：低技能参考行带矢量推进器 MK1（无技能玩家标配）
  { name: 'S2 灰鲭鲨4×MK2+支援', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }, // 2026-09-09 敌速口径（船长）：中位参考行带 MK2（弃闪避陀螺保盾容+索敌——站桩对射卡不吃闪避）
  { name: 'S4 大白鲨5×MK3+支援', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  /* ── T3 巡洋舰线（2026-09-09 尺寸分级新增；MK3 满配 + 支援对照 S4 上层）── */
  { name: 'T3电鳐激光巡5×laser3+支援', ship: 'sh-electricray', high: ['mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3长尾鲨导弹巡5×msl3+支援', ship: 'sh-thresher', high: ['mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3锤头鲨炮巡5×kin3+支援', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3牛鲨突击巡5×kin3+重盾', ship: 'sh-bullshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2'] },
  /* ── 无人机流行（2026-09-08 无人机舱大改：装载只读 droneLoad 清单（不再仓库贪心）；
     各行清单 = 该船「装配后余 CPU × 舱容」内可装的合法满载组合（战斗只放飞已装入的，
     超额由 UI 预占互斥，不会出现）；同船炮流对照见 S1/S2/S4）
     ── 2026-09-10 船长：无人机专用舰高槽 −2（梭鱼 5→3、王鲭 6→4）——D1/D2 由四槽改三槽，
        新增 D2b 展示"槽位吃紧后把单件导控升到 MK3"的取舍；D3 四槽恰好占满 ── */
  { name: 'D1 梭鱼无人机轻装(rack1×2+tac1)', ship: 'sh-swarm', high: ['mod-drone-rack-1', 'mod-drone-rack-1', 'mod-drone-tac-1'], drones: { 'drone-scout': 12, 'drone-assault': 10, 'drone-heavy': 1 } }, // 舱 190m³（rack1×2）：12×5+10×10+1×20 = 180 满载（2026-09-09 体积档 5/10/20/40）；3 高槽
  { name: 'D2 梭鱼无人机中装(rack2×2+tac2)', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2'], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 } }, // 舱 230m³：10×10+4×20+1×40 = 220；3 高槽
  { name: 'D2b 梭鱼(rack2×2+tac3·槽位吃紧后升级)', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-3'], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 } }, // 同舱容，单件导控 MK2→MK3（+25%→+40%；CPU 30+45+130=205 ≤ 235）
  { name: 'D3 王鲭无人机重装(rack3×2+tac3×2)', ship: 'sh-sentinel', high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'], drones: { 'drone-heavy': 4, 'drone-sentry': 6 } }, // 舱 460m³：4×20+6×40 = 320；4 高槽恰好占满
  /* ── 2026-09-10 重大机制变更后的「预想装配」适配行（船长：预想装配最好也适配更新）──
     ①**混伤适配（常驻 8:2 = 主系 80% + 副系 20%）**：原锚行一律「盾抗动能 + 甲抗动能」只堆主系；
       但**动能对甲层本就 ×0.5 克制**（类型克制表：动能 盾 ×1.5 / 甲 ×0.5），在甲层再堆动能抗属低效，
       混伤后副系（能量）绕开主抗 → 适配版 = **盾抗主系、甲抗副系**（覆盖两系）。
     ②**推进器周期点火适配（点火 60 秒 / 冷却 60 秒、顶档 +100%）**：原装配表**没有任何 MK3 推进器行**
       （S1 用 MK1、S2 用 MK2）→ 补一行顶档高机动参照，与同船无推进器版对比。 */
  { name: 'S2 双抗(盾动能·甲能量)', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-pla-2'] }, // 混伤适配：甲层换副系能量抗（对照 S2 原行 = 甲抗动能）
  { name: 'S4 双抗(盾动能·甲能量)', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-pla-2'] }, // 同上，顶配锚行版
  { name: 'T3锤头鲨+推进器MK3(周期点火)', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-prop-3'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }, // 换掉闪避陀螺（点火期 +100% 机动，闪避价值下降）
  /* ── 弹药 MK2 变体（2026-09-09：顶配参考行 + 动能弹 MK2——攻坚耗材定位，E 段失衡与否验证） ── */
  { name: 'S4+动能弹MK2(5×kin3+支援)', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'], ammoTier: { kinetic: 'ammo-kinetic-2' } },
  { name: 'T3牛鲨+动能弹MK2(重盾)', ship: 'sh-bullshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2'], ammoTier: { kinetic: 'ammo-kinetic-2' } },
]

const FULL_SKILLS: Record<string, number> = {
  gunnery: 5,
  'kinetic-gunnery': 5,
  'missile-launching': 5,
  'laser-cannon': 5,
  'fire-control': 5,
  'reload-drills': 5,
  'drone-warfare': 5,
  'drone-servicing': 5,
  'ammunition-condensing': 5,
  'shield-operation': 5,
  'energy-management': 5,
  'hull-upgrades': 5,
  'shield-tuning': 5,
  'armor-tuning': 5,
  'armed-ops': 5,
  'armored-ops': 5,
  'vector-maneuvering': 5,
  'evasion-maneuvering': 5,
  'targeting-integration': 5,
  'ship-systems-engineering': 5,
}

/** 中位技能档（船长 2026-09-06：技能=独立于装备的局外成长，敌人设计对其宽容——
 * 在 0/满 之间加中位参照：同一批技能统一 Lv3） */
const MID_SKILLS: Record<string, number> = Object.fromEntries(Object.keys(FULL_SKILLS).map((k) => [k, 3]))

/* ══════════ 标准复核配置集 A0~A3（2026-09-11 船长采纳 = **正式口径**）══════════
 * 依据：`docs/design/foe-baseline-audit-20260911.md` §四（多装配复核暴露"参考行不具代表性"）。
 * **纪律**：判定敌人强弱 / 数值批验收**必须至少跑满这四行**；单跑 A0 的残血与胜率
 * **不足以**判定敌人软硬（A0 的 mid=3220m 恰好在低威胁敌人射程外，会系统性偏袒玩家）。
 *
 * | 行 | 装配 | 代表打法 | 暴露什么 |
 * |---|---|---|---|
 * | A0 | 4×动能MK2（`700~5740`）＋MK2推进器＋支援，**全技能 L3** | 标准中距对射（基线） | 通用强度基线 |
 * | A1 | 4×轻型炮MK1（`250~3220`）**无推进器**＋支援，全技能 L3 | 贴上去打 | 敌人够不够得着 / 玩家挨打承受力 |
 * | A2 | 4×重型导弹架MK2（`900~11760`）＋MK2推进器＋支援，全技能 L3 | 远程风筝磨血 | 玩家是否在敌射程外白嫖 |
 * | A3 | **A0 装配** ＋ **6 项战斗技能 L3** | 技能未满的过渡期玩家 | 时长失控 / 600s 硬上限触顶 |
 *
 * 主武器射程带的"期望距离（mid）"：A0/A3 → 3220m、A1 → 1735m、A2 → 6330m（引擎 `desiredRangeFor` 口径）。
 */
const LOW6_SKILLS: Record<string, number> = {
  // 6 项 = "弱技能行"的固定口径（与 A 族设计稿 §八 的多技能行实测同源，逐字沿用）：
  gunnery: 3,
  'kinetic-gunnery': 3,
  'reload-drills': 3,
  'fire-control': 3,
  'targeting-integration': 3,
  'shield-operation': 3,
}

type StandardRow = { id: string; label: string; ship: string; ld: Loadout; skills: Record<string, number>; desireM?: number }
const MK2_SUPPORT_MID = ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2']
/** MK3 推进器版支援排（2026-09-11 船长追问「假如玩家装备 MK3 推进器呢」时加的探索行用）：
 *  与 MK2 版**只差推进器档位**——`mod-prop-3` = 点火期 +100% 战斗速度 / 命中 ×0.80（MK2 是 +60% / ×0.88）。
 *  ⚠ CPU 40（MK2 是 15）⇒ 用默认装配时须确认真的装上了（没装上会静默回落到"无推进"，读数会骗人）。 */
const MK3_SUPPORT_MID = ['mod-prop-3', 'mod-shield-kin-2', 'mod-track-2']
/** **能量（等离子）抗性版支援排**（2026-09-11 船长「如果还是过不了，开始撑能量抗性」）：
 *  与 A0 的动能抗版**逐件对应**（`mod-shield-kin-2`→`mod-shield-pla-2`、`mod-stab-kin-2`→`mod-stab-pla-2`、
 *  `mod-armor-kin-2`→`mod-armor-pla-2`），**只换抗性系、其余不动**。 */
const PLA_RESIST_LOW = ['mod-stab-pla-2', 'mod-armor-pla-2']
const PLA_RESIST_MID_MK2 = ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2']
const PLA_RESIST_MID_MK3 = ['mod-prop-3', 'mod-shield-pla-2', 'mod-track-2']
const SUPPORT_MID_NO_PROP = ['mod-shield-kin-2', 'mod-track-2']
const SUPPORT_LOW = ['mod-stab-kin-2', 'mod-armor-kin-2']
const STANDARD_ROWS: readonly StandardRow[] = [
  {
    id: 'A0',
    label: '标准中距对射（基线）',
    ship: 'sh-mako',
    ld: { name: 'A0 4×动能MK2+推进+支援', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: MK2_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
  },
  {
    id: 'A1',
    label: '贴脸近战（MK1 250~3220 · 无推进）',
    ship: 'sh-mako',
    ld: { name: 'A1 4×轻型炮MK1+支援(无推进)', ship: 'sh-mako', high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'], mid: SUPPORT_MID_NO_PROP, low: SUPPORT_LOW },
    skills: MID_SKILLS,
  },
  {
    id: 'A2',
    label: '远程风筝（导弹MK2 900~11760）',
    ship: 'sh-mako',
    ld: { name: 'A2 4×重型导弹架MK2+推进+支援', ship: 'sh-mako', high: ['mod-missile-2', 'mod-missile-2', 'mod-missile-2', 'mod-missile-2'], mid: MK2_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
  },
  {
    id: 'A3',
    label: '弱技能行（A0 装配 + 6 项 L3）',
    ship: 'sh-mako',
    ld: { name: 'A3 4×动能MK2+推进+支援(弱技能)', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: MK2_SUPPORT_MID, low: SUPPORT_LOW },
    skills: LOW6_SKILLS,
  },
]

/** 单位 tag 是否算"头目"（= 该波第一个单位）：'foe-0' / 'w1-foe-0' … */
const isBossTag = (tag: string): boolean => /^(w\d+-)?foe-0$/.test(tag)

/**
 * **探索行（`--std6`，2026-09-11 C 族落码批加）**——补 `docs/design/foe-baseline-audit-20260911.md` §二
 * 六组里**正式四行（A0~A3）未覆盖**的三条，用于"某张卡在某个打法下到底会不会还手"这类**定向复核**：
 * - `B0 参考行去推进器`（同 A0 射程、机动差）——③探索行；
 * - `B1 转管炮贴脸`（4×劫掠者转管炮 `180~3600`，装填 1200ms，无推进器）——⑤探索行；
 * - `B2 裸船零技能`（鲣鱼级裸船，只带自带舰炮、无技能）——新手刚出教学场的真实起点。
 *
 * ⚠ **不属于船长采纳的四行口径**（那个口径仍是 A0~A3，`--std` 输出不变）；
 * 探索行只在**明确需要**时跑（如某张卡被怀疑"贴脸沙包"或"打不动新手"），并须在报告里标明行名。
 */
const EXPLORE_ROWS: readonly StandardRow[] = [
  {
    id: 'B0' as StandardRow['id'],
    label: '参考行去推进器（探索③）',
    ship: 'sh-mako',
    ld: { name: 'B0 4×动能MK2+支援(无推进)', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: SUPPORT_MID_NO_PROP, low: SUPPORT_LOW },
    skills: MID_SKILLS,
  },
  {
    id: 'B1' as StandardRow['id'],
    label: '转管炮贴脸无推进（探索⑤）',
    ship: 'sh-mako',
    ld: { name: 'B1 4×转管炮+支援(无推进)', ship: 'sh-mako', high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'], mid: SUPPORT_MID_NO_PROP, low: SUPPORT_LOW },
    skills: MID_SKILLS,
  },
  {
    id: 'B2' as StandardRow['id'],
    label: '裸船零技能（新手起点）',
    ship: 'sh-falconet',
    ld: { name: 'B2 裸船(基础舰炮)无技能', ship: 'sh-falconet', high: [] },
    skills: {},
  },
  {
    // 2026-09-11 船长追问「假如玩家装备 MK3 推进器呢」⇒ 定向复核行：**只换推进器档位**
    // （MK2 → MK3：点火期 +60% → **+100%** 战斗速度，代价 = 命中 ×0.88 → **×0.80**）。
    // 用途：判"高机动能不能把贴脸/追击型敌卡的接近期压回去"——C 族噬口（巨兽射程 4,000 + 冲锋）是首个用例。
    id: 'B3' as StandardRow['id'],
    label: '参考行换 MK3 推进器（定向复核：机动换命中）',
    ship: 'sh-mako',
    ld: { name: 'B3 4×动能MK2+推进MK3+支援', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: MK3_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
  },
  /* ── **近距离两套配置 ×（MK2 / MK3）**（2026-09-11 船长：「为玩家准备 2 套近距离准备，一套设定玩家的
   *   目标距离是 1500 并更换符合的武器，另外一套目标距离 1000 并更换符合的武器，然后分别测试 MK2 和 MK3」）──
   * 动机 = D 族（守墓古舰）把**最短射程**抬到了 1,062 / 2,062 ⇒ 理论上存在"贴到下限以内就免伤"的空档，
   * 而正式四行的实际交距是 4.3~10 km、**根本没用上那条空档** ⇒ 这四条行就是去**用它**：
   * 武器按目标距离挑（`desireM` 直接给出玩家的期望交距，引擎侧 `startBattleFor(..., desireM)`）。 */
  {
    id: 'C0' as StandardRow['id'],
    label: '近距离 1500 · MK2（轻型炮MK1 250~3220 · 目标 1500）',
    ship: 'sh-mako',
    ld: { name: 'C0 4×轻型炮MK1+支援(MK2推进)', ship: 'sh-mako', high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'], mid: MK2_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
    desireM: 1500,
  },
  {
    id: 'C1' as StandardRow['id'],
    label: '近距离 1500 · MK3（轻型炮MK1 · 目标 1500）',
    ship: 'sh-mako',
    ld: { name: 'C1 4×轻型炮MK1+支援(MK3推进)', ship: 'sh-mako', high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'], mid: MK3_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
    desireM: 1500,
  },
  {
    id: 'C2' as StandardRow['id'],
    label: '近距离 1000 · MK2（转管炮 180~3600 装填1.2s · 目标 1000）',
    ship: 'sh-mako',
    ld: { name: 'C2 4×转管炮+支援(MK2推进)', ship: 'sh-mako', high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'], mid: MK2_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
    desireM: 1000,
  },
  {
    id: 'C3' as StandardRow['id'],
    label: '近距离 1000 · MK3（转管炮 · 目标 1000）',
    ship: 'sh-mako',
    ld: { name: 'C3 4×转管炮+支援(MK3推进)', ship: 'sh-mako', high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'], mid: MK3_SUPPORT_MID, low: SUPPORT_LOW },
    skills: MID_SKILLS,
    desireM: 1000,
  },
  /* ── **撑能量抗性**（2026-09-11 船长：「如果还是过不了，开始撑能量抗性」）──
   * 动机：D 族火力对齐后主系是**等离子（能量）**，而 A0 参考装配投资的是**动能抗**
   * （`mod-shield-kin-2` / `mod-stab-kin-2` / `mod-armor-kin-2` —— 原本正是用来克 D 的动能主系的）
   * ⇒ 换系后那笔投资**归零**。这五条行把抗性**逐件换成等离子版**（只换抗性系，其余不动）：
   * `D0~D3` = 上面两套近距离配置 × （MK2 / MK3）；`D4` = **A0 装配原地换能量抗**（中距 3,220，真实玩家最会做的动作）。 */
  {
    id: 'D0' as StandardRow['id'],
    label: '近距离1500 · MK2 · **能量抗**',
    ship: 'sh-mako',
    ld: { name: 'D0 4×轻型炮MK1+能量抗(MK2)', ship: 'sh-mako', high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'], mid: PLA_RESIST_MID_MK2, low: PLA_RESIST_LOW },
    skills: MID_SKILLS,
    desireM: 1500,
  },
  {
    id: 'D1' as StandardRow['id'],
    label: '近距离1500 · MK3 · **能量抗**',
    ship: 'sh-mako',
    ld: { name: 'D1 4×轻型炮MK1+能量抗(MK3)', ship: 'sh-mako', high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'], mid: PLA_RESIST_MID_MK3, low: PLA_RESIST_LOW },
    skills: MID_SKILLS,
    desireM: 1500,
  },
  {
    id: 'D2' as StandardRow['id'],
    label: '近距离1000 · MK2 · **能量抗**',
    ship: 'sh-mako',
    ld: { name: 'D2 4×转管炮+能量抗(MK2)', ship: 'sh-mako', high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'], mid: PLA_RESIST_MID_MK2, low: PLA_RESIST_LOW },
    skills: MID_SKILLS,
    desireM: 1000,
  },
  {
    id: 'D3' as StandardRow['id'],
    label: '近距离1000 · MK3 · **能量抗**',
    ship: 'sh-mako',
    ld: { name: 'D3 4×转管炮+能量抗(MK3)', ship: 'sh-mako', high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'], mid: PLA_RESIST_MID_MK3, low: PLA_RESIST_LOW },
    skills: MID_SKILLS,
    desireM: 1000,
  },
  {
    id: 'D4' as StandardRow['id'],
    label: '**A0 装配原地换能量抗**（动能炮MK2 · 中距 3220 · MK2 推进）',
    ship: 'sh-mako',
    ld: { name: 'D4 4×动能MK2+能量抗(MK2)', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: PLA_RESIST_MID_MK2, low: PLA_RESIST_LOW },
    skills: MID_SKILLS,
  },
  /* ── **E 段巡洋参考行**（2026-09-11 船长纠正：「你为什么是用灰鲭鲨级测试，这已经属于 E 档敌人，
   *   **理论上我们应该上巡洋舰级的船**」）──
   * ⚠ **口径更正**：`A0~A3` 那四行用的是 **`sh-mako` 灰鲭鲨级（T2 驱逐）**，它是**通用**参考船；
   * 而 **E 段（威胁 88/96）的既有参考船是 `sh-hammerhead` 锤头鲨级炮击巡洋舰（T3 巡洋）**
   * —— 2026-09-10 的 `etier` 验收档就是「大白鲨 S4 + **锤头鲨炮巡** + 灰鲭鲨」三行（后者标注"上一档可磨行"）。
   * ⇒ 本组把 D 族那四套配置**搬到巡洋舰上重测**（5 高 / 4 中 / 3 低 · 血 474 vs 灰鲭鲨 366 · CPU 360）： */
  {
    id: 'E0' as StandardRow['id'],
    label: '**E段巡洋·动能抗**（锤头鲨 5×动能MK2 · 中距）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'E0 锤头鲨 5×动能MK2+动能抗',
      ship: 'sh-hammerhead',
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2'],
    },
    skills: MID_SKILLS,
  },
  {
    id: 'E1' as StandardRow['id'],
    label: '**E段巡洋·能量抗**（锤头鲨 5×动能MK2 · 中距）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'E1 锤头鲨 5×动能MK2+能量抗',
      ship: 'sh-hammerhead',
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
      mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: MID_SKILLS,
  },
  {
    id: 'E2' as StandardRow['id'],
    label: '**E段巡洋·近距离1500+能量抗**（锤头鲨 5×轻型炮MK1）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'E2 锤头鲨 5×轻型炮MK1+能量抗',
      ship: 'sh-hammerhead',
      high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'],
      mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: MID_SKILLS,
    desireM: 1500,
  },
  {
    id: 'E3' as StandardRow['id'],
    label: '**E段巡洋·近距离1000+能量抗+MK3**（锤头鲨 5×转管炮）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'E3 锤头鲨 5×转管炮+能量抗(MK3)',
      ship: 'sh-hammerhead',
      high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'],
      mid: ['mod-prop-3', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: MID_SKILLS,
    desireM: 1000,
  },
  /* ── **满技能版 E 段巡洋行**（2026-09-11 船长实测回传：「**调整装配后中位技能可以打**。
   *   **建议你按满技能再测试一遍**」）—— 与 `E0~E3` **只差技能档**（`MID_SKILLS` 20 项 Lv3 → `FULL_SKILLS` 满级），
   *   用于回答"同一套装配在满技能下能不能过"，以及"满技能还能不能靠中位那套打法过"。 */
  {
    id: 'F0' as StandardRow['id'],
    label: '**满技能**·E段巡洋·动能抗（锤头鲨 5×动能MK2）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'F0 锤头鲨 5×动能MK2+动能抗(满技能)',
      ship: 'sh-hammerhead',
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2'],
    },
    skills: FULL_SKILLS,
  },
  {
    id: 'F1' as StandardRow['id'],
    label: '**满技能**·E段巡洋·能量抗（锤头鲨 5×动能MK2）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'F1 锤头鲨 5×动能MK2+能量抗(满技能)',
      ship: 'sh-hammerhead',
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
      mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: FULL_SKILLS,
  },
  {
    id: 'F2' as StandardRow['id'],
    label: '**满技能**·E段巡洋·近距离1500+能量抗（5×轻型炮MK1）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'F2 锤头鲨 5×轻型炮MK1+能量抗(满技能)',
      ship: 'sh-hammerhead',
      high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'],
      mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: FULL_SKILLS,
    desireM: 1500,
  },
  {
    id: 'F3' as StandardRow['id'],
    label: '**满技能**·E段巡洋·近距离1000+能量抗+MK3（5×转管炮）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'F3 锤头鲨 5×转管炮+能量抗(满技能·MK3)',
      ship: 'sh-hammerhead',
      high: ['mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a', 'mod-lair-turret-a'],
      mid: ['mod-prop-3', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: FULL_SKILLS,
    desireM: 1000,
  },
  /* ── **防空行**（2026-09-11 机群批 S4 加）——量"用近防炮打敌方机群到底值不值" ──
   * 动机：E 族「警戒机群」的警戒幕铺在 **4.5 km**，而近防炮射程只有 **1.4 km** ⇒
   * **标准站位（≈3,209m）下近防炮够不着机群**，只有玩家主动贴近才打得到——这两行就是去贴近。
   * 两行都按 **E 段巡洋（锤头鲨 5 高槽）**：`G0` = 纯防空（5 门近防炮，完全不还手打舰）；
   * `G1` = 混装（2 门近防炮 + 3 门动能MK2，既打机群也打舰）——对照"该带几门"。 */
  {
    id: 'G0' as StandardRow['id'],
    label: '**防空行**·E段巡洋·纯防空（锤头鲨 5×巨构近防炮 · 目标 1000）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'G0 锤头鲨 5×巨构近防炮+能量抗',
      ship: 'sh-hammerhead',
      high: ['mod-pd-e', 'mod-pd-e', 'mod-pd-e', 'mod-pd-e', 'mod-pd-e'],
      mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: MID_SKILLS,
    desireM: 1000,
  },
  {
    id: 'G1' as StandardRow['id'],
    label: '**防空行**·E段巡洋·混装（2×巨构近防炮 + 3×动能MK2 · 目标 1000）',
    ship: 'sh-hammerhead',
    ld: {
      name: 'G1 锤头鲨 2×巨构近防炮+3×动能MK2+能量抗',
      ship: 'sh-hammerhead',
      high: ['mod-pd-e', 'mod-pd-e', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
      mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
      low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
    },
    skills: MID_SKILLS,
    desireM: 1000,
  },
]

/** 标准格读数（终局/最近交距 + 开火次数按头目/杂鱼分列） */
type CellReading = {
  win: boolean
  durMs: number
  meRemainPct: number
  endM: number
  minM: number
  meShots: number
  foeShotsBoss: number
  foeShotsMinion: number
}

/**
 * 跑一格（1 播种）：**逐秒推进**并累计开火事件——**我方取 `stats.meShots`（引擎累计，权威）**，
 * 敌方按 `BattleFx.seq` 逐单位累计（头目 = 该波首个单位）。
 *
 * **2026-09-11 修：敌开火列由"环长度游标"改为"seq 游标"**——`fx` 是 **48 条环**（`pushBattleFx` 超长丢最旧），
 * 旧写法 `b.fx.slice(seen)` + `seen = b.fx.length` 在**环满之后 `slice` 恒为空** ⇒ 该场后续开火全部漏计
 * （实测：灰霾 ⑤ 600s 真值 **584** 次被读成 **48** 次、漏 92%；蜃影 A0 **54.0 → 43.2**；蜃影 A1 **136 → 48**）。
 * 改法：被裁掉的永远是**旧事件**（`seq` ≤ 上次最大值），故"`seq` > 上次最大值"的事件**一定还在环里** ⇒ 无损。
 */
function simulateCell(state: GameState, anomalyId: string, ld: Loadout, desireM?: number): CellReading {
  const b = startBattleFor(state, ctx as SimContext, state.shipId, anomalyId, 0, desireM)
  const spec = createPlayerSpec(state, ctx as SimContext, ld.ship)
  const initHp = spec ? spec.hp.s + spec.hp.a + spec.hp.h : 1
  if (!b) return { win: false, durMs: 0, meRemainPct: 0, endM: 0, minM: 0, meShots: 0, foeShotsBoss: 0, foeShotsMinion: 0 }
  const startAt = b.startedAtGameMs
  const budgetMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(anomalyId), ctx.balance.battle)
  let lastSeq = 0
  let foeShotsBoss = 0
  let foeShotsMinion = 0
  let minM = Number.POSITIVE_INFINITY
  for (let t = 1000; t <= budgetMs; t += 1000) {
    state.gameMs = startAt + t
    advanceBattleFor(state, ctx as SimContext, b, state.shipId, anomalyId)
    minM = Math.min(minM, b.distanceM)
    for (const e of b.fx) {
      if (e.seq <= lastSeq) continue
      lastSeq = e.seq
      if (e.side !== 'foe') continue
      if (isBossTag(e.tag)) foeShotsBoss++
      else foeShotsMinion++
    }
    if (b.ended) break
  }
  const u = b.units['player']
  return {
    win: b.ended === 'me',
    durMs: Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs)),
    meRemainPct: (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100,
    endM: Math.round(b.distanceM),
    minM: Number.isFinite(minM) ? Math.round(minM) : 0,
    meShots: b.stats.meShots,
    foeShotsBoss,
    foeShotsMinion,
  }
}

function makeState(shipId: string, ld: Loadout, skills: Record<string, number>, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  addShipToFleet(state, shipId)
  state.shipId = shipId
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  // 2026-09-08（无人机舱大改：装载只读清单——写入驾驶船 droneLoad，仓库库存不再参与装载）
  const entry = state.fleet[shipId]!
  if (ld.drones && Object.keys(ld.drones).length > 0) entry.droneLoad = { ...ld.drones }
  entry.fitted = { high: [...(ld.high ?? [])], mid: [...(ld.mid ?? [])], low: [...(ld.low ?? [])] }
  // 弹药 MK2（2026-09-09）：变体行带档位 + 仓库补足 MK2 弹（预载需求同基础弹量）
  if (ld.ammoTier) {
    entry.ammoPref = { ...ld.ammoTier }
    for (const id of Object.values(ld.ammoTier)) state.warehouse.items[id] = 5_000
  }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

/** 真实模拟一局：返回 胜/时长ms/我方残血比 */
function simulate(state: GameState, anomalyId: string): { win: boolean; durMs: number; meRemain: number } {
  const battle = startBattleFor(state, ctx as SimContext, state.shipId, anomalyId, 0)
  if (!battle) return { win: false, durMs: 0, meRemain: 0 }
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(anomalyId), ctx.balance.battle)
  advanceBattleFor(state, ctx as SimContext, battle, state.shipId, anomalyId)
  const durMs = Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs))
  const u = battle.units['player']
  const meHp = u ? u.hp.s + u.hp.a + u.hp.h : 0
  const specInit = state.fleet[state.shipId]
  void specInit
  const meRemain = meHp
  return { win: battle.ended === 'me', durMs, meRemain }
}

/** 装配总初始血（残血比用；直接在 seed1 state 上算） */
function initHpOf(shipId: string): number {
  const def = SHIPS.find((s) => s.id === shipId) ?? SHIPS.find((s) => s.id === shipId.replace(/^sh-/, ''))
  if (!def) return 0
  return (def.shieldHp ?? 0) + (def.armorHp ?? 0) + (def.hullHp ?? 0)
}

async function main(): Promise<void> {
  const threats = [...ANOMALIES].sort((a, b) => a.threat - b.threat)
  console.log('══ C4 战斗校准（真实模拟胜率）══')
  console.log(
    CHARGE_ON
      ? '⚠ 对照模式：**高威胁近战敌突进已临时开启**（威胁≥60 且 brawl、够不着时机动 ×2、进射程维持 2s、冷却 20s）——仅本工具，引擎默认仍为未实装'
      : '（敌突进按出厂默认 = 未实装；要看启用后的对照加 `--charge`）',
  )
  console.log('威胁梯度：' + threats.map((a) => `${a.name}=${a.threat}`).join(' '))
  if (PROPOSAL) {
    console.log(
      '⚠ 预演模式：**敌速按重标提案替换**（brawl 1.25→1.40× / orbit 0.95→1.05× / kite 维持现状）' +
        '——仅本工具，引擎默认与 data/anomalies.ts 一律未改',
    )
    if (PROPOSAL_DPS !== undefined) console.log(`  ・foeDpsPerThreat → ${PROPOSAL_DPS}（出厂 0.8）`)
    if (PROPOSAL_HP_MUL !== undefined) console.log(`  ・全卡总血 ×${PROPOSAL_HP_MUL}`)
    if (PROPOSAL_BRAWL_HP_MUL !== undefined) console.log(`  ・近战(brawl)卡总血 ×${PROPOSAL_BRAWL_HP_MUL}`)
  }
  // 时长预期行（C4 血量曲线 D(T)，纯对射口径；模拟时长含接近期故应 ≥ D）
  const dExpect = (t: number): number =>
    Math.round((bal.foeHpCurveDMin + bal.foeHpCurveDSpan * Math.pow(Math.min(1, Math.max(0, (t - bal.foeHpCurveFloorThreat) / bal.foeHpCurveSpanThreat)), bal.foeHpCurveExp)) * 10) / 10
  console.log(
    '预期击杀D(T)：' +
      threats.map((a) => `${a.threat}:${dExpect(a.threat)}s`).join(' '),
  )
  console.log('敌血 foeHpOfThreat：' + threats.map((a) => `${a.threat}:${foeHpOfThreat(a.threat, bal)}`).join(' '))
  for (const skillName of ['无技能', '中位技能(战斗系Lv3)', '全战斗技能5']) {
    const skills = skillName === '无技能' ? {} : skillName.startsWith('中位') ? MID_SKILLS : FULL_SKILLS
    console.log(`\n—— 技能档：${skillName}（每格 = 胜率%｜平均秒数｜战后残血%，${SEEDS.length} 种子实战平均）——`)
    for (const ld of LOADOUTS) {
      const initHp = initHpOf(ld.ship)
      const cells: string[] = []
      for (const a of threats) {
        let wins = 0
        let durSum = 0
        let remainSum = 0
        let ends = 0
        for (const seed of SEEDS) {
          const state = makeState(ld.ship, ld, skills, seed)
          const r = simulate(state, a.id)
          if (r.win) wins++
          if (r.durMs > 0) {
            durSum += r.durMs
            ends++
          }
          remainSum += r.meRemain
        }
        const wp = Math.round((wins / SEEDS.length) * 100)
        const dur = ends > 0 ? Math.round(durSum / ends / 1000) : 0
        const rem = initHp > 0 ? Math.round((remainSum / SEEDS.length / initHp) * 100) : 0
        cells.push(`${wp}/${dur}s/${rem}%`)
      }
      console.log(`${ld.name.padEnd(34)} ${cells.join('  ')}`)
    }
  }

  /* C4-#3 校验段：敌方虚拟装配推导结果（射程/速度 vs 玩家参考） */
  console.log('\n—— 敌方虚拟装配校验（射程 = 封顶后最大值；速度 = **敌战斗机动 ÷ 基准船战斗机动**）——')
  console.log(
    `（基准船 = 速度中位线船只 ${REF_SHIP.name}：船速 ${REF_SHIP.maxSpeedMps} / 敏捷 ${REF_SHIP.agility}` +
      ` → 战斗机动 ${REF_COMBAT.toFixed(1)} m/s；2026-09-10 更正读数：旧「近战贴脸系数」单位混算、虚高约 1.67 倍）`,
  )
  const foeAgilityMul = 0.6 * (1 + (0.3 - 0.5) * 2 * bal.agilitySpeedBonus)
  for (const a of threats) {
    const eff = ctx.anomalies.get(a.id) ?? a
    const foes = createFoeSpecs(eff, bal)
    const f0 = foes[0]!
    const fmax = f0.weapons[0]!.maxRangeM
    const capped = fmax >= bal.foeRangeCapM ? ' *封顶' : ''
    const foeCombat = f0.speedMps * foeAgilityMul
    const ratio = foeCombat / Math.max(1, REF_COMBAT)
    console.log(
      `${String(eff.threat).padStart(3)} ${eff.name.padEnd(12)} ${String(eff.tactic ?? 'orbit').padEnd(6)} ` +
        `敌射程 ${(fmax / 1000).toFixed(1)}km${capped}  敌速 ${f0.speedMps}  ` +
        `战斗机动 ${Math.round(foeCombat)} → **×${ratio.toFixed(2)}** 基准船`,
    )
  }
  /* 速度口径校验（提案预演用）：把"目标比率"与"玩家实际战斗机动"对上——
   * 段参考船只是口径基准；玩家在该段实际会开的船 + 该技能档才是真实分母。 */
  if (PROPOSAL) {
    const KEY_CARDS = [
      { id: 'ano-pirate-post', label: '边境12' },
      { id: 'enc-pirate-3', label: '狂徒40' },
      { id: 'ano-titan-wreck', label: '泰坦60' },
      { id: 'ano-starcore-boss', label: '星髓72' },
      { id: 'ano-gravekeeper', label: '坟场88' },
    ]
    const KEY_ROWS = [0, 8, 9, 10, 13, 18]
    console.log('\n—— 速度口径校验（敌战斗机动 ÷ 玩家实际战斗机动；冷却期口径、不含点火）——')
    for (const [ti, skillName] of ['无技能', '中位', '满技能'].entries()) {
      const skills = ti === 0 ? {} : ti === 1 ? MID_SKILLS : FULL_SKILLS
      for (const ri of KEY_ROWS) {
        const ld = LOADOUTS[ri]!
        const st = makeState(ld.ship, ld, skills, 1)
        const spec = createPlayerSpec(st, ctx as SimContext, ld.ship)
        const meV = spec.speedMps * bal.speedFactor * (1 + (spec.agility - 0.5) * 2 * bal.agilitySpeedBonus)
        const cells = KEY_CARDS.map(({ id }) => {
          const a = ctx.anomalies.get(id)!
          const f = createFoeSpecs(a, bal)[0]!
          const foeV = f.speedMps * foeAgilityMul
          return `${(foeV / Math.max(1, meV)).toFixed(2)}×`
        })
        console.log(
          `${skillName.padEnd(4)} ${ld.name.padEnd(30)} 我 ${String(Math.round(meV)).padStart(3)} m/s  ` +
            KEY_CARDS.map((c, i) => `${c.label} ${cells[i]}`).join('  '),
        )
      }
    }
  }
  /* 近战卡虚拟装配逐卡对照（船长 2026-09-10：近战卡给出对比和虚拟装配，由船长一一审核） */
  if (PROPOSAL) {
    const baseBal = BASE_CTX.balance.battle
    const brawls = [...BASE_CTX.anomalies.values()]
      .filter((a) => (a.tactic ?? 'orbit') === 'brawl')
      .sort((a, b) => a.threat - b.threat)
    console.log('\n════ 近战(brawl)卡虚拟装配逐卡对照（现状 → 提案；供船长逐张审核）════')
    console.log(
      `基准船 = ${REF_SHIP.name}（船速 ${REF_SHIP.maxSpeedMps} / 敏捷 ${REF_SHIP.agility}）` +
        ` → 基准战斗机动 ${REF_COMBAT.toFixed(1)} m/s；敌速存储值 = 比率 × ${REF_COMBAT.toFixed(1)} ÷ 0.564`,
    )
    for (const cur of brawls) {
      const next = ctx.anomalies.get(cur.id)!
      const f0 = createFoeSpecs(cur, baseBal)[0]! // 现状（出厂 bal，含出厂 cap）
      const f1 = createFoeSpecs(next, bal)[0]! // 提案
      const w = f0.weapons[0]!
      const pos = bal.tacticDesireFactor[cur.tactic ?? 'orbit'] ?? 0.5
      const desire = Math.round(w.minRangeM + pos * (w.maxRangeM - w.minRangeM))
      const waves = cur.waves && cur.waves.length > 0 ? cur.waves : [{ units: 1, hpShare: 1 }]
      const hpBase = cur.foeHpOverride ?? foeHpOfThreat(cur.threat, baseBal)
      const hpTotal = hpBase * waves.reduce((s, x) => s + (x.hpShare ?? 1), 0)
      const escorts = cur.escorts ?? 0
      const c0 = f0.speedMps * foeAgilityMul
      const c1 = f1.speedMps * foeAgilityMul
      const shot = w.shotsByType ? Object.entries(w.shotsByType).map(([t, d]) => `${t} ${d}`).join(' + ') : `${w.fixedType ?? ''} ${w.shotDmg}`
      console.log(`\n── 威胁 ${cur.threat} · ${cur.name}（${cur.id}）──`)
      console.log(`  射程带       ${w.minRangeM}~${w.maxRangeM} m　期望交距 **${desire} m**（带内 ${(pos * 100).toFixed(0)}%）`)
      console.log(
        `  编队         ${waves.map((x, i) => `第${i + 1}波 ${x.units ?? 1}队×${(x.hpShare ?? 1).toFixed(2)}`).join(' · ')}` +
          `　僚机 ${escorts}/队`,
      )
      console.log(
        `  总血         ${hpTotal}（各波基准 ${hpBase}）　首波主体三层 ${Math.round(f0.hp.s)}/${Math.round(f0.hp.a)}/${Math.round(f0.hp.h)}`,
      )
      console.log(
        `  火力         总 DPS ${(cur.threat * bal.foeDpsPerThreat).toFixed(1)}（威胁×${bal.foeDpsPerThreat}）` +
          `　单发 ${shot}（每 ${(w.reloadMs / 1000).toFixed(1)}s）　命中 ${(w.hitRate * 100).toFixed(0)}%　近盲×${w.blindDmgMul}`,
      )
      console.log(
        `  伤害构成     ${Object.entries(cur.dmgMix ?? {}).map(([t, v]) => `${t} ${v}`).join(' : ') || '（缺省动能）'}` +
          `　落点衰减 ${w.falloff}`,
      )
      console.log(
        `  速度         现状 ${f0.speedMps}（战斗机动 ${Math.round(c0)}）→ 提案 **${f1.speedMps}**（战斗机动 ${Math.round(c1)}）`,
      )
      console.log(
        `  相对基准     现状 ${(c0 / REF_COMBAT).toFixed(2)}× → 提案 **${(c1 / REF_COMBAT).toFixed(2)}×**` +
          `　净贴近速度 现状 ${Math.round(c0 - REF_COMBAT)} m/s → 提案 **+${Math.round(c1 - REF_COMBAT)} m/s**（正 = 敌更快）`,
      )
    }
  }
  if (TACTIC_ON) {
    console.log('\n════ 战术改判预演（族系特色）：现状 → 改判 ════')
    for (const [id, tac] of Object.entries(PROPOSED_TACTIC)) {
      const base = BASE_CTX.anomalies.get(id)
      const next = ctx.anomalies.get(id)
      if (!base || !next) continue
      const f0 = createFoeSpecs(base, BASE_CTX.balance.battle)[0]!
      const f1 = createFoeSpecs(next, bal)[0]!
      const w0 = f0.weapons[0]!
      const w1 = f1.weapons[0]!
      const pos0 = BASE_CTX.balance.battle.tacticDesireFactor[base.tactic ?? 'orbit'] ?? 0.5
      const pos1 = bal.tacticDesireFactor[tac] ?? 0.5
      const d0 = Math.round(w0.minRangeM + pos0 * (w0.maxRangeM - w0.minRangeM))
      const d1 = Math.round(w1.minRangeM + pos1 * (w1.maxRangeM - w1.minRangeM))
      console.log(
        `\n── ${base.threat} ${base.name}（${id}）：**${base.tactic ?? 'orbit'} → ${tac}** ──`,
      )
      console.log(
        `  射程带     ${w0.minRangeM}~${w0.maxRangeM} m（期望交距 ${d0} m） → **${w1.minRangeM}~${w1.maxRangeM} m（期望交距 ${d1} m）**`,
      )
      console.log(
        `  速度       ${f0.speedMps}（战斗机动 ${Math.round(f0.speedMps * foeAgilityMul)}）` +
          ` → **${f1.speedMps}（战斗机动 ${Math.round(f1.speedMps * foeAgilityMul)}）**`,
      )
      console.log(`  总血       ${base.foeHpOverride ?? foeHpOfThreat(base.threat, bal)}（本批未重标）`)
    }
  }
  /* 血量求解器（2026-09-10 船长「血量按照战术进行重新划分」）：逐卡二分求目标残血所需的 foeHpOverride */
  if (SOLVE_HP) {
    const refLd = LOADOUTS.find((l) => l.name.startsWith('S2 灰鲭鲨'))!
    console.log(`\n════ 近战/环绕血量求解（参考行 = ${refLd.name} × 中位技能；目标打完剩 ${HP_TARGET_PCT}%）════`)
    const probe = (id: string, hp: number): { rem: number; dur: number } => {
      const st = makeState(refLd.ship, refLd, MID_SKILLS, 1)
      const base = ctx.anomalies.get(id)!
      const patched: SimContext = {
        ...(ctx as SimContext),
        anomalies: new Map(ctx.anomalies).set(id, { ...base, foeHpOverride: hp }),
      }
      let rem = 0
      let dur = 0
      for (const seed of SEEDS) {
        const s = makeState(refLd.ship, refLd, MID_SKILLS, seed)
        const spec = createPlayerSpec(s, patched, refLd.ship)
        const initHp = spec.hp.s + spec.hp.a + spec.hp.h
        const b = startBattleFor(s, patched, s.shipId, id, 0)
        if (!b) continue
        s.gameMs = patched.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(patched.anomalies.get(id), patched.balance.battle)
        advanceBattleFor(s, patched, b, s.shipId, id)
        const u = b.units['player']
        rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
        dur += Math.min(patched.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
      }
      return { rem: rem / SEEDS.length, dur: dur / SEEDS.length / 1000 }
    }
    for (const a of [...ctx.anomalies.values()].sort((x, y) => x.threat - y.threat)) {
      const cur = a.foeHpOverride ?? foeHpOfThreat(a.threat, bal)
      const now = probe(a.id, cur)
      // 目标：brawl 走时长口径（该段 D(T)），orbit/kite 走残血口径
      const dTarget =
        bal.foeHpCurveDMin +
        bal.foeHpCurveDSpan *
          Math.pow(
            Math.min(1, Math.max(0, (a.threat - bal.foeHpCurveFloorThreat) / bal.foeHpCurveSpanThreat)),
            bal.foeHpCurveExp,
          )
      const useDur = HP_SOLVE_MODE === 'dur'
      // 时长随血量单调递增、残血随血量单调递减 → 二分方向相反
      const better = (r: { rem: number; dur: number }): boolean => (useDur ? r.dur < dTarget : r.rem > HP_TARGET_PCT)
      let lo = useDur ? 5 : 5
      let hi = 40000
      for (let it = 0; it < 15; it++) {
        const mid = Math.round((lo + hi) / 2)
        const r = probe(a.id, mid)
        if (better(r)) lo = mid
        else hi = mid
      }
      const solved = Math.round((lo + hi) / 2)
      const got = probe(a.id, solved)
      const flag = now.rem > 99.5 ? '（现状零承伤 → 残血不是杠杆）' : ''
      console.log(
        `${String(a.threat).padStart(3)} ${a.name.padEnd(12)} ${String(a.tactic ?? 'orbit').padEnd(6)} ` +
          `D(T)=${dTarget.toFixed(0)}s  现血 ${String(cur).padStart(5)}（${now.dur.toFixed(0)}s / 残血 ${now.rem.toFixed(0)}%）→ ` +
          `**解出 ${String(solved).padStart(5)}**（${got.dur.toFixed(0)}s / 残血 ${got.rem.toFixed(0)}%）${flag}`,
      )
    }
  }

  /* 火力扫描：两张能量卡的基础单发（船长 2026-09-10「感觉可以上调」）
   * 扫描方式是**按系数直写 `foeShotDmg`**（原始推导单发 × 系数）——原"逐卡等效回退倍率口"
   * 已于 2026-09-11 退休（船长「先移除所有逐卡伤害倍率，按照实际算」），本段不受影响。
   * 2026-09-10 补：同时跑「只堆主系」与「全堆能量抗」两种配装——**配装回报**必须看得出来 */
  if (DMG_SWEEP) {
    const FITS: Array<{ label: string; mid: string[]; low: string[] }> = [
      { label: '只堆主系(动能)', mid: ['mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
      { label: '全堆能量抗', mid: ['mod-shield-pla-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-pla-2'] },
    ]
    console.log('\n════ 能量卡基础单发扫描（灰鲭鲨 4×动能MK2 × 中位技能；两端配装对照）════')
    for (const id of ['ano-abyss-guard', 'ano-starcore-boss']) {
      const a0 = ctx.anomalies.get(id)!
      const escorts = a0.escorts ?? 0
      const uThreat = a0.threat / (1 + 0.6 * escorts)
      const baseShot = uThreat * bal.foeDpsPerThreat * (bal.foeReloadMs / 1000)
      console.log(
        `\n── ${a0.threat} ${a0.name}（${id} · ${a0.tactic ?? 'orbit'} · 僚机 ${escorts}）──\n` +
          `   份额 ${uThreat.toFixed(2)} × 0.8 × 4.0s = **基础单发 ${baseShot.toFixed(1)}**（按威胁链实际推导，无任何逐卡倍率）`,
      )
      for (const mul of [0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0]) {
        const patched: SimContext = {
          ...(ctx as SimContext),
          anomalies: new Map(ctx.anomalies).set(id, { ...a0, foeShotDmg: Math.round(baseShot * mul) }),
        }
        const out: string[] = []
        for (const fit of FITS) {
          const ld: Loadout = { name: fit.label, ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: fit.mid, low: fit.low }
          let rem = 0
          let dur = 0
          let win = 0
          for (const seed of SEEDS) {
            const s = makeState(ld.ship, ld, MID_SKILLS, seed)
            const spec = createPlayerSpec(s, patched, ld.ship)
            const initHp = spec.hp.s + spec.hp.a + spec.hp.h
            const b = startBattleFor(s, patched, s.shipId, id, 0)
            if (!b) continue
            s.gameMs = patched.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(patched.anomalies.get(id), patched.balance.battle)
            advanceBattleFor(s, patched, b, s.shipId, id)
            const u = b.units['player']
            if (b.ended === 'me') win++
            rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
            dur += Math.min(patched.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
          }
          out.push(`${fit.label} ${String(Math.round((win / SEEDS.length) * 100)).padStart(3)}%/${(dur / SEEDS.length / 1000).toFixed(0).padStart(3)}s/残 ${(rem / SEEDS.length).toFixed(0).padStart(3)}%`)
        }
        console.log(`   单发 ${String(Math.round(baseShot * mul)).padStart(4)}（系数 ${mul.toFixed(2)}）→ ${out.join('　｜　')}`)
      }
    }
  }

  /* 改判卡的血量扫描（船长：先针对战术发生变动的血量调整） */
  if (process.argv.includes('--hp-sweep')) {
    const refLd = LOADOUTS.find((l) => l.name.startsWith('S2 灰鲭鲨'))!
    console.log(`\n════ 改判卡血量扫描（参考行 = ${refLd.name} × 中位技能）════`)
    for (const id of ['ano-gravekeeper', 'ano-maw-hunt']) {
      const a0 = ctx.anomalies.get(id)!
      console.log(`\n── ${a0.threat} ${a0.name}（${id} · 改判后 ${a0.tactic ?? 'orbit'} · 射程带见校验段）──`)
      for (const hp of [6, 50, 120, 310, 600, 1200, 1844, 2600, 3600, 5200]) {
        const patched: SimContext = {
          ...(ctx as SimContext),
          anomalies: new Map(ctx.anomalies).set(id, { ...a0, foeHpOverride: hp }),
        }
        let rem = 0
        let dur = 0
        let win = 0
        for (const seed of SEEDS) {
          const s = makeState(refLd.ship, refLd, MID_SKILLS, seed)
          const spec = createPlayerSpec(s, patched, refLd.ship)
          const initHp = spec.hp.s + spec.hp.a + spec.hp.h
          const b = startBattleFor(s, patched, s.shipId, id, 0)
          if (!b) continue
          s.gameMs = patched.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(patched.anomalies.get(id), patched.balance.battle)
          advanceBattleFor(s, patched, b, s.shipId, id)
          const u = b.units['player']
          if (b.ended === 'me') win++
          rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
          dur += Math.min(patched.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
        }
        console.log(
          `  血量 ${String(hp).padStart(4)} → 胜率 ${String(Math.round((win / SEEDS.length) * 100)).padStart(3)}% · 时长 ${(dur / SEEDS.length / 1000).toFixed(0).padStart(3)}s · 残血 ${(rem / SEEDS.length).toFixed(0).padStart(3)}%`,
        )
      }
    }
  }

  /* 抗性取向扫描（船长 2026-09-10：「在针对时，有无考虑堆抗性的情况」）——
   * 同一艘船只换中/低槽的抗性件，看"堆对应系抗性"对能量卡承伤的影响。 */
  if (process.argv.includes('--resist-sweep')) {
    const VARIANTS: Array<{ label: string; low: string[]; midNote: string }> = [
      { label: '只堆主系（动能）＝现行参考行', low: ['mod-stab-kin-2', 'mod-armor-kin-2'], midNote: '盾抗动能' },
      { label: '盾动能 + 甲能量（双抗）', low: ['mod-stab-kin-2', 'mod-armor-pla-2'], midNote: '盾抗动能' },
      { label: '**全堆能量抗**（盾能量 + 甲能量）', low: ['mod-stab-kin-2', 'mod-armor-pla-2'], midNote: '盾抗能量' },
    ]
    const MIDS: Record<string, string[]> = {
      盾抗动能: ['mod-shield-kin-2', 'mod-track-2'],
      盾抗能量: ['mod-shield-pla-2', 'mod-track-2'],
    }
    console.log('\n════ 抗性取向扫描（同一艘灰鲭鲨 4×动能MK2；只换抗性件）════')
    for (const id of ['ano-abyss-guard', 'ano-starcore-boss']) {
      const a0 = ctx.anomalies.get(id)!
      console.log(
        `\n── ${a0.threat} ${a0.name}（${id} · ${a0.tactic ?? 'orbit'} · 主系见 dmgMix）──`,
      )
      for (const v of VARIANTS) {
        const ld: Loadout = { name: v.label, ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: MIDS[v.midNote]!, low: v.low }
        let rem = 0
        let dur = 0
        let win = 0
        for (const seed of SEEDS) {
          const s = makeState(ld.ship, ld, MID_SKILLS, seed)
          const spec = createPlayerSpec(s, ctx as SimContext, ld.ship)
          const initHp = spec.hp.s + spec.hp.a + spec.hp.h
          const shieldRes = spec.resists.shield
          const b = startBattleFor(s, ctx as SimContext, s.shipId, id, 0)
          if (!b) continue
          s.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(id), ctx.balance.battle)
          advanceBattleFor(s, ctx as SimContext, b, s.shipId, id)
          const u = b.units['player']
          if (b.ended === 'me') win++
          if (seed === SEEDS[0]) {
            console.log(
              `   ${v.label}：盾抗 动能 ${((1 - (shieldRes.kinetic ?? 0)) * 100).toFixed(0)}% / 爆 ${((1 - (shieldRes.explosive ?? 0)) * 100).toFixed(0)}% / 能量 ${((1 - (shieldRes.plasma ?? 0)) * 100).toFixed(0)}%`,
            )
          }
          rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
          dur += Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
        }
        console.log(
          `      → 胜率 ${String(Math.round((win / SEEDS.length) * 100)).padStart(3)}% · 时长 ${(dur / SEEDS.length / 1000).toFixed(0).padStart(3)}s · 残血 ${(rem / SEEDS.length).toFixed(0).padStart(3)}%`,
        )
      }
    }
  }

  /* 坟场守墓人（改 orbit 后）的"非血量旋钮"扫描（船长 2026-09-10：「血量 3600 是正常吗」）——
   * 3600 是改判前按 brawl 口径定的；改 orbit 后它靠**命中 0.95 + 两波 + 3600 血**三重叠加把人打死。
   * 本段扫"降命中 / 去第二波"两条非血量路径，看能否保住威胁 88 该有的血量。 */
  if (process.argv.includes('--grave-sweep')) {
    const refLd = LOADOUTS.find((l) => l.name.startsWith('S2 灰鲭鲨'))!
    const a0 = ctx.anomalies.get('ano-gravekeeper')!
    console.log(`\n════ 坟场守墓人（orbit · 血 3600）非血量旋钮扫描（参考行 ${refLd.name} × 中位）════`)
    const cases: Array<{ label: string; patch: Partial<typeof a0> }> = [
      { label: '现状（命中 0.95 + 两波 0.55/0.45）', patch: {} },
      { label: '命中 0.95 → 0.85', patch: { foeHitRate: 0.85 } },
      { label: '命中 0.95 → 0.80', patch: { foeHitRate: 0.8 } },
      { label: '去第二波（单波 1.0）', patch: { waves: [{ units: 1, hpShare: 1 }] } },
      { label: '命中 0.85 + 去第二波', patch: { foeHitRate: 0.85, waves: [{ units: 1, hpShare: 1 }] } },
    ]
    for (const c of cases) {
      const patched: SimContext = {
        ...(ctx as SimContext),
        anomalies: new Map(ctx.anomalies).set('ano-gravekeeper', { ...a0, ...c.patch }),
      }
      let rem = 0
      let dur = 0
      let win = 0
      for (const seed of SEEDS) {
        const s = makeState(refLd.ship, refLd, MID_SKILLS, seed)
        const spec = createPlayerSpec(s, patched, refLd.ship)
        const initHp = spec.hp.s + spec.hp.a + spec.hp.h
        const b = startBattleFor(s, patched, s.shipId, 'ano-gravekeeper', 0)
        if (!b) continue
        s.gameMs = patched.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(patched.anomalies.get('ano-gravekeeper'), patched.balance.battle)
        advanceBattleFor(s, patched, b, s.shipId, 'ano-gravekeeper')
        const u = b.units['player']
        if (b.ended === 'me') win++
        rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
        dur += Math.min(patched.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
      }
      console.log(
        `   ${c.label.padEnd(30)} → 胜率 ${String(Math.round((win / SEEDS.length) * 100)).padStart(3)}% · 时长 ${(dur / SEEDS.length / 1000).toFixed(0).padStart(3)}s · 残血 ${(rem / SEEDS.length).toFixed(0).padStart(3)}%`,
      )
    }
  }

  /* 推进器对照（船长 2026-09-10：「你在装配时完全不考虑推进器吗」）——
   * 同一艘船、同一套武器/抗性件，**只差中槽一件矢量推进器 MK2**，看四张验收卡的差别。
   * 用来判断"推进器在哪些战术上才是决定性旋钮"。 */
  if (process.argv.includes('--prop-sweep')) {
    const FITS: Array<{ label: string; mid: string[] }> = [
      { label: '**不带推进器**', mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'] },
      { label: '带推进器 MK2（点火 60s ×1.6 → 冷却 60s ×1.0）', mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'] },
    ]
    console.log('\n════ 推进器对照（灰鲭鲨 4×动能MK2 × 中位技能；只差中槽一件 MK2）════')
    for (const id of ['ano-abyss-guard', 'ano-starcore-boss', 'ano-maw-hunt', 'ano-gravekeeper']) {
      const a0 = ctx.anomalies.get(id)!
      const out: string[] = []
      for (const fit of FITS) {
        const ld: Loadout = { name: fit.label, ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: fit.mid, low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }
        let rem = 0
        let dur = 0
        let win = 0
        for (const seed of SEEDS) {
          const s = makeState(ld.ship, ld, MID_SKILLS, seed)
          const spec = createPlayerSpec(s, ctx as SimContext, ld.ship)
          const initHp = spec.hp.s + spec.hp.a + spec.hp.h
          const b = startBattleFor(s, ctx as SimContext, s.shipId, id, 0)
          if (!b) continue
          s.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(id), ctx.balance.battle)
          advanceBattleFor(s, ctx as SimContext, b, s.shipId, id)
          const u = b.units['player']
          if (b.ended === 'me') win++
          rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
          dur += Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
        }
        out.push(`${fit.label} ${String(Math.round((win / SEEDS.length) * 100)).padStart(3)}%/${(dur / SEEDS.length / 1000).toFixed(0).padStart(3)}s/残 ${(rem / SEEDS.length).toFixed(0).padStart(3)}%`)
      }
      console.log(`  ${String(a0.threat).padStart(3)} ${a0.name.padEnd(10)} ${String(a0.tactic ?? 'orbit').padEnd(6)} → ${out.join('　｜　')}`)
    }
  }

  /* 敌情名册（船长 2026-09-10：「你将所有敌人输出成表格，我进行审核和调整吧」）——
   * 输出全 26 张卡的**全部可调参数 + 中位参考行实测**，markdown 表格，供船长逐条审核与调整。 */
  if (process.argv.includes('--roster')) {
    const refLd = LOADOUTS.find((l) => l.name.startsWith('S2 灰鲭鲨'))!
    console.log('\n<!-- ══ 表一：静态参数（全部可调字段）══ -->')
    console.log(
      '| 威胁 | 卡 | 族 | 战术 | 射程带 m | 期望交距 | 敌速 | 战斗机动 | 比率 | 编队 | 总血 | 总DPS | 单发 | 命中 | 构成 | 衰减 | 个性口 |',
    )
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    const toTier = ['无技能', '中位', '满技能']
    void toTier
    for (const a of [...ctx.anomalies.values()].sort((x, y) => x.threat - y.threat)) {
      const f = createFoeSpecs(a, bal)[0]!
      const w = f.weapons[0]!
      const pos = bal.tacticDesireFactor[a.tactic ?? 'orbit'] ?? 0.5
      const desire = Math.round(w.minRangeM + pos * (w.maxRangeM - w.minRangeM))
      const waves = a.waves && a.waves.length > 0 ? a.waves : [{ units: 1, hpShare: 1 }]
      const hpBase = a.foeHpOverride ?? foeHpOfThreat(a.threat, bal)
      const hpTotal = Math.round(hpBase * waves.reduce((s, x) => s + (x.hpShare ?? 1), 0))
      const comp = Object.entries(a.dmgMix ?? {})
        .map(([t, v]) => `${t}${v}`)
        .join(':') || '动能(缺省)'
      const shot = w.shotsByType
        ? Object.entries(w.shotsByType)
            .map(([t, d]) => `${t} ${d}`)
            .join('+')
        : String(w.shotDmg)
      const quirks = [
        a.foeShotDmg !== undefined ? `单发直写 ${a.foeShotDmg}` : '',
        a.foeFalloff !== undefined ? `远端衰减 ${a.foeFalloff}` : '',
        a.foeHitRate !== undefined ? `命中覆写 ${a.foeHitRate}` : '',
        (a.escorts ?? 0) > 0 ? `僚机 ${a.escorts}` : '',
      ]
        .filter(Boolean)
        .join('；')
      const fmt = (waves.length > 1 ? `${waves.map((x) => `${x.units ?? 1}队×${(x.hpShare ?? 1).toFixed(2)}`).join('+')}` : `1波${(a.escorts ?? 0) > 0 ? `·僚机${a.escorts}` : ''}`)
      console.log(
        `| ${a.threat} | ${a.name} | ${a.foeFamily ?? '—'} | ${a.tactic ?? 'orbit'} | ${w.minRangeM}~${w.maxRangeM} | ${desire} | ${f.speedMps} | ${Math.round(f.speedMps * foeAgilityMul)} | ${((f.speedMps * foeAgilityMul) / REF_COMBAT).toFixed(2)}× | ${fmt} | ${hpTotal} | ${(a.threat * bal.foeDpsPerThreat).toFixed(1)} | ${shot} | ${(w.hitRate * 100).toFixed(0)}% | ${comp} | ${w.falloff} | ${quirks || '—'} |`,
      )
    }
    console.log('\n<!-- ══ 表二：中位参考行实测（S2 灰鲭鲨4×MK2+支援，含 MK2 推进器）══ -->')
    console.log('| 威胁 | 卡 | 战术 | 胜率 | 时长 | 我方残血 | 敌开火次数 |')
    console.log('|---|---|---|---|---|---|---|')
    for (const a of [...ctx.anomalies.values()].sort((x, y) => x.threat - y.threat)) {
      let win = 0
      let dur = 0
      let rem = 0
      let shots = 0
      for (const seed of SEEDS) {
        const s = makeState(refLd.ship, refLd, MID_SKILLS, seed)
        const spec = createPlayerSpec(s, ctx as SimContext, refLd.ship)
        const initHp = spec.hp.s + spec.hp.a + spec.hp.h
        const b = startBattleFor(s, ctx as SimContext, s.shipId, a.id, 0)
        if (!b) continue
        s.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(a.id), ctx.balance.battle)
        advanceBattleFor(s, ctx as SimContext, b, s.shipId, a.id)
        const u = b.units['player']
        if (b.ended === 'me') win++
        rem += (u ? (u.hp.s + u.hp.a + u.hp.h) / Math.max(1, initHp) : 0) * 100
        dur += Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs))
        shots += (b.foeShots ?? 0)
      }
      console.log(
        `| ${a.threat} | ${a.name} | ${a.tactic ?? 'orbit'} | ${Math.round((win / SEEDS.length) * 100)}% | ${(dur / SEEDS.length / 1000).toFixed(0)}s | ${(rem / SEEDS.length).toFixed(0)}% | ${Math.round(shots / SEEDS.length)} |`,
      )
    }
  }

  /* ══════════ 标准复核配置集（2026-09-11 船长采纳 = **正式口径**）：A0~A3 四行 × 全 26 卡 ══════════
   * 每格报：胜率 / 时长 / 残血 / **终局交距 / 最近交距 / 我开火 / 敌开火(头目) / 敌开火(杂鱼合计)**。
   * 用途：①数值批验收（至少四行）②"敌人到底打不打得到人"的判据（开火列分列头目/杂鱼）。
   * 输出为 TSV（制表符分隔，便于直接比对/入库）；数值列均为 SEEDS 播种均值。 */
  if (process.argv.includes('--std')) {
    const all = [...ctx.anomalies.values()].sort((x, y) => x.threat - y.threat)
    /** 打印一组行 × 全卡的复核表（`--std` 与 `--std6` 共用；列口径完全一致） */
    const printRows = (rows: readonly StandardRow[], title: string, legend: string): void => {
      console.log(`# ${title} · 卡 × 行 · 数值列 = ${SEEDS.length} 播种均值（seed ${SEEDS.join('/')}）`)
      console.log(`# ${legend}`)
      console.log(
        ['行', '卡id', '卡名', '族', '威胁', '胜率', '时长', '残血', '终局交距', '最近交距', '我开火', '敌开火(头目)', '敌开火(杂鱼合计)'].join('\t'),
      )
      for (const row of rows) {
        for (const a of all) {
          const cells: CellReading[] = []
          for (const seed of SEEDS) {
            const st = makeState(row.ship, row.ld, row.skills, seed)
            cells.push(simulateCell(st, a.id, row.ld, row.desireM))
          }
          const n = cells.length
          const avg = (pick: (c: CellReading) => number): string => (cells.reduce((s, c) => s + pick(c), 0) / n).toFixed(1)
          console.log(
            [
              row.id,
              a.id,
              a.name,
              a.foeFamily ?? '',
              a.threat,
              `${Math.round((cells.filter((c) => c.win).length / n) * 100)}%`,
              `${(cells.reduce((s, c) => s + c.durMs, 0) / n / 1000).toFixed(0)}s`,
              `${avg((c) => c.meRemainPct).replace(/\.0$/, '')}%`,
              avg((c) => c.endM),
              avg((c) => c.minM),
              avg((c) => c.meShots),
              avg((c) => c.foeShotsBoss),
              avg((c) => c.foeShotsMinion),
            ].join('\t'),
          )
        }
      }
    }
    printRows(
      STANDARD_ROWS,
      '标准复核配置集 A0~A3（船长 2026-09-11 采纳）',
      'A0 标准中距（4×动能MK2+推进+支援 · 全技能L3） | A1 贴脸近战（4×轻型炮MK1 无推进 · 全技能L3） | A2 远程风筝（4×重型导弹架MK2+推进 · 全技能L3） | A3 弱技能行（A0 装配 + 6 项战斗技能 L3）',
    )
    // 探索行（`--std6`）：补齐 audit 六组里正式四行未覆盖的 ③⑤ + 裸船行；**不改正式口径**
    if (process.argv.includes('--std6')) {
      printRows(
        EXPLORE_ROWS,
        '**探索行**（2026-09-11 C 族落码批加）——补 audit 六组未覆盖项，**不属于船长采纳的四行口径**',
        'B0 参考行去推进器（探索③） | B1 转管炮贴脸无推进（探索⑤） | B2 裸船零技能（新手起点）',
      )
    }
  }

  /* 敌人专用数据表 CSV（船长 2026-09-10：「敌人战斗数据不在该表格，重新输出一个敌人单独的数据表格」）——
   * 一张表给全：**可编辑字段**（威胁/战术/族/敌速/总血/命中/倍率/单发/衰减/僚机/伤害权重/交火展示时长）
   * ＋ **引擎派生**（射程带/期望交距/战斗机动/比率/总DPS/实际单发/编队）＋ **实测**（中位参考行 胜率·时长·残血）。 */
  if (process.argv.includes('--csv')) {
    const refLd = LOADOUTS.find((l) => l.name.startsWith('S2 灰鲭鲨'))!
    const head = [
      'id', '卡名', '族', '舰级编成', '威胁', '战术', '敌速', '比率', '战斗机动', '射程带min', '射程带max', '期望交距',
      '编队', '波次', '僚机', '总血', '总DPS', '单发(实际)', '命中', '伤害构成', '远端衰减', '近盲带',
      '个性口', '交火展示时长', '实测胜率', '实测时长', '实测残血',
      // ── 2026-09-11 船长采纳（标准复核配置集配套）：**开火列 + 距离列** ──
      // 强制纪律：判定敌人强弱必须看"敌开火（头目/杂鱼分列）"——残血 100% 可能是"敌人一炮未放"。
      '引擎期望交距', '终局交距', '最近交距', '我开火', '敌开火(头目)', '敌开火(杂鱼合计)',
    ]
    console.log(head.join(','))
    for (const a of [...ctx.anomalies.values()].sort((x, y) => x.threat - y.threat)) {
      const specs = createFoeSpecs(a, bal)
      const f = specs[0]!
      const w = f.weapons[0]!
      const pos = bal.tacticDesireFactor[a.tactic ?? 'orbit'] ?? 0.5
      const waves = a.waves && a.waves.length > 0 ? a.waves : [{ units: 1, hpShare: 1 }]
      const hpBase = a.foeHpOverride ?? foeHpOfThreat(a.threat, bal)
      const comp = Object.entries(a.dmgMix ?? {}).map(([t, v]) => `${t}${v}`).join(':') || '动能(缺省)'
      // 2026-09-11 舰级路径修正：舰级卡没有 `foeHpOverride`（数值已搬进舰级表），
      // 旧口径的 `hpBase` 会落回威胁曲线 → **总血/编队/僚机会显示错值**。故按编成实算。
      const shipSlots = a.ships ?? []
      const isShipPath = shipSlots.length > 0
      const cnt = (s: (typeof shipSlots)[number]): number => Math.max(1, Math.floor(s.count ?? 1))
      const shipText = isShipPath
        ? shipSlots.map((s) => `${s.ship.name}×${cnt(s)}${s.escort === true ? '(僚)' : ''}`).join('+')
        : ''
      const shipUnits = shipSlots.reduce((n, s) => n + cnt(s), 0)
      const shipHp = shipSlots.reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * cnt(s), 0)
      const shipEscorts = shipSlots.filter((s) => s.escort === true).reduce((n, s) => n + cnt(s), 0)
      const shipWaves = new Set(shipSlots.map((s) => s.wave ?? 0)).size
      // 2026-09-11 A 族数值落地批：舰级路径改**混编**（头目 ×1 + 杂鱼 ×3）——单一 `specs[0]` 读数
      // 会**静默只报头目**（速度/射程/单发/命中全是头目的），故这些列改为**逐舰级读数**
      // （去重后按建队顺序 `|` 分隔；分隔符不含逗号，不破 CSV）。旧路径单单位 → 读数与原来逐字相同。
      const perUnit = (pick: (u: (typeof specs)[number]) => string): string => [...new Set(specs.map(pick))].join(' | ')
      const shotOf = (u: (typeof specs)[number]): string => {
        const uw = u.weapons[0]!
        return uw.shotsByType
          ? Object.entries(uw.shotsByType).map(([t, d]) => `${t} ${d}`).join('+')
          : String(uw.shotDmg)
      }
      const shot = isShipPath ? perUnit(shotOf) : shotOf(f)
      const speedCol = isShipPath ? perUnit((u) => String(u.speedMps)) : String(f.speedMps)
      const ratioCol = isShipPath ? perUnit((u) => ((u.speedMps * foeAgilityMul) / REF_COMBAT).toFixed(2)) : ((f.speedMps * foeAgilityMul) / REF_COMBAT).toFixed(2)
      const combatCol = isShipPath ? perUnit((u) => String(Math.round(u.speedMps * foeAgilityMul))) : String(Math.round(f.speedMps * foeAgilityMul))
      const rMinCol = isShipPath ? perUnit((u) => String(u.weapons[0]!.minRangeM)) : String(w.minRangeM)
      const rMaxCol = isShipPath ? perUnit((u) => String(u.weapons[0]!.maxRangeM)) : String(w.maxRangeM)
      const desireCol = isShipPath
        ? perUnit((u) => String(Math.round(u.weapons[0]!.minRangeM + pos * (u.weapons[0]!.maxRangeM - u.weapons[0]!.minRangeM))))
        : String(Math.round(w.minRangeM + pos * (w.maxRangeM - w.minRangeM)))
      const hitCol = isShipPath ? perUnit((u) => `${(u.weapons[0]!.hitRate * 100).toFixed(0)}%`) : `${(w.hitRate * 100).toFixed(0)}%`
      // 名义总 DPS（2026-09-11）：舰级路径 = 威胁 × foeDpsPerThreat × **多舰船补偿 2N/(N+1)**
      // （船长确认口径；引擎在建档时按 N 缩放单发，见 core `createFoeSpecsFromShips`）；
      // 旧路径不启用补偿（N=1），仍报 `威胁 × foeDpsPerThreat`。
      const shipComp = shipUnits <= 1 ? 1 : (2 * shipUnits) / (shipUnits + 1)
      const dpsCol = (isShipPath ? a.threat * bal.foeDpsPerThreat * shipComp : a.threat * bal.foeDpsPerThreat).toFixed(1)
      const quirks = [
        a.foeShotDmg !== undefined ? `单发直写${a.foeShotDmg}` : '',
        a.foeFalloff !== undefined ? `衰减${a.foeFalloff}` : '',
        a.foeHitRate !== undefined ? `命中${a.foeHitRate}` : '',
      ].filter(Boolean).join('；')
      let win = 0
      let dur = 0
      let rem = 0
      const cells: CellReading[] = []
      for (const seed of SEEDS) {
        // 2026-09-11：改用**分段推进**采样（`simulateCell`）——才能拿到终局/最近交距与
        // **逐单位开火次数**（fx 是 48 条环形缓冲，一次性大步长会把长战的开火事件裁掉）。
        // 分段不改变确定性结果（引擎内部固定 100ms 步长），既有列（胜率/时长/残血）逐值不变。
        const s = makeState(refLd.ship, refLd, MID_SKILLS, seed)
        const cell = simulateCell(s, a.id, refLd)
        cells.push(cell)
        const spec = createPlayerSpec(s, ctx as SimContext, refLd.ship)
        void spec
        if (cell.win) win++
        rem += cell.meRemainPct
        dur += cell.durMs
      }
      const nCells = cells.length
      const avgCell = (pick: (c: CellReading) => number): string => (cells.reduce((s, c) => s + pick(c), 0) / nCells).toFixed(1)
      console.log(
        [
          a.id, a.name, a.foeFamily ?? '', shipText, a.threat, a.tactic ?? 'orbit', speedCol,
          ratioCol, combatCol,
          rMinCol, rMaxCol, desireCol,
          isShipPath
            ? `${shipUnits}舰${shipWaves > 1 ? `${shipWaves}波` : ''}`
            : waves.length > 1
              ? `${waves.reduce((s, x) => s + (x.units ?? 1), 0)}队${waves.length}波`
              : '1波',
          isShipPath ? `${shipWaves}波` : waves.map((x) => (x.hpShare ?? 1).toFixed(2)).join('+'),
          isShipPath ? shipEscorts : (a.escorts ?? 0),
          isShipPath ? Math.round(shipHp) : Math.round(hpBase * waves.reduce((s, x) => s + (x.hpShare ?? 1), 0)),
          dpsCol, shot, hitCol, comp,
          w.falloff, w.blindDmgMul, quirks, a.combatSeconds,
          `${Math.round((win / SEEDS.length) * 100)}%`, `${(dur / SEEDS.length / 1000).toFixed(0)}s`, `${(rem / SEEDS.length).toFixed(0)}%`,
          // 新增列：引擎实际期望交距（舰级路径 = 该单位自身射程带的带内位置；旧路径 = 全局战术表）
          String(foeDesiredRange(f, specs, bal)),
          avgCell((c) => c.endM), avgCell((c) => c.minM),
          avgCell((c) => c.meShots), avgCell((c) => c.foeShotsBoss), avgCell((c) => c.foeShotsMinion),
        ].join(','),
      )
    }
  }

  void bal
}

const bal = ctx.balance.battle
void main()
