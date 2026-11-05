# BGM 素材目录（声音系统 · 2026-11-02 追加批）

把 BGM 文件放进本目录即可被游戏识别——**文件名就是场景语义 id**，不需要改代码：

```
assets/bgm/bgm-docked.mp3    → 停靠（母港 / 副站）
assets/bgm/bgm-space.mp3     → 太空（野外作业 / 航行 / 星图）
assets/bgm/bgm-battle.mp3    → 战斗（战场屏上屏）
assets/bgm/bgm-wormhole.mp3  → 虫洞
assets/bgm/bgm-invasion.mp3  → 入侵活动进行中
```

- 需要**无缝循环**：建议 60–120 秒、mp3 128 kbps 以上、单文件 ≤5 MB；游戏侧 `loop=true`，不做淡入淡出拼接。
- 场景优先级：战斗 > 虫洞 > 入侵 > 停靠 > 太空；切换时 1.2 秒交叉淡入淡出（见 `music.ts`）。
- 缺文件 = 静音；本机快速替换不必改这里：设置 →「声音」→「音效台」→「音乐」组拖入文件，
  只存本机、不进 git、不随发布。
- 正式入库：音效台「导出正式入库包」→ 仓库根 `npm run audio:install`（校验清单与路径后写入 `assets/bgm/`，默认清理同场景旧扩展名/变体；`--dry-run` 预览、`--keep-variants` 保留变体）。入库后回音效台「全部清除」，再跑 `npm run audio:check`。
- 版权：自制或已获授权；第三方音乐按各自许可证使用并登记来源。
