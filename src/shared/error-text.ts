/**
 * IPC 错误文案：去掉 Electron 的调用包装，保留手机或网络返回的诊断原因。
 */

/** 把主进程异常变成用户可读提示。 */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error invoking remote method "[^"]+": Error: /, '')
    .trim()
}
