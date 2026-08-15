/**
 * Generates synthetic resume files for testing the upload and parse paths.
 *
 *   npx tsx scripts/make-fixtures.ts
 *
 * Everything here is fabricated — no real candidate data goes in the repository.
 * Four files, one per route through the parser:
 *
 *   text-resume.pdf     PDF with a text layer      -> unpdf, parse_method "text"
 *   scanned-resume.pdf  PDF with no text layer     -> Claude vision, "vision"
 *   resume.docx         Open XML Word document     -> mammoth, "text"
 *   legacy-resume.doc   old binary Word document   -> manual entry, "manual"
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

const OUT = 'fixtures'
mkdirSync(OUT, { recursive: true })

const RESUME_TEXT = [
  'Priya Sharma',
  'Bengaluru, Karnataka, India',
  'priya.sharma@example.com | +91 98765 43210',
  '',
  'SUMMARY',
  'Data engineer with over eight years of experience building and operating large scale',
  'data platforms. Currently leading a team of six engineers responsible for real time',
  'ingestion and the analytics warehouse.',
  '',
  'EXPERIENCE',
  'Acme Analytics, Bengaluru - Senior Data Engineer, April 2022 to present',
  'Designed and operates the streaming ingestion pipeline handling four billion events daily.',
  'Reduced warehouse compute spend by thirty eight percent over two quarters.',
  '',
  'Globex Software, Pune - Data Engineer, July 2016 to March 2022',
  'Built the batch ETL platform and the internal metrics catalogue.',
  '',
  'EDUCATION',
  'Indian Institute of Management Bangalore - MBA, 2021',
  'Indian Institute of Technology Bombay - B.Tech Computer Science, 2016',
  '',
  'SKILLS',
  'Python, SQL, Apache Airflow, dbt, Apache Kafka, Snowflake, Terraform, AWS',
  '',
  'CERTIFICATIONS',
  'AWS Certified Solutions Architect, 2024',
]

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

/** Escape the characters that terminate a PDF string literal. */
function pdfEscape(text: string): string {
  return text.replace(/([\\()])/g, '\\$1')
}

/**
 * Build a single-page PDF with correct cross-reference offsets.
 *
 * Written by hand rather than with a library so the fixtures have no build-time
 * dependency of their own — and so the "no text layer" variant can be produced by
 * simply omitting the text operators.
 */
function buildPdf(lines: string[]): Buffer {
  const content =
    lines.length > 0
      ? [
          'BT',
          '/F1 11 Tf',
          '14 TL',
          '54 760 Td',
          ...lines.map((line) => `(${pdfEscape(line)}) Tj T*`),
          'ET',
        ].join('\n')
      : // A page with a drawn rectangle and no text: what a scan looks like to a
        // text extractor.
        '0.85 0.85 0.85 rg\n54 500 500 260 re f'

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

/* ------------------------------------------------------------------ *
 * DOCX (a ZIP of XML parts)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!
  return (crc ^ -1) >>> 0
}

/** Minimal deflate-compressed ZIP writer — enough for a valid .docx. */
function buildZip(entries: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const raw = Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(raw)
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + nameBuffer.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(0, 10) // time/date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    nameBuffer.copy(local, 30)
    locals.push(local, compressed)

    const central = Buffer.alloc(46 + nameBuffer.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuffer.copy(central, 46)
    centrals.push(central)

    offset += local.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralDirectory, end])
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildDocx(lines: string[]): Buffer {
  const paragraphs = lines
    .map((line) =>
      line === ''
        ? '<w:p/>'
        : `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join('')

  return buildZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    },
  ])
}

/* ------------------------------------------------------------------ */

writeFileSync(`${OUT}/text-resume.pdf`, buildPdf(RESUME_TEXT))
writeFileSync(`${OUT}/scanned-resume.pdf`, buildPdf([]))
writeFileSync(`${OUT}/resume.docx`, buildDocx(RESUME_TEXT))

// The legacy binary Word format, identified by its OLE compound-document magic
// number. Nothing parses this on serverless, which is exactly the point.
const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
writeFileSync(
  `${OUT}/legacy-resume.doc`,
  Buffer.concat([oleHeader, Buffer.alloc(512, 0), Buffer.from(RESUME_TEXT.join('\n'), 'utf8')]),
)

console.log(`Wrote fixtures to ${OUT}/`)
