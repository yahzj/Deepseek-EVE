/** 功能域职责拆分，保持原计算与顺序。 */
import { poly, s, hex, line, box, turret, nozzle, pod, cyl } from './primitives'

/** ㉑ 围攻残兵舰（T1 / orbit）：最小蜂窝艇 + 两侧补丁帆 + 单喷口 + 前部小炮（族内最简） */
export const G_SKIFF = (
  <>
    <path d={poly([72, 44], [130, 44], [152, 52], [152, 76], [130, 84], [72, 84], [60, 70], [60, 58])} />
    <path className="shipart-panel" d={s(hex(84, 64, 9), hex(106, 64, 9), hex(128, 64, 9))} />
    <path d={hex(106, 64, 9)} />
    <path d={s(line([76, 44], [70, 28], [140, 28], [140, 44]))} />
    <path className="shipart-panel" d={s(box(84, 32, 8, 6), box(120, 32, 8, 6))} />
    <path d={turret(140, 58, 10, 6, 14, 61)} />
    <path d={nozzle(50, 58, 8, 14)} />
  </>
)

/** ㉒ 残响残舰（T2 / orbit）：更宽蜂窝 + **断掉一半的补丁帆** + 通讯桅 + 细长艏炮 */
export const G_ECHO = (
  <>
    <path d={poly([64, 42], [142, 42], [166, 50], [166, 78], [142, 86], [64, 86], [50, 68], [50, 56])} />
    <path className="shipart-panel" d={s(hex(76, 64, 9), hex(98, 64, 9), hex(120, 64, 9), hex(142, 64, 9))} />
    <path d={s(hex(98, 64, 9), hex(120, 64, 9))} />
    <path d={s(line([70, 42], [64, 26], [118, 26], [118, 42]))} />
    <path className="shipart-panel" d={s(box(72, 30, 8, 6), box(88, 30, 8, 6))} />
    <path d={s(line([130, 42], [138, 22]))} />
    <path className="shipart-acc" d={line([130, 42], [126, 24])} />
    <path className="shipart-accf" d={pod(138, 19, 4, 3)} />
    <path d={s(box(150, 56, 20, 4), box(160, 60, 10, 4))} />
    <path d={s(nozzle(42, 58, 8, 12), nozzle(42, 44, 8, 10))} />
  </>
)

/** ㉓ 天底封锁舰（T3 / orbit）：**背部大封锁环**（族内唯一）+ 航向稳定鳍 + 重炮，蜂窝更密 */
export const G_NADIR = (
  <>
    <path d={poly([60, 38], [150, 38], [176, 48], [176, 82], [150, 92], [60, 92], [46, 74], [46, 56])} />
    <path className="shipart-panel" d={s(hex(72, 65, 10), hex(96, 65, 10), hex(120, 65, 10), hex(144, 65, 10), hex(84, 45, 7), hex(108, 45, 7), hex(84, 85, 7), hex(108, 85, 7))} />
    <path d={s(hex(120, 65, 10), hex(96, 65, 10))} />
    <path className="shipart-acc" d={`M116 46 Q116 18 152 18 Q188 18 188 46`} />
    <path className="shipart-accf" d={pod(152, 16, 7, 5)} />
    <path d={s(line([116, 46], [116, 38]), line([188, 46], [188, 38]))} />
    <path className="shipart-panel" d={s(line([46, 56], [34, 48]), line([46, 74], [34, 82]))} />
    <path d={turret(150, 44, 16, 8, 22, 48)} />
    <path d={s(nozzle(38, 48, 8, 12), nozzle(38, 70, 8, 12))} />
  </>
)

/** ㉔ 残军补给舰（T3 / orbit）：**长圆柱 + 外露肋环 + 腹部吊挂补给舱 + 尾部双燃料罐**（族内唯一非蜂窝主舱） */
export const G_TENDER = (
  <>
    <path d={s(cyl(44, 176, 46, 82, [66, 90, 114, 138, 160]))} />
    <path className="shipart-panel" d={s([[44, 56], [176, 56]], [[44, 72], [176, 72]])} />
    <path d={poly([176, 46], [196, 54], [196, 74], [176, 82])} />
    <path className="shipart-accf" d={pod(188, 64, 5, 7)} />
    <path d={s(box(80, 82, 56, 22))} />
    <path className="shipart-panel" d={s([[108, 82], [108, 104]], [[80, 92], [136, 92]])} />
    <path className="shipart-volt-g" d={box(84, 96, 20, 6)} />
    <path d={s(line([96, 82], [94, 74]), line([120, 82], [120, 74]), line([86, 82], [84, 74]), line([130, 82], [132, 74]))} />
    <path d={s(box(64, 32, 22, 14), box(104, 32, 22, 14))} />
    <path className="shipart-panel" d={s([[70, 36], [80, 36]], [[110, 36], [120, 36]])} />
    <path d={nozzle(34, 56, 10, 18)} />
  </>
)

/** ㉕ 亡军战列舰（T4 / orbit）：族内最大 —— **多层蜂窝 + 两座主炮塔 + 补给栈桥 + 三喷口** */
export const G_EXILE = (
  <>
    <path d={poly([54, 32], [166, 32], [190, 42], [196, 54], [196, 76], [186, 88], [166, 96], [54, 96], [40, 78], [40, 50])} />
    <path className="shipart-panel" d={s(hex(64, 48, 9), hex(88, 48, 9), hex(112, 48, 9), hex(136, 48, 9), hex(160, 48, 9), hex(64, 84, 9), hex(88, 84, 9), hex(112, 84, 9), hex(136, 84, 9), hex(160, 84, 9), hex(88, 66, 9), hex(112, 66, 9), hex(136, 66, 9))} />
    <path d={s(hex(112, 66, 9), hex(136, 66, 9), hex(88, 66, 9))} />
    <path d={s(line([70, 32], [66, 22], [156, 22], [150, 32]))} />
    <path className="shipart-panel" d={s(box(84, 24, 10, 6), box(126, 24, 10, 6))} />
    <path d={s(turret(96, 24, 18, 8, 22, 28), turret(148, 24, 18, 8, 22, 28))} />
    <path className="shipart-acc" d={line([112, 32], [112, 22])} />
    <path d={s(box(180, 60, 22, 18))} />
    <path className="shipart-panel" d={line([186, 64], [196, 64])} />
    <path d={s(nozzle(32, 40, 8, 14), nozzle(32, 60, 8, 14), nozzle(32, 80, 8, 14))} />
  </>
)
