/**
 * 投屏坐标换算与触摸输入校验（主/渲染进程共用的纯函数）。
 * 视频帧与当前方向的屏幕等比（scrcpy 只做等比缩小），旋转时帧宽高互换，
 * 需要结合物理分辨率推断当前方向的真实屏幕尺寸。
 */
import type { TouchInput } from './types'

export type Size = { width: number; height: number }

/**
 * 由物理分辨率（wm size，竖屏基准）与视频帧方向推断当前方向的屏幕尺寸。
 * @param physical wm size 输出的物理分辨率
 * @param frame 视频帧尺寸（旋转后宽高互换）
 */
export function currentDeviceSize(physical: Size, frame: Size): Size {
  // 物理与帧的横竖关系不一致即发生了旋转，宽高互换
  const isRotated = physical.width > physical.height !== frame.width > frame.height
  return isRotated ? { width: physical.height, height: physical.width } : physical
}

/**
 * 视频帧坐标换算为设备屏幕坐标（整数像素，夹取在屏幕内）。
 * @throws 帧或屏幕尺寸非正时抛出
 */
export function frameToPoint(x: number, y: number, frame: Size, device: Size): { x: number; y: number } {
  if (frame.width <= 0 || frame.height <= 0 || device.width <= 0 || device.height <= 0) throw new Error('投屏画面尺寸无效')
  return {
    x: Math.max(0, Math.min(device.width - 1, Math.round((x * device.width) / frame.width))),
    y: Math.max(0, Math.min(device.height - 1, Math.round((y * device.height) / frame.height)))
  }
}

/** 触摸坐标与任务步骤一致的上限（对应 validateTask 的坐标约束，不得放宽）。 */
const MAX_COORDINATE = 10000
/** 单次 move 批量注入的点数上限：一帧内合并的鼠标轨迹足够覆盖，超出说明调用方异常。 */
const MAX_MOVE_POINTS = 64

/**
 * 校验渲染进程送来的触摸事件，合法则转成 agent touch op 的 args。
 * @returns 与 TouchInput 对应的 op 参数对象
 * @throws 结构不完整或数值越界时抛出（主进程拒绝转发）
 */
export function touchArgs(event: TouchInput): Record<string, unknown> {
  if (event.action === 'move') {
    if (!Array.isArray(event.points) || event.points.length === 0 || event.points.length > MAX_MOVE_POINTS) {
      throw new Error('触摸轨迹点数量无效')
    }
    for (const point of event.points) {
      if (!isCoord(point.x) || !isCoord(point.y)) throw new Error('触摸坐标无效')
    }
    return { action: 'move', points: event.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })) }
  }
  if (event.action === 'down' || event.action === 'up' || event.action === 'cancel') {
    if (!isCoord(event.x) || !isCoord(event.y)) throw new Error('触摸坐标无效')
    return { action: event.action, x: Math.round(event.x), y: Math.round(event.y) }
  }
  throw new Error('未知触摸动作')
}

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE
}
