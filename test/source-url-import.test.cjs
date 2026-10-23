const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

test('URL import keeps filename when retrying with explicit unsafe VM consent', async () => {
    const text = fs.readFileSync(path.join(__dirname, '../public/music/app.js'), 'utf8')
    const start = text.indexOf('async function handleUrlImport()')
    const end = text.indexOf('// 上传自定义源到服务器', start)
    const requests = []; const errors = []
    const context = {
        showInput: async () => 'https://example.test/audio.js?v=1', showInfo() {},
        showSelect: async () => true, showSuccess() {}, showError: message => errors.push(message),
        console: { error() {} }, currentListData: { username: 'alice' },
        getUserAuthHeaders: () => ({}), localStorage: { getItem: () => 'admin' },
        loadCustomSources() {},
        fetch: async (_url, init) => {
            requests.push(JSON.parse(init.body))
            return { ok: true, status: 200, json: async () => requests.length === 1 ? { requireUnsafe: true } : { success: true, filename: 'audio.js' } }
        },
    }
    vm.createContext(context)
    vm.runInContext(text.slice(start, end), context)
    await context.handleUrlImport()
    assert.deepEqual(errors, [])
    assert.equal(requests.length, 2)
    assert.equal(requests[1].filename, 'audio.js')
    assert.equal(requests[1].allowUnsafeVM, true)
})
