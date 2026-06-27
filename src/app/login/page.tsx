'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef } from 'react';
import { login, type LoginState } from './actions';

const initial: LoginState = { error: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-accent w-full" disabled={pending}>
      {pending ? '확인 중…' : '입장'}
    </button>
  );
}

export default function LoginPage() {
  const [state, action] = useFormState(login, initial);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 4칸 PIN → hidden input 합성
  const syncPin = () => {
    const v = pinRefs.current.map((el) => el?.value ?? '').join('');
    const hidden = document.getElementById('pin') as HTMLInputElement | null;
    if (hidden) hidden.value = v;
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-5">
      <div className="card w-full max-w-[380px] p-7">
        <div className="mb-6">
          <div style={{ letterSpacing: '.25em', fontWeight: 800, fontSize: 20 }}>
            S<span style={{ color: 'var(--accent)' }}>Q</span>
          </div>
          <p style={{ color: 'var(--faint)', fontSize: 13, marginTop: 6 }}>
            스큐 — 아이디와 4자리 PIN으로 입장
          </p>
        </div>

        <form action={action} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="loginId">아이디</label>
            <input id="loginId" name="loginId" className="input" autoFocus autoComplete="username" placeholder="아이디" />
          </div>

          <div>
            <label className="label">PIN · 6자리</label>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <input
                  key={i}
                  ref={(el) => { pinRefs.current[i] = el; }}
                  className="input text-center"
                  inputMode="numeric"
                  maxLength={1}
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, '').slice(-1);
                    e.target.value = d;
                    if (d && i < 5) pinRefs.current[i + 1]?.focus();
                    syncPin();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !e.currentTarget.value && i > 0) {
                      pinRefs.current[i - 1]?.focus();
                    }
                  }}
                  aria-label={`PIN ${i + 1}`}
                />
              ))}
            </div>
            <input type="hidden" id="pin" name="pin" />
          </div>

          {state.error && (
            <p style={{ color: '#ef7aa7', fontSize: 13 }}>{state.error}</p>
          )}

          <SubmitButton />
        </form>
      </div>
    </main>
  );
}
