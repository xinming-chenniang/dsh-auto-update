import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { startRun } from '../lib/run.js'

function makeContext({ busy = false, lock = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-auto-update-run-'))
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

const silent = { ...DEFAULT_CONFIG, skip: [], toast: false, toastOnNoop: false, dryRun: true }

test('run: dry run reports would-update and never installs', async () => {
  const { dir, ctx, calls, cleanup } = makeContext()
  try {
    const result = await startRun(ctx, silent, { trigger: 'tool', dryRun: true })
    assert.equal(result.status, 'dry-run')
    assert.equal(result.checked, 1)
    assert.deepEqual(result.results.map((item) => item.application), ['would-update'])
    assert.equal(calls.updateBundle.length, 0)
    assert.equal(existsSync(join(dir, '.dsh-auto-update', 'state.json')), true)
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
    const state = JSON.parse(readFileSync(join(dir, '.dsh-auto-update', 'state.json'), 'utf8'))
    assert.equal(state.lastRun.results[0].to, '1.1.0')
    assert.deepEqual(state.inProgress, [])
  } finally {
    cleanup()
  }
})

test('run: user config file can turn dryRun off', async () => {
  const { dir, ctx, calls, cleanup } = makeContext()
  try {
    mkdirSync(join(dir, '.dsh-auto-update'), { recursive: true })
    writeFileSync(join(dir, '.dsh-auto-update', 'config.json'), JSON.stringify({ dryRun: false }))
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
