/**
 * 纯选择逻辑：哪些 bundle 可更新、选哪个版本、上次中断的更新怎么收尾。
 * 不碰 fs / 网络 / cordis，方便单测。
 */

const PRERELEASE = /-/

/** 这个包名是否在保护名单里。 */
export function isProtectedName(name, config) {
  return config.skip.includes(name)
}

/** 这个 bundle 是否值得尝试自动更新。 */
export function isCandidate(bundle, config) {
  if (bundle === null || typeof bundle !== 'object') return false
  if (typeof bundle.name !== 'string' || bundle.name === '') return false
  // 只有按注册表 spec 保存、且由 profile 自己安装的第三方包才能被 updateBundle 更新。
  if (bundle.update !== 'registry') return false
  if (bundle.installed !== true) return false
  if (bundle.official === true) return false
  // 没声明 dsh.bundle 的普通依赖，updateBundle 只会在检查阶段拒绝。
  if (bundle.error?.code === 'not-bundle') return false
  if (config.includeDisabled !== true && bundle.enabled !== true) return false
  return !isProtectedName(bundle.name, config)
}

/** `1.2.3-beta.1` 这类预发布版本。 */
export function isPrereleaseVersion(version) {
  return typeof version === 'string' && PRERELEASE.test(version)
}

/**
 * 从 `listVersions` 返回的更新到新清单里选一个目标版本。
 *
 * `versions` 由管理器按新到旧排序；跳过 incompatible / prerelease / deprecated，
 * 返回第一个可接受的条目，没有则 undefined。
 */
export function chooseVersion(versions, installed, config) {
  if (!Array.isArray(versions)) return undefined
  for (const entry of versions) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.version !== 'string' || entry.version === '') continue
    if (entry.incompatible !== undefined) continue
    if (entry.deprecated !== undefined && config.allowDeprecated !== true) continue
    if (entry.prerelease === true && config.allowPrerelease !== true && !isPrereleaseVersion(installed)) continue
    return entry
  }
  return undefined
}

/**
 * 上次启动留下的 inProgress 记录该怎么收尾。
 *
 * - 磁盘上已经是目标版本 → 更新其实完成了，清记录；
 * - 磁盘上没有任何版本 → 可能在“卸载后、安装前”被中断，装回旧版；
 * - 磁盘上仍是旧版且依赖还在清单里 → 更新失败/被回滚，清记录；
 * - 其他情况 → 保留记录，交给人或市场处理。
 */
export function repairDecision(entry, installedVersion, stillDeclared) {
  if (entry === null || typeof entry !== 'object') return 'keep'
  const to = typeof entry.to === 'string' ? entry.to : ''
  const from = typeof entry.from === 'string' ? entry.from : ''
  if (to !== '' && installedVersion === to) return 'clear'
  if (installedVersion === undefined || installedVersion === null || installedVersion === '') return 'reinstall-old'
  if (stillDeclared === true && from !== '' && installedVersion === from) return 'clear'
  return 'keep'
}
