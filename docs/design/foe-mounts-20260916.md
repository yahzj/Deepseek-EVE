# 敌方挂载件（冲锋 / 受击增程挂载化 ＋ A 族洞内海盗冲锋）· 工作文档

> **状态：进行中**（二号 · `d2/workspace` · 2026-09-16）
> 归档指向：船长验收 + 合入 main 后 ⇒ 关键内容并入 `docs/glossary.md`（新词条「敌方挂载件」＋虫洞条补 A 族冲锋）
> 与 roadmap 一条，**本工作文档删除**（§8 三步）。

## 一、船长原话（照抄）

1. 「**给A族虫洞内的海盗添加冲锋能实现吗？冲锋倍率为1.6，冷却30秒**」
2. （问"能不能做成装备那样"时）「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」
3. 「**除了C族，将D族和E族的射程增加也迁成挂载件**」
4. 「**只给 A 族 30 秒（C 族保持 10 秒）**」（冷却适用范围）
5. 「**要：敌舰悬停/战报展示挂载件**」（展示面）
6. 「保持「整队标量」（零行为变化）」（E 族机群增程的作用面）

## 二、落值：`FOE_MOUNTS` 七件

| 挂载件 id | 名称（玩家可见） | 参数 | 挂给谁 |
|---|---|---|---|
| `foe-mount-charge-pirate` | 劫掠冲锋推进器 | 冲锋 ×**1.6** / 冷却 **30 秒** | **A 族洞内三卡的条目**（劫掠支队 / 劫掠围猎 / 海盗战团） |
| `foe-mount-charge-swarm-t1` | 虫群冲锋器 T1 | ×1.5 / 10 秒 | C 族：星髓幼虫 · 畸变幼虫 |
| `foe-mount-charge-swarm-t2` | 虫群冲锋器 T2 | ×2 / 10 秒 | C 族：星髓成虫 |
| `foe-mount-charge-swarm-t3` | 虫群冲锋器 T3 | ×2.5 / 10 秒 | C 族：孢群异虫 |
| `foe-mount-charge-swarm-t4` | 虫群冲锋器 T4 | ×3 / 10 秒 | C 族：噬口巨兽 |
| `foe-mount-drone-range-x4` | 机巢增程阵列 | 机群受击增程 ×4 | E 族三舰（巨构残段 / 奥罗残骸段 / 核心舱段） |
| `foe-mount-gun-range-x1-5` | 守墓远距观瞄 | 炮台受击增程 ×1.5 | D 族静滞卫舰 |

**表放 core 的理由**：建档路径 `createFoeSpecs(anomaly, bal, opts)` 拿不到 `ctx`（data 表通常经 ctx 下发），
而解析必须在建档处完成 ⇒ 目录表放 `packages/core/src/foeMounts.ts`（先例：`core/lairs.ts` 的 `FOE_LAIR_GEAR`）。

## 三、挂载点与优先级

- `FoeShipDef.mounts?: FoeMountId[]`（**舰级默认装配**）
- `FoeShipSlot.mounts?: FoeMountId[]`（**卡条目覆写**：写了整条替换舰级的挂载，与 `droneFireShare`/`desireRangeM` 同款）
- 旧字段 `foeCanCharge` / `foeChargeMul` / `droneRangeMulOnHit` / `gunRangeMulOnHit` **保留为兼容回退**：
  只有"没挂 mounts"时才读 ⇒ 老卡、老档、老测试逐字不变（合成试验卡仍在用这条回退）。
- 解析单点：`foeMounts.resolveFoeMounts(ids)` ⇒ `foeCanCharge` / `foeChargeMul` / **`foeChargeCooldownMs`（新）** /
  `foeDroneRangeMulOnHit` / `foeGunRangeMulOnHit` / `foeMountNames`（展示名）。

## 四、引擎 / 界面接线

- `combat.createFoeSpecsFromShips`：解析挂载（条目 > 舰级）→ 运行时字段；未知 id 不生效（体检红灯）。
- **逐单位冲锋冷却**：`UnitSpec.foeChargeCooldownMs` ⇒ `updateFoeCharge` / `releaseFoeChargeOnHit` 读"本单位 ?? 全局 10 秒"。
- **展示**：`battleView.foeMounts`（本场敌方去重挂载名）· `foeBands[].mounts`（逐射程带）；
  `BattleState.foeMounts`（运行期，`seedUnit` 累积，含多波/增援）⇒ `BattleReportRecord.foeMounts`。
  界面：射程带悬停尾附「挂载：…」· 底部新增「敌挂载：…」chip · 战报新增一行「敌方挂载件：…」；
  「敌冲锋中」chip 的悬停文案改为「随后进入各自的冷却」（不再是写死的 10 秒）。

## 五、契约与用例

- `content:check` 新增「**敌方挂载件契约**」：① C 族五条按档倍率 = `ALIEN_CHARGE_MUL_BY_TIER`、冷却 10 秒；
  ② **洞内三张 A 族卡的每条编成条目**必须挂海盗件且参数 = 1.6 / 30 秒；③ **洞外不许挂冲锋件**（除 C 族舰级）；
  ④ 挂载 id 必须都能解析；⑤ D/E 增程件归属沿用原口径（D 只静滞卫舰 · E 只带机群三舰）。读数行同批打印。
- `tests/thruster-charge.test.ts`：C 族契约改读挂载件；新增 3 例 A 族（洞内三卡逐条目挂件 ⇒ ×1.6 / 30 秒 /
  展示名 · **洞外反证**（同一批舰级不挂条目 ⇒ 不冲锋）· **30 秒冷却实测**（解除后 cd ≈ 30 秒））。
- `tests/foe-ship-path.test.ts`：E 族受击增程断言改读挂载件（行为不变）。

## 六、验证

- 五闸门：`npm run typecheck` 四包 **0 错** · core **158 文件 / 1,727 例** 全绿 ·
  `content:check` ✅（挂载件契约读数：7 件 · C 族 5 条按档 · A 族 3 卡条目 ×1.6/30 秒 · 洞外零冲锋件）·
  `ui:rot-check` ✅ · 桌面构建 ✅。
- 读数实测（临时探针，用后已删）：洞内三卡 9 条单位全部 ×1.6 / 30 秒 / 挂载名「劫掠冲锋推进器」；
  **洞外引用 A 族海盗舰级的 10 张卡里带冲锋的 = 0 张**。

## 七、待裁决 / 开放点

- **挂载件名**（玩家可见，进悬停与战报）：「劫掠冲锋推进器」「虫群冲锋器 T1~T4」「机巢增程阵列」「守墓远距观瞄」——
  想换名说一声。
- `foe-mount-charge-pirate` 的 `triggerMarginM` 没写 ⇒ 沿用全局 1,000m；若要 A 族更早/更晚起冲，给这一件加参数即可。
- 归档待办（§8 三步）：词典新词条「敌方挂载件」＋虫洞条补 A 族冲锋口径；roadmap 一条；删本工作文档；重跑 `docs:index`。
