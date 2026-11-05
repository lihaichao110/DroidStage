/**
 * 应用包名测试：验证预置映射、搜索和手工输入提交不改变现有任务校验。
 */
import { describe, expect, it } from 'vitest'
import { APP_PACKAGES, appPackageLabel, filterAppPackages, resolveAppPackage } from '../src/renderer/src/utils/app-packages'
import { validateTask } from '../src/shared/task'

describe('目标应用包名', () => {
  it('按约定顺序提供四款普通版应用', () => {
    expect(APP_PACKAGES).toEqual([
      { name: '抖音', packageName: 'com.ss.android.ugc.aweme' },
      { name: '小红书', packageName: 'com.xingin.xhs' },
      { name: '快手', packageName: 'com.smile.gifmaker' },
      { name: '京东', packageName: 'com.jingdong.app.mall' }
    ])
  })

  it('按中文名称或包名包含匹配，忽略搜索大小写和首尾空格', () => {
    expect(filterAppPackages('红')).toEqual([APP_PACKAGES[1]])
    expect(filterAppPackages(' COM.SMILE ')).toEqual([APP_PACKAGES[2]])
    expect(filterAppPackages('com.')).toEqual(APP_PACKAGES)
    expect(filterAppPackages('不存在')).toEqual([])
    expect(filterAppPackages('  ')).toEqual(APP_PACKAGES)
  })

  it('完整预置名称提交为包名，包名可映射回展示名称', () => {
    for (const app of APP_PACKAGES) {
      expect(resolveAppPackage(` ${app.name} `)).toBe(app.packageName)
      expect(resolveAppPackage(app.packageName)).toBe(app.packageName)
      expect(appPackageLabel(app.packageName)).toBe(app.name)
    }
  })

  it('自定义包名保留内容并去除首尾空格，清空得到空字符串', () => {
    expect(resolveAppPackage('  com.example.custom  ')).toBe('com.example.custom')
    expect(appPackageLabel('com.example.custom')).toBe('com.example.custom')
    expect(resolveAppPackage('  ')).toBe('')
    expect(appPackageLabel('')).toBe('')
  })

  it('不把部分名称或非法输入静默替换为预置应用', () => {
    expect(resolveAppPackage('小红')).toBe('小红')
    expect(resolveAppPackage('com.example. custom')).toBe('com.example. custom')
    const task = { version: 1, name: '测试任务', steps: [{ id: 's1', type: 'screenshot' }] }
    expect(() => validateTask({ ...task, packageName: resolveAppPackage('小红') })).toThrow('App 包名无效')
    expect(() => validateTask({ ...task, packageName: resolveAppPackage('') })).not.toThrow()
    for (const app of APP_PACKAGES) {
      expect(() => validateTask({ ...task, packageName: resolveAppPackage(app.name) })).not.toThrow()
    }
  })
})
