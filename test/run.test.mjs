import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { buildStartToast, buildToast, startRun } from '../lib/run.js'

function makeContext({ busy = false, lock = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-quiet-update-run-'))
  const calls = { updateBundle: [], installBundle: [] }
  if (lock) writeFileSync(join(dir, 'package.json.lock'), String(process.pid))
  const pm = {
    profile: { dir },
    async listBundles() {
      return [{ name: 'demo-plugin', update: 'registry', installed: true, enabled: true, version: '1.0.0' }]
    },
    async listVersions() {
      return { status: 'listed', versions: [{ version: '1.1.0', prerelease: false }] }
    },
    async updateBundle(name, version) {
      calls.updateBundle.push({ name, version })
      return { from: '1.0.0', to: version, step: 'install', result: { changed: true, application: 'applied' } }
    },
    async installBundle(spec) {
      calls.installBundle.push(spec)
      return { application: 'applied' }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'pluginManager') return pm
      if (name === 'agents') return { list: () => (busy ? [{ id: 'a1', status: 'running' }] : []) }
      if (name === 'profileContext') return { dir }
      return undefined
    },
  }
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  return { dir, ctx, calls, cleanup }
}

const silent = { ...DEFAULT_CONFIG, skip: [], toast: false, dryRun: true }

test('run: dry run reports would-update and never installs', async () => {
  const { dir, ctx, calls, cleanup } = makeContext()
  try {
    const result = await startRun(ctx, silent, { trigger: 'tool', dryRun: true })
    assert.equal(result.status, 'dry-run')
    assert.equal(result.checked, 1)
    assert.deepEqual(result.results.map((item) => item.application), ['would-update'])
    assert.equal(calls.updateBundle.length, 0)
    assert.equal(existsSync(join(dir, '.dsh-quiet-update', 'state.json')), true)
  } finally {
    cleanup()
  }
})

test('run: real run updates through the manager and records it', async () => {
  const { dir, ctx, calls, cleanup } = makeContext()
  try {
    const result = await startRun(ctx, { ...silent, dryRun: false }, { trigger: 'tool', dryRun: false })
    assert.equal(result.status, 'ok')
    assert.deepEqual(calls.updateBundle, [{ name: 'demo-plugin', version: '1.1.0' }])
    assert.equal(result.results[0].application, 'applied')
    const state = JSON.parse(readFileSync(join(dir, '.dsh-quiet-update', 'state.json'), 'utf8'))
    assert.equal(state.lastRun.results[0].to, '1.1.0')
    assert.deepEqual(state.inProgress, [])
  } finally {
    cleanup()
  }
})

test('run: user config file can turn dryRun off', async () => {
  const { dir, ctx, calls, cleanup } = makeContext()
  try {
    mkdirSync(join(dir, '.dsh-quiet-update'), { recursive: true })
    writeFileSync(join(dir, '.dsh-quiet-update', 'config.json'), JSON.stringify({ dryRun: false }))
    const result = await startRun(ctx, silent, { trigger: 'tool' })
    assert.equal(result.dryRun, false)
    assert.equal(calls.updateBundle.length, 1)
  } finally {
    cleanup()
  }
})

test('run: a running agent skips the run', async () => {
  const { ctx, calls, cleanup } = makeContext({ busy: true })
  try {
    const result = await startRun(ctx, { ...silent, dryRun: false }, { trigger: 'tool' })
    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'agents-running')
    assert.equal(calls.updateBundle.length, 0)
  } finally {
    cleanup()
  }
})

test('run: a live profile lock skips the run', async () => {
  const { ctx, calls, cleanup } = makeContext({ lock: true })
  try {
    const result = await startRun(ctx, { ...silent, dryRun: false }, { trigger: 'tool' })
    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'profile-locked')
    assert.equal(calls.updateBundle.length, 0)
  } finally {
    cleanup()
  }
})

test('toast: a real update reminds the user to restart', () => {
  const note = buildToast({
    results: [
      { name: 'demo-plugin', from: '1.0.0', to: '1.1.0', application: 'applied' },
      { name: 'other-plugin', from: '2.0.0', to: '2.1.0', application: 'restart-required' },
      { name: 'up-to-date', from: '3.0.0', to: null, application: 'skipped' },
    ],
    restartRequired: false,
  })
  assert.match(note.title, /已自动更新 2 个/)
  assert.match(note.title, /建议重启/)
  assert.match(note.body, /demo-plugin 1\.0\.0 → 1\.1\.0/)
  assert.match(note.body, /不重启可能仍在跑旧代码/)
})

test('toast: an explicit restart-required run says so plainly', () => {
  const note = buildToast({
    results: [{ name: 'a', from: '1.0.0', to: '1.1.0', application: 'restart-required' }],
    restartRequired: true,
  })
  assert.match(note.title, /需要重启/)
  assert.match(note.body, /重启 DeepSeek Harness 后新版本才会生效/)
})

test('toast: failures are reported alongside the updates', () => {
  const note = buildToast({
    results: [
      { name: 'a', from: '1.0.0', to: '1.1.0', application: 'applied' },
      { name: 'b', from: '2.0.0', to: '2.1.0', application: 'failed' },
    ],
  })
  assert.match(note.body, /1 个更新失败/)
})

test('toast: nothing changed means no reminder', () => {
  assert.equal(buildToast({ results: [] }), null)
  assert.equal(buildToast({ results: [{ name: 'a', application: 'would-update' }] }), null)
  assert.equal(buildToast({ results: [{ name: 'a', application: 'skipped' }], candidates: 3 }), null)
  assert.equal(buildToast({ results: [{ name: 'a', application: 'failed' }] }), null)
})

test('run: nothing to install stays completely silent', async () => {
  const { dir, ctx, cleanup } = makeContext()
  try {
    // 候选存在、但没有兼容版本 → 不该发任何提醒，连日志里都不该有 toast 事件。
    ctx.get = (name) => {
      if (name === 'pluginManager') {
        return {
          profile: { dir },
          async listBundles() {
            return [{ name: 'demo-plugin', update: 'registry', installed: true, enabled: true, version: '1.0.0' }]
          },
          async listVersions() {
            return { status: 'listed', versions: [] }
          },
          async updateBundle() {
            throw new Error('must not install when no version is available')
          },
        }
      }
      if (name === 'agents') return { list: () => [] }
      if (name === 'profileContext') return { dir }
      return undefined
    }
    const result = await startRun(ctx, { ...silent, toast: true, dryRun: false }, { trigger: 'tool', dryRun: false })
    assert.equal(result.status, 'ok')
    assert.equal(result.results[0].application, 'skipped')
    const log = readFileSync(join(dir, '.dsh-quiet-update', 'log.ndjson'), 'utf8')
    assert.doesNotMatch(log, /"event":"toast-/)
    assert.doesNotMatch(log, /"event":"update-started"/)
  } finally {
    cleanup()
  }
})

test('toast: the start reminder tells the user not to open a session', () => {
  const note = buildStartToast([
    { name: 'ds-harness-remote', from: '0.6.4', to: '0.6.5' },
    { name: 'dsh-context', from: '0.73.3', to: '0.84.1' },
  ])
  assert.match(note.title, /开始安装 2 个/)
  assert.match(note.body, /ds-harness-remote 0\.6\.4 → 0\.6\.5/)
  assert.match(note.body, /先别开新会话/)
  assert.match(note.body, /1–2 分钟/)
})

test('toast: the start reminder folds long lists', () => {
  const planned = Array.from({ length: 8 }, (_, index) => ({ name: `p${index}`, from: '1.0.0', to: '1.1.0' }))
  const note = buildStartToast(planned)
  assert.match(note.body, /…另有 2 个/)
})

test('toast: no planned update means no start reminder', () => {
  assert.equal(buildStartToast([]), null)
  assert.equal(buildStartToast(undefined), null)
})

test('run: a real run logs update-started before installing', async () => {
  const { dir, ctx, cleanup } = makeContext()
  try {
    await startRun(ctx, { ...silent, dryRun: false }, { trigger: 'tool', dryRun: false })
    const log = readFileSync(join(dir, '.dsh-quiet-update', 'log.ndjson'), 'utf8')
    assert.match(log, /"event":"update-started"/)
    assert.match(log, /"count":1/)
  } finally {
    cleanup()
  }
})

test('run: keeps the manager restart reason for the reminder and state', async () => {
  const { dir, ctx, cleanup } = makeContext()
  try {
    ctx.get = (name) => {
      if (name === 'pluginManager') {
        return {
          profile: { dir },
          async listBundles() {
            return [{ name: 'demo-plugin', update: 'registry', installed: true, enabled: true, version: '1.0.0' }]
          },
          async listVersions() {
            return { status: 'listed', versions: [{ version: '1.1.0' }] }
          },
          async updateBundle() {
            return {
              from: '1.0.0',
              to: '1.1.0',
              step: 'install',
              result: { changed: true, application: 'restart-required', restartReason: 'module-comparison' },
            }
          },
        }
      }
      if (name === 'agents') return { list: () => [] }
      if (name === 'profileContext') return { dir }
      return undefined
    }
    const result = await startRun(ctx, { ...silent, dryRun: false }, { trigger: 'tool', dryRun: false })
    assert.equal(result.restartRequired, true)
    assert.equal(result.results[0].restartReason, 'module-comparison')
    const state = JSON.parse(readFileSync(join(dir, '.dsh-quiet-update', 'state.json'), 'utf8'))
    assert.equal(state.lastRun.results[0].restartReason, 'module-comparison')
  } finally {
    cleanup()
  }
})
