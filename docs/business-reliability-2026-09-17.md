# 业务可靠性整改（2026-09-17）

基线：b74763d8fcec1ca25de93f89190ab3ca20cdeb18。实现分支：fix/business-reliability-20260917。

## 实现

- C-01：MQTT 网络回调只排入带 generation/MID/QoS 的队列；运行时线程提交 SQLite Inbox 后才 ACK。磁盘异常断开连接且不 ACK，旧连接数据可持久化但不能 ACK 新连接同 MID。启动和同步循环重放 RECEIVED；已有制作任务仍 recoveryHold，不能自动重做。
- S-01：单条命令执行使用外层 SQLite savepoint，将库存/任务变化、结果和待发送结果一起提交；保留内存回滚快照。接收事务先独立提交，执行存储失败保留 RECEIVED，不伪装成业务拒绝，也不推进 HTTP cursor。重复已完成命令只重新安排原结果发送。
- C-02：事件优先使用持久化 occurredAt、结果使用 completedAt 作为 envelope sentAt，重发同一事实保持稳定；云端另外兼容旧终端每次改变 sentAt 的行为。
- C-04：未执行命令统一检查有效期，拒绝非法/无时区期限；任务控制必须绑定 taskId，提供 expectedRevision 时校验版本。已完成同 ID 先返回原结果，不因现在过期改写事实。旧缺少有效期的命令暂时兼容；旧无目标的 pause/resume/skip/retry/cancel/clear/collect 拒绝。
- S-02：release(None) 全部释放，release({}) 无副作用，部分释放只影响指定预占；重复无变化释放不递增库存版本。
- S-03：配置拒绝 NaN/Infinity 及数值溢出，写 JSON 禁止非有限值；验证故障概率、时机、次数和布尔字段；物料必填项、容量/阈值及配方物料量在切换前校验。
- S-04：一次读取完整候选文件集，验证后在运行时锁及 SQLite 事务内切换 inventory/catalog/failures；不再次读取活动文件。结果生成或提交失败恢复旧对象、状态及同步标记。RELOAD_CONFIG 只读取文件，不修改外部配置文件；SQL 原子性不意味着外部文件编辑具有事务性。
- S-05：移除中英文后注册字典中的空字符串覆盖。
- S-06：模拟断网仅暂停传输，已经接受的任务继续执行；制作暂停保持独立。

## 兼容与恢复

先部署配套云端，再升级终端，避免旧云端产生无目标调试命令。SQLite 没有破坏性数据迁移，仅补充 RECEIVED 索引。未改真实实例数据库和凭据。

升级前应修正非法配置：物料需要 materialId/name/unit/capacity/lowThreshold/criticalThreshold，容量和阈值关系应有效；概率必须为有限数字且位于 0..1。非法文件不再延迟到制作中报错。

回滚应在设备无活动制作任务时按常规运维流程进行；保留本地 SQLite、Inbox/Outbox 和 recoveryHold。不能通过清库或换 taskId 重做来消除积压。

## 验证

- 子进程在补料结果提交前和事务完成后 os._exit，重新打开 SQLite/运行时并重投，最终只增加 5。
- 已持久接收但未开始的 MAKE_DRINK 可恢复；已开始任务重启后保持 PAUSED/recoveryHold，不重复扣料。
- 磁盘失败不 ACK；旧连接 generation 不误 ACK；真实 Mosquitto 验证未提交消息重投及提交后停止重投。
- 真实 Broker 积压 TTL、过期命令、旧任务目标、重复原结果、非法控制输入及业务摘要协同测试。
- 配置提交/响应生成失败回滚、非法配置拒绝、无耗材跳步和纯通信断网测试。

首轮验证：Python 126 passed，另有 6 subtests passed；Node 69 passed；没有失败或跳过项。已启动独立本机 Broker。未进行桌面 GUI、真实支付或物理硬件验收；模拟器行为不构成物理动作 exactly-once 保证。

## 复审补充：配方保存及永久参数错误

复审基线 aab16e9。两项 P2 均已用回归用例复现，补充修复如下：

- `display.sortOrder` 必须为有限数字，字符串、布尔值、空值、数组以及无法表示的超大整数都会在保存前拒绝。
- `save_recipe` 在临时目录校验候选配方并完整生成能力响应，然后直接安装同一候选对象，不再写文件后重新加载/生成能力响应。事件、运行时对象及 SQLite 提交失败时回滚；文件已替换的情况下恢复原始字节，新建配方失败则移除新文件。历史配方备份可能保留，它是旧内容的副本，不参与当前菜单。
- `amount` 的类型转换、溢出和非有限值属于永久参数错误，持久化为 REJECTED/INVALID_COMMAND 后继续后续命令。库存写入、结果提交或事件持久化异常仍回滚并保留 RECEIVED，不统一吞掉异常。
- 同时把配置中的超大数值转换失败归入验证错误，避免错误配方的 RELOAD_CONFIG 阻塞命令队列。

新增验收覆盖候选能力生成失败、文件替换后提交失败（现有/新建配方）、合法排序值、无期限超大整数旧命令的独立子进程启动，以及存储 OSError/ValueError 仍可重试。普通异常回滚不等于文件与 SQLite 具有跨介质断电事务；本次不宣称新增了这种保证。

复审修复后的全量验证：Python 140 passed，另有 6 subtests passed；Node 69 passed，无失败、无跳过。使用临时 PostgreSQL/Redis 及两个仓库各自独立的本机 Broker；未访问生产服务。

## 合并与部署状态

修复已合并 main（4763be1），VPS 隔离全套 Python 140 通过及 6 subtests 通过、Node 69 通过。VPS 仅同步终端源码，保留实例配置和凭据，未启动桌面程序或升级其他现场设备。配套云端已部署，详见[发布记录](../../coffee-cloud-mvp/docs/releases/2026-09-17-business-reliability.md)。
