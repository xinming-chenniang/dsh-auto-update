/**
 * dsh-auto-update 工具半部：查询最近一轮自动更新的结果，或手动触发一轮。
 *
 * 独立 entry 的原因与其他本地插件一致：cordis 的 `inject` 是必需服务，
 * 和启动半部绑在一起会让任一服务缺失时整包不可用。
 */
import { normalizeConfig } from './config.js'
import { isRunning, resolveProfileDir, startRun } from './run.js'
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

function summarize(state) {
  if (state === null || typeof state !== 'object' || state.lastRun === null) {
    return 'No automatic update has run in this profile yet. It runs about 15 seconds after each DSH Host start; `auto_update_run` triggers one now.'
  }
  const last = state.lastRun
  const lines = [
    `last run: ${last.status ?? '?'}${last.reason ? ` (${last.reason})` : ''} — ${last.finishedAt ?? '?'}`,
    `trigger: ${last.trigger ?? '?'}, dryRun: ${last.dryRun === true}, checked: ${last.checked ?? 0}, candidates: ${last.candidates ?? 0}${last.restartRequired ? ', restart required' : ''}`,
  ]
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

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const tools = typeof ctx?.get === 'function' ? ctx.get('tools') : ctx?.tools
  if (tools === null || typeof tools?.register !== 'function' || typeof ctx?.effect !== 'function') return

  ctx.effect(
    () => tools.register({
      name: 'auto_update_status',
      description: 'Show what dsh-auto-update did on this profile: last run status, per-package from→to results, whether a restart is needed, and any update interrupted mid-flight. Read-only; the update itself runs automatically about 15 seconds after each DSH Host start.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => renderText(summarize(value?.state)),
      },
      async execute() {
        const profileDir = resolveProfileDir(ctx)
        const state = profileDir === undefined ? null : readState(profileDir)
        return jsonSafe({ running: isRunning(), profileDir: profileDir ?? null, state })
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
      description: 'Run the plugin auto-update pipeline now instead of waiting for the next Host start. By default it respects the configured dryRun flag; pass dryRun:false to actually install updates, or dryRun:true to only list what would change. names limits the run to exact package names. Refuses while an Agent is running or another run is in flight. Results are also written to <profile>/.dsh-auto-update/state.json.',
      parameters: {
        type: 'object',
        properties: {
          dryRun: {
            type: 'boolean',
            description: 'true = only discover and list candidates; false = install updates. Omit to use the configured default.',
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
          return renderText(summarize({ lastRun: value, inProgress: [] }))
        },
      },
      async execute(args) {
        const options = { trigger: 'tool' }
        if (args !== null && typeof args === 'object' && Object.hasOwn(args, 'dryRun')) options.dryRun = args.dryRun === true
        if (Array.isArray(args?.names)) options.names = args.names.filter((item) => typeof item === 'string' && item !== '')
        if (isRunning()) return jsonSafe({ status: 'skipped', reason: 'busy' })
        const result = await startRun(ctx, config, options)
        return jsonSafe(result)
      },
      presentCall(args) {
        return { card: 'generic', title: 'Run plugin auto-update', kind: 'edit', rawInput: Array.isArray(args?.names) ? args.names.join(', ') : undefined }
      },
    }),
    'dsh-auto-update: tool auto_update_run',
  )
}

export default { name, inject, apply }
