# 发布清单（market-ready 检查）

> 状态：**0.2.0 代码已就绪，尚未公开**。公开前需要仓库/npm 身份决策（见下）。
> 市场规则以 [awesome-dsh-plugin contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
> 与本工作区 [RELEASING.md](../RELEASING.md) 为准。

## 已就绪

- [x] `dsh.bundle` manifest + `cordis.patch.yml`
- [x] 默认 `dryRun: true`：装上只发现、不安装（市场安全默认）
- [x] 用户配置：`<profile>/.dsh-auto-update/config.json` + `auto_update_configure` 工具
- [x] `LICENSE` / `CHANGELOG.md` / `assets/icon.svg` / `assets/icon-180.png`
- [x] 英文摘要 + 安装/配置/安全说明（README）
- [x] `npm test`（16）、`npm run check`、`.github/workflows/ci.yml`
- [x] `dsh.engines.dsh` 收紧到实测版本 `>=0.2.2-rc.3`

## 公开前还需要（身份相关）

- [ ] 决定 **GitHub 账号/仓库名**（公开仓库；当前只有本地 git）
- [ ] 决定 **npm scope/包名**：unscoped `dsh-auto-update` 在 npm 上可用，但与已有 `dsh-autoupdate@1.1.3`
      名称过近，可能被 npm 拒绝；建议 `@<npm账号>/dsh-auto-update`
- [ ] 去掉 `package.json` 的 `"private": true`，补 `repository` / `homepage` / `bugs`
- [ ] 公开仓库加 `dsh-plugin` topic；仓库创建满 1 天
- [ ] `npm test` + `npm run check` + `npm pack --dry-run` 在发布提交上重跑
- [ ] npm publish（`--registry=https://registry.npmjs.org`，2FA；本机需 staged publish）
- [ ] GitHub tag + Release（资产 = 同一份 npm pack）
- [ ] 市场 PR：只新增 `data/plugins/<owner>__<repo>.yml`（description.en 必填，category 选 `market` 或 `tools`）
- [ ] 确认市场条目描述只说功能：**启动静默、精确锁版、官方 updateBundle、跳过市场/自身/本地/GitHub**

## 仍然是短板的

- **没有设置面板（UI）**：目前只能改 JSON / profile patch，或让 agent 调 `auto_update_configure`。
  市场用户体验不如有面板的同类；如果要做，下一步是 client 半部 + 宿主配置路由。
- **没有快照/一键回滚**：只有官方管理器在“安装失败”时恢复旧版；运行时坏掉要手动回退。
- **依赖 beta API** `updateBundle`：DSH 升级时要跟着验证。
- 市场已有 6+ 个同类更新器；评审可能以“已被覆盖”为由不收，差异化写法见上。
