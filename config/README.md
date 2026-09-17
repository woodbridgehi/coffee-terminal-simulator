# 设备实例配置说明

核对日期：2026-09-17。实现依据：`configuration.py`、`catalog.py`、`inventory.py`、`backend.py`；示例不是当前线上配置。

## 1. 目录规则

每台模拟设备使用一个独立目录：

```text
config/instances/{deviceId}/
├── device.json
├── recipes/*.json
├── materials.json
├── failures.json
└── state/
    ├── runtime.db         # 当前状态主存储
    └── inventory.json     # 可选旧格式，仅首次导入
```

- `device.json` 是启动入口，它的父目录就是完整实例目录。
- `recipes/` 中一个 JSON 文件代表一种饮品能力。
- `materials.json` 定义整台设备共享的物料，不为每种饮品单独创建库存。
- `failures.json` 定义设备和步骤故障概率。
- `state/inventory.json` 仅在SQLite尚无库存时导入一次，之后不再作为实时库存写回。
- `state/runtime.db` 统一维护库存、取杯位、命令 Inbox、任务、游标、ACK/命令结果和事件 Outbox，不得复制到另一台设备。

同一台电脑同时运行多个实例时，`instanceId`、`deviceId` 和 `localApi.port` 必须不同。

`config/instances/{目录名}` 是本地启动参数；`device.json.deviceId` 是云端协议身份，两者不要求相同，但 `deviceId` 必须与管理台登记值逐字符一致。HTTP 404 通常表示后台未登记这个 `deviceId`，不是激活码错误；错误激活码对应 HTTP 401。完整操作见项目根目录 `ACTIVATION.md`。

## 2. device.json

```json
{
  "instanceId": "instance-coffee-bot-001",
  "deviceId": "coffee-bot-001",
  "deviceName": "COFFEE BOT 001",
  "operatorId": "operator-demo-001",
  "storeId": "store-demo-taipei-01",
  "storeName": "台北信义体验店",
  "environment": "development",
  "backend": {
    "mode": "remote",
    "transport": "mqtt5",
    "baseUrl": "http://localhost:8080",
    "commandPollSeconds": 2,
    "heartbeatIntervalSeconds": 30,
    "progressReport": {"minDeltaPercent": 5, "maxIntervalSeconds": 5},
    "requestTimeoutSeconds": 5,
    "authToken": "optional-token",
    "headers": {"X-Test-Environment": "staging"},
    "mqtt": {
      "host": "mqtt-api.woodbridge.top",
      "port": 8883,
      "keepaliveSeconds": 30,
      "sessionExpirySeconds": 604800
    }
  },
  "localApi": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 9101,
    "authToken": "optional-local-maintenance-token",
    "maxBodyBytes": 65536,
    "allowedOrigins": []
  },
  "enableConsole": true
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `instanceId` | 是 | 本地进程实例标识 |
| `deviceId` | 是 | 后台设备唯一标识，同时写入请求头和事件 |
| `deviceName` | 是 | 窗口标题和终端展示名称 |
| `operatorId` | 建议 | 运营商或设备归属标识 |
| `storeId` | 建议 | 后台门店唯一标识 |
| `storeName` | 建议 | 界面显示的门店名称 |
| `environment` | 否 | 联调环境标签，例如 `development`、`staging` |
| `backend.mode` | 是 | `local` 或 `remote` |
| `backend.transport` | remote 时建议 | `mqtt5` 为设备实时主通道；`http` 为兼容/恢复模式 |
| `backend.baseUrl` | remote 必填 | 后台 API 根地址 |
| `backend.commandPollSeconds` | HTTP 兼容模式使用 | MQTT5 主通道不轮询设备命令，仅作为 HTTP 恢复模式参数 |
| `backend.heartbeatIntervalSeconds` | 否 | 心跳间隔 |
| `backend.progressReport.minDeltaPercent` | 否 | 整杯总进度变化达到该百分比时立即上报，默认 `5` |
| `backend.progressReport.maxIntervalSeconds` | 否 | 进度变化不足阈值时的最长静默秒数，默认 `5` |
| `backend.requestTimeoutSeconds` | 否 | 单次 HTTP 超时秒数 |
| `backend.userAgent` | 否 | 设备 HTTP 客户端标识，默认 `CoffeeTerminalSimulator/1.2.0`；避免使用通用脚本客户端签名 |
| `backend.authToken` | 否 | 静态 Bearer Token，仅建议测试环境使用 |
| `backend.headers` | 否 | 附加到所有后台请求的自定义请求头 |
| `backend.mqtt` | `mqtt5` 时必填 | Broker 地址、TLS 端口、会话和每设备凭证；密码只从 `.env` 注入 |

| `localApi.enabled` | 否 | 是否启动本地调试 API，默认 `true` |
| `localApi.host` | 否 | 默认 `127.0.0.1` |
| `localApi.port` | 否 | 本地 API 端口，多实例不能重复 |
| `localApi.authToken` | 条件必填 | 写接口的 `X-Local-Token`；非回环绑定或 production 环境必须配置 |
| `localApi.maxBodyBytes` | 否 | 本地写接口请求体上限，默认 65536 |
| `localApi.allowedOrigins` | 否 | 允许访问写接口的浏览器 Origin；默认拒绝所有带 Origin 的请求 |
| `enableConsole` | 否 | 预留开关；当前界面仍会显示控制台 |

MQTT心跳与普通进度允许缺失；待发进度按taskId合并。生命周期与结果不合并。下行进入内存队列后PUBACK，之后才写SQLite，仍有进程崩溃窗口。

remote 模式推荐通过 `COFFEE_DEVICE_TOKEN` 环境变量或 `.secrets/{instance}.env` 注入凭证。生产式联调使用首次安装向导或 `scripts/activate_instance.py` 和 `scripts/rotate_instance_credential.py` 管理凭证，不要把 `authToken` 写进 JSON。

### 首次安装配置

新实例可复制一个已有实例的配方/物料目录，再使用 `config/device.bootstrap.template.json` 覆盖其 `device.json`；删除复制来的 `state/`，并为 `localApi.port` 指定未被使用的端口。例如：

```bash
cp -R config/instances/coffee-bot-002 config/instances/new-terminal
rm -rf config/instances/new-terminal/state
cp config/device.bootstrap.template.json config/instances/new-terminal/device.json
# 编辑 device.json，把 localApi.port 改为未占用端口，例如 9103
./start-instance.command new-terminal
```

不要在新实例JSON中填写Token。remote、registration未COMPLETED且没有已加载authToken时进入安装界面。当前有两条路径：

- 软件配对：云端显式开启SIMULATOR_BOOTSTRAP_ENABLED，终端本地生成软件身份，商户认领配对码，终端完成provision并保存云端分配的身份和凭据。
- 兼容预登记激活：使用平台登记的deviceId/序列号和一次性激活码，旧安装入口按设备编号、年份与门店资料生成候选字段，必须匹配云端。

两者不要混用；软件配对不是工厂硬件证书。详见 [激活与配对](../ACTIVATION.md)。启动脚本未传--env-file时自动查找对应实例秘密文件。

运行模式：

- `local`：不连接后台；模拟下单和控制命令直接作用于本机。
- `remote + mqtt5`：通过 MQTT 接收命令、发送 ACK/心跳/状态/事件；激活、二维码、能力和库存快照仍走 HTTPS。
- 制作进度满足“变化阈值或最长间隔”任一条件就发送；任务/步骤生命周期和故障告警不受进度限频影响。
- `remote + http`：兼容模式，使用 HTTP 轮询命令并上报设备数据，适合故障恢复和旧部署。

## 3. recipes/*.json

### 3.1 示例

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

### 3.2 配方字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `recipeId` | 是 | 设备内部配方标识，命令使用它选择饮品 |
| `skuCode` | 是 | 与销售系统商品 SKU 对应的稳定编码 |
| `version` | 是 | 配方版本；配方变化后应提升版本 |
| `name` | 是 | 饮品显示名称 |
| `enabled` | 否 | 默认 `true`；关闭后仍会上报能力，但不可售 |
| `display` | 否 | 描述、排序及运营扩展字段，会随能力快照上报 |
| `visual` | 否 | 饮品形象配置 |
| `steps` | 是 | 非空的有序制作步骤数组 |
| `priceMinor` | 否 | 最小货币单位正整数；云端还可能应用商户价格 |
| `optionSchema` | 否 | 定制选项、规则版本、温度与加价；不得自行推断未声明的选项 |

### 3.3 步骤字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 配方内步骤标识，应保持唯一和稳定 |
| `name` | 是 | 界面和事件显示名称 |
| `durationSeconds` | 是 | 正数，作为基准执行时长 |
| `durationRandomization` | 否 | 本杯实际时长的最小、最大秒数 |
| `failureProfile` | 否 | 引用 `failures.json` 中的故障档案 |
| `consumes` | 否 | 本步骤实际消耗的共享物料数组 |
| `animationCue` | 否 | 本步骤使用的表现提示 |
| `robotActions` | 否 | 三维语义动作白名单，不是硬件命令 |
| `customizationRole` / `dispenseChannel` | 定制出料时 | 独立出料角色与模拟通道 |
| `latteArt` | 拉花时 | 花型ID/版本，另受热饮、剂量与最小时长约束 |

随机时长规则：

- `minSeconds > 0`。
- `maxSeconds >= minSeconds`。
- `durationSeconds` 必须位于最小值和最大值之间。
- 未配置随机区间时，实际时长等于 `durationSeconds`。
- 接单时每个步骤只随机一次，并冻结在该任务中。

### 3.4 物料消耗字段

```json
{
  "materialId": "milk",
  "amount": 180,
  "unit": "ml"
}
```

- `materialId` 必须存在于同一实例的 `materials.json`。
- `unit` 必须与物料定义完全相同。
- `amount` 必须大于 0。
- 同一种物料可以出现在多个步骤；整杯预占量是所有步骤用量之和。
- 所有饮品都消耗同一份设备库存。

### 3.5 展示枚举

`visual.profile` 当前支持：`espresso`、`americano`、`iced-latte`、`hazelnut-special`、`generic`。

`animationCue` 当前支持：`cup-arrive`、`ice-drop`、`brew-stream`、`water-pour`、`milk-pour`、`syrup-swirl`、`seal`、`serve`、`idle`。

`visual.cup` 和 `visual.layers` 当前作为展示元数据原样上报；后台若依赖它们，应另行固定枚举。

### 3.6 校验与生效

以下情况会使单个配方进入 `invalidRecipes`，且不作为设备能力发布：

- 缺少配方或步骤必填字段，或 `steps` 为空。
- 步骤时长或随机区间无效。
- `visual.profile` 或 `animationCue` 不受支持。
- 引用了不存在、单位不一致或用量非正数的物料。
- 同一实例出现重复 `recipeId`。

修改后调用本实例的配置重载接口，或重启程序：

```bash
curl -X POST http://127.0.0.1:9101/device/v1/config/reload \
  -H 'Content-Type: application/json' -d '{}'
```

活动任务期间不能重载。重载先校验候选材料、全部配方与故障配置，失败保留上一有效配置；启动时则隔离无效配方。成功后重新计算能力版本、可制作杯数和时间范围。配置了localApi.authToken的所有写请求还需 `X-Local-Token`。

## 4. materials.json

```json
{
  "schemaVersion": 1,
  "materials": [
    {
      "materialId": "milk",
      "name": "鲜奶",
      "unit": "ml",
      "capacity": 6000,
      "initialOnHand": 4800,
      "lowThreshold": 1200,
      "criticalThreshold": 300,
      "enabled": true
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `materialId` | 是 | 设备内唯一物料标识 |
| `name` | 是 | 展示名称 |
| `unit` | 是 | 计量单位，例如 `g`、`ml`、`count` |
| `capacity` | 是 | 最大允许库存；调整后不能超过它 |
| `initialOnHand` | 否 | 首次创建状态文件时的库存，默认 0 |
| `lowThreshold` | 是 | `onHand` 小于或等于该值时为 `LOW` |
| `criticalThreshold` | 是 | `onHand` 小于或等于该值时为 `CRITICAL` |
| `enabled` | 否 | 默认 `true`；禁用物料不能被新任务预占 |

建议满足：

```text
0 <= criticalThreshold <= lowThreshold <= capacity
0 <= initialOnHand <= capacity
```

当前数量保存在 `state/runtime.db` 的 `terminal_meta.inventory_state`。修改 `initialOnHand` 不会覆盖已存在的实时库存；它只在首次创建该物料状态时使用。

新增物料后重载配置即可建立状态。已经存在的物料不能直接修改 `unit`，否则重载失败。若业务上需要换单位，应新增新的 `materialId` 并迁移配方。

库存调整示例：

```bash
curl -X POST http://127.0.0.1:9101/device/v1/inventory/adjustments \
  -H 'Content-Type: application/json' \
  -d '{"materialId":"milk","mode":"SET","amount":6000,"reason":"OPERATOR_REFILL","operatorId":"operator-001"}'
```

`mode=SET` 设置绝对量；`mode=ADD` 在当前数量上增减。结果必须位于 0 到 `capacity` 之间。

## 5. 运行时状态与旧inventory.json

SQLite中的库存对象包含version、updatedAt、items、reservations及consumedKeys（最近最多1000个消耗键）。与任务、Outbox共用本地事务；旧JSON仅首次导入。启动有活动任务时保留预占，否则清理遗留预占。

备份先停止实例再复制整个state目录。完全重置仅适用于已确认可丢弃的测试实例：保留备份后移走整个state目录，让程序重新初始化；不要只删JSON或运行中只删db/WAL。生产式未决任务应走现场核验，不能用删库恢复待机。

## 6. failures.json

```json
{
  "globalFailureRate": 0.002,
  "profiles": {
    "brewer": {
      "failureRate": 0.015,
      "errorCode": "BREW_PRESSURE_LOW",
      "message": "萃取压力异常",
      "retryable": true,
      "maxRetries": 2,
      "timing": "after",
      "consumeOnFailure": true
    }
  },
  "stepOverrides": {
    "extract-coffee": {
      "failureRate": 0.2,
      "message": "测试：萃取高故障率"
    }
  }
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `failureRate` | `0` | 该环节基础故障概率，建议为 0 到 1 |
| `errorCode` | `SIMULATED_STEP_FAILURE` | 对后台稳定输出的错误码 |
| `message` | `{步骤名}失败` | 终端显示和事件消息 |
| `retryable` | `false` | 是否允许重试 |
| `maxRetries` | `0` | 此步骤最大重试次数 |
| `timing` | `after` | `before` 或 `after` |
| `consumeOnFailure` | `timing == after` | 故障时是否已消耗本步骤物料 |

步骤先读取其 `failureProfile`，再用 `stepOverrides[step.id]` 覆盖字段。没有对应档案时使用默认值。

配置全局故障率与控制台运行时故障率取较大值，再与档案概率合并：

```text
globalRate = max(config.globalFailureRate, runtime.globalFailureRate)
effectiveRate = 1 - (1 - globalRate) × (1 - profile.failureRate)
```

控制台临时覆盖只保存在内存，不修改 `failures.json`，重启后失效。

## 7. 常见操作

### 新增门店特调

1. 在目标实例的 `recipes/` 复制一个最接近的配方。
2. 修改 `recipeId`、`skuCode`、`version`、名称、步骤和耗材。
3. 确认所有物料已在该实例的 `materials.json` 中定义。
4. 重载配置。
5. 查询 `/device/v1/capabilities`，确认新饮品不在 `invalidRecipes` 且 `available=true`。

### 新增物料

1. 向 `materials.json` 添加唯一 `materialId`。
2. 重载配置，建立该物料的运行时状态。
3. 用本地库存调整接口设置实际数量。
4. 再在配方步骤中引用该物料并重载。

### 复制一台设备

```bash
cp -R config/instances/coffee-bot-001 config/instances/new-terminal
```

目标目录必须尚不存在。复制后在首次启动前移除新副本的整个state目录，重置新副本的注册/身份字段并设置独立端口；不要复制或复用源实例的.secrets/.identity。使用初始库存不能只删除inventory.json。

### 查询配置是否生效

```bash
curl http://127.0.0.1:9101/device/v1/health
curl http://127.0.0.1:9101/device/v1/capabilities
curl http://127.0.0.1:9101/device/v1/inventory
curl http://127.0.0.1:9101/device/v1/status
```

## 8. 修改前检查清单

- JSON 没有注释或尾随逗号。
- 新实例的 `deviceId`、`instanceId` 和端口唯一。
- 配方 `recipeId` 唯一，版本已提升。
- 步骤 `id` 在配方内唯一且稳定。
- 随机时长区间包含基准时长。
- 每个 `materialId` 存在，单位一致，用量为正数。
- 严重阈值不高于低库存阈值，初始数量不超过容量。
- 故障率在 0 到 1 之间，重试次数为非负整数。
- 制作任务结束后再重载配置。

## 9. 定制、历史版本与主动同步

选项语义与编译摘要见 [云端定制契约](../../coffee-cloud-mvp/docs/drink-customization.md)，拉花见 [UR双臂说明](../docs/ur-dual-arm-latte-art.md)。`robotActions` 允许cups/brew/water/milk/ice/syrup/lid/pickup/wait/latte-art。

控制台保存变更配方时会归档旧版本，未提升版本的内容修改会自动生成新版本。手工修改须自行保留 `recipe-archive/<recipeId>/<version>.json`。旧订单显式请求版本时可以读取验证后的归档，但当前饮品禁用/删除或缺少有效归档仍会拒绝。

“同步菜单到后台”重新加载已保存文件并上传products及完整recipes；不上传编辑框中未保存文字。云端确认前不算同步完成。详见 [北京菜单与运营交付](../docs/beijing-city-menu-and-sync.md)。
