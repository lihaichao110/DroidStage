/**
 * 常用应用包名：提供预置应用、搜索与输入值转换，保持任务数据只存包名。
 */
export const APP_PACKAGES = [
  { name: '抖音', packageName: 'com.ss.android.ugc.aweme' },
  { name: '小红书', packageName: 'com.xingin.xhs' },
  { name: '快手', packageName: 'com.smile.gifmaker' },
  { name: '京东', packageName: 'com.jingdong.app.mall' }
] as const

/**
 * 按名称或包名进行包含搜索，空查询返回全部预置应用。
 * @param query 用户输入的搜索文本
 * @returns 保持预置顺序的匹配项
 */
export function filterAppPackages(query: string) {
  const keyword = query.trim().toLowerCase()
  return APP_PACKAGES.filter((app) => app.name.includes(keyword) || app.packageName.toLowerCase().includes(keyword))
}

/**
 * 将完整应用名转换为包名；其余输入仅去除首尾空格，交由现有任务校验处理。
 * @param input 用户提交的名称或自定义包名
 * @returns 任务应保存的包名字符串，允许为空
 */
export function resolveAppPackage(input: string): string {
  const value = input.trim()
  return APP_PACKAGES.find((app) => app.name === value)?.packageName ?? value
}

/**
 * 为已知包名提供应用名，自定义包名按原文显示。
 * @param packageName 已保存的任务包名
 * @returns 非编辑状态的显示文本
 */
export function appPackageLabel(packageName: string): string {
  return APP_PACKAGES.find((app) => app.packageName === packageName)?.name ?? packageName
}
