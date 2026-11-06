/**
 * 渲染进程入口：加载全局样式并挂载应用。
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'
import './multi-page.css'
import './monitor.css'
import './condition.css'
import './styles/app-chrome.css'
import './styles/editor-layout.css'
import './styles/editor-workflow.css'
import './styles/editor-settings.css'
import './styles/editor-details.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
