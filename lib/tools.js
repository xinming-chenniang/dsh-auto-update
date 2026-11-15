/**
 * dsh-auto-update 工具半部：查询最近一轮自动更新的结果、手动触发一轮、或写配置。
 *
 * 独立 entry 的原因与其他本地插件一致：cordis 的 `inject` 是必需服务，
 * 和启动半部绑在一起会让任一服务缺失时整包不可用。
 */
import { normalizeConfig } from './config.js'
import { isRunning, resolveProfileDir, startRun } from './run.js'
import { loadConfig, userConfigPath, writeUserConfig } from './settings.js'
import { jsonSafe, readState } from './state.js'

/** 工具 entry 的名字（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'dsh-auto-update-tools'
/** 只要工具服务；没有它这半确实没活干。 */
export const inject = ['tools']

function renderText(text) {
  return [{ type: 'text', text }]
}

function describeResult(item) {
  const head = `${item.name} ${item.from || '?'} → ${item.to || '?'}`
  const tail = item.application === 'would-update' ? 'would update (dry run)' : item.application
  const step = item.step ? ` [${item.step}]` : ''
  const error = item.error ? ` — ${typeof item.error === 'string' ? item.error : item.error.message ?? JSON.stringify(item.error)}` : ''
  return `${head}${step}: ${tail}${error}`
}

function describeConfig(config) {
  const skip = Array.isArray(config.skip) && config.skip.length > 0 ? config.skip.join(', ') : '(none)'
  return `config: enabled=${config.enabled}, dryRun=${config.dryRun}, skip=[${skip}], delayMs=${config.delayMs}, toast=${config.toast}, toastOnStart=${config.toastOnStart}`
}

function summarize(state, config) {
  const lines = [describeConfig(config)]
  if (state === null || typeof state !== 'object' || state.lastRun === null) {
    lines.push('No automatic update has run in this profile yet. It runs about 15 seconds after each DSH Host start; `auto_update_run` triggers one now.')
    return lines.join('\n')
  }
  const last = state.lastRun
  lines.push(
    `last run: ${last.status ?? '?'}${last.reason ? ` (${last.reason})` : ''} — ${last.finishedAt ?? '?'}`,
    `trigger: ${last.trigger ?? '?'}, dryRun: ${last.dryRun === true}, checked: ${last.checked ?? 0}, candidates: ${last.candidates ?? 0}${last.restartRequired ? ', restart required' : ''}`,
  )
  if (Array.isArray(last.repaired) && last.repaired.length > 0) {
    lines.push(`repaired: ${last.repaired.map((item) => `${item.name}(${item.action})`).join(', ')}`)
  }
  const results = Array.isArray(last.results) ? last.results : []
  if (results.length === 0) lines.push('(no per-package result)')
  else lines.push(...results.map(describeResult))
  if (Array.isArray(state.inProgress) && state.inProgress.length > 0) {
    lines.push(`in progress from an interrupted run: ${state.inProgress.map((item) => item.name).join(', ')}`)
  }
  return lines.join('\n')
}

/** 工具能写的配置键（与 settings.js 的白名单保持同义）。 */
const CONFIG_KEYS = [
  'enabled',
  'dryRun',
  'skip',
  'includeDisabled',
  'allowPrerelease',
  'allowDeprecated',
  'toast',
  'toastOnStart',
  'delayMs',
  'busyRetryMs',
  'busyRetryForMs',
  'maxPackages',
  'lookupTimeoutMs',
]

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const tools = typeof ctx?.get === 'function' ? ctx.get('tools') : ctx?.tools
  if (tools === null || typeof tools?.register !== 'function' || typeof ctx?.effect !== 'function') return

  const effectiveConfig = () => {
    const profileDir = resolveProfileDir(ctx)
    return { profileDir, config: profileDir === undefined ? config : loadConfig(profileDir, config) }
  }

  ctx.effect(
    () => tools.register({
      name: 'auto_update_status',
      description: 'Show what dsh-auto-update did on this profile: effective settings, last run status, per-package from→to results, whether a restart is needed, and any update interrupted mid-flight. Read-only; the update itself runs automatically about 15 seconds after each DSH Host start.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => renderText(summarize(value?.state, value?.config)),
      },
      async execute() {
        const { profileDir, config: effective } = effectiveConfig()
        const state = profileDir === undefined ? null : readState(profileDir)
        return jsonSafe({ running: isRunning(), profileDir: profileDir ?? null, config: effective, state })
      },
      presentCall() {
        return { card: 'generic', title: 'Auto-update status', kind: 'read' }
      },
    }),
    'dsh-auto-update: tool auto_update_status',
  )

  ctx.effect(
    () => tools.register({
      name: 'auto_update_run',
      description: 'Run the plugin auto-update pipeline now instead of waiting for the next Host start. By default it respects the effective configuration (including the dryRun setting); pass dryRun:false to actually install updates, or dryRun:true to only list what would change. names limits the run to exact package names. Refuses while an Agent is running or another run is in flight. Results are also written to <profile>/.dsh-auto-update/state.json.',
      parameters: {
        type: 'object',
        properties: {
          dryRun: {
            type: 'boolean',
            description: 'true = only discover and list candidates; false = install updates. Omit to use the configured default.',
          },
          force: {
            type: 'boolean',
            description: 'Bypass the running-Agent gate. Only safe for packages that are not loaded in the current composition; replacing a plugin a live Agent is using can break that turn.',
          },
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only consider these exact package names (e.g. ["dsh-archived-chats"]).',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => {
          if (value?.status === 'skipped' && value.reason === 'busy') return renderText('Another auto-update run is already in flight.')
          return renderText(summarize({ lastRun: value, inProgress: [] }, value?.config ?? config))
        },
      },
      async execute(args) {
        const options = { trigger: 'tool' }
        if (args !== null && typeof args === 'object' && Object.hasOwn(args, 'dryRun')) options.dryRun = args.dryRun === true
        if (args !== null && typeof args === 'object' && args.force === true) options.force = true
        if (Array.isArray(args?.names)) options.names = args.names.filter((item) => typeof item === 'string' && item !== '')
        if (isRunning()) return jsonSafe({ status: 'skipped', reason: 'busy' })
        const result = await startRun(ctx, config, options)
        return jsonSafe({ ...result, config: effectiveConfig().config })
      },
      presentCall(args) {
        return { card: 'generic', title: 'Run plugin auto-update', kind: 'edit', rawInput: Array.isArray(args?.names) ? args.names.join(', ') : undefined }
      },
    }),
    'dsh-auto-update: tool auto_update_run',
  )

  ctx.effect(
    () => tools.register({
      name: 'auto_update_configure',
      description: 'Change dsh-auto-update settings in this profile by writing <profile>/.dsh-auto-update/config.json. This is the non-UI configuration path for installs that have no settings panel. Changes apply to the next run; delayMs takes effect on the next Host start. Pass only the fields to change; `skip` replaces the whole list.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Turn the startup auto-update on or off.' },
          dryRun: { type: 'boolean', description: 'true = discover only; false = actually install updates.' },
          skip: { type: 'array', items: { type: 'string' }, description: 'Exact package names that are never auto-updated.' },
          includeDisabled: { type: 'boolean', description: 'Also update installed dependencies that are not selected in dsh.profile.bundles.' },
          allowPrerelease: { type: 'boolean', description: 'Allow prerelease versions.' },
          allowDeprecated: { type: 'boolean', description: 'Allow registry-deprecated versions.' },
          toast: { type: 'boolean', description: 'Show a Windows toast after a successful update. A run that finds nothing to install stays completely silent.' },
          toastOnStart: { type: 'boolean', description: 'Show a toast when installation starts, so the user knows not to start a session during the 1–2 minutes it takes.' },
          delayMs: { type: 'number', description: 'Startup delay in milliseconds (takes effect next Host start).' },
          busyRetryMs: { type: 'number', description: 'Retry interval while an Agent is running.' },
          busyRetryForMs: { type: 'number', description: 'How long to keep retrying while an Agent is running.' },
          maxPackages: { type: 'number', description: 'Maximum candidates per run.' },
          lookupTimeoutMs: { type: 'number', description: 'Per-package version lookup timeout.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => {
          if (value?.ok === false) return renderText(`auto_update_configure failed: ${value.error}`)
          return renderText([`Wrote ${value.path}`, describeConfig(value.config), 'Changes apply to the next run; delayMs takes effect on the next Host start.'].join('\n'))
        },
      },
      async execute(args) {
        const { profileDir } = effectiveConfig()
        if (profileDir === undefined) return jsonSafe({ ok: false, error: 'profile-directory-unavailable' })
        const patch = {}
        if (args !== null && typeof args === 'object') {
          for (const key of CONFIG_KEYS) {
            if (Object.hasOwn(args, key)) patch[key] = args[key]
          }
        }
        writeUserConfig(profileDir, patch)
        return jsonSafe({ ok: true, path: userConfigPath(profileDir), config: loadConfig(profileDir, config) })
      },
      presentCall() {
        return { card: 'generic', title: 'Configure plugin auto-update', kind: 'edit' }
      },
    }),
    'dsh-auto-update: tool auto_update_configure',
  )
}

export default { name, inject, apply }
