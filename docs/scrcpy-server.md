# scrcpy-server 组件说明

实时投屏功能使用 [scrcpy](https://github.com/Genymobile/scrcpy) 的设备端服务 `scrcpy-server` 采集屏幕视频：手机端用 MediaCodec 硬件编码 H.264，经 ADB 端口转发到桌面端，由渲染进程 WebCodecs 硬件解码后绘制到 canvas。本仓库使用其**视频 + 控制双通道**（`audio=false control=true raw_stream=true`）：鼠标操控（触摸/拖拽/滚动/返回/HOME）编码为 scrcpy 控制协议二进制消息（`src/shared/utils/scrcpy-control-msg.ts`）直写控制 socket，即发即弃；自研 agent 通道专职自动化任务步骤。

## 组件登记

| 项 | 值 |
| --- | --- |
| 文件 | `assets/mirroring/scrcpy-server` |
| 版本 | v5.0.1 |
| 来源 | 官方 GitHub release `scrcpy-server-v5.0.1`，未修改 |
| 许可 | Apache-2.0（`assets/mirroring/LICENSE`，允许再分发） |
| 校验 | sha256 见 `assets/mirroring/manifest.json`，`scripts/verify-release.mjs` 在打包前强制核对 |

与 ADB 的「必须自构建」红线不同：scrcpy 是 Apache-2.0 第三方开源组件，允许原样再分发，因此采用官方预编译产物入库并逐字节校验的引入方式（见 `assets/mirroring/NOTICE.md`）。

## 运行方式

桌面端主进程（`src/main/scrcpy-server.ts`）每次开启投屏时：

1. `adb push scrcpy-server /data/local/tmp/autodesk-scrcpy-server.jar`
2. `adb forward tcp:0 localabstract:scrcpy_<scid>`（scid 为随机 31 位整数，避免多实例冲突）
3. `adb shell CLASSPATH=... app_process / com.genymobile.scrcpy.Server <版本> <参数...>`
4. 按序连接转发出的本地端口两次（先 video 后 control），video 通道读取纯 H.264 字节流（`raw_stream=true` 关闭了全部协议元数据），control 通道写入操控消息

## 升级流程

1. 从官方 release 下载新版 `scrcpy-server-vX.Y`，替换 `assets/mirroring/scrcpy-server`。
2. 更新 `assets/mirroring/manifest.json`（version / upstream / sha256）与 `NOTICE.md`。
3. **同步修改 `src/main/scrcpy-server.ts` 里的 `SCRCPY_VERSION` 常量**，并按该版本 `doc/develop.md` 复核启动参数（协议无兼容承诺，版本不一致会启动失败）。
4. `node scripts/verify-release.mjs win|mac` 通过后提交。

## 已知限制（与 scrcpy 一致）

- 手机需亮屏解锁，锁屏与 `FLAG_SECURE` 页面在画面中显示为黑块。
- 个别机型 MediaCodec 编码器对低延迟参数支持不佳，失败时会把 server 日志透出为中文错误提示，不会静默降级。

## 连接时序的两条硬约束

以下两条是 `connectChannels` 重试逻辑的边界，改动前必须理解（真机上踩过）：

1. **server 的每条通道只 `accept()` 一次，且按 video → control 的顺序 accept、全部 accept 完才开始推流**（本配置 `video=true audio=false control=true` 共 2 条 socket）。由此推出三条实现规则：
   - 桌面端必须**按相同顺序**先后连接两次本地转发端口，顺序错乱会让两条通道互换、永远收不到视频数据；
   - 连接一旦被服务端 accept 就**绝不能因「短时间没有数据」而放弃**：accept 之后 server 还要等第二条通道、再初始化编码器（华为 OMX 冷启动实测可超过 2 秒），若此时客户端断开，该连接作废，后续所有重试连接都会堵在内核 accept backlog 里，直到总超时。`raw_stream=true` 关闭了 dummy byte，accept 与否只能靠「连接是否被 adb 秒断」判断——拨 video socket 后观察 150ms 宽限期，秒断即未监听（可安全重试），存活即已被 accept（绝不能再放弃）；
   - 若 video 已被 accept 而 control 连接失败，**不得盲目重试**（新连接会被 server 错记为 video 通道），直接终止本次启动；失败的 server 进程由 MirrorService 整体回收，用户「重新投屏」即自愈。
2. **scid 按十六进制解析**（`Integer.parseInt(scid, 16)`，且结果必须落在有符号 int 内），服务端 socket 名为 `scrcpy_%08x`。生成时务必限制在 `0x7FFFFFFF` 以内。

## 控制协议（v5.0.1）

操控消息由 `src/shared/utils/scrcpy-control-msg.ts` 编码（大端序，与 server 端 ControlMessageReader 逐字节对齐，黄金字节用例见 `tests/scrcpy-control-msg.test.ts`）：触摸 32 字节（pointer_id=-1 模拟单指，压力 u16 定点）、滚轮 21 字节（server 按 i16 定点 ×16 解码，单条上限 ±16 格）、按键 14 字节、BACK_OR_SCREEN_ON 2 字节（息屏时自动转为电源键，右键即能唤醒）。坐标空间为视频帧坐标，server 端自行换算到物理屏（含旋转）。协议**无版本兼容承诺**，升级 server 时必须逐字段复核编码器与用例。

## 已知设备问题：/data/local/tmp 被系统定期清理

部分华为（EMUI，实测 ELE-AL00 / Android 10）、小米等国产系统会**在文件落盘后几分钟内主动删除 `/data/local/tmp` 下的内容**。影响与对策：

- 已拉起的 server 不受影响（dex 已 mmap，删除不失效），但**重新投屏时 jar 可能已不在**，`app_process` 会以 `ClassNotFoundException` → SIGABRT 退出。
- 每次开启投屏都会重新 `adb push`，因此「重新投屏」即可自愈；错误提示中已包含该排查方向。
- 若更换缓存路径（如 `/data/local/tmp` 子目录），需先验证目标路径不会被同样清理。
