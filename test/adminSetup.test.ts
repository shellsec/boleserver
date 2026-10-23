import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { handleAdminSetup } from '../src/server/adminSetup'

test('first admin setup validates requests, persists once, and survives reload', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bole-setup-'))
  const configPath = path.join(directory, 'config.js')
  const previous = global.lx
  global.lx = { configPath, config: { 'admin.password': '', serverName: 'BoleServer', users: [] } } as any
  const server = http.createServer(async (req, res) => { await handleAdminSetup(req, res, '/api/admin/setup') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as any
  const url = `http://127.0.0.1:${address.port}/api/admin/setup`
  const post = (data: unknown, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) })
  try {
    assert.deepEqual(await (await fetch(url)).json(), { required: true })
    assert.equal((await post({ password: '123456', confirmPassword: '123456' })).status, 400)
    assert.equal((await post({ password: 'correct-password', confirmPassword: 'different' })).status, 400)
    assert.equal((await post({}, { Origin: 'https://other.example' })).status, 403)
    assert.equal((await post({}, { 'Content-Type': 'text/plain' })).status, 403)
    assert.equal((await post({ padding: 'a'.repeat(4200) })).status, 413)
    const responses = await Promise.all(['first-password', 'second-password'].map(password => post({ password, confirmPassword: password })))
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8').replace('module.exports = ', ''))
    assert.equal(stored.serverName, 'BoleServer')
    assert.equal(stored['admin.password'], global.lx.config['admin.password'])
    global.lx.config = stored
    assert.deepEqual(await (await fetch(url)).json(), { required: false })
    assert.equal((await post({ password: 'replacement', confirmPassword: 'replacement' })).status, 409)
    assert.deepEqual(fs.readdirSync(directory), ['config.js'])
    global.lx.config = { 'admin.password': '' } as any
    global.lx.configPath = directory // simulate an unwritable target: rename onto a directory fails
    assert.equal((await post({ password: 'correct-password', confirmPassword: 'correct-password' })).status, 500)
    assert.equal(global.lx.config['admin.password'], '')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    global.lx = previous
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
