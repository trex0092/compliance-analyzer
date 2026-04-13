import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { authenticate } from './middleware/auth.mts'
import { checkRateLimit } from './middleware/rate-limit.mts'

// Allowed file types for compliance document uploads
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.xlsx', '.xls', '.csv', '.xml', '.txt', '.eml']
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/png', 'image/jpeg', 'application/msword', 'application/vnd.openxmlformats', 'application/vnd.ms-excel', 'text/csv', 'text/xml', 'application/xml', 'text/plain', 'message/rfc822']

// Magic-byte sniffer — we verify the uploaded bytes actually match the
// declared MIME type. A client supplying `Content-Type: application/pdf`
// while the buffer starts with `<html>` or `<script>` is rejected.
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // PDF: %PDF-
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // ZIP (DOCX/XLSX/PPTX containers start PK\x03\x04)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'application/zip';
  // Legacy OLE/compound (DOC/XLS)
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'application/x-ole';
  return null;
}

function mimeCompatible(declared: string, sniffed: string | null, ext: string): boolean {
  if (!sniffed) return false;
  if (declared.startsWith('application/pdf')) return sniffed === 'application/pdf';
  if (declared.startsWith('image/png'))       return sniffed === 'image/png';
  if (declared.startsWith('image/jpeg'))      return sniffed === 'image/jpeg';
  // Office containers (zip-based or legacy ole)
  if (declared.startsWith('application/vnd.openxmlformats') || declared.startsWith('application/vnd.ms-excel')) {
    return sniffed === 'application/zip' || sniffed === 'application/x-ole';
  }
  if (declared.startsWith('application/msword')) return sniffed === 'application/zip' || sniffed === 'application/x-ole';
  // Plain text / CSV / XML have no reliable magic bytes; fall back to
  // the extension allowlist (already checked above).
  if (declared.startsWith('text/') || declared.startsWith('application/xml')) return true;
  if (declared.startsWith('message/rfc822')) return true;
  return false;
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Rate limit: 10 uploads per 15-minute window (persistent via Blobs)
  const rlResponse = await checkRateLimit(req, { clientIp: context.ip, max: 10 })
  if (rlResponse) return rlResponse

  // Authentication required
  const auth = authenticate(req)
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 })

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
  const declaredMime = file.type || 'application/octet-stream'
  const hasAllowedMime = ALLOWED_MIME_PREFIXES.some(prefix => declaredMime.startsWith(prefix))
  if (!hasAllowedExt || !hasAllowedMime) {
    return Response.json({ error: 'File type not allowed. Accepted: PDF, images, Office documents, CSV, XML.' }, { status: 400 })
  }

  // Read the bytes once, then sniff the magic bytes to verify the
  // declared MIME is genuine. An attacker claiming application/pdf while
  // uploading an HTML blob is rejected here.
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer.slice(0, 16))
  const sniffed = sniffMime(bytes)
  const ext = fileName.slice(fileName.lastIndexOf('.'))
  if (!mimeCompatible(declaredMime, sniffed, ext)) {
    console.warn('[upload] Rejected file ' + file.name + ' — declared ' + declaredMime + ' but sniffed ' + sniffed)
    return Response.json({ error: 'File content does not match declared type.' }, { status: 400 })
  }

  // Validate category — prevent path traversal
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '_')

  const store = getStore('compliance-uploads')
  const timestamp = Date.now()
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  // Per-user namespacing closes the previous IDOR where any token
  // holder could enumerate / download another user's uploads via the
  // list-files + get-file endpoints.
  const ownerId = auth.userId || 'unknown'
  const key = `user/${ownerId}/${safeCategory}/${timestamp}-${safeFileName}`

  await store.set(key, buffer, {
    metadata: {
      originalName: file.name,
      contentType: declaredMime,
      size: String(file.size),
      category: safeCategory,
      uploadedAt: new Date().toISOString(),
      uploadedBy: ownerId,
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
