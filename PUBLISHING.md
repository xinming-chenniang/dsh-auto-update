# 发布清单（market-ready 检查）

> 状态：**0.2.0 已发布到 npm；仓库已 push、CI 绿、tag/Release 已建。市场 PR 等仓库满 1 天。**
> 市场规则以 [awesome-dsh-plugin contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
> 与本工作区 [RELEASING.md](../RELEASING.md) 为准。

## 已定

- 仓库：`https://github.com/xinming-chenniang/dsh-auto-update`（public，default branch `main`，创建于 2026-11-14
  18:33Z；**创建满 1 天后**才满足市场 CI）
- npm 包名：`@xinming-chenniang/dsh-auto-update`（npm 已登录 `xinming-chenniang`；unscoped 名与
  `dsh-autoupdate@1.1.3` 过近，不用）
- 默认关闭：包内 `dryRun: true`；本机用 profile patch 覆盖为 `false`
- 版本：`0.2.0`

## 已就绪

- [x] `dsh.bundle` manifest + `cordis.patch.yml`
- [x] 默认 `dryRun: true`：装上只发现、不安装（市场安全默认）
- [x] 用户配置：`<profile>/.dsh-auto-update/config.json` + `auto_update_configure` 工具
- [x] `LICENSE` / `CHANGELOG.md` / `assets/icon.svg` / `assets/icon-180.png`
- [x] 英文摘要 + 安装/配置/安全说明（README）
- [x] `npm test`（16）、`npm run check`、`.github/workflows/ci.yml`
- [x] `dsh.engines.dsh` 收紧到实测版本 `>=0.2.2-rc.3`
- [x] 去掉 `private`，补 `repository` / `homepage` / `bugs` / `publishConfig`

## 公开前还需要

- [x] `git push -u origin main`（HEAD `3cb8d48`）
- [x] `gh repo edit --add-topic dsh-plugin` + description
- [ ] 仓库创建满 1 天（2026-11-14 18:33Z + 24h = **2026-11-16 02:33 北京**）
- [x] `npm test` + `npm run check` + `npm pack --dry-run`
- [x] `npm publish`：`@xinming-chenniang/dsh-auto-update@0.2.0` 已上线（staged approve 完成）
- [x] GitHub tag + Release `v0.2.0`（资产 = 同一份 npm pack，SHA1 一致）
- [ ] 市场 PR：只新增 `data/plugins/xinming-chenniang__dsh-auto-update.yml`
- [x] 市场条目描述只说功能：**启动静默、精确锁版、官方 updateBundle、跳过市场/自身/本地/GitHub**

发布结果：

- npm：https://www.npmjs.com/package/@xinming-chenniang/dsh-auto-update
- GitHub Release：https://github.com/xinming-chenniang/dsh-auto-update/releases/tag/v0.2.0
- CI：success（Node 20/24）

市场条目草稿：

```yaml
url: https://github.com/xinming-chenniang/dsh-auto-update
name: xinming-chenniang/dsh-auto-update
category: market
description:
  en: 'Silently updates installed third-party DSH plugins shortly after startup through the host plugin manager; skips the market, itself, local link installs and GitHub installs.'
  zh: 'DSH 启动后在后台静默更新已装第三方插件；走官方插件管理器，跳过市场自身、本地 link 与 GitHub 安装项。'
icon: https://raw.githubusercontent.com/xinming-chenniang/dsh-auto-update/main/assets/icon-180.png
```

## 仍然是短板的

- **没有设置面板（UI）**：目前只能改 JSON / profile patch，或让 agent 调 `auto_update_configure`。
  市场用户体验不如有面板的同类；如果要做，下一步是 client 半部 + 宿主配置路由。
- **没有快照/一键回滚**：只有官方管理器在“安装失败”时恢复旧版；运行时坏掉要手动回退。
- **依赖 beta API** `updateBundle`：DSH 升级时要跟着验证。
- 市场已有 6+ 个同类更新器；评审可能以“已被覆盖”为由不收，差异化写法见上。
