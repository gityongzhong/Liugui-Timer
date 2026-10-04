# 流晷计时器（源码）

会议场景专用桌面倒计时，基于 **Electron** 构建的单文件免安装应用。

本目录是完整可编译的源代码。软件成品请到 [Releases](../../releases/latest) 下载。

## 技术栈

| 语言 | 用在哪 |
|------|--------|
| **JavaScript** | 全部逻辑：主进程窗口管理、PPT 放映探测、多屏定位、界面交互 |
| **HTML** | 界面结构：主窗口 `ui/index.html`、悬浮挂件 `ui/float.html` |
| **CSS** | 视觉效果：深色界面、渐变流光进度条、Windows 风格窗口按钮 |

无框架、无构建工具、无数据库、不联网。

## 目录结构

```
main.js              主进程：窗口创建、尺寸自适应、PPT 轮询、多屏逻辑
preload.js           进程通信桥（contextIsolation 下暴露受限 API）
lib/ppt-detect.js    PPT / WPS 放映检测（koffi 调用 user32.dll，只读）
ui/index.html        主窗口界面（内联 CSS + IIFE 逻辑）
ui/float.html        悬浮窗挂件
build/icon.ico       应用图标
tools/               开发工具与回归测试
```

## 运行

需要 Node.js 18+：

```bash
npm install
npm start
```

## 打包

```bash
npm run dist
```

产物在上级目录的 `发布/electron-out/`。国内网络建议设置镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist
```

## 回归测试

`tools/test-float.js` 是一套**真实 Electron 内核**的端到端回归测试：启动真实窗口、
用操作系统级点击（`sendInputEvent`）驱动界面、对窗口尺寸与像素做断言，覆盖计时逻辑、
悬浮窗透明与置顶、放大还原、分类增删、PPT 自动计时、列表滚动等 69 项用例。

```bash
./node_modules/.bin/electron tools/test-float.js
```

其它工具：

| 工具 | 用途 |
|------|------|
| `tools/measure.js` / `measure-float.js` | 真实内核测量控件尺寸 |
| `tools/diag-list.js` | 诊断列表高度与滚动条 |
| `tools/diag-alpha.js` / `diag-edge.js` | 透明窗口像素诊断 |
| `tools/probe-win.js` / `probe-wps.js` | 枚举窗口，探测放映窗口类名 |
| `tools/verify-asar.js` | 验证打包后原生模块可加载 |

## 实现要点

**PPT / WPS 放映检测**：用 `koffi` 调用 Windows `user32.dll` 的 `EnumWindows`
枚举顶层窗口，按「窗口类名 + 标题」判断是否处于放映状态——PowerPoint 放映窗口类名为
`screenClass`；WPS 演示为 Qt 框架的 `Qt5QWindowIcon`，但该类名同时被辅助窗口使用，
因此追加「标题含『幻灯片放映』」作为第二判据避免误判。整个过程**只读窗口信息，
不注入进程、不修改 PPT 文件、不联网**。

**多屏定位**：读取放映窗口坐标，按所在显示器的 `scaleFactor` 折算成 DIP 判断归属屏，
再把悬浮窗定位到放映屏之外的「演讲者屏」（优先主屏）。

**透明窗口约束**：无边框透明窗口内**禁用 `box-shadow` 外投影**——阴影会被窗口边界
切断，在四周留下一圈可见灰雾，因此只用 0.5px 内描边。

## 开源许可

见 [LICENSE](LICENSE)：可自由使用、修改、分发，禁止转售。
