import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, normalizeConfig } from '../lib/config.js'
import { chooseVersion, isCandidate, isPrereleaseVersion, repairDecision } from '../lib/pick.js'
import { jsonSafe, readState, STATE_SCHEMA, statePaths } from '../lib/state.js'

const config = (patch = {}) => ({ ...DEFAULT_CONFIG, skip: [...DEFAULT_CONFIG.skip], ...patch })

test('normalizeConfig: defaults and invalid values', () => {
  const base = normalizeConfig(undefined)
  assert.equal(base.enabled, true)
  assert.equal(base.delayMs, 15000)
  assert.equal(base.dryRun, true)
  assert.deepEqual(base.skip, ['dshmarket', 'dsh-auto-update'])

  const odd = normalizeConfig({ delayMs: -1, busyRetryMs: 1, maxPackages: 0, lookupTimeoutMs: 'x', enabled: 'yes', skip: ['a', 'a', '', 7] })
  assert.equal(odd.delayMs, 15000)
  assert.equal(odd.busyRetryMs, 60000)
  assert.equal(odd.maxPackages, 20)
  assert.equal(odd.lookupTimeoutMs, 30000)
  assert.equal(odd.enabled, true)
  assert.deepEqual(odd.skip, ['a'])
})

test('normalizeConfig: valid overrides survive', () => {
  const cfg = normalizeConfig({ enabled: false, delayMs: 1000, dryRun: false, allowPrerelease: true, skip: ['x'], maxPackages: 3 })
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.delayMs, 1000)
  assert.equal(cfg.dryRun, false)
  assert.equal(cfg.allowPrerelease, true)
  assert.deepEqual(cfg.skip, ['x'])
  assert.equal(cfg.maxPackages, 3)
})

test('isCandidate: only third-party registry bundles', () => {
  const base = { name: 'dsh-context', update: 'registry', installed: true, enabled: true }
  assert.equal(isCandidate(base, config()), true)
  assert.equal(isCandidate({ ...base, official: true }, config()), false)
  assert.equal(isCandidate({ ...base, update: 'git' }, config()), false)
  assert.equal(isCandidate({ ...base, installed: false }, config()), false)
  assert.equal(isCandidate({ ...base, error: { code: 'not-bundle' } }, config()), false)
  assert.equal(isCandidate({ ...base, enabled: false }, config({ includeDisabled: false })), false)
  assert.equal(isCandidate({ ...base, name: 'dshmarket' }, config()), false)
  assert.equal(isCandidate({ ...base, name: 'dsh-auto-update' }, config()), false)
  assert.equal(isCandidate(null, config()), false)
})

test('chooseVersion: newest compatible stable', () => {
  const versions = [
    { version: '0.84.1', incompatible: { name: 'x' } },
    { version: '0.84.0', prerelease: false },
    { version: '0.83.0', prerelease: false },
  ]
  assert.equal(chooseVersion(versions, '0.73.3', config()).version, '0.84.0')
  assert.equal(chooseVersion([{ version: '2.0.0', prerelease: true }], '1.0.0', config()), undefined)
  assert.equal(chooseVersion([{ version: '2.0.0', prerelease: true }], '1.0.0', config({ allowPrerelease: true })).version, '2.0.0')
  assert.equal(chooseVersion([{ version: '2.0.0', deprecated: 'broken' }], '1.0.0', config()), undefined)
  assert.equal(chooseVersion([{ version: '2.0.0', deprecated: 'broken' }], '1.0.0', config({ allowDeprecated: true })).version, '2.0.0')
  assert.equal(chooseVersion([{ version: '1.5.0-beta.1' }], '1.0.0-beta.0', config()).version, '1.5.0-beta.1')
  assert.equal(chooseVersion(undefined, '1.0.0', config()), undefined)
})

test('isPrereleaseVersion', () => {
  assert.equal(isPrereleaseVersion('1.2.3'), false)
  assert.equal(isPrereleaseVersion('1.2.3-rc.1'), true)
  assert.equal(isPrereleaseVersion(null), false)
})

test('repairDecision: settle by what is on disk', () => {
  const entry = { name: 'p', from: '1.0.0', to: '1.1.0' }
  assert.equal(repairDecision(entry, '1.1.0', true), 'clear')
  assert.equal(repairDecision(entry, undefined, false), 'reinstall-old')
  assert.equal(repairDecision(entry, '1.0.0', true), 'clear')
  assert.equal(repairDecision(entry, '1.0.0', false), 'keep')
  assert.equal(repairDecision(entry, '1.0.5', true), 'keep')
})

test('state: empty on missing or corrupt profile', () => {
  assert.equal(readState(undefined).schema, STATE_SCHEMA)
  assert.deepEqual(readState('Z:\\no-such-profile').inProgress, [])
  const paths = statePaths('C:\\profile')
  assert.match(paths.dir, /\.dsh-auto-update$/)
  assert.match(paths.state, /state\.json$/)
  assert.match(paths.log, /log\.ndjson$/)
})

test('jsonSafe: lossless JSON for tool output', () => {
  assert.deepEqual(jsonSafe({ a: undefined, b: Number.NaN, c: [Infinity, 1] }), { a: null, b: null, c: [null, 1] })
})
