/**
 * 用户配置：`<profile>/.dsh-auto-update/config.json`。
 *
 * 目的：市场安装时包内默认 `dryRun: true`（安全默认），用户不必手改
 * profile 的 `cordis.patch.yml`，改这个 JSON 就能开启真更新。宿主每次运行前读它，
 * 覆盖 DSH 传进来的 patch 配置（不覆盖代码里的 DEFAULT_CONFIG 兜底）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeConfig } from './config.js'

export const USER_CONFIG_NAME = 'config.json'

const WRITABLE_KEYS = new Set([
  'enabled',
  'delayMs',
  'busyRetryMs',
  'busyRetryForMs',
  'includeDisabled',
  'allowPrerelease',
  'allowDeprecated',
  'skip',
  'dryRun',
  'toast',
  'toastOnNoop',
  'maxPackages',
  'lookupTimeoutMs',
])

/** 这个 profile 的用户配置文件路径。 */
export function userConfigPath(profileDir) {
  return join(profileDir, '.dsh-auto-update', USER_CONFIG_NAME)
}

/** 读原始用户配置（不做归一化）；缺失/损坏返回空对象。 */
export function readUserConfig(profileDir) {
  if (typeof profileDir !== 'string' || profileDir === '') return {}
  try {
    const parsed = JSON.parse(readFileSync(userConfigPath(profileDir), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (WRITABLE_KEYS.has(key)) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** 把用户配置叠在 DSH patch 配置上，再归一化。 */
export function loadConfig(profileDir, baseConfig) {
  return normalizeConfig({ ...baseConfig, ...readUserConfig(profileDir) })
}

/**
 * 写用户配置：只接受已知键，合并进现有文件；原子替换。
 * @returns 归一化后的有效配置
 */
export function writeUserConfig(profileDir, patch) {
  const merged = { ...readUserConfig(profileDir) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!WRITABLE_KEYS.has(key)) continue
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  const dir = join(profileDir, '.dsh-auto-update')
  mkdirSync(dir, { recursive: true })
  const file = userConfigPath(profileDir)
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`)
  renameSync(temp, file)
  return loadConfig(profileDir, {})
}

/** 这个 profile 是否已有用户配置文件。 */
export function hasUserConfig(profileDir) {
  return typeof profileDir === 'string' && profileDir !== '' && existsSync(userConfigPath(profileDir))
}
