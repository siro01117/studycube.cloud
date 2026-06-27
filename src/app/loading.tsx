export default function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div style={{ color: 'var(--dim)', letterSpacing: '.25em', fontWeight: 800, fontSize: 18 }}>
        S<span style={{ color: 'var(--accent)' }}>Q</span>
      </div>
    </div>
  );
}
