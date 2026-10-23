import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleSubscriptionRequest } from '../src/server/sourceSubscriptionHandlers'
import { SourceSubscriptionStore } from '../src/server/sourceSubscriptionStore'
import { sourceSubscriptions, downloadSubscriptionText } from '../src/server/sourceSubscriptions'
import { callUserApiGetMusicUrl, getLoadedApisCount, inspectSubscriptionScript, initUserApis, disposeUserApis } from '../src/server/userApi'

const script = (works: boolean, name = 'Fixture') => `/**
 * @name ${name}
 * @version ${works ? '2' : '1'}
 */
lx.on('request', () => ${works ? "Promise.resolve('https://audio.test/song.mp3')" : "Promise.reject(new Error('source offline'))"});
lx.send('inited', { sources: { kw: { name: 'KW', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });`

test('subscription HTTP permissions, local download, and complete failed-source recovery', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-http-subscription-'))
    const oldDataPath = process.env.DATA_PATH
    process.env.DATA_PATH = root
    ;(global as any).lx = { config: { 'system.allowUnsafeVM': false } }
    const remote = new Map<string, string>([['/catalog.json', JSON.stringify([{ id: 'a', name: 'Fixture', url: './a.js' }])], ['/a.js', script(false)]])
    let catalogChecks = 0
    const isolatedStore = new SourceSubscriptionStore({ root: () => path.join(root, 'isolated'),
        download: async () => JSON.stringify([{ id: 'a', name: 'A', url: 'https://test/a.js' }]),
        validate: async () => ({ supportedSources: ['kw'] }), reload: async () => {} })
    const server = http.createServer((req, res) => {
        const url = new URL(req.url!, 'http://localhost')
        if (url.pathname === '/api/subscription') {
            void handleSubscriptionRequest(req, res, url, req.headers['x-test-user'] as string || null,
                req.headers['x-test-admin'] === 'yes', isolatedStore)
            return
        }
        if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/catalog.json' }); res.end(); return }
        if (url.pathname === '/oversize') { res.end('x'.repeat(2 * 1024 * 1024 + 1)); return }
        if (url.pathname === '/catalog.json') catalogChecks++
        const text = remote.get(url.pathname)
        res.writeHead(text ? 200 : 404, { 'Content-Type': 'text/plain' }); res.end(text || 'missing')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => {
        disposeUserApis()
        await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
        if (oldDataPath === undefined) delete process.env.DATA_PATH; else process.env.DATA_PATH = oldDataPath
        fs.rmSync(root, { recursive: true, force: true })

    })
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    const api = async (body: any, user?: string, admin = false) => fetch(base + '/api/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}), ...(admin ? { 'x-test-admin': 'yes' } : {}) }, body: JSON.stringify(body) })
    assert.equal((await api({ username: 'default', action: 'clear' })).status, 403)
    assert.equal((await api({ username: 'bob', action: 'clear' }, 'alice')).status, 403)
    assert.equal((await fetch(base + '/api/subscription?username=bob', { headers: { 'x-test-user': 'alice' } })).status, 403)
    assert.equal((await api({ username: 'alice', action: 'save', url: base + '/catalog.json', allowUnsafeVM: true }, 'alice')).status, 403)
    assert.equal((await api({ username: 'alice', action: 'clear' }, 'alice')).status, 200)
    assert.equal((await api({ username: 'default', action: 'clear' }, undefined, true)).status, 200)
    assert.equal((await api({ username: '../bob', action: 'clear' }, undefined, true)).status, 400)

    assert.match(await downloadSubscriptionText(base + '/redirect'), /Fixture/)
    await assert.rejects(downloadSubscriptionText(base + '/missing'), /404/)
    await assert.rejects(downloadSubscriptionText(base + '/oversize'), /2 MiB/)
    const beforeValidation = getLoadedApisCount()
    const timersBefore = process.getActiveResourcesInfo().filter(x => x === 'Timeout').length
    await inspectSubscriptionScript('setInterval(() => {}, 60000);' + script(true), false)
    assert.equal(process.getActiveResourcesInfo().filter(x => x === 'Timeout').length, timersBefore, 'validation must clear timers')
    assert.equal(getLoadedApisCount(), beforeValidation, 'validation must not add a live source')
    await assert.rejects(inspectSubscriptionScript(script(true), true), /禁用/)

    await sourceSubscriptions.update('open', base + '/catalog.json')
    assert.equal(getLoadedApisCount(), 1)
    remote.set('/a.js', script(true))
    const checksBefore = catalogChecks
    const result = await callUserApiGetMusicUrl('kw', { source: 'kw', name: 'Song', songmid: 'song-recover' }, '128k', 'open')
    assert.equal(result.url, 'https://audio.test/song.mp3')
    assert.ok(result.attempts!.some(attempt => attempt.status === 'fail'))
    assert.equal(catalogChecks, checksBefore + 1, 'all failures should cause one subscription check')

    // A newly added platform is discovered even when no currently loaded source supports it.
    remote.set('/a.js', script(true).replace('sources: { kw:', 'sources: { tx:'))
    await sourceSubscriptions.update('open')
    const txResult = await callUserApiGetMusicUrl('tx', { source: 'tx', songmid: 'tx-song' }, '128k', 'open')
    assert.equal(txResult.url, 'https://audio.test/song.mp3')
    sourceSubscriptions.clear('open')
    await initUserApis('open')
    assert.equal(getLoadedApisCount(), 1, 'clearing subscription keeps downloaded sources')
})
