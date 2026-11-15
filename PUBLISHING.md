# 发布清单（market-ready 检查）

> 状态：**0.3.0 在本地（改名版，未发 npm、未 push）。** 旧包 `@xinming-chenniang/dsh-auto-update@0.2.0`
> 仍在 npm；新包 `dsh-quiet-update` 需要先 `npm login`（2026-11-15 实测 `npm whoami` = `ENEEDAUTH`）。
> 市场 PR 等仓库创建满 1 天（2026-11-16 02:33 北京）。
> 市场规则以 [awesome-dsh-plugin contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
> 与本工作区 [RELEASING.md](../RELEASING.md) 为准。

## 改名（0.3.0，2026-11-15）

市场索引里已有 **5 个叫 `dsh-auto-update`** 的条目（都在做 DSH 本体自更新），我们的 scoped 包搜索时会被淹没。
用户拍板改名：

- npm 包：`@xinming-chenniang/dsh-auto-update` → **`dsh-quiet-update`**（unscoped，已确认未被占用）
- GitHub 仓库：`xinming-chenniang/dsh-auto-update` → **`xinming-chenniang/dsh-quiet-update`**
  （GitHub 改名保留仓库创建时间，旧 URL 301；**未实测市场 CI 是否认可改名后的创建时间**）
- 市场条目：`xinming-chenniang/dsh-quiet-update`
- 本地 profile 迁移（关 DSH 时做）：把 `link:` 换成 `link:D:/dsh/plugins/dsh-quiet-update`，
  patch 里的 id/name、`.dsh-auto-update` 状态目录一起改名，旧包 `npm deprecate` 指向新包。

## 定位（2026-11-15 用户拍板：做窄）

只做「启动后静默更新 + 两段提醒」，**不做 UI、白名单面板、界面历史、快照/回滚、启动外调度**。
理由：这个插件的场景就是“不想让插件更新占注意力”；上架文案要卖这个差异点，而不是跟
`dsh-plugin-upgrader` / `dsh-update-checker` 比面板完成度。详见 README「定位：窄而静默」。

## 已定

- 仓库：`https://github.com/xinming-chenniang/dsh-quiet-update`（public，default branch `main`，创建于 2026-11-14
  18:33Z；**创建满 1 天后**才满足市场 CI）
- npm 包名：`dsh-quiet-update`（unscoped；确认 npm 未占用）
- 默认关闭：包内 `dryRun: true`；本机用 profile patch 覆盖为 `false`
- 版本：`0.3.0`（改名版；npm 上待发布）

## 已就绪

- [x] `dsh.bundle` manifest + `cordis.patch.yml`
- [x] 默认 `dryRun: true`：装上只发现、不安装（市场安全默认）
- [x] 用户配置：`<profile>/.dsh-quiet-update/config.json` + `auto_update_configure` 工具
- [x] `LICENSE` / `CHANGELOG.md` / `assets/icon.svg` / `assets/icon-180.png`
- [x] 英文摘要 + 安装/配置/安全说明（README）
- [x] `npm test`（27）、`npm run check`、`.github/workflows/ci.yml`
- [x] `dsh.engines.dsh` 收紧到实测版本 `>=0.2.2-rc.3`
- [x] 去掉 `private`，补 `repository` / `homepage` / `bugs` / `publishConfig`

## 公开前还需要

- [x] 改名：package / cordis.patch / 默认 skip / 状态目录 / README / 测试
- [x] `npm test`（27）+ `npm run check` + `npm pack --dry-run`
- [ ] 重命名 GitHub 仓库为 `dsh-quiet-update` 并 push
- [ ] `npm login`（当前 `npm whoami` 失败）+ `npm publish`（`dsh-quiet-update@0.3.0`）
- [ ] GitHub tag + Release `v0.3.0`（资产 = 同一份 npm pack）
- [ ] 旧包 `npm deprecate @xinming-chenniang/dsh-auto-update "renamed to dsh-quiet-update"`（0.3.0 发布后）
- [ ] 仓库创建满 1 天（2026-11-14 18:33Z + 24h = **2026-11-16 02:33 北京**）
- [ ] 市场 PR：只新增 `data/plugins/xinming-chenniang__dsh-quiet-update.yml`

发布结果（0.3.0，待填）：

- npm：https://www.npmjs.com/package/dsh-quiet-update
- GitHub Release：https://github.com/xinming-chenniang/dsh-quiet-update/releases/tag/v0.3.0
- CI：待跑

市场条目草稿：

```yaml
url: https://github.com/xinming-chenniang/dsh-quiet-update
name: xinming-chenniang/dsh-quiet-update
category: market
description:
  en: 'Silently updates installed third-party DSH plugins shortly after startup through the host plugin manager — exact-pinned versions included. Stays completely silent when there is nothing to install; only a short heads-up before installing and a restart reminder afterwards. Skips the market, itself, local link installs and GitHub installs.'
  zh: 'DSH 启动后在后台静默更新已装第三方插件，支持精确锁版的依赖；没有可装更新时完全不出声，只在开始安装前提醒一次、装完提醒重启。走官方插件管理器，跳过市场自身、本地 link 与 GitHub 安装项。'
icon: https://raw.githubusercontent.com/xinming-chenniang/dsh-quiet-update/main/assets/icon-180.png
```

## 仍然是短板的

- **依赖 beta API** `updateBundle`：DSH 升级时要跟着验证。
- **只吃启动那一次**：长期不重启就不更新；这是“做窄”接受的边界，不打算补定时调度。
- 市场已有 6+ 个同类更新器，且多数有面板；我们只靠“静默 + 精确锁版 + 无更新不打扰”差异化，
  评审仍可能以“已被覆盖”为由不收。

## 有意不做（不是短板，是路线）

- 没有设置面板 / 客户端半部 / 逐包勾选界面；
- 没有界面化历史、快照与一键回滚（回滚交给宿主 `updateBundle` 的失败恢复）；
- 不提供启动外的定时/空闲窗口调度。

