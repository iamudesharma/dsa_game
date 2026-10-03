'use client'

/**
 * Client-side resume file extraction. The server only ever receives text:
 * PDFs are read with pdfjs and DOCX with mammoth, both in the browser, so no
 * uploaded file ever leaves the machine. Extraction failure falls back to
 * paste/manual — never a dead end.
 */

const PDFJS_VERSION = '6.3.289'

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

/** One positioned text run as pdfjs reports it. */
export interface PdfTextItem {
  str?: string
  transform?: number[]
}

/**
 * Rebuild LINE STRUCTURE from positioned runs.
 *
 * pdfjs returns a flat stream of glyph runs with no newlines. Joining them
 * with spaces produced one enormous line, which destroyed the single most
 * important signal the resume parser has — the heading-per-line layout. A run
 * that starts lower on the page than the previous one began a new line, so the
 * y-coordinate is what turns the stream back into text.
 *
 * Exported and pure so it is unit-testable without a PDF.
 */
export function assemblePdfLines(items: readonly PdfTextItem[]): string {
  const lines: string[] = []
  let current = ''
  let lastY: number | null = null
  for (const item of items) {
    const str = item.str ?? ''
    if (str.trim() === '') continue
    const y = item.transform?.[5] ?? null
    // A drop of more than half a line height is a new line, not a wrap. The
    // threshold is deliberately loose: pdfjs y values are font-scaled, so a
    // tight 2-unit cut missed real line breaks and produced one long blob —
    // which is what destroyed the heading-per-line layout the parser needs.
    const newLine = lastY !== null && y !== null && Math.abs(lastY - y) > 0.5
    if (newLine && current !== '') {
      lines.push(current.trim())
      current = ''
    }
    // Runs often carry their own leading/trailing space (" Postgres"); trimming
    // each one before joining is what keeps the output single-spaced.
    current += (current === '' ? '' : ' ') + str.trim()
    if (y !== null) lastY = y
  }
  if (current.trim() !== '') lines.push(current.trim())
  return lines.join('\n')
}

async function extractPdf(file: File): Promise<string> {
  const buffer = await readAsBuffer(file)
  interface PdfPage {
    getTextContent: () => Promise<{ items: PdfTextItem[] }>
  }
  interface PdfProxy {
    numPages: number
    getPage: (n: number) => Promise<PdfPage>
    /** pdfjs >= 4 exposes cleanup(); older builds have no teardown hook. */
    cleanup?: () => Promise<unknown>
  }
  interface PdfTask {
    promise: Promise<PdfProxy>
    /** Lives on the LOADING TASK, not the proxy — this is the v4+ shape. */
    destroy?: () => Promise<void>
  }
  const pdfjs = (await import('pdfjs-dist')) as unknown as {
    getDocument: (opts: { data: ArrayBuffer }) => PdfTask
    GlobalWorkerOptions: { workerSrc: string }
  }
  // Worker from CDN; without it pdfjs falls back to the main thread and still
  // works, just slower. Either way the bytes never leave the browser.
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`
  } catch {
    // ignore worker setup failures; the main-thread fallback still extracts
  }
  const task = pdfjs.getDocument({ data: buffer })
  const doc = await task.promise
  try {
    const pages: string[] = []
    // 10 pages is far past any real resume and bounds the work on a huge file.
    const count = Math.min(doc.numPages, 10)
    for (let n = 1; n <= count; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push(assemblePdfLines(content.items))
    }
    const text = pages.join('\n').replace(/[ \t]+/g, ' ').trim()
    if (!text) throw new Error('That PDF had no readable text.')
    return text
  } finally {
    // Teardown is best-effort and shape-tolerant: a wrong call here must never
    // turn a successful extraction into a failure, which is exactly what
    // `doc.destroy()` did on the proxy (it only exists on the loading task).
    await doc.cleanup?.().catch(() => {})
    await task.destroy?.().catch(() => {})
  }
}
