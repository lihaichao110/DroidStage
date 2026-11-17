# 自构建 ADB 指南

> 本文档说明如何从固定 AOSP 修订号构建 ADB 并登记进发行包。这是发行前的**必经步骤**，由 `scripts/stage-adb.mjs` 登记、`scripts/verify-release.mjs` 校验。

## 为什么必须自构建

Google 官网下载的 Platform-Tools（SDK 组件）受《Android SDK 许可协议》约束，**禁止将其二进制再分发**给最终用户，直接复制进安装包有法律风险。AOSP 源码采用 Apache 2.0 许可，自己从源码编译出的 `adb` 二进制可以合法随软件分发。因此 AGENTS.md 将其列为硬性约束：发行 ADB 必须自构建。

开发调试不受此限：用 README 所述的 `ADB_PATH` 环境变量指向本机 ADB 即可（发行构建会忽略该变量）。

## 产物要求

`scripts/verify-release.mjs` 的校验规则即产物契约：

| 平台 | 目录 | 必需文件 |
| --- | --- | --- |
| Windows x64 | `assets/adb/win32/` | `adb.exe` 及其依赖 DLL、`manifest.json` |
| macOS Apple Silicon | `assets/adb/darwin-arm64/` | `adb`、`manifest.json` |
| macOS Intel | `assets/adb/darwin-x64/` | （暂未登记；将来支持 Intel Mac 时按同流程补齐） |

> mac 发行当前只打 Apple Silicon 单架构：`dist:mac` 仅 `--arm64`，`verify-release.mjs mac` 只校验 `darwin-arm64`。

另需 `assets/adb/NOTICE`（AOSP Apache 2.0 声明，已存在）与 `assets/adb/THIRD_PARTY_NOTICES`（第三方依赖许可清单，登记时由脚本复制）。`manifest.json` 由登记脚本生成，记录 40 位 AOSP 修订号与每个文件的 SHA-256。

## Windows x64 本次已验证的构建路线

本项目当前 Windows 包中的 `adb.exe` 是在 Windows 的 MSYS2 UCRT64 环境中，从 [nmeum/android-tools 37.0.0 源码包](https://github.com/nmeum/android-tools/releases/tag/37.0.0)本地编译的。该源码包汇集并修补 AOSP 源码，避免同步整个 Android 系统。源码包 SHA-256 为 `2725d09f892a3a38e534429f47a321f58ecf6a3169caa42c915fb2cb7d46be0e`；其中 ADB 对应的 [AOSP `android-17.0.0_r1` 修订号](https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-17.0.0_r1)为 `9084198a2d4b0f6a0f174260fb42da33485b684d`，已写入 `manifest.json`。

构建使用 MSYS2 UCRT64 的 GCC、CMake、Ninja 和所需开发库，并对源码包应用 Windows 编译兼容补丁。构建产物位于 CMake 输出的 `vendor/adb.exe`。发行目录须同时收集 `AdbWinApi.dll`、`AdbWinUsbApi.dll` 和此可执行文件实际引用的 UCRT64 运行时 DLL；仅有 `adb.exe` 无法在干净的目标电脑启动。可以用 `objdump -p adb.exe` 逐层检查导入表，确认所有非系统 DLL 都在同一目录。

收集完成后，用系统目录作为唯一 `PATH` 运行发行目录的 `adb.exe version` 和 `adb.exe devices -l`，确保没有借用构建机上的 MSYS2 DLL。`npm run dist:win` 还会自动检查包内文件哈希，并以同样方式启动包内 ADB。MSYS2 工具链只用于**构建机**，不要求最终用户安装。

## macOS Apple Silicon 构建路线

> ⚠️ 本路线尚未在 Apple Silicon 上完整实测（Windows 路线是已验证路线）。首次构建时如遇依赖缺失或编译错误，解决后请把**最终可用的依赖清单与命令回填到本节**，保持文档与实际一致——不允许假装已验证。

源码包与 Windows 路线同源：[nmeum/android-tools 37.0.0](https://github.com/nmeum/android-tools/releases/tag/37.0.0)（SHA-256 `2725d09f892a3a38e534429f47a321f58ecf6a3169caa42c915fb2cb7d46be0e`），AOSP 修订号同为 `9084198a2d4b0f6a0f174260fb42da33485b684d`（`android-17.0.0_r1`），保证两端 ADB 同版本。

### 工具链与依赖

```bash
xcode-select --install   # clang（Command Line Tools）
brew install cmake ninja protobuf libusb lz4 brotli
```

以上是基础依赖集合，按 cmake 配置阶段的报错增减（boringssl、zlib 等由源码包自带或系统 SDK 提供）。`openssl@3` 是 keg-only，如被引用需追加 `-DCMAKE_PREFIX_PATH=$(brew --prefix openssl@3)`。

### 编译

```bash
curl -LO https://github.com/nmeum/android-tools/releases/download/37.0.0/android-tools-37.0.0.tar.xz
shasum -a 256 android-tools-37.0.0.tar.xz   # 应等于 2725d09f…46be0e
tar -xf android-tools-37.0.0.tar.xz && cd android-tools-37.0.0
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
cmake --build build --target adb
```

产物在 `build/vendor/adb`。**优先静态链接**（`-DBUILD_SHARED_LIBS=OFF`）：macOS 没有 Windows 那套"随包带 DLL"的惯例，链接 Homebrew 动态库（`/opt/homebrew/...`）的产物在未装 Homebrew 的电脑上无法启动。编译完成后用 `otool -L build/vendor/adb` 检查：允许的动态库依赖仅限 `/usr/lib` 与 `/System` 前缀；出现 Homebrew 路径时改用静态链接或用 `install_name_tool` 改写后随包登记，不得放过。

### 冒烟与登记

```bash
# 用干净 PATH 冒烟，确保没借用构建机 Homebrew 组件
env -i PATH=/usr/bin:/bin HOME="$HOME" build/vendor/adb version
# 按下节整理许可清单后登记、校验
node scripts/stage-adb.mjs darwin-arm64 9084198a2d4b0f6a0f174260fb42da33485b684d <构建产物目录> THIRD_PARTY_NOTICES
node scripts/verify-release.mjs mac
```

### 提交时的执行位

`stage-adb.mjs` 复制文件会保留源文件执行位，但 **git 在 Windows 宿主机上不跟踪执行位**。必须在 Mac 上登记并提交，提交前确认：

```bash
git ls-files -s assets/adb/darwin-arm64/adb   # mode 应为 100755；若显示 100644 则执行：
git update-index --chmod=+x assets/adb/darwin-arm64/adb
```

`verify-release.mjs` 在类 Unix 宿主机上会校验 `darwin-arm64/adb` 的执行位，从 Windows 误提交的 644 文件会被拦截。

## 整理第三方许可清单

ADB 依赖多个第三方模块（boringssl、zlib、lz4、brotli、protobuf、libusb 等，随分支不同而变化）。构建完成后，从源码树收集实际参与编译的模块许可：

```bash
find packages/modules/adb system/core system/libbase system/logging \
     external/boringssl external/zlib external/lz4 external/brotli \
     external/protobuf external/libusb \
     -maxdepth 2 \( -name 'NOTICE' -o -name 'LICENSE' -o -name 'COPYING' \) 2>/dev/null
```

将各模块名称、许可类型与原文合并为一份 `THIRD_PARTY_NOTICES` 文本文件。哪些模块真正链进了二进制，以构建产物依赖为准，清单必须与实际一致——这是发行审查的一部分。

## 登记与校验

在仓库根目录执行（`<构建产物目录>` 为上一步收集的 `adb.exe`/`adb` 及相关文件所在目录）：

```bash
node scripts/stage-adb.mjs win32        <40位AOSP修订号> <构建产物目录> THIRD_PARTY_NOTICES
node scripts/stage-adb.mjs darwin-arm64 <40位AOSP修订号> <构建产物目录> THIRD_PARTY_NOTICES
node scripts/verify-release.mjs win     # 或 mac
```

校验通过后再执行 `npm run dist:win` / `npm run dist:mac` 打包。

自动发布前，还需将各平台的自构建 ADB 目录、生成的 `manifest.json` 和 `assets/adb/THIRD_PARTY_NOTICES` 一起提交到仓库。GitHub Actions 从标签对应的提交读取这些文件，不会在发布时从 Google SDK 下载 ADB；任何平台文件或许可清单缺失，发行校验都会失败。

另注意 `stage-adb.mjs` 每次登记都会**覆盖**共享的 `assets/adb/THIRD_PARTY_NOTICES`。macOS 与 Windows 依赖的第三方模块集合基本一致，但在 Mac 上重新登记时仍需重新收集清单，确保内容覆盖实际链入两端二进制的全部模块。

## 常见问题

- **构建结果复现**：保留源码包的 URL 和 SHA-256、AOSP 修订号、补丁、MSYS2 软件包版本及第三方许可清单。更换编译器或依赖版本后，应重新构建并登记哈希。
- **目标电脑缺少 DLL**：重新检查可执行文件及其依赖 DLL 的导入表，并将缺失的非系统 DLL 一起登记；不要让目标用户另行安装 MSYS2。
