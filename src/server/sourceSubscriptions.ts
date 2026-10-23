import * as path from 'path'
import needle from 'needle'
import { getProxyAgent } from '../modules/utils/proxy.js'
import { inspectSubscriptionScript, initUserApis } from './userApi'
import { SourceSubscriptionStore, subscriptionOwner } from './sourceSubscriptionStore'
import { createRecovery } from './sourceSubscriptionCore'

/** Download through the existing app proxy, with a total deadline and bounded body. */
export async function downloadSubscriptionText(url: string): Promise<string> {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('无效订阅地址')
    const agent = await getProxyAgent(url, 'app')
    return new Promise((resolve, reject) => {
        let size = 0
        const request = needle.get(url, { agent, follow_max: 5, open_timeout: 15000,
            response_timeout: 15000, read_timeout: 15000, parse_response: false, decode_response: false,
        }, (error: any, response: any, body: any) => {
            clearTimeout(timer)
            if (error) return reject(error)
            if (response.statusCode !== 200) return reject(new Error(`订阅下载失败: HTTP ${response.statusCode}`))
            resolve(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''))
        })
        const abort = (message: string) => {
            clearTimeout(timer)
            reject(new Error(message))
            const underlying = (request as any).request
            if (underlying) underlying.destroy()
            request.emit('error', new Error(message))
        }
        const timer = setTimeout(() => abort('订阅下载超时'), 15000)
        request.on('data', (chunk: any) => {
            size += Buffer.byteLength(chunk)
            if (size > 2 * 1024 * 1024) abort('订阅或脚本超过 2 MiB')
        })
        request.on('error', (error: Error) => { clearTimeout(timer); reject(error) })
    })
}

export const sourceSubscriptions = new SourceSubscriptionStore({
    root: () => path.join(process.env.DATA_PATH || path.join(process.cwd(), 'data'), 'users', 'source'),
    download: downloadSubscriptionText,
    validate: inspectSubscriptionScript,
    reload: initUserApis,
})
const recover = createRecovery()

export function hasSourceSubscription(username?: string): boolean {
    const owner = subscriptionOwner(username)
    try { return !!sourceSubscriptions.status(owner).url || (owner !== 'open' && !!sourceSubscriptions.status('open').url) }
    catch { return false }
}

/** All failed sources -> one catalog check per song/minute -> at most one fresh attempt. */
export async function recoverSubscribedSources<T>(username: string | undefined, songKey: string, retry: () => Promise<T>): Promise<T | undefined> {
    const owner = subscriptionOwner(username)
    let updated = false
    for (const scope of owner === 'open' ? ['open'] : ['open', owner]) {
        try {
            const url = sourceSubscriptions.status(scope).url
            const changed = await recover(scope, url, songKey,
                () => sourceSubscriptions.update(scope), async () => true)
            if (changed) updated = true
        } catch { /* Keep old scripts and continue checking the caller's other scope. */ }
    }
    return updated ? retry() : undefined
}
