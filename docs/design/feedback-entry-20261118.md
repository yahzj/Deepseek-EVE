# 游戏内反馈入口（反馈 → 自建服务器代发 GitHub Issue）

- 状态：实施中
- 日期：2026-11-18
- 船长原话：「这游戏能做个反馈入口吗，直接变成issue 放到 https://github.com/yahzj/Deepseek-EVE/issues 里收集？」「我需要玩家反馈的UI UX很轻松，可以直接CTrl +V粘贴图片上传，没有截图很难知道玩家描述」
- 船长裁决（2026-11-18 问答）：实现方式 = 自建服务器代发（玩家无需 GitHub 账号）；入口位置 = 设置面板底部。

## 范围

- 前端（本仓）：设置面板底部「反馈问题」按钮 + 弹窗（描述框支持 Ctrl+V 粘贴截图、拖入图片、预览删除），自动附带版本/平台/UA/时间。
- 后端（deepseek-eve-Background / whale-server，端口 8787）：新增 `POST /api/feedback`，用 GitHub token 调 `api.github.com/repos/yahzj/Deepseek-EVE/issues` 建 issue，标签「玩家反馈」；图片存服务器静态目录并在 issue 正文内嵌 URL。
- 部署：7777 站点 nginx 加 `/api/feedback` 反代到 8787（同源，避免 CORS），图片目录 `/var/www/whale-idle-6666/feedback-images/`。
- token 配置在服务器 `/etc/whale/internal.env` 的 `GITHUB_ISSUE_TOKEN`，不进任何仓库。

## 不做

- 不做玩家账号绑定，不存反馈数据库（直接转发，失败返回错误让玩家重试）。
- 不做管理后台/反馈列表，issue 即收件箱。
- 桌面版与网页版共用同一入口与接口。

## 边界与限流

- 每 IP 10 分钟 1 条、全局每小时 20 条；文本 ≤4000 字；图片 ≤3 张、每张 ≤5MB，仅 png/jpeg/webp/gif（校验 magic bytes）。
- 标题由正文首行截取自动生成，玩家不用填标题。

## 待裁决

- 无（连通性已实测：服务器到 api.github.com 200 / 0.4s）。
