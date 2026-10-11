# 星系天体本地资产

PixelPlanets原分层材质，船长2026-10-10验收星系中央场景与目标详情；不用于地表资源或隐藏属性推断。正常显示用`ui/stellarPixelMaterials.ts`原层二维WebGL动态材质，以下静态PNG仅兼容兜底。

生成：`node tools/pixel-planets-samples.cjs H:\大鲸鱼\PixelPlanetsWindows.exe <不存在的输出目录绝对路径> --scene-set`。
参数和指纹：`manifest.json`/`parameters.json`。七类星球、四色恒星和黑洞，均静态RGBA PNG；本体密度256、边缘16px留白。带环气态外框800、恒星/黑洞544，其余288。本体尺寸映射在`ui/stellarAssets.ts`。

来源：Deep-Fold/PixelPlanets，Godot3历史提交`a712f460077119aeb5f3b688c0785021df8cabb3`；本机EXE内嵌19个shader与源码统一换行后一致。原软件为MIT，版权许可保留`LICENSE-PixelPlanets.txt`，被两端构建通过`?url`引用并输出；未打包EXE或源仓。图片使用原生shader/场景参数导出，非截图裁切，不调用网络生成服务。

现行光照/运动/清晰度/面积规则与验证见`docs/design/planetary-system-search-20261007.md`§十二。原三类样片和审查板在`docs/design/assets/stellar-samples-20261009`保留，工具说明见`tools/README.md`。
