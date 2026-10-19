ADB 二进制必须由固定 AOSP 源码修订号构建，分别放在 win32、darwin-x64、darwin-arm64 子目录。每个目录需有 manifest.json，记录 aospRevision 和每个文件的 SHA-256。根目录需有完整的 NOTICE 和第三方依赖许可清单。发行前运行 `node scripts/verify-release.mjs win|mac`。
