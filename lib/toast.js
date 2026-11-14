/**
 * 更新结果提示：优先复用已装的 `dsh-notification` 的 `toast.ps1`（Windows toast，
 * 身份取自 DSH 自己的快捷方式）；找不到该插件就只写日志，不报错。
 *
 * 不自己实现 WinRT toast：AppUserModelId / 祖先进程识别那些坑已经有实测过的实现，
 * 复制一份只会多一份维护面。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const POWERSHELL = process.env.SystemRoot
  ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe'

/** 解析 profile 里 dsh-notification 的 toast.ps1；没有就返回 undefined。 */
export function resolveToastScript(profileDir) {
  if (typeof profileDir !== 'string' || profileDir === '') return undefined
  try {
    const require = createRequire(join(profileDir, 'package.json'))
    const manifest = require.resolve('dsh-notification/package.json')
    const script = join(dirname(manifest), 'toast.ps1')
    return existsSync(script) ? script : undefined
  } catch {
    return undefined
  }
}

/**
 * 发一条 Windows toast。返回是否成功拉起进程；真正的投递由 toast.ps1 负责，
 * 失败只会在 `%TEMP%\dsh-notification\notify.log` 留痕。
 */
export function showToast(profileDir, title, body, options = {}) {
  if (options.enabled === false) return false
  if (process.platform !== 'win32') return false
  const script = resolveToastScript(profileDir)
  if (script === undefined) return false
  try {
    const child = spawn(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-File',
        script,
        '-Title',
        title,
        '-Body',
        body,
        '-HostExe',
        process.execPath,
      ],
      { stdio: 'ignore', windowsHide: true, detached: true },
    )
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
