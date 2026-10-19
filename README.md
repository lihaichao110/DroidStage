# DroidStage

通过 USB 和 ADB 在电脑上编辑、运行安卓 App 自动化流程。桌面端使用 Electron、React、TypeScript；手机端使用 Kotlin 与 AndroidX UI Automator 2.4.0。第一版支持一台 Android 10+ 手机、Windows 10/11 x64、macOS 13+ Intel/Apple Silicon。

## 用户使用

安装发行包，连接已开启 USB 调试并保持解锁的手机，在手机上接受调试授权。选择设备并点击“连接”；应用自动安装两个辅助 APK，随后手机画面以低延迟实时投屏呈现（scrcpy 方案：设备端硬件编码 H.264 + 桌面端 WebCodecs 硬件解码）。「操控」模式下可直接用鼠标点按、拖拽、滚轮与右键返回操作手机；切到「拾取」模式后点选画面中的控件并添加步骤，再保存或运行任务。目标 App 包名可选：连接后自动填入当前前台应用，留空则运行时不自动启动 App、直接在当前界面执行。任务文件是本地 JSON；运行日志和失败截图保存在应用数据目录的 `runs` 下。

普通 App 的控件需暴露在 Android 无障碍控件树中。自绘界面可用坐标点击，但布局或分辨率变化会影响重放。锁屏与受保护（FLAG_SECURE）画面在投屏中显示为黑块，与 scrcpy 行为一致。部分 Windows 机型须先安装厂商 USB 驱动；应用提供诊断入口。没有 Apple Developer ID 时，macOS 内部分发包需要用户手动允许打开。

## 开发

```text
npm ci
npm test
npm run dev
npm run build
```

开发时可通过环境变量 `ADB_PATH` 指向本机开发用 ADB；发行构建不会采用该变量。连接真实手机仍需 `assets/agent/host.apk`、`test.apk`。若组件缺失，界面会显示明确错误，不会假装已连接。

Android 辅助包使用 JDK 17、Android SDK Platform 35、Build-Tools 34.0.0、Gradle 8.9 构建：

```text
cd android
./gradlew assembleDebug assembleDebugAndroidTest
cd ..
npm run stage:agent
```

## 自构建 ADB 与发行

发行包不得依赖用户另行安装 Platform-Tools。ADB 必须从固定 AOSP 修订号自行构建并审查依赖许可；不要直接复制 Google SDK 下载包。使用 `scripts/stage-adb.mjs` 登记 Windows x64、macOS Intel、macOS Apple Silicon 构建产物，附完整第三方许可清单。根目录 `assets/adb/NOTICE` 保留 AOSP 的 Apache 2.0 许可与版权声明。打包脚本会核对 SHA-256、APK、许可清单，任何组件缺失就拒绝生成安装包。

```text
node scripts/stage-adb.mjs win32 <AOSP_REVISION> <构建产物目录> <第三方许可清单>
node scripts/stage-adb.mjs darwin-x64 <AOSP_REVISION> <构建产物目录> <第三方许可清单>
node scripts/stage-adb.mjs darwin-arm64 <AOSP_REVISION> <构建产物目录> <第三方许可清单>
npm run dist:win
npm run dist:mac
```

完整的构建环境准备与操作步骤见 [docs/self-build-adb.md](docs/self-build-adb.md)。实时投屏使用的 scrcpy-server（Apache-2.0 第三方组件）以官方预编译产物入库并逐字节校验，见 [docs/scrcpy-server.md](docs/scrcpy-server.md)。

ADB 源码：[AOSP 仓库](https://android.googlesource.com/platform/packages/modules/adb/)。Windows 驱动限制：[Android 官方说明](https://developer.android.com/studio/run/oem-usb)。

## 当前验证范围

`npm run build` 和 `npm test` 验证桌面端代码。Android APK 必须成功构建后才能连接实体机；Windows/macOS 的 ADB 二进制、USB 驱动及 macOS 安装体验必须在对应系统与实体机上完成发行验收。
