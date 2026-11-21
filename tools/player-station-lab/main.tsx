import { StrictMode, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, ArrowUpFromLine, Clock3, FlaskConical, RotateCcw, Save, Warehouse } from 'lucide-react'
import { PlayerStationPanel } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationPanel'
import { PlayerStationPopulationPanel } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationPopulationPanel'
import { PlayerStationTrainingPanel } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationTrainingPanel'
import { PlayerStationRefiningPanel } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationRefiningPanel'
import { PlayerStationMiningPanel } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationMiningPanel'
import { PlayerStationResearchPanel } from '../../apps/desktop/src/renderer/src/features/stations/PlayerStationResearchPanel'
import { TooltipLayer } from '../../apps/desktop/src/renderer/src/ui/Tooltip'
import { PLAYER_FACILITIES, PLAYER_STATION_BODY_MS, STATION_FIRST_RESEARCH } from '../../packages/core/src/playerStation/index'
import { LabModel, MATERIAL_IDS, MAX_SNAPSHOT_BYTES, initialInventory, materialInfo } from './model'
import { text } from './text'
import { REFINING_ITEMS, refiningRecipe } from './refining-baseline'
import { MINER_ID, MINING_BELTS } from './mining-baseline'
import { OperationsPanel } from './OperationsPanel'
import { StageTwoSession } from './StageTwoSession'
import { StageCrewPanel } from './StageCrewPanel'
import { StageSecurityPanel } from './StageSecurityPanel'
import { StageGoalsPanel } from './StageGoalsPanel'
import { SECURITY_SHIPS } from './security-baseline'
import { stageLabel } from './stageTwoText'
import './styles.css'

const NUMBER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const REASONS: Readonly<Record<string, string>> = {
  'invalid-state': '状态无效', 'invalid-action': '操作无效', busy: '该地块已有施工项目',
  'body-required': '主体尚未建成', 'no-project': '没有可操作的施工项目',
  'invalid-cell': '地块无效或已占用', materials: '预览库存不足', power: '供电不足',
  engineer: '没有可用于施工的基础工程师',
}
type Notice = { id: number; message: string; error: boolean }
const sum = (bill: Record<string, number>) => Object.values(bill).reduce((total, amount) => total + amount, 0)

function Lab() {
  const [session, setSession] = useState(() => new StageTwoSession())
  const model = session.base
  const [, redraw] = useReducer((value: number) => value + 1, 0)
  const [shipment, setShipment] = useState<Record<string, number>>(() => Object.fromEntries(new LabModel().view().bill.map((row) => [row.itemId, row.remaining])))
  const [snapshot, setSnapshot] = useState('')
  const [notices, setNotices] = useState<Notice[]>([])
  const [panelKey, resetPanel] = useReducer((value: number) => value + 1, 0)
  const view = model.view()
  const inventory = model.inventoryView()
  const inventoryValue = MATERIAL_IDS.reduce((total, id) => total + (inventory[id] ?? 0) * materialInfo(id).price, 0)
  const inventoryVolume = MATERIAL_IDS.reduce((total, id) => total + (inventory[id] ?? 0) * materialInfo(id).unitM3, 0)

  function notify(message: string, error = false) {
    setNotices((previous) => [{ id: (previous[0]?.id ?? 0) + 1, message, error }, ...previous].slice(0, 12))
  }

  function run(operation: () => string) {
    try { notify(operation()) } catch (error) { notify(error instanceof Error ? error.message : String(error), true) }
    session.reconcile()
    redraw()
  }

  function applySnapshot() {
    try {
      const imported = StageTwoSession.load(snapshot)
      setSession(imported)
      setShipment({})
      resetPanel()
      notify('已导入独立快照；预览库存与模块状态一并恢复')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), true) }
  }

  function exportSnapshot(download = false) {
    run(() => {
      const output = session.snapshot()
      setSnapshot(output)
      if (download) {
        const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'player-station-preview.json'
        anchor.click()
        URL.revokeObjectURL(url)
      }
      return '已导出独立快照；不含正式游戏存档'
    })
  }

  return <div className="station-lab">
    <header className="lab-header">
      <div className="lab-brand"><FlaskConical size={23} aria-hidden="true" /><h1>玩家空间站</h1><span>经营／舰员／区域安全预览</span></div>
      <span className="lab-boundary">内存沙盒 · 合成库存与副船</span>
    </header>
    <div className="lab-toolbar">
      <div className="lab-controls" role="group" aria-label="手动时间推进">
        <span className="lab-clock"><Clock3 size={16} aria-hidden="true" />模块时间 {NUMBER.format(model.station.clockMs / 60_000)} 分钟</span>
        {([1, 15, 60] as const).map((minutes) => <button key={minutes} type="button" className="app-btn" onClick={() => run(() => {
          session.advance(minutes)
          return `手动推进 ${minutes} 分钟`
        })}><Clock3 size={14} aria-hidden="true" />+{minutes} 分钟</button>)}
      </div>
      <div className="lab-controls">
        <label className="lab-engineering">建筑工程学
          <select aria-label="建筑工程学等级" value={model.engineering} onChange={(event) => run(() => {
            model.setEngineering(Number(event.target.value))
            return `工程学已设为 ${model.engineering}；已开工项目保持原锁料账`
          })}>{[0, 1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}</select>
        </label>
        <button type="button" className="app-btn is-warn" onClick={() => {
          if (!window.confirm('重置本次预览？未导出的独立状态将丢失，正式游戏不受影响。')) return
          const next = new LabModel()
          setSession(new StageTwoSession(next))
          setShipment(Object.fromEntries(next.view().bill.map((row) => [row.itemId, row.remaining])))
          setSnapshot('')
          resetPanel()
          notify('已重置独立预览')
        }}><RotateCcw size={14} aria-hidden="true" />重置</button>
      </div>
    </div>
    <main className="lab-workspace">
      <div className="lab-station-window" aria-label="空间站展示组件">
        <PlayerStationPanel key={panelKey} view={view} text={text}
          onCommand={(action) => {
            try {
              const result = model.command(action)
              if (result.ok) notify(`操作完成：${action.kind}`)
              else notify(`操作被拒绝：${REASONS[result.reason ?? ''] ?? result.reason ?? '未知原因'}`, true)
            } catch (error) { notify(error instanceof Error ? error.message : String(error), true) }
            redraw()
          }}
          onDeliver={() => run(() => {
            if (sum(shipment) === 0) return '本次到货数量为空，未扣预览库存'
            const result = model.deliver(shipment)
            if (!result.ok) throw new Error('本次到货整单库存不足，未扣除任何预览物料')
            return `模拟到货：接收 ${NUMBER.format(sum(result.accepted))}，拒收 ${NUMBER.format(sum(result.rejected))}；拒收原物留在预览库存`
          })}
          onRecover={() => run(() => `已回收到预览库存：${NUMBER.format(sum(model.recover()))} 单位`)} />
        <PlayerStationPopulationPanel view={model.populationView()} training={model.trainingView()} construction={view.projects} refining={model.refining.runs} mining={model.mining.runs} research={model.research.assignment}
          additionalOccupations={[
            ...model.development.projects.flatMap(project => project.engineerIndices.map(personIndex => ({ personIndex, label: '站体工程占用' }))),
            ...(model.academy.active ? [{ personIndex: model.academy.active.personIndex, label: '培训中心受训' }] : []),
            ...model.manufacturing.runs.flatMap(task => task.personIndex === undefined ? [] : [{ personIndex: task.personIndex, label: '站内制造占用' }]),
            ...session.crew.teams.flatMap(team => team.members.map(personIndex => ({ personIndex, label: `${team.name} · ${stageLabel(team.activity)}` }))),
          ]} ships={model.ships} text={text}
          onCommand={action => run(() => {
            const result = model.populationCommand(action)
            return result.ok ? '人口计划已更新' : `人口操作被拒绝：${result.reason}`
          })} />
        <PlayerStationTrainingPanel key={`training-${panelKey}`} view={model.trainingView()} text={text}
          onCommand={action => run(() => {
            const result = model.trainingCommand(action)
            if (!result.ok) throw new Error(text(`ui.playerStation.training.error.${result.reason}`))
            return text('ui.playerStation.training.updated')
          })} />
        <PlayerStationRefiningPanel key={`refining-${panelKey}`} view={model.refiningView()} text={text} itemName={model.host.itemName}
          facilities={view.cells.filter(cell => cell.kind === 'refinery').map(cell => cell.cellIndex)}
          people={model.population.people.flatMap((person, index) => person.status === 'resident' ? [{ index,
            available: model.refiningHost.personAvailable(index) && !model.refining.runs.some(run => run.personIndex === index) }] : [])}
          recipes={REFINING_ITEMS.map(item => ({ id: item.id, name: item.name, ...refiningRecipe(item.id, model.refiningLevel)! }))}
          onCommand={action => run(() => {
            const result = model.refiningCommand(action)
            if (!result.ok) throw new Error(text(`ui.playerStation.refining.error.${result.reason}`))
            return text('ui.playerStation.refining.updated')
          })} />
        <PlayerStationMiningPanel key={`mining-${panelKey}`} view={model.miningView()} text={text} itemName={model.host.itemName}
          ships={model.ships.filter(ship => ship.id === MINER_ID).map(ship => ({ ...ship, capacityM3: ship.freeM3 }))}
          people={model.population.people.flatMap((person, index) => person.status === 'resident' ? [{ index,
            available: model.miningHost.personAvailable(index) && !model.mining.runs.some(run => run.personIndex === index) }] : [])}
          belts={MINING_BELTS.map(belt => ({ id: belt.id, name: belt.name }))}
          onCommand={action => run(() => {
            const result = model.miningCommand(action)
            if (!result.ok) throw new Error(text(`ui.playerStation.mining.error.${result.reason}`))
            return text('ui.playerStation.mining.updated')
          })} />
        <PlayerStationResearchPanel key={`research-${panelKey}`} view={model.researchView()} text={text}
          facilities={view.cells.filter(cell => cell.kind === 'research').map(cell => cell.cellIndex)}
          people={model.researchHost.researchers().map(index => ({ index, available: model.researchHost.personAvailable(index) }))}
          onCommand={action => run(() => {
            const result = model.researchCommand(action)
            if (!result.ok) throw new Error(text(`ui.playerStation.science.error.${result.reason}`))
            return text('ui.playerStation.science.updated')
          })} />
        <OperationsPanel key={`operations-${panelKey}`} model={model} run={run} />
        <StageCrewPanel key={`crew-${panelKey}`} view={session.crewView()}
          ships={SECURITY_SHIPS.map(ship => ({ ...ship, available: session.combatShips.find(entry => entry.id === ship.id)!.available }))}
          onCommand={action => run(() => {
            const result = session.crewCommand(action)
            if (!result.ok) throw new Error(stageLabel(result.reason))
            return '舰员团队安排已更新'
          })} />
        <StageSecurityPanel key={`security-${panelKey}`} view={session.securityView()}
          teams={session.crew.teams.map(team => ({ id: team.id, name: team.name, available: session.securityHost.team(team.id)?.available ?? false }))}
          sourceName={id => session.sourceName(id)} onCommand={action => run(() => {
            const result = session.securityCommand(action)
            if (!result.ok) throw new Error(stageLabel(result.reason))
            return '外派与守备安排已更新'
          })} />
        <StageGoalsPanel state={session.campaign} host={session.campaignHost} onDeclare={() => run(() => {
          const result = session.declare()
          if (!result.ok) throw new Error(stageLabel(result.reason ?? 'invalid-action'))
          return '自主据点已建立；原资产与协会关系保持'
        })} />
      </div>
      <aside className="lab-inspector" aria-label="开发控制台">
        <section aria-label="第二阶段合成输入"><h2><FlaskConical size={17} />舰员与战斗测试输入</h2>
          <span className="app-dim">独立合成舰船：{SECURITY_SHIPS.map(ship => ship.name).join('、')}。不写正式舰队；三处来源复用既有异常卡和战斗引擎。</span>
        </section>
        <section className="lab-research-input">
          <h2><FlaskConical size={17} aria-hidden="true" />科研测试参数</h2>
          <span className="app-dim">首项研究有效工时 {STATION_FIRST_RESEARCH.durationMs / 60_000} 分钟。科研不直接建造，扩站与升级需要实际材料、工程师和供电。六项科研不收试验材料。</span>
          <div className="lab-controls">{view.cells.filter(cell => ['power', 'life-support', 'service'].includes(cell.kind)).map(cell => <button key={cell.cellIndex} className="app-btn" disabled={cell.damaged}
            onClick={() => run(() => { model.damageFacility(cell.cellIndex); return `已模拟地块 ${cell.cellIndex + 1} 保障故障` })}>模拟故障：地块 {cell.cellIndex + 1}</button>)}</div>
        </section>
        <section className="lab-mining-input">
          <h2><FlaskConical size={17} aria-hidden="true" />采矿测试输入</h2>
          <label className="lab-controls">采矿相关技能统一等级<select aria-label="采矿测试技能等级" value={model.miningLevel}
            disabled={model.ships.some(ship => !ship.available)}
            onChange={event => run(() => { model.setMiningLevel(Number(event.target.value)); return '已更新合成采矿技能输入' })}>
            {[0, 1, 2, 3, 4, 5].map(level => <option key={level} value={level}>{level}</option>)}
          </select></label>
          <span className="app-dim">合成磷虾矿船 · 双MK1采集器 · 已开放本站磷光霾场 · 不使用跃迁燃料</span>
        </section>
        <section className="lab-refining-input">
          <h2><FlaskConical size={17} aria-hidden="true" />精炼测试输入</h2>
          <label className="lab-controls">精炼相关技能统一等级<select aria-label="精炼测试技能等级" value={model.refiningLevel}
            onChange={event => run(() => { model.setRefiningLevel(Number(event.target.value)); return '已更新合成技能输入，既有批量/周期保持开工取值' })}>
            {[0, 1, 2, 3, 4, 5].map(level => <option key={level} value={level}>{level}</option>)}
          </select></label>
        </section>
        <section className="lab-population-input" aria-label="合成人口输入">
          <h2><FlaskConical size={17} aria-hidden="true" />人口测试输入</h2>
          <label className="lab-controls"><input type="checkbox" checked={model.sourceKnown} disabled={model.sourceKnown}
            aria-label="模拟发现古代休眠站" onChange={() => { model.sourceKnown = true; redraw() }} />模拟发现古代休眠站</label>
          <label className="lab-controls">副船可用余舱 m³<input type="number" min={0} max={1_000_000} value={model.ships[0].freeM3}
            disabled={!model.ships[0].available} aria-label="合成副船有效余舱" onChange={event => {
              const amount = event.target.valueAsNumber
              if (Number.isSafeInteger(amount) && amount >= 0 && amount <= 1_000_000) { model.ships[0].freeM3 = amount; redraw() }
            }} /></label>
          <span className="app-dim">副船位置：{model.ships[0].location === 'home' ? '玩家站' : model.ships[0].location === 'source' ? '来源站' : '其他'} · {model.ships[0].available ? '空闲' : '任务占用'}</span>
        </section>
        <section className="lab-inventory" aria-labelledby="inventory-title">
          <div className="lab-section-head"><h2 id="inventory-title"><Warehouse size={17} aria-hidden="true" />预览库存</h2>
            <button type="button" className="app-btn lab-icon-button" title="恢复预览初始库存" aria-label="恢复预览初始库存" onClick={() => run(() => {
              const initial = initialInventory()
              for (const id of MATERIAL_IDS) model.setInventory(id, initial[id] ?? 0)
              return '已恢复预览初始库存；站体与施工状态未改变'
            })}><RotateCcw size={15} aria-hidden="true" /></button>
          </div>
          <dl className="lab-totals"><div><dt>静态参考价值</dt><dd>{NUMBER.format(inventoryValue)} 信用点</dd></div><div><dt>库存体积</dt><dd>{NUMBER.format(inventoryVolume)} m³</dd></div></dl>
          <div className="lab-inventory-scroll">
            <table className="lab-inventory-table"><thead><tr><th scope="col">材料</th><th scope="col">库存</th><th scope="col">本次到货</th></tr></thead>
              <tbody>{MATERIAL_IDS.map((id) => {
                const item = materialInfo(id)
                return <tr key={id}><th scope="row">{item.name}<small>{NUMBER.format(item.price)} 信用点 / {NUMBER.format(item.unitM3)} m³</small></th>
                  <td><input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} aria-label={`${item.name}预览库存`} value={inventory[id] ?? 0}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber
                      if (!Number.isSafeInteger(value) || value < 0) return
                      model.setInventory(id, value)
                      redraw()
                    }} /></td>
                  <td><input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} aria-label={`${item.name}本次到货`} value={shipment[id] ?? 0}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber
                      if (!Number.isSafeInteger(value) || value < 0) return
                      setShipment((previous) => ({ ...previous, [id]: value }))
                    }} /></td>
                </tr>
              })}</tbody>
            </table>
          </div>
          <div className="lab-controls"><button type="button" className="app-btn" disabled={view.built} onClick={() => setShipment(Object.fromEntries(view.bill.map((row) => [row.itemId, row.remaining])))}>
            <ArrowDownToLine size={14} aria-hidden="true" />填入主体缺口</button>
            <button type="button" className="app-btn" onClick={() => setShipment({})}><RotateCcw size={14} aria-hidden="true" />清空到货单</button></div>
        </section>
        <section className="lab-snapshots" aria-labelledby="snapshot-title">
          <h2 id="snapshot-title"><Save size={17} aria-hidden="true" />独立快照</h2>
          <div className="lab-controls">
            <button type="button" className="app-btn" onClick={() => exportSnapshot()}><ArrowUpFromLine size={14} aria-hidden="true" />导出</button>
            <button type="button" className="app-btn" onClick={() => exportSnapshot(true)}><ArrowDownToLine size={14} aria-hidden="true" />下载</button>
            <label className="lab-file-label">读取文件<input type="file" accept=".json,application/json" aria-label="读取独立快照文件" onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              if (file.size > MAX_SNAPSHOT_BYTES) { notify('快照超过 2 MiB', true); return }
              try { setSnapshot(await file.text()) } catch { notify('无法读取快照文件', true) }
            }} /></label>
          </div>
          <textarea aria-label="独立快照 JSON" value={snapshot} spellCheck={false} onChange={(event) => setSnapshot(event.target.value)} />
          <button type="button" className="app-btn" disabled={!snapshot.trim()} onClick={applySnapshot}><ArrowDownToLine size={14} aria-hidden="true" />导入独立快照</button>
        </section>
        <section className="lab-log" aria-labelledby="log-title">
          <h2 id="log-title">操作反馈</h2>
          <div className="lab-live" role="status" aria-live="polite" aria-atomic="true">{notices[0]?.message ?? '尚无操作'}</div>
          <ol>{notices.slice(1).map((notice) => <li key={notice.id} className={notice.error ? 'is-error' : undefined}>{notice.message}</li>)}</ol>
        </section>
      </aside>
    </main>
    <footer className="lab-footer">测试工期：主体 {PLAYER_STATION_BODY_MS / 60_000} 分钟；设施 {Object.values(PLAYER_FACILITIES).map((facility) => facility.durationMs / 60_000).join(' / ')} 分钟 · 仅手动推进 · 合成库存与副船 · 非正式游戏存档</footer>
    <TooltipLayer />
  </div>
}

const root = document.getElementById('root')
if (!root) throw new Error('预览挂载节点缺失')
createRoot(root).render(<StrictMode><Lab /></StrictMode>)
