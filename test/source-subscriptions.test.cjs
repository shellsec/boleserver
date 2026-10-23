const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseCatalog, mergeCatalog, createRecovery, withSourceTimeout } = require('../src/server/sourceSubscriptionCore.ts')

test('mobile catalogs support BOM, wrapper and relative script URLs', () => {
  assert.deepEqual(parseCatalog('\uFEFF' + JSON.stringify({ sources: [{ id: 'a', name: 'A', url: './a.js' }] }), 'https://example.test/list/sources.json'), [{ id: 'a', name: 'A', url: 'https://example.test/list/a.js' }])
})
test('reject empty, malformed, duplicate and non-HTTP catalogs', () => {
  for (const text of ['', '[]', '{}', 'bad', '[{"id":"a","name":"A","url":"file:///a"}]', '[{"id":"a","name":"A","url":"/a"},{"id":"a","name":"B","url":"/b"}]']) assert.throws(() => parseCatalog(text, 'https://example.test/list.json'))
})
test('merge preserves manual sources, order and disabled states and removes dropped subscription members', () => {
  const previous = [{ id: 'manual.js', enabled: false }, { id: 'sub-b.js', subscription: true, enabled: false }, { id: 'sub-old.js', subscription: true, enabled: true }]
  const next = mergeCatalog(previous, [{ id: 'sub-a.js', subscription: true, name: 'A' }, { id: 'sub-b.js', subscription: true, name: 'B' }])
  assert.deepEqual(next.map(x => x.id), ['manual.js', 'sub-b.js', 'sub-a.js'])
  assert.equal(next[1].enabled, false)
  assert.equal(next[2].enabled, true)
})
test('recovery checks once per song and once per owner/URL per minute and retries only after changes', async () => {
  let now = 100000; const recover = createRecovery(() => now); let checks = 0; let retries = 0
  const update = async () => { checks++; return true }; const retry = async () => { retries++; return 'ok' }
  assert.equal(await recover('u', 'https://x/list', 'song1', update, retry), 'ok')
  now += 61000
  assert.equal(await recover('u', 'https://x/list', 'song1', update, retry), undefined)
  assert.equal(await recover('u', 'https://x/list', 'song2', update, retry), 'ok')
  assert.equal(await recover('u', 'https://x/list', 'song3', update, retry), undefined)
  assert.equal(await recover('other', 'https://x/list', 'song3', async () => false, retry), undefined)
  assert.equal(checks, 2); assert.equal(retries, 2)
})
test('failed subscription check is nonfatal and does not retry', async () => {
  const recover = createRecovery(); let retries = 0
  assert.equal(await recover('u', 'https://x', 'song', async () => { throw Error('offline') }, async () => { retries++ }), undefined)
  assert.equal(retries, 0)
})
test('hung source times out so the next source can be attempted', async () => {
  await assert.rejects(withSourceTimeout(() => new Promise(() => {}), 15), /超时/)
  assert.equal(await withSourceTimeout(async () => 'next', 15), 'next')
})
