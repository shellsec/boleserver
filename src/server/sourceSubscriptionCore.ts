/** Catalog format and recovery limits shared with the mobile implementation. */
export interface CatalogEntry { id: string, name: string, url: string }

export function parseCatalog(text: string, baseUrl: string): CatalogEntry[] {
    const data = JSON.parse(text.replace(/^\uFEFF/, ''))
    const list = Array.isArray(data) ? data : data?.sources
    if (!Array.isArray(list) || !list.length || list.length > 100) throw new Error('订阅清单必须包含 1 到 100 个音源')
    const ids = new Set<string>()
    return list.map(item => {
        if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim() || typeof item.url !== 'string' || !item.url.trim()) throw new Error('订阅条目需要 id、name、url')
        const id = item.id.trim()
        const url = new URL(item.url.trim(), baseUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || ids.has(id)) throw new Error('订阅中有重复 ID 或无效音源地址')
        ids.add(id)
        return { id, name: item.name.trim(), url: url.href }
    })
}

export function mergeCatalog(previous: any[], remote: any[]): any[] {
    const remaining = new Map(remote.map(item => [item.id, item]))
    const merged = previous.flatMap(item => {
        if (!item.subscription) return [item]
        const next = remaining.get(item.id)
        if (!next) return []
        remaining.delete(item.id)
        return [{ ...next, enabled: item.enabled !== false }]
    })
    return [...merged, ...Array.from(remaining.values(), item => ({ ...item, enabled: true }))]
}

export function createRecovery(now: () => number = Date.now) {
    const attempted = new Set<string>()
    const lastChecks = new Map<string, number>()
    return async function recover<T>(owner: string, url: string, songKey: string, update: () => Promise<boolean>, retry: () => Promise<T>): Promise<T | undefined> {
        if (!url || !songKey) return undefined
        const scope = JSON.stringify([owner, url])
        const key = JSON.stringify([owner, url, songKey])
        if (attempted.has(key) || now() - (lastChecks.get(scope) ?? -Infinity) < 60_000) return undefined
        attempted.add(key)
        lastChecks.set(scope, now())
        if (attempted.size > 1000) attempted.delete(attempted.values().next().value!)
        if (lastChecks.size > 200) lastChecks.delete(lastChecks.keys().next().value!)
        let updated = false
        try { updated = await update() } catch { return undefined }
        return updated ? retry() : undefined
    }
}

export async function withSourceTimeout<T>(operation: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('音源请求超时')), timeoutMs) }),
        ])
    } finally { if (timer) clearTimeout(timer) }
}
