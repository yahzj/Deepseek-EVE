# 测试门槛存档（Test Saves）

> 约定见 `docs/development-conventions.md` 第八章。B 批次 / 新玩法数值交付时，用
> `tools/make-test-save.ts` 基于船长当前真档注入门槛，生成存档提交到本目录。

## 加载方法（固定步骤）
1. 游戏内「存档管理 → 备份」（保留当前档）；
2. 退出游戏；
3. 把目标 `test-save-<feature>-<stamp>.json` **复制替换** `%APPDATA%\whale-idle\save.json`；
4. 启动游戏即测；测完回到游戏「存档管理 → 恢复备份」还原原档。

每个测试档旁都带一份生成时刻的 `user-backup-<stamp>.json`（注入前的原档副本，双保险）。

## 档案清单

### B1 低安遭遇（b1）
- 文件：`test-save-b1-*.json`（取最新一份）
- 注入门槛：钱包 +2000 万 ISK；协会声望 10；点亮全部低安星系（grave/abyss/auro/starcore/
  cinder/chasm/maw/nadir/voidedge）；驾驶船装轻型炮台 MK1 + 仓库轻弹 ×100×3；AI 专家 Lv3 +
  基础核心 ×4（可指挥 3 艘副船）；全舰耐久回满；重置首次低安提示。
- 建议测试路径：任选一低安星系悬赏（胜利后停留观察遭遇）或去低安矿带采矿；在线等「伏击待决」
  横幅 → 迎战一场 / 快速脱离一次 / 60s 不理它看自动脱离；派 2 艘副船去低安矿带验证"副船同遇 +
  停留船优先承担"；离线挂低安几小时看自动结算与数值体感。
- 数值回调入口：`packages/core/src/balance.ts` 的 `encounter` 段。

## 再生成
```powershell
npx tsx tools/make-test-save.ts b1
```
新功能注入 case 在 `tools/make-test-save.ts` 的 `INJECTORS` 中注册。

### B1.5 星图前往星系待命（standby）
- 文件：`test-save-standby-*.json`（取最新一份）
- 注入门槛：同 B1 + 预置一艘空闲副船已驻留待命在低安「深渊之口」（galaxy-maw）。
- 建议测试路径：星图点击任意已探索星系（含低安）→ 侧栏「前往星系 · 行动」：主控「前往待命」出发（活动栏可见可召回）→ 到点停留；选一艘空闲副船 + 核心 → 「派去待命」；观察预置副船的驻留状态、取消召回；低安驻留触发巡逻/伏击。