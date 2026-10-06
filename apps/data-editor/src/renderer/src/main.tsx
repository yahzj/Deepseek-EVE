import { createRoot } from 'react-dom/client'
import App from './App'
import { resolveApi } from './api'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<div className="boot-state" role="status">连接数据编辑器...</div>)
void resolveApi().then(({ api, demo }) => {
  root.render(<App api={api} demo={demo} />)
}).catch((error: unknown) => {
  root.render(<div className="boot-state" role="alert"><h1>数据编辑器未连接</h1><p>{error instanceof Error ? error.message : String(error)}</p></div>)
})
