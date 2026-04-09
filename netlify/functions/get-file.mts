import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { authenticate, rateLimit } from './middleware/auth.mts'

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Rate limit and authentication
  const rl = rateLimit(req)
  if (!rl.ok) return rl.response!
  const auth = authenticate(req)
  if (!auth.ok) return auth.response!

  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return Response.json({ error: 'Missing key parameter' }, { status: 400 })
  }

  // Path traversal protection
  if (key.includes('..') || key.startsWith('/') || !/^[a-zA-Z0-9._\-\/]+$/.test(key)) {
    return Response.json({ error: 'Invalid key format' }, { status: 400 })
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

  const contentType = result.metadata?.contentType || 'application/octet-stream'
  const rawName = result.metadata?.originalName || key.split('/').pop() || 'download'

  // Sanitize filename to prevent header injection (strip quotes, CR, LF, and non-ASCII)
  const safeName = rawName.replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7E]/g, '_')

  return new Response(result.data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
    },
  })
}

export const config: Config = {
  path: '/api/file',
  method: ['GET', 'DELETE'],
}
