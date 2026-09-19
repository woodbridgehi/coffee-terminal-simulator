# Simulator Studio 本地复核（2026-09-19）

复核分支：`feat/simulator-studio-ui`；起点：`c428a2008a159b535e5f77b32935d0593dd1b54d`。在独立 worktree 中验证，未改 main、未部署 VPS，也未替换原 9131 联调服务。

## 结论与修复

原提交不能仅凭 CI 通过判定可用：真实 Chromium 打开时，页面 MutationObserver 监听 `#play` 属性，又在回调中写入其 dataset，造成无限微任务循环，连 DOMContentLoaded 都超时。修复后正式 bundle 能完成完整制饮。

| 优先级 | 问题及修复 |
| --- | --- |
| P1 | shell 观察器自触发卡死；改为监听文本/子节点、合并到 animation frame、避免重复属性写入。 |
| P2 | `[hidden]` 被 flex 样式覆盖；明确隐藏规则，避免 Preview/设备入口覆盖视口。 |
| P2 | Inspector 和 Timeline 高频替换节点，影响点击与焦点；保留交互节点、更新变化值，销毁时取消未完成的渲染。 |
| P2 | 旧配置任务关系可生成不存在的实体；仅索引真实实体，配置删除实体时清空选择。工艺任务从设备解析工位。 |
| P2 | 拖动再回原点误选、不可见对象被拾取、部分设备几何未注册；跟踪全程位移和 pointerId，过滤隐藏祖先，补齐设备/工位/基座注册。夹爪保留最具体实体引用。 |
| P2 | Resize/碰撞体开关意外改变相机；更新尺寸或碰撞显示时保留相机，逻辑工位支持位置聚焦。 |
| P2 | 布局隐藏状态未完整保存；补齐侧栏与 Inspector 状态、尺寸边界和 resize cancel。 |
| P2 | Reset/Replay 生命周期；清理 helper、事件与注册表，忽略已替换 Worker 的迟到消息。 |
| P3 | Task 无 Mesh 时错误把关联设备当 Selected；改为全部 Related。补齐目标开度字段、真实机器人状态、REPLAY 标识、键盘选择和同源 Device Lab 链接。 |

未修改 `kernel.mjs`、`planner.mjs`、`robot.mjs` 或 Worker protocol。`device-lab.bundle.js` 同步重新生成，因为它也使用共享 Renderer。

## 运行结果

环境：macOS、本机 Node 24、真实 Chromium（Playwright headless）、Three.js/Rapier/Worker；不是截图替身。`npm ci`、`npm run build:twin` 成功，Node 测试 **130 通过、0 失败、0 跳过**。

| 操作链 | 结果 |
| --- | --- |
| A 场景树选 brewer | Inspector 真实状态、Brass 高亮、extract Related 正确。 |
| B 3D 点击左臂 | robot:left；嵌套夹爪点击可选中 gripper，而非父机器人。 |
| C Timeline 选 extract | 任务 Selected；设备、杯子、工位为 Related。 |
| D Orbit 拖动 | 包括移出再移回原点，不改变选择。 |
| E/F/G 双击、F、Esc | 聚焦与清空选择正常。 |
| H 运行状态 | Scene Tree、Inspector、Timeline 一致；交互节点不随 tick 替换。 |
| I 重建 | 连续 3 次 Reset、3 次 Replay 保留有效 ID，每次一个 Canvas；Reset 后旧 Canvas pointer 监听器为 0。导入删除夹爪的配置后选择清除。 |
| 资源 | 连续切换 30 次选择释放 60 个 helper geometry；清空后 GPU geometry 数不增长。此检查不等于长期 JS heap 泄漏证明。 |
| 设备与配置 | Fault/Repair/Refill、Shared Config、单步 20ms、View/Labels/Collision 正常；共享配置导入未改变设备服务状态。 |
| 全流程 | 默认联调配置 32 个任务完成，302.64 仿真秒；正式 bundle 再次完成 32/32。移动机器人与最终杯子的 helper 边界跟随模型。 |
| 导出回放 | 完整实验导出、导入、回放滑块、选择保持正常。 |
| 速度 | 1×/4×/16× 都推进时钟且加速效果递增；浏览器计算负载限制实际墙钟倍率，不保证严格 16 倍实时速度。 |
| 布局 | 1440×900 三面板可用，折叠和 Dock 拖动尺寸更新、不跳相机；900×700 页面无横向溢出。窄屏仍遵循现有隐藏侧栏策略，不是完整移动端编辑器。 |

CLI 默认场景策略对比：串行 **347.92 s**、并行 **299.82 s**。这与共享设备配置的 32 步实验不同，不应混用基线数字。同一 Node 运行时导出重算为 `deterministic=true`（31/31 完成）。浏览器检查未出现相关 console error/pageerror。

## 重跑方法

```sh
npm ci
npm run build:twin
npm test
npm run twin:run -- --compare
npm run twin:run -- --output /tmp/coffee-experiment.json
npm run twin:run -- --replay /tmp/coffee-experiment.json
npm run twin:serve -- --port 9133 --manual
```

打开 `http://127.0.0.1:9133/digital-twin.html?source=device-lab`。使用新的默认服务执行下面的可选浏览器回归，避免已有自定义配置影响固定样例断言：

```sh
node scripts/check_studio_ui.mjs --url http://127.0.0.1:9133 --output /tmp/studio-review
```

脚本需要环境中已有 Playwright 与 Chromium；也可用 `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` 指定已有依赖。它不加入产品依赖，不修改设备服务状态。脚本在测试浏览器中包装真实 Renderer 以检查 helper/生命周期，仍使用真实 Worker 和业务代码；正式 bundle 的独立全流程验证另行执行。输出 `results.json`、截图和回放 JSON。脚本主要覆盖 A–I，完整工艺、配置和布局补充检查见上述结果。

## 边界

- Flow 仍是 Preview，没有 Compiler、Validation Backend 或 Node Runtime。
- Studio Device Lab 是轻量入口，完整控制仍在 `device-lab.html`。
- 本次验证 Chromium，不代表 Safari/Firefox 或真实硬件验收。
- 同一 Node 运行时的导出重算用于严格确定性验证；浏览器与 Node 的浮点末位差异不能等同业务不一致，也不能声称跨运行时逐位一致。
- 本次修复交互、拾取与资源生命周期，不引入真实碰撞规划或改变运动学精度。
