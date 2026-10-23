# DroidStage

通过 USB 或无线 ADB 在电脑上编辑、运行安卓 App 自动化流程。桌面端使用 Electron、React、TypeScript；手机端使用 Kotlin 与 AndroidX UI Automator 2.4.0。自动化任务支持多台 Android 10+ 手机、Windows 10/11 x64、macOS 13+ Intel/Apple Silicon。Android 11+ 可在软件内无线配对；Android 10 及以下可先用 USB 授权，再切换到无线 ADB，但 Android 9 及以下尚不能运行任务。

## 用户使用

安装发行包后，在“设备管理”页连接已开启 USB 调试并授权的手机；Android 11+ 可输入手机无线调试页面显示的配对地址、配对码和连接地址。Android 10 及以下可选中已授权的 USB 设备，输入手机局域网 IP，一键切换到 5555 端口无线连接；手机与电脑需处于可互通网络。连接时会安装两个辅助 APK。“任务编辑”页选择一台设备拾取控件或操控画面，并独立勾选一台或多台运行目标；同一任务会在目标设备上并行、独立执行，单台失败不会停止其他设备。“设备画面”页每页最多同时监看六台已连接设备；“运行记录”页查看各设备进度、日志与结果。目标 App 包名可选：连接后自动填入当前前台应用，留空则运行时不自动启动 App、直接在当前界面执行。任务文件是设备无关的本地 JSON；运行日志和失败截图保存在应用数据目录的 `runs` 下。

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

## 自动发布

GitHub Actions 在分支推送和 Pull Request 时继续运行桌面端与 Android 代理验证。正式发行由 `vX.Y.Z` 标签触发：标签必须指向 `main` 历史中的提交，且 `X.Y.Z` 与 `package.json` 的版本一致。发布工作流重新运行测试、构建 Android 辅助 APK，并分别在 Windows、macOS 上打包；五个安装包全部成功后，才创建 GitHub Release，同时附上 `SHA256SUMS.txt`。

首次发布前，必须按自构建指南备齐并提交 `assets/adb/win32/`、`assets/adb/darwin-x64/`、`assets/adb/darwin-arm64/` 和 `assets/adb/THIRD_PARTY_NOTICES`。缺失时发行校验会失败，不会发布不完整的安装包。不要将 Google SDK Platform-Tools 的二进制代替自构建 ADB。准备就绪后按以下顺序发布：

```text
npm version <X.Y.Z> --no-git-tag-version
# 提交 package.json、package-lock.json，合并到 main，等待验证通过
git switch main
git pull --ff-only
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

Release 包含 Windows x64 NSIS 安装程序，以及 macOS Intel、Apple Silicon 各自的 DMG 和 ZIP。首版未签名、未做 Apple 公证；macOS 可能要求用户手动允许打开。标签版本不符、发行组件缺失、测试或任何平台构建失败时，不会发布正式 Release。

## 当前验证范围

`npm run build` 和 `npm test` 验证桌面端代码。Android APK 必须成功构建后才能连接实体机；Windows/macOS 的 ADB 二进制、USB 驱动及 macOS 安装体验必须在对应系统与实体机上完成发行验收。
