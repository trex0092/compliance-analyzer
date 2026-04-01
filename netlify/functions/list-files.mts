import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

export default async (req: Request) => {
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
