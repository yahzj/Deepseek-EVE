# V12 设计：实时战斗引擎（统一状态机 · 编队单位模型）

> **2026-09-05 更新（大鲸鱼二号）**：
> - **随机目标**：我方多武器对多敌编队时每发武器在开火瞬间从存活敌人中独立随机抽取目标
>   （确定性走 state.rng，可复现）——齐射火力可分散；目标死亡即时换人，不再有
>   "每步缓存单一集火目标 → 齐射轮内打已死目标浪费火力"的问题；
> - **开火事件补目标字段**（BattleFx.to）：弹道/命中动画真正指向被击中的单位
>   （旧版 fx 只带射击者 tag，UI 一律回退画向队列第一位）；
> - **敌方队列补位收拢**：被击毁单位即时撤出队列、剩余敌舰前移；残骸在死亡锚点
>   原位播放爆炸并淡出（独立残骸层，不占阵型）。
> - 平衡提示：随机分散使敌方减员变慢（原集火先拆一艘），战斗略长；胜率预估仍用
>   血池期望模型，差异进 C4 校准轮复核。
> - **敌方近盲带规则（2026-09-05 追加拍板，c4f9c17）**：敌方单位在近盲带内
>   （dist < weapon.minRangeM）**不停火**，照常射击但伤害 × `blindDmgMul` 打折
>   （单发 = round(shotDmg × blindDmgMul)，实时引擎与胜率预估同源）；AnomalyDef 新增
>   `blindDmgMul?`（0~1，缺省 0.3，现有怪物全按 0.3，未来单卡可覆盖）。
>   **玩家武器无此待遇**：玩家在近盲带内仍不开火——双方在近盲带上行为区分
>   （玩家贴脸钻敌近盲不再是零风险）。
> - **C4 第二批·kite 速度（2026-09-05，eb40979）**：kite 战术速度系数调至 0.72 且
>   封顶（foeSpeedCapMul），远程怪速度与随威胁成长大降——玩家可以追上、钻其近盲带。

> 状态：**已确认**（用户 2026-09 确认；含补充：离线性能专项测试、编队/多单位架构预留、
> 无人机 v1 并入主船 + 生存契约 DroneDefense 已补、分期 P1 引擎 / P2 小剧场 UI）。
> **编号说明**：存档 v11 已被并行开发的"随机事件系统"占用（events），本战斗里程碑编号 **V12**，
> 存档版本 v12（迁移链 v11→v12）。
> 职责记录：战斗系统设计决定 = 大鲸鱼二号。
> 前置契约（全部启用）：V10.5 克制表（动能对盾 ×1.5 对甲 ×0.5 / 高爆反之 / 能量对盾 ×0.75）、
> 三层承伤、V10.5b（每层三系抗性、CPU=装备+无人机共用、无人机舱、间接属性——本轮起速度参与
> 距离动力学、扫描/信号参与命中修正）。

## 一、总架构（统一引擎，无第二口径）

- 远征 = 两阶段：`out`（去程航行，沿用固定时长机制）→ 到港自动进入 `battle`（持久状态机推进）
  → 战斗结束自动 `back`（返航）→ 到家结算战报
- 战斗 = **确定性事件步进**：不逐帧，按下个决定性事件切段（装填完成开火 / 距离穿越射程边界 /
  单位击破 / 编队全灭）；在线每秒小步、离线一次性大步长——同一 `advanceBattle(dt)` 代码路径
- 在线可"观战/介入"（P2 小剧场：距离条/双方血条/事件流 + 手动拖距离条）；介入只是改状态里的
  期望距离（落档，离线沿用）——不产生第二套结算
- 预估胜率 / AI ≥80% 门槛 = 同一引擎的"自动战术期望推演"（确定性），与结算同源

## 二、编队单位模型（NvN 预埋）

- 战斗双方 = 单位列表；单位数据包 = 三层血量/层抗 × 武器 × 机动（速度/机动/信号）× AI 控制器
- v1：我方 = 玩家主控船 1 单位（无人机并入主船武器组，不单独成单位、不损毁）；
  敌方 = 目标主体 1 单位 + 僚机 0~2（escorts，每架 threat×0.5 独立单位）
- 目标选择（v1）：每单位攻击"射程内最近的可开火敌单位"，同距按单位序集火
- 敌方单位由 `threat` 运行时换算生成（见六）——AnomalyDef 只加叙事字段

## 三、命中与伤害公式（每次开火）

```
开火条件    weapon.minRangeM ≤ 距离 ≤ weapon.maxRangeM（过近/过远不开火；
            **敌方例外（2026-09-05）：近盲带内不停火、伤害 ×blindDmgMul**，见文首更新）
距离衰减    distFactor：minRange 端 = 1.0 → 线性降至 maxRange 端 = weapon.falloff
有效回避    effEvasion = defender.evasion × clamp(sigMin, sigMax, sigBaseM / defender.signatureM)
命中加成    effHitBonus = attacker.hitBonus × clamp(scanMin, scanMax, attacker.scanResMm / scanBaseMm)
单发命中    hit = clamp(hitMin, hitMax, (weapon.hitRate + 攻方 effHitBonus) × distFactor − 守方 effEvasion)
单发伤害    dmg = ammo.dmg × weapon.dmgMult × (1 + 0.05×炮术等级) × (1 + ship.powerBonus)
伤害结算    类型 × 层位克制系数 × (1 − 层抗)，逐层消费（盾→甲→结构）；结构归零单位击破
```

## 四、武器 / 弹药 / 无人机 / CPU 规则

- ModuleDef 炮台家族新增：`maxRangeM / minRangeM / hitRate / falloff / reloadMs / dmgMult`
- 炮术学：改为每级 **+5% 单发伤害**（skill 文案同步）
- 弹药：每次开火（不论命中）消耗 1 发；弹型选择 = 开火时取剩余数量最多的型（平局按
  kin→exp→pla）→ 混装配弹自然形成伤害类型混合；单型打空则该型停火
- 出发预载：按 `ammoTimeCapMs × 射速 × ammoMargin` 从货仓→仓库装载弹药快照；结束剩余退回
- 无人机：出发自动装载（仓库/货仓），受 `droneBayM3` 与 CPU 余量约束（dmg/cpu 贪心选配），
  参战并入主船伤害类型权重；v1 不损毁
- `ammoPerEngagement` 退役语义（预载替代），字段保留展示

## 五、距离动力学与战术

- 开战距离 = max(双方全部武器 maxRange)×openRangeFactor + openRangePadM
- 每 tick 双方朝各自期望距离移动；距离变化率 = 速度代数和
  （战斗机动速度 = maxSpeed × speedFactor ×(1±agilitySpeedBonus)），clamp [minDistanceM, 开战距离]
- 玩家战术（出发卡选择 + 战斗中可改）：贴脸/中距/风筝/自动（默认中距）；手动 = 拖距离条覆盖
- 敌方 tactic：`brawl`（贴脸近战）/ `orbit`（中距绕圈）/ `kite`（拉远吊打）；
  期望距离 = 战术基准射程 × tacticDesireFactor（基准 = 双方 maxRange 较大者）；速度快方主导收敛

## 六、敌方单位换算（运行时，初值校准）

- AnomalyDef 增：`tactic`（默认 orbit）/ `defProfile`（默认 balanced，血型比例 盾型 50/25/25、
  甲型 20/55/25、均衡 33/33/33）/ `escorts`（0~2）/ `dmgMix`（默认均分）/ `foeSpeedMps?` /
  `blindDmgMul?`（近盲带伤害比例，缺省 0.3）
- 主体总血 = C4 时长预期曲线 `foeHpOfThreat(T)` = 参考段火力 foeRefFire(段) × D(T)
  （D = 5+85×((T−6)/90)^1.6）；血量按威胁份额分给主体/僚机（每架 escorts×0.6 份额）
- 敌方武器由 tactic 定型（brawl 贴脸近程 / orbit 中距环绕 / kite 远程高最小射程），
  C4-#3 起走"虚拟装配模板"：射程 = 战术带 ×(1+侧重系数×(T−10)/90) 封顶 15km；
  速度 = 参考船速段 × m_base(T) × tactic 系数（brawl 1.28 / orbit 1.0 / kite 0.72）封顶；
  总火力 ≈ threat × foeDpsPerThreat（0.8）
- 现有 10 目标按叙事补字段（深渊之门卫队 shield+kite、坟场守墓人 armor+brawl、
  星髓巢穴 armor+brawl+僚机×2 = 首个 1v3 等）

## 七、胜负与结算

- 胜 = 敌编队全灭（奖励/战利品/声望/情报彩蛋沿用）；败 = 我方结构归零
  （扣耐久 0.15~0.3、弃船骰、维修费=期望奖励×50% 沿用）
- 战斗超时（maxBattleMs）按双方剩余血量比判胜
- 战报升级：交战时长、开火/命中统计、弹药消耗、双方各层残余

## 八、存档 v12（迁移 v11→v12）

- `expedition` 两阶段：保留旧字段（finishAtGameMs=当前阶段结束时刻、outMs、combatMs 展示、
  power 展示）+ 新增 `phase: 'out'|'battle'|'back'` 与 `battle: BattleState | null`
- BattleState 只存**动态量**（静态由 ship/anomaly 定义可重建）：
  { startedAtGameMs, lastTickGameMs, distanceM, myDesireM,
    units: {tag→{side,name,hp{s,a,h},weaponCdMs}}, ammo{kin,exp,pla}, stats }
- AI 远征任务同构（phase/battle）
- 迁移 11→12：**在途远征与 AI 远征召回**（返回核心 + 日志"战斗系统升级，旧远征已召回"），
  其余补默认（phase='out'、battle=null）；normalize 容错 + 迁移测试 + 冒烟

## 九、性能专项（验收项）

- 性能回归：多场 1v3 连续 8h 离线推演 + 事件步数 guard 上限 + 墙钟宽松断言

## 十、边界（P1 不做 / 未来项）

间接属性中速度之外的进公式、无人机损毁与手动放飞、AI 战术自适应、多玩家船同场（架构已就位）、
电容/能量栅格、rig。P2 = 小剧场 UI。

## 实施顺序（P1）

types/balance → combat.ts（纯函数+单测）→ expedition/ai 两阶段 + 弹药/无人机 → save v12 →
anomalies 数据 → 旧口径测试迁移 + 校准脚本 → 性能回归 → 文档同步。
