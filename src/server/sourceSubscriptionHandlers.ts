import type { IncomingMessage, ServerResponse } from 'http'
import { sourceSubscriptions } from './sourceSubscriptions'
import { SourceSubscriptionStore, subscriptionOwner } from './sourceSubscriptionStore'

export async function handleSubscriptionRequest(req: IncomingMessage, res: ServerResponse, url: URL,
    authenticatedUsername: string | null, isAdmin: boolean, store: SourceSubscriptionStore = sourceSubscriptions) {
    const send = (code: number, data: any) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(data))
    }
    try {
        let body: any = {}
        if (req.method === 'POST') {
            let size = 0
            const chunks: Buffer[] = []
            for await (const chunk of req) {
                size += Buffer.byteLength(chunk)
                if (size > 65536) { send(413, { success: false, error: '请求过大' }); return }
                chunks.push(Buffer.from(chunk))
            }
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }
        const owner = subscriptionOwner(req.method === 'GET' ? url.searchParams.get('username') || undefined : body.username)
        if (owner !== 'open' && !isAdmin && authenticatedUsername !== owner) {
            send(403, { success: false, error: '只能管理当前登录用户的订阅' }); return
        }
        if (req.method === 'POST' && owner === 'open' && !isAdmin) {
            send(403, { success: false, error: '公共音源订阅需要管理员身份' }); return
        }
        if (body.allowUnsafeVM && !isAdmin) {
            send(403, { success: false, error: 'VM 模式需要管理员身份' }); return
        }
        if (req.method === 'GET') { send(200, { success: true, ...store.status(owner) }); return }
        if (body.action === 'clear') {
            store.clear(owner)
            send(200, { success: true, updated: false, ...store.status(owner) }); return
        }
        if (body.action !== 'save' && body.action !== 'refresh') throw new Error('无效订阅操作')
        if (body.action === 'save' && (typeof body.url !== 'string' || !body.url.trim())) throw new Error('请输入订阅清单地址')
        const updated = await store.update(owner, body.action === 'save' ? body.url : undefined,
            body.action === 'save' ? !!body.allowUnsafeVM : undefined)
        send(200, { success: true, updated, ...store.status(owner) })
    } catch (error: any) { send(400, { success: false, error: error.message }) }
}
