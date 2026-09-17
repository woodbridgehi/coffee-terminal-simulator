# Coffee Terminal 第三方轮播接口与交付技术说明书

> 文档核对：2026-09-17。文中的旧日期、测试计数和截图是对应批次记录，不代表本次重跑或线上部署；当前索引见 [docs/README.md](README.md)。

版本：1.0　日期：2026-09-12　适用：终端首页左侧品牌轮播。

**必须、禁止**是验收要求；**建议**是设计指导。机器可读 Schema：`coffee-terminal/web/showcase/manifest.schema.json`。导入时还执行 `coffee-terminal/showcase_packages.py` 的路径、文件、版本和字段组合校验。单独通过 JSON Schema 不等于交付合格。

## 1. 内容与软件的边界

第三方交付离线内容包：清单、图片、静态 SVG、文案、HTML、HTML/CSS/Canvas 动画。播放器负责轮播、语言、计时、生命周期和失败降级；第三方负责内容区视觉。顶部品牌栏、底部页码/进度/切换按钮、右侧扫码区由终端提供，不要重复绘制。

支持类型：`image`、`svg`、`text`、`review`、`product`、`html`、`animation`。animation 是遵守协议的 HTML 页面，**不支持直接导入 Lottie JSON、GIF 或视频类型**。若使用动画库，须打包成本地经典脚本和内联数据，不提供在线 CDN 或内置 Lottie 运行时。

本版实现每台终端的独立本机管理网页、ZIP 导入、预览、启用、回退和 CLI。云端商务后台的跨设备分发、活动排期、审批和远程同步未包含在此接口中；本机启用不会向其他终端发布。

## 2. ZIP 交付格式

建议命名：`autumn-2026-1.2.0.zip`。

```text
manifest.json                必须在 ZIP 根目录，不能外包文件夹
assets/
  store.png
  cover-zh.svg
  cover-en.svg
  brand.css
  animation.js
slides/
  story.html
  motion.html
README.md                    建议附作者、授权及验收记录
```

| 项目 | 强制限制 |
|---|---|
| ZIP 大小、解压总大小 | 各 ≤ 50 MiB（52,428,800 字节） |
| 单文件 | ≤ 4 MiB（4,194,304 字节） |
| 数量 | ≤ 256 文件；ZIP 全部条目含目录 ≤ 512 |
| 文件名 | ASCII 字母、数字、`_ - . /`，路径 ≤ 180 字符 |
| 清单中的资源路径 | 以 `assets/` 或 `slides/` 开头，≤ 160 字符 |
| 禁止路径 | 绝对路径、空段、`.`、`..`、反斜杠、百分号编码、Windows 保留名称、尾随点 |
| ZIP 条目 | 禁止重复/大小写冲突、软链接、特殊文件、加密条目 |
| 后缀白名单 | `.json .html .css .js .svg .png .jpg .jpeg .webp .woff2 .txt .md` |
| 编码 | 文本 UTF-8；JSON 禁止重复键、NaN、Infinity |
| 版本 | 同一 id/version 不可覆盖；内容变化必须增加版本 |

不要包含 `.DS_Store`、`__MACOSX`、node_modules、编辑器缓存、凭证。Figma/PSD/AI 等源稿单独交付，不放入运行 ZIP。

## 3. manifest 根字段

未知字段会拒绝导入，包括旧版的 `image` 字段。

| 字段 | 必填 | 类型与规则 |
|---|---|---|
| schemaVersion | 是 | integer，固定 1 |
| id | 是 | string，`^[a-z][a-z0-9-]{0,47}$` |
| version | 是 | string，三段数字如 1.2.0，每段 1–4 位，无预发布后缀 |
| name | 是 | string，1–100 字符 |
| designSize | 是 | object：width 为 320–3840 整数，height 为 320–2160 整数 |
| background | 否 | `#RRGGBB`，默认奶油白；文字/评价/饮品模板另有品牌底色 |
| playlist | 否 | sequence（默认）或 interleave-products |
| slides | 是 | 1–60 条，条目 id 不重复 |

sequence 按清单顺序播放，product 在对应位置展开。interleave-products 将饮品与其他内容交错播放。最多一个 product 集合，必须至少有一张启用的非 product 页面，以覆盖菜单为空的情况。

## 4. slide 字段

| 字段 | 类型与规则 |
|---|---|
| id、type | 必填；id 格式同根 id；type 只能是支持的七种 |
| enabled | boolean，默认 true |
| src | 本包相对路径，与 srcByLocale 二选一 |
| srcByLocale | object，必须同时有 zh-CN、en-US 两个资源路径，无其他键 |
| content | object，必须同时有 zh-CN、en-US，见下节 |
| durationMs | integer，1000–24000，图像类另限制为 3000–4000 |
| duration | 仅允许 auto；仅 text/review；与 durationMs 互斥 |
| fit | cover 或 contain |
| layout | HTML/animation 使用 canvas 或 responsive（默认） |
| template | 文字模板 editorial（默认）或 quote |
| approved | boolean；启用的 review 必须为 true |

| 类型 | 资源与文案要求 | 时长 |
|---|---|---|
| image | 必须 PNG/JPG/JPEG/WebP/SVG；content 可选 | 默认3500ms，可设3000–4000ms |
| svg | 必须静态 SVG；content 可选 | 同 image |
| text | 禁止 src，必须双语 content | 默认 auto，可显式1000–24000ms |
| review | 同 text，启用必须 approved=true | 同 text |
| product | 必须饮品插画文件，格式同 image；建议双语 content | 同 image |
| html | 必须 .html，页面自己绘制文字 | 必须 durationMs，1000–24000ms |
| animation | 必须 .html，CSS/Canvas 动画 | 同 html |

image 填写 title/body/eyebrow 时系统叠加文字和底部渐变；均不填时为纯图。product 的 content.title 作栏目名称，body 作说明；饮品标题来自公开商品名称，不会推断价格或配方。完全定制饮品页面可用 HTML 读取公开 products 列表，必须处理空数组。

## 5. 中英文文案

```json
{
  "zh-CN": {"title":"一杯咖啡，一处停留。","eyebrow":"空间图册","body":"正文","author":"署名"},
  "en-US": {"title":"A coffee. A moment.","eyebrow":"THE SPACE","body":"Copy","author":"Author"}
}
```

每种语言必须有 title（可为空字符串）；title ≤160字符，body ≤1500，eyebrow/author ≤80。缺少语言将拒绝导入，不自动回退中文。上限是输入约束，不保证极长文字在小屏可读。

建议标题中文≤18字、英文≤9词；正文中文≤100字、英文≤65词。第三方必须实际检查全部指定尺寸的长文案。评价必须真实且获准公开，approved 标记不替代人工审核。

自动时长统计 title 和 body：`min(24000, max(7000, 3500 + 汉字数×230 + 非汉字词数×280))` 毫秒。含长文字的海报应使用 text/html，而非指望 image 自动延长播放。

## 6. 画布、缩放和布局

建议设计母版 1600×1100 px，sRGB。以下是**中间内容区**参考尺寸，不包括品牌页头和控制栏：

| 窗口参考 | 内容区参考 |
|---|---|
| 1440×900 | 916×559 |
| 1920×1080 | 1163×739 |
| 1366×768 | 882×469 |
| 1024×768 | 558×469 |
| 820×1180 | 444×871 |
| 390×844 | 356×390 |

- 图像默认 cover，等比铺满裁切；contain 完整显示并留底色。SVG 建议明确 fit=contain、提供 viewBox。
- HTML responsive：iframe 等于实际内容区，页面自行响应宽高；推荐使用此模式。
- HTML canvas：iframe 内部尺寸为 designSize，整体缩放，默认 contain，可选 cover。
- 不读取顶层窗口尺寸，不画二维码、设备状态或取杯信息，不依赖终端 CSS。
- 核心标识、杯面、标题保留足够边距。固定图片无法同时无裁切地铺满横竖屏，应选 contain 或响应式 HTML。
- 本版没有按屏幕宽高切换 src 的字段。srcByLocale 仅用于中英文资源切换。

## 7. HTML / 动画隔离与资源规则

每页在 sandbox="allow-scripts" iframe 中运行，来自独立 loopback 内容服务。HTML 响应同时附加 CSP sandbox，禁止 same-origin、表单、弹窗、下载、顶层导航、设备权限和声音。

允许：内联/本包 CSS、经典本地 JS、内联 JS、本包/嵌入 data 图片、WOFF2。禁止外网、fetch/XHR/WebSocket、媒体播放、嵌套 iframe、Worker、eval、动态 Function、外部 CDN。动画所需 JSON 必须构建时内联到 JS，不能运行时 fetch。脚本和样式可使用 `../assets/animation.js` 这样的包内相对引用。

静态 SVG 禁止 script、foreignObject、事件属性、DTD/实体、外部 href；依赖图像嵌为 data:image。复杂 SVG 动画使用 animation HTML。

内容不接收鼠标交互。禁止表单、链接、下单按钮；切换和暂停由外框处理。sandbox/CSP 不是 CPU 限额，死循环、超大 Canvas 仍可能拖慢浏览器，交付代码须人工审核与实机性能验收。

## 8. postMessage 协议

协议固定 `coffee.showcase.v1`。播放器发送：

```json
{
  "protocol":"coffee.showcase.v1",
  "type":"showcase-context",
  "channel":"每次挂载随机生成",
  "locale":"zh-CN",
  "paused":false,
  "reducedMotion":false,
  "viewport":{"width":916,"height":559},
  "designSize":{"width":1600,"height":1100},
  "products":[{"id":"latte","name":"拿铁"}]
}
```

只提供公开饮品 id/name，最多12项；不提供订单、凭证、设备地址、配方、库存、用户信息。canvas 模式 viewport 仍指可见内容区，designSize 指内部画布。

页面必须检查 event.source===parent、protocol 和 type。sandbox 为不透明来源，不能只依赖字符串 origin。回复原样带回 channel，播放器检查来源窗口和 channel。

有效回复仅两种：

```js
parent.postMessage({protocol:'coffee.showcase.v1',type:'showcase-ready',channel:context.channel}, '*');
parent.postMessage({protocol:'coffee.showcase.v1',type:'showcase-error',channel:context.channel,message:'可定位原因，最多使用前300字符'}, '*');
```

HTML 必须在挂载后5秒内准备资源并回复 ready，load 事件不等于 ready。首次 context 通常 paused=true，ready 后才开始计时并发送 paused=false。重复 ready 被忽略；错误 channel、过期 iframe 或其他窗口消息被忽略。

**不支持** showcase-request-next、showcase-duration；页面不能改变轮播顺序或时长。页面应随每次 context 更新语言、暂停和减少动态效果。

最小示例：

```html
<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:32px;background:#fff9f0;color:#17382d;font-family:system-ui}</style>
</head><body><h1 id="title"></h1><script>
addEventListener('message', event => {
  const c = event.data;
  if (event.source !== parent || c?.protocol !== 'coffee.showcase.v1' || c.type !== 'showcase-context') return;
  document.documentElement.lang = c.locale;
  document.querySelector('#title').textContent = c.locale === 'en-US' ? 'Coffee, made for you.' : '为你制作的一杯。';
  // 动画在 c.paused 或 c.reducedMotion 时停止。
  parent.postMessage({protocol:'coffee.showcase.v1',type:'showcase-ready',channel:c.channel}, '*');
});
</script></body></html>
```

## 9. 生命周期与降级

- 离开待机立即销毁当前渲染器；返回待机重新挂载。
- 普通图片/文字暂停时保留剩余时长。HTML/animation 在手动暂停或后台时卸载，恢复从该页开头播放，不能依赖内存状态保留。
- 单页加载超过5秒、图片失败或HTML error：记录包/页/原因并跳过，在该包当前会话内不重复尝试坏页。
- 整包页面失败：回退上一内容包，之后回退默认包。默认包全部失败时展示 Coffee Terminal 占位。
- 管理页显示最近自动回退原因；单页错误通过 showcase-error 自定义事件/控制台输出，预览页显示错误。没有自动发送云端告警。
- 已导入版本不得原地修改；修复必须增加 version。

## 10. 完整清单示例

```json
{
  "schemaVersion":1,"id":"autumn-2026","version":"1.0.0","name":"秋季品牌内容",
  "designSize":{"width":1600,"height":1100},"background":"#FFF9F0","playlist":"sequence",
  "slides":[
    {"id":"store","type":"image","src":"assets/store.png","fit":"cover","durationMs":3500},
    {"id":"cover","type":"svg","srcByLocale":{"zh-CN":"assets/cover-zh.svg","en-US":"assets/cover-en.svg"},"fit":"contain"},
    {"id":"story","type":"html","src":"slides/story.html","layout":"responsive","durationMs":12000},
    {"id":"motion","type":"animation","src":"slides/motion.html","layout":"canvas","fit":"contain","durationMs":8000}
  ]
}
```

完整可运行示例：`examples/showcase/starter/`；已打包示例：`examples/showcase/partner-starter-1.1.0.zip`。它们属于接口示例，不是已批准的广告或真实评价。

## 11. 管理和 CLI

终端调试面板 → 品牌轮播 → 管理内容包。导入 ZIP 后先预览中英文/各尺寸，再启用。导入不自动启用；管理页在成功预览至少一页后开放启用按钮，仍需人工逐页验收。

每个实例独立目录：`<实例目录>/showcase/packages/<id>/<version>/`；活动指针：`<实例目录>/showcase/active.json`。默认包位于安装资源中，外部包不写进安装目录。

启用校验后原子替换指针并保留 previous。待机前台约15秒检查，回到待机/关闭管理页立即检查；制作/取杯时暂缓新包。多进程不得同时管理同一目录，原子替换不提供跨进程事务。

从 coffee-terminal-simulator 根目录执行：

```sh
# 打包并校验：输出 ZIP 必须在源目录外
python3 scripts/package_showcase.py examples/showcase/starter /tmp/partner-starter-1.1.0.zip
# 只校验，不安装
python3 coffee-terminal/showcase_packages.py validate /tmp/partner-starter-1.1.0.zip
# 无设备的独立管理服务
python3 coffee-terminal/showcase_packages.py serve --root /tmp/showcase-preview
# 以下命令指定真实实例目录时会影响该实例
python3 coffee-terminal/showcase_packages.py import /path/to/pack.zip --root /path/to/instance/showcase
python3 coffee-terminal/showcase_packages.py activate autumn-2026/1.0.0 --root /path/to/instance/showcase
python3 coffee-terminal/showcase_packages.py rollback --root /path/to/instance/showcase
```

serve 输出 publicUrl 和带本次运行管理令牌的 manageUrl；打开 manageUrl 管理。令牌不能放入包或传给内容 iframe，服务结束后失效。

## 12. 本机 HTTP 接口

仅绑定127.0.0.1随机端口，独立于设备 localApi。管理请求必须包含 `X-Showcase-Token`，拒绝非本服务 Host。

| 请求 | 授权 | 输入/返回 |
|---|---|---|
| GET /active.json | 公开只读 | active、previous、revision，无管理令牌 |
| GET /packs/{id}/{version}/{path} | 公开只读 | 包内文件及正确 MIME，HTML 带 CSP sandbox |
| GET /api/catalog | 管理令牌 | packages、active、previous、revision、lastError |
| POST /api/import | 管理令牌 | ZIP原始二进制，建议application/zip；返回ok、key、name、sha256 |
| POST /api/activate | 管理令牌 | JSON `{"key":"id/1.0.0"}`；返回ok及活动指针 |
| POST /api/rollback | 管理令牌 | JSON `{}`；返回ok及活动指针 |

成功200；校验/输入错误400；无令牌或错误Host 403；资源不存在/路径无效404。错误 JSON 含 error；POST 错误另含 ok:false。sha256 是 ZIP 摘要，不是作者签名。响应 no-store；公开资源允许跨源读取，管理接口不开放跨源 CORS。

终端桥接 get_showcase_connection() 获取地址，report_showcase_failure(key,message) 报告整包失败。第三方内容不能调用这些接口，也不应依赖终端变量。

## 13. 第三方交付验收单

必须交付：

1. 可通过校验的 ZIP，清单与资源对应，无外部依赖。
2. 中英文文案/资源，不残留未批准的占位。
3. README 或交付单：id/version、页清单、素材及字体授权、修改记录、负责人。
4. 本文六档内容区尺寸的截图，中英文均需验收，特别检查长标题、边缘裁切。
5. HTML/动画 ready≤5秒、静音、响应暂停/减少动态效果/语言、断网可用、可报告异常。
6. 无内容滚动条、购买按钮、二维码或出站链接；Logo不变形，符合品牌 brand-marks.html。
7. 设计源稿单独附件；运行ZIP不带构建依赖。

校验器不能证明视觉品质、授权、全部脚本性能或原生跨平台行为。上线前在目标 Windows WebView2 / macOS WKWebView / Linux WebKitGTK 实机验收。活动内容更新不需重新编译终端；升级 schemaVersion 或新增渲染类型需升级软件。


## 14. 2026-09-12 验收补充：字体、窄屏与人工安装

本补充不修改 schemaVersion=1 或消息协议；收紧并具体化视觉验收方法。新版示例：`examples/showcase/starter/`（1.1.0），可导入ZIP：`examples/showcase/partner-starter-1.1.0.zip`，验收记录模板：`examples/showcase/ACCEPTANCE-TEMPLATE.md`。

### 14.1 三种检查不能混为一谈

| 检查 | 能证明 | 不能证明 |
|---|---|---|
| ZIP/Schema校验 | 支持的类型、必填字段、资源引用、尺寸/时长参数、文件与路径约束 | 所有文案在所有尺寸中可见、字体字形完整、设计质量 |
| 沙箱运行检查 | 每页5秒内ready、无资源/CSP/字体加载错误、语言与暂停响应 | 没有文字重叠或裁切；ready只是页面主动发出的回执 |
| 人工视觉验收 | 实际标题、正文、目录、品牌标识等完整且可读 | 没测试的平台与尺寸也一定正常 |

导入成功或一页ready，**不等于整包验收通过**。管理器当前只在至少一页成功预览后开放启用，不会自动验证整包排版。交付方必须提供全部页面×六档内容区×双语的验收附件，不得仅交一个用于生成截图的页面而没有实际结果。

这次北京1.4.1原包通过了前两类中的结构/接口检查，但部分窄屏存在QARM页脚、目录及品类标签裁切，属于未满足既有响应式要求；修正应在内容包内完成，不应靠放宽平台校验或增加白名单解决。合并原展厅图册属于另一个内容编排需求，不是协议兼容修复。

### 14.2 字体必须随包、随验收

1. 依赖特定字体的HTML必须附有授权的WOFF2及许可文件，建议放在`assets/fonts/`。禁止依赖设计师电脑上的字体、系统安装字体、外部字体CDN或访问用户字体目录；不要用`local()`使验收悄悄命中本机字体。
2. 使用`@font-face`明确声明family、weight与style；Regular=400、SemiBold=600必须对应正确文件。相对URL以CSS所在目录解析，例：`assets/editorial.css`中的`url('fonts/Font.woff2')`。
3. 每页必须自行引用包内字体CSS。HTML不继承宿主字体；平台text/product等原生渲染页由宿主样式负责，manifest没有自定义字体字段。静态SVG不要引用外部WOFF2；需要精确字形时把文字转路径，并把可编辑文字源稿放在包外。
4. 子集字体必须覆盖该字体实际承载的全部中英文、标点、数字和变体文本。文案改变后重做覆盖检查/子集；保留原许可。缺字可能悄悄回退，不能只检查有没有方框。
5. 在真实沙箱与无外网条件下检查WOFF2请求、CORS/CSP、解码错误、400/600字重和换行。内容服务已对公开资源提供跨源加载支持；不要通过allow-same-origin或放开网络规避失败。
6. 字体决定版式时，等待所需`document.fonts.load(...)`及`document.fonts.ready`后才发送ready，并在异常时发送showcase-error。仍须在平台5秒内就绪。`document.fonts.check/load`不是逐字形覆盖证明，必须结合字体cmap/子集工具与视觉检查。
7. 字体文件同样受单文件4MiB、解压总量50MiB限制；许可证随运行ZIP交付。

### 14.3 响应式排版的强制验收项

以iframe实际内容区为准：916×559、1163×739、882×469、558×469、444×871、356×390，全部页面、中英文分别检查。尤其356×390不是390×844整块手机屏幕，不能只用竖屏长页面布局。

- 禁止把`overflow:hidden`、无滚动条、scrollWidth正常当成完整可见的证明。必须检查标题/正文/目录/页脚的实际文本边界，以及它们之间的重叠；品牌标识、QARM声明和必要内容不得被隐藏、截断或挤出视口。
- 同时考虑宽度、可用高度和长英文。不得只用`max-aspect-ratio`判断窄屏。窄且矮的窗口可能仍命中横排断点。
- Grid使用`minmax(0,1fr)`等允许收缩的列，子项设置`min-width:0`；flex子项允许换行。长标签和页脚不得永久`white-space:nowrap`。figure等元素须显式处理浏览器默认margin。
- 调整层级、间距、换行、图文列和字号后逐页复测，不得只缩小整个HTML去掩盖无法阅读的文本。不必要装饰可以隐藏，但不得因此丢失必要内容。
- 检查图标/图像等比、封面contain留白、横竖屏顺序和缩放后可读性。不要覆盖平台二维码或外框控制栏。
- 截图须在所需字体加载后保存。建议命名：`<slide-id>__<locale>__<width>x<height>.png`。记录每页ready耗时、字体状态、脚本/资源错误、裁切/重叠结果及实际测试浏览器。
- 操作暂停、继续、切换语言及系统减少动态效果；确认离开轮播后停止活动。最后在目标Windows WebView2/macOS WKWebView/Linux WebKitGTK分别实测。未执行的检查写NOT_TESTED，不得标PASS。

### 14.4 人类如何导入与保留旧页面

1. 获得一个自包含ZIP：manifest.json在根目录，包含slides、assets、字体和许可；不选择整个设计工作目录，不上传仅用于展示的preview.html/verification.html。
2. 在目标终端打开调试面板（Ctrl+K，macOS为⌘K）→ 品牌轮播 → 管理内容包，选择ZIP导入。导入仅安装，不改变当前播放。
3. 逐页检查双语及六档尺寸，再点击启用。当前整包播放清单被替换；不会把新包自动追加到旧包。
4. 制作/取杯期间不会切换轮播；待机前台通常约15秒内或关闭管理页后检查新包。正常内容包启用不需要重启或重新编译程序；首次安装/升级轮播软件本身时才需要更新程序。
5. 需要“新北京系列＋旧展厅”时，交付合并ZIP，在一个manifest的slides中列出全部17页，并携带展厅图片。`bj-city-showroom-1.0.0.zip`就是本次合并交付，不是播放时读取第三方工作目录，也不是HTML链接集合。
6. 每台设备单独安装和启用；需要恢复上一套时使用回退。修改已交付版本必须增加version后重新打包；不要手改安装目录或active.json。
7. Finder的.DS_Store、__MACOSX不是内容素材。提供的打包脚本忽略这两类系统元数据；导入校验仍拒绝ZIP内包含的这些杂项，其他不支持文件也不会被自动接受。

本次实际接入同时更新了程序的内置默认内容（default/1.1.0），并生成独立合并ZIP（bj-city-showroom/1.0.0）。这是代码维护时的内置默认内容更新，不是运营人员日常导入的必要步骤。后续请使用管理器安装外部ZIP，原第三方目录不会被程序持续监听。
