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
  // Supabase-Vercel 연동이 자동 주입하는 이름들도 인식
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  let inst: DB;
  if (url) {
    // 운영: Supabase Postgres. pgBouncer(transaction) 모드 대비 prepare:false.
    // fetch_types:false — 드라이버는 접속할 때마다 pg_type 조인 쿼리를 한 번 더 던진다.
    //   서버리스는 요청 사이 소켓이 끊겨 매번 재접속하므로, 그대로 두면 요청마다 왕복이 1회 늘어난다.
    //   (운영 pg_stat_statements: 그 타입 조회 132회 vs person 조회 102회 — 요청보다 접속이 많다)
    //   주의: 배열 파서는 오직 이 조회로만 등록된다(기본 파서에 배열 없음). 그래서 배열 컬럼을
    //   읽는 곳(module.requires)은 jsonb 로 받도록 바꿨다 — json 파서는 기본 내장이다.
    //   쓰기는 $n::text[] 캐스팅이라 타입 정보 없이도 동작한다.
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { prepare: false, fetch_types: false });
    inst = {
      async query<T = Row>(text: string, params: unknown[] = []) {
        const rows = await sql.unsafe(text, params as never[]);
        return { rows: rows as unknown as T[] };
      },
      async exec(text: string) {
        await sql.unsafe(text).simple(); // 다중 statement(스키마) 실행
      },
    };
  } else if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    // 배포 환경인데 DB URL 없음 → PGlite로 폴백하면 읽기전용 FS라 EROFS. 명확히 안내.
    throw new Error(
      "DB 연결 정보가 없습니다. Vercel 환경변수에 DATABASE_URL(또는 POSTGRES_URL)을 Supabase 접속 문자열(Transaction pooler)로 설정한 뒤 재배포하세요.",
    );
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
