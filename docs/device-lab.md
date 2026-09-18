# 虚拟设备联调台

本入口用于调试规划软件：命令经 HTTP 进入独立服务，设备按配置执行，软件查询状态或订阅事件。三维页面读取同一服务状态，刷新或关闭网页不重置设备。原 `digital-twin.html` 是另一个独立离线实验入口，其 Worker 状态不与本服务互相控制。

## 启动与首次体验

```sh
npm ci
npm run twin:serve
```

打开 `http://127.0.0.1:9131/device-lab.html`。服务仅监听本机回环地址；Node 22+，无新增运行依赖。

- 选择“落杯器”，发送 `dispense`，观察出口有杯及杯库存减 1。
- “手动”时钟不会自动推进，点击“推进 1 秒”；实时模式按 1× 推进，加速模式为 16×。
- “生成新命令 ID”用于新动作；保留原 ID 重发用于验证去重。
- 保存配置时必须没有未结束命令。初始库存和预热时间在重置实验后生效；库存实际补充使用“补料”。
- 四个一键场景会先重置实验，然后使用同一个 HTTP 客户端运行规划器。失败时尽力取消本规划器未完成命令；无法确认取消的 ID 会列出，必须查询结果，不能盲目重发新命令。
- “正常制饮”共 32 个接口任务，比离线拿铁多一次真正的落杯；“落杯卡住”应失败且没有成功落杯扣数；“加工中断连”应在重连后找回结果；“丢通知”应通过原命令 ID 查询恢复，不重复出料。

命令行规划器同样通过 HTTP，不直接操纵仿真状态：

```sh
# 手动服务，由外部示例规划器推进仿真时间，适合快速重复测试
npm run twin:serve -- --manual
# 另开终端；每轮可先在页面重置，或取走上一杯成品
npm run twin:plan
npm run twin:plan -- --scenario jam
npm run twin:plan -- --scenario disconnect
npm run twin:plan -- --scenario lost-notification
```

启动端口与配置可指定：`npm run twin:serve -- --port 9132 --config /path/device-lab-config.json`。规划器对应 `--url http://127.0.0.1:9132`。示例配置源为 `config/twin/device-lab-v1.json`；世界几何沿用 `coffee-workcell-main-v2.json`。

## 页面操作与观察（交互修订）

- **选择设备**：点击卡片或用键盘聚焦后按 Enter，下方设备名称、动作列表、配置随之切换。状态刷新不再替换卡片节点；输入配置时也不会被刷新覆盖。
- **落杯没有变化时**：先看工作台下方的杯槽提示。当前为单杯槽位，上一杯在成品台时点「取走成品杯」，再生成新命令 ID 落杯。若时钟为手动，接收命令后还需点击「推进 1 秒」；默认落杯加启动延迟约 1.3 仿真秒。成功后杯对象出现在出口、杯库存减 1，执行中按仿真进度显示「分杯 → 下落 → 到位确认」，完成后才生成真实杯对象和扣库存；下落为示意动画，不是刚体动力学。「定位设备」可拉近视角。
- **一键场景**：选择情况 → 阅读预期结果 → 点「重置并运行场景」。该操作清空本轮实验，规划器自动发送整套命令。正常场景预期 32/32 完成且已封盖；卡杯场景预期失败且不扣杯，不应把预期故障当作页面坏了。
- **命令记录**：每行是一条动作，不是一杯订单。点「查看」选中记录，查看中文原因与下一步；需要查服务实际结果时点「查询最新结果」。当前选中的未结束命令每秒查询一次，显示等待、执行和终态；完整 JSON 和技术事件保留在折叠区。同 ID 重发不会开始新动作。
- **设备配置**：设备操作区分为「发命令」「设备配置」「异常模拟」「库存 / 会话」。配置页使用独立、可收缩的双列字段布局；完整运动限制、物料和库存仍可展开 JSON 修改。

页面配色、字体栈与品牌层级参照 `coffee-terminal-qarm-brand-v1.1.html`：奶油白/奶油底、森林绿、黄铜局部强调、深色技术日志、标准 Coffee Terminal 符号及次级 QARM 背书。无网络字体、额外品牌动效或体系外蓝紫配色。不同屏宽采用相同品牌令牌，窄屏纵向排列。

末端夹爪：新增左右独立工具设备，规格、开合接口与尺寸兼容边界见 [gripper.md](gripper.md)。

## 设备能力

| ID | 类型 | 动作 | 主要状态 |
|---|---|---|---|
| left / right | 机械臂 | move、grasp、release、transfer、stop、reset | 关节位置/速度、TCP、持物、当前命令 |
| cup-dispenser | 落杯器 | dispense、reset | 杯库存、出口有杯、卡杯故障 |
| brewer / foamer / hot-water | 加工设备 | process、clean、reset | 预热/加工/恢复、剩余时间、杯到位、物料 |
| ice-maker / syrup-pump | 定量出料 | process、clean、reset | 与加工设备相同，本默认拿铁未使用 |
| lidder | 封盖机 | seal、reset | 杯到位、盖库存、压头状态、封盖结果 |

每台设备通过 `GET /api/devices/{id}` 返回 capabilities（含是否可取消）、configuration、state、sensors、observedAt、online 和 currentCommandId。设备状态与命令状态分开。机械臂 stop 终止当前动作并保留当前位置/已持物；reset 清故障，不会把机械臂瞬移回原点。加工取消保留已流出的物料并释放剩余预留。落杯和封盖一旦运行不支持取消；开始前可以取消。

传感器包括 ready、cupPresent、gripperHasObject、headPosition、stockRemaining，由内部状态推导后按配置延迟发布。强制异常值只改变报告值，不修改真实杯对象或绕过碰撞。断连期间设备查询返回缓存的最后视图并标为 offline，命令结果查询返回 503；已开始的加工继续，重连可查询最终结果。

## 配置字段

| 字段 | 单位/含义 |
|---|---|
| timing.ackDelayMs | HTTP 接收确认延迟，真实毫秒；超时不等于动作未执行 |
| timing.startDelaySeconds | 接收至允许启动的仿真秒数 |
| timing.sensorDelaySeconds | 传感器值延迟发布的仿真秒数 |
| timing.warmupSeconds | 初始化/复位后的预热 |
| timing.durationSeconds | 基准剂量的加工耗时 |
| timing.cooldownSeconds | 加工后恢复时间 |
| timing.cleanSeconds / resetSeconds | 清洗/复位耗时 |
| timing.graspSeconds / releaseSeconds | 机械臂抓取/释放耗时 |
| motion.limits[0..5] | 每关节 min/max（rad）、velocity（rad/s）、acceleration（rad/s²）、jerk（rad/s³） |
| process.outputKg / inputs | 基准产出和原料；amountKg 定量命令按比例缩放用料与加工时间 |
| stock.initial / capacity | 初始杯/盖数量与容量，整数 |
| materials.*.amount | 初始原料 kg |

kind、工位和绑定杯对象属于世界布局，不允许在设备配置接口中变更。无效配置整批拒绝，旧配置保留。修改运动限制时还会检查当前关节是否在新范围内。模型名称可改；这不会自动加载厂家模型或标定参数。不要把 UI 播放倍率当作设备速度参数。

## API 契约

所有写操作携带当前 sessionId，通过 `GET /api/state` 获取。服务重启或实验重置生成新 ID，旧 ID 返回 409。接口实例、命令账本和配置修改只在当前进程保存；需要保留配置时导出 JSON，再用 `--config` 启动。没有声称支持断电后的持久命令恢复。

```json
{
  "sessionId": "从 /api/state 获取",
  "commandId": "order-001-cup",
  "deviceId": "cup-dispenser",
  "action": "dispense",
  "parameters": {},
  "startWithinSeconds": 30
}
```

POST 到 `/api/commands`。返回 202 和命令记录；同 ID、同参数返回原记录（200），同 ID 异参返回 409，永久拒绝的命令也保留结果。每个设备最多一条未结束命令；忙碌请求返回 REJECTED。新会话最多 10000 条命令，达到上限需新会话，不静默淘汰旧去重记录。

生命周期：`ACCEPTED → RUNNING → SUCCEEDED / FAILED`，另有 `REJECTED / CANCELLED / EXPIRED`。记录包含 startedAt、finishedAt、elapsedSeconds、estimatedDurationSeconds、progress、reason、result。所有业务时间使用仿真秒。

`startWithinSeconds` 是允许等待启动的时间，预热、缺料、工位占用也消耗这一等待时间；超期未启动会 EXPIRED。已经启动的命令不会因为这个字段被中止。客户端 HTTP 等待超时与此不同：用原 commandId 查询，不生成新 ID 重复执行。

| 方法/路径 | 作用 |
|---|---|
| GET /api/devices、/api/devices/{id} | 能力、配置、状态与传感器 |
| POST /api/commands | 提交设备命令 |
| GET /api/commands/{id} | 查原命令结果；离线设备返回 503 |
| POST /api/commands/{id}/cancel | 请求取消，body 含 sessionId |
| GET /api/events | SSE；device-event 命令/设备事件，snapshot 三维调试状态 |
| PUT /api/devices/{id}/config | body: {sessionId, configuration: 完整设备属性} |
| POST /api/devices/{id}/injection | body: {sessionId, options: 异常参数} |
| POST /api/refill | body: {sessionId, target: 原料或有库存的设备 ID, amount} |
| POST /api/pickup | 模拟顾客取走已释放到成品台的杯子 |
| POST /api/clock | body: {sessionId, clock: {mode, rate}} |
| POST /api/clock/advance | 手动模式：{sessionId, ticks: 1..500}，每 tick 20 ms |
| GET /api/config | 导出当前配置 |
| POST /api/session/reset | {sessionId, config?: 完整配置}；校验后重置并换会话 |

常用 parameters：

```json
{"station":"cups","approachObject":"cup"}
{"object":"cup"}
{"object":"cup","station":"brew"}
{"object":"milk-cup","amountKg":0.18}
{"source":"milk-cup","object":"cup","durationSeconds":6}
```

依次用于 move、grasp、release、process、transfer。move 的 approachObject 声明抓取/退出杯身时允许的夹爪接触；其余碰撞仍检查。seal 使用 `{ "object": "cup" }`。clean/reset/stop/dispense 参数为空对象。

异常 options：online（断连/重连）、fault（错误码）、faultAfterSeconds（下个动作运行后注入失败）、dropNextAck、dropNextCompletion、forcedSensors。丢确认时服务会关闭该 HTTP 响应，但命令已接收；丢完成仅丢一次完成事件，查询仍可恢复。事件最多保留最近 2000 条，SSE 重连有当前快照，客户端应重新查询关心的命令。调试 snapshot 和 `/api/state` 含内部世界真值，不能把它当作离线硬件反馈绕过设备接口。

## 限制与验证原则

- 单杯对象槽位：取走成品后才能再次落杯；并非多杯产线。顾客取杯也可由页面模拟。
- 基于名义运动学、简化几何与工艺时间。温度、压力、流体、封盖力和杯落下的动力学未建模。
- 通信故障为确定性注入；HTTP 确认延迟用墙钟，动作和传感器延迟用仿真时钟。实时模式不是硬实时调度，路径计算繁忙时可能落后墙钟；仿真步不会被跳过。
- 机械臂路径和碰撞仍使用同一个内核。碰撞停机后需要重置实验，本轮不提供自动脱困。
- 真实设备的 HTTP/MQTT/串口驱动未接入。本服务定义的是可替换的行为接口。
- 自动测试覆盖库存与幂等、配置原子性、启动期限、取消、卡杯复位、断连执行、通知丢失查询恢复、传感器异常，以及外部规划器的完整封盖拿铁。

## 设备动作的视觉反馈

落杯、咖啡/热水/糖浆出料、奶泡加工、倒奶和冰块出料均由服务端仿真状态驱动；封盖沿用压头动作。左上角显示动作阶段或进度。手动时钟暂停时画面也暂停，故障终止后不会继续播放成功动画。出料仅在目标容器位于对应工位时显示，质量和库存仍由内核计算。流束、蒸汽和冰块为过程示意，不是流体仿真；装饰杯堆不等于库存计数。

设备联调默认左右夹爪开口上限/初始开口均为 120 mm，抓取和释放先执行开合，再改变持物状态。可在设备配置修改两台工具各自的开合速度和上限，详见 [夹爪说明](gripper.md)。原实物额定 85 mm，本扩展仅用于软件联调。
