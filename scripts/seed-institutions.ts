/**
 * Seeds the institution type-ahead.
 *
 *   npm run db:seed
 *
 * This is a starter list of widely-recognised Indian institutions, not a complete
 * register. For production, replace `INSTITUTIONS` with an export from AISHE
 * (the All India Survey on Higher Education, aishe.gov.in), which lists every
 * recognised university and college. The loader below is idempotent, so
 * re-running it with a larger list simply adds the new entries.
 *
 * The field is free text either way: a candidate whose institution is missing can
 * always type it. Suggestions exist to keep spellings consistent enough for the
 * admin's institution filter to be useful.
 */
import 'dotenv/config'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { assertPgliteAvailable } from '../lib/db/pglite-lock'
import { institutions } from '../lib/db/schema'
import { normaliseName } from '../lib/domain/fields'
import { databaseUrl, pgliteDataDir } from '../lib/env'

const INSTITUTIONS = [
  // IITs
  'Indian Institute of Technology Bombay',
  'Indian Institute of Technology Delhi',
  'Indian Institute of Technology Madras',
  'Indian Institute of Technology Kanpur',
  'Indian Institute of Technology Kharagpur',
  'Indian Institute of Technology Roorkee',
  'Indian Institute of Technology Guwahati',
  'Indian Institute of Technology Hyderabad',
  'Indian Institute of Technology Indore',
  'Indian Institute of Technology (BHU) Varanasi',
  'Indian Institute of Technology Gandhinagar',
  'Indian Institute of Technology Ropar',
  'Indian Institute of Technology Patna',
  'Indian Institute of Technology Bhubaneswar',
  'Indian Institute of Technology Mandi',
  'Indian Institute of Technology Jodhpur',
  'Indian Institute of Technology Tirupati',
  'Indian Institute of Technology Palakkad',
  'Indian Institute of Technology Dhanbad',

  // IIMs
  'Indian Institute of Management Ahmedabad',
  'Indian Institute of Management Bangalore',
  'Indian Institute of Management Calcutta',
  'Indian Institute of Management Lucknow',
  'Indian Institute of Management Kozhikode',
  'Indian Institute of Management Indore',
  'Indian Institute of Management Shillong',
  'Indian Institute of Management Udaipur',
  'Indian Institute of Management Raipur',
  'Indian Institute of Management Rohtak',
  'Indian Institute of Management Nagpur',
  'Indian Institute of Management Visakhapatnam',

  // Science and research
  'Indian Institute of Science, Bengaluru',
  'Tata Institute of Fundamental Research',
  'Indian Statistical Institute',
  'Indian Institute of Science Education and Research, Pune',
  'Indian Institute of Science Education and Research, Kolkata',
  'Indian Institute of Science Education and Research, Mohali',
  'Jawaharlal Nehru Centre for Advanced Scientific Research',
  'National Centre for Biological Sciences',

  // NITs
  'National Institute of Technology, Tiruchirappalli',
  'National Institute of Technology, Surathkal',
  'National Institute of Technology, Warangal',
  'National Institute of Technology, Rourkela',
  'National Institute of Technology, Calicut',
  'National Institute of Technology, Durgapur',
  'National Institute of Technology, Kurukshetra',
  'National Institute of Technology, Jaipur (MNIT)',
  'National Institute of Technology, Allahabad (MNNIT)',
  'National Institute of Technology, Nagpur (VNIT)',
  'National Institute of Technology, Silchar',
  'National Institute of Technology, Jamshedpur',
  'National Institute of Technology, Hamirpur',
  'National Institute of Technology, Srinagar',

  // Central and state universities
  'University of Delhi',
  'Jawaharlal Nehru University',
  'Jamia Millia Islamia',
  'Banaras Hindu University',
  'Aligarh Muslim University',
  'University of Mumbai',
  'Savitribai Phule Pune University',
  'University of Calcutta',
  'Jadavpur University',
  'University of Madras',
  'Anna University',
  'Bangalore University',
  'Osmania University',
  'University of Hyderabad',
  'Panjab University',
  'Gujarat University',
  'University of Rajasthan',
  'University of Kerala',
  'Cochin University of Science and Technology',
  'Andhra University',
  'Visvesvaraya Technological University',
  'Guru Gobind Singh Indraprastha University',
  'Maharshi Dayanand University',
  'Kurukshetra University',
  'Devi Ahilya Vishwavidyalaya',
  'Savitribai Phule Pune University',
  'Shivaji University',
  'Bharathiar University',
  'Bharathidasan University',
  'Madurai Kamaraj University',
  'Calicut University',
  'Mahatma Gandhi University, Kottayam',
  'Utkal University',
  'Gauhati University',
  'Patna University',
  'Ranchi University',
  'Lucknow University',
  'Allahabad University',

  // Deemed and private universities
  'Birla Institute of Technology and Science, Pilani',
  'Birla Institute of Technology, Mesra',
  'Vellore Institute of Technology',
  'SRM Institute of Science and Technology',
  'Manipal Academy of Higher Education',
  'Amity University',
  'Symbiosis International University',
  'Thapar Institute of Engineering and Technology',
  'PES University',
  'RV College of Engineering',
  'BMS College of Engineering',
  'MS Ramaiah Institute of Technology',
  'Delhi Technological University',
  'Netaji Subhas University of Technology',
  'College of Engineering, Pune',
  'Veermata Jijabai Technological Institute',
  'Sardar Patel Institute of Technology',
  'Institute of Chemical Technology, Mumbai',
  'Ashoka University',
  'Shiv Nadar University',
  'OP Jindal Global University',
  'Krea University',
  'Plaksha University',
  'Christ University',
  'Loyola College, Chennai',
  'St. Xavier’s College, Mumbai',
  'St. Stephen’s College, Delhi',
  'Lady Shri Ram College for Women',
  'Shri Ram College of Commerce',
  'Hindu College, Delhi',
  'Miranda House',
  'Presidency University, Kolkata',
  'Fergusson College, Pune',
  'Mount Carmel College, Bengaluru',

  // Management, medicine and law
  'Xavier School of Management (XLRI)',
  'Faculty of Management Studies, Delhi',
  'SP Jain Institute of Management and Research',
  'Management Development Institute, Gurgaon',
  'Narsee Monjee Institute of Management Studies',
  'Institute of Rural Management Anand',
  'All India Institute of Medical Sciences, New Delhi',
  'Christian Medical College, Vellore',
  'Armed Forces Medical College, Pune',
  'Postgraduate Institute of Medical Education and Research, Chandigarh',
  'King George’s Medical University',
  'Maulana Azad Medical College',
  'National Law School of India University, Bengaluru',
  'NALSAR University of Law',
  'National Law University, Delhi',
  'Symbiosis Law School',
  'Government Law College, Mumbai',

  // Design, architecture and other
  'National Institute of Design',
  'School of Planning and Architecture, New Delhi',
  'Indian Institute of Foreign Trade',
  'Tata Institute of Social Sciences',
  'Indira Gandhi National Open University',
  'Institute of Chartered Accountants of India',
] as const

async function main() {
  if (databaseUrl) {
    const { drizzle: drizzlePg } = await import('drizzle-orm/node-postgres')
    const db = drizzlePg(databaseUrl)
    await load(db as never)
    console.log(`Seeded ${INSTITUTIONS.length} institutions into Postgres`)
    process.exit(0)
  }

  assertPgliteAvailable(pgliteDataDir)
  const client = new PGlite(pgliteDataDir)
  const db = drizzle(client)
  await load(db as never)
  await client.close()
  console.log(`Seeded ${INSTITUTIONS.length} institutions into ${pgliteDataDir}`)
}

async function load(db: {
  insert: (table: typeof institutions) => {
    values: (rows: { name: string; nameNorm: string }[]) => {
      onConflictDoNothing: () => Promise<unknown>
    }
  }
}) {
  // De-duplicated on the normalised name so a repeated entry in the list above
  // does not trip the unique index.
  const seen = new Set<string>()
  const rows = INSTITUTIONS.flatMap((name) => {
    const nameNorm = normaliseName(name)
    if (seen.has(nameNorm)) return []
    seen.add(nameNorm)
    return [{ name, nameNorm }]
  })

  await db.insert(institutions).values(rows).onConflictDoNothing()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
