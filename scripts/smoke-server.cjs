// Run after npm run build. Uses temporary data, generated credentials and loopback only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')

async function main() {
  const root = path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boleserver-smoke-'))
  const password = randomUUID()
  const config = { ...require(path.join(root, 'config.js')), users: [], port: 0,
    disableTelemetry: true, 'admin.password': password, 'player.enableAuth': false,
    'player.path': '/', 'admin.path': '/admin', 'user.enablePublicRestriction': false,
    'subsonic.enable': false, 'webdav.enable': false, 'configBackup.enable': false }
  const configPath = path.join(temp, 'config.js')
  fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify(config))
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  // The upstream entry point currently hardcodes 0.0.0.0. Limit the test harness to loopback.
  const preload = `const http = require('node:http'); const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) { if (typeof args[0] === 'number') args[1] = '127.0.0.1'; return listen.apply(this, args) };
    require('./index.js')`
  const child = spawn(process.execPath, ['-e', preload], { cwd: root, windowsHide: true,
    env: { ...process.env, CONFIG_PATH: configPath, DATA_PATH: temp, LOG_PATH: path.join(temp, 'logs'),
      PORT: String(port), DISABLE_TELEMETRY: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output = (output + data).slice(-12000) })
  child.stderr.on('data', data => { output = (output + data).slice(-12000) })
  const base = `http://127.0.0.1:${port}`
  const request = (route, init = {}) => fetch(base + route, { ...init, signal: AbortSignal.timeout(8000) })
  try {
    let ready = false
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) break
      try { if ((await request('/js/config.js')).ok) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(ready, 'server failed to start: ' + output)
    const page = await request('/'); assert.equal(page.status, 200); assert.match(await page.text(), /BoleServer/)
    const admin = await request('/admin/'); assert.equal(admin.status, 200); assert.match(await admin.text(), /BoleServer/)
    for (const route of ['/music/app.js', '/music/js/quality.js', '/music/manifest.json']) {
      assert.equal((await request(route)).status, 200, route)
    }
    const runtime = await (await request('/js/config.js')).text()
    assert.match(runtime, /BoleServer/)
    const list = await request('/api/custom-source/list?username=default'); assert.equal(list.status, 200)
    assert.ok(Array.isArray(await list.json()))
    const subscription = await request('/api/custom-source/subscription?username=default')
    assert.equal(subscription.status, 200); assert.equal((await subscription.json()).url, '')
    const denied = await request('/api/custom-source/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear' }) })
    assert.equal(denied.status, 403)
    const cleared = await request('/api/custom-source/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-frontend-auth': password }, body: JSON.stringify({ action: 'clear' }) })
    assert.equal(cleared.status, 200)
    // SDK-provided board definitions are local, so this check requires no platform credentials.
    const boards = await request('/api/music/leaderboard/boards?source=kw')
    assert.equal(boards.status, 200); assert.ok((await boards.text()).length > 2)
    console.log('PASS: full server startup, player/admin pages, static assets, runtime branding, LX source list, subscription permissions, leaderboard definitions')
  } finally {
    child.kill()
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve))
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
