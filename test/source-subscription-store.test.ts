import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SourceSubscriptionStore } from '../src/server/sourceSubscriptionStore'

function fixture(t: any) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-subscription-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const remote = new Map<string, string>([
        ['https://test/list.json', JSON.stringify([{ id: '../a', name: 'A', url: 'a.js' }, { id: 'b', name: 'B', url: 'b.js' }])],
        ['https://test/a.js', 'script-a'], ['https://test/b.js', 'script-b'],
    ])
    let reloads = 0
    const store = new SourceSubscriptionStore({
        root: () => root,
        download: async url => { const text = remote.get(url); if (!text) throw Error('offline'); return text },
        validate: async script => { if (script === 'bad') throw Error('invalid script'); return { version: '1', supportedSources: ['kw'] } },
        reload: async () => { reloads++ },
    })
    return { root, store, remote, reloads: () => reloads }
}

test('imports all entries, is idempotent, preserves manual sources and disabled state', async t => {
    const { root, store, reloads } = fixture(t)
    const dir = path.join(root, '_open'); fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([{ id: 'manual.js', enabled: false }]))
    assert.equal(await store.update('open', 'https://test/list.json'), true)
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'))
    const sources = read(); assert.equal(sources.length, 3)
    assert.ok(sources[1].id.endsWith('.js')); assert.ok(!sources[1].id.includes('..'))
    sources[1].enabled = false
    fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(sources))
    assert.equal(await store.update('open'), false)
    assert.equal(read()[1].enabled, false); assert.equal(reloads(), 1)
    assert.equal(store.status('open').url, 'https://test/list.json')
})

test('bad script or incomplete download leaves previous script and metadata intact', async t => {
    const { root, store, remote } = fixture(t)
    await store.update('open', 'https://test/list.json')
    const meta = path.join(root, '_open', 'sources.json'); const before = fs.readFileSync(meta, 'utf8')
    remote.set('https://test/a.js', 'new-a'); remote.set('https://test/b.js', 'bad')
    await assert.rejects(store.update('open'), /invalid script/)
    assert.equal(fs.readFileSync(meta, 'utf8'), before)
    const sources = JSON.parse(before)
    assert.equal(fs.readFileSync(path.join(root, '_open', sources[0].id), 'utf8'), 'script-a')
    remote.delete('https://test/b.js')
    await assert.rejects(store.update('open'), /offline/)
    assert.equal(fs.readFileSync(meta, 'utf8'), before)
})

test('refresh reconciles removed members, keeps manual imports and uses separate owner storage', async t => {
    const { root, store, remote } = fixture(t)
    await store.update('alice', 'https://test/list.json')
    assert.equal(store.status('open').url, '')
    remote.set('https://test/list.json', JSON.stringify([{ id: '../a', name: 'A2', url: 'a.js' }]))
    assert.equal(await store.update('alice'), true)
    const sources = JSON.parse(fs.readFileSync(path.join(root, 'alice', 'sources.json'), 'utf8'))
    assert.equal(sources.length, 1); assert.equal(sources[0].name, 'A2')
    store.clear('alice'); assert.equal(store.status('alice').url, '')
    assert.equal(sources.length, 1)
    assert.throws(() => store.status('../alice'), /用户/)
})

test('clear cancels an in-flight update before it can replace files', async t => {
    const { root, store, remote } = fixture(t)
    await store.update('open', 'https://test/list.json')
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    const pendingStore = new SourceSubscriptionStore({ root: () => root,
        download: async url => { await gate; return remote.get(url)! },
        validate: async () => ({ supportedSources: ['kw'] }), reload: async () => {},
    })
    const pending = pendingStore.update('open')
    pendingStore.clear('open'); release()
    await assert.rejects(pending, /已变更/)
    assert.equal(pendingStore.status('open').url, '')
})


test('explicit saves can grant and revoke VM permission; automatic refresh cannot grant new permissions', async t => {
    const { root, store, remote } = fixture(t)
    await store.update('open', 'https://test/list.json', true)
    const meta = path.join(root, '_open', 'sources.json')
    assert.ok(JSON.parse(fs.readFileSync(meta, 'utf8')).every((s: any) => s.allowUnsafeVM))
    assert.equal(await store.update('open', 'https://test/list.json', false), true)
    assert.ok(JSON.parse(fs.readFileSync(meta, 'utf8')).every((s: any) => !s.allowUnsafeVM))
    await store.update('open', 'https://test/list.json', true)
    remote.set('https://test/list.json', JSON.stringify([{ id: 'new', name: 'New', url: 'a.js' }]))
    await store.update('open')
    assert.equal(JSON.parse(fs.readFileSync(meta, 'utf8'))[0].allowUnsafeVM, false)
})

test('manual source name collision never overwrites its script', async t => {
    const { root, store } = fixture(t)
    await store.update('open', 'https://test/list.json')
    const dir = path.join(root, '_open'); const meta = path.join(dir, 'sources.json')
    const previous = JSON.parse(fs.readFileSync(meta, 'utf8'))
    previous[0].subscription = false
    fs.writeFileSync(meta, JSON.stringify(previous))
    fs.writeFileSync(path.join(dir, previous[0].id), 'manual-content')
    await assert.rejects(store.update('open'), /手动/)
    assert.equal(fs.readFileSync(path.join(dir, previous[0].id), 'utf8'), 'manual-content')
})


test('status persistence failure rolls back newly written source files and metadata', async t => {
    const { root, store, remote } = fixture(t)
    await store.update('open', 'https://test/list.json')
    const meta = path.join(root, '_open', 'sources.json'); const before = fs.readFileSync(meta, 'utf8')
    remote.set('https://test/a.js', 'new-a')
    const nativeFs = require('node:fs'); const rename = nativeFs.renameSync
    let injected = false
    nativeFs.renameSync = (source: string, target: string) => {
        if (!injected && target.endsWith('subscription.json')) { injected = true; throw Error('disk failure') }
        return rename(source, target)
    }
    try { await assert.rejects(store.update('open'), /disk failure/) }
    finally { nativeFs.renameSync = rename }
    assert.equal(fs.readFileSync(meta, 'utf8'), before)
    const first = JSON.parse(before)[0]
    assert.equal(fs.readFileSync(path.join(root, '_open', first.id), 'utf8'), 'script-a')
})
