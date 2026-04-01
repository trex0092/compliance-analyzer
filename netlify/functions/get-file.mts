import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return Response.json({ error: 'Missing key parameter' }, { status: 400 })
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
  const originalName = result.metadata?.originalName || key.split('/').pop()

  return new Response(result.data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${originalName}"`,
    },
  })
}

export const config: Config = {
  path: '/api/file',
  method: ['GET', 'DELETE'],
}
