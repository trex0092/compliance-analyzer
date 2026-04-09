import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { authenticate, rateLimit } from './middleware/auth.mts'

// Allowed file types for compliance document uploads
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.xlsx', '.xls', '.csv', '.xml', '.txt', '.eml']
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/png', 'image/jpeg', 'application/msword', 'application/vnd.openxmlformats', 'application/vnd.ms-excel', 'text/csv', 'text/xml', 'application/xml', 'text/plain', 'message/rfc822']

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Rate limit: 10 uploads per 15-minute window (use context.ip for reliable IP)
  const rl = rateLimit(req, context.ip)
  if (!rl.ok) return rl.response!

  // Authentication required
  const auth = authenticate(req)
  if (!auth.ok) return auth.response!

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

  // Validate file type — prevent executable/malicious uploads
  const fileName = file.name.toLowerCase()
  const hasAllowedExt = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
  const hasAllowedMime = ALLOWED_MIME_PREFIXES.some(prefix => (file.type || '').startsWith(prefix))
  if (!hasAllowedExt || !hasAllowedMime) {
    return Response.json({ error: 'File type not allowed. Accepted: PDF, images, Office documents, CSV, XML.' }, { status: 400 })
  }

  // Validate category — prevent path traversal
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '_')

  const store = getStore('compliance-uploads')
  const timestamp = Date.now()
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const key = `${safeCategory}/${timestamp}-${safeFileName}`

  const buffer = await file.arrayBuffer()
  await store.set(key, buffer, {
    metadata: {
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: String(file.size),
      category: safeCategory,
      uploadedAt: new Date().toISOString(),
      uploadedBy: auth.userId || 'unknown',
    },
  })

  return Response.json({
    success: true,
    key,
    name: file.name,
    size: file.size,
    category: safeCategory,
    uploadedAt: new Date().toISOString(),
  })
}

export const config: Config = {
  path: '/api/upload',
  method: ['POST', 'OPTIONS'],
}
