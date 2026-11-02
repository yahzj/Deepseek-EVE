# 音效素材目录（声音系统 · 2026-11-02）

把音频文件放进本目录就能被游戏识别——**文件名就是事件 id**，不需要改代码：

```
assets/sfx/invasion-alarm.mp3    → 入侵警报
assets/sfx/combat-fire.mp3       → 我方开火
assets/sfx/industry-done.ogg     → 生产完成
```

- 事件清单与默认增益/节流见 `apps/desktop/src/renderer/src/game/audio/cues.ts` 的 `SFX_CUES`；
  清单里的 id = 这里的文件名（去扩展名），对不上的文件会被忽略（`npm run audio:check` 会报出来）。
- **同一事件可放多份变体**：`combat-fire.1.mp3`、`combat-fire.2.ogg` —— 播放时随机取一份，避免重复感。
- 支持 `.mp3` / `.ogg` / `.wav` / `.m4a`；**推荐 mp3**（Safari 不支持 ogg，网页版会静音那一条）。
- 单文件建议 ≤ 300 KB（会随构建打进桌面包与网页产物）；缺文件的条目 = 静音，不报错。
- **本机快速替换**不必改这里：设置 →「声音」→「音效台」（仅本机调试可见）拖入文件即生效，
  只存在本机、不进 git、不随发布；发布用的仍是本目录的内置素材。
- 构建后改本目录需要重新构建（开发模式 `npm run dev` 会热更新）。

版权：素材由项目作者自制或已获授权；第三方音效按各自许可证使用，并在提交说明/工作文档登记来源。
