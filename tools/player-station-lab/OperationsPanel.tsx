import { useState } from 'react'
import { Factory, GraduationCap, Hammer, Pause, Play, Radar, X } from 'lucide-react'
import type { LabModel } from './model'
import { materialInfo } from './model'
import { MANUFACTURING_RECIPES } from './manufacturing-baseline'

const NAMES = { expand: '首次扩站 3×3 → 4×4', 'power-upgrade': '发电首轮升级 24 → 36', 'life-upgrade': '生命维持升级 6 → 10', repair: '基础维修' }
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
export function OperationsPanel({ model, run }: { model: LabModel; run(operation: () => string): void }) {
  const [person, setPerson] = useState(0), [blueprint, setBlueprint] = useState(MANUFACTURING_RECIPES[0]?.blueprintId ?? '')
  const [batches, setBatches] = useState(1), [course, setCourse] = useState<'engineer' | 'researcher'>('engineer')
  const development = model.developmentView(), academy = model.academyView(), manufacturing = model.manufacturingView(), warning = model.warningView()
  const view = model.view(), factories = view.cells.filter(cell => cell.kind === 'manufacturing'), centers = view.cells.filter(cell => cell.kind === 'training')
  const [factory, setFactory] = useState(0), [center, setCenter] = useState(0)
  const factoryIndex = factories.some(cell => cell.cellIndex === factory) ? factory : factories[0]?.cellIndex
  const centerIndex = centers.some(cell => cell.cellIndex === center) ? center : centers[0]?.cellIndex
  const residents = model.trainingHost.residents()
  const people = <label className="app-player-station-field">派工居民<select aria-label="经营派工居民" value={person} onChange={event => setPerson(Number(event.target.value))}>
    {residents.map(index => <option key={index} value={index}>人口 {index + 1} · {model.training.qualifications[index] === 'engineer' ? '基础工程师' : model.training.qualifications[index] === 'researcher' ? '基础研究员' : '普通居民'}</option>)}
  </select></label>
  const execute = (operation: () => { ok: boolean; reason?: string }) => run(() => {
    const result = operation()
    if (!result.ok) throw new Error(`条件不足：${({ person: '人员已占用或资格不符', engineer: '缺少空闲工程师', facility: '设施不可用或已完成', research: '尚未掌握技术', materials: '材料不足', power: '供电不足', busy: '已有安排', course: '课程无效' } as Record<string, string>)[result.reason ?? ''] ?? result.reason}`)
    return '安排已更新'
  })
  return <>
    <section className="app-player-station" aria-label="扩站升级与维修">
      <h3 className="app-player-station-title"><Hammer size={17} />扩站、升级与维修</h3>
      <span className="app-dim">当前地块 {view.cellCount} · 可用工程师 {development.availableEngineers.length}</span>
      {development.options.map(option => <div key={`${option.kind}-${option.cellIndex}`} className="app-player-station-project">
        <div className="app-player-station-project-head"><strong>{NAMES[option.kind]}{option.cellIndex === undefined ? '' : ` · 地块 ${option.cellIndex + 1}`}</strong>
          <button className="app-btn" data-development-start={`${option.kind}-${option.cellIndex ?? 'body'}`} disabled={development.projects.some(project => option.kind === 'expand' ? project.kind === 'expand' : project.cellIndex === option.cellIndex)}
            onClick={() => execute(() => model.developmentCommand(option.kind === 'expand' ? { kind: 'expand' } : { kind: option.kind, cellIndex: option.cellIndex! }))}><Hammer size={14} />开工</button></div>
        <span className="app-dim">有效工期 {(option.spec?.durationMs ?? 0) / 60_000} 分钟 · 工程师 {option.spec?.engineers} · 额外电力 {option.spec?.power}</span>
        <div className="app-dim">{Object.entries(option.bill ?? {}).map(([id, n]) => `${materialInfo(id).name} ${number.format(n)} / 可用 ${number.format(model.host.available(id))}`).join(' · ')}</div>
      </div>)}
      {development.projects.map((project, index) => <div key={`${project.kind}-${project.cellIndex}`} className="app-player-station-project" data-development-project={index}>
        <strong>{NAMES[project.kind]} · {project.paused ? '已暂停' : development.running.includes(index) ? '施工中' : '等待人员或供电'}</strong>
        <span className="app-dim">工程师 {project.engineerIndices.map(index => index + 1).join('、') || '无人维修'} · {number.format(project.progressMs / 60_000)} / {project.durationMs / 60_000} 分钟</span>
        <progress value={project.progressMs} max={project.durationMs} />
        <div className="app-player-station-actions">
          <button className="app-btn" onClick={() => execute(() => model.developmentCommand({ kind: project.paused ? 'resume' : 'pause', projectIndex: index }))}>{project.paused ? <Play size={14} /> : <Pause size={14} />}{project.paused ? '恢复' : '暂停'}</button>
          <button className="app-btn" onClick={() => execute(() => model.developmentCommand({ kind: 'cancel', projectIndex: index }))}><X size={14} />取消并回收余料</button>
        </div>
      </div>)}
    </section>
    <section className="app-player-station" aria-label="站内制造">
      <h3 className="app-player-station-title"><Factory size={17} />站内制造</h3>
      {factories.length === 0 ? <span className="app-dim">尚未建成基础组装机</span> : <div className="app-player-station-actions">
        {people}
        <label className="app-player-station-field">组装机<select aria-label="制造设备" value={factoryIndex} onChange={event => setFactory(Number(event.target.value))}>{factories.map(cell => <option key={cell.cellIndex} value={cell.cellIndex}>地块 {cell.cellIndex + 1}</option>)}</select></label>
        <label className="app-player-station-field">零件配方<select aria-label="制造配方" value={blueprint} onChange={event => setBlueprint(event.target.value)}>{MANUFACTURING_RECIPES.map(recipe => <option key={recipe.blueprintId} value={recipe.blueprintId}>{recipe.name}</option>)}</select></label>
        <label className="app-player-station-field">批数<input aria-label="制造批数" type="number" min={1} max={1000} value={batches} onChange={event => setBatches(event.target.valueAsNumber)} /></label>
        <button className="app-btn" onClick={() => execute(() => model.manufacturingCommand({ kind: 'assign', cellIndex: factoryIndex!, personIndex: person, blueprintId: blueprint, batches }))}><Play size={14} />安排制造</button>
        <div className="app-dim">{(() => { const recipe = model.manufacturingHost.recipe(blueprint); return recipe && `单批 ${number.format(recipe.cycleMs / 1000)} 秒 · ${Object.entries(recipe.input).map(([id, n]) => `${materialInfo(id).name} ${n}`).join('、')} → ${Object.entries(recipe.output).map(([id, n]) => `${materialInfo(id).name} ${n}`).join('、')}` })()}</div>
      </div>}
      {manufacturing.runs.map(task => <div className="app-player-station-project" key={task.cellIndex} data-manufacturing-cell={task.cellIndex}>
        <strong>地块 {task.cellIndex + 1} · {MANUFACTURING_RECIPES.find(recipe => recipe.blueprintId === task.blueprintId)?.name} · {task.batchesDone}/{task.batches} 批</strong>
        <span className="app-dim">{task.completed ? '订单已完成' : task.blocked === 'materials' ? '缺料，保留进度' : task.blocked === 'power' ? '缺电或保障不足' : task.blocked === 'paused' ? '已暂停，人员保留' : task.personIndex === undefined ? '已停止' : '制造中'}</span>
        <progress value={task.progressMs} max={task.cycleMs} />
        {task.personIndex !== undefined && <div className="app-player-station-actions"><button className="app-btn" onClick={() => execute(() => model.manufacturingCommand({ kind: task.paused ? 'resume' : 'pause', cellIndex: task.cellIndex }))}>{task.paused ? <Play size={14} /> : <Pause size={14} />}{task.paused ? '恢复' : '暂停'}</button>
          <button className="app-btn" onClick={() => execute(() => model.manufacturingCommand({ kind: 'stop', cellIndex: task.cellIndex }))}><X size={14} />停止制造</button></div>}
      </div>)}
    </section>
    <section className="app-player-station" aria-label="培训中心课程">
      <h3 className="app-player-station-title"><GraduationCap size={17} />培训中心课程</h3>
      {centers.length === 0 ? <span className="app-dim">尚未建成培训中心</span> : academy.active ? <>
        <span>人口 {academy.active.personIndex + 1} · {academy.active.course === 'engineer' ? '工程' : '研究'}课程 · {({ paused: '已暂停', power: '等待供电或生活保障', person: '等待原居民', facility: '等待培训中心' } as Record<string, string>)[academy.blocked ?? ''] ?? '受训中'}</span>
        <progress value={academy.active.progressMs} max={30 * 60_000} />
        <div className="app-player-station-actions"><button className="app-btn" onClick={() => execute(() => model.academyCommand({ kind: academy.active!.paused ? 'resume' : 'pause' }))}>{academy.active.paused ? <Play size={14} /> : <Pause size={14} />}{academy.active.paused ? '恢复' : '暂停'}</button>
          <button className="app-btn" onClick={() => execute(() => model.academyCommand({ kind: 'release' }))}><X size={14} />退出课程</button></div>
      </> : <div className="app-player-station-actions">{people}
        <label className="app-player-station-field">培训中心<select aria-label="培训中心设备" value={centerIndex} onChange={event => setCenter(Number(event.target.value))}>{centers.map(cell => <option key={cell.cellIndex} value={cell.cellIndex}>地块 {cell.cellIndex + 1}</option>)}</select></label>
        <label className="app-player-station-field">课程<select aria-label="培训中心课程" value={course} onChange={event => setCourse(event.target.value as typeof course)}><option value="engineer">基础工程课程</option><option value="researcher">基础研究课程</option></select></label>
        <button className="app-btn" onClick={() => execute(() => model.academyCommand({ kind: 'assign', cellIndex: centerIndex!, personIndex: person, course }))}><Play size={14} />开课</button>
      </div>}
    </section>
    <section className="app-player-station" aria-label="近域警戒">
      <h3 className="app-player-station-title"><Radar size={17} />近域警戒 · {warning.online ? '阵列在线' : '无可用阵列'}</h3>
      <span className="app-dim">{warning.online ? warning.arrivals.length === 0 ? '近域无返航信号' : '已识别返航信号' : '等待警戒阵列建成并供电'}</span>
      {warning.arrivals.map(arrival => <div key={arrival.shipId}>{model.ships.find(ship => ship.id === arrival.shipId)?.name} · 预计 {number.format(arrival.remainingMs / 1000)} 秒抵达</div>)}
    </section>
  </>
}
