import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getMe } from '@/lib/auth';
import { getHomeModules } from '@/lib/modules';
import { can, PERMS } from '@/lib/perms';
import { logout } from './actions';

export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect('/login');

  const mods = await getHomeModules(me);
  const active = me.branches.find((b) => b.id === me.activeBranchId);
  const roleLabels = active?.roles.map((r) => r.label) ?? (me.isCto ? ['CTO'] : []);
  const isManager =
    me.isCto || can(me, PERMS.ACCOUNT_PROVISION) || can(me, PERMS.MODULE_ASSIGN);

  return (
    <main className="min-h-screen">
      {/* 헤더 */}
      <header style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="mx-auto max-w-[980px] px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{ letterSpacing: '.22em', fontWeight: 800 }}>
              S<span style={{ color: 'var(--accent)' }}>Q</span>
            </span>
            {active && <span className="chip">{active.name}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>{me.name}</span>
            {me.isCto && <span className="chip" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>CTO</span>}
            <form action={logout}>
              <button className="btn" style={{ height: 34, padding: '0 12px', fontSize: 13 }}>로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[980px] px-5 py-8">
        {/* 인사 */}
        <div className="mb-6">
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em' }}>
            {me.name}님, 안녕하세요
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {roleLabels.map((r) => <span key={r} className="chip">{r}</span>)}
          </div>
        </div>

        {/* 관리 진입 (권한자만) */}
        {isManager && (
          <div className="card p-4 mb-6 flex items-center justify-between">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>관리</div>
              <div style={{ color: 'var(--faint)', fontSize: 12.5 }}>계정 발급 · 역할 · 모듈 할당</div>
            </div>
            <span className="chip">준비중</span>
          </div>
        )}

        {/* 모듈 Dock */}
        <div style={{ fontSize: 13, color: 'var(--faint)', marginBottom: 12 }}>모듈</div>
        {mods.length === 0 ? (
          <div className="card p-8 text-center" style={{ color: 'var(--faint)', fontSize: 14 }}>
            아직 활성화된 모듈이 없습니다.
            {me.isCto && <div style={{ marginTop: 6, fontSize: 12.5 }}>모듈을 추가하면 여기에 카드가 생깁니다.</div>}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
            {mods.map((m) => (
              <Link
                key={m.key}
                href={m.ready ? m.href : '#'}
                className="card p-5"
                style={{ display: 'block', textDecoration: 'none', color: 'inherit', opacity: m.ready ? 1 : 0.6 }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{m.label}</div>
                <div style={{ marginTop: 8 }}>
                  <span className="chip">{m.ready ? '열기' : '준비중'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
