# PixelPlanets 三类天体样片

状态：仅样片，待船长风格审查，未接入游戏。

## 文件

- `rocky.png`：无大气岩质，288×288透明PNG，星球直径256px，种子127。
- `ocean.png`：海洋、岛屿与云层，288×288透明PNG，星球直径256px，种子583。
- `gas.png`：气态带环，800×800透明PNG，本体直径256px，环使用三倍范围，种子846。
- `manifest.json`/`parameters.json`：输出指纹、源场景、种子、颜色、光源、旋转、冻结时间、像素密度和留白。
- `review.png`：深浅底和116/48px缩小审查板，不是游戏界面截图。
- `readings.json`：透明像素、边界和同环境复现读数。

PNG黑底显示不等于图片有黑色背景：文件为RGBA，四周透明。气态样片含环，若按整张图缩小，本体会比无环星球小；正式接入应按本体锚点而非整张图外框统一尺度，不裁掉环。

## 来源与许可

来源：[Deep-Fold/PixelPlanets](https://github.com/Deep-Fold/PixelPlanets)，历史提交`a712f460077119aeb5f3b688c0785021df8cabb3`，Godot3版本。原软件许可为MIT，完整版权和许可见`LICENSE-PixelPlanets.txt`。

使用船长提供的`H:\大鲸鱼\PixelPlanetsWindows.exe`（Godot3.5），内嵌PCK的19个shader与上述源码统一换行后全部一致；未声称整个二进制可由该提交逐字重建。样片只使用原生场景和shader，未使用字体、UI纹理或GIF插件；生成脚本只控制原有参数并保存透明视口，不重新实现球体算法。

## 复现

`node tools/pixel-planets-samples.cjs <本机EXE绝对路径> <不存在的独立输出目录绝对路径>`。

`python tools/pixel-planets-review.py <样片目录> [复现目录]`。审查板使用已有Pillow和系统字体，不安装依赖；同机器/Godot/显卡驱动环境复现，不能承诺不同显卡着色结果逐像素一致。

EXE和第三方整仓不入游戏，运行时不调用Godot、图片API或远程素材。
