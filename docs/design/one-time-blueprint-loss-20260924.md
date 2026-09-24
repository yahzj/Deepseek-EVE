# 一次性图纸"在造时被吞"（2026-09-24 玩家报障 · 船长转述）

状态：**已修并合入 main**（`1e19ccb4`）· 待船长裁决两点（见 §四）

> 船长原话（照抄）：「有玩家反应，刚刚在造的锤头鲨级一次性蓝图，还差2小时完成，离线后过了一段时间
> 上线发现船不见了，蓝图显示已消耗。」＋「玩家的存档我已经导入本地，你可以检查下制造记录」

## 一、存档实证（`%APPDATA%\whale-idle\save.json` **只读**核对）

| 读数 | 值 |
|---|---|
| `spentOneTimeRecipes` | `sbp-once-thresher` · **`sbp-once-hammerhead`** · **`sbp-once-bullshark`**（三张一次性舰船图**全被消耗**） |
| `shipStore` | `sandcat×2 · whale×1 · sh-tigershark×1` —— **没有锤头鲨、没有牛鲨** |
| `manufacturingRuns` | `[]`（没有在跑的线；`manufacturingSeq = 15`） |
| `autoLoopAnomalyId` | `ano-chasm-aberrations`（**重复清剿开着**） |
| `blueprintStock` | `sbp-sandcat:1 · sbp-once-thresher:2` |
| `fleet` | 含 `sh-thresher`（长尾鲨那张一次性图**兑现成功**，正在开） |
| `logs` | **空表**——存档不落日志（`save.ts` 写 `logs: []`）⇒ 事件轨迹只能从状态反推 |

## 二、根因（三段代码拼成一条链，逐个修）

1. **重复清剿抢主控**：`expedition.autoLoopWaitLabel` 的"等主控"表里**没有**亲自开炉/亲自开线
   （表的判据是「这一项是否真的占着主控」，与采矿/打捞同性质 ⇒ **漏项**）⇒ 清剿到点就
   `startExpedition` → `applyActivityGate` → 把主控手上的造船线当"当前活动"掐掉。
2. **自动停机不退书**：`state.haltActivityForSwitch` 的 manufacturing 分支只把线标 `active = false`
   ⇒ 书与名额一起蒸发。按船长 2026-09-20「一次性蓝图的制造取消后返还玩家蓝图」，自动停机**就是一次取消**，
   代价按既定口径（`HALT_COST.manufacturing`）只有**当前那批的进度**，不是"这张图纸作废"。
3. **`bookSpent` 不随档**：`save.sanitizeMfRun` 没保留它，而取消退书的判据就是它 ⇒ 存档往返后
   **取消静默不退书**。

## 三、修法与验证

- `state.refundOneTimeBookOf`（**唯一实现**，`manufacturing.refundOneTimeBook` 委托它）+
  halt 分支：先标停 → 退书退名额 → **把停掉的线从表里摘掉**（防"同一线号再取消"二次退书）。
  只停 `worker === 'pilot'` 那条（AI 核心线不动，与既有口径相同）。
- `save.ts`：`bookSpent` 随档（老档缺字段 ⇒ 不写，与改动前一致）。
- `expedition.autoLoopWaitLabel`：补「亲自开炉 / 亲自开线」⇒ 清剿**等**手工作业跑完再出发
  （活动栏照既有口径显示「等待…结束，自动再出击」）。
- 用例 `tests/one-time-blueprint.test.ts` **+6**（共 22）：停机退书退名额 · `bookSpent` 随档 ·
  一次性舰船图存档+离线照常交付 · 停机不留僵尸线（不能二次退书）· 清剿让路 · 只停主控那条。
- 端到端复刻（真内容目录，`tools/_once-ship-repro.ts` 临时探针）：开工 → 清剿等待表 = 「亲自开线」→
  存档+读档（`bookSpent = true`）→ 离线 6 小时 ⇒ **`shipStore = {"sh-hammerhead":1}`**、
  书按"已兑现"不退。

## 四、待船长裁决（不许默默定）

1. **停机要不要连材料一起退？** 现状：手动「取消制造」= 材料全额退回 + 退书；**自动停机**= 退书，
   但材料不退（开工时一次性扣的，4.8 小时的船 ≈ 23.5 万单位三钛）。两条路代价不一致。
   可选：甲 = 停机与取消同款（材料 + 书全退，只损失进度）；乙 = 保持现状（材料作废，仅退书）。
2. **玩家已损失的两张图（锤头鲨 / 牛鲨）＋材料要不要补？** 补账属于给玩家发东西，需您点头；
   我可以写一个**只读 + 自动备份**的补账工具（按蓝图材料清单回填仓库 + 图纸回书架 + 摘名额标记），
   或您手动处理。

## 五、附带观察

- **玩家存档不落日志**（`logs` 恒为空）：社区报障时拿不到事件轨迹，只能从状态反推。要不要把
  「最近 N 条日志」随档（只读展示用）？这属新增存档字段 ⇒ 需您裁决后再做。
