# dsh-auto-update

- **出处**：2026-11-14 按用户要求新建 —— 「DSH 启动时自动更新插件」。
- **是什么**：DSH 本地插件（desktop profile 用）。宿主启动约 15 秒后，在后台调用官方
  `pluginManager` 的 `listBundles` / `listVersions` / `updateBundle`，把已安装的第三方 npm 插件升级到
  **最新兼容版**；不阻塞启动、不改 DSH 本体、不自动重启应用。
- **状态**：`0.1.0`，本机自用，不发布 npm；出厂 `dryRun: true`（只发现、不落盘），验证后改 false。
- **处置**：保留。回滚 = 在 profile 的 `cordis.patch.yml` 给 `dsh-auto-update` / `dsh-auto-update-tools`
  加 `disabled: true`，或把 profile `package.json` 换回 `package.json.bak-20261114-before-autoupdate`。
- **关联**：`~/.dsh/profiles/desktop/package.json`（`link:` 指向本目录）· `cordis.patch.yml`（默认配置）·
  插件市场 `dshmarket`（人工更新商店/回滚入口）· `dsh-notification`（复用其 `toast.ps1` 发提示）。

## 它做什么 / 不做什么

**做**（每次 DSH 宿主启动，且一轮只跑一次）：

1. 等 `pluginManager` 就绪，再延迟 `delayMs`（默认 15 秒）。
2. 闸门：有 agent 在跑 → 每 60 秒重试、最多 30 分钟；profile 被活进程锁住、或插件市场有未完成的
   更新记录 → 跳过本轮。
3. 先收尾上次被中断的更新（`inProgress` 记录按磁盘实际版本判断）。
4. 对每个 `update: 'registry'` 的第三方已装依赖：查更新版本 → 选最新兼容版 → `updateBundle`。
5. 结果写 `<profile>/.dsh-auto-update/state.json` + `log.ndjson`；有变更时发一条 Windows toast。

**不做**：

- 不更新 `dshmarket` 自身（市场在桌面端不能自更新）、本插件自己、本地 `link:` 源码插件、GitHub 安装项、
  DSH 官方包。
- 不自动重启 DSH（本机代理环境由 `start-dsh.vbs` 注入，重启插件直接拉起 exe 会丢代理；
  需要重启时在下一次正常启动生效）。
- 不修改 DSH 安装目录或 `app.asar`。

## 配置

默认值写在 `cordis.patch.yml`；要覆盖就在 profile 的 `cordis.patch.yml` 里加同 id 条目：

```yaml
- id: dsh-auto-update
  name: dsh-auto-update
  config:
    enabled: true
    delayMs: 15000
    dryRun: false
    skip: ['dshmarket', 'dsh-auto-update', '某个不想动的包']
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉整个启动更新 |
| `delayMs` | `15000` | 启动后延迟 |
| `busyRetryMs` / `busyRetryForMs` | `60000` / `1800000` | 有 agent 在跑时重试间隔 / 最长等待 |
| `includeDisabled` | `true` | 未选入 bundles 的已装依赖也更新 |
| `allowPrerelease` | `false` | 允许预发布版（当前已装预发布时自动放行） |
| `allowDeprecated` | `false` | 允许 registry 标了 deprecated 的版本 |
| `skip` | `['dshmarket','dsh-auto-update']` | 永不自动更新的包名 |
| `dryRun` | `true` | 只发现、不安装 |
| `toast` / `toastOnNoop` | `true` / `false` | 变更提示 / 无更新时也提示 |
| `maxPackages` | `20` | 单轮最多处理候选数 |
| `lookupTimeoutMs` | `30000` | 单包版本查询超时 |

## 工具（agent 侧）

- `auto_update_status`：看最近一轮状态、逐包 `from → to`、是否需重启、有没有中断记录。
- `auto_update_run`：立即跑一轮。`{ "dryRun": true }` 只发现；`{ "dryRun": false }` 真安装；
  `{ "names": ["dsh-archived-chats"] }` 限定包名。有 agent 在跑或已有任务时拒绝；`{ "force": true }`
  可绕过“agent 在跑”闸门（只对**未装入当前组合**的包安全）。

## 落盘

```
<profile>/.dsh-auto-update/state.json     # lastRun 摘要 + inProgress
<profile>/.dsh-auto-update/log.ndjson     # 逐事件日志，512KB 轮转成 .1
```

`state.json` 里 `lastRun.results[]` 每项：
`{ name, from, to, application, step, changed, error, restore }`。
`application` 取值来自插件管理器：`applied` / `restart-required` / `overridden` / `failed` / `cancelled` / `would-update`（dry run）。

## 装/卸

- 安装（在 DSH 运行时）：`plugin_manager` 工具 `install_bundle`，target = 本目录绝对路径；
  管理器会写成 `link:` 依赖并激活 bundle。
- 卸载：`plugin_manager` 工具 `remove_bundle`，target = `dsh-auto-update`。
- 改完 `cordis.patch.yml` 或 profile 依赖后需要重启宿主才完全生效（HMR 能热载的前提下以管理器返回为准）。

## 验证

```powershell
node --test D:\dsh\plugins\dsh-auto-update\test\*.test.mjs
node --check D:\dsh\plugins\dsh-auto-update\lib\index.js
node D:\dsh\tools\hygiene-structure.mjs D:\dsh --depth 1
```

运行期：

1. 调 `auto_update_run { "dryRun": true }`，期望返回候选清单且 `dsh plugin --profile desktop list` 版本不变。
2. 调 `auto_update_run`（`"names": ["dsh-archived-chats"], "dryRun": false`）验证单包真实更新。
3. 重启 DSH 后读 `state.json`；`lastRun.trigger` 应为 `startup`，`checked` 为 profile 依赖数。

## 实测经验 / 坑

- 桌面端 profile 由 Electron 独占，`dsh --profile desktop` 的 CLI 操作在应用运行时会被拒；
  在线更新只能走宿主内的 `pluginManager` 服务。
- `installBundle` 对已存在的包会报 `already-installed`（DSH 0.2.2-rc.3 没有原地更新），
  所以更新必须用 `updateBundle`（它内部先卸载再安装，失败会恢复旧版）。
- `dshmarket` 不能自更新：桌面端卸载会把市场从运行组合里摘掉，补装那步执行不到。
