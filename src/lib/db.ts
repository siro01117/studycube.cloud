// DB 어댑터 — 앱은 db.query(sql, params)->{rows} 와 db.exec(sql) 만 사용.
//  · 로컬 개발: DATABASE_URL 없음 → PGlite(설치 없이 도는 진짜 Postgres, .pglite 폴더)
//  · 배포(Vercel 등): DATABASE_URL 있음 → Supabase Postgres (postgres.js, Transaction pooler URL 권장)
// 앱 코드는 그대로. 어느 쪽이든 인터페이스 동일.
type Row = Record<string, unknown>;
export interface DB {
  query<T = Row>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<void>;
}

// 인스턴스 하나만 유지(dev hot-reload·serverless 콜드스타트 재사용)
const g = globalThis as unknown as { __dbInst?: DB };

async function real(): Promise<DB> {
  if (g.__dbInst) return g.__dbInst;
  const url = process.env.DATABASE_URL;
  let inst: DB;
  if (url) {
    // 운영: Supabase Postgres. pgBouncer(transaction) 모드 대비 prepare:false.
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { prepare: false });
    inst = {
      async query<T = Row>(text: string, params: unknown[] = []) {
        const rows = await sql.unsafe(text, params as never[]);
        return { rows: rows as unknown as T[] };
      },
      async exec(text: string) {
        await sql.unsafe(text).simple(); // 다중 statement(스키마) 실행
      },
    };
  } else {
    // 개발: 로컬 PGlite
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite(".pglite");
    inst = {
      async query<T = Row>(text: string, params: unknown[] = []) {
        const r = await pg.query(text, params);
        return { rows: r.rows as unknown as T[] };
      },
      async exec(text: string) { await pg.exec(text); },
    };
  }
  g.__dbInst = inst;
  return inst;
}

export const db: DB = {
  query: async (text, params) => (await real()).query(text, params),
  exec: async (text) => (await real()).exec(text),
};
