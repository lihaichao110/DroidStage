/**
 * 渲染进程入口：加载全局样式并挂载应用。
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'
import './multi-page.css'
import './condition.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
