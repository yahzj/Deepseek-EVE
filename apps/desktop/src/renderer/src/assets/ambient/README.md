# 环境音素材目录（声音系统 · 2026-11-02 追加批）

文件名就是语义 id，放进来即生效；不需要改代码：

```
assets/ambient/ambient-docked.mp3   → 停靠底噪（低频舱室嗡鸣）
assets/ambient/ambient-space.mp3    → 太空底噪（空灵 / 船体低频；虫洞与入侵沿用）
assets/ambient/ambient-battle.mp3   → 战斗底噪（远处炮火 / 舰体震动）
assets/ambient/ambient-blip-comms.mp3   → 随机点缀：远处通讯滴答
assets/ambient/ambient-blip-metal.mp3   → 随机点缀：金属吱呀
assets/ambient/ambient-blip-static.mp3  → 随机点缀：电流杂音
```

- 底噪 3 条：**无缝循环**，建议 20–60 秒、单文件 ≤2 MB。
- 点缀 3 条：一次性短音（0.2–2 秒），游戏每 20–90 秒随机播一条，音量走「环境」分类。
- 缺文件 = 静音；本机快速替换走设置 →「声音」→「音效台」→「环境」组（只存本机，不随发布）。
- 正式入库：音效台「导出正式入库包」→ 仓库根 `npm run audio:install`（校验清单与路径后写入 `assets/ambient/`，默认清理同事件旧扩展名/变体；`--dry-run` 预览、`--keep-variants` 保留变体）。入库后回音效台「全部清除」，再跑 `npm run audio:check`。
- 版权：自制或已获授权；第三方素材按各自许可证使用并登记来源。
