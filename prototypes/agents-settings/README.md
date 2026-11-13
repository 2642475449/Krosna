# Krosna · 内容区局部样张（第三轮）

用户最新确认：固定现有窗口、标签栏、设置导航，只重做智能体内容区；目前没有偏好的参考页面，重点是精致、美观且能放进 Krosna。

当前默认入口已改为局部样张：

- <http://127.0.0.1:1436/?stage=refine&design=A&theme=dark>
- 同一工具栏切换 A～E，依次为横向行组、并列面板、分栏配置、焦点切换、分组设置。
- 五位设计代理各自实现 `src/refinements/RefinementA.tsx` 至 `RefinementE.tsx` 及独立 CSS。
- 只展示 Claude / Codex 两项，Claude 配置初始可见，用于先确认字号、间距、对齐、层级与控件组合。**这是局部方向评审，并非整页迁入完成。**
- `EmbeddedShell.tsx` 提供静态宿主上下文，复用正式 `settings.css` 的导航、容器查询、1200px 宽容器及内边距；没有挂载会操作真实状态的 `SettingsPanel`。
- 五套局部全部使用同一套 Krosna `--cs-*` 主题，不切换各设计师的独立色板；切换方案保持外壳节点与主题不变。
- 正式应用页面未替换。需要先确认局部方向，再扩展到六项完整内容。

第三轮验证：独立类型检查通过、**22 项模型与 React DOM 模拟测试通过**、生产构建通过。新增测试覆盖外壳节点/主题稳定、各局部配置与命令联动，以及返回局部视图时清除上一轮主题覆盖。DOM 模拟不代表真实浏览器视觉验收，后者仍受已记录的浏览器工具故障限制。

下方保留第二轮实现说明。第二轮已通过工具栏「上一轮」归档，URL 需追加 `stage=archive`。

---

## 第二轮：五位设计师，五套独立方案（归档）

第二轮按用户最新要求重做：**仅保留项目图标与真实功能，其余自由探索**。旧截图只用于识别功能，不作为视觉基线。取消「现有页面精修」方向，五位独立 AI 设计代理分别实现各自的整页构图、字体、配色、亮暗主题与操作组织。

## 打开与启动

开发预览：<http://127.0.0.1:1435/>，从仓库根目录启动：

```powershell
pnpm exec vite --config prototypes/agents-settings/vite.config.ts --host 127.0.0.1 --port 1435 --strictPort
```

生产预览沿用上一轮截图的端口 <http://127.0.0.1:1436/>，刷新原标签页即可。构建与生产预览：

```powershell
pnpm exec vite build --config prototypes/agents-settings/vite.config.ts
pnpm exec vite preview --config prototypes/agents-settings/vite.config.ts --host 127.0.0.1 --port 1436 --strictPort
```

五个直接入口（可在同一页面顶部切换，保留模拟设置）：

- A 编辑目录：<http://127.0.0.1:1435/?stage=archive&design=A&theme=light>
- B 工具藏书室：<http://127.0.0.1:1435/?stage=archive&design=B&theme=light>
- C 智能体控制室：<http://127.0.0.1:1435/?stage=archive&design=C&theme=dark>
- D 空间编排：<http://127.0.0.1:1435/?stage=archive&design=D&theme=light>
- E 焦点偏好：<http://127.0.0.1:1435/?stage=archive&design=E&theme=light>

页面顶部出现「五位设计师 / 第二轮 · 独立设计」即为新版。默认以浅色 A 打开，每套均支持亮暗切换。

## 五位设计师各自实现的方案

| 方案 | 独立页面结构 | 视觉语言 | 交互组织 |
| --- | --- | --- | --- |
| A 编辑目录 | 横向字标、大标题、默认工具索引、双列开放目录 | 纸白、墨黑、钴蓝，大字编辑式排版 | 条目内展开配置，主次操作以文字与细线组织 |
| B 工具藏书室 | 暖色目录侧栏、工具资料签、下方启动工作区 | 纸色、墨棕、赭色，衬线标题与书签标识 | 下拉更换默认、筛选可更新、选择工具后配置 |
| C 智能体控制室 | 硬边策略区、横向六槽选择带、双区命令控制台 | 石墨、薄荷，精确对齐与适度等宽字体 | 命令与启动配置直接并列呈现 |
| D 空间编排 | 窄图形导航、默认横带、工具网格、固定右工作区 | 紫藤、靛蓝、柔和色块与选择圈 | 网格选对象，在固定区调整配置 |
| E 焦点偏好 | 纵向大图标轨道、分组偏好表单、命令确认区 | 中性灰、珊瑚红，原生设置感 | 逐项选择、阅读偏好分组、确认命令 |

五套分别位于 `src/designs/DesignA.tsx` 至 `DesignE.tsx`，每套独立 CSS。共享的是 `studio.tsx` 的状态接口、模拟模型、配置选项和业务纯函数，不共享上一轮的产品外壳、四列列表或默认摘要块。

## 保留的功能与隔离边界

- Claude、Codex、Antigravity、OpenCode、Qoder、Pi 的安装、版本、更新、额度状态。
- 默认项切换、全局权限及「自定义」状态；当前选择和默认项独立。
- 启动选项来自当前正式实现；OpenCode/Pi 不虚构配置。Codex Yolo 启用时保留但禁用审批/沙箱值。
- 命令预览复用正式纯函数；配置与默认项在方案、主题切换时保留。
- 「设计说明」提供五方案假设与取舍，以及正常/加载/空/失败/未安装场景、重置和复制拒绝模拟。
- 检查等待约 850ms；重置、场景切换和卸载会取消迟到结果。
- 安装、更新、额度均为模拟；复制使用真实浏览器剪贴板并处理拒绝。
- 不导入正式应用 store 或 IPC，不读取真实账户，不执行安装/更新，不修改正式设置。

## 检查

```powershell
pnpm exec tsc --project prototypes/agents-settings/tsconfig.json --noEmit
pnpm exec vitest run --config prototypes/agents-settings/vitest.config.ts
pnpm exec vite build --config prototypes/agents-settings/vite.config.ts
```

第二轮结果：独立类型检查通过；**15 项测试通过**（6 项模型测试、9 项 React DOM 模拟测试）；生产构建通过。测试覆盖五套页面与亮暗切换、默认状态保留、每套权限与详情入口、命令配置、复制成功/拒绝、未安装默认项、加载/空/失败恢复和重置取消。

生产构建只复制 `public/agents/*.svg`，不带正式应用其余大型 public 资源。HTTP 检查验证页面、JS、CSS、六个图标可访问。

浏览器实际视觉 QA 仍未完成：浏览器访问主机不可用，本机 Chrome 再次返回窗口归属校验错误。没有绕过工具限制，也不以 DOM 模拟或 CSS 静态检查冒充 1024/1440/1920 的真实渲染验收。各设计师已实现对应的响应式规则；真实遮挡、浮层、剪贴板权限与视觉质量需继续在可用浏览器中确认。

## 比较任务与停止服务

用相同三件事比较：找到需要更新的工具；切换默认智能体；修改启动设置并确认命令。可分别记录视觉偏好、信息清晰度、操作顺手程度，不必选择同一个方案。

前台启动时按 `Ctrl+C` 停止。隐藏会话可先找监听进程，确认命令行属于本原型后停止对应 PID：

```powershell
Get-NetTCPConnection -LocalPort 1435,1436 -State Listen | Select-Object LocalPort,OwningProcess
Get-CimInstance Win32_Process -Filter 'ProcessId = <上一步 PID>' | Select-Object ProcessId,CommandLine
Stop-Process -Id <已确认 PID>
```
