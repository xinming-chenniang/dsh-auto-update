/**
 * dsh-auto-update —— 宿主启动后延迟一次，检查并安装已装插件的可更新版本。
 *
 * 依赖宿主服务 `pluginManager`，通过 `ctx.inject` 等它就绪；服务永远不来时
 * 本 entry 保持 pending，不会报错。所有结果写 `<profile>/.dsh-auto-update/`。
 */
import { normalizeConfig } from './config.js'
import { startRun } from './run.js'

/** 稳定插件名（必须与 cordis.patch.yml 的 insert id、包名一致）。 */
export const name = 'dsh-auto-update'

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  if (config.enabled !== true) return
  if (typeof ctx?.inject !== 'function') return

  ctx.inject(['pluginManager'], (scope) => {
    // 从“计划开始”算起的等待预算：agent 一直忙就放弃本轮，下次启动再来。
    const deadline = Date.now() + config.delayMs + config.busyRetryForMs
    let timer

    const schedule = (delayMs) => {
      timer = setTimeout(tick, delayMs)
      if (typeof timer?.unref === 'function') timer.unref()
    }

    const tick = () => {
      startRun(scope, config, { trigger: 'startup' })
        .then((result) => {
          if (result?.status === 'skipped' && result.reason === 'agents-running' && Date.now() < deadline) {
            schedule(config.busyRetryMs)
          }
        })
        .catch((error) => {
          try {
            scope.logger?.warn?.(`[dsh-auto-update] ${String(error?.message ?? error)}`)
          } catch {
            // logger 不可用就算了。
          }
        })
    }

    schedule(config.delayMs)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => clearTimeout(timer), 'dsh-auto-update: startup timer')
    }
  })
}

export default { name, apply }
