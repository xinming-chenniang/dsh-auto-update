# Changelog

## 0.2.3 — 2026-11-15

- **无更新时完全静默**：删掉 `toastOnNoop`（“没更新也提示”）这条路径，现在没有可装更新就
  不发任何提醒——不开始提醒、也不发“无更新”提示，只写日志。
- 修复 `toastOnStart` 没进用户配置白名单（写进 `config.json` 也会被读回时丢掉）的问题；补了回归测试。
- `auto_update_status` 的配置行加上 `toastOnStart`。
- 测试 27 个（新增无更新静默、`toastOnStart` 往返、退役键忽略）。

## 0.2.2 — 2026-11-15

- **开始安装时先提醒**：查出可装的更新后、真正安装前发一条 toast，列出精确的 `name from → to`，
  并说明「后台安装约 1–2 分钟，这期间先别开新会话」——不用等装完才知道，避免用户在这个窗口里
  开会话把更新撞掉。新增配置 `toastOnStart`（默认 `true`，可关）。
- 流程改为「先把所有候选的版本查完，再统一安装」：开始提醒里的版本号是准确的，
  也避免装到一半才发现某候选没有兼容版本。
- 新增 `update-started` 日志事件。
- 测试 25 个（新增 3 个开始提醒文案用例 + 1 个配置默认值断言）。

## 0.2.1 — 2026-11-15

- 更新完成后的 Windows toast 改成“告诉用户该做什么”：标题写「建议重启 / 需要重启」，正文逐条列
  `name from → to`，并明确「重启 DeepSeek Harness 后新版本才会加载」；有失败时一并报数量。
- `state.json` 与 `auto_update_status` 的逐包结果新增 `restartReason`（管理器给出时）。
- 新增 `toast-sent` / `toast-unavailable` 日志，提醒发没发出去以后能查。
- 测试 21 个（新增 4 个 toast 文案用例 + 1 个 `restartReason` 用例）。

## 0.2.0 — 2026-11-15

市场准备版本（未发布到 npm / 市场）。

- **安全默认**：包内 `dryRun: true`，装上后只发现候选、不安装；用户在 `<profile>/.dsh-auto-update/config.json`
  或 profile patch 里显式关掉 `dryRun` 才会真正更新。
- 新增 `<profile>/.dsh-auto-update/config.json` 用户配置（原子写入；覆盖 patch 配置，不覆盖代码兜底）。
- 新增 `auto_update_configure` 工具，agent 可写配置，无需手改 YAML。
- `auto_update_status` 现在同时显示有效配置（enabled/dryRun/skip/…）。
- 测试从 8 个纯函数用例扩到 16 个，增加 `run.js` 的 stub 集成测试（dry run / 真安装 / 用户配置 / agent 忙 / profile 锁）。
- 增加 `LICENSE`、`CHANGELOG.md`、`assets/icon.svg`、`assets/icon-180.png`、CI、发布清单。
- `dsh.engines.dsh` 收紧到实测版本 `>=0.2.2-rc.3`；标注 `dsh.compatibility.dshReleases`。
- README 去掉本机绝对路径，补充英文摘要、配置、安全/能力边界、市场准备状态。

## 0.1.0 — 2026-11-14

首个可用版本。

- 宿主启动后约 15 秒后台检查已装插件，走官方 `pluginManager.updateBundle`。
- 支持精确锁版的第三方 npm 依赖；跳过 `dshmarket`、自身、`link:`/GitHub/官方包。
- profile 写锁 / 插件市场未完成更新 / agent 忙碌时不动；忙碌最多重试 2 分钟。
- 结果写 `<profile>/.dsh-auto-update/state.json` 与 `log.ndjson`；有变更发 Windows toast。
- `auto_update_status` / `auto_update_run` 工具。
