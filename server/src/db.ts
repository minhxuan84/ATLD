import 'dotenv/config'
import pg from 'pg'

const schema = process.env.PGSCHEMA || 'atld'

// Đặt search_path về schema atld ngay ở tham số kết nối (không chạm public.*)
export const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  options: `-c search_path=${schema}`,
  max: 10,
})

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never)
}
