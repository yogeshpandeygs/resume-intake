/**
 * Writes `candidate_submissions_export_template.csv` — the worked template the
 * PRD says accompanies the specification.
 *
 *   npm run csv:template
 *
 * Generated from the same `EXPORT_COLUMNS` and `csvRow` the live export uses, so
 * the template cannot drift away from what the application actually produces.
 * The two rows are illustrative and entirely fictional.
 */
import { writeFileSync } from 'node:fs'
import { csvRow, UTF8_BOM } from '../lib/csv'
import { EXPORT_COLUMNS } from '../lib/export-columns'

const OUTPUT = 'candidate_submissions_export_template.csv'

/**
 * Row two deliberately exercises the awkward cases: a Freshers candidate with no
 * employer, an accented name, a value containing a comma, and a skills string
 * beginning with `+` — which the formula-injection guard must neutralise.
 */
const ROWS: readonly (readonly unknown[])[] = [
  [
    'SUB-2026-000001',
    '2026-08-15T12:37:04+05:30',
    'Priya',
    'Sharma',
    'priya.sharma@example.com',
    '+919876543210',
    'B.Tech',
    'Indian Institute of Technology Bombay',
    2016,
    'Indian Institute of Management Bangalore',
    2021,
    '',
    '',
    'Bengaluru, Karnataka',
    'Acme Analytics',
    'Senior Data Engineer',
    '2022-04-01',
    'Operations',
    '8.5',
    'Mid-career',
    'IT',
    'Eight years building and running data platforms, most recently leading a team of six on a real-time ingestion pipeline.',
    'Python; SQL; Airflow; dbt; Kafka',
    'AWS Certified Solutions Architect (2024)',
    'priya-sharma-resume.pdf',
    'pdf',
    243,
    'text',
    'walkin-blr-aug',
    'none',
    '1.0',
    '2026-08-15T12:37:04+05:30',
    '2029-08-15',
    36,
  ],
  [
    'SUB-2026-000002',
    '2026-08-16T09:14:22+05:30',
    'Arjun',
    'Ramírez',
    'arjun.ramirez@example.com',
    '+919812345678',
    'B.Sc',
    'St. Xavier’s College, Mumbai',
    2026,
    '',
    '',
    '',
    '',
    'Mumbai',
    '',
    '',
    '',
    'Freshers',
    '0.0',
    'Early careers',
    'BioPharma',
    'Final-year biotechnology student with laboratory internship experience in analytical chemistry.',
    '+2 years lab experience; HPLC; Python',
    '',
    'arjun-ramirez-cv.docx',
    'docx',
    88,
    'vision',
    'whatsapp',
    'name_match',
    '1.0',
    '2026-08-16T09:14:22+05:30',
    '2029-08-16',
    36,
  ],
]

const content =
  UTF8_BOM + [csvRow(EXPORT_COLUMNS), ...ROWS.map(csvRow)].join('\r\n') + '\r\n'

writeFileSync(OUTPUT, content, 'utf8')
console.log(`Wrote ${OUTPUT} (${EXPORT_COLUMNS.length} columns, ${ROWS.length} example rows)`)
