import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const needsAdminSetup = () => !global.lx.config['admin.password']
export const validAdminPassword = (password: unknown): password is string =>
  typeof password === 'string' && password.trim().length >= 8 && password.length <= 128

export async function handleAdminSetup(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (pathname !== '/api/admin/setup') return false
  const reply = (status: number, value: object) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  if (req.method === 'GET') {
    reply(200, { required: needsAdminSetup() })
    return true
  }
  if (req.method !== 'POST') { reply(405, { error: 'Method not allowed' }); return true }
  if (!needsAdminSetup()) { reply(409, { error: '管理员密码已设置，请直接登录' }); return true }
  // JSON and same-origin checks prevent a third-party page from claiming a fresh installation.
  const origin = req.headers.origin
  let sameOrigin = !origin
  try { if (origin) sameOrigin = new URL(origin).host === req.headers.host } catch {}
  if (!sameOrigin || req.headers['sec-fetch-site'] === 'cross-site' ||
    !req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    reply(403, { error: '请从本站后台页面设置密码' }); return true
  }
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
      if (Buffer.byteLength(body) > 4096) { reply(413, { error: '请求过大' }); return true }
    }
    const { password, confirmPassword } = JSON.parse(body)
    if (!validAdminPassword(password) || password !== confirmPassword) {
      reply(400, { error: '密码需为 8–128 位，且两次输入一致' }); return true
    }
    // Recheck after reading the body. No async boundary between this check and commit.
    if (!needsAdminSetup()) { reply(409, { error: '管理员密码已设置，请直接登录' }); return true }
    const configPath = global.lx.configPath
    const temporary = configPath + '.' + crypto.randomUUID() + '.tmp'
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(temporary, 'module.exports = ' + JSON.stringify({ ...global.lx.config, 'admin.password': password }, null, 2), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, configPath)
      global.lx.config['admin.password'] = password
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    reply(200, { success: true })
  } catch (error) {
    reply(error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? '请求格式错误' : '保存失败，请检查数据目录写入权限后重试' })
  }
  return true
}
