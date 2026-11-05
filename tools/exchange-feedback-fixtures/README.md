# 证券反馈回归夹具

- `node --import tsx --test tools/exchange-feedback.test.ts`：模拟传输层，验证账户、委托、理财同步和历史行情补拉。
- `node tools/exchange-feedback-ui.cjs`：后台构建夹具后在 `show:false`、离屏 Electron 窗口运行，验证默认页、扩窗几何、进度 Hook、简单 Enter 与专业点击提交及拒单。
- `layout` 使用独立模拟账户；`progress` 只测进度与释放；`trading` 使用延迟可控的合成传输层。没有真实服务器请求，不读取或修改个人存档。
- 运行器只在系统临时目录写构建件，成功失败都会清理。超时由本次 execFile 结束自身 Electron；不按进程名清理其他程序。
- 几何读数不等同于船长观感验收；合成传输层不等同于生产服务器端到端验收。
