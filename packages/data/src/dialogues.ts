/**
 * T9 通讯剧本（对话系统 v1：线性文本流；一次性完整呈现，逐句镜像进事件日志）。
 * 触发：建站点首次抵达自动播放介绍（D3甲：已读后不再自动触发；任务卡可随时重看）。
 */
import type { DialogueScriptDef } from '@whale/core'

/** 全量剧本（id 稳定；重看/已读按 id 记录） */
export const DIALOGUES: readonly DialogueScriptDef[] = [
  {
    id: 'dlg-redring-intro',
    title: '深空工业协会 · 基建部',
    lines: [
      { speaker: '基建部 · 柯岚', text: '飞行员，能收到吗？红环这地方终于有人闯进来了。' },
      { speaker: '基建部 · 柯岚', text: '长话短说：协会想在红环航道立一座前哨站——就是你现在看到的这片星域。' },
      { speaker: '基建部 · 柯岚', text: '建材就地取材：希莫非特与灼烧岩，红环危机带里到处都是。' },
      { speaker: '基建部 · 柯岚', text: '分三档交付：奠基、完善、建成。每交完一档，站里就多开放一项服务，边交边生效。' },
      { speaker: '基建部 · 柯岚', text: '先把建材运到站址——开工后的第一批服务是停靠与卸货。协会会记住你这份功绩。' },
    ],
  },
  {
    id: 'dlg-redring-done',
    title: '深空工业协会 · 基建部',
    lines: [
      { speaker: '基建部 · 柯岚', text: '信号稳定了——红环前哨站，全功率运行。' },
      { speaker: '基建部 · 柯岚', text: '从今天起，这片航线的矿船、维修、补给都绕不开你的名字了。' },
      { speaker: '基建部 · 柯岚', text: '红环前哨站已并入协会空间站网络。去停靠区看看吧——那是你建起来的。' },
    ],
  },
  {
    id: 'dlg-cinder-intro',
    title: '深空工业协会 · 基建部',
    lines: [
      { speaker: '基建部 · 沈灼', text: '烬火……能见度这么差的地方，难得有船敢摸进来。' },
      { speaker: '基建部 · 沈灼', text: '协会在这片高危采集区批了一座前哨站，建材用蓝霜冰——冰层致密，就地开采最划算。' },
      { speaker: '基建部 · 沈灼', text: '照老规矩分三档交。奠基那档交完就能停靠卸货，后面逐步开放维修、补给与换船。' },
      { speaker: '基建部 · 沈灼', text: '这片灰烬里的第一盏灯，就交给你点了。' },
    ],
  },
  {
    id: 'dlg-cinder-done',
    title: '深空工业协会 · 基建部',
    lines: [
      { speaker: '基建部 · 沈灼', text: '灯亮了。烬火前哨站，正式并网。' },
      { speaker: '基建部 · 沈灼', text: '这片星域最挑剔的采集点，从此有了自己的补给线。' },
      { speaker: '基建部 · 沈灼', text: '灰烬里点灯的人——协会会一直记得你。' },
    ],
  },
]

/** 剧本目录 */
export function buildDialogueCatalog(): ReadonlyMap<string, DialogueScriptDef> {
  return new Map(DIALOGUES.map((d) => [d.id, d]))
}
