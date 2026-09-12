# Partner starter 1.1.0

这是可导入的接口示例，不是已经审批的商业广告。包含静态SVG、双语文字、响应式HTML及固定画布CSS动画；所有资源离线，不读取订单/设备数据。设计母版1600×1100；运行时内容区可能只有356×390。

## 1.1.0 更新

- editorial页新增三份包内WOFF2、真实字重声明和字体加载失败消息示例。
- 双语长页脚与类型胶囊可换行，grid使用minmax(0,1fr)，同时按宽度与高度调整，不用overflow:hidden掩盖文字裁切。
- 原生字体加载完成后才发showcase-ready；失败发showcase-error。平台仍有5秒就绪上限。
- HTML使用assets/editorial.css；CSS中的fonts/路径相对CSS文件。请在终端管理器沙箱里预览，不以直接双击HTML为验收。

## 字体与素材

assets/fonts/包括思源宋体CN Regular、SemiBold及JetBrains Mono Regular，来自北京城市系列交付字体，随附SIL OFL 1.1许可全文。它们是子集字体，**不能保证新文案的全部字符都有字形**。本HTML样本文案沿用该子集已覆盖的城市系列文字；更换文案后必须重新检查字形覆盖，必要时从有授权的完整字体重新生成子集，并保留许可。document.fonts.check/load成功只能证明字体面可用，不能证明每个字都由该字体绘制。

示例品牌图标与城市文案仅用于本Coffee Terminal品牌项目的接口演示。正式交付须取得品牌方确认，并填写真实负责人及素材来源。系统渲染的text页使用宿主字体，不继承本HTML的@font-face；静态SVG示例不依赖外部字体。

## 打包与交付

在coffee-terminal-simulator根目录运行：

    python3 scripts/package_showcase.py examples/showcase/starter /tmp/partner-starter-1.1.0.zip

选择安装了项目依赖的Python环境；Windows可将输出改成其他目录。输出ZIP不能位于源目录内。manifest.json位于ZIP根目录，不把starter外层文件夹包进去。正式内容应更换id/name，增加已发布包内容时必须递增version，禁止覆盖已安装版本。

人工操作：终端调试面板 → 品牌轮播 → 管理内容包 → 导入ZIP → 预览全部页面/双语/六档尺寸 → 启用。每次启用替换整套轮播，不会自动与旧包合并。需要保留展厅图册时必须把展厅条目与资源一并交付。

验收附件使用上一级ACCEPTANCE-TEMPLATE.md；填写实际结果，不能直接复制PASS。字体许可随ZIP，验收截图与可编辑源稿作为包外附件。旧partner-starter-1.0.0.zip保留作历史版本，新交付以1.1.0为准。
