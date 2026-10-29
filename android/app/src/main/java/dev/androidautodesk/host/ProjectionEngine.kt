/**
 * 手机端录屏：经用户授权的 MediaProjection 提供 PNG 截图与 H.264 视频流。
 */
package dev.androidautodesk.host

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.Executors

internal object ProjectionEngine {
    private var projection: MediaProjection? = null
    private var encoder: MediaCodec? = null
    private var videoDisplay: VirtualDisplay? = null
    private var videoRunning = false
    private val videoWorker = Executors.newSingleThreadExecutor()

    /** 每次手机界面授权只保留一个投屏令牌；被系统撤销时立即停流。 */
    @Synchronized fun start(context: Context, resultCode: Int, data: Intent) {
        stop()
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = manager.getMediaProjection(resultCode, data)
        projection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { stop() }
        }, Handler(Looper.getMainLooper()))
        CompanionService.hasProjection = projection != null
    }

    @Synchronized fun stop() {
        stopMirror()
        projection?.stop()
        projection = null
        CompanionService.hasProjection = false
    }

    /** 返回当前屏幕 PNG；仅对支持多虚拟显示的 Android 10–13 直连模式开放。 */
    fun screenshot(context: Context): ByteArray {
        val active = projection ?: error("请先在手机上允许录屏")
        val metrics = metrics(context)
        val reader = ImageReader.newInstance(metrics.widthPixels, metrics.heightPixels, PixelFormat.RGBA_8888, 2)
        val display = active.createVirtualDisplay("DroidStage 截图", metrics.widthPixels, metrics.heightPixels,
            metrics.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, null)
        try {
            val deadline = System.currentTimeMillis() + 3000
            var image = reader.acquireLatestImage()
            while (image == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(50)
                image = reader.acquireLatestImage()
            }
            image ?: error("屏幕没有返回图像，请检查录屏授权")
            image.use {
                val plane = it.planes[0]
                val width = it.width
                val height = it.height
                val rowPixels = plane.rowStride / plane.pixelStride
                val bitmap = Bitmap.createBitmap(rowPixels, height, Bitmap.Config.ARGB_8888)
                bitmap.copyPixelsFromBuffer(plane.buffer)
                val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)
                val out = ByteArrayOutputStream()
                if (!cropped.compress(Bitmap.CompressFormat.PNG, 100, out)) error("截图编码失败")
                bitmap.recycle()
                cropped.recycle()
                return out.toByteArray()
            }
        } finally { display.release(); reader.close() }
    }

    /** H.264 Annex-B 字节通过 TLS 事件发给桌面端，沿用现有 WebCodecs 解码器。 */
    @Synchronized fun startMirror(context: Context, maxSize: Int, bitRate: Int, fps: Int, send: (JSONObject) -> Unit): JSONObject {
        val active = projection ?: error("请先在手机上允许录屏")
        stopMirror()
        val physical = metrics(context)
        val scale = minOf(1.0, maxSize.toDouble() / maxOf(physical.widthPixels, physical.heightPixels))
        val width = ((physical.widthPixels * scale).toInt() / 2 * 2).coerceAtLeast(2)
        val height = ((physical.heightPixels * scale).toInt() / 2 * 2).coerceAtLeast(2)
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = codec.createInputSurface()
        codec.start()
        val display = active.createVirtualDisplay("DroidStage 投屏", width, height, physical.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null)
        encoder = codec
        videoDisplay = display
        videoRunning = true
        videoWorker.execute {
            val info = MediaCodec.BufferInfo()
            try {
                while (videoRunning) {
                    val index = codec.dequeueOutputBuffer(info, 500000)
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val output = codec.outputFormat
                        for (key in listOf("csd-0", "csd-1")) {
                            output.getByteBuffer(key)?.let { sendVideo(it, send) }
                        }
                    } else if (index >= 0) {
                        codec.getOutputBuffer(index)?.let { buffer ->
                            buffer.position(info.offset)
                            buffer.limit(info.offset + info.size)
                            if (info.size > 0) sendVideo(buffer, send)
                        }
                        codec.releaseOutputBuffer(index, false)
                    }
                }
            } catch (_: Exception) { videoRunning = false }
        }
        return JSONObject().put("physicalWidth", physical.widthPixels).put("physicalHeight", physical.heightPixels)
            .put("videoWidth", width).put("videoHeight", height)
    }

    private fun sendVideo(buffer: ByteBuffer, send: (JSONObject) -> Unit) {
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        send(JSONObject().put("event", "video").put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
    }

    @Synchronized fun stopMirror() {
        videoRunning = false
        videoDisplay?.release()
        videoDisplay = null
        try { encoder?.stop() } catch (_: Exception) { }
        encoder?.release()
        encoder = null
    }

    private fun metrics(context: Context): DisplayMetrics = context.resources.displayMetrics
}
