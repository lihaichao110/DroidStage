/**
 * scrcpy 控制协议（v5.0.1）消息编码：把桌面端鼠标手势编码为二进制控制消息，
 * 由主进程直写控制 socket。字段全部大端序，与 server 端 ControlMessageReader 逐字节对齐；
 * 协议无版本兼容承诺，升级 server 时必须逐字段复核本文件。
 */

/** 控制消息 type ID（对应 server 端 ControlMessage.TYPE_* 常量）。 */
export const CONTROL_MSG_TYPE = {
  INJECT_KEYCODE: 0,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4
} as const

/** MotionEvent action（android.view.MotionEvent）：鼠标模拟单指触摸只用这三个。 */
export const MOTION_ACTION = { DOWN: 0, UP: 1, MOVE: 2 } as const

/** 按键事件 action：0 = 按下，1 = 抬起。 */
export type KeyEventAction = 0 | 1

/** MotionEvent 左键位（AMOTION_EVENT_BUTTON_PRIMARY）。 */
const BUTTON_PRIMARY = 0x1

/** AKEYCODE_HOME：中键映射为 HOME 键。 */
export const AKEYCODE_HOME = 3

/** 鼠标指针 ID：scrcpy 约定 -1 表示由鼠标模拟的单指触摸。 */
const POINTER_ID_MOUSE = -1n

export type TouchAction = 'down' | 'move' | 'up'

export type TouchMessageInput = {
  action: TouchAction
  x: number
  y: number
  /** 坐标所在的视频帧尺寸：server 端据此把帧坐标换算到物理屏（含旋转）。 */
  frameWidth: number
  frameHeight: number
}

/**
 * 编码触摸注入消息（32 字节）。
 * 压力按下/移动为 1.0、抬起为 0；action_button 只在手势起止携带（与 scrcpy 客户端一致），
 * 按住期间 buttons 保持左键位——server 端据此将事件判定为手指触摸（SOURCE_TOUCHSCREEN）。
 * @param input 帧坐标（内部取整），坐标与帧尺寸的合法性由调用方校验
 */
export function encodeTouchEvent(input: TouchMessageInput): Buffer {
  const action = input.action === 'down' ? MOTION_ACTION.DOWN : input.action === 'move' ? MOTION_ACTION.MOVE : MOTION_ACTION.UP
  // 抬起时压力与 buttons 归零；其余时刻视为按住状态
  const isPressed = input.action !== 'up'
  const buffer = Buffer.alloc(32)
  buffer.writeUInt8(CONTROL_MSG_TYPE.INJECT_TOUCH_EVENT, 0)
  buffer.writeUInt8(action, 1)
  buffer.writeBigInt64BE(POINTER_ID_MOUSE, 2)
  buffer.writeInt32BE(Math.round(input.x), 10)
  buffer.writeInt32BE(Math.round(input.y), 14)
  buffer.writeUInt16BE(input.frameWidth, 18)
  buffer.writeUInt16BE(input.frameHeight, 20)
  // 压力为 u16 定点（0xFFFF ↔ 1.0）：按住即满压力，鼠标模拟无需压感层次
  buffer.writeUInt16BE(isPressed ? 0xffff : 0x0000, 22)
  buffer.writeUInt32BE(input.action === 'move' ? 0 : BUTTON_PRIMARY, 24)
  buffer.writeUInt32BE(isPressed ? BUTTON_PRIMARY : 0, 28)
  return buffer
}

/**
 * 编码滚轮消息（21 字节）。notches 为滚轮格数（可带小数，触控板平滑滚动）。
 * server 端按「i16 定点 × 16」解码，因此编码时换算为 notches/16 的 i16 定点，
 * 单条消息有效范围 ±16 格，超出部分钳制。
 */
export function encodeScrollEvent(input: { x: number; y: number; frameWidth: number; frameHeight: number; notches: number }): Buffer {
  const buffer = Buffer.alloc(21)
  buffer.writeUInt8(CONTROL_MSG_TYPE.INJECT_SCROLL_EVENT, 0)
  buffer.writeInt32BE(Math.round(input.x), 1)
  buffer.writeInt32BE(Math.round(input.y), 5)
  buffer.writeUInt16BE(input.frameWidth, 9)
  buffer.writeUInt16BE(input.frameHeight, 11)
  buffer.writeInt16BE(scrollToI16(0), 13) // hscroll：鼠标场景无水平滚动，恒为 0
  buffer.writeInt16BE(scrollToI16(input.notches), 15)
  buffer.writeUInt32BE(0, 17) // buttons：滚轮操作时无按键按住
  return buffer
}

/** 滚轮格数 → i16 定点：先钳制 ±16 格，再按 notches/16 编码（round(notches × 2048)）。 */
function scrollToI16(notches: number): number {
  const clamped = Math.max(-16, Math.min(16, notches))
  return Math.max(-0x8000, Math.min(0x7fff, Math.round(clamped * 2048)))
}

/**
 * 编码按键消息（14 字节）。repeat/meta 恒为 0：鼠标快捷键场景没有组合键需求。
 * @param keyCode Android AKEYCODE_* 键值
 * @param action 0 = 按下，1 = 抬起
 */
export function encodeKeycodeEvent(keyCode: number, action: KeyEventAction): Buffer {
  const buffer = Buffer.alloc(14)
  buffer.writeUInt8(CONTROL_MSG_TYPE.INJECT_KEYCODE, 0)
  buffer.writeUInt8(action, 1)
  buffer.writeUInt32BE(keyCode, 2)
  buffer.writeUInt32BE(0, 6)
  buffer.writeUInt32BE(0, 10)
  return buffer
}

/** 编码 BACK_OR_SCREEN_ON（2 字节）：亮屏时注入返回，息屏时由 server 转为电源键（右键唤醒靠它）。 */
export function encodeBackOrScreenOn(action: KeyEventAction): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt8(CONTROL_MSG_TYPE.BACK_OR_SCREEN_ON, 0)
  buffer.writeUInt8(action, 1)
  return buffer
}

/** 完整点击 = 按下 + 抬起两条消息。 */
export function encodeKeyClick(keyCode: number): Buffer[] {
  return [encodeKeycodeEvent(keyCode, 0), encodeKeycodeEvent(keyCode, 1)]
}

/** 返回键完整点击（息屏时等效电源键点击）。 */
export function encodeBackClick(): Buffer[] {
  return [encodeBackOrScreenOn(0), encodeBackOrScreenOn(1)]
}
