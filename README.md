# dsh-quiet-update

Silent, startup-time updates for the third-party plugins installed in a DeepSeek Harness (DSH) profile.

- **Origin**: 2026-11-14, built for “update plugins automatically when DSH starts”.
- **What it is**: a host-side DSH plugin. About 15 seconds after the Host starts it calls the host's own
  `pluginManager` (`listBundles` → `listVersions` → `updateBundle`) and upgrades installed third-party npm
  plugins to the newest **compatible** version. It does not block startup, does not modify DSH itself, and
  never restarts the app.
- **Status**: `0.3.0` (renamed from `@xinming-chenniang/dsh-auto-update` on 2026-11-15 to stop competing
  with the five same-named “update DSH itself” plugins in the market), source at
  [xinming-chenniang/dsh-quiet-update](https://github.com/xinming-chenniang/dsh-quiet-update).
  The package ships with `dryRun: true` (discover only); a profile must opt in to real updates.
  See [PUBLISHING.md](PUBLISHING.md) for market-readiness.
- **License**: MIT.

## 定位：窄而静默（2026-11-15 定）

这个插件只做一件事：**每次 Host 启动后，安静地把已装第三方插件升到最新兼容版**。
它服务于“不想让插件更新占用注意力”的场景，因此更新在后台发生，没事就不出声；
需要人做的只有两件——有更新时这 1–2 分钟别开新会话（开始提醒），方便时重启一次（完成提醒）。

明确的**非目标**（不做，也别再加）：

- 设置面板 / 客户端半部 / 市场式浏览与勾选界面；
- 逐包白名单面板、界面化更新历史、快照与一键回滚；
- 启动之外的定时/空闲窗口调度（长期不重启就不更新，接受这个边界）；
- 修改 DSH 本体、安装目录或 `app.asar`。

判断标准：**新增一个功能前先问“它会不会让人多看一眼”**——会，就不做。
市场对比里这些是竞品的强项，不是这里的路线。

## 它做什么 / 不做什么

**做**（每个 Host 进程只跑一次）：

1. 等 `pluginManager` 就绪，再延迟 `delayMs`（默认 15 秒）。
2. 闸门：有 agent 在跑 → 每 60 秒重试、最多等 2 分钟（再久就放弃，等下一次启动）；
   profile 被活进程锁住、或插件市场有未完成的更新记录 → 跳过本轮。
3. 先收尾上次被中断的更新（`inProgress` 记录按磁盘实际版本判断）。
4. 对每个 `update: 'registry'` 的第三方已装依赖：先查更新版本 → 选最新兼容版，再统一安装；
   安装开始前先发一条提醒（`toastOnStart`）：列出准确的 `from → to`，说明“后台安装约 1–2 分钟，
   这期间先别开新会话”，装完再发结果。
5. 结果写 `<profile>/.dsh-quiet-update/state.json` + `log.ndjson`；有变更时发一条 Windows toast：
   标题写明「建议重启 / 需要重启」，正文逐条列 `from → to` 并说明**重启后新版本才会加载**，
   有失败时一并报数量（可关；没有 `dsh-notification` 时只写日志，不报错）。
   **没有可装更新时完全静默**：不发开始提醒、不发完成提醒，也不发“无更新”提示——只写日志。

**不做**：

- 不更新 `dshmarket` 自身（市场在桌面端不能自更新）、本插件自己、本地 `link:` 源码插件、GitHub 安装项、
  DSH 官方包。
- 不自动重启 DSH；需要重启才生效的更新留到下一次正常启动。
- 不修改 DSH 安装目录或 `app.asar`；不直接写 `package.json` / `pnpm-lock.yaml`（交给宿主管理器）。

## 安装

要求：DSH `0.2.2-rc.3` 及以上（`updateBundle` 在该版本实测）。

```sh
dsh plugin --profile <profile> add dsh-quiet-update
```

或在 DSH 的「插件 → 安装」里填包名。装完重启 DSH（宿主半边在进程启动时加载）。

## 默认是“只发现不安装”

包内 `cordis.patch.yml` 默认 `dryRun: true`：装上后启动只查询候选、写日志，不安装任何东西。
要让某个 profile 真正自动更新，二选一：

### A. 用户配置文件（推荐，无需改 YAML）

`<profile>/.dsh-quiet-update/config.json`，例如：

```json
{
  "dryRun": false,
  "skip": ["dshmarket", "dsh-quiet-update", "some-package"]
}
```

也可以让 agent 调 `auto_update_configure` 工具写这个文件。用户配置覆盖 DSH patch 配置；
`delayMs` 的改动在下一次 Host 启动生效。

### B. profile patch

```yaml
- id: dsh-quiet-update
  name: dsh-quiet-update
  config:
    dryRun: false
    busyRetryForMs: 120000
```

## 配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉整个启动更新 |
| `dryRun` | `true` | 只发现、不安装；置 `false` 才真更新 |
| `delayMs` | `15000` | 启动后延迟 |
| `busyRetryMs` / `busyRetryForMs` | `60000` / `120000` | 有 agent 在跑时重试间隔 / 最长等待 |
| `includeDisabled` | `true` | 未选入 bundles 的已装依赖也更新 |
| `allowPrerelease` | `false` | 允许预发布版（当前已装预发布时自动放行） |
| `allowDeprecated` | `false` | 允许 registry 标了 deprecated 的版本 |
| `skip` | `['dshmarket','dsh-quiet-update']` | 永不自动更新的包名 |
| `toast` / `toastOnStart` | `true` / `true` | 更新后的提醒 / **开始安装时的提醒**（别开新会话）。没有可装更新时完全静默，没有“无更新”提示 |
| `maxPackages` | `20` | 单轮最多处理候选数 |
| `lookupTimeoutMs` | `30000` | 单包版本查询超时 |

## 工具（agent 侧）

- `auto_update_status`：有效配置 + 最近一轮状态、逐包 `from → to`、是否需重启、有没有中断记录。
- `auto_update_run`：立即跑一轮。`{ "dryRun": true }` 只发现；`{ "dryRun": false }` 真安装；
  `{ "names": ["some-package"] }` 限定包名；`{ "force": true }` 绕过“agent 在跑”闸门
  （只对**未装入当前组合**的包安全）。
- `auto_update_configure`：写用户配置文件，不用手改 YAML。

## 落盘

```
<profile>/.dsh-quiet-update/config.json   # 可选，用户配置
<profile>/.dsh-quiet-update/state.json    # lastRun 摘要 + inProgress
<profile>/.dsh-quiet-update/log.ndjson    # 逐事件日志，512KB 轮转成 .1
```

`state.json` 里 `lastRun.results[]` 每项：
`{ name, from, to, application, step, changed, restartReason, error, restore }`。
`application` 取值来自插件管理器：`applied` / `restart-required` / `overridden` / `failed` / `cancelled` / `would-update`（dry run）；
`restartReason` 是管理器给出的重启原因（`no-hmr` / `package-moved` / `host-module` / `unmanaged-plugin` / `module-comparison`），
没有给出时为 `null`。

## 安全 / 能力边界

- **进程**：只在 Windows 上、且仅当 `dsh-notification` 已安装时，spawn 一次 PowerShell 执行它的
  `toast.ps1` 发通知；没有该插件、非 Windows 或 `toast:false` 时不起子进程。
- **文件**：读 profile 的写锁 / `.dsh-market/pending-updates.json`；只在 `<profile>/.dsh-quiet-update/` 下写
  config/state/log。插件依赖、`node_modules`、`package.json` 的改动全部由宿主 `pluginManager` 完成。
- **网络**：插件自己不 fetch；版本查询与安装由宿主的 `listVersions` / `updateBundle` 走 profile 的
  registry/代理配置。
- **凭据**：不读、不传、不落任何 token 或凭据；无遥测。
- **范围**：只处理 `update === 'registry'` 的第三方 npm 依赖；`link:` / `file:` / GitHub / 官方包一律跳过。

## 兼容性

- 实测：DSH `0.2.2-rc.3`（desktop）。
- 依赖 beta API `pluginManager.updateBundle`；服务缺失时安静跳过（`skipped: plugin-manager-unavailable`）。
- 低于 `0.2.2-rc.3` 的版本未验证，`dsh.engines.dsh` 已收紧。

## 开发 / 验证

```sh
npm test
npm run check
npm pack --dry-run
```

运行期：

1. `auto_update_run { "dryRun": true }` → 返回候选清单，依赖版本不变。
2. `auto_update_run { "names": ["some-package"], "dryRun": false }` → 验证单包真实更新。
3. 重启 DSH 后读 `state.json`；`lastRun.trigger` 为 `startup`，`checked` 为 profile 依赖数。

## 实测经验 / 坑

- 桌面端 profile 由 Electron 独占，`dsh --profile desktop` 的 CLI 操作在应用运行时会被拒；
  在线更新只能走宿主内的 `pluginManager` 服务。
- `installBundle` 对已存在的包会报 `already-installed`（DSH 0.2.2-rc.3 没有原地更新），
  所以更新必须用 `updateBundle`（它内部先卸载再安装，失败会恢复旧版）。
- `dshmarket` 不能自更新：桌面端卸载会把市场从运行组合里摘掉，补装那步执行不到。
- **更新 ≠ 生效**：包是在启动后换到磁盘上的，宿主插件的新代码要下一次启动才加载。
  所以提醒必须写清「重启 DSH」；`application: 'applied'` 只说明管理动作成功，不等于新模块已在跑。

## English

A DSH host plugin that silently updates installed third-party npm plugins shortly after each Host start.
It uses the host's official `pluginManager` (`listBundles` → `listVersions` → `updateBundle`), so
compatibility checks, the profile lock, pnpm and failure recovery stay in the host. It handles
exact-pinned registry dependencies, skips `dshmarket` itself, local `link:` installs, GitHub installs and
official packages, and never restarts the app.

Installs default to `dryRun: true` (discover only). Opt in per profile with
`<profile>/.dsh-quiet-update/config.json` (`{"dryRun": false}`) or a profile patch override.
Install with `dsh plugin --profile <profile> add dsh-quiet-update`.
See [CHANGELOG.md](CHANGELOG.md) and [PUBLISHING.md](PUBLISHING.md).
