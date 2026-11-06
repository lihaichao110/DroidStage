# 任务编辑页改版说明

本次只改造任务编辑页及公共导航、状态栏。设备管理和运行工作台的内部布局、IPC、任务文件格式、Android 代理与执行逻辑不变。

## 页面与素材

- 浅蓝渐变、低对比度波纹、统一线性 SVG 图标及三栏卡片。
- 工具栏直接提供打开、保存、保存并运行；更多菜单保留“运行任务（不保存）”，支持 Escape、失焦及点击外部关闭。
- 编辑设备选择移至设备预览栏；未连接时提供真实的设备管理入口。
- 空任务插画的数字由 HTML 渲染；添加引导只聚焦动作类型，不创建步骤。
- 设置内容独立滚动，提交区始终保留在面板底部。操作反馈可从底栏展开查看全文。
- 轻量悬停与淡入过渡，系统要求减少动态效果时关闭动效。

两张机器人图片均由内置 imagegen 工具生成，未使用 CLI、外部 API 或占位图。原始生成文件直接复制进项目，保留透明通道，未覆盖已有品牌图标。

| 资源 | 实际尺寸 | 用途 |
| --- | --- | --- |
| `src/renderer/src/assets/robot-workflow.png` | 1568×1003，RGBA | 空任务流程插画 |
| `src/renderer/src/assets/robot-corner.png` | 1254×1254，RGBA | 右栏角落装饰 |
| `src/renderer/src/assets/chrome-waves.svg` | 矢量 | 导航与底栏波纹 |

PNG 的 alpha 范围均为 0–255，已检查实际页面中的透明边缘和缩小显示效果。生成器输出尺寸高于方案中的建议尺寸，页面按布局缩放显示。

## 实际页面截图

以下为编译后 Electron 应用的页面截图，没有注入模拟设备或伪造连接状态。

- [默认窗口 1440×900](editor-redesign/editor-1440.png)
- [宽窗口 1672×941](editor-redesign/editor-1672.png)（渲染器报告高度因像素取整为 942）
- [最小窗口 1100×700](editor-redesign/editor-1100.png)
- [14 个真实编辑步骤与条件设置](editor-redesign/long-condition.png)（步骤未下发运行）
- [125% 像素密度模拟](editor-redesign/editor-dpi125.png)
- [150% 像素密度模拟](editor-redesign/editor-dpi150.png)

## 验证结果

- `npm run build`：TypeScript 检查和生产构建通过。
- `npm test`：37 个测试文件通过、1 个跳过；270 项通过、2 项跳过。
- 26 项实际页面检查通过：空态引导聚焦且不新增步骤；更多菜单展开、Escape 恢复焦点、外部点击关闭；无目标时运行入口禁用；离线添加按键与截图步骤；排序、编辑回填、保存修改不重复添加、删除；连接入口导航、切页保留任务；九种动作设置渲染；复杂设置下提交区可见；运行工作台导航。
- 三种逻辑窗口尺寸均未出现页面级横向溢出；最小窗口下长任务独立滚动，提交区位于视口内。
- 125%／150% 使用开发调试协议模拟像素密度，未修改 Windows 系统缩放设置，不能代替原生窗口与系统文件对话框的 DPI 验证。

验证限制：当前未连接真机，连接中、设备切换、投屏错误／离线恢复、元素拾取及真实任务运行尚未回归。原生文件对话框尝试打开后未出现在桌面自动化窗口列表中，未将打开／保存／取消文件对话框标记为通过；对应文件与运行逻辑沿用既有实现。

## 生成提示词

主插画提示词（透明背景）：

```text
Create a production-ready transparent PNG illustration for a desktop Android automation task editor empty state, wide landscape composition about 1200px wide. Original friendly small robot, glossy porcelain white rounded square head, dark navy glass face, two glowing ice blue vertical pill eyes, soft pale blue side panels, stubby rounded hands. Robot leaning above the center of three soft translucent icy-blue rounded square workflow blocks arranged horizontally, simple scan bracket, finger tap and check icons on the blocks, thin arrows between blocks, subtle blue oval grounding shadow. Premium soft 3D clay/product illustration, gentle studio lighting, restrained desaturated blue palette, front three-quarter view. Robot's head slightly tilted with curious friendly expression. Keep whole illustration compact with little surrounding padding. No text, no numbers, no logos, no UI panels. Genuine transparent alpha background. Reference style: refined white and blue robot for a calm professional automation tool.
```

角落装饰提示词（透明背景，以生成的主插画为角色参考）：

```text
Create a separate small UI corner decoration using exactly the same original robot identity, materials and colors as the reference. ONLY the white rounded robot head tilted slightly, with its two small rounded white hands resting along an invisible horizontal panel edge. Dark navy screen face, two cyan pill eyes, pale blue ear panels, friendly curious expression. Compact composition suitable for a 100px wide decoration above a desktop app settings panel. No workflow blocks, no body, no ground, no scenery, no text, no numbers, no logo. Soft premium 3D studio lighting, restrained blue white palette, fully transparent alpha background. Keep all parts within image bounds. Square canvas about 512px.
```
