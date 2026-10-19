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
| macOS Intel | `assets/adb/darwin-x64/` | `adb`、`manifest.json` |
| macOS Apple Silicon | `assets/adb/darwin-arm64/` | `adb`、`manifest.json` |

另需 `assets/adb/NOTICE`（AOSP Apache 2.0 声明，已存在）与 `assets/adb/THIRD_PARTY_NOTICES`（第三方依赖许可清单，登记时由脚本复制）。`manifest.json` 由登记脚本生成，记录 40 位 AOSP 修订号与每个文件的 SHA-256。

## 构建环境

- Linux x86_64 主机（Ubuntu 22.04+），或 Windows 上的 WSL2 Ubuntu
- 内存 ≥ 16GB，空闲磁盘 ≥ 250GB（AOSP 源码 + 编译产物）
- 官方环境要求以所选分支的文档为准：<https://source.android.com/docs/setup/start/requirements>

macOS 版 ADB 需在对应架构的 Mac 上构建（Apple Silicon 机型可同时产出 x64/arm64 的 universal 二进制，取决于所选 AOSP 分支的 host 工具链支持）。

## 构建步骤（Windows 版 ADB）

Windows 版 `adb.exe` 在 Linux 上通过 AOSP 的 MinGW 交叉编译产出，**不要在 Windows 上直接构建**。

```bash
# 1. 安装 repo 与编译依赖
sudo apt-get install git-core gnupg flex bison build-essential zip curl \
  zlib1g-dev libc6-dev-i386 libncurses5 lib32ncurses5-dev x11proto-core-dev \
  libx11-dev lib32z1-dev libgl1-mesa-dev libxml2-utils xsltproc unzip
mkdir -p ~/bin && curl https://storage.googleapis.com/git-repo-downloads/repo > ~/bin/repo
chmod +x ~/bin/repo

# 2. 选一个固定的 release tag（不要用滚动分支）
#    完整列表：https://android.googlesource.com/platform/manifest/+refs/tags
#    国内网络可改用 TUNA 镜像：https://mirrors.tuna.tsinghua.edu.cn/help/AOSP/
mkdir aosp && cd aosp
repo init -u https://android.googlesource.com/platform/manifest -b android-15.0.0_r1 --depth=1 -c
repo sync -j8

# 3. 记录本次构建的 AOSP 修订号（40 位，登记脚本需要）
git -C .repo/manifests rev-parse HEAD

# 4. 构建 Windows 版 ADB
source build/envsetup.sh
lunch sdk-eng
m win_sdk

# 5. 收集产物（路径以实际输出为准，不同分支可能有差异）
ls out/host/windows-x86/bin/adb.exe
ls out/host/windows-x86/bin/AdbWinApi.dll out/host/windows-x86/bin/AdbWinUsbApi.dll
```

> 注：`lunch` 目标与产物路径随 AOSP 分支演进可能变化，构建前请先查阅所选分支对应的官方构建文档 <https://source.android.com/docs/setup/build/building>；若 `win_sdk` 目标不存在，改查该分支是否提供等价的 Windows host 工具目标。

macOS 版在 Mac 上执行同样的 `repo init/sync` 后：

```bash
source build/envsetup.sh
lunch sdk-eng   # 或所选分支文档指定的 host 目标
m adb
ls out/host/darwin-x86/bin/adb
```

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
node scripts/stage-adb.mjs darwin-x64   <40位AOSP修订号> <构建产物目录> THIRD_PARTY_NOTICES
node scripts/stage-adb.mjs darwin-arm64 <40位AOSP修订号> <构建产物目录> THIRD_PARTY_NOTICES
node scripts/verify-release.mjs win     # 或 mac
```

校验通过后再执行 `npm run dist:win` / `npm run dist:mac` 打包。

## 常见问题

- **磁盘不够**：`repo sync` 加 `--depth=1 -c` 只拉当前分支浅克隆；仍不足则只能扩容，没有更小的合规路线。
- **国内网络拉不动**：使用 TUNA AOSP 镜像（见上），`repo init -u https://mirrors.tuna.tsinghua.edu.cn/git/AOSP/platform/manifest`。
- **构建结果复现**：用 `repo manifest -r -o pinned.xml` 固化全部项目的修订号，归档 `pinned.xml` 以便日后复建同一版本。
- **WSL2**：步骤完全相同，注意给 WSL 分配足够内存（`.wslconfig` 中 `memory=16GB`），并把源码放在 WSL 原生文件系统（`~/`）而非 `/mnt/c`，否则编译极慢。
