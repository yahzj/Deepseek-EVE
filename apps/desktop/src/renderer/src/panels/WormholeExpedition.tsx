import { useEffect, useId, useRef, useState } from 'react'
import { cargoHoldForbidden, shipDisplayName, wormholeGroundBoard, wormholeIsShapedItem, WORMHOLE_TEMPLATE_MAX, WORMHOLE_TEMPLATE_NAME_MAX, parseHexKey, wormholeDisplayThreat } from '@whale/core'
import type { WormholeExtractionRequest, WormholePreparationPlan, WormholePreparationRequest } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { futureTr as tr } from '../i18n/locale'
import { Glyph, itemIconOf } from '../ui/Glyphs'
import { currentLocale } from '../i18n/locale'
import type { WormholeViewText, WormholeTemplateResult } from '@whale/core'

type ManifestDraft = { picked: string[]; request: WormholePreparationRequest }
const TEMPLATE_KEY = 'whale-idle:wh-manifest-template'
export function manifestDraftKey(engine: GameEngine, stockId: string | null): string {
  return `whale-idle:wh-manifest:${engine.state.character.name}:${stockId ?? 'none'}`
}
export function readManifestDraft(key: string): ManifestDraft | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!raw || !Array.isArray(raw.picked) || !raw.request || !Array.isArray(raw.request.unload)) return undefined
    const targets = Object.fromEntries(Object.entries(raw.request.targets ?? {}).filter(([id, n]) => id && typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) as Record<string, number>
    return { picked: raw.picked.filter((id: unknown): id is string => typeof id === 'string'), request: { targets, unload: raw.request.unload.filter((id: unknown): id is string => typeof id === 'string') } }
  } catch { return undefined }
}
export function writeManifestDraft(key: string, draft: ManifestDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(draft)); return true } catch { return false }
}
function quantity(value: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0
}
function ItemName({ engine, id }: { engine: GameEngine; id: string }) {
  const item = engine.ctx.items.get(id)
  return <span className="app-wh-manifest-item"><Glyph name={itemIconOf(id, item?.kind)} size={18} /><span>{item?.name ?? engine.ctx.modules.get(id)?.name ?? id}</span></span>
}
export function WhItemCounts({ engine, items }: { engine: GameEngine; items: Readonly<Record<string, number>> }) {
  return <ul className="app-wh-manifest-counts">{Object.entries(items).filter(([, n]) => n > 0).map(([id, n]) =>
    <li key={id}><ItemName engine={engine} id={id} /><b>×{n.toLocaleString()}</b></li>,
  )}{Object.values(items).every((n) => n <= 0) ? <li className="app-dim">0</li> : null}</ul>
}

export function WhPreparation({ engine, picked, stockId, onEnter, auto = false }: {
  engine: GameEngine; picked: string[]; stockId: string | null; onEnter: (plan: WormholePreparationPlan) => void; auto?: boolean
}) {
  const key = manifestDraftKey(engine, stockId)
  const [request, setRequest] = useState<WormholePreparationRequest>(() => readManifestDraft(key)?.request ?? { targets: {}, unload: [] })
  const [note, setNote] = useState<string | null>(null)
  const [preview, setPreview] = useState<WormholePreparationPlan | null>(null)
  const [stockPreview, setStockPreview] = useState(false)
  const [lossRisk, setLossRisk] = useState(false)
  const [selected, setSelected] = useState('')
  const [manage, setManage] = useState(false)
  const [editor, setEditor] = useState<{ kind: 'new' | 'rename' | 'import'; id?: string; name: string } | null>(null)
  const [ask, setAsk] = useState<{ kind: 'overwrite' | 'delete'; id: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [excess, setExcess] = useState<Record<string, number>>({})
  const [editingTargets, setEditingTargets] = useState<Record<string, string>>({})
  const summaryRef = useRef<HTMLDivElement>(null)
  const inputPrefix = useId()
  const state = engine.state
  const onboard: Record<string, number> = {}
  for (const uid of picked) for (const [id, n] of Object.entries(state.fleet[uid]?.cargo ?? {})) onboard[id] = (onboard[id] ?? 0) + n
  const plan = engine.wormholePrepare(picked, request, auto)
  const rows = new Map(plan.rows.map((row) => [row.itemId, row]))
  const ids = [...new Set([
    ...[...engine.ctx.items.values()].filter((item) => ['ammo', 'kit', 'drone'].includes(item.kind) && item.unreleased !== true).map((item) => item.id),
    ...Object.keys(onboard), ...Object.keys(request.targets),
  ])]
  const templates = state.wormholePreparationTemplates ?? []
  const selectedTemplate = templates.find(t => t.id === selected)
  const previousTemplate = readManifestDraft(TEMPLATE_KEY)
  useEffect(() => { writeManifestDraft(key, { picked, request }) }, [key, picked, request])
  function update(next: WormholePreparationRequest) { setRequest(next); setPreview(null); setStockPreview(false); setNote(null); setExcess({}); setEditingTargets({}) }
  function captureTargets(): Record<string, number> {
    return Object.fromEntries(ids.filter(id => ['ammo', 'kit', 'drone'].includes(engine.ctx.items.get(id)?.kind ?? '')).map(id => [id, request.unload.includes(id) ? 0 : request.targets[id] ?? onboard[id] ?? 0]))
  }
  function nextName(): string {
    let n = 1
    while (templates.some(t => t.name === tr('ui.whExpedition.114', { p1: n }))) n++
    return tr('ui.whExpedition.114', { p1: n })
  }
  async function editTemplate(action: () => Promise<WormholeTemplateResult & { saved?: boolean }>, successId: string): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const result = await action()
      if (!result.ok) {
        const errors = { 'name-empty': 'ui.whExpedition.122', 'name-duplicate': 'ui.whExpedition.123', 'template-missing': 'ui.whExpedition.124', 'template-limit': 'ui.whExpedition.125', 'invalid-targets': 'ui.whExpedition.126' }
        setNote(tr(errors[result.code])); return
      }
      if (successId === 'ui.whExpedition.130') setSelected('')
      else setSelected(result.id)
      setEditor(null); setAsk(null)
      setNote(tr(result.saved === false ? 'ui.whExpedition.127' : successId))
    } catch { setNote(tr('ui.whExpedition.127')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function confirm() {
    if (busyRef.current) return
    if (!plan.ok || (auto ? !lossRisk : engine.wormholeEntryGate(picked))) { summaryRef.current?.focus(); return }
    if (!preview || preview.fingerprint !== plan.fingerprint) {
      setPreview(plan)
      if (preview) setNote(tr('ui.whExpedition.016'))
      return
    }
    onEnter(preview)
  }
  return <section className="app-wh-manifest" aria-label={tr('ui.whExpedition.001')}>
    <div className="app-wh-manifest-head"><h3>{tr('ui.whExpedition.001')}</h3><span>{tr('ui.whExpedition.007')} <b>{plan.cells}</b> / {plan.capacity} · {tr('ui.whExpedition.008')} <b>{Math.max(0, plan.capacity - plan.cells)}</b></span></div>
    {auto ? <label className="app-wh-auto-risk"><input type="checkbox" checked={lossRisk} onChange={e => { setLossRisk(e.target.checked); setPreview(null) }} data-wh-auto-risk />{tr('ui.whExpedition.078')}</label> : null}
    <div className="app-wh-manifest-tools app-wh-template-tools">
      <label>{tr('ui.whExpedition.013')}<select data-wh-template-select value={selectedTemplate ? selected : ''} disabled={busy} onChange={e => { setSelected(e.target.value); setAsk(null) }}><option value="">{tr('ui.whExpedition.111')}</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <button type="button" className="app-btn is-small" disabled={busy || templates.length >= WORMHOLE_TEMPLATE_MAX} data-wh-template-save onClick={() => { setEditor({ kind: 'new', name: nextName() }); setAsk(null) }}><Glyph name="blueprint" size={16} />{tr('ui.whExpedition.012')}</button>
      <button type="button" className="app-btn is-small" disabled={busy} data-wh-template-manage title={tr('ui.whExpedition.112')} aria-label={tr('ui.whExpedition.112')} aria-expanded={manage} onClick={() => setManage(!manage)}><Glyph name="support" size={18} /></button>
      {/* ⟪文案调整 2026-10-06⟫ 船长确认模板选择与执行分离，补齐放末尾。 */}
      <button type="button" className="app-btn is-small" disabled={busy || !selectedTemplate} data-wh-template-fill onClick={() => {
        const filled = engine.wormholePrepareFromTemplate(picked, request, selected)
        if (!filled) { setNote(tr('ui.whExpedition.124')); return }
        update(filled.request); setExcess(filled.excess); setStockPreview(true)
      }}><Glyph name="cargo" size={16} />{tr('ui.whExpedition.011')}</button>
    </div>
    {manage || editor || ask ? <div className="app-wh-template-editor">
      {manage ? <div className="app-wh-template-list">{templates.map(t => <div key={t.id} className="app-wh-template-row" data-wh-template-row={t.id}><b className="app-wh-template-name">{t.name}</b><div className="app-wh-template-actions">
        <button type="button" className="app-btn is-small" disabled={busy} data-wh-template-rename={t.id} onClick={() => { setEditor({ kind: 'rename', id: t.id, name: t.name }); setAsk(null) }}>{tr('ui.whExpedition.115')}</button>
        <button type="button" className="app-btn is-small" disabled={busy} data-wh-template-overwrite={t.id} onClick={() => { setAsk({ kind: 'overwrite', id: t.id }); setEditor(null) }}>{tr('ui.whExpedition.116')}</button>
        <button type="button" className="app-btn is-small is-danger" disabled={busy} data-wh-template-delete={t.id} onClick={() => { setAsk({ kind: 'delete', id: t.id }); setEditor(null) }}>{tr('ui.whExpedition.117')}</button>
      </div></div>)}{previousTemplate ? <button type="button" className="app-btn is-small" data-wh-template-import disabled={busy || templates.length >= WORMHOLE_TEMPLATE_MAX} onClick={() => { setEditor({ kind: 'import', name: nextName() }); setAsk(null) }}>{tr('ui.whExpedition.121')}</button> : null}</div> : null}
      {editor ? <div className="app-wh-template-row"><label>{tr('ui.whExpedition.113')}<input className="app-mkt-search-input app-wh-template-name" data-wh-template-name value={editor.name} maxLength={WORMHOLE_TEMPLATE_NAME_MAX} disabled={busy} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label><div className="app-wh-template-actions">
        <button type="button" className="app-btn is-small is-primary" data-wh-template-confirm disabled={busy} onClick={() => void editTemplate(() => editor.kind === 'rename' ? engine.wormholeRenameTemplate(editor.id!, editor.name) : engine.wormholeSaveTemplate(editor.name, editor.kind === 'import' ? previousTemplate?.request.targets ?? {} : captureTargets()), editor.kind === 'rename' ? 'ui.whExpedition.129' : 'ui.whExpedition.128')}>{tr('ui.whExpedition.120')}</button>
        <button type="button" className="app-btn is-small" disabled={busy} data-wh-template-cancel onClick={() => setEditor(null)}>{tr('ui.ActivityBar.004')}</button>
      </div></div> : null}
      {ask ? <div className="app-wh-template-row"><span>{tr(ask.kind === 'delete' ? 'ui.whExpedition.119' : 'ui.whExpedition.118', { p1: templates.find(t => t.id === ask.id)?.name ?? '' })}</span><div className="app-wh-template-actions">
        <button type="button" className="app-btn is-small is-warn" data-wh-template-confirm disabled={busy} onClick={() => void editTemplate(() => ask.kind === 'delete' ? engine.wormholeDeleteTemplate(ask.id) : engine.wormholeSaveTemplate(templates.find(t => t.id === ask.id)?.name ?? '', captureTargets(), ask.id), ask.kind === 'delete' ? 'ui.whExpedition.130' : 'ui.whExpedition.129')}>{tr('ui.whExpedition.120')}</button>
        <button type="button" className="app-btn is-small" data-wh-template-cancel disabled={busy} onClick={() => setAsk(null)}>{tr('ui.ActivityBar.004')}</button>
      </div></div> : null}
    </div> : null}
    <div className="app-wh-manifest-errors" ref={summaryRef} tabIndex={-1} role={!plan.ok || note ? 'alert' : undefined}>
      {note ? <p>{note}</p> : null}
      {plan.cells > plan.capacity ? <p>{tr('ui.whExpedition.017')}</p> : null}
      {Object.entries(plan.shortage).map(([id, n]) => <a key={id} href={`#${inputPrefix}-${id}`}>{engine.ctx.items.get(id)?.name ?? id}: {tr('ui.whExpedition.006', { p1: n })}</a>)}
      {plan.invalid.map((id) => <a key={id} href={`#${inputPrefix}-${id}`}>{engine.ctx.items.get(id)?.name ?? engine.ctx.modules.get(id)?.name ?? id} · {tr('ui.whExpedition.010')}</a>)}
    </div>
    <div className="app-wh-manifest-scroll">
      <div className="app-wh-manifest-row is-heading"><span>{tr('ui.whExpedition.003')}</span><span>{tr('ui.whExpedition.004')}</span><span>{tr('ui.whExpedition.002')}</span><span>{tr('ui.whExpedition.005')}</span></div>
      {ids.map((id) => {
        const unloaded = request.unload.includes(id)
        const held = unloaded ? 0 : onboard[id] ?? 0
        const target = request.targets[id] ?? held
        const row = rows.get(id)
        const invalid = !engine.ctx.items.has(id) || cargoHoldForbidden(engine.ctx, id) || wormholeIsShapedItem(id)
        return <div key={id} className="app-wh-manifest-row" data-wh-manifest-item={id}>
          <div><ItemName engine={engine} id={id} /><span className="app-dim">{onboard[id] ?? 0}</span>{engine.ctx.items.get(id)?.kind === 'drone' ? <small className="app-wh-manifest-deployed" data-wh-deployed={id}>{tr('ui.FitPage.010')} <b>{plan.deployedDrones[id] ?? 0}</b></small> : null}{(onboard[id] ?? 0) > 0 ?
            <label className="app-wh-manifest-unload"><input type="checkbox" checked={unloaded} onChange={(e) => update({ targets: { ...request.targets, [id]: e.target.checked ? 0 : onboard[id]! }, unload: e.target.checked ? [...request.unload, id] : request.unload.filter((x) => x !== id) })} />{tr('ui.whExpedition.010')}</label> : null}</div>
          <span>{state.warehouse.items[id] ?? 0}</span>
          <label><span className="app-sr-only">{engine.ctx.items.get(id)?.name ?? id} {tr('ui.whExpedition.002')}</span>{engine.ctx.items.get(id)?.kind === 'drone' ? <small>{tr('ui.whExpedition.021')}</small> : null}<input id={`${inputPrefix}-${id}`} type="number" inputMode="numeric" min={held} step={1} disabled={invalid} value={editingTargets[id] ?? target} onFocus={e => e.currentTarget.select()} onChange={(e) => {
            const value = e.target.value
            update({ ...request, targets: { ...request.targets, [id]: Math.max(held, quantity(value)) } })
            setEditingTargets({ [id]: value })
          }} onBlur={(e) => update({ ...request, targets: { ...request.targets, [id]: Math.max(held, quantity(e.target.value)) } })} aria-invalid={(row?.missing ?? 0) > 0} /></label>
          <span className={(row?.missing ?? 0) > 0 ? 'app-warn' : ''}>{row?.needed ?? 0}{(row?.missing ?? 0) > 0 ? <small>{tr('ui.whExpedition.006', { p1: row!.missing })}</small> : null}{preview || stockPreview ? <small>{tr('ui.whExpedition.009')} {(row?.onboard ?? 0) + (row?.available ?? 0)}</small> : null}</span>
        </div>
      })}
    </div>
    <div className="app-wh-manifest-warnings">{Object.entries(excess).map(([id, n]) => <span key={id}>{engine.ctx.items.get(id)?.name ?? id} · {tr('ui.whExpedition.131', { p1: n })}</span>)}{plan.warnings.map((warning, i) => <span key={i}>{warning.shipId ? `${shipDisplayName(state, engine.ctx, warning.shipId)}: ` : ''}{warning.itemId ? `${engine.ctx.items.get(warning.itemId)?.name ?? warning.itemId} · ` : ''}{tr(warning.code === 'ammo-empty' ? 'ui.whExpedition.018' : warning.code === 'no-salvager' ? 'ui.whExpedition.019' : 'ui.whExpedition.020')}</span>)}</div>
    <div className="app-wh-manifest-footer"><span>{tr('ui.whExpedition.015')}</span><button type="button" className={`app-btn is-primary${preview ? ' is-on' : ''}`} disabled={busy} onClick={confirm} data-wh-enter-prepared>{tr('ui.whExpedition.014')}</button></div>
  </section>
}

function viewText(text: WormholeViewText): string { return tr(text.id, text.params) }

export function WhEventChoices({ engine, onToast }: { engine: GameEngine; onToast: (message: string, bad?: boolean) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const view = engine.wormholeEventView()
  if (!view) return null
  return <section className="app-wh-event" aria-label={tr(view.titleId)} data-wh-event={view.key}>
    <header><b>{tr(view.titleId)}</b>{view.identityId ? <span className="app-chip">{tr(view.identityId)}</span> : null}</header>
    <div className="app-wh-event-options">{view.choices.map(choice => {
      const plan = choice.plan
      const risky = plan.battle !== 'none'
      const armed = confirm === `${choice.action}:${plan.fingerprint}`
      return <div className="app-wh-event-option" key={choice.action}>
        <div className="app-wh-event-command"><button type="button" className={`app-btn is-small${risky ? ' is-warn' : ' is-primary'}`} data-wh-event-action={choice.action} disabled={!plan.ok} onClick={() => {
          if (risky && !armed) { setConfirm(`${choice.action}:${plan.fingerprint}`); return }
          const result = engine.wormholeResolveEvent(choice.action, plan)
          setConfirm(null)
          if (!result.ok) onToast(tr(result.error === 'stale-plan' ? 'ui.whExpedition.016' : 'ui.whExpedition.079'), true)
        }}>{armed ? tr('ui.whExpedition.103') : tr(choice.labelId)}</button><span className="app-dim">{tr('ui.whExpedition.063', { p1: plan.turns })}</span></div>
        {Object.keys(plan.supply).length ? <div><span className="app-dim">{tr('ui.whExpedition.101')}</span><WhItemCounts engine={engine} items={plan.supply} /></div> : null}
        {Object.keys(plan.rewards).length ? <div><span className="app-dim">{tr('ui.whExpedition.100')}</span><WhItemCounts engine={engine} items={plan.rewards} /></div> : null}
        {choice.notices.map((notice, i) => <p key={i} className={risky ? 'app-warn' : 'app-dim'}>{viewText(notice)}</p>)}
        {choice.rejection ? <p className="app-warn" role="status">{viewText(choice.rejection)}</p> : null}
      </div>
    })}</div>
  </section>
}

export function WhAlert({ engine }: { engine: GameEngine }) {
  const view = engine.wormholeAlertView()
  if (!view) return null
  return <section className="app-wh-alert" data-wh-alert={view.level}><header><b>{tr('ui.whExpedition.073', { p1: view.level })}</b><span className={view.level >= 4 ? 'app-warn' : 'app-dim'}>{tr(view.bandId)}</span></header>
    {view.patrols.map(p => <p key={p.id} data-wh-patrol={p.id}>{p.status === 'warning' ? tr('ui.whExpedition.074', { p1: p.actions }) : p.status === 'active' && p.cellKey ? (() => { const pos = parseHexKey(p.cellKey)!; return tr('ui.whExpedition.089', { p1: p.id + 1, p2: pos.q, p3: pos.r, p4: p.distance ?? 0, p5: p.actions }) })() : tr(p.status === 'cleared' ? 'ui.whExpedition.091' : 'ui.whExpedition.090')}</p>)}
  </section>
}

export function WhEncounterIntel({ engine, cellKey }: { engine: GameEngine; cellKey: string }) {
  const view = engine.wormholeEncounterView(cellKey)
  if (!view) return null
  return <section className="app-wh-intel" data-wh-intel={cellKey}><header><b>{view.role === 'elite' ? tr('ui.whExpedition.095') : view.title}</b><span>{tr('ui.Expedition.089')} {wormholeDisplayThreat(view.threat)}</span></header>
    {view.mechanismId ? <p>{tr(view.mechanismId)}</p> : null}
    {view.ships.map(ship => <p key={ship.tag}><b>{ship.name}</b>{ship.mounts.length ? ` · ${ship.mounts.map(pair => currentLocale() === 'en' ? pair[1] : pair[0]).join(' / ')}` : ''}</p>)}
    <p>{tr('ui.whExpedition.098', { p1: view.ships.filter(s => s.pd).length })}</p>
    {view.supportDisabled ? <p>{tr('ui.whExpedition.102')}</p> : null}
    <p>{tr('ui.whExpedition.096', { p1: view.rareCount })}{view.guaranteedContainer ? ` · ${tr('ui.whExpedition.097')}` : ''}</p>
  </section>
}

export function WhObjectiveProgress({ progress }: { progress?: import('@whale/core').WormholeRunState['expeditionProgress'] }) {
  if (!progress) return null
  return <section className="app-wh-objective"><b>{tr('ui.whExpedition.092')}</b><p>{tr('ui.whExpedition.093', { p1: progress.peakDepth, p2: progress.guards, p3: progress.ruins, p4: progress.events })}</p><p>{tr('ui.whExpedition.094', { p1: progress.revealed, p2: progress.clues, p3: progress.elites })}</p></section>
}

export function WhSupplies({ engine, compact = false, onOpen }: { engine: GameEngine; compact?: boolean; onOpen?: () => void }) {
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const run = engine.state.wormhole.run
  if (run?.supplyVersion !== 1 || !run.supplies) return null
  const supply = run.supplies.items
  if (compact) {
    const totals = { ammo: 0, drone: 0, kit: 0 }
    for (const [id, n] of Object.entries(supply)) {
      const kind = engine.ctx.items.get(id)?.kind
      if (kind === 'ammo' || kind === 'drone' || kind === 'kit') totals[kind] += n
    }
    return <button className="app-wh-supply-summary" type="button" onClick={onOpen}><b>{tr('ui.whExpedition.022')}</b><span><Glyph name="ammo" size={16} />{totals.ammo}</span><span>{tr('ui.whExpedition.021')} {totals.drone}</span><span><Glyph name="kit" size={16} />{totals.kit}</span></button>
  }
  return <section className="app-wh-supply-list" aria-label={tr('ui.whExpedition.022')}><h3>{tr('ui.whExpedition.022')}</h3>{error ? <p role="alert" className="app-warn">{error}</p> : null}
    <ul>{Object.entries(supply).filter(([, n]) => n > 0).map(([id, n]) => <li key={id} data-wh-supply-item={id}><ItemName engine={engine} id={id} /><b>{n}</b><input type="number" inputMode="numeric" min={1} max={n} step={1} value={Math.min(n, amounts[id] ?? n)} aria-label={`${engine.ctx.items.get(id)?.name ?? id} ${tr('ui.whExpedition.025')}`} onChange={(e) => setAmounts({ ...amounts, [id]: Math.max(1, quantity(e.target.value, n)) })} /><button type="button" className="app-btn is-small" disabled={!!run.battle || run.pendingNodeBattle || run.pendingRuinsBattle} onClick={() => { const result = engine.wormholeLeaveSupplyUnits(id, Math.min(n, amounts[id] ?? n)); setError(result.ok ? null : tr('ui.whExpedition.036')) }}>{tr('ui.whExpedition.025')}</button></li>)}</ul>
  </section>
}

export function WhGroundList({ engine }: { engine: GameEngine }) {
  const [error, setError] = useState<string | null>(null)
  const run = engine.state.wormhole.run!
  const pieces = wormholeGroundBoard(run)?.placements ?? []
  return <section className="app-wh-ground-list"><h3>{tr('ui.whExpedition.023')}</h3><p className="app-dim">{tr('ui.whExpedition.027')}</p>{error ? <p className="app-warn" role="alert">{error}</p> : null}
    <ul>{pieces.map((piece) => <li key={piece.id} data-wh-ground-item={piece.itemId}><ItemName engine={engine} id={piece.itemId} /><b>{piece.kind === 'cargo' ? piece.units : 1}</b><button className="app-btn is-small" type="button" disabled={!!run.battle || run.pendingNodeBattle || run.pendingRuinsBattle} onClick={() => { const r = engine.wormholeTempStow(piece.id); setError(r.ok ? null : tr('ui.whExpedition.034')) }}>{tr('ui.whExpedition.024')}</button></li>)}</ul>
  </section>
}

export function WhExtraction({ engine, onCancel }: { engine: GameEngine; onCancel: () => void }) {
  const [request, setRequest] = useState<WormholeExtractionRequest>({ leavePieces: [], leaveSupplies: {}, takeGround: [] })
  const [plan, setPlan] = useState(() => engine.wormholeExtractionPreview(request))
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => { if (prior?.isConnected) prior.focus() }
  }, [])
  const run = engine.state.wormhole.run!
  const currentGround = wormholeGroundBoard(run)?.placements ?? []
  function update(next: WormholeExtractionRequest) { setRequest(next); setPlan(engine.wormholeExtractionPreview(next)); setError(null) }
  function toggle(key: 'leavePieces' | 'takeGround', id: string) { update({ ...request, [key]: request[key].includes(id) ? request[key].filter((x) => x !== id) : [...request[key], id] }) }
  return <section ref={dialogRef} tabIndex={-1} className="app-wh-extraction" role="dialog" aria-modal="true" aria-label={tr('ui.whExpedition.030')} onKeyDown={(e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
    if (e.key !== 'Tab') return
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
    if (!nodes.length) return
    const first = nodes[0]!, last = nodes.at(-1)!
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }}>
    <header><h3>{tr('ui.whExpedition.030')}</h3><b>{plan.used} / {plan.capacity}</b></header>
    <div className="app-wh-extraction-scroll">
      {error ? <p role="alert" className="app-warn">{error}</p> : null}
      {!plan.ok ? <p className="app-warn" role="alert">{plan.code === 'battle-required' ? tr('core.wormhole.035') : tr('ui.whExpedition.034')}{plan.used > plan.capacity ? ` · ${tr('ui.whExpedition.033', { p1: plan.used - plan.capacity })}` : ''}</p> : null}
      <h4>{tr('ui.whExpedition.022')}</h4>
      <ul className="app-wh-extraction-selection">{Object.entries(run.supplies?.items ?? {}).filter(([, n]) => n > 0).map(([id, n]) => <li key={id}><ItemName engine={engine} id={id} /><span>{n}</span><label>{tr('ui.whExpedition.025')}<input type="number" min={0} max={n} step={1} inputMode="numeric" aria-label={`${engine.ctx.items.get(id)?.name ?? id} ${tr('ui.whExpedition.025')}`} value={request.leaveSupplies[id] ?? 0} onChange={(e) => { const left = { ...request.leaveSupplies }; const v = quantity(e.target.value, n); if (v > 0) left[id] = v; else delete left[id]; update({ ...request, leaveSupplies: left }) }} /></label></li>)}</ul>
      <h4>{tr('ui.whExpedition.039')}</h4>
      <ul className="app-wh-extraction-selection">{(run.hold?.placements ?? []).map((p) => <li key={p.id}><ItemName engine={engine} id={p.itemId} /><span>{p.units ?? 1}</span><label><input type="checkbox" checked={request.leavePieces.includes(p.id)} onChange={() => toggle('leavePieces', p.id)} />{tr('ui.whExpedition.025')}</label></li>)}</ul>
      <h4>{tr('ui.whExpedition.023')}</h4>
      <ul className="app-wh-extraction-selection">{currentGround.map((p) => <li key={p.id}><ItemName engine={engine} id={p.itemId} /><span>{p.units ?? 1}</span><label><input type="checkbox" checked={request.takeGround.includes(p.id)} onChange={() => toggle('takeGround', p.id)} />{tr('ui.whExpedition.024')}</label></li>)}</ul>
      <div className="app-wh-extraction-results"><section><h4>{tr('ui.whExpedition.031')}</h4><WhItemCounts engine={engine} items={plan.supplies} /><WhItemCounts engine={engine} items={plan.loot} /></section><section><h4>{tr('ui.whExpedition.032')}</h4><WhItemCounts engine={engine} items={plan.left} /></section></div>
    </div>
    <footer><button className="app-btn" type="button" onClick={onCancel}>{tr('ui.ActivityBar.004')}</button><button className="app-btn is-primary" type="button" disabled={!plan.ok} data-wh-extract-confirm onClick={() => { const result = engine.wormholeExtractConfirmed(plan); if (result.ok) onCancel(); else { setError(tr('ui.whExpedition.036')); setPlan(engine.wormholeExtractionPreview(request)) } }}>{tr('ui.whExpedition.035')}</button></footer>
  </section>
}
