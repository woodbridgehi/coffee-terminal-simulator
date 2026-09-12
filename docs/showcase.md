# 终端首页品牌轮播

> 2026-09-12 更新：已迁移独立内容包。**以下旧配置段落仅保留作历史参考，`web/showcase-content.json` 不再被读取。** 当前接口和交付规则以 [第三方技术说明书 v1](showcase-partner-interface-v1.md) 为准。

当前文件分工：`web/showcase/player.mjs` 为播放器，`renderers.mjs` 为各类型渲染器，`contract.mjs` / `manifest.schema.json` 为清单合同，`terminal.mjs` 为唯一理解终端快照的适配器，`player.css` 为独立样式。`showcase_packages.py` 负责 ZIP 校验、版本存储、本机管理服务、原子启用和回退；`web/showcase/manager.html` / `preview.html` 可独立预览。`web/showcase.js` 是 `npm run build:showcase` 生成文件，勿直接编辑。

默认内容位于 `web/showcase-packages/default/`。示例交付物位于 `examples/showcase/starter/`，使用 `scripts/package_showcase.py` 打包。更新旧 `web/assets/showcase/` 渲染图时，需要同步默认包 assets，或发布一个新版本内容包。

本机操作入口：调试面板 → 品牌轮播 → 管理内容包。导入、预览、启用、回退互相独立；待机约15秒内或下一次返回待机加载。当前不是云端跨设备分发服务。

开发验证：`npm run build:showcase`、`npm test`、`python3 -m unittest discover -s tests -p test_showcase_packages.py -v`。只预览可运行 `python3 coffee-terminal/showcase_packages.py serve --root /tmp/showcase-preview`，打开输出的管理URL。

## 历史配置（不再生效）

空闲首页左侧展示轮播，右侧固定扫码卡片。饮品由设备当前启用且能力检查未标记不可售的配方生成，与品牌内容交错播放。制作、取杯等页面沿用原流程。图片和饮品停留 3.5 秒；文字按中英文阅读量估算，7–24 秒。支持暂停、前后切换，页面进入后台或离开空闲状态时停止计时。

内容配置：`coffee-terminal/web/showcase-content.json`。每条记录使用唯一 `id`；`type` 为 `image`、`text` 或 `review`。`title`、`body`、`eyebrow`、`author` 支持字符串或 `zh-CN` / `en-US` 对象。`enabled: false` 可隐藏条目。图像建议放在本地 `assets/showcase/`，文字建议简短以便远距离阅读。修改配置后重新加载终端页面。

三个图册素材来自本项目 CoffeeScene 实际三维门店：门店全景、工作站、拉花细节；以 1600×1100 渲染并保存为本地 PNG，不依赖在线图片服务。饮品画面使用品牌纸杯插画，表示品类而非实物商品摄影。

当前品牌理念属于提案文案，待品牌方审阅。尚无真实评价与品牌经历素材，因此默认不展示评价或虚构历史；内容入口已预留。收到获准公开的真实评价后，可增加：

```json
{
  "id": "review-001",
  "type": "review",
  "enabled": false,
  "approved": false,
  "eyebrow": {"zh-CN": "顾客分享", "en-US": "CUSTOMER VOICES"},
  "title": "填写真实评价标题",
  "body": "填写获准公开的原文",
  "author": "填写获准公开的署名"
}
```

评价仅在 `approved: true` 且未禁用时展示。品牌经历使用 `text` 条目，在核对真实资料后填写。上述标记是配置控制，不替代内容审核。

验证：`npm test` 包含轮播时长边界检查。浏览器预览模式可验证轮播、语言、扫码区域和制作状态，不会给真实设备派单。
