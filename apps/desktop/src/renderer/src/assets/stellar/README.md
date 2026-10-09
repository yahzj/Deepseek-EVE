# 星系天体本地资产

PixelPlanets像素风，船长2026-10-09确认用于星系中央场景与目标详情；不用于地表资源或隐藏属性推断。

生成：`node tools/pixel-planets-samples.cjs H:\大鲸鱼\PixelPlanetsWindows.exe <不存在的输出目录绝对路径> --scene-set`。
参数和指纹：`manifest.json`/`parameters.json`。七类星球、四色恒星和黑洞，均静态RGBA PNG；本体密度256、边缘16px留白。带环气态外框800、恒星/黑洞544，其余288。本体尺寸映射在`ui/stellarAssets.ts`。

来源：Deep-Fold/PixelPlanets，Godot3历史提交`a712f460077119aeb5f3b688c0785021df8cabb3`；本机EXE内嵌19个shader与源码统一换行后一致。原软件为MIT，版权许可保留`LICENSE-PixelPlanets.txt`，被两端构建通过`?url`引用并输出；未打包EXE或源仓。图片使用原生shader/场景参数导出，非截图裁切，不调用网络生成服务。

详见`docs/design/stellar-scene-20261009.md`。原三类样片和审查板在`docs/design/assets/stellar-samples-20261009`保留。
