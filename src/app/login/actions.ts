'use server';

import { redirect } from 'next/navigation';
import { authenticate } from '@/lib/auth';

export type LoginState = { error: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get('loginId') ?? '');
  const pin = String(formData.get('pin') ?? '');
  const err = await authenticate(loginId, pin);
  if (err) return { error: err };
  redirect('/home');
}
