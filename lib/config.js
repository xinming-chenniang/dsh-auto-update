/**
 * dsh-auto-update 的配置归一化。
 *
 * 不引依赖（profile 里解析不到宿主包），非法值一律退回默认值。
 */

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  /** 宿主启动后延迟多久开始检查（毫秒）。 */
  delayMs: 15_000,
  /** 有 agent 在跑时，隔多久重试一次。 */
  busyRetryMs: 60_000,
  /** 最多等多久（从计划开始时刻算）就不再重试，留给下一次启动。
   *  2 分钟：只覆盖“启动瞬间刚好有自动续跑”的情况；再久就可能撞上用户正在用的会话。 */
  busyRetryForMs: 2 * 60_000,
  /** 未选入 bundles 的已装依赖也更新（例如 dsh-archived-chats）。 */
  includeDisabled: true,
  allowPrerelease: false,
  allowDeprecated: false,
  /** 永不自动更新的包名。 */
  skip: Object.freeze(['dshmarket', 'dsh-auto-update']),
  /** 只发现、不安装；出厂 true，验证后改 false。 */
  dryRun: true,
  toast: true,
  toastOnNoop: false,
  /** 单次最多处理多少个候选，防一次启动干太久。 */
  maxPackages: 20,
  /** 单包版本查询的超时。 */
  lookupTimeoutMs: 30_000,
})

function integer(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** 把外部配置归一化成确定值。 */
export function normalizeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, skip: [...DEFAULT_CONFIG.skip] }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return cfg

  cfg.enabled = boolean(raw.enabled, cfg.enabled)
  cfg.includeDisabled = boolean(raw.includeDisabled, cfg.includeDisabled)
  cfg.allowPrerelease = boolean(raw.allowPrerelease, cfg.allowPrerelease)
  cfg.allowDeprecated = boolean(raw.allowDeprecated, cfg.allowDeprecated)
  cfg.dryRun = boolean(raw.dryRun, cfg.dryRun)
  cfg.toast = boolean(raw.toast, cfg.toast)
  cfg.toastOnNoop = boolean(raw.toastOnNoop, cfg.toastOnNoop)

  cfg.delayMs = integer(raw.delayMs, cfg.delayMs, { min: 0, max: 10 * 60_000 })
  cfg.busyRetryMs = integer(raw.busyRetryMs, cfg.busyRetryMs, { min: 1_000, max: 10 * 60_000 })
  cfg.busyRetryForMs = integer(raw.busyRetryForMs, cfg.busyRetryForMs, { min: 0, max: 24 * 60 * 60_000 })
  cfg.maxPackages = integer(raw.maxPackages, cfg.maxPackages, { min: 1, max: 100 })
  cfg.lookupTimeoutMs = integer(raw.lookupTimeoutMs, cfg.lookupTimeoutMs, { min: 1_000, max: 5 * 60_000 })

  if (Array.isArray(raw.skip)) {
    const names = raw.skip
      .filter((item) => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim())
    cfg.skip = [...new Set(names)]
  }

  return cfg
}
