'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginInputSchema, registerInputSchema, sessionUserSchema } from '../../contracts/session';
import { apiRequest, describeFailure, jsonRequest } from './api';

const AUTH_BG = 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=1100&q=70';

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
  return (
    <main className="grid min-h-screen bg-[#100D0A] text-[#F0E8DA] lg:grid-cols-[45fr_55fr]">
      {/* 左侧品牌面板：按已确认的设计稿保留 */}
      <aside className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <img src={AUTH_BG} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: 'sepia(.35) brightness(.52) contrast(1.06) saturate(.85)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(75deg, rgba(16,13,10,.92) 22%, rgba(16,13,10,.42) 70%, rgba(16,13,10,.3) 100%)' }} />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 140px 30px rgba(8,6,4,.72)' }} aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-3">
          <span className="grid h-11 w-11 flex-none rotate-[-2deg] grid-cols-2 grid-rows-2 gap-0.5 rounded-md bg-[#A62B2B] p-[5px] shadow-[inset_0_0_0_1.5px_rgba(243,236,225,.4),0_6px_14px_-6px_rgba(166,43,43,.7)]" aria-hidden="true">
            <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
            <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
          </span>
          <span className="flex flex-col leading-tight">
            <b className="font-serif text-xl font-semibold tracking-[.14em]">拾物馆</b>
            <span className="text-[10px] tracking-[.3em] text-[#B7A994]">MEMORIES MUSEUM</span>
          </span>
        </div>
        <p className="relative z-10 font-serif text-[26px] font-medium leading-[2] tracking-[.12em] lg:text-[30px]" style={{ textShadow: '0 2px 4px rgba(0,0,0,.6)' }}>
          旧物不语，<br />讲述让它被记住。
          <small className="mt-3 block text-[15px] tracking-[.3em] text-[#B7A994]">EVERY OBJECT REMEMBERS</small>
        </p>
        <p className="relative z-10 text-[12.5px] leading-[2.2] text-[#B7A994]">
          展馆内容只有本人能查看和修改<br />模型与演示内容均如实标注近似<br />发布、换链与停止分享由你操作
        </p>
        <div className="pointer-events-none absolute bottom-6 left-10 font-serif text-[#F3ECE1]/10" aria-hidden="true">
          <b className="block text-6xl font-semibold leading-none">03</b><span className="text-[11px] tracking-[.32em]">MEMBER</span>
        </div>
      </aside>

      {/* 右侧表单：独立作用域，仅改本区域视觉 */}
      <div className="mm-auth-form flex flex-col justify-center px-6 py-14 sm:px-12" style={{ background: 'radial-gradient(70% 50% at 85% 0%, rgba(200,165,107,.06), transparent 60%), #100D0A' }}>
        <div className="mx-auto w-full max-w-[420px] lg:mb-16">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid h-9 w-9 flex-none rotate-[-2deg] grid-cols-2 grid-rows-2 gap-0.5 rounded bg-[#A62B2B] p-1 shadow-[inset_0_0_0_1.5px_rgba(243,236,225,.4)]" aria-hidden="true">
              <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
              <i className="rounded-[2px] border border-[#F3ECE1]/55" /><i className="rounded-[2px] border border-[#F3ECE1]/55" />
            </span>
            <b className="font-serif text-lg tracking-[.14em]">拾物馆</b>
          </div>

          <div className="flex gap-7 border-b border-[#3A2D20]" role="tablist" aria-label="登录或注册">
            <button type="button" role="tab" aria-selected={!registering} onClick={() => setMode('login')}
              className={`-mb-px border-b-2 pb-3 font-serif text-[15px] tracking-[.16em] transition ${!registering ? 'border-[#C8A56B] text-[#F0E8DA]' : 'border-transparent text-[#B7A994] hover:text-[#F0E8DA]'}`}>登录</button>
            <button type="button" role="tab" aria-selected={registering} onClick={() => setMode('register')}
              className={`-mb-px border-b-2 pb-3 font-serif text-[15px] tracking-[.16em] transition ${registering ? 'border-[#C8A56B] text-[#F0E8DA]' : 'border-transparent text-[#B7A994] hover:text-[#F0E8DA]'}`}>注册</button>
          </div>

          <h1 className="mt-8 font-serif text-[34px] font-semibold leading-tight tracking-[.08em] lg:text-[38px]">{registering ? '注册拾物馆' : '欢迎回来'}</h1>
          <p className="mt-3 text-sm text-[#B7A994]">{registering ? '几分钟后，你的第一件旧物就能入柜。' : '登录后继续整理你的展馆。'}</p>

          <form onSubmit={submit} className="mt-2">
            <label className="mm-auth-field">用户名
              <input className="mm-auth-input" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} placeholder={registering ? '例如：lin-jiayi 或 阿澄' : '你的用户名'} />
              {registering && <span className="mm-auth-hint">2–40 个字符，可用文字、数字、下划线或连字符。</span>}
            </label>
            <label className="mm-auth-field">密码
              <input className="mm-auth-input" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} placeholder={registering ? '至少 8 位' : '输入密码'} />
            </label>
            {registering && <label className="mm-auth-field">确认密码
              <input className="mm-auth-input" type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={pending} placeholder="再输入一次" />
            </label>}
            {error && <p role="alert" className="mt-5 rounded-md border border-[#E08A7A]/45 bg-[#E08A7A]/10 px-4 py-2.5 text-sm leading-6 text-[#E08A7A]">{error}</p>}
            <button className="mm-auth-submit mt-8 w-full rounded-full bg-gradient-to-b from-[#E1C58E] to-[#C2A36B] py-3 text-[15px] font-medium tracking-[.14em] text-[#2B2014] shadow-[inset_0_1px_0_rgba(255,250,235,.5),0_10px_24px_-14px_rgba(200,165,107,.7)] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-50" disabled={pending}>
              {pending ? (registering ? '正在注册…' : '正在登录…') : registering ? '注册并进入' : '登录'}
            </button>
          </form>

          <p className="mt-6 border-t border-[#3A2D20] pt-5 text-sm leading-7 text-[#B7A994]">
            {registering ? '已有账号？' : '还没有账号？'}
            <button type="button" className="text-[#C8A56B] underline underline-offset-4 hover:text-[#E1C58E]" disabled={pending}
              onClick={() => { setMode(registering ? 'login' : 'register'); setError(null); }}>
              {registering ? '直接登录' : '注册一个'}
            </button>
          </p>
          <p className="mt-5 text-xs leading-6 text-[#7A6C5B]">
            连续失败会临时限制尝试。<br />凭参观链接拜访他人的展馆，同样需要先登录。
          </p>
          {registering && <p className="mt-4 text-xs leading-6 text-[#7A6C5B]">注册即表示你理解：上传前请确认拥有素材的使用权；第三方服务（如三维生成）仅在明确用途后使用你的照片。</p>}
          <Link href="/" className="mt-8 inline-block text-xs text-[#7A6C5B] underline underline-offset-4 hover:text-[#B7A994]">返回首页</Link>
        </div>
      </div>
    </main>
  );
}
