'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginInputSchema, teamMemberSchema } from '../../contracts/session';
import { apiRequest, describeFailure, jsonRequest } from './api';
import { Field, inputClass, Notice, panelClass, primaryClass } from './ui';

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      await apiRequest('/api/auth/login', teamMemberSchema, jsonRequest('POST', loginInputSchema.parse({ username, password })));
      setPassword('');
      router.replace('/studio');
    } catch (failure) { setError(describeFailure(failure)); }
    finally { setPending(false); }
  }
  return <main className="mx-auto max-w-md px-6 py-20 sm:py-28">
    <Link href="/" className="font-serif text-3xl text-amber-100">拾物馆</Link>
    <h1 className="mt-8 text-2xl">团队制作入口</h1>
    <p className="mb-8 mt-3 text-sm leading-6 text-stone-400">使用预置的团队账号，收录旧物、核对故事并交付参观链接。</p>
    <form className={`${panelClass} space-y-5`} onSubmit={submit}>
      <Field label="团队账号"><input className={inputClass} autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} /></Field>
      <Field label="密码"><input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} /></Field>
      <Notice error={error} />
      <button className={`${primaryClass} w-full`} disabled={pending}>{pending ? '正在登录…' : '登录制作工作台'}</button>
    </form>
  </main>;
}
