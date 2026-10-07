/**
 * **模块范围读数**（`npm run scope:check` · 2026-10-02 建 · 二号）
 *
 * 起因（**船长 2026-10-02 令**，原话照抄）：
 * 「**添加新的规则，每个模块改动只允许在模块内修改，如果同模块内有和当前需求相近的效果或者子模块
 * （比如工业下面的组装机，造船厂和实验室），优先使用同类型子模块的代码。如果要跨模块需要向我申请。**」
 * ⇒ 规则见 `docs/development-conventions.md` **§十八**；本工具是它的**读数档**（船长批「可以」＝
 * 「加一条护栏读数……不阻断」，并且「**优先以一号重构后的为准**」）。
 *
 * **本工具做什么**：把这次改动涉及的文件**映射到功能域**，打印「本批落在几个域」。
 * 落在 ≥2 个域 ⇒ 提示按 §十八 先向船长申请（**只提示、不阻断**：船长已批准的跨域照样要能提交）。
 *
 * **域表为什么长这样**（「优先以一号重构后的为准」的落地）：
 * 一号的模块化重构把大文件**按子域拆成小文件**（`combatMath` / `combatFx` / `foeCard` /
 * `panels/StarMap` / `ui/battleBlink` …，见 `docs/design/refactor-modularization-20261002.md`）
 * ⇒ **文件名本身已经是子域名**，所以域表按**路径 glob** 写，与重构后的实际布局一一对应。
 * 新增文件若落不进任何域，会进「**未归类**」并原样打出来 —— 这是**有意为之**：
 * 让表随重构自然生长，而不是我猜一个归属把它藏起来。
 *
 * 用法：
 *   npm run scope:check              # 工作区 vs HEAD（含已暂存 ＋ 未暂存）
 *   npm run scope:check -- --staged  # 只看暂存区（提交前钩子的 ℹ️ 提示档用这个）
 *   npm run scope:check -- --rev main..HEAD   # 看两个提交之间（A..B）
 *   npm run scope:check -- --rev <某提交>      # ⚠ 与该提交相比、**含当前工作区**（git 原生语义）
 *                                             #   要看「某一条提交改了什么」⇒ 用 `<提交>~1..<提交>`
 *   npm run scope:check -- --list    # 打印完整的域表（核对映射用）
 *
 * ⚠ **已知局限（如实登记）**：① 域表是**人工维护**的静态表，重构继续推进时要跟着补；
 *   ② 它只答"**碰了几个域**"，不答"该不该跨"（那要我申请、船长点头）；
 *   ③ 同一文件里的**多域混居**（如 `industry.ts` 兼有精炼与舰船购买）机器分不出来 ⇒ 归它最强的那个域。
 *
 * **2026-10-02 一号补（域表随重构补 · 交接卡 §三.4）**：按一号重构收官后的全仓布局把域表补齐，
 * 全仓普查（`--rev <空树>`）**未归类清零**：1323 个文件 = **20 个功能域（218 个）＋ 共享底层 1105 个**。
 * 同时修两处读数缺陷：① `git` 加 `-c core.quotepath=false`（中文路径不再被引号转义 ⇒ 不再假"未归类"）；
 * ② 「未归类」**全部打印**（原只印前 12 个，而它正是补域表的入口）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-10-02 · 最后跑过 2026-10-02
 */
import { execFileSync } from 'node:child_process'

type Domain = { name: string; globs: readonly string[] }

/**
 * **功能域 ↔ 路径**（域名列到导航/系统的现行叫法；glob 以仓库根为基准）。
 * ⚠ 表里**不放共享底层**：那些走 `SHARED`（§十八 第 3 条：改共享底层不算跨模块）。
 */
const DOMAINS: readonly Domain[] = [
  {
    name: '星球勘探与家园建设',
    globs: ['packages/core/src/planet*.ts', 'packages/core/src/stellar*.ts', 'packages/data/src/planets.ts', 'apps/desktop/src/renderer/src/panels/PlanetaryPanel.tsx', 'apps/desktop/src/renderer/src/panels/Stellar*.tsx', 'apps/desktop/src/renderer/src/panels/stellarMapView.ts', 'apps/desktop/src/renderer/src/ui/planetText.ts', 'apps/desktop/src/renderer/src/game/planetaryCommands.ts', 'apps/desktop/src/renderer/src/styles-planetary.css', 'apps/desktop/src/renderer/src/styles-stellar*.css'],
  },
  {
    name: '星图与航行',
    globs: ['packages/core/src/explore.ts', 'packages/core/src/travel.ts', 'packages/core/src/events.ts', 'packages/core/src/jumpFuel.ts', 'packages/core/src/fuelSupply.ts', 'packages/core/src/marks.ts', 'packages/core/src/securityZone.ts', 'packages/data/src/universe.ts', 'packages/data/src/travelEvents.ts', 'apps/desktop/src/renderer/src/pages/MapPage*', 'apps/desktop/src/renderer/src/panels/StarMap*', 'apps/desktop/src/renderer/src/panels/Expedition.tsx', 'apps/desktop/src/renderer/src/panels/ExpeditionCards.tsx', 'apps/desktop/src/renderer/src/ui/spaceBg.ts', 'apps/desktop/src/renderer/src/ui/FuelTank.tsx'],
  },
  {
    name: '舰船与装配',
    globs: ['packages/core/src/shipyard.ts', 'packages/core/src/shipFitting.ts', 'packages/core/src/equipment.ts', 'packages/core/src/fitted.ts', 'packages/core/src/fitPresets.ts', 'packages/core/src/instances.ts', 'packages/core/src/repair.ts', 'packages/core/src/fleetBook.ts', 'packages/core/src/droneRevive.ts', 'packages/data/src/ships.ts', 'packages/data/src/shipBlueprints.ts', 'packages/data/src/hullClass.ts', 'packages/data/src/modules.ts', 'apps/desktop/src/renderer/src/pages/ShipPage*', 'apps/desktop/src/renderer/src/pages/FitPage*', 'apps/desktop/src/renderer/src/panels/Shipyard*', 'apps/desktop/src/renderer/src/ui/shipArt*', 'apps/desktop/src/renderer/src/ui/shipInfo.tsx', 'apps/desktop/src/renderer/src/ui/shipMounts.ts', 'apps/desktop/src/renderer/src/ui/ShipSprite.tsx', 'apps/desktop/src/renderer/src/ui/ShipStatusWin.tsx', 'apps/desktop/src/renderer/src/ui/dryDockFx.tsx', 'apps/desktop/src/renderer/src/ui/modOrder.ts'],
  },
  {
    name: '物品与货仓',
    globs: ['packages/core/src/inventory.ts', 'packages/core/src/wreckGroups.ts', 'packages/data/src/items.ts', 'packages/data/src/rarityTier.ts', 'apps/desktop/src/renderer/src/pages/ItemsPage*', 'apps/desktop/src/renderer/src/pages/CargoPage*', 'apps/desktop/src/renderer/src/pages/wreckCards*', 'apps/desktop/src/renderer/src/ui/itemSubs.ts', 'apps/desktop/src/renderer/src/ui/itemView.tsx', 'apps/desktop/src/renderer/src/ui/matList.tsx', 'apps/desktop/src/renderer/src/ui/matSourceLink.tsx', 'apps/desktop/src/renderer/src/ui/ItemActionModal.tsx', 'apps/desktop/src/renderer/src/ui/wreckFlavor.tsx'],
  },
  {
    name: '市场与经济',
    globs: ['packages/core/src/market.ts', 'packages/core/src/marketLimitedSupply.ts', 'packages/core/src/money.ts', 'packages/data/src/marketCatalog.ts', 'apps/desktop/src/renderer/src/pages/MarketPage*', 'apps/desktop/src/renderer/src/ui/SellQtyModal.tsx', 'apps/desktop/src/renderer/src/ui/marketJump.ts', 'apps/desktop/src/renderer/src/ui/MoneyFit.tsx', 'apps/desktop/src/renderer/src/ui/yieldView.tsx'],
  },
  {
    name: '工业（炉/组装机/造船/实验室）',
    globs: ['packages/core/src/industry.ts', 'packages/core/src/manufacturing.ts', 'packages/core/src/lab.ts', 'packages/core/src/plugs.ts', 'packages/core/src/scrap.ts', 'packages/core/src/consumables.ts', 'packages/core/src/blackbox.ts', 'packages/data/src/labRecipes.ts', 'packages/data/src/blueprints.ts', 'packages/data/src/plugs.ts', 'apps/desktop/src/renderer/src/pages/IndustryPage*', 'apps/desktop/src/renderer/src/pages/IndustryHudPage*', 'apps/desktop/src/renderer/src/panels/Industry.tsx', 'apps/desktop/src/renderer/src/panels/PlugExchange.tsx', 'apps/desktop/src/renderer/src/ui/fragmentRedeem.tsx', 'apps/desktop/src/renderer/src/ui/hud.tsx', 'apps/desktop/src/renderer/src/ui/aiSlots.tsx', 'apps/desktop/src/renderer/src/ui/aiWorkFx.tsx', 'apps/desktop/src/renderer/src/ui/aiCoreSelect.tsx', 'apps/desktop/src/renderer/src/ui/aiProgress.tsx', 'apps/desktop/src/renderer/src/ui/useLoopGoalDraft.ts'],
  },
  {
    name: '技能',
    globs: ['packages/core/src/training.ts', 'packages/core/src/skillLicense.ts', 'packages/core/src/skillQueue.ts', 'packages/data/src/skills.ts', 'packages/data/src/skillTreePositions.ts', 'apps/desktop/src/renderer/src/pages/SkillsTreePage*', 'apps/desktop/src/renderer/src/pages/skillShared*', 'apps/desktop/src/renderer/src/ui/skillText.ts', 'apps/desktop/src/renderer/src/ui/skillTreeLayout.ts'],
  },
  {
    name: '虫洞',
    globs: ['packages/core/src/wormhole*.ts', 'packages/core/src/matterTech.ts', 'packages/data/src/wormholeFoes.ts', 'packages/data/src/matterTech.ts', 'apps/desktop/src/renderer/src/panels/Wormhole*.tsx', 'apps/desktop/src/renderer/src/panels/MatterTechTab.tsx', 'apps/desktop/src/renderer/src/panels/wormholeMapGeom.ts', 'apps/desktop/src/renderer/src/ui/wormholeIntel.ts'],
  },
  {
    name: '战斗',
    globs: ['packages/core/src/combat*.ts', 'packages/core/src/foe*.ts', 'packages/core/src/playerSpec.ts', 'packages/core/src/winEstimate.ts', 'packages/core/src/encounters.ts', 'packages/core/src/hullDamage.ts', 'packages/data/src/anomalies.ts', 'packages/data/src/foe-ships.ts', 'packages/data/src/foe-drones.ts', 'packages/data/src/droneRoles.ts', 'apps/desktop/src/renderer/src/panels/BattleScreen.tsx', 'apps/desktop/src/renderer/src/panels/battle*.tsx', 'apps/desktop/src/renderer/src/panels/battle*.ts', 'apps/desktop/src/renderer/src/ui/battle*.ts', 'apps/desktop/src/renderer/src/ui/foeBrief.ts', 'apps/desktop/src/renderer/src/ui/droneArt.tsx'],
  },
  {
    name: '采矿与打捞',
    globs: ['packages/core/src/mining.ts', 'packages/core/src/salvaging.ts', 'packages/core/src/salvage.ts', 'packages/core/src/trips.ts', 'packages/core/src/shipWrecks.ts', 'packages/data/src/belts.ts', 'packages/data/src/salvageFlavors.ts'],
  },
  {
    name: '远征与赏金',
    globs: ['packages/core/src/expedition.ts', 'packages/core/src/lairs.ts', 'packages/data/src/retiredLairCards.ts', 'apps/desktop/src/renderer/src/panels/bountySort.ts'],
  },
  {
    name: '运输与时效任务',
    globs: ['packages/core/src/hauling.ts', 'packages/core/src/sideTasks.ts', 'apps/desktop/src/renderer/src/panels/Hauling.tsx'],
  },
  {
    name: '站点与位置',
    globs: ['packages/core/src/location.ts', 'packages/core/src/station.ts', 'packages/data/src/stations.ts'],
  },
  {
    name: '任务与教程',
    globs: ['packages/core/src/firstTasks.ts', 'packages/core/src/firstRewards.ts', 'packages/core/src/onboarding.ts', 'packages/data/src/dialogues.ts', 'packages/data/src/firstTaskMessages.ts', 'apps/desktop/src/renderer/src/panels/FirstTasks.tsx', 'apps/desktop/src/renderer/src/panels/ImportantTasks.tsx', 'apps/desktop/src/renderer/src/panels/MilestoneTasks.tsx', 'apps/desktop/src/renderer/src/panels/PrologueScreen.tsx', 'apps/desktop/src/renderer/src/panels/ModeChoice.tsx', 'apps/desktop/src/renderer/src/ui/beaconPrompt.tsx'],
  },
  {
    name: '通讯与公告',
    globs: ['packages/core/src/comms.ts', 'packages/core/src/commsDelivery.ts', 'packages/data/src/commsFactions.ts', 'packages/data/src/messages.ts', 'packages/data/src/announcements.ts', 'apps/desktop/src/renderer/src/pages/CommsPage*', 'apps/desktop/src/renderer/src/panels/CommsReader.tsx', 'apps/desktop/src/renderer/src/panels/Announcements.tsx', 'apps/desktop/src/renderer/src/ui/communicator.tsx', 'apps/desktop/src/renderer/src/ui/commsText.ts'],
  },
  {
    name: '周末活动与入侵',
    globs: ['packages/core/src/weekend*.ts', 'packages/core/src/standing.ts', 'apps/desktop/src/renderer/src/panels/Weekend*.tsx', 'apps/desktop/src/renderer/src/panels/InvasionFx.tsx'],
  },
  {
    name: '成就',
    globs: ['packages/core/src/achievements.ts', 'packages/data/src/achievements.ts', 'apps/desktop/src/renderer/src/pages/AchievementsPage*', 'apps/desktop/src/renderer/src/panels/Achievements.tsx'],
  },
  {
    name: 'AI 核心',
    globs: ['packages/core/src/ai.ts', 'packages/core/src/aiCores.ts'],
  },
  {
    name: '主控活动与活动栏',
    globs: ['packages/core/src/activity.ts', 'packages/core/src/activityGate.ts', 'packages/core/src/busyLabels.ts', 'apps/desktop/src/renderer/src/panels/ActivityBar*', 'apps/desktop/src/renderer/src/panels/ActivityScreen.tsx', 'apps/desktop/src/renderer/src/ui/ActivityScreen.tsx', 'apps/desktop/src/renderer/src/panels/activityStopLabel.ts', 'apps/desktop/src/renderer/src/ui/activityGo.ts', 'apps/desktop/src/renderer/src/ui/activityArt.tsx'],
  },
  {
    name: '存档与元系统',
    globs: ['packages/core/src/save.ts', 'packages/core/src/saveBattleClean.ts', 'packages/core/src/ironman.ts', 'packages/core/src/debugGate.ts', 'packages/core/src/tuning.ts', 'packages/core/src/settleStats.ts', 'apps/desktop/src/renderer/src/panels/SaveManager.tsx', 'apps/desktop/src/renderer/src/panels/SaveReconnect.tsx', 'apps/desktop/src/renderer/src/panels/SaveWriterGate.tsx', 'apps/desktop/src/renderer/src/panels/DebugPanel.tsx', 'apps/desktop/src/renderer/src/panels/appSettings.tsx', 'apps/desktop/src/renderer/src/panels/Handbook.tsx', 'apps/desktop/src/renderer/src/panels/handbookDetail.tsx', 'apps/desktop/src/renderer/src/ui/theme.ts', 'apps/desktop/src/renderer/src/ui/tones.ts', 'apps/desktop/src/renderer/src/ui/Glyphs.tsx', 'apps/desktop/src/renderer/src/ui/Hint.tsx', 'apps/desktop/src/renderer/src/ui/WinBox.tsx', 'apps/desktop/src/renderer/src/ui/LazyMount.tsx'],
  },
  {
    name: '任务中心页与总览',
    globs: ['apps/desktop/src/renderer/src/pages/TaskCenterPage*'],
  },
]

/**
 * **共享底层**（§十八 第 3 条：**不算跨模块**，但改它的理由必须落在当前模块内）。
 * 判据 = "被两个以上域依赖、且自身不表达任何玩法"的文件。
 */
const SHARED: readonly string[] = [
  'packages/core/src/state.ts',
  'packages/core/src/types.ts',
  'packages/core/src/labels.ts',
  'packages/core/src/index.ts',
  'packages/core/src/engine.ts',
  'packages/core/src/simulation.ts',
  'packages/core/src/balance.ts',
  'packages/core/src/rng.ts',
  'packages/core/src/time.ts',
  'packages/core/src/logParts.ts',
  'packages/data/src/l10n/**',
  'packages/data/src/context.ts',
  'packages/data/src/index.ts',
  'packages/data/src/factionCodex.ts',
  'docs/**',
  'tools/**',
  '.githooks/**',
  'AGENTS.md',
  'package.json',
  '**/package.json',
  'apps/desktop/src/renderer/src/App.tsx',
  'apps/desktop/src/renderer/src/ui/AppShell.tsx',
  'apps/desktop/src/renderer/src/ui/classicSidebars.ts',
  'apps/desktop/src/renderer/src/game/**',
  'pnpm-workspace.yaml',
  'tsconfig*.json',
  '**/tsconfig*.json',
  '**/tsconfig*.json',
  '**/*.css',
  '**/tests/**',
  '**/*.test.ts',
  /**
   * ── 2026-10-02 一号补（§十八 域表随重构补：全仓普查把「未归类」清零）────────────────
   * 判据照旧 = §十八 第 3 条「被两个以上域依赖、且自身不表达任何玩法」；以下几族是
   * **外壳 / 基础设施 / 资源 / 跨域单点**，任何域都得读它们，但不属于任何功能域。
   */
  // 仓库根与 CI / 打包
  'README.md',
  'package-lock.json',
  'postcss.config.js',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.github/**',
  'steam/**',
  'review/**',
  'web/**',
  'apps/desktop/build/**',
  'apps/desktop/electron-builder*.yml',
  'apps/desktop/electron.vite.config.ts',
  // 桌面外壳（主进程 / 预加载 / 渲染入口）
  'apps/desktop/src/main/**',
  'apps/desktop/src/preload/**',
  'apps/desktop/src/shared/**',
  'apps/desktop/src/renderer/index.html',
  'apps/desktop/src/renderer/src/env.d.ts',
  'apps/desktop/src/renderer/src/main.tsx',
  'apps/desktop/src/renderer/src/assets/**',
  // 跨域单点（被两个以上域依赖、自身不表达玩法）
  'packages/ui/src/**',
  'apps/desktop/src/renderer/src/i18n/**',
  'packages/data/src/l10n.ts',
  'apps/desktop/src/renderer/src/ui/labelsText.ts',
  'apps/desktop/src/renderer/src/ui/Tooltip.tsx',
  'apps/desktop/src/renderer/src/ui/marks.tsx',
  'apps/desktop/src/renderer/src/ui/sessionView.ts',
  'apps/desktop/src/renderer/src/ui/layoutStyles.ts',
  'apps/desktop/src/renderer/src/pages/common.ts',
]

/** glob → 正则（支持 `**` / `*` / `?` / `{a,b}`；够用即可，不引依赖） */
function globToRe(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 吃掉任意层目录（含零层）
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if ('\\^$.|+()[]{}'.includes(c)) re += '\\' + c
    else re += c
  }
  return new RegExp('^' + re + '$')
}

/** `{a,b}` 展开（只展开一层，够本表用） */
function expandBraces(glob: string): string[] {
  const m = /\{([^{}]*)\}/.exec(glob)
  if (m === null) return [glob]
  const out: string[] = []
  for (const alt of m[1]!.split(',')) out.push(...expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)))
  return out
}

const matchers = new Map<string, RegExp[]>()
function matches(globs: readonly string[], path: string): boolean {
  let res = matchers.get(globs.join('|'))
  if (res === undefined) {
    res = globs.flatMap(expandBraces).map(globToRe)
    matchers.set(globs.join('|'), res)
  }
  return res.some((re) => re.test(path))
}

/* ── 取改动文件清单 ── */
const argv = process.argv.slice(2)
const stagedOnly = argv.includes('--staged')
const revIdx = argv.indexOf('--rev')
const rev = revIdx >= 0 ? argv[revIdx + 1] : undefined
/**
 * ⚠ **`-c core.quotepath=false` 是必需的**（2026-10-02 一号补）：默认配置下 git 会把含中文的路径
 * 用 C 风格转义并**加引号**（`"docs/exports/\347\255\233..."`）⇒ 那些路径永远匹配不上域表，
 * 会以"未归类"的假象挂在读数里（本仓 `docs/exports/*` 就有中文名文件）。
 */
const git = (args: string[]): string[] =>
  execFileSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

let files: string[]
if (rev !== undefined) files = git(['diff', '--name-only', rev])
else if (stagedOnly) files = git(['diff', '--cached', '--name-only'])
else files = [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['diff', '--name-only', '--cached'])])]

if (argv.includes('--list')) {
  console.log('功能域表（域 → 路径 glob）：')
  for (const d of DOMAINS) console.log(`  ${d.name}：\n    ${d.globs.join('\n    ')}`)
  console.log('\n共享底层（§十八 第 3 条 · 不算跨模块）：\n  ' + SHARED.join('\n  '))
  process.exit(0)
}

/* ── 分类 ── */
const byDomain = new Map<string, string[]>()
const shared: string[] = []
const unknown: string[] = []
for (const f of files) {
  if (matches(SHARED, f)) {
    shared.push(f)
    continue
  }
  const hit = DOMAINS.find((d) => matches(d.globs, f))
  if (hit === undefined) {
    unknown.push(f)
    continue
  }
  const arr = byDomain.get(hit.name) ?? []
  arr.push(f)
  byDomain.set(hit.name, arr)
}

/* ── 输出（ℹ️ 读数档：**恒 exit 0**）── */
console.log(`ℹ️ 模块范围读数（约定 §十八）：本次改动 ${files.length} 个文件 · 落在 ${byDomain.size} 个功能域`)
for (const [name, list] of [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    · ${name}：${list.length} 个 — ${list.slice(0, 4).join('、')}${list.length > 4 ? ' …' : ''}`)
}
if (shared.length > 0) {
  console.log(`    （共享底层 ${shared.length} 个，按 §十八 不计入域）`)
}
if (unknown.length > 0) {
  /**
   * ⚠ **全部打印，不截断**（2026-10-02 一号补域表时改）：本行原本只印前 12 个 ＋ 一句"…共 N 个"，
   * 但「未归类」正是**补域表的入口**（见约定 §十八 第 4 条与交接卡 §三.4）⇒ 截断会把入口挡掉一半。
   */
  console.log(`    ⚠ 未归类 ${unknown.length} 个（域表要补，别把它藏起来）：`)
  for (const f of unknown) console.log(`        ${f}`)
}
if (byDomain.size >= 2) {
  console.log('    ⚠ 跨 %d 个域 ⇒ 按 §十八 需**先向船长申请**；获批后在提交说明里记「船长批准：跨 A→B」', byDomain.size)
} else if (byDomain.size === 1) {
  console.log('    ✅ 落在单一功能域内')
}
process.exit(0)
