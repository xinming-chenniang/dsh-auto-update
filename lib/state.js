/**
 * 状态与日志落盘：`<profile>/.dsh-quiet-update/`。
 *
 * - `state.json`：最近一次运行摘要 + 未完成的更新记录；写用临时文件 + rename。
 * - `log.ndjson`：逐事件 JSON 行；超过 512KB 轮转成 `log.ndjson.1`。
 *
 * 读失败（文件缺失/半截/损坏）一律当作“没有状态”，绝不让插件因状态文件挂掉。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STATE_DIR_NAME = '.dsh-quiet-update'
export const STATE_SCHEMA = 'dsh-quiet-update/v1'
const LOG_MAX_BYTES = 512 * 1024

/** 这个 profile 下的状态/日志路径。 */
export function statePaths(profileDir) {
  const dir = join(profileDir, STATE_DIR_NAME)
  return {
    dir,
    state: join(dir, 'state.json'),
    log: join(dir, 'log.ndjson'),
    logOld: join(dir, 'log.ndjson.1'),
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEntry(value) {
  return isObject(value) && typeof value.name === 'string' && value.name !== ''
}

/** 读状态；缺失/损坏时返回空状态。 */
export function readState(profileDir) {
  if (typeof profileDir !== 'string' || profileDir === '') {
    return { schema: STATE_SCHEMA, lastRun: null, inProgress: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(statePaths(profileDir).state, 'utf8'))
    if (isObject(parsed) && parsed.schema === STATE_SCHEMA) {
      return {
        schema: STATE_SCHEMA,
        lastRun: isObject(parsed.lastRun) ? parsed.lastRun : null,
        inProgress: Array.isArray(parsed.inProgress) ? parsed.inProgress.filter(isEntry) : [],
      }
    }
  } catch {
    // 缺失、不可读或 JSON 损坏：没有可恢复的信息。
  }
  return { schema: STATE_SCHEMA, lastRun: null, inProgress: [] }
}

/** 原子写状态（同目录临时文件 + rename）。 */
export function writeState(profileDir, state) {
  const paths = statePaths(profileDir)
  mkdirSync(paths.dir, { recursive: true })
  const temp = `${paths.state}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(temp, paths.state)
}

/** 追加一行事件日志，必要时先轮转。 */
export function appendLog(profileDir, event) {
  const paths = statePaths(profileDir)
  mkdirSync(paths.dir, { recursive: true })
  try {
    if (existsSync(paths.log) && statSync(paths.log).size > LOG_MAX_BYTES) {
      renameSync(paths.log, paths.logOld)
    }
  } catch {
    // 轮转失败就继续追加；日志不是关键路径。
  }
  const record = { at: new Date().toISOString(), ...event }
  appendFileSync(paths.log, `${JSON.stringify(record)}\n`)
}

/**
 * 把任意值变成无损 JSON（宿主对工具返回值有这条硬要求）：
 * undefined → null，非有限数 → null，对象/数组递归。
 */
export function jsonSafe(value) {
  if (value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafe(item)
    return out
  }
  return value
}
