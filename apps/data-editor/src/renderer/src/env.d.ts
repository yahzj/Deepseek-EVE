/// <reference types="vite/client" />
import type { DataEditorApi } from '../../../../../tools/data-editor-contract'

declare global {
  interface Window {
    dataEditor?: DataEditorApi
  }
}
