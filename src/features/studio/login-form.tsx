'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginInputSchema, registerInputSchema, sessionUserSchema } from '../../contracts/session';
import { apiRequest, describeFailure, jsonRequest } from './api';
import { Field, inputClass, Notice, panelClass, primaryClass } from './ui';

export function LoginForm({ returnTo = '/studio' }: { returnTo?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      if (mode === 'login') {
        await apiRequest('/api/auth/login', sessionUserSchema, jsonRequest('POST', loginInputSchema.parse({ username, password })));
        setPassword('');
      } else {
        if (password !== confirm) throw new Error('两次输入的密码不一致。');
        await apiRequest('/api/auth/register', sessionUserSchema, jsonRequest('POST', registerInputSchema.parse({ username, password })));
        setPassword(''); setConfirm('');
      }
      router.replace(returnTo);
    } catch (failure) { setError(describeFailure(failure)); }
    finally { setPending(false); }
  }
  const registering = mode === 'register';
  return <main className="mx-auto max-w-md px-6 py-20 sm:py-28">
    <Link href="/" className="font-serif text-3xl text-amber-100">拾物馆</Link>
    <h1 className="mt-8 text-2xl">{registering ? '注册拾物馆账号' : '登录拾物馆'}</h1>
    <p className="mb-8 mt-3 text-sm leading-6 text-stone-400">注册或登录后，创建你的展馆，拍照收录旧物，整理故事并发布参观链接。</p>
    <form className={`${panelClass} space-y-5`} onSubmit={submit}>
      <Field label="用户名" {...(registering ? { hint: '2–40 个字，可用文字、数字、下划线或连字符。' } : {})}>
        <input className={inputClass} autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} />
      </Field>
      <Field label="密码" {...(registering ? { hint: '至少 8 位。' } : {})}>
        <input className={inputClass} type="password" autoComplete={registering ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} />
      </Field>
      {registering && <Field label="确认密码"><input className={inputClass} type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={pending} /></Field>}
      <Notice error={error} />
      <button className={`${primaryClass} w-full`} disabled={pending}>{pending ? (registering ? '正在注册…' : '正在登录…') : registering ? '注册并进入' : '登录'}</button>
      <button type="button" className="w-full text-center text-sm text-stone-400 underline hover:text-amber-100" disabled={pending}
        onClick={() => { setMode(registering ? 'login' : 'register'); setError(null); }}>
        {registering ? '已有账号？直接登录' : '还没有账号？注册一个'}
      </button>
    </form>
  </main>;
}
