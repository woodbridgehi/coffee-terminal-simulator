# 咖啡终端模拟器 API

接口分为两组：设备主动访问的云端 API，以及本机测试程序访问的设备本地 API。手机端不直接连接终端，应通过后台的销售服务下单。

## 1. 约定

### 1.1 请求头

远程模式下，设备发出的所有请求默认携带：

```http
Accept: application/json
Content-Type: application/json
X-Device-Id: coffee-bot-001
```

若 `device.json` 配置了 `backend.authToken`，还会携带：

```http
Authorization: Bearer <token>
```

`backend.headers` 中的字段也会合并到请求头，适合联调环境添加租户或网关标识。

### 1.2 时间、数值和版本

- 时间使用带时区的 ISO 8601 字符串，例如 `2026-08-23T12:00:00Z`。
- 物料数量使用 JSON number，单位由物料的 `unit` 给出。
- `capabilityVersion` 是有效配方内容的摘要。
- `inventoryVersion` 是库存每次变化后递增的整数。

### 1.3 设备事件信封

```json
{
  "schema": "coffee.device-event.v1",
  "eventId": "evt-uuid",
  "deviceId": "coffee-bot-001",
  "bootId": "boot-uuid",
  "sequence": 42,
  "occurredAt": "2026-08-23T12:00:00Z",
  "type": "task.progress",
  "message": "萃取咖啡",
  "payload": {}
}
```

后台应按 `eventId` 幂等处理，并可使用 `(deviceId, bootId, sequence)` 检测单次启动期间的重复或乱序。设备进程重启后 `bootId` 会变化，`sequence` 从头计数。

## 2. 云端接口总览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/devices/{deviceId}/commands` | 领取设备命令 |
| `POST` | `/api/v1/tasks/{taskId}/ack` | 接受或拒绝制作任务 |
| `POST` | `/api/v1/devices/{deviceId}/heartbeat` | 上报设备心跳 |
| `PUT` | `/api/v1/devices/{deviceId}/capabilities` | 同步饮品能力快照 |
| `PUT` | `/api/v1/devices/{deviceId}/inventory` | 同步共享库存快照 |
| `POST` | `/api/v1/devices/{deviceId}/events` | 上报设备事件 |
| `GET` | `/api/v1/devices/{deviceId}/display-config` | 获取二维码等展示配置 |
| `POST` | `/api/v1/devices/{deviceId}/debug/orders` | 测试环境创建调试订单 |
| `POST` | `/api/v1/devices/{deviceId}/debug/commands` | 测试环境创建调试命令 |
| `PATCH` | `/api/v1/devices/{deviceId}/debug/overrides` | 更新调试覆盖参数 |

后台成功响应应返回 `2xx` 和合法 JSON 对象；无响应体时也可以返回空响应体。连接失败、超时、非成功 HTTP 状态或非法 JSON 都会被设备视为调用失败。

## 3. 领取设备命令

```http
GET /api/v1/devices/{deviceId}/commands?after={cursor}&limit=10
```

响应：

```json
{
  "commands": [
    {
      "messageId": "cmd-001",
      "type": "MAKE_DRINK",
      "taskId": "task-001",
      "orderId": "order-1024",
      "recipeId": "iced-latte-v1",
      "recipeVersion": "1.0.0",
      "expiresAt": "2026-08-23T12:05:00Z"
    }
  ],
  "nextCursor": "cursor-42"
}
```

`commands` 可为空。设备处理完本批命令后保存 `nextCursor`，下次作为 `after` 传回。`messageId` 应全局唯一，设备会在当前进程内按它去重；后台也应支持重复拉取和重复 ACK。

支持的命令类型：

| `type` | 必要字段 | 行为 |
| --- | --- | --- |
| `MAKE_DRINK` | `messageId`、`taskId`、`recipeId` | 校验并执行饮品任务 |
| `DEBUG_COMMAND` | `messageId`、`action` | 执行调试动作 |
| `RELOAD_CONFIG` | `messageId` | 重载本地配置 |
| `INVENTORY_ADJUSTMENT` | `messageId`、`payload` | 调整本地物料 |
| `CANCEL_TASK` | `messageId` | 取消当前活动任务 |

`DEBUG_COMMAND.action` 支持 `pause`、`resume`、`skip`、`retry`、`cancel`、`clear`、`force-fail` 和 `toggle-offline`，但动作是否成功取决于当前任务状态。

`INVENTORY_ADJUSTMENT.payload` 与本地库存调整接口的请求体相同。

## 4. 制作任务校验与 ACK

设备收到 `MAKE_DRINK` 后才会校验配方、版本、命令有效期、设备占用状态和共享库存。命令出现在轮询响应中不代表已经接单。

```http
POST /api/v1/tasks/{taskId}/ack
```

接受：

```json
{
  "messageId": "cmd-001",
  "deviceId": "coffee-bot-001",
  "accepted": true,
  "acceptedAt": "2026-08-23T12:00:01Z"
}
```

拒绝：

```json
{
  "messageId": "cmd-001",
  "deviceId": "coffee-bot-001",
  "accepted": false,
  "acceptedAt": "2026-08-23T12:00:01Z",
  "reasonCode": "MATERIAL_INSUFFICIENT",
  "details": {
    "materialId": "milk",
    "required": 180,
    "available": 120,
    "unit": "ml"
  }
}
```

拒绝码：

| `reasonCode` | 含义 | 常见 `details` |
| --- | --- | --- |
| `INVALID_COMMAND` | 缺少字段或时间格式无效 | `required` 或 `field` |
| `COMMAND_EXPIRED` | 命令已过期 | `expiresAt` |
| `DEVICE_BUSY` | 当前已有活动任务 | `currentTaskId` |
| `RECIPE_NOT_FOUND` | 本机没有该配方 | `recipeId` |
| `RECIPE_VERSION_MISMATCH` | 后台指定版本与本机不一致 | `requested`、`installed` |
| `MATERIAL_INSUFFICIENT` | 整杯所需共享库存不足 | 物料、需求量和可用量 |

HTTP ACK 只表达接单结果。本杯随机抽取并冻结的步骤时长通过随后发送的 `task.acknowledged` 事件上报。

若 ACK 请求失败，终端记录本地 `task.ack.failed` 事件，但当前版本不会持久化重试 ACK。后台必须结合命令、ACK 和设备事件做超时与人工处置。

## 5. 心跳

```http
POST /api/v1/devices/{deviceId}/heartbeat
```

```json
{
  "deviceId": "coffee-bot-001",
  "instanceId": "instance-coffee-bot-001",
  "storeId": "store-demo-taipei-01",
  "deviceStatus": "BUSY",
  "currentTaskId": "task-001",
  "capabilityVersion": "sha256:...",
  "inventoryVersion": 18,
  "localApiUrl": "http://127.0.0.1:9101",
  "appVersion": "0.3.0",
  "sentAt": "2026-08-23T12:00:00Z"
}
```

心跳响应可以包含 `qrUrl`，终端会采用它更新二维码：

```json
{
  "qrUrl": "https://order.example.com/q/session-token"
}
```

`deviceStatus` 当前可能为 `IDLE`、`RESERVED`、`BUSY`、`READY` 或 `FAILED`。连接状态不在心跳体中；后台可根据最后心跳时间判断设备在线情况。

## 6. 同步饮品能力

```http
PUT /api/v1/devices/{deviceId}/capabilities
```

```json
{
  "deviceId": "coffee-bot-001",
  "storeId": "store-demo-taipei-01",
  "capabilityVersion": "sha256:...",
  "generatedAt": "2026-08-23T12:00:00Z",
  "products": [
    {
      "recipeId": "iced-latte-v1",
      "skuCode": "ICED_LATTE",
      "version": "1.0.0",
      "name": "冰拿铁",
      "display": {
        "description": "双份浓缩与鲜奶",
        "sortOrder": 20
      },
      "visual": {
        "profile": "iced-latte",
        "cup": "transparent-tall",
        "layers": ["milk", "coffee", "ice"]
      },
      "enabled": true,
      "available": true,
      "maxServings": 8,
      "estimatedDurationSeconds": 59,
      "durationRangeSeconds": {
        "min": 48,
        "max": 70
      },
      "unavailableReasons": []
    }
  ],
  "invalidRecipes": []
}
```

- `estimatedDurationSeconds`：配方所有步骤的基准时长之和。
- `durationRangeSeconds`：所有步骤允许的最短与最长总时长。
- `maxServings`：按当前共享物料的 `available` 估算。
- `available`：配方启用、配置有效且至少可制作一杯。
- `unavailableReasons`：不可售原因数组。

能力快照会在首次连接、配方变化或库存版本变化后重新同步，因为库存会改变可售状态和最大杯数。

后台应保存最新快照，再向手机端提供门店可售商品；手机端不能读取设备本地配置。

## 7. 同步共享库存

```http
PUT /api/v1/devices/{deviceId}/inventory
```

```json
{
  "deviceId": "coffee-bot-001",
  "inventoryVersion": 18,
  "updatedAt": "2026-08-23T12:00:04Z",
  "materials": [
    {
      "materialId": "milk",
      "name": "鲜奶",
      "unit": "ml",
      "capacity": 6000,
      "initialOnHand": 4800,
      "enabled": true,
      "onHand": 1720,
      "reserved": 180,
      "available": 1540,
      "lowThreshold": 1200,
      "criticalThreshold": 300,
      "status": "OK"
    }
  ]
}
```

- `onHand` 是实际剩余量。
- `reserved` 是活动任务已预占、尚未消耗的量。
- `available = onHand - reserved`，用于新订单可售校验。
- `status` 依据 `onHand` 与阈值计算，可能为 `OK`、`LOW` 或 `CRITICAL`。

制作预占、步骤消耗、释放预占、补料和配置重载都可能改变库存版本或可售能力。后台应以版本更高的完整快照覆盖旧快照。

## 8. 设备事件

```http
POST /api/v1/devices/{deviceId}/events
```

当前实现会产生以下事件：

| 分类 | 事件类型 |
| --- | --- |
| 生命周期/连接 | `device.online`、`device.connection`、`cloud.connection.failed` |
| 任务 | `task.acknowledged`、`task.started`、`task.progress`、`task.paused`、`task.resumed`、`task.retry`、`task.succeeded`、`task.failed`、`task.rejected`、`task.cancelled`、`task.cleared`、`task.ack.failed` |
| 步骤 | `step.started`、`step.completed`、`step.skipped` |
| 库存 | `inventory.reserved`、`inventory.consumed`、`inventory.adjusted`、`inventory.low`、`inventory.critical`、`inventory.recovered` |
| 配置/调试 | `capability.changed`、`debug.config-updated`、`debug.failure-armed` |

其中 `device.online`、`cloud.connection.failed` 和 `task.ack.failed` 仅保留在本地事件列表，不进入云端 outbox；模拟离线期间产生的断线 `device.connection` 事件也不会发送。

### 8.1 接单计划事件

```json
{
  "type": "task.acknowledged",
  "payload": {
    "taskId": "task-001",
    "orderId": "order-1024",
    "plannedDurationSeconds": 58.7,
    "stepDurations": [
      {"stepId": "prepare-cup", "durationSeconds": 4.2},
      {"stepId": "brew", "durationSeconds": 24.5},
      {"stepId": "add-milk", "durationSeconds": 30.0}
    ]
  }
}
```

这组时长在任务接单时随机抽取并冻结。本次任务后续进度均以它为准。

### 8.2 进度事件

```json
{
  "type": "task.progress",
  "payload": {
    "taskId": "task-001",
    "orderId": "order-1024",
    "recipeId": "iced-latte-v1",
    "stepId": "brew",
    "stepIndex": 1,
    "progress": 0.4
  }
}
```

`progress` 是当前步骤的 0 到 1 比例，不是整杯总进度。终端约在跨越每个 10% 桶时上报一次。

### 8.3 物料消耗事件

```json
{
  "type": "inventory.consumed",
  "payload": {
    "taskId": "task-001",
    "orderId": "order-1024",
    "recipeId": "iced-latte-v1",
    "stepId": "add-milk",
    "materialId": "milk",
    "amount": 180,
    "unit": "ml",
    "remaining": 1720
  }
}
```

`inventory.reserved.payload.materials` 是整杯按 `materialId` 汇总的预占映射。预占释放目前通过后续库存快照反映，没有单独的 `inventory.released` 事件。

### 8.4 失败事件

```json
{
  "type": "task.failed",
  "payload": {
    "taskId": "task-001",
    "orderId": "order-1024",
    "recipeId": "iced-latte-v1",
    "failure": {
      "code": "BREWER_TIMEOUT",
      "stepId": "brew",
      "retryable": true,
      "retriesUsed": 0,
      "maxRetries": 1,
      "consumedOnFailure": false
    }
  }
}
```

后台应以 `failure.retryable` 为设备当前判定，不应只根据错误码自行假设可以重试。

事件发送失败后会进入内存 outbox 并在连接恢复后重发，但进程退出会丢失 outbox。后台必须容忍丢失、重复和乱序，并以能力/库存快照做最终校正。

## 9. 显示配置

```http
GET /api/v1/devices/{deviceId}/display-config
```

```json
{
  "qrUrl": "https://order.example.com/q/session-token",
  "qrExpiresAt": "2026-08-23T12:30:00Z"
}
```

终端大约每 30 秒读取一次，也可以从心跳响应接收新的 `qrUrl`。二维码应指向后台销售服务；终端不会直接创建正式订单。

## 10. 远程调试接口

这些接口由后台实现，只应在测试环境开放，并配置鉴权和审计。

### 10.1 创建调试订单

```http
POST /api/v1/devices/{deviceId}/debug/orders
```

```json
{
  "deviceId": "coffee-bot-001",
  "recipeId": "iced-latte-v1",
  "source": "terminal-console",
  "requestedAt": "2026-08-23T12:00:00Z"
}
```

后台应创建测试订单和对应 `MAKE_DRINK` 命令。终端仍从正式命令轮询接口领取任务，避免绕过真实设备协议。

### 10.2 创建调试命令

```http
POST /api/v1/devices/{deviceId}/debug/commands
```

```json
{
  "deviceId": "coffee-bot-001",
  "action": "pause",
  "requestedAt": "2026-08-23T12:00:10Z"
}
```

后台应把动作转换成 `DEBUG_COMMAND` 或 `CANCEL_TASK` 命令供设备领取。

### 10.3 更新调试覆盖

```http
PATCH /api/v1/devices/{deviceId}/debug/overrides
```

```json
{
  "globalFailureRate": 0.25,
  "eventDelayMs": 500
}
```

`globalFailureRate` 必须在 0 到 1 之间。当前终端会保存并展示 `eventDelayMs`，但尚未使用它延迟事件发送。

## 11. 后台面向手机和运营端的建议接口

以下接口属于后台业务系统，不由 pywebview 程序提供：

```http
GET /api/v1/stores/{storeId}/available-products
GET /api/v1/devices/{deviceId}/capabilities
GET /api/v1/devices/{deviceId}/inventory
GET /api/v1/devices/{deviceId}/alerts
```

推荐流程：设备同步能力与共享库存，后台按门店汇总可售结果，手机端从 `available-products` 获取商品并创建订单，订单服务再向选定设备投递 `MAKE_DRINK`。

## 12. 设备本地 API

每个实例在自己的 `localApi.host` 和 `localApi.port` 启动本地接口，默认地址类似 `http://127.0.0.1:9101`。当前没有认证，建议仅绑定回环地址。

### 12.1 健康检查

```http
GET /device/v1/health
```

```json
{
  "ok": true,
  "deviceId": "coffee-bot-001",
  "bootId": "boot-uuid",
  "connection": "ONLINE",
  "deviceStatus": "IDLE",
  "time": "2026-08-23T12:00:00Z"
}
```

### 12.2 当前饮品能力

```http
GET /device/v1/capabilities
```

返回结构与云端能力同步请求体相同。

### 12.3 当前共享库存

```http
GET /device/v1/inventory
```

返回结构与云端库存同步请求体相同。

### 12.4 当前状态

```http
GET /device/v1/status
```

```json
{
  "deviceId": "coffee-bot-001",
  "instanceId": "instance-coffee-bot-001",
  "storeId": "store-demo-taipei-01",
  "connection": "ONLINE",
  "deviceStatus": "BUSY",
  "currentTask": {},
  "capabilityVersion": "sha256:...",
  "inventoryVersion": 18
}
```

`currentTask` 为完整运行时任务对象；空闲时为 `null`。该字段包含冻结后的配方步骤，适合调试，不建议作为正式后台协议。

### 12.5 补料或盘点调整

```http
POST /device/v1/inventory/adjustments
```

设置绝对库存：

```json
{
  "materialId": "milk",
  "mode": "SET",
  "amount": 6000,
  "reason": "OPERATOR_REFILL",
  "operatorId": "operator-001"
}
```

增减库存：

```json
{
  "materialId": "milk",
  "mode": "ADD",
  "amount": -100,
  "reason": "MANUAL_CORRECTION",
  "operatorId": "operator-001"
}
```

`mode` 支持 `SET` 和 `ADD`。成功返回 `change` 和最新完整库存；物料不存在、数值非法或结果超出允许范围时返回 400。

### 12.6 重载本地配置

```http
POST /device/v1/config/reload
Content-Type: application/json

{}
```

终端重新读取 `materials.json`、`recipes/*.json` 和 `failures.json`，重新计算能力，并在远程模式下触发快照同步。活动任务期间拒绝重载。

成功：

```json
{
  "ok": true,
  "capabilities": {},
  "inventory": {}
}
```

失败：

```json
{
  "ok": false,
  "error": "制作任务执行期间不能刷新配置"
}
```

本地接口业务失败返回 HTTP 400，未知路径返回 HTTP 404 和 `{"ok": false, "error": "NOT_FOUND"}`。

## 13. 联调时序

一次正常制作的建议后台观察顺序：

```text
设备 -> 后台：heartbeat / capabilities / inventory
顾客 -> 后台：扫码、下单、支付
后台 -> 命令队列：MAKE_DRINK
设备 -> 后台：轮询并领取命令
设备 -> 后台：ACK accepted=true
设备 -> 后台：inventory.reserved
设备 -> 后台：task.acknowledged（本杯计划时长）
设备 -> 后台：task.started / step.started / task.progress
设备 -> 后台：inventory.consumed / step.completed
设备 -> 后台：task.succeeded
设备 -> 后台：最新 inventory / capabilities
```

事件与 ACK 的到达顺序可能因网络重试发生变化。订单服务应以 `taskId` 关联，以 `eventId` 去重，并对长时间未 ACK、设备离线和任务失败建立明确的超时补偿策略。
