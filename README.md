# Coffee Terminal Simulator

基于 pywebview 的自动贩卖咖啡机终端模拟器，用于联调订单、商品、设备、库存、告警和售后服务。它不模拟机械运动，也不在终端内创建正式订单、处理支付或决定退款。

终端负责：

- 展示后台提供的下单二维码和设备状态。
- 从本地 JSON 发布这台设备支持的饮品能力。
- 从后台领取制作任务，在本地按步骤计时执行。
- 预占和扣减整台设备共享的物料库存。
- 模拟步骤故障、重试、暂停、取消和网络中断。
- 向后台同步心跳、能力、库存和设备事实事件。
- 提供本地查询 API 和开发控制台，辅助后台集成测试。

手机端始终访问后台的商品和订单服务，不直接连接终端本地 API。

当前 `v1.2` 是可靠性优化版：命令 Inbox、制作任务、命令游标和待发事件使用每实例 SQLite 持久化；重启可恢复模拟任务，重复任务不会再次制作，ACK/命令结果和事件会持久重试。

2026-08-30 状态整改：可重试故障进入 `RETRY_WAIT` 并保持设备忙碌，最终 `FAILED` 不允许复活；远程重启的未完成任务进入恢复保护，禁止直接 resume/retry/skip。云端支持带权限、版本与幂等校验的 HOLD 人工结案，但结案不代表硬件已停止。详见 [状态协议](coffee-terminal/API.md#暂停重试与重启恢复2026-08-30)。本次模拟器代码 `b88fede` 已提交并归档 VPS（不在 VPS 启动桌面程序），配套云端 A1/A2 已部署。MQTT 持久接收和 SQLite 跨对象原子性仍待后续批次，见相邻后端仓库的 [后续优化执行手册](../coffee-cloud-mvp/docs/optimization-roadmap-2026-08-30.md)。

远程接入已支持一次性激活和凭证轮换工具。设备 Token 只保存在被 Git 忽略且权限为 `0600` 的 `.secrets/` 文件中，不写入 `device.json`。

## 1. 项目结构

```text
coffee-terminal-simulator/
├── coffee-terminal/
│   ├── app.py                       # 单实例 pywebview 入口
│   ├── backend.py                   # 设备运行时和任务状态机
│   ├── catalog.py                   # 配方校验、随机时长和能力计算
│   ├── inventory.py                 # 预占、扣料、补料和库存持久化
│   ├── failures.py                  # 故障策略
│   ├── cloud.py                     # 云端 HTTP 客户端
│   ├── local_api.py                 # 本地设备 API
│   ├── state_store.py               # SQLite Inbox/Job/Outbox 可靠状态
│   ├── DESIGN.md                    # 架构、状态机和一致性规则
│   └── API.md                       # 后台与本地接口契约
├── ACTIVATION.md                    # 多设备登记、错误码验证、激活与启动手册
├── config/
│   ├── README.md                    # 配置字段参考
│   └── instances/
│       ├── coffee-bot-001/
│       │   ├── device.json
│       │   ├── recipes/*.json       # 一个文件一种饮品
│       │   ├── materials.json       # 本机共享物料定义
│       │   ├── failures.json
│       │   └── state/
│       │       ├── inventory.json   # 自动维护的实时库存
│       │       └── runtime.db       # 自动维护的命令、任务和待发消息
│       └── coffee-bot-002/
├── scripts/
├── tests/
├── start-instance.command
└── start-all.command
```

## 2. 安装与启动

项目已有 `.venv` 时可直接运行。重新安装环境（依赖统一从锁文件安装，避免传递依赖漂移；直接依赖源见 `coffee-terminal/requirements.txt`）：

```bash
cd /Users/alex/Downloads/armaster/coffee-terminal-simulator
uv venv --managed-python --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.lock
```

启动单台设备：

```bash
./start-instance.command coffee-bot-001
```

启动单台并打开 pywebview 调试工具：

```bash
.venv/bin/python scripts/start_instance.py coffee-bot-001 --debug
```

启动所有实例：

```bash
./start-all.command
# 或
.venv/bin/python scripts/start_all.py
```

`start-all.command` 会扫描 `config/instances/*/device.json`。每个实例启动独立窗口、独立本地 API 端口和独立库存文件。

当前示例：

- `coffee-bot-001`：已切换为 `remote` 模式；实例目录名为 `coffee-bot-001`，当前协议 `deviceId` 是管理台登记的 `coffee-bot`。
- `coffee-bot-002`：`remote` 模式，连接 `https://coffee-api.woodbridge.top`，适合 VPS 在线联调；凭证从未跟踪的 `.secrets/coffee-bot-002.env` 注入。

启动 002 在线模式：

```bash
./start-remote-002.command
```

自动化联调可运行同一设备运行时而不打开 pywebview：

```bash
.venv/bin/python scripts/run_headless.py coffee-bot-002 \
  --env-file .secrets/coffee-bot-002.env --duration 60
```

若进程在制作中退出，remote 模式重启后任务会停在 `RECOVERING/PAUSED`，带 `recoveryHold=true`。必须核对设备实际结果与云端 HOLD，受控取消旧任务后才能接下一杯。旧 `--resume-recovered` 参数不再允许绕过恢复保护（会报错退出）；不要通过编辑状态文件恢复制作。

### 2.1 首次激活与轮换

完整的后台登记、错误激活码测试、pending 重试、正确激活、启动、错误码和泄露轮换流程见 [ACTIVATION.md](ACTIVATION.md)。`deviceId` 必须与管理台登记值完全一致；实例目录名/启动参数不等于协议设备 ID。

管理员先通过云端创建一次性激活码，并把码放入临时文件；不要把码直接写进 shell 历史。终端执行：

```bash
.venv/bin/python scripts/activate_instance.py coffee-bot-002 \
  --activation-code-file .secrets/coffee-bot-002.activation-code \
  --secrets-file .secrets/coffee-bot-002.env
```

脚本先生成本地待提交凭证，再调用激活接口，成功后原子替换正式秘密文件；响应丢失时保留 pending 文件，重复执行不会生成另一把 Token。

轮换当前凭证：

```bash
.venv/bin/python scripts/rotate_instance_credential.py coffee-bot-002 \
  --secrets-file .secrets/coffee-bot-002.env
```

轮换同样支持崩溃恢复和幂等重试。云端短时间同时接受新凭证与旧凭证，宽限结束后旧凭证自动失效；脚本不会打印 Token。

## 3. 新建或复制设备

复制整个实例目录：

```bash
cp -R config/instances/coffee-bot-001 config/instances/coffee-bot-003
```

至少修改：

- `device.json`：`instanceId`、`deviceId`、设备名称、门店和运营商信息。
- `localApi.port`：同时运行的实例端口不能重复。
- `recipes/`：这台设备实际支持的饮品。
- `materials.json`：这台设备拥有的物料和容量。
- `failures.json`：这台设备的故障特征。

如果新设备需要使用初始库存，删除复制来的 `state/inventory.json`；首次启动会按 `materials.json` 的 `initialOnHand` 创建新状态。不要复制旧设备的实时库存当作新设备初始库存。

## 4. 运行模式

在 `device.json` 中配置：

```json
{
  "backend": {
    "mode": "local",
    "baseUrl": "http://localhost:8080",
    "commandPollSeconds": 2,
    "heartbeatIntervalSeconds": 30,
    "progressReport": {"minDeltaPercent": 5, "maxIntervalSeconds": 5},
    "requestTimeoutSeconds": 5
  }
}
```

### local

- 不访问云端后台。
- 控制台“模拟后台下单”直接创建本地测试任务。
- 暂停、跳过、重试、强制失败等操作直接作用于本地任务。
- 本地查询 API 正常可用。

### remote

- 真实请求 `backend.baseUrl`。
- 轮询后台命令并 ACK 接受或拒绝。
- 本地执行配方并同步能力、库存、心跳和事件。
- 控制台下单和调试命令先请求后台调试接口，再由正常命令轮询返回设备。
- 后台不可用时终端显示离线；本地配置和库存不会因此丢失。

### remote 扫码下单联调

云端 `0.3.0` 起会在心跳响应和 `GET /api/v1/devices/{deviceId}/display-config` 中返回当前设备专属地址：

```text
https://coffee-api.woodbridge.top/order?device_id={协议 deviceId}
```

pywebview 会把该地址生成真实二维码。手机与终端不需要位于同一局域网；手机访问云端页面，云端再通过现有命令轮询把订单派给终端。二维码不包含设备 Token、订单 Token或本地 API 地址。

完整验证：

1. 用带 `--env-file` 的命令启动目标实例，等待界面显示“云端在线”。
2. 手机扫描终端二维码；菜单应显示该实例 JSON 配方、预计时长和实时可制作杯数。
3. 选择饮品并确认“测试下单”；当前版本不收款。
4. 手机状态页依次显示排队、设备接受、制作步骤和完成/失败。
5. 终端制作时整杯预占共享物料，按步骤扣减；完成后手机菜单和 `/admin` 的物料余量会更新。
6. 关闭终端并等待心跳租约过期后，页面应显示设备离线并禁止下单。

下单不能从终端本地创建正式销售订单。终端只展示二维码、接收 `MAKE_DRINK`、执行配方并上报事实；订单幂等、队列和客户状态链接均由云端负责。

可选鉴权：

```json
{
  "backend": {
    "authToken": "test-device-token",
    "headers": {"X-Test-Environment": "staging"}
  }
}
```

设置 `authToken` 后请求会携带 `Authorization: Bearer ...`；所有云端请求默认携带 `X-Device-Id`。
请求还携带明确的 `User-Agent: CoffeeTerminalSimulator/1.2.0`，可通过 `backend.userAgent` 覆盖。Cloudflare 等边缘服务可能拒绝 Python 默认的通用脚本客户端签名，因此设备客户端不使用默认 `Python-urllib/*` 标识。

## 5. 添加或修改饮品

一个 recipe JSON 就是一种设备饮品能力。建议文件名与 `recipeId` 一致，且同一设备内不能出现重复 `recipeId`。

`priceMinor` 是可选的正整数，表示最小货币单位下的设备建议售价，并会随能力快照上报；云端仍负责最终币种、价格策略和下单时的商品快照。未配置时由云端的安全默认价格补齐。

完整示例：

```json
{
  "recipeId": "operator-special-v1",
  "skuCode": "OPERATOR_SPECIAL",
  "version": "1.0.0",
  "name": "门店榛果特调",
  "enabled": true,
  "display": {
    "description": "门店限定榛果奶咖",
    "sortOrder": 30,
    "operatorExclusive": true
  },
  "visual": {
    "profile": "hazelnut-special",
    "cup": "transparent-tall",
    "layers": ["coffee", "milk", "hazelnut-syrup"]
  },
  "steps": [
    {
      "id": "prepare-cup",
      "name": "准备杯子",
      "animationCue": "cup-arrive",
      "durationSeconds": 5,
      "durationRandomization": {"minSeconds": 3, "maxSeconds": 7},
      "failureProfile": "cup-dispenser",
      "consumes": [
        {"materialId": "cup-12oz", "amount": 1, "unit": "count"}
      ]
    },
    {
      "id": "add-hazelnut",
      "name": "加入榛果糖浆",
      "animationCue": "syrup-swirl",
      "durationSeconds": 7,
      "durationRandomization": {"minSeconds": 5, "maxSeconds": 10},
      "failureProfile": "syrup-pump",
      "consumes": [
        {"materialId": "hazelnut-syrup", "amount": 20, "unit": "ml"}
      ]
    }
  ]
}
```

必要规则：

- `recipeId`、`skuCode`、`version`、`name` 和非空 `steps` 必填。
- 修改配方后应提升 `version`，后台任务可用 `recipeVersion` 做版本校验。
- 每一步必须有 `id`、`name` 和大于 0 的 `durationSeconds`。
- `consumes.materialId` 必须存在于本机 `materials.json`。
- recipe 和 material 的单位必须完全一致，例如 `ml` 不能写成 `g`。
- 消耗量必须大于 0。
- 制作任务执行期间不能保存或刷新配方。

保存文件后，在控制台点击“刷新配置”，或调用：

```bash
curl -X POST http://127.0.0.1:9101/device/v1/config/reload
```

刷新后终端会重新扫描全部 recipe、计算 `capabilityVersion`、可制作杯数和时间范围。无效文件不会进入可售产品，错误会出现在能力响应的 `invalidRecipes`。

## 6. 随机步骤时间

每个步骤的 `durationSeconds` 是运营基准估算，可选配置：

```json
{
  "durationSeconds": 25,
  "durationRandomization": {
    "minSeconds": 22,
    "maxSeconds": 30
  }
}
```

规则：

- `minSeconds` 必须大于 0。
- `maxSeconds` 必须大于或等于 `minSeconds`。
- `durationSeconds` 必须位于范围内。
- 未配置随机范围时，实际时间始终等于 `durationSeconds`。
- 接受每杯任务时，每个步骤分别随机一次，并冻结为本杯执行计划。
- 同一杯制作过程中不会重新抽取，因此进度、剩余时间和事件一致。
- 能力中的 `estimatedDurationSeconds` 是各步骤基准之和。
- `durationRangeSeconds.min/max` 是各步骤最小值和最大值之和。
- `task.acknowledged` 事件给出本杯 `plannedDurationSeconds` 和每一步实际时长。

## 7. 饮品形象与步骤表现配置

配方可以选择内置饮品形象：

```json
"visual": {
  "profile": "iced-latte",
  "cup": "transparent-tall",
  "layers": ["milk", "coffee", "ice"]
}
```

支持的 `visual.profile`：

```text
espresso
americano
iced-latte
hazelnut-special
generic
```

步骤可选择：

```json
"animationCue": "milk-pour"
```

支持的动作：

```text
cup-arrive
ice-drop
brew-stream
water-pour
milk-pour
syrup-swirl
seal
serve
idle
```

这两个字段都可省略；终端会根据饮品和步骤名称尝试推断，无法识别的饮品使用 `generic`。显式写入不支持的值会使该 recipe 进入 `invalidRecipes`。

## 8. 共享物料与库存估算

`materials.json` 是整台设备的总物料，不是每种饮品各一套库存。所有 recipe 通过相同 `materialId` 消耗同一个余额。

例如：

- 美式消耗咖啡豆、净水、杯和杯盖。
- 拿铁消耗同一份咖啡豆和净水，并额外消耗牛奶或冰块。
- 做完一杯拿铁后，美式和特调的 `maxServings` 也会重新计算。

库存字段：

- `onHand`：物理账面余量。
- `reserved`：已接受但尚未完成步骤消耗的预占量。
- `available = onHand - reserved`：当前可用于新任务的数量。

单个饮品的 `maxServings` 计算方式为：

```text
min(floor(各物料 available / 该饮品整杯需求量))
```

它表示“如果后续全部制作这一种饮品，当前最多能接受多少杯”，不是不同 SKU 之间的库存分配承诺。

制作规则：

1. 接受任务前汇总整杯需求。
2. 物料不足则用 `MATERIAL_INSUFFICIENT` 拒绝任务。
3. 接受任务后预占整杯需求。
4. 每一步成功后扣除本步骤 `onHand` 并释放对应预占。
5. 失败或取消时释放尚未执行步骤的预占。
6. 已经消耗的物料不会返还。
7. 每次库存变化都会增加 `inventoryVersion`，并使能力快照重新同步。

库存状态：

- `OK`：高于低库存阈值。
- `LOW`：小于等于 `lowThreshold`。
- `CRITICAL`：小于等于 `criticalThreshold`。

## 9. 补料与盘点

控制台“补满”会把该物料设置为 `capacity`。也可以调用本地 API：

设置绝对值：

```bash
curl -X POST http://127.0.0.1:9101/device/v1/inventory/adjustments \
  -H 'Content-Type: application/json' \
  -d '{"materialId":"milk","mode":"SET","amount":6000,"reason":"OPERATOR_REFILL","operatorId":"operator-001"}'
```

增加或减少：

```bash
curl -X POST http://127.0.0.1:9101/device/v1/inventory/adjustments \
  -H 'Content-Type: application/json' \
  -d '{"materialId":"milk","mode":"ADD","amount":-200,"reason":"WASTE"}'
```

调整后的数量必须在 `0` 和 `capacity` 之间。操作会产生 `inventory.adjusted` 事件并更新能力和库存快照。

实例的 `state/` 包含两类运行时状态：

- `inventory.json` 保存 `onHand`、预占、库存版本和步骤消耗键。
- `runtime.db` 使用 SQLite WAL 保存命令 Inbox、当前/历史任务、命令游标以及命令结果和事件 Outbox。
- 重启会保留 `onHand`；存在可恢复任务时也保留该任务预占。local 模式从最近检查点继续模拟；remote 模式进入 `RECOVERING/PAUSED`，等待核对物理结果与受控取消，不能直接继续制作。
- 新增物料时会使用该物料的 `initialOnHand`。
- 已存在物料不能直接更换单位；需要迁移或重建库存状态。
- 只删除 `inventory.json` 会重置库存但保留任务/去重历史，可能形成不一致；测试环境需要完全重置时，应关闭进程后同时删除该实例的 `inventory.json` 和 `runtime.db*`。

步骤消耗键是 `taskId:stepId:attempt`。同一次动作回调重复不会再扣料，真正重试会增加 attempt 并记录新的实际消耗。

## 10. 故障配置与调试

`failures.json` 支持：

- 设备全局故障率 `globalFailureRate`。
- 可复用硬件故障档案 `profiles`。
- 针对具体步骤 ID 的 `stepOverrides`。

故障档案示例：

```json
{
  "failureRate": 0.02,
  "errorCode": "MILK_PUMP_TIMEOUT",
  "message": "牛奶泵超时",
  "retryable": true,
  "maxRetries": 1,
  "timing": "after",
  "consumeOnFailure": true
}
```

- `timing=before`：步骤开始前失败，通常不消耗本步骤物料。
- `timing=after`：步骤计时完成后失败，可用 `consumeOnFailure` 表示物料是否已经投入。
- 重试必须处于 `RETRY_WAIT`，满足 `retryable=true`、未超过 `maxRetries` 且剩余物料足够；`FAILED` 是不可复活的最终态。
- 控制台失败率滑块只覆盖当前进程，不修改 JSON。
- “下一步失败”只作用一次，用于测试失败订单、告警、退款和售后流程。
- “模拟断网”暂停云端通信；当前实现也会暂停本地任务计时，恢复网络后继续。

## 11. 开发控制台

右上角按钮打开控制台，可进行：

- 选择和编辑 recipe JSON。
- 创建测试订单。
- 查看物料、预占、阈值状态并补满。
- 修改当前进程故障率。
- 强制下一环节失败。
- 暂停、继续、跳过、重试和清理任务。
- 模拟断网。
- 查看最近 50 条本地事件。

远程模式下，下单、暂停、跳过、重试和强制失败会先调用后台调试接口；后台必须再生成设备命令。`toggle-offline` 例外，它直接作用于本地连接状态。

## 12. 本地查询 API

端口由 `device.json` 的 `localApi.port` 决定：

```text
GET  /device/v1/health
GET  /device/v1/capabilities
GET  /device/v1/inventory
GET  /device/v1/status
POST /device/v1/inventory/adjustments
POST /device/v1/config/reload
```

示例：

```bash
curl http://127.0.0.1:9101/device/v1/health
curl http://127.0.0.1:9101/device/v1/capabilities
curl http://127.0.0.1:9101/device/v1/inventory
curl http://127.0.0.1:9101/device/v1/status
```

本地 API 默认只允许回环 Host。写接口要求 `Content-Type: application/json`，拒绝未授权浏览器 Origin，并限制请求体大小。可在 `device.json` 配置 `localApi.authToken`，调用写接口时携带 `X-Local-Token`；绑定非回环地址或在 `production` 环境启用时，Token 为必填。不要把补料和配置刷新接口直接暴露到公网。

## 13. 后台接入顺序

推荐后台按以下顺序实现：

1. `POST heartbeat`，确认设备在线和版本。
2. `PUT capabilities`，保存设备可售能力投影。
3. `PUT inventory`，保存实时库存投影。
4. `GET commands` 与 `POST task ACK`，打通任务领取。
5. `POST events`，用设备事实推进订单状态。
6. `GET display-config`，提供二维码。
7. 最后实现仅测试环境使用的 debug 接口。

完整协议见 [coffee-terminal/API.md](coffee-terminal/API.md)，业务边界和一致性规则见 [coffee-terminal/DESIGN.md](coffee-terminal/DESIGN.md)，配置字段见 [config/README.md](config/README.md)。

## 14. 测试

```bash
.venv/bin/python -m py_compile coffee-terminal/*.py scripts/*.py
.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.mjs
node --check coffee-terminal/web/app.js
node --check coffee-terminal/web/drink-visual.js
```

当前测试覆盖：

- 本地 API、能力计算和库存快照。
- 两种不同饮品连续消耗同一份共享物料。
- 每杯随机步骤时长及时间范围。
- 缺料拒单和能力下架。
- 故障后的物料消耗与预占释放。
- 真实 HTTP 命令、ACK、心跳、能力、库存和事件同步。
- ACK 响应丢失后的持久重试，以及重复命令不重复制饮。
- 进程重启后的任务与预占恢复、历史 taskId 去重。
- 迟到取消的目标任务校验、禁用配方拒单和非法库存调整拒绝。
- 已耗料步骤重试时按 execution attempt 再次扣料。
- 畸形命令响应隔离及云端工作线程恢复。
- 本地写接口对非 JSON 浏览器式请求的拒绝。
- 饮品形象与步骤表现配置映射。

### v1.2 尚未承诺的生产能力

- 库存仍为 JSON，任务/消息为 SQLite；两种存储之间还不是单一原子事务。
- 模拟任务可从计时检查点恢复，但真实硬件动作在崩溃后必须结合传感器进入 `RECOVERING/HOLD`，不能照搬自动续做。
- 远程身份已支持一次性激活和 Bearer Token 双凭证轮换；mTLS、硬件密钥保护和命令签名尚未实现。
- 配置重载还不是签名配置包的 staged/atomic 发布，OTA 和硬件安全互锁仍不存在。
- SQLite 已发送记录尚未实施长期归档策略，商业试点前应明确保留期和磁盘水位。

## 15. 常见问题

### 界面显示离线

检查 `backend.mode` 是否为 `remote`、`baseUrl` 是否可访问，以及后台是否实现了命令、心跳、能力和库存接口。

### 新增配方没有出现在能力清单

调用配置刷新，再查看 `GET /device/v1/capabilities` 的 `invalidRecipes`。常见原因是重复 `recipeId`、未知物料、单位不一致、随机时间范围错误或使用了不支持的表现配置。

### 修改 initialOnHand 后库存没变化

`initialOnHand` 只用于首次创建该物料状态。已有设备应通过补料/盘点接口调整；测试环境需要完全重置时，关闭实例并同时清理该实例自己的 `state/inventory.json` 与 `state/runtime.db*`。

### 启动多个实例端口冲突

确保每个实例的 `localApi.port` 唯一。后台也应把 `deviceId` 和 `instanceId` 当作不同身份管理。

## 16. MQTT 5.0 remote 模式

`remote` 现支持 `http`（兼容/恢复模式）和 `mqtt5` 两种 transport。MVP 多设备测试推荐 `mqtt5`：命令、ACK、制作事件、在线状态和 reported state 使用 MQTT 5.0；激活、凭证轮换、二维码配置、能力和库存快照继续使用 HTTPS。MQTT5 模式不轮询设备命令，`commandPollSeconds` 只对 HTTP 兼容模式生效。业务命令处理、SQLite inbox/outbox、taskId/messageId 去重和制作状态机不因 transport 改变。

连接生命周期（2026-08-30 B1.1）：设备 Client ID 即 `deviceId`，MQTT 5 会话为持久会话（`clean_start=False` + `sessionExpirySeconds`，默认 7 天）；进程重启/对象重建后离线期间排队的 QoS 1 下行命令会被 Broker 重投，CONNACK `sessionPresent=false` 时记录警告而非静默。Paho 网络循环在主动 `disconnect()`（模拟离线暂停、命令队列背压）后终止且不会自愈；传输层唯一的监督线程在循环死亡后执行 `loop_stop → reconnect → loop_start`（指数退避，上限 60s），网络回调只记录状态。`close()` 幂等且终态：关闭后 `start()`/`resume()` 报错，不残留线程、不再重连。下行 ACK 携带连接代次（generation），旧连接的 MID 不会在新连接上被确认。

制作进度采用可配置的“变化或时间”上报策略：`backend.progressReport.minDeltaPercent` 默认 `5`，`maxIntervalSeconds` 默认 `5`。整杯 `overallProgress` 每变化至少 5%，或距离上次进度消息达到 5 秒（任一满足）就上报；在线时每条进度立即交给 MQTT，断网积压时 SQLite 仅保留同一任务的最新待发进度。任务/步骤开始、完成、失败、取消及告警事件始终立即上报并可靠保留，云端只合并 `task.progress`。MQTT 下行启用 manual ACK，命令只有进入本地有界队列后才确认，队列满时断开并依靠 QoS 1 重投。

云端 v0.5 激活接口会一次性签发每设备 MQTT credential 并同步 EMQX ACL；`activate_instance.py` 会把它与 HTTP 凭证一起写入受限 `.env`。响应丢失后脚本通过 MQTT rotate 接口恢复，不能回退为共享 Broker 密码。

002 的未跟踪凭证文件需要包含：

```dotenv
COFFEE_TRANSPORT=mqtt5
MQTT_HOST=mqtt-api.woodbridge.top
MQTT_PORT=8883
MQTT_TLS=true
MQTT_USERNAME=coffee-bot-002
MQTT_PASSWORD=<每机独立密码>
MQTT_SESSION_EXPIRY_SECONDS=604800
```

直接运行：

```bash
./start-remote-002.command
```

若 macOS 的 Shadowrocket fake-IP 规则不能转发 8883，可在同一 secret 文件增加以下本地调试项。启动器会在应用生命周期内自动创建 SSH 端口转发，同时保留 `mqtt-api.woodbridge.top` 作为 TLS SNI/证书校验名：

```dotenv
MQTT_CONNECT_HOST=127.0.0.1
MQTT_CONNECT_PORT=18883
MQTT_SSH_TUNNEL_TARGET=heymanserver-tunnel
MQTT_TUNNEL_REMOTE_HOST=127.0.0.1
MQTT_TUNNEL_REMOTE_PORT=8883
```

真实设备或网络已配置该域名直连时，不设置这些 `MQTT_CONNECT_*`/`MQTT_SSH_*` 项。Broker 验收脚本不会输出密码：

```bash
.venv/bin/python scripts/verify_mqtt5.py \
  --device-env .secrets/coffee-bot-002.mqtt.env \
  --gateway-env ../coffee-cloud-mvp/.secrets/coffee-cloud-gateway.mqtt.env
```
