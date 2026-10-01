'use client'

/**
 * Client-side resume file extraction. The server only ever receives text:
 * PDFs are read with pdfjs and DOCX with mammoth, both in the browser, so no
 * uploaded file ever leaves the machine. Extraction failure falls back to
 * paste/manual — never a dead end.
 */

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return extractPdf(file)
  if (name.endsWith('.docx')) return extractDocx(file)
  // .txt, .md, and anything else: read as text and let the parser sort it out.
  return readAsText(file)
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read that file as text.'))
    reader.readAsText(file)
  })
}

function readAsBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsArrayBuffer(file)
  })
}

async function extractDocx(file: File): Promise<string> {
  const buffer = await readAsBuffer(file)
  const mammoth = (await import('mammoth')) as unknown as {
    extractRawText: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
  }
  const out = await mammoth.extractRawText({ arrayBuffer: buffer })
  const text = out.value.trim()
  if (!text) throw new Error('That DOCX had no readable text.')
  return text
}

async function extractPdf(file: File): Promise<string> {
  const buffer = await readAsBuffer(file)
  const pdfjs = (await import('pdfjs-dist')) as unknown as {
    getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> }
    GlobalWorkerOptions: { workerSrc: string }
  }
  // Worker from CDN; without it pdfjs falls back to the main thread and still
  // works, just slower. Either way the bytes never leave the browser.
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${'6.3.289'}/build/pdf.worker.min.mjs`
  } catch {
    // ignore worker setup failures; the main-thread fallback still extracts
  }
  interface PdfPage {
    getTextContent: () => Promise<{ items: { str?: string }[] }>
  }
  interface PdfDoc {
    numPages: number
    getPage: (n: number) => Promise<PdfPage>
    destroy: () => Promise<void>
  }
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  try {
    const pages: string[] = []
    const count = Math.min(doc.numPages, 10)
    for (let n = 1; n <= count; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push(content.items.map((it) => it.str ?? '').join(' '))
    }
    const text = pages.join('\n').replace(/[ \t]+/g, ' ').trim()
    if (!text) throw new Error('That PDF had no readable text.')
    return text
  } finally {
    await doc.destroy().catch(() => {})
  }
}
