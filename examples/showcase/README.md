# 第三方内容包示例

接口和 ZIP 强制规则见 [技术说明书](../../docs/showcase-partner-interface-v1.md)。`starter/` 包含静态 SVG、双语文字、响应式 HTML 和固定画布 CSS 动画，不依赖终端源码或外网。

从项目根目录执行：

```sh
python3 scripts/package_showcase.py examples/showcase/starter /tmp/partner-starter-1.0.0.zip
python3 coffee-terminal/showcase_packages.py validate /tmp/partner-starter-1.0.0.zip
python3 coffee-terminal/showcase_packages.py serve --root /tmp/showcase-preview
```

打开命令输出的 manageUrl，导入 ZIP，选择预览，切换中英文和画布尺寸，再启用。导入同版本会报错；修改前更新 manifest.version。示例文案和图形仅供接口演示，正式交付请使用品牌方批准的素材。
