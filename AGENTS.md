# AGENTS.md — 项目编码规范

> 本文件是本仓库所有协作者（包括 AI 编码助手）必须遵守的约定。修改代码前先读本文件；本文件与代码冲突时，以本文件为准并同步修正代码。

## 1. 项目概述

AndroidAutoDesk 是一个 Android 自动化桌面工具：桌面端连接手机，下发自动化任务（输入、点击、断言、截图等），由手机端的 instrument 代理执行。

**技术栈**

| 端 | 技术 |
| --- | --- |
| 桌面端 | Electron 44 + electron-vite + React 19 + TypeScript（strict） |
| 手机端 | Kotlin + AndroidX UI Automator（`android/` 独立 Gradle 工程） |
| 测试 | Vitest（仅测桌面端纯逻辑，见 `tests/`） |
| 打包 | electron-builder（Win NSIS / macOS dmg+zip） |

**进程模型**：electron-vite 三段式 —— `src/main`（主进程）、`src/preload`（预加载）、`src/renderer`（React UI），共用代码放 `src/shared`。

## 2. 注释规范

注释统一使用**中文**。注释解释**意图与原因**，不复述代码动作。

### 2.1 文件头

每个源文件顶部用块注释说明该文件职责（一句话即可）：

```ts
/**
 * 设备会话管理：负责安装代理 APK、端口转发、启动 instrument 并完成握手。
 */
```

### 2.2 函数 / 方法

导出函数、类方法、关键内部函数，顶部使用 TSDoc 风格注释，说明用途、参数、返回值与可能抛出的错误；Android 侧对应使用 KDoc：

```ts
/**
 * 与手机端代理建立 socket 连接并完成 token 握手。
 * @param deviceId 目标设备序列号
 * @returns 已认证的代理客户端
 * @throws 设备离线或握手超时（10s）时抛出
 */
async connect(deviceId: string): Promise<AgentClient> { ... }
```

### 2.3 关键逻辑

非显而易见的逻辑必须有行内注释说明"为什么"，包括但不限于：

- 协议处理（socket 握手、JSON 行协议、token 校验）
- XML 控件树解析、坐标换算
- 边界条件（超时、设备断开、重试）

```ts
// 设备断开后端口转发随即失效，必须先重建 forward 再重试握手
await this.adb.forward(deviceId, hostPort, AGENT_PORT);
```

### 2.4 关键变量

含义不自明的变量（魔数、端口号、状态标志）在声明处加行内注释：

```ts
const AGENT_PORT = 39827; // 手机端代理 ServerSocket 监听端口，桌面端经 adb forward 映射
```

### 2.5 反例（禁止）

```ts
i++; // i 加 1            ← 废话注释，不写
const a = 39827;          ← 不自明的魔数不加注释，禁止
```

## 3. 单文件规模与拆分规范

- 单个组件 / 模块文件目标控制在 **200–300 行以内**；**超过 300 行必须拆分**。
- 接近上限时主动拆分，不要等到失控再处理。

**拆分策略**

1. **组件拆分**：按 UI 区块 / 职责拆成子组件。例：`src/renderer/src/App.tsx`（当前约 273 行）若继续增长，应拆出 `device-panel.tsx`（设备连接面板）、`task-editor.tsx`（任务编辑区）、`run-log.tsx`（日志区）等子组件，`App.tsx` 只做组合。
2. **逻辑下沉**：状态逻辑抽成自定义 Hook（`hooks/use-xxx.ts`）；纯函数下沉到 `shared/` 或对应端的 `utils/`。
3. **主进程模块**：单文件单职责，参考现有划分 —— `session.ts`（会话）、`agent-client.ts`（协议客户端）、`runner.ts`（任务执行）、`adb.ts`（ADB 封装）。

拆分优先级：**可读性 > 复用性**。不为拆而拆，拆出的每个文件必须有独立、可一句话说清的职责。

## 4. 目录结构规范

保持 electron-vite 三段式骨架不动，在其内部按"分层 + 按域"组织（大公司惯例）。目标结构：

```
src/
├── main/                  # 主进程
│   ├── index.ts           # 入口：窗口创建 + IPC 注册（保持薄）
│   ├── ipc/               # IPC handler 增多时从 index.ts 拆出，按域分文件
│   ├── services/          # 领域服务：session、agent-client、runner、adb…
│   └── utils/             # 主进程工具：hierarchy 解析等
├── preload/               # 预加载层：contextBridge 暴露 API，保持薄、不写业务
├── renderer/src/
│   ├── components/        # 可复用 UI 组件，规模大了按域再分子目录
│   ├── hooks/             # 自定义 Hook（use-xxx.ts）
│   ├── styles/            # 样式文件
│   ├── main.tsx           # 入口
│   └── App.tsx            # 组合层，保持薄
├── shared/                # 主/渲染进程共用
│   ├── types/             # 类型定义，增多时按域拆分
│   └── utils/             # 纯函数：task 校验、控件查找、坐标换算…
android/                   # 独立 Gradle 工程，遵循 Android 官方结构，不套用本规范
scripts/                   # 构建 / 发行脚本（stage-agent、stage-adb、verify-release）
docs/                      # 项目文档（自构建指南等长篇说明，README 的延伸）
tests/                     # Vitest 用例，文件名与被测模块同名
assets/                    # 打包随附资源（agent APK、ADB）
examples/                  # 任务示例
```

**原则**

- 按"层"组织优先于按"类型"堆砌；同域文件就近放置。
- 目录从现状向目标结构渐进演进：handler、组件、类型增多时才拆出对应目录，不提前建空目录。
- 新增顶层目录或 `src/` 一级子目录时，必须在本文件中登记其职责。

## 5. 命名规范

### 5.1 文件名

全部使用**小写 kebab-case**（`xxx-xxx` 横线连接）：

- 模块：`agent-client.ts`、`stage-agent.mjs`
- 组件：`device-panel.tsx`
- Hook：`use-device-session.ts`
- 测试：与被测模块同名加后缀，`task.test.ts`

### 5.2 代码标识符

| 类别 | 风格 | 示例 |
| --- | --- | --- |
| 类 / React 组件 | PascalCase | `DeviceSession`、`TaskRunner` |
| 函数 / 变量 | camelCase | `refreshSnapshot`、`hostPort` |
| 常量 | UPPER_SNAKE_CASE | `AGENT_PORT` |
| 类型 / 接口 | PascalCase | `TaskStep`、`DeviceInfo` |

### 5.3 语义化与长度

- 命名必须**语义化**：看到名字即知道用途，避免无说明的缩写和黑话。
- **克制长度**：标识符一般不超过 4 个单词。`refreshSnapshot` 优于 `handleRefreshDeviceSnapshotData`。
- 布尔变量用 `is/has/can` 前缀：`isConnected`、`hasToken`。

### 5.4 文案

UI 文案与错误信息统一使用**中文**（延续现有约定，如 `'请先连接手机'`）。

## 6. 硬性约束（不可绕过）

1. **不允许假装成功**：缺少组件（ADB、APK、设备离线）时必须明确报错，禁止静默降级或伪造成功状态。
2. **路径越权检查**：文件系统类 IPC（如 `run:open-dir`）必须限制在白名单目录（userData/runs）内，不可绕过。
3. **发行 ADB 必须自构建**：不允许复制 Google SDK 包（见 `assets/adb/NOTICE`）。
4. **测试**：修改纯逻辑（`shared/`、协议、runner 等）必须在 `tests/` 补充或更新 Vitest 用例。
5. **任务输入上限**：任务文件大小、步骤数（1–500）、超时范围等现有校验上限不得擅自放宽。
