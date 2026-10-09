import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import ts from 'typescript'
type Kind = 'rocky' | 'desert' | 'ice' | 'ocean' | 'lava' | 'temperate' | 'gas'
const scope = { exports: {} as {
  StellarPlanetArt: (props: { kind: Kind }) => { props: { children: any[] } },
  StellarPlanetPreview: (props: { kind: Kind }) => unknown,
  STELLAR_KIND_IDS: Record<string, string>, STELLAR_PLANET_KIND_IDS: Record<Kind, string>,
}, require: () => ({ jsx, jsxs, Fragment }) }
const file = new URL('../../../../apps/desktop/src/renderer/src/ui/stellarArt.tsx', import.meta.url)
runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
export const { StellarPlanetArt, StellarPlanetPreview, STELLAR_KIND_IDS, STELLAR_PLANET_KIND_IDS } = scope.exports
