import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { mergeCatalog, parseCatalog } from './sourceSubscriptionCore'

interface SubscriptionStatus {
    url: string
    lastChecked?: string
    lastUpdated?: string
    error?: string
    allowUnsafeVM?: boolean
}
interface StoreOptions {
    root: () => string
    download: (url: string) => Promise<string>
    validate: (script: string, allowUnsafeVM: boolean) => Promise<Record<string, any>>
    reload: (owner: string) => Promise<void>
}

export function subscriptionOwner(raw?: string): string {
    if (!raw || ['default', 'open', '_open'].includes(raw)) return 'open'
    if (raw === '.' || raw === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(raw) || raw.endsWith('.') || raw.endsWith(' ')) throw new Error('无效的用户名')
    return raw
}

/** One saved catalog per owner. Download/validate first, then commit synchronously. */
export class SourceSubscriptionStore {
    private pending = new Map<string, Promise<boolean>>()
    private revisions = new Map<string, number>()
    constructor(private options: StoreOptions) {}

    private dir(owner: string) { return path.join(this.options.root(), subscriptionOwner(owner) === 'open' ? '_open' : owner) }
    status(owner: string): SubscriptionStatus {
        const filename = path.join(this.dir(owner), 'subscription.json')
        if (!fs.existsSync(filename)) return { url: '' }
        return JSON.parse(fs.readFileSync(filename, 'utf8'))
    }
    private writeStatus(owner: string, status: SubscriptionStatus) {
        const dir = this.dir(owner)
        fs.mkdirSync(dir, { recursive: true })
        const temp = path.join(dir, `subscription-${randomUUID()}.tmp`)
        try {
            fs.writeFileSync(temp, JSON.stringify(status, null, 2))
            fs.renameSync(temp, path.join(dir, 'subscription.json'))
        } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
    }
    clear(rawOwner: string) {
        const owner = subscriptionOwner(rawOwner)
        this.revisions.set(owner, (this.revisions.get(owner) || 0) + 1)
        this.writeStatus(owner, { url: '' })
    }
    update(rawOwner: string, url?: string, allowUnsafeVM?: boolean): Promise<boolean> {
        const owner = subscriptionOwner(rawOwner)
        if (this.pending.has(owner)) {
            if (url !== undefined) return Promise.reject(new Error('订阅正在更新，请稍后再试'))
            return this.pending.get(owner)!
        }
        const promise = this.performUpdate(owner, url, allowUnsafeVM).finally(() => this.pending.delete(owner))
        this.pending.set(owner, promise)
        return promise
    }
    private async performUpdate(owner: string, newUrl?: string, allowUnsafeVM?: boolean): Promise<boolean> {
        const before = this.status(owner)
        const revision = this.revisions.get(owner) || 0
        const url = (newUrl ?? before.url).trim()
        if (!url) throw new Error('未设置订阅地址')
        const parsedUrl = new URL(url)
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error('请输入 HTTP(S) 订阅地址')
        const checked = new Date().toISOString()
        const dir = this.dir(owner)
        const metaPath = path.join(dir, 'sources.json')
        const readSources = (): any[] => fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : []
        const unsafeAllowed = allowUnsafeVM ?? (newUrl === undefined || url === before.url ? !!before.allowUnsafeVM : false)
        const stillCurrent = () => {
            if ((this.revisions.get(owner) || 0) !== revision || this.status(owner).url !== before.url) throw new Error('订阅已变更，已取消本次更新')
        }
        try {
            const entries = parseCatalog(await this.options.download(url), url)
            const initial = readSources()
            const scripts = new Map<string, string>()
            const remote: any[] = []
            for (const entry of entries) {
                stillCurrent()
                const id = `subscription_${createHash('sha256').update(entry.id).digest('hex')}.js`
                const script = await this.options.download(entry.url)
                if (!script.trim()) throw new Error(`音源 ${entry.name} 为空`)
                const old = initial.find(item => item.id === id && item.subscription)
                const oldPath = path.join(dir, id)
                const same = old && fs.existsSync(oldPath) && fs.readFileSync(oldPath, 'utf8') === script
                // An automatic update never grants VM permission to a new or previously safe script.
                const allowUnsafe = newUrl !== undefined ? unsafeAllowed : !!old?.allowUnsafeVM
                const info = same && !!old.allowUnsafeVM === allowUnsafe ? old : await this.options.validate(script, allowUnsafe)
                scripts.set(id, script)
                remote.push({ ...info, id, name: entry.name, sourceUrl: entry.url, subscription: true,
                    subscriptionId: entry.id, allowUnsafeVM: allowUnsafe, size: Buffer.byteLength(script), uploadTime: old?.uploadTime || checked })
            }
            stillCurrent()
            // Re-read after awaits to retain concurrent enable/disable and manual import changes.
            const previous = readSources()
            if (previous.some(item => !item.subscription && scripts.has(item.id))) throw new Error('订阅音源与手动音源文件名冲突')
            const next = mergeCatalog(previous, remote)
            const oldSubscriptions = previous.filter(item => item.subscription)
            const changed = oldSubscriptions.length !== remote.length || remote.some(item => {
                const old = oldSubscriptions.find(source => source.id === item.id)
                const scriptPath = path.join(dir, item.id)
                return !old || old.name !== item.name || !!old.allowUnsafeVM !== !!item.allowUnsafeVM || !fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf8') !== scripts.get(item.id)
            })
            let rollback: (() => void) | undefined
            if (changed) {
                fs.mkdirSync(dir, { recursive: true })
                const backups = new Map<string, Buffer | null>()
                const write = (filename: string, content: string) => {
                    backups.set(filename, fs.existsSync(filename) ? fs.readFileSync(filename) : null)
                    const temp = `${filename}.${randomUUID()}.tmp`
                    try { fs.writeFileSync(temp, content); fs.renameSync(temp, filename) }
                    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
                }
                rollback = () => {
                    for (const [filename, content] of backups) {
                        if (content === null) { if (fs.existsSync(filename)) fs.unlinkSync(filename) }
                        else fs.writeFileSync(filename, content)
                    }
                }
                try {
                    for (const [id, script] of scripts) write(path.join(dir, id), script)
                    write(metaPath, JSON.stringify(next, null, 2))
                } catch (error) {
                    rollback()
                    throw error
                }
                // Metadata is authoritative. Removed members' files may be retained for rollback;
                // they are no longer loaded because they are absent from sources.json.
            }
            try {
                this.writeStatus(owner, { url, allowUnsafeVM: unsafeAllowed, lastChecked: checked,
                    lastUpdated: changed ? checked : before.lastUpdated })
            } catch (error) { rollback?.(); throw error }
            if (changed) await this.options.reload(owner)
            return changed
        } catch (error: any) {
            if (this.status(owner).url === before.url && (this.revisions.get(owner) || 0) === revision) {
                this.writeStatus(owner, { ...before, lastChecked: checked, error: error.message })
            }
            throw error
        }
    }
}
