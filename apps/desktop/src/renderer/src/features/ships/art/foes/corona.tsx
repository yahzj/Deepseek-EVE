import { poly, pod, s, line, nozzle, box, bridge } from './primitives'


export const R_GLINT = (
  <>
    <path d={poly([226, 64], [188, 54], [112, 56], [96, 62], [96, 68], [112, 74], [188, 74])} />
    <path className="shipart-acc" d={pod(150, 64, 10, 13)} />
    <path className="shipart-accf" d={pod(150, 64, 2.6, 3.2)} />
    <path className="shipart-panel" d={s(line([116, 60], [184, 60]), line([116, 68], [184, 68]))} />
    <path d={s(poly([128, 56], [146, 46], [152, 50], [136, 57]), poly([128, 72], [146, 82], [152, 78], [136, 71]))} />
    <path className="shipart-accf" d={pod(220, 64, 3.4, 2.6)} />
    <path d={nozzle(60, 58, 8, 12)} />
  </>
)

export const R_ECHO = (
  <>
    <path d={poly([230, 64], [206, 56], [104, 57], [86, 64], [104, 71], [206, 72])} />
    <path className="shipart-acc" d={s(pod(150, 64, 8, 11), pod(178, 64, 6.5, 9))} />
    <path className="shipart-accf" d={s(pod(150, 64, 2.2, 2.8), pod(178, 64, 1.8, 2.3))} />
    <path className="shipart-panel" d={s(line([100, 60], [198, 60]), line([100, 68], [198, 68]), line([124, 57], [124, 71]))} />
    <path d={s(poly([116, 57], [138, 49], [145, 53], [126, 58]), poly([116, 71], [138, 79], [145, 75], [126, 70]))} />
    <path className="shipart-accf" d={pod(224, 64, 3.2, 2.4)} />
    <path d={s(nozzle(70, 54, 8, 10), nozzle(70, 66, 8, 10))} />
  </>
)

export const R_OVERLAY = (
  <>
    <path d={poly([228, 64], [200, 52], [108, 52], [92, 60], [92, 74], [110, 82], [200, 76])} />
    <path className="shipart-acc" d={s(pod(146, 62, 9, 13), pod(162, 64, 9, 13), pod(178, 66, 9, 13))} />
    <path className="shipart-accf" d={s(pod(146, 62, 2.4, 3), pod(162, 64, 2.4, 3), pod(178, 66, 2.4, 3))} />
    <path className="shipart-panel" d={s(line([100, 58], [196, 58]), line([100, 76], [196, 76]), line([120, 52], [120, 80]))} />
    <path d={box(200, 58, 12, 12)} />
    <path d={poly([212, 61], [226, 62], [226, 66], [212, 67])} />
    <path className="shipart-accf" d={pod(225, 64, 2.2, 2.2)} />
    <path d={s(nozzle(78, 52, 8, 10), nozzle(78, 62, 8, 10), nozzle(78, 72, 8, 10))} />
  </>
)

export const R_DUSK = (
  <>
    <path d={poly([236, 64], [212, 54], [100, 52], [68, 58], [60, 70], [70, 82], [102, 88], [212, 86], [236, 74])} />
    {/* 背脊护盾阵列：一条**连续装甲脊**（三块发射板 + 板间缝 + 族色脊线） */}
    <path d={poly([112, 52], [206, 48], [210, 53], [206, 55], [112, 56])} />
    <path className="shipart-panel" d={s(line([144, 51], [144, 55]), line([176, 49], [176, 54]))} />
    <path className="shipart-acc" d={s(line([118, 49], [138, 47]), line([150, 47], [170, 45]), line([182, 45], [202, 44]))} />
    {/* 两舷大斜盾板（"待机护盾"的正面读法：斜插的整块护盾板） */}
    <path d={s(poly([90, 56], [124, 50], [127, 64], [90, 66]), poly([90, 80], [124, 86], [127, 72], [90, 70]))} />
    <path className="shipart-panel" d={s(line([96, 56], [96, 66]), line([96, 74], [96, 80]), line([110, 52], [112, 62]))} />
    {/* 舰艏钝头装甲前脸 + 双透镜 */}
    <path d={poly([228, 54], [236, 58], [236, 70], [228, 74])} />
    <path className="shipart-accf" d={s(pod(233, 59, 2.8, 2.2), pod(233, 69, 2.8, 2.2))} />
    {/* 低矮舰体的厚甲面板（横向长线为主 —— 读"战列线"） */}
    <path className="shipart-panel" d={s(line([84, 60], [218, 60]), line([84, 78], [218, 78]), line([140, 52], [140, 88]), line([184, 49], [184, 88]))} />
    <path d={s(nozzle(52, 53, 9, 9), nozzle(52, 63, 9, 9), nozzle(52, 73, 9, 9), nozzle(52, 83, 9, 9))} />
  </>
)

export const R_NEXUS = (
  <>
    <path d={poly([238, 70], [214, 56], [166, 52], [156, 44], [140, 44], [130, 52], [104, 52], [88, 58], [78, 68], [82, 86], [104, 96], [206, 94], [238, 84])} />
    {/* 城堡式核心塔（两层递收）＋ 塔顶大光环（族徽件）—— 塔与环是**旗舰专属** */}
    <path d={bridge(132, 180, 52, [{ h: 13, i: 5 }, { h: 10, i: 6 }])} />
    <path className="shipart-acc" d={pod(156, 17, 34, 11)} />
    <path className="shipart-panel" d={pod(156, 17, 26, 8)} />
    <path className="shipart-accf" d={pod(156, 17, 3, 3)} />
    {/* 舰艏三叉戟：基座块 + **张开的三根光束叉**（叉尖 = 三个炮口；与 T4 的"平置双透镜"正面区分） */}
    <path d={box(210, 52, 12, 28)} />
    <path className="shipart-panel" d={line([216, 52], [216, 80])} />
    <path d={s(poly([222, 58], [238, 52], [238, 56], [222, 61]), poly([222, 63], [238, 64], [238, 69], [222, 67]), poly([222, 74], [238, 80], [238, 76], [222, 71]))} />
    <path className="shipart-accf" d={s(pod(236, 53, 2.4, 2), pod(236, 66, 2.4, 2), pod(236, 79, 2.4, 2))} />
    {/* 舷侧立柱（把体量往上抬 —— 与 T4 的"低"形成比例正对照：本档短而高） */}
    <path d={s(poly([112, 52], [120, 30], [128, 32], [124, 54]), poly([184, 50], [194, 28], [201, 30], [196, 52]))} />
    {/* 龙骨环列（三枚小环 —— 旗舰的"多环中枢"读法） */}
    <path className="shipart-acc" d={s(pod(120, 72, 6, 8), pod(152, 72, 6, 8), pod(184, 72, 6, 8))} />
    <path className="shipart-panel" d={s(line([96, 64], [204, 64]), line([96, 84], [204, 84]), line([140, 44], [140, 96]), line([176, 50], [176, 94]))} />
    <path d={s(nozzle(66, 52, 9, 13), nozzle(66, 70, 9, 13), nozzle(80, 52, 9, 13), nozzle(80, 70, 9, 13))} />
  </>
)
