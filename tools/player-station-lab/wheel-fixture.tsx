import { StrictMode, useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Building2, Factory, FlaskConical, GraduationCap, HeartPulse, Pickaxe, Zap } from 'lucide-react'
import { PlayerStationWheelMenu } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationWheelMenu'
import type { StationInputMode, StationWheelOption } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationWheelMenu'
import { TooltipLayer } from '../../apps/desktop/src/renderer/src/ui/Tooltip'
import { MaterialBill } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationDetails'
import { text } from './text'
import './styles.css'
import '../../apps/desktop/src/renderer/src/features/stations/playerStation.css'

// 仅测按钮数量与几何，不导入模块状态，也不提供可建造的样例设施。
const NAMES = ['发电设施', '生命维持', '服务中心', '精炼设施', '研究设施', '基础培训设施', '资源开采设施']
const ICONS = [Zap, HeartPulse, Building2, Factory, FlaskConical, GraduationCap, Pickaxe]
const BILL = Array.from({ length: 8 }, (_, index) => ({ itemId: `fixture-${index}`, itemName: `测试材料${index + 1}`, need: 125000, available: 100000 }))

function Fixture() {
  const params = new URLSearchParams(window.location.search)
  const count = Math.max(3, Math.min(7, Number(params.get('count')) || 7))
  const missing = params.has('missing')
  const anchor = useRef<HTMLButtonElement>(null)
  const mode = useRef<StationInputMode>('keyboard')
  const [open, setOpen] = useState(false)
  const [built, setBuilt] = useState('')
  const close = useCallback(() => { setOpen(false); anchor.current?.focus({ preventScroll: true }) }, [])
  const options: StationWheelOption[] = NAMES.slice(0, count).map((name, index) => ({
    id: `fixture-${index}`, slot: index as StationWheelOption['slot'], name, Icon: ICONS[index],
    buildLabel: `选择${name}`, unavailable: missing && index === 2 ? '测试材料不足' : undefined,
    details: <div className="app-player-station-facility-detail" data-facility-detail={`fixture-${index}`}>
      <h4 className="app-player-station-title">{name}</h4>
      <p>纯界面测试样例，不建设设施、不扣材料。</p>
      <dl className="app-player-station-specs">
        <div><dt>占地</dt><dd>1 地块</dd></div><div><dt>工期</dt><dd>60 分钟</dd></div>
        <div><dt>施工耗电</dt><dd>4</dd></div><div><dt>运行耗电</dt><dd>6</dd></div>
      </dl>
      <MaterialBill facility rows={BILL} text={text} />
    </div>,
  }))
  return <div className="station-lab">
    <header className="lab-header"><h1>轮盘布局测试 · {count} 项</h1><span>纯界面样例 · 不含游戏状态</span></header>
    <main className="lab-station-window">
      <button ref={anchor} type="button" className="app-btn" data-wheel-anchor
        onPointerDown={(event) => { mode.current = event.pointerType === 'touch' ? 'touch' : 'mouse' }}
        onKeyDown={() => { mode.current = 'keyboard' }} onClick={() => setOpen(true)}>地块 1</button>
      <output data-fixture-built>{built}</output>
    </main>
    {open && anchor.current && <PlayerStationWheelMenu anchor={anchor.current} options={options} inputMode={mode.current}
      title="地块 1" groupLabel="测试建筑" detailLabel="测试详情" closeLabel="关闭建造轮盘" onClose={close} onBuild={setBuilt} />}
    <TooltipLayer />
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
