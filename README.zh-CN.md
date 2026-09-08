# Coffee Terminal Simulator

> 自动贩卖咖啡机终端模拟器中文说明。

[English README](README.md) · [文档索引](docs/README.md) · [Coffee Cloud 云端项目](https://github.com/woodbridgehi/coffee-cloud-mvp)

Coffee Terminal Simulator 是一个基于 Python、pywebview 的桌面终端模拟器，用于与 Coffee Cloud 后台进行端到端联调。它模拟联网咖啡机的软件行为，不要求真实硬件即可测试订单、制作、库存、告警、设备状态和异常恢复流程。

## 主要能力

- 展示云端下单二维码和设备状态。
- 从本地 JSON 读取配方、设备能力和物料定义。
- 从云端领取制作任务，按步骤计时执行。
- 模拟物料预占、消耗、补料、故障、重试、暂停、取消和断网。
- 向云端上报心跳、能力快照、库存快照和设备事件。
- 提供本地设备 API、开发控制台、HTTP remote 和 MQTT 5 remote 模式。
- 支持模拟器配对、一次性激活和凭证轮换。

模拟器不模拟真实机械动作，不处理正式支付和退款。手机端始终访问云端菜单和订单 API，不直接访问模拟器本地 API。

## 快速开始

项目使用 `uv` 和 Python 3.12：

```bash
cd /Users/alex/Downloads/armaster/coffee-terminal-simulator
uv venv --managed-python --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.lock
./start-instance.command coffee-bot-001
```

启动全部实例：

```bash
./start-all.command
```

启动调试窗口：

```bash
.venv/bin/python scripts/start_instance.py coffee-bot-001 --debug
```

## 演示实例

### 三维双臂工作站

双击 `start-robot-scene.command`，或执行 `./start-robot-scene.command`，打开本地 Three.js 三维场景。
包含双六轴机械臂、八个工位、三种饮品流程、时间轴及关节调试；无需连接云端。
模拟器默认二维，点击“查看三维制作”可跟随当前任务、配方和库存；手机订单状态页也可观看同一任务。上述独立页面用于自由演示。操作与接入说明见 [三维工作站](docs/robot-scene.md)。

| 实例 | 城市 | 饮品数 | 本地 API |
| --- | --- | ---: | ---: |
| `coffee-bot-003` | 北京 | 5 | `9103` |
| `coffee-bot-004` | 上海 | 4 | `9104` |
| `coffee-bot-005` | 深圳 | 4 | `9105` |

## 配置与同步

每个实例目录包含：

- `device.json`：设备身份、门店和后台连接配置。
- `recipes/*.json`：支持的饮品配方。
- `materials.json`：共享物料定义和初始库存。
- `failures.json`：故障模拟策略。
- `state/`：库存、任务和待上报事件统一保存在 `runtime.db`，以事务提交。旧 `inventory.json` 仅在数据库尚无库存时导入一次，之后编辑该 JSON 不会改变库存。备份时先关闭模拟器，再复制整个 `state/` 目录。

制作完成后会占用取杯位，不再 10 秒自动回到待机。现场确认杯子已取走后，点击“确认杯子已取走（模拟传感器）”释放位置；超过两分钟提示现场核查，重启保留占用。自动联调可向受原有本地写入鉴权保护的 `POST /device/v1/pickup/confirm` 提交 `{"taskId":"对应任务 ID"}`。手机只能查看取杯状态，不提供远程释放按钮。云端需要先执行迁移 22。

远程模式下，设备启动或重新连接时上传能力与库存快照；之后默认每 30 秒发送 heartbeat，只有配方版本或库存版本变化时才重新上传完整快照。云端离线期间保留最后一次成功上报的数据。

## 激活与安全

完整流程见 [ACTIVATION.md](ACTIVATION.md)。设备 Token、私钥、激活码和 MQTT 凭证只应保存在被 Git 忽略的 `.secrets/`、`.identity/` 文件中，禁止提交到仓库。

## 文档

- [文档索引](docs/README.md)
- [状态机与架构](coffee-terminal/DESIGN.md)
- [后台与本地 API](coffee-terminal/API.md)
- [实例配置参考](config/README.md)
- [变更记录](CHANGELOG.md)

## 测试

```bash
uv run pytest -q
```
