# 终端运行时设计

核对日期：2026-09-17。本文以当前代码为依据，替代旧版计时执行与JSON库存说明。协议字段见 [API.md](API.md)，配置见 [配置参考](../config/README.md)。

## 定位和组成

Python + pywebview 终端模拟联网设备的软件行为。Three.js 提供UR10e简化双臂、工位和拉花示意；没有硬件运动控制、物理接触、RS-485/PLC驱动或正式支付退款执行。

| 模块 | 职责 |
| --- | --- |
| `app.py` / `onboarding.py` | 原生窗口、首次安装/软件配对、运行时装配 |
| `backend.py` | CoffeeDeviceRuntime、任务状态、库存协作、执行循环与上报 |
| `catalog.py` / `customization.py` / `latte_art.py` | 配方验证、版本归档读取、选项编译与拉花约束 |
| `inventory.py` / `state_store.py` | 库存、任务、命令Inbox、事件Outbox与SQLite事务 |
| `cloud.py` / `mqtt_transport.py` | HTTP和MQTT传输 |
| `local_api.py` | 本地查询、库存调整、重载、确认取杯 |
| `robot_view.py` / `web/robot/` | 冻结视觉计划与三维、音频渲染 |
| `showcase_packages.py` / `web/showcase/` | 本机展示包导入、预览、启用、回退 |

运行实例位于 `config/instances/<目录名>/`，身份来自device.json。同一实例状态目录不能由多个进程同时管理；不同实例不能复制共享秘密或运行状态。

## 接单和执行

1. `_process_commands()` 记录messageId与摘要；相同ID不同内容拒绝。
2. `_accept_task()` 校验任务结构、有效期、taskId重复、取杯位、当前活动任务、配方启用与版本。
3. 显式旧版本可从 `recipe-archive/<recipeId>/<version>.json` 读取，经当前物料/配方校验；当前配方不存在或禁用时不能借历史版本绕过。
4. 根据选项编译配方，校验compiledRecipeDigest；严格限定的无定制字段旧指令可走legacy-default兼容。
5. 预占整杯物料，随机时长只生成一次，冻结recipe和stepPlan，保存任务与ACK/事件。
6. 每约250ms增加模拟stepElapsed，达到时长后判定后置故障；正常完成才扣本步物料并推进下一步。

因此当前不是“进入步骤就扣料”。前置失败不扣本步，后置失败按consumeOnFailure处理。计时器只模拟过程，绝不表示真实传感器确认。

## 任务与设备状态

```text
ACKNOWLEDGED → RUNNING → SUCCEEDED
                   ├→ PAUSED → RUNNING
                   ├→ RETRY_WAIT → RUNNING
                   ├→ FAILED
                   └→ CANCELLED
```

终态不得retry/resume复活。普通pause可以resume；retry只针对RETRY_WAIT且检查次数与重新预占。拉花失败禁止重试倾倒。调试skip只用于模拟流程。

设备状态有IDLE、RESERVED、BUSY、READY、FAILED及RECOVERING。一次只保留一杯活动制作；云端负责多订单排队，不是设备一次缓存多杯执行。

## 库存和事务

`InventoryManager` 通过同一个LocalStateStore保存 `terminal_meta.inventory_state`。任务、命令、事件也在 `state/runtime.db`；SQLite采用WAL、synchronous=FULL并启动quick_check。

`atomic_runtime` 在锁和SQLite事务内保存关键运行时变化，失败恢复相应内存快照。它提供本地软件状态原子性，不能回滚外部物理动作。

- `onHand`：账面剩余；`reserved`：尚未消耗的预占；available为二者之差。
- 接单整杯预占；步骤完成或失败策略要求时扣减onHand和reserved。
- 消耗键 `taskId:stepId:attempt`；真正重试使用新attempt。
- 最终结束释放未消耗预占，不把已经用掉的物料补回。
- 旧 `inventory.json` 仅在SQLite无库存时导入；之后编辑它不改变运行库存。
- 启动有活动任务时保留预占，没有活动任务则清理遗留预占。

备份前停止实例，复制整个state目录；不要只复制运行中的单个db文件或只删除JSON重置库存。

## 完成与取杯

最后一步成功后设置取杯位OCCUPIED、任务SUCCEEDED、设备READY，等待现场取走确认；不再10秒自动待机。超过120秒转NEEDS_CHECK。占位跨重启保存，并阻止新任务。

现场按钮或 `POST /device/v1/pickup/confirm` 必须匹配taskId；确认后记录取杯事件，清除当前任务指针并回到IDLE。普通clear不能绕过占位。这仍是模拟传感器，不是已接实体杯位检测。

## 重启与存储异常

- local模式：可从保存的模拟检查点继续；不能用于真实硬件恢复。
- remote模式：活动任务重启后PAUSED + recoveryHold，设备RECOVERING，上报task.recovered。
- 执行事务异常也会保护性暂停并要求核验。
- `confirm_recovery(task_id, revision, checks)` 通过原生桥接完成现场核验，取消旧任务并记录recoveryReview；普通cancel/resume/retry/skip均不能替代。

核验的三个检查项、版本和任务必须匹配；不是员工登录系统，也不会驱动机械臂复位。详见 [现场核验](../docs/restart-recovery.md)。云端订单裁决不会自动清除本地物理占用。

## 网络、进度与投递保证

local无云连接；remote可选HTTP或MQTT5。MQTT仍通过HTTP处理配方/库存快照、展示配置及身份管理。心跳默认30秒；进度按整体变化至少5%或经过5秒任一条件触发，不是每5秒最多一次。

任务/步骤生命周期与命令结果持久重试；待发普通进度可合并。云端瞬时进度走Redis，订单终态走PostgreSQL。

MQTT使用持久会话、手动ACK、连接代际与SUBACK检查。下行由网络回调入队，运行循环提交 SQLite Inbox 后才 PUBACK；队列满或持久化失败会断开等待重投。旧连接代际不能确认新连接消息。启动及同步循环恢复 RECEIVED 命令；永久参数错误持久化拒绝后继续，存储异常保留重试。已完成命令重投只重发原结果，不再次应用业务副作用。

单纯网络错误不暂停当前计时制作；调试“模拟离线”只暂停云通信，本地计时制作继续。恢复后上传积压。HTTP永久4xx进入死信，429/5xx/网络错误退避；当前409按重复投递确认处理，不应据此假定所有409都是同一语义。

`prune_deliveries()` 默认清理7天前已发送事件与已发送结果的Inbox记录，不清除未发送/死信或所有任务历史；不是完整磁盘水位保护。

## 配方、展示和配置更新

启动目录校验隔离无效配方；显式reload先暂存校验全部候选，失败保留上一有效配置。活动任务期间拒绝保存/重载。技术控制台保存配方会处理版本升级并归档旧版本；手工替换文件应自行保留历史版本。

`request_menu_sync()` 重新加载已保存配置并请求上传；只有服务端确认才显示已同步。完整recipes可随能力快照上传，云端并无配方在线编辑/审核/下发系统。

品牌内容包独立于配方、库存和设备凭据。运营联合包导出包含showcase.zip、配方、历史配方和材料定义；没有自动导入整包功能。见 [展示包规范](../docs/showcase-partner-interface-v1.md)。

## 后续硬件与物理仿真方向（未实现）

建议先抽离统一异步动作执行接口，再增加CoppeliaSim/PyBullet/Gazebo或真实硬件后端，Three.js跟随标准状态。需要动作日志、可查询结果、资源互锁、真实完成判据、受控停止、传感器与异常核对。不能把当前robotActions、浏览器IK或计时完成直接用作实机控制依据。
