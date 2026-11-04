# 发布版权声明工具

## 用途与边界

网页和桌面渲染包使用同一插件输出授权声明，不改变玩法、存档、网络访问或运行权限。`LICENSE.txt`是权利声明的单一正文来源；第三方组件许可从各目标实际安装的依赖读取，PixelPlanets许可沿用素材原件。

本工具不是防复制、加密或AI权属认证。浏览器需要执行的代码仍可被提取。当前工作树没有项目级旧许可证不等于历史上没有授权；声明不撤销既有有效许可，也不能据此限制既有合法使用。

## 输入与输出

- 输入：根目录`LICENSE.txt`；目标工程安装的`react`、`react-dom`、`scheduler`、`lucide-react`许可证；现有`LICENSE-PixelPlanets.txt`；内嵌字体授权两份：`apps/desktop/src/renderer/src/assets/licenses/unifont-18.0.01-LICENSE.txt`（GNU Unifont，复古档全字体，2026-11-02 随可选界面字体入库）与 `oxanium-LICENSE.txt`（Oxanium，SIL OFL 1.1，默认档英文/数字）。
- 输出：`web/dist/`或`apps/desktop/out/renderer/`下的`LICENSE.txt`、`copyright.html`、`THIRD-PARTY-NOTICES.txt`。
- HTML入口增加版权元信息及`rel="license"`链接；全部渲染JS保留版权头；独立版权页不加载脚本、不收集信息。
- 显式关闭两端生产源码映射；桌面main/preload也关闭。已有版本、提交标识和构建时间继续由`tools/build-info.ts`提供。
- 桌面打包仍仅带`out/**`；另在安装目录附带授权及第三方许可文本。Steam继承相同规则。Electron/Chromium自带许可文件不删除、不替换。
- 不输出私有源码映射。默认不生成公开映射；如需私有排障映射，应使用独立受控产物，不上传Pages或Steam。

## 使用

```powershell
npm run release:rights:test
npm --prefix web run build
npm run build
npm run release:rights:check
# 只核查已构建的一端：
npm run release:rights:check -- --web
npm run release:rights:check -- --desktop
```

专项测试只写临时合成目录并自行清理。产物核查只读取上述构建目录和许可证，不联网，不读取个人存档或历史档案。失败返回非零退出码。

发布前仍须按仓库要求完成验收。本工具不是完整依赖许可证合规审计；新增运行依赖或素材时，应更新许可清单并复核对应授权。变更仓库私有性、签署发行协议、处理历史许可或对外发布均需另行明确授权。

## 发布前待核查

- 当前版权声明改动尚未提交、推送，线上版本尚未应用；文档归档不等于对外发布。
- 独立版权页的浏览器显示及打包EXE启动尚未验证。产物内容核查不能替代这两项检查，也不能代替正式发布所需的完整回归与船长验收。
- 历史许可证、完整素材权属及完整依赖合规审计尚未进行；不以当前声明或构建通过代替这些结论。
