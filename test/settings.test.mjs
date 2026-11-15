import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { loadConfig, readUserConfig, userConfigPath, writeUserConfig } from '../lib/settings.js'

const profile = () => mkdtempSync(join(tmpdir(), 'dsh-auto-update-settings-'))

test('settings: missing file means empty user config', () => {
  const dir = profile()
  try {
    assert.deepEqual(readUserConfig(dir), {})
    const effective = loadConfig(dir, DEFAULT_CONFIG)
    assert.equal(effective.dryRun, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('settings: user file overrides base config', () => {
  const dir = profile()
  try {
    mkdirSync(join(dir, '.dsh-auto-update'), { recursive: true })
    writeFileSync(userConfigPath(dir), JSON.stringify({ dryRun: false, skip: ['x'], delayMs: 1000 }))
    const effective = loadConfig(dir, { ...DEFAULT_CONFIG, skip: ['dshmarket'] })
    assert.equal(effective.dryRun, false)
    assert.deepEqual(effective.skip, ['x'])
    assert.equal(effective.delayMs, 1000)
    // Unknown keys are dropped on read.
    writeFileSync(userConfigPath(dir), JSON.stringify({ dryRun: false, evil: 'x' }))
    assert.deepEqual(readUserConfig(dir), { dryRun: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('settings: write merges and ignores unknown keys', () => {
  const dir = profile()
  try {
    writeUserConfig(dir, { dryRun: false, skip: ['a'] })
    writeUserConfig(dir, { skip: ['b'], evil: 'x' })
    assert.deepEqual(JSON.parse(String(readFileSync(userConfigPath(dir)))), { dryRun: false, skip: ['b'] })
    assert.equal(loadConfig(dir, DEFAULT_CONFIG).dryRun, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('settings: toast switches round-trip and retired keys are ignored', () => {
  const dir = profile()
  try {
    writeUserConfig(dir, { toastOnStart: false })
    assert.deepEqual(readUserConfig(dir), { toastOnStart: false })
    assert.equal(loadConfig(dir, DEFAULT_CONFIG).toastOnStart, false)
    // toastOnNoop 已退役：旧配置文件里还写着也不会生效、不会被写回。
    writeUserConfig(dir, { toastOnNoop: true })
    assert.deepEqual(readUserConfig(dir), { toastOnStart: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
