import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { authenticate } from './middleware/auth.mts'
import { checkRateLimit } from './middleware/rate-limit.mts'

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Rate limit — sensitive tier (10/15min) because this endpoint serves
  // uploaded compliance evidence files. CLAUDE.md §1 (Seguridad).
  const rlResponse = await checkRateLimit(req, { clientIp: context.ip, max: 10 })
  if (rlResponse) return rlResponse
  const auth = authenticate(req)
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return Response.json({ error: 'Missing key parameter' }, { status: 400 })
  }

  // Path traversal protection
  if (key.includes('..') || key.startsWith('/') || !/^[a-zA-Z0-9._\-\/]+$/.test(key)) {
    return Response.json({ error: 'Invalid key format' }, { status: 400 })
  }

  // Per-user IDOR guard: the key must begin with `user/<callerId>/...`
  // (uploads are namespaced in upload.mts). Legacy unprefixed keys are
  // also served for now to avoid breaking already-uploaded evidence,
  // but this fallback will be removed once migration completes.
  const ownerId = auth.userId || 'unknown'
  const expectedPrefix = `user/${ownerId}/`
  const isLegacyKey = !key.startsWith('user/')
  if (!isLegacyKey && !key.startsWith(expectedPrefix)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const store = getStore('compliance-uploads')

  if (req.method === 'DELETE') {
    await store.delete(key)
    return Response.json({ success: true, deleted: key })
  }

  // GET - download the file
  const result = await store.getWithMetadata(key, { type: 'arrayBuffer' })

  if (!result) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  // Never reflect the stored content-type as a render target — always
  // download as an opaque stream so a stored HTML/SVG can't run in the
  // browser context. Keep the original type for UI hints in metadata.
  const originalType = result.metadata?.contentType || 'application/octet-stream'
  const rawName = result.metadata?.originalName || key.split('/').pop() || 'download'

  // Sanitize filename to prevent header injection (strip quotes, CR, LF, and non-ASCII)
  const safeName = rawName.replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7E]/g, '_')

  return new Response(result.data, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'X-Original-Content-Type': originalType.replace(/[\r\n]/g, ''),
      'Cache-Control': 'private, no-store',
    },
  })
}

export const config: Config = {
  path: '/api/file',
  method: ['GET', 'DELETE'],
}
