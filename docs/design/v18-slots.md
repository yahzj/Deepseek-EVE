# V18 槽位（C3）交接底稿：口径取消之后的高/中/低槽

> 状态：**交接底稿**（2026-09-04，船长指示）。
> C3（EVE 式高/中/低槽）的后续设计与实施**由大鲸鱼二号负责**，本会话（创建此文件者）
> 不再触碰。正式设计总结与实施记录由二号在本文件基础上续写/覆写（沿用 docs/design/
> 各文档"状态标注 + 顶部更新横幅"惯例）。

## 一、前置完成信号（可接手的明确信号）

口径取消（V18 弹药单档通用化 + 船体口径适配移除）已交付并提交，全部验证绿：

- 提交：`2e65392`（32 文件，+371/−332；本地 main，**未推送**；其后无新改动，工作区干净）；
- 验证：core 288/288 tests · content-check ✓（29 物品 / 48 装备 / 19 舰船 / 115 市场卡）·
  typecheck ×4 ✓ · desktop build ✓。

## 二、口径取消 = 槽位设计的既有前提（改动清单，别再引入尺寸维）

- **弹药每型单档通用弹**：`ammo-kinetic-l` 动能弹（dmg 6）/ `ammo-explosive-l` 高爆弹
  （dmg 7）/ `ammo-plasma-l` 等离子弹（dmg 9）；id 保留 `-l` 后缀是历史遗留，**没有轻档**
  与重档之分。旧 `-h` 重型弹由 `core/equipment.migrateDeprecatedAmmo` 按 1:1 并入（货仓/
  仓库/escrow + 卖单撤销），幂等，桌面 GameEngine.start 在 repairDeprecatedModules 后调用。
- **炮台 = 固定弹种**：turret `damageType` 决定打哪型弹（换炮 = 换弹种）；档位火力全部在
  `dmgMult`：civ ×1.0 / MK1 ×1.25 / MK2 3.73・3.66・3.38（动能/高爆/能量）/ MK3 5.13・5.03・
  4.64 / 异星原型 5.91。
- **船体口径适配整档删除**：`WeaponSize / weaponSize / maxWeaponSize / playerAmmoSize`
  全栈移除；任意船可装任意炮，装配唯一约束 = CPU（`fitModule` 六槽合计 ≤ 船体 cpu，
  与无人机放飞共用）。
- 炮台/蓝图显示名保留"轻型/重型/攻坚"为**档位风味**（近程速射/远程/超远程），不是
  尺寸位语义；描述文案已同步去掉"需能上重型炮的船 / 大口径"等失效口径声明。
- 校验锚点：`tools/content-check.ts` 数量断言（弹药恰 3、无 -h 死物品）；测试 fixture
  `packages/core/tests/helpers.ts` 弹药已更名 动能弹/高爆弹/等离子弹。
- 文档同步点：`docs/design/v17b-weapons.md`（顶部更新横幅；正文 = V17.2 历史档案）、
  `v17-modules.md` §七与决策记录 6、`v10b-combat-data.md`（顶部更新）、`docs/roadmap.md`
  （C3/C5 + 变更记录 2026-09 条目）。

## 三、船长已确认的 C3 设计问答（结论短表）

> 问答发生在本会话（2026-09，四步闸门"设计总结"阶段）；二号与一号无直接通信通道、
> 读不到本会话记录，故把结论抄录于此。**短表只记"选了哪个选项"，选项的完整语义描述
> 不在本文件**——若需细则请向船长索取原设计总结，勿自行脑补甲/乙含义。

- Q1（槽位安装方式）= **甲「复数安装」**（船长选定）；
- Q2（槽位形态）= 早答为远行星号式"带尺寸的槽"类提案；**最终拍板 = 乙「数量制不加
  尺寸位」**——无尺寸位；这与口径取消（第二节）互为印证，roadmap C3 已同步；
- Q3（模块归属/槽位映射）= **甲「槽位映射」**（船长选定）；
- Q4（船体布局）= **甲「布局草案」**（船长选定）；
- 出处：`docs/roadmap.md` C3 条目（2026-09-04 更新："2026-09 设计问答已收：Q1 复数安装 /
  Q2-final 数量制不加尺寸位 / Q3 槽位映射 / Q4 布局草案，实施等设计总结确认"）。

## 四、待二号完成的剩余步骤（按开发约定执行）

1. 先读 `docs/development-conventions.md`（四步闸门：ask → 中文设计总结 → 船长显式
   确认 → 实施；并行协作纪律：疑似一号工作区改动时先停手报告）；
2. 在本文件续写**正式设计总结**，至少覆盖：role 族差异化槽位布局（武装多高槽/
   装甲多低槽等）、高/中/低槽与六槽（miner/cargo/turret/shield/armor/propulsion）的
   映射或替换方案、模块归槽、复数安装下的装配/卸下交互与 CPU 校验、fitted 结构迁移
   与存档版本、装配页 UI 变化；
3. 船长确认后实施（core 测试 / content-check / typecheck ×4 / desktop + web build；
   B 级交付按约定配测试档 + docs/test-saves/README.md 说明）；
4. C5（炮族差异化 + 导弹架）与槽位版统一做（roadmap C5，船长 2026-09 批注）。

## 五、当前基线事实（实现者需知）

- 存档 `CURRENT_STATE_VERSION = 17`（`packages/core/src/save.ts`）；槽位若需结构迁移，
  自行评估 bump；惯例：纯兼容新增字段**不 bump**（v17.1 若干兼容字段先例）。
- `fitted` = 每船实例六槽定死：`miner / cargo / turret / shield / armor / propulsion`；
  槽位顺序与中文名 = `packages/core/src/labels.ts` 的 `MODULE_SLOTS / SLOT_LABELS`；
  盾槽内"增强器（抗性）/扩展器（容量）二选一"，甲槽同理（`MODULE_SLOTS` 层面仍是
  单槽单件）。
- 装备/模块结构 = `packages/data/src/modules.ts`（头部注释已按口径取消更新）；
  舰船 19 艘 role 分布：industrial=8 / armed=5 / armored=3 / hauler=3；
  舰船数据 = `packages/data/src/ships.ts`（`maxWeaponSize` 字段已移除）。
