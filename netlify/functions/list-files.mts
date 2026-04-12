import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { authenticate } from './middleware/auth.mts'
import { checkRateLimit } from './middleware/rate-limit.mts'

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Rate limit — sensitive tier (10/15min) because this endpoint enumerates
  // uploaded compliance evidence and must not be scraped. CLAUDE.md §1.
  const rlResponse = await checkRateLimit(req, { clientIp: context.ip, max: 10 })
  if (rlResponse) return rlResponse
  const auth = authenticate(req)
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const category = url.searchParams.get('category') || ''

  const store = getStore('compliance-uploads')
  const prefix = category ? `${category}/` : undefined
  const { blobs } = await store.list({ prefix })

  const files = await Promise.all(
    blobs.map(async (blob) => {
      const meta = await store.getMetadata(blob.key)
      return {
        key: blob.key,
        name: meta?.metadata?.originalName || blob.key.split('/').pop(),
        size: meta?.metadata?.size ? Number(meta.metadata.size) : 0,
        contentType: meta?.metadata?.contentType || 'application/octet-stream',
        category: meta?.metadata?.category || 'general',
        uploadedAt: meta?.metadata?.uploadedAt || '',
      }
    })
  )

  files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))

  return Response.json({ files })
}

export const config: Config = {
  path: '/api/files',
  method: 'GET',
}
