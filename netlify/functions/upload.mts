import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  const contentType = req.headers.get('content-type') || ''

  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const category = (formData.get('category') as string) || 'general'

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  // 50 MB limit
  if (file.size > 50 * 1024 * 1024) {
    return Response.json({ error: 'File too large. Maximum size is 50 MB.' }, { status: 400 })
  }

  const store = getStore('compliance-uploads')
  const timestamp = Date.now()
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const key = `${category}/${timestamp}-${safeFileName}`

  const buffer = await file.arrayBuffer()
  await store.set(key, buffer, {
    metadata: {
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: String(file.size),
      category,
      uploadedAt: new Date().toISOString(),
    },
  })

  return Response.json({
    success: true,
    key,
    name: file.name,
    size: file.size,
    category,
    uploadedAt: new Date().toISOString(),
  })
}

export const config: Config = {
  path: '/api/upload',
  method: ['POST', 'OPTIONS'],
}
