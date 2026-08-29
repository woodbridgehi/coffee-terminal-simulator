# 设备登记、激活与启动操作手册

本文用于本地多个模拟器实例接入 `https://coffee-api.woodbridge.top`。激活码和设备 Token 都是秘密信息，不要粘贴到聊天、工单、截图或 Git。

## 1. 先确认三个标识

以下标识用途不同：

| 标识 | 001 当前值 | 用途 |
| --- | --- | --- |
| 实例目录/启动参数 | `coffee-bot-001` | 定位本地 `config/instances/coffee-bot-001/` |
| `device.json.deviceId` | `coffee-bot` | 云端协议身份，必须与管理台登记的 `deviceId` 完全一致 |
| 云端序列号 | `001` | 运营查询标识，可以与 `deviceId` 不同 |

后台登记时不要把序列号误填成 `deviceId`。如果管理台登记的是 `coffee-bot`，本地 `deviceId` 也必须是 `coffee-bot`；否则激活返回 HTTP 404。

## 2. 管理台预登记设备

1. 打开 `https://coffee-api.woodbridge.top/admin` 并输入管理员 Token。
2. 点击“登记新设备”。
3. 填写稳定且唯一的 `deviceId` 与出厂序列号；新设备必须采用受约束格式。
4. 点击“登记并生成激活码”。
5. 复制只展示一次的激活码。创建新激活码会取消该设备此前尚未使用的旧码。

建议新设备统一采用：

```text
实例目录：coffee-bot-003
deviceId：coffee-bot-003
序列号：CB-2026-003
instanceId：由首次安装向导生成 instance-coffee-bot-003
```

设备身份由后台预登记；首次启动时模拟器安装向导填写城市、店铺名称、简介和设备展示名称，并在激活成功时仅补齐后端为空的部署资料。后端已有资料不会被终端覆盖。

## 3. 配置 remote 模式

以 001 为例，编辑 `config/instances/coffee-bot-001/device.json`：

```json
{
  "deviceId": "coffee-bot",
  "backend": {
    "mode": "remote",
    "baseUrl": "https://coffee-api.woodbridge.top",
    "commandPollSeconds": 2,
    "heartbeatIntervalSeconds": 10,
    "requestTimeoutSeconds": 8
  }
}
```

不要把 `authToken` 写入 JSON。设备 Token 由激活工具写入被 Git 忽略的 `.secrets/`。

## 4. 安全写入激活码

进入项目目录：

```bash
cd /Users/alex/Downloads/armaster/coffee-terminal-simulator
mkdir -p .secrets
read -r -s ACTIVATION_CODE
```

终端不会显示输入字符，这是正常的。粘贴激活码并按回车，然后执行：

```bash
printf '%s\n' "$ACTIVATION_CODE" > .secrets/coffee-bot-001.activation-code
unset ACTIVATION_CODE
chmod 600 .secrets/coffee-bot-001.activation-code
```

只检查格式，不显示秘密：

```bash
wc -l .secrets/coffee-bot-001.activation-code
stat -f '%Lp %N' .secrets/coffee-bot-001.activation-code
```

预期是一行、权限 `600`。`touch` 只改变文件时间或创建空文件，不会写入、修复或替换激活码。

## 5. 验证错误激活码

仅测试一次，错误码至少 12 个字符：

```bash
printf '%s\n' 'wrong-activation-code-001' > .secrets/coffee-bot-001.activation-code

.venv/bin/python scripts/activate_instance.py coffee-bot-001 \
  --activation-code-file .secrets/coffee-bot-001.activation-code \
  --secrets-file .secrets/coffee-bot-001.env
```

设备标识正确时，预期返回 HTTP 401。工具会留下：

```text
.secrets/coffee-bot-001.env.activation-pending
```

pending 文件保存终端已生成但尚未激活的 Token。不要删除它；正确激活时工具会复用同一 Token，验证响应丢失/重试安全性。

默认最多允许 5 次错误尝试。达到上限后激活码会锁定，需要在管理台生成新码。

## 6. 换成正确激活码并重试

再次安全输入管理台生成的正确激活码：

```bash
read -r -s ACTIVATION_CODE
printf '%s\n' "$ACTIVATION_CODE" > .secrets/coffee-bot-001.activation-code
unset ACTIVATION_CODE
chmod 600 .secrets/coffee-bot-001.activation-code
```

重复同一激活命令：

```bash
.venv/bin/python scripts/activate_instance.py coffee-bot-001 \
  --activation-code-file .secrets/coffee-bot-001.activation-code \
  --secrets-file .secrets/coffee-bot-001.env
```

成功后 pending 文件会被原子提升为 `.secrets/coffee-bot-001.env`，工具只输出凭证版本，不输出 Token。

云端 v0.5 启用 MQTT credential lifecycle 后，激活响应还会一次性返回该设备专属 MQTT username/password。脚本会把 `COFFEE_TRANSPORT=mqtt5` 与 `MQTT_HOST/PORT/USERNAME/PASSWORD` 一并安全写入同一个受限 `.env`，不会打印密钥。如果 HTTP 激活已成功但响应在本地落盘前丢失，重新运行命令会使用新 HTTP 凭证调用 MQTT rotate 接口恢复，不需要重新登记设备。

安全检查环境文件，不显示内容：

```bash
stat -f '%Lp %N' .secrets/coffee-bot-001.env
awk -F= '{print NR ": " $1}' .secrets/coffee-bot-001.env
```

## 7. 启动与验证

图形界面：

```bash
./start-instance.command coffee-bot-001 \
  --env-file .secrets/coffee-bot-001.env
```

无界面验证：

```bash
.venv/bin/python scripts/run_headless.py coffee-bot-001 \
  --env-file .secrets/coffee-bot-001.env \
  --duration 60
```

看到 `connection: ONLINE` 后，在管理台确认设备为在线，`instanceId`、`storeId`、软件版本和最近心跳正确。停止进程并等待心跳租约超时后，设备应保留在历史列表并变为离线。

## 8. 常见错误

| HTTP/现象 | 含义 | 处理 |
| --- | --- | --- |
| `404` | 本地 `deviceId` 在云端不存在 | 对比管理台登记的 `deviceId` 和 `device.json.deviceId`，要求完全一致 |
| `401` | 激活码错误、过期、锁定，或设备凭证无效 | 检查是否使用当前激活码；达到尝试上限后生成新码 |
| `409 activation code already consumed` | 已消费激活码被另一 Token 使用 | 不要删除 pending 后生成新 Token；必要时生成新激活码 |
| 启动后离线/401 | 未加载 `.secrets/{instance}.env` | 使用 `--env-file` 启动，不把 Token 写进 JSON |
| 只有 `.activation-pending` | 激活尚未成功或响应失败 | 保留 pending，修复原因后重跑同一命令 |

## 9. 凭证泄露与轮换

如果设备 Token 曾出现在聊天、日志或截图中，立即轮换：

```bash
.venv/bin/python scripts/rotate_instance_credential.py coffee-bot-001 \
  --secrets-file .secrets/coffee-bot-001.env
```

轮换成功后新 Token 原子写入本地秘密文件，旧 Token 只在短暂宽限期内有效，之后自动过期。

只升级或轮换 MQTT 凭证（保留当前 HTTP Token）：

```bash
.venv/bin/python scripts/rotate_mqtt_credential.py coffee-bot-001 \
  --secrets-file .secrets/coffee-bot-001.env
```
