/**
 * 自动更新流水线：闸门检查 → 恢复上次中断 → 找候选 → 选版本 → updateBundle → 记账。
 *
 * 依赖宿主服务 `pluginManager`（官方插件管理器）：它负责兼容性校验、卸载/安装、
 * 失败回滚，本模块只决定“何时、选哪个、怎么记录”。没有该服务就安静跳过。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chooseVersion, isCandidate, repairDecision } from './pick.js'
import { appendLog, jsonSafe, readState, writeState } from './state.js'
import { loadConfig } from './settings.js'
import { showToast } from './toast.js'

const ACTIVE = Symbol.for('dsh-auto-update.activeRun')
const SCHEMA = 'dsh-auto-update/v1'

/** 这些 application 视为“磁盘上已经换了新版本”。 */
const CHANGED_APPLICATIONS = ['applied', 'restart-required', 'overridden']

/** 取一个宿主服务；软取，缺服务不抛。 */
export function getService(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined) return value
    }
  } catch {
    // inject 之外访问未就绪的服务会抛，这里就是兜底。
  }
  try {
    return ctx?.[name]
  } catch {
    return undefined
  }
}

/** profile 目录：管理器自己的 profile 最准，其次 profileContext，最后按 DSH home 推。 */
export function resolveProfileDir(ctx) {
  const pm = getService(ctx, 'pluginManager')
  try {
    if (typeof pm?.profile?.dir === 'string' && pm.profile.dir !== '') return pm.profile.dir
  } catch {
    // 同上，软取。
  }
  const profileContext = getService(ctx, 'profileContext')
  try {
    if (typeof profileContext?.dir === 'string' && profileContext.dir !== '') return profileContext.dir
  } catch {
    // 同上。
  }
  const homePath = getService(ctx, 'dshHomePath')
  if (typeof homePath === 'function') {
    try {
      const derived = homePath('profiles', 'desktop')
      if (typeof derived === 'string' && derived !== '') return derived
    } catch {
      // 推不出来就不落盘。
    }
  }
  return undefined
}

/** 宿主有没有正在工作的 agent；只有明确的 running 才算。 */
export function runningAgentIds(ctx) {
  const agents = getService(ctx, 'agents')
  let listed
  try {
    listed = agents?.list?.()
  } catch {
    return []
  }
  if (!Array.isArray(listed)) return []
  const ids = []
  for (const agent of listed) {
    if (agent === null || typeof agent !== 'object' || agent.status !== 'running') continue
    const id = typeof agent.id === 'string' && agent.id !== '' ? agent.id : 'agent'
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** profile 的 package.json 是否被一个活着的进程锁着（死 PID 的锁忽略）。 */
function profileLockIsLive(profileDir) {
  const file = join(profileDir, 'package.json.lock')
  if (!existsSync(file)) return false
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8').trim()
  } catch {
    return true
  }
  const pid = Number(raw)
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = 进程存在但属于别人。
    return error?.code === 'EPERM'
  }
}

/** 插件市场是否有未完成的更新（它会在启动后自己修复，别和它抢）。 */
function marketUpdatePending(profileDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(profileDir, '.dsh-market', 'pending-updates.json'), 'utf8'))
    return Array.isArray(parsed?.operations) && parsed.operations.length > 0
  } catch {
    return false
  }
}

/** 把管理器的错误对象压成可 JSON 化的摘要。 */
function errorSummary(error) {
  if (error === undefined || error === null) return null
  if (typeof error === 'string') return error
  const out = {}
  for (const key of ['code', 'diagnostic', 'message', 'name', 'kind']) {
    if (error[key] !== undefined && error[key] !== null) out[key] = String(error[key])
  }
  if (Object.keys(out).length === 0) out.message = String(error)
  return out
}

function nowIso() {
  return new Date().toISOString()
}

/** 当前是否已有一轮在跑。 */
export function isRunning() {
  return globalThis[ACTIVE] !== undefined && globalThis[ACTIVE] !== null
}

/**
 * 启动一轮（自动/手动共用）。已有任务在跑时直接返回同一个 Promise。
 * @param ctx 宿主上下文（需要能软取 pluginManager / agents）
 * @param config 已归一化的配置
 * @param options { trigger?: 'startup'|'tool', dryRun?: boolean, force?: boolean, names?: string[] }
 */
export function startRun(ctx, config, options = {}) {
  if (isRunning()) return globalThis[ACTIVE]
  const task = execute(ctx, config, options).finally(() => {
    if (globalThis[ACTIVE] === task) delete globalThis[ACTIVE]
  })
  globalThis[ACTIVE] = task
  return task
}

async function execute(ctx, config, options) {
  const trigger = options.trigger === 'tool' ? 'tool' : 'startup'
  const force = options.force === true
  const names = Array.isArray(options.names) && options.names.length > 0 ? new Set(options.names) : undefined
  const profileDir = resolveProfileDir(ctx)
  // 用户配置文件覆盖 DSH 传进来的 patch 配置；再决定 dryRun。
  config = profileDir === undefined ? config : loadConfig(profileDir, config)
  const dryRun = options.dryRun === undefined ? config.dryRun === true : options.dryRun === true
  const state = profileDir === undefined
    ? { schema: SCHEMA, lastRun: null, inProgress: [] }
    : readState(profileDir)

  const summary = {
    schema: SCHEMA,
    trigger,
    dryRun,
    startedAt: nowIso(),
    finishedAt: null,
    status: 'ok',
    reason: null,
    checked: 0,
    candidates: 0,
    restartRequired: false,
    results: [],
    repaired: [],
  }

  const log = (level, event, extra = {}) => {
    if (profileDir === undefined) return
    try {
      appendLog(profileDir, { level, event, trigger, ...jsonSafe(extra) })
    } catch {
      // 日志写不进去不影响更新本身。
    }
  }

  const finish = (patch = {}) => {
    Object.assign(summary, patch)
    summary.finishedAt = nowIso()
    if (profileDir !== undefined) {
      try {
        writeState(profileDir, {
          schema: SCHEMA,
          lastRun: jsonSafe(summary),
          inProgress: state.inProgress,
        })
      } catch (error) {
        log('error', 'state-write-failed', { error: errorSummary(error) })
      }
    }
    log(summary.status === 'failed' ? 'error' : 'info', 'run-finished', {
      status: summary.status,
      reason: summary.reason,
      checked: summary.checked,
      candidates: summary.candidates,
      changed: summary.results.filter((item) => CHANGED_APPLICATIONS.includes(item.application)).length,
    })
    maybeToast(profileDir, config, summary, log)
    return summary
  }

  if (config.enabled !== true) return finish({ status: 'skipped', reason: 'disabled' })

  const pm = getService(ctx, 'pluginManager')
  if (
    pm === undefined ||
    typeof pm.listBundles !== 'function' ||
    typeof pm.listVersions !== 'function' ||
    typeof pm.updateBundle !== 'function'
  ) {
    return finish({ status: 'skipped', reason: 'plugin-manager-unavailable' })
  }

  if (profileDir !== undefined) {
    if (profileLockIsLive(profileDir)) return finish({ status: 'skipped', reason: 'profile-locked' })
    if (marketUpdatePending(profileDir)) return finish({ status: 'skipped', reason: 'market-update-pending' })
  }

  const busy = runningAgentIds(ctx)
  if (busy.length > 0 && !force) {
    return finish({ status: 'skipped', reason: 'agents-running', agents: busy })
  }

  let bundles
  try {
    bundles = await pm.listBundles()
  } catch (error) {
    return finish({ status: 'failed', reason: 'list-bundles-failed', error: errorSummary(error) })
  }
  if (!Array.isArray(bundles)) {
    return finish({ status: 'failed', reason: 'list-bundles-failed', error: { message: 'listBundles() did not return an array' } })
  }

  if (!dryRun && state.inProgress.length > 0) {
    await repairInterrupted(pm, profileDir, state, summary, log)
  }

  const candidates = bundles.filter((bundle) => {
    if (!isCandidate(bundle, config)) return false
    if (names !== undefined && !names.has(bundle.name)) return false
    return true
  })

  summary.checked = bundles.length
  summary.candidates = candidates.length

  if (candidates.length === 0) {
    return finish({ reason: 'no-updates' })
  }

  const selected = candidates.slice(0, config.maxPackages)

  // 先查完版本再动手：这样“开始安装”的提醒能列出准确的 name from → to，
  // 也避免装到一半才发现某个候选其实没有兼容版本。
  const planned = []
  for (const bundle of selected) {
    const item = await checkOne(pm, config, summary, bundle, log)
    if (item !== null) planned.push(item)
  }

  if (!dryRun && planned.length > 0) {
    log('info', 'update-started', { count: planned.length, names: planned.map((item) => item.name) })
    notifyStart(profileDir, config, planned, log)
  }

  for (const item of planned) {
    if (dryRun) {
      summary.results.push({ ...item, application: 'would-update', step: 'select', error: null })
      log('info', 'would-update', { name: item.name, from: item.from, to: item.to })
      continue
    }
    await installOne(pm, profileDir, state, summary, item, log)
  }

  const changed = summary.results.some((item) => CHANGED_APPLICATIONS.includes(item.application))
  const failed = summary.results.some((item) => item.application === 'failed')
  summary.restartRequired = summary.results.some((item) => item.application === 'restart-required')

  if (failed && !changed) return finish({ status: 'failed', reason: 'all-candidates-failed' })
  if (failed) return finish({ status: 'partial', reason: 'some-candidates-failed' })
  return finish({ status: dryRun ? 'dry-run' : 'ok', reason: null })
}

/**
 * 查一个候选有没有可装的兼容版本。有则返回 `{ name, from, to }`，
 * 没有就把 skipped / failed 记进结果并返回 null。
 */
async function checkOne(pm, config, summary, bundle, log) {
  const name = bundle.name
  const from = typeof bundle.version === 'string' ? bundle.version : ''
  let listed
  try {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(config.lookupTimeoutMs) : undefined
    listed = await pm.listVersions(name, undefined, signal)
  } catch (error) {
    summary.results.push({ name, from, to: null, application: 'failed', step: 'check', error: errorSummary(error) })
    log('warn', 'version-check-failed', { name, error: errorSummary(error) })
    return null
  }
  if (listed === undefined || listed === null || listed.status !== 'listed') {
    summary.results.push({
      name,
      from,
      to: null,
      application: 'skipped',
      step: 'check',
      error: listed?.reason ?? listed?.problem ?? 'no-version-list',
    })
    return null
  }

  const chosen = chooseVersion(listed.versions, from, config)
  if (chosen === undefined) {
    summary.results.push({ name, from, to: null, application: 'skipped', step: 'select', error: 'no-compatible-update' })
    return null
  }
  return { name, from, to: chosen.version }
}

/** 装一个已经查好的更新，并记账。 */
async function installOne(pm, profileDir, state, summary, item, log) {
  const { name, from, to } = item
  if (profileDir !== undefined) {
    state.inProgress = [
      ...state.inProgress.filter((entry) => entry.name !== name),
      { name, from, to, startedAt: nowIso() },
    ]
    persistProgress(profileDir, state, log)
  }

  const requestId = `auto-update-${Date.now()}-${randomUUID().slice(0, 8)}`
  try {
    const outcome = await pm.updateBundle(name, to, { requestId })
    const application = outcome?.result?.application ?? 'unknown'
    summary.results.push({
      name,
      from,
      to,
      application,
      step: outcome?.step ?? 'install',
      changed: outcome?.result?.changed === true,
      // 管理器只在需要重启时给出原因；留着它，提醒与状态里才能说清“为什么要重启”。
      restartReason: outcome?.result?.restartReason ?? null,
      error: errorSummary(outcome?.result?.error),
      restore: outcome?.restore?.result?.application ?? null,
    })
    log(application === 'failed' ? 'warn' : 'info', 'update-finished', {
      name,
      from,
      to,
      application,
      step: outcome?.step ?? 'install',
    })
  } catch (error) {
    summary.results.push({ name, from, to, application: 'failed', step: 'install', error: errorSummary(error) })
    log('error', 'update-threw', { name, to, error: errorSummary(error) })
  } finally {
    state.inProgress = state.inProgress.filter((entry) => entry.name !== name)
    if (profileDir !== undefined) persistProgress(profileDir, state, log)
  }
}

async function repairInterrupted(pm, profileDir, state, summary, log) {
  let bundles
  try {
    bundles = await pm.listBundles()
  } catch {
    return
  }
  if (!Array.isArray(bundles)) return

  for (const entry of [...state.inProgress]) {
    const found = bundles.find((bundle) => bundle?.name === entry.name)
    const installedVersion = typeof found?.version === 'string' ? found.version : undefined
    const decision = repairDecision(entry, installedVersion, found?.installed === true)
    if (decision === 'clear') {
      state.inProgress = state.inProgress.filter((item) => item !== entry)
      summary.repaired.push({ name: entry.name, action: 'clear', installedVersion: installedVersion ?? null })
      log('info', 'repair-cleared', { name: entry.name, installedVersion: installedVersion ?? null })
      persistProgress(profileDir, state, log)
      continue
    }
    if (decision === 'reinstall-old' && typeof entry.from === 'string' && /^\d+\.\d+\.\d+/.test(entry.from)) {
      try {
        await pm.installBundle(`${entry.name}@${entry.from}`, { requestId: `auto-update-repair-${Date.now()}` })
        state.inProgress = state.inProgress.filter((item) => item !== entry)
        summary.repaired.push({ name: entry.name, action: 'reinstall-old', version: entry.from })
        log('warn', 'repair-reinstalled-old', { name: entry.name, version: entry.from })
      } catch (error) {
        summary.repaired.push({ name: entry.name, action: 'reinstall-failed', error: errorSummary(error) })
        log('error', 'repair-reinstall-failed', { name: entry.name, error: errorSummary(error) })
      }
      persistProgress(profileDir, state, log)
    }
  }
}

function persistProgress(profileDir, state, log) {
  try {
    writeState(profileDir, { schema: SCHEMA, lastRun: state.lastRun, inProgress: state.inProgress })
  } catch (error) {
    log('error', 'state-write-failed', { error: errorSummary(error) })
  }
}

/**
 * 开始安装前的提醒：更新要跑 1–2 分钟，先告诉用户“别在这时候开会话”，
 * 免得用户不知道后台在换插件。纯函数，方便单测。
 */
export function buildStartToast(planned) {
  const items = Array.isArray(planned) ? planned.filter((item) => typeof item?.name === 'string' && item.name !== '') : []
  if (items.length === 0) return null
  const lines = items
    .slice(0, 6)
    .map((item) => `${item.name} ${item.from || '?'} → ${item.to || '?'}`)
  if (items.length > 6) lines.push(`…另有 ${items.length - 6} 个`)
  lines.push('正在后台安装，约 1–2 分钟；这期间先别开新会话，装完会再提醒重启。')
  return {
    title: `DSH 插件自动更新：开始安装 ${items.length} 个`,
    body: lines.join('\n'),
  }
}

function notifyStart(profileDir, config, planned, log) {
  if (profileDir === undefined || config.toast !== true || config.toastOnStart !== true) return
  const note = buildStartToast(planned)
  if (note === null) return
  const shown = showToast(profileDir, note.title, note.body)
  log(shown ? 'info' : 'warn', shown ? 'toast-sent' : 'toast-unavailable', { toast: 'start', count: planned.length })
}

/**
 * 把一轮结果压成一条提醒。纯函数，方便单测。
 *
 * 只要磁盘上换了版本就返回内容：宿主插件的新代码要下一次启动才会加载，
 * 所以必须明确告诉用户“建议/需要重启”，否则用户不知道还要不要动手。
 */
export function buildToast(summary) {
  const results = Array.isArray(summary?.results) ? summary.results : []
  const changed = results.filter((item) => CHANGED_APPLICATIONS.includes(item.application))
  if (changed.length === 0) return null

  const failed = results.filter((item) => item.application === 'failed')
  const lines = changed
    .slice(0, 6)
    .map((item) => `${item.name} ${item.from || '?'} → ${item.to || '?'}`)
  if (changed.length > 6) lines.push(`…另有 ${changed.length - 6} 个`)
  if (summary?.restartRequired === true) {
    lines.push('重启 DeepSeek Harness 后新版本才会生效。')
  } else {
    lines.push('重启 DeepSeek Harness 一次可确保新版本加载；不重启可能仍在跑旧代码。')
  }
  if (failed.length > 0) lines.push(`${failed.length} 个更新失败，详见插件管理日志。`)

  return {
    title: summary?.restartRequired === true
      ? `DSH 插件已更新 ${changed.length} 个，需要重启`
      : `DSH 插件已自动更新 ${changed.length} 个，建议重启`,
    body: lines.join('\n'),
  }
}

function maybeToast(profileDir, config, summary, log) {
  if (profileDir === undefined || config.toast !== true) return
  const note = buildToast(summary)
  // 没有实际更新就完全静默：不发“无更新”提示，也不占用户的注意力。
  if (note === null) return
  const shown = showToast(profileDir, note.title, note.body)
  log(shown ? 'info' : 'warn', shown ? 'toast-sent' : 'toast-unavailable', {
    toast: 'updated',
    changed: summary.results.filter((item) => CHANGED_APPLICATIONS.includes(item.application)).length,
  })
}
