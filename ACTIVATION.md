# 激活、软件配对与凭证操作

核对日期：2026-09-17。两条身份路径均以当前源码为依据；云端开关与运行状态必须单独检查。完整身份边界见 [云端身份说明](../coffee-cloud-mvp/docs/device-registration-pairing-design.md)。

## 先选择路径

| 场景 | 使用方式 | 前提 |
| --- | --- | --- |
| 新软件模拟器绑定商户 | 安装界面生成配对码 → 商户认领 → 设备完成配对 | 云端SIMULATOR_BOOTSTRAP_ENABLED=true，商户功能与权限可用 |
| 平台已预登记设备 | 一次性激活码，安装界面或activate_instance.py | deviceId/序列号匹配登记记录 |
| 已激活实例 | 加载原秘密文件直接启动 | 不重新生成身份、不复制其他设备状态 |

本地实例目录名用于启动查找；deviceId用于协议；serialNumber用于序列标识；deviceName仅展示。不要把某个历史001实例的具体值作为所有安装的默认值。

## 软件配对

1. 为新实例准备配方/材料和独立端口，保留未配置注册状态；不要复制旧实例state、.identity或.secrets。
2. 启动remote实例。无已加载Token且registration未COMPLETED时显示首次安装界面。
3. 终端创建软件密钥并申请会话，显示短期配对码。
4. 商户在自己的组织中创建/选择门店，使用配对码认领。
5. 终端查询会话并完成provision，保存设备资料及HTTP/MQTT凭据；按界面提示重新启动并检查上线。

它使用软件密钥证明，不是实体安全芯片证书。云端未开启开发配对时不能用反复重试绕过；使用预登记激活或由部署方明确启用对应环境。

## 预登记激活

平台在 `/admin` 登记deviceId与serialNumber并生成一次性激活码；创建新码会使旧待用码失效。JSON中保留正确身份和backend.baseUrl，不写Token。

在受保护文件中保存激活码，文件权限设600；不要把秘密写入命令参数、Git或文档。执行：

```bash
.venv/bin/python scripts/activate_instance.py <实例目录名> \
  --activation-code-file .secrets/<实例目录名>.activation-code \
  --secrets-file .secrets/<实例目录名>.env
```

脚本先生成pending凭据，云端成功后提升为正式秘密文件。失败/响应丢失时保留pending并重试同一请求，不删除后另造Token。MQTT签发依赖云端EMQX配置；HTTP激活成功但MQTT结果丢失时，脚本包含对应恢复轮换路径。

不把故意使用错误激活码作为正常安装步骤；默认最大尝试次数为5，超限需要新码。

## 启动与核对

```bash
./start-instance.command <实例目录名> --env-file .secrets/<实例目录名>.env
```

未指定env-file时，start_instance.py会自动查找对应实例秘密文件。无界面工具：

```bash
.venv/bin/python scripts/run_headless.py <实例目录名> \
  --env-file .secrets/<实例目录名>.env --duration 60
```

headless remote会连接云端并可能接收真实联调任务，只对授权的测试实例使用。核对设备ID、配方/库存、端口、上报及后台在线状态；ONLINE只说明连接状态，不证明机器可接单或已完成物理恢复。

## 轮换

```bash
.venv/bin/python scripts/rotate_instance_credential.py <实例目录名> \
  --secrets-file .secrets/<实例目录名>.env
.venv/bin/python scripts/rotate_mqtt_credential.py <实例目录名> \
  --secrets-file .secrets/<实例目录名>.env
```

前者轮换HTTP凭据，后者用于MQTT凭据；保留失败时的pending材料，按工具结果核对。秘密更新后运行进程需加载新配置，不能把写入文件当成正在运行的连接已经切换。

Windows打包入口启用DPAPI，凭据和身份应由同一Windows用户使用；不要把DPAPI封装文件作为普通明文env迁移到其他机器。见 [Windows打包](packaging/windows/README.md)。

## 排障

| 现象 | 检查 |
| --- | --- |
| 激活404 | 云端是否登记相同deviceId，是否访问正确backend地址 |
| 激活401 | 激活码是否过期/错误/锁定，凭据是否对应 |
| 激活409 | 已消费码与Token是否匹配，不要删除pending另造Token |
| 软件配对不可用 | bootstrap开关、会话有效期、商户认领和本地软件身份 |
| 启动401或离线 | 是否加载对应秘密文件，HTTP和MQTT凭据是否分别有效 |
| 本地端口占用 | 先确认是否已有实例在运行，不要双开同一状态目录 |
| 重启后待核验 | 按 [现场核验](docs/restart-recovery.md) 处理，不删库绕过 |
