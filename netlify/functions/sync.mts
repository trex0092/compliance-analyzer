import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

const STORE_NAME = 'compliance-sync'
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB max per sync payload

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  const url = new URL(req.url)
  const userId = url.searchParams.get('uid')

  if (!userId || userId.length < 8) {
    return Response.json({ error: 'Missing or invalid uid parameter' }, { status: 400 })
  }

  const store = getStore(STORE_NAME)
  const key = `user/${userId}/data`

  // GET — load synced data
  if (req.method === 'GET') {
    try {
      const result = await store.getWithMetadata(key, { type: 'text' })
      if (!result) {
        return Response.json({ found: false, data: null, lastSync: null })
      }
      const parsed = JSON.parse(result.data)
      return Response.json({
        found: true,
        data: parsed,
        lastSync: result.metadata?.lastSync || null,
      })
    } catch (e) {
      return Response.json({ error: 'Failed to load sync data' }, { status: 500 })
    }
  }

  // PUT — save synced data
  if (req.method === 'PUT') {
    try {
      const body = await req.text()
      if (body.length > MAX_SIZE) {
        return Response.json({ error: 'Sync data too large. Maximum 10 MB.' }, { status: 400 })
      }

      // Validate it's valid JSON
      JSON.parse(body)

      const now = new Date().toISOString()
      await store.set(key, body, {
        metadata: {
          lastSync: now,
          size: String(body.length),
        },
      })

      return Response.json({ success: true, lastSync: now, size: body.length })
    } catch (e) {
      return Response.json({ error: 'Failed to save sync data' }, { status: 500 })
    }
  }

  // DELETE — clear synced data
  if (req.method === 'DELETE') {
    try {
      await store.delete(key)
      return Response.json({ success: true, deleted: true })
    } catch (e) {
      return Response.json({ error: 'Failed to delete sync data' }, { status: 500 })
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}

export const config: Config = {
  path: '/api/sync',
  method: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
}
