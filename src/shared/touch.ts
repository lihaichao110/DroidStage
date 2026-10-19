/**
 * 投屏坐标换算与操控输入校验（主/渲染进程共用的纯函数）。
 * 操控走 scrcpy 控制协议，输入坐标统一为视频帧坐标（server 端自行换算到物理屏）；
 * 拾取模式命中控件仍需设备屏幕坐标，故保留帧 → 设备的方向推断与等比换算。
 */
import type { TouchAction, TouchMessageInput } from './utils/scrcpy-control-msg'
import type { ScrollInput, TouchInput } from './types'

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
/** 帧宽高按协议字段为 u16：1–65535。 */
const MAX_FRAME_SIDE = 0xffff

/**
 * 校验渲染进程送来的触摸事件并归一化为触摸注入消息描述（坐标取整）。
 * cancel 按 up 处理：scrcpy 客户端不发 CANCEL，手势结束统一以抬手收尾。
 * @returns 逐点对应的触摸消息输入（move 为多点）
 * @throws 结构不完整或数值越界时抛出（主进程拒绝转发）
 */
export function controlTouchEvents(event: TouchInput): TouchMessageInput[] {
  const frame = validFrameSize(event)
  if (event.action === 'move') {
    if (!Array.isArray(event.points) || event.points.length === 0 || event.points.length > MAX_MOVE_POINTS) {
      throw new Error('触摸轨迹点数量无效')
    }
    return event.points.map((point) => ({ action: 'move' as TouchAction, ...validPoint(point), ...frame }))
  }
  if (event.action === 'down' || event.action === 'up' || event.action === 'cancel') {
    const action: TouchAction = event.action === 'cancel' ? 'up' : event.action
    return [{ action, ...validPoint(event), ...frame }]
  }
  throw new Error('未知触摸动作')
}

/**
 * 校验滚轮输入并归一化：dy 钳制在单条消息的 ±16 格内。
 * @returns 编码 scroll 消息所需的参数
 * @throws 结构不完整或数值越界时抛出
 */
export function controlScroll(input: ScrollInput): { x: number; y: number; frameWidth: number; frameHeight: number; notches: number } {
  const frame = validFrameSize(input)
  if (typeof input?.dy !== 'number' || !Number.isFinite(input.dy)) throw new Error('滚轮参数无效')
  const point = validPoint(input)
  return { ...point, ...frame, notches: Math.max(-16, Math.min(16, input.dy)) }
}

/** 校验并返回帧尺寸（u16 范围），供消息描述合并使用。 */
function validFrameSize(input: { frameWidth?: unknown; frameHeight?: unknown }): { frameWidth: number; frameHeight: number } {
  for (const side of [input?.frameWidth, input?.frameHeight]) {
    if (typeof side !== 'number' || !Number.isInteger(side) || side <= 0 || side > MAX_FRAME_SIDE) throw new Error('投屏帧尺寸无效')
  }
  return { frameWidth: input.frameWidth as number, frameHeight: input.frameHeight as number }
}

function validPoint(point: { x?: unknown; y?: unknown }): { x: number; y: number } {
  if (!isCoord(point?.x) || !isCoord(point?.y)) throw new Error('触摸坐标无效')
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE
}
