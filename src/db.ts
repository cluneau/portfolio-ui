import * as duckdb from '@duckdb/duckdb-wasm'
import { DateUnit, Type as ArrowType } from 'apache-arrow'
import type { Date_, Field } from 'apache-arrow'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

// Self-hosted bundles rather than the jsDelivr CDN: no third-party runtime
// dependency, and Vite rewrites these to /portfolio-ui/assets/... on build.
// `coi` (threaded) is deliberately absent — it needs COOP/COEP response
// headers, which GitHub Pages cannot set. selectBundle falls back to eh/mvp.
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
  eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
}

/** A row of a query result, with column values already converted to plain JS. */
export type Row = Record<string, unknown>

/**
 * How a column should be rendered. Derived from the Arrow schema rather than
 * sniffed from values: temporal columns arrive as plain epoch-millis numbers,
 * so they are indistinguishable from ordinary numbers at the value level.
 */
export type ColumnKind = 'date' | 'timestamp' | 'number' | 'other'

export interface Column {
  name: string
  kind: ColumnKind
}

export interface QueryResult {
  columns: Column[]
  rows: Row[]
}

function columnKind(field: Field): ColumnKind {
  switch (field.typeId) {
    case ArrowType.Date:
      // castTimestampToDate turns TIMESTAMP into Date64<MILLISECOND>; DATE is
      // Date32<DAY>. Both come through as epoch millis.
      return (field.type as Date_).unit === DateUnit.DAY ? 'date' : 'timestamp'
    case ArrowType.Int:
    case ArrowType.Float:
    case ArrowType.Decimal:
      return 'number'
    default:
      return 'other'
  }
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

function initDb(): Promise<duckdb.AsyncDuckDB> {
  dbPromise ??= (async () => {
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
    // duckdb's browser workers are classic scripts, so no { type: 'module' }.
    const worker = new Worker(bundle.mainWorker!)
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    await db.open({
      path: ':memory:',
      query: {
        // Keep BIGINT out of BigInt so the renderer and JSON.stringify stay simple.
        castBigIntToDouble: true,
        // Without this, TIMESTAMP arrives as epoch millis and renders as a
        // bare number; as Date64 the renderer can format it.
        castTimestampToDate: true,
        castDecimalToDouble: true,
      },
    })
    return db
  })()
  return dbPromise
}

const VFS_NAME = 'picked.db'
const SCHEMA = 'portfolio'

/**
 * A database the user picked from their own disk. The file is registered with
 * duckdb-wasm as a virtual file and read via random access in the worker — it
 * is never uploaded anywhere, and never read fully into memory.
 */
export class PortfolioDb {
  private constructor(
    private readonly db: duckdb.AsyncDuckDB,
    private readonly conn: duckdb.AsyncDuckDBConnection,
    readonly fileName: string,
  ) {}

  static async open(file: File): Promise<PortfolioDb> {
    const db = await initDb()
    // Drop any previously picked file so re-picking is idempotent.
    await db.dropFile(VFS_NAME).catch(() => {})
    await db.registerFileHandle(
      VFS_NAME,
      file,
      duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
      true,
    )

    const conn = await db.connect()
    try {
      // READ_ONLY is explicit: a registered local handle does not default to
      // it, and BROWSER_FILEREADER cannot write anyway.
      await conn.query(`DETACH DATABASE IF EXISTS ${SCHEMA}`)
      await conn.query(`ATTACH '${VFS_NAME}' AS ${SCHEMA} (READ_ONLY)`)
      await conn.query(`USE ${SCHEMA}`)
    } catch (err) {
      await conn.close()
      throw err
    }
    return new PortfolioDb(db, conn, file.name)
  }

  async query(sql: string): Promise<QueryResult> {
    const table = await this.conn.query(sql)
    return {
      columns: table.schema.fields.map((f) => ({ name: f.name, kind: columnKind(f) })),
      rows: table.toArray().map((row) => row.toJSON() as Row),
    }
  }

  /** Table names in the attached database, for error messages and later use. */
  async tableNames(): Promise<string[]> {
    const { rows } = await this.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_catalog = '${SCHEMA}' ORDER BY table_name`,
    )
    return rows.map((r) => String(r['table_name']))
  }

  async close(): Promise<void> {
    await this.conn.close()
    await this.db.dropFile(VFS_NAME).catch(() => {})
  }
}
