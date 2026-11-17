# macOS 安装包构建指南（Apple Silicon）

> 本文档是 macOS 发行包的完整操作流程，从零到产出 `卓序-<version>-arm64.dmg / .zip`。ADB 自构建的原理与细节见 [self-build-adb.md](self-build-adb.md)，本文只引用其结论性步骤。mac 发行当前仅打 Apple Silicon 单架构（未签名）；将来支持 Intel Mac 时按 self-build-adb.md 补 `darwin-x64` 并恢复双架构配置。

## 0. 前置条件

- Apple Silicon Mac，macOS 13+
- Xcode Command Line Tools 与 Homebrew
- 仓库最新代码（含 `assets/adb/win32/`，`darwin-arm64` 会在第 2 步登记）

```bash
git pull && pnpm install
xcode-select --install
```

## 1. 自构建 ADB（首次约 10–20 分钟）

```bash
brew install cmake ninja protobuf libusb lz4 brotli
curl -LO https://github.com/nmeum/android-tools/releases/download/37.0.0/android-tools-37.0.0.tar.xz
shasum -a 256 android-tools-37.0.0.tar.xz   # 应等于 2725d09f892a3a38e534429f47a321f58ecf6a3169caa42c915fb2cb7d46be0e
tar -xf android-tools-37.0.0.tar.xz && cd android-tools-37.0.0
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
cmake --build build --target adb
otool -L build/vendor/adb   # 动态库依赖仅允许 /usr/lib 与 /System 前缀
```

依赖缺失、编译报错、`otool` 出现 Homebrew 路径时的处置方式，见 self-build-adb.md「macOS Apple Silicon 构建路线」；解决后把最终命令回填到那边。

## 2. 整理许可清单并登记

```bash
# 在源码树按 self-build-adb.md「整理第三方许可清单」收集合并为 THIRD_PARTY_NOTICES
cd <仓库根目录>
node scripts/stage-adb.mjs darwin-arm64 9084198a2d4b0f6a0f174260fb42da33485b684d <构建产物目录> THIRD_PARTY_NOTICES
node scripts/verify-release.mjs mac   # 应输出「mac 发行组件校验通过」
```

登记会覆盖共享的 `assets/adb/THIRD_PARTY_NOTICES`，需确认清单覆盖实际链入两端二进制的模块。

## 3. 提交执行位

`stage-adb` 复制保留执行位，但必须**在 Mac 上提交**（Windows 宿主机的 git 不跟踪执行位）：

```bash
git add assets/adb/darwin-arm64
git ls-files -s assets/adb/darwin-arm64/adb   # mode 应为 100755；若为 100644：
git update-index --chmod=+x assets/adb/darwin-arm64/adb
git commit -m "chore: 登记 darwin-arm64 自构建 ADB"
```

## 4. 打包

```bash
npm run dist:mac
```

内部顺序：`npm run build`（tsc 严格检查 + electron-vite 构建）→ `verify-release.mjs mac` → electron-builder 打 `dmg + zip`（arm64）。产物在 `release/`：

- `卓序-<version>-arm64.dmg`
- `卓序-<version>-arm64.zip`

**网络备注**：electron-builder 需联网下载 mac arm64 版 Electron 二进制。公司网络连不上 GitHub 时设置镜像后再打包：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:mac
```

建议打包前清空 `release/` 里残留的旧产物，避免混淆。

## 5. 安装与首次运行（未签名包）

1. 打开 dmg，将「卓序」拖入「应用程序」
2. **首次启动**：在「应用程序」中右键「卓序」→「打开」→ 再点「打开」（Gatekeeper 放行未签名应用）
3. 若系统提示“应用已损坏，无法打开”（多见于经聊天工具/AirDrop 传输被附加隔离属性），执行：

```bash
xattr -cr /Applications/卓序.app
```

## 6. 发行验收

安装包在本机之外的目标 Mac 上完成：

- 安装、启动无报错（包内 ADB 缺失会明确报「安装包缺少 ADB 组件」）
- USB 连接 Android 手机（macOS 免装厂商驱动）→ 设备列表出现 → 连接 → 刷新层级 → 投屏
- 跑一个最小任务（点击 + 断言）确认执行链路
