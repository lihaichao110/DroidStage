# scrcpy-server 第三方组件声明

- 组件：`scrcpy-server`（设备端投屏服务，运行时经 `adb push` + `app_process` 启动，仅采集屏幕视频流）
- 上游：<https://github.com/Genymobile/scrcpy>
- 版本：v5.0.1（官方 release 产物 `scrcpy-server-v5.0.1`，未做任何修改）
- 许可：Apache License 2.0（全文见同目录 `LICENSE`）
- SHA-256：`764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`（与官方 release 的 `SHA256SUMS.txt` 一致）

版本升级必须：更新本文件与 `manifest.json` → 替换 `scrcpy-server` 二进制 → **同步修改 `src/main/scrcpy-server.ts` 中的版本常量与启动参数**（scrcpy 服务端协议无版本兼容承诺，客户端/服务端版本不一致会直接失败）→ 运行 `node scripts/verify-release.mjs win|mac` 校验。详见 `docs/scrcpy-server.md`。
