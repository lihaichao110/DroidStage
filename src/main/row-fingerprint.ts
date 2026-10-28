/**
 * 用户行画面指纹：只在本次运行内比较滚动重叠区域，不识别或存储昵称。
 */
import type { Bounds } from '../shared/types'

const SAMPLE_WIDTH = 48 // 横向保留头像和文字纹理，降低不同用户误判为同一行的机会
const SAMPLE_HEIGHT = 16
const SAME_DISTANCE = 6
const UNCERTAIN_DISTANCE = 12

/**
 * 截取屏幕中的完整用户行并缩成灰度采样。
 * @param png 当前屏幕的 PNG 截图
 * @param bounds 用户行在屏幕上的可见边界
 * @returns 与行顺序对应的灰度指纹
 * @throws 截图或边界无效时抛出
 */
export async function rowFingerprints(png: Buffer, bounds: readonly Bounds[]): Promise<Uint8Array[]> {
  const { nativeImage } = await import('electron')
  const image = nativeImage.createFromBuffer(png)
  const size = image.getSize()
  if (image.isEmpty() || size.width <= 0 || size.height <= 0) throw new Error('用户行截图无效')
  return bounds.map((rect) => {
    const x = Math.max(0, rect.left)
    const y = Math.max(0, rect.top)
    const width = Math.min(size.width, rect.right) - x
    const height = Math.min(size.height, rect.bottom) - y
    if (width <= 0 || height <= 0) throw new Error('用户行截图边界无效')
    const bitmap = image.crop({ x, y, width, height }).resize({ width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT }).toBitmap()
    if (bitmap.length !== SAMPLE_WIDTH * SAMPLE_HEIGHT * 4) throw new Error('用户行画面采样失败')
    const sample = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT)
    for (let i = 0; i < sample.length; i++) {
      const offset = i * 4
      // Electron bitmap 使用 BGRA；灰度采样避免设备颜色配置影响同一行匹配。
      sample[i] = Math.round(bitmap[offset] * 0.114 + bitmap[offset + 1] * 0.587 + bitmap[offset + 2] * 0.299)
    }
    return sample
  })
}

/**
 * 将用户行与历史画面比较，保守区分相同、含糊与新候选。
 * @param sample 当前行指纹
 * @param skipped 历史行指纹
 * @returns 画面相似程度类别
 * @throws 指纹尺寸不一致时抛出
 */
export function skippedRowMatch(sample: Uint8Array, skipped: readonly Uint8Array[]): 'same' | 'uncertain' | 'new' {
  let closest = Number.POSITIVE_INFINITY
  for (const prior of skipped) {
    if (sample.length !== prior.length) throw new Error('用户行画面指纹尺寸不一致')
    let difference = 0
    for (let i = 0; i < sample.length; i++) difference += Math.abs(sample[i] - prior[i])
    closest = Math.min(closest, difference / sample.length)
  }
  return closest <= SAME_DISTANCE ? 'same' : closest <= UNCERTAIN_DISTANCE ? 'uncertain' : 'new'
}

/**
 * 利用相邻两屏中唯一且顺序一致的画面锚点，推断滚动后仍可见的旧行序号。
 * @param previous 上一屏的可见行指纹及行序号
 * @param current 当前屏的可见行指纹及行序号
 * @returns 上一屏序号与当前屏序号的差值，无法可靠推断时返回 null
 */
export function overlapShift(
  previous: readonly { index: number; sample: Uint8Array }[],
  current: readonly { index: number; sample: Uint8Array }[]
): number | null {
  const shifts: number[] = []
  for (const row of current) {
    const matches = previous.filter((prior) => skippedRowMatch(row.sample, [prior.sample]) === 'same')
    if (matches.length !== 1) continue
    const reverse = current.filter((candidate) => skippedRowMatch(candidate.sample, [matches[0].sample]) === 'same')
    if (reverse.length !== 1) continue
    shifts.push(matches[0].index - row.index)
  }
  return shifts.length && shifts[0] >= 0 && shifts.every((shift) => shift === shifts[0]) ? shifts[0] : null
}
