# 终端首页品牌轮播

> 2026-09-17核对：使用独立内容包，`web/showcase-content.json` 不再被读取。旧配置说明已从当前指南移除，历史内容可查Git。 当前接口和交付规则以 [第三方技术说明书 v1](showcase-partner-interface-v1.md) 为准。

当前文件分工：`web/showcase/player.mjs` 为播放器，`renderers.mjs` 为各类型渲染器，`contract.mjs` / `manifest.schema.json` 为清单合同，`terminal.mjs` 为唯一理解终端快照的适配器，`player.css` 为独立样式。`showcase_packages.py` 负责 ZIP 校验、版本存储、本机管理服务、原子启用和回退；`web/showcase/manager.html` / `preview.html` 可独立预览。`web/showcase.js` 是 `npm run build:showcase` 生成文件，勿直接编辑。

默认内容位于 `web/showcase-packages/default/`。示例交付物位于 `examples/showcase/starter/`，使用 `scripts/package_showcase.py` 打包。更新旧 `web/assets/showcase/` 渲染图时，需要同步默认包 assets，或发布一个新版本内容包。

本机操作入口：调试面板 → 品牌轮播 → 管理内容包。导入、预览、启用、回退互相独立；待机约15秒内或下一次返回待机加载。当前不是云端跨设备分发服务。

开发验证：`npm run build:showcase`、`npm test`、`python3 -m unittest discover -s tests -p test_showcase_packages.py -v`。只预览可运行 `python3 coffee-terminal/showcase_packages.py serve --root /tmp/showcase-preview`，打开输出的管理URL。
