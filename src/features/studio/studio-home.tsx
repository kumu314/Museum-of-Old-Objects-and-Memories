'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { createMuseumInputSchema, museumDraftSchema, museumSummarySchema, type MuseumSummary } from '../../contracts/museum';
import { teamMemberSchema, type TeamMember } from '../../contracts/session';
import { ApiFailure, apiRequest, describeFailure, jsonRequest } from './api';
import { buttonClass, Field, inputClass, Notice, panelClass, primaryClass } from './ui';

export function StudioHome() {
  const router = useRouter();
  const [member, setMember] = useState<TeamMember | null>(null);
  const [museums, setMuseums] = useState<MuseumSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest('/api/auth/session', teamMemberSchema, { signal: controller.signal }),
      apiRequest('/api/museums', z.array(museumSummarySchema), { signal: controller.signal }),
    ]).then(([session, data]) => { setMember(session); setMuseums(data); setLoaded(true); setError(null); })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.failure.code === 'UNAUTHORIZED') router.replace('/login');
        else setError(describeFailure(failure));
      });
    return () => controller.abort();
  }, [reload, router]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const museum = await apiRequest('/api/museums', museumDraftSchema, jsonRequest('POST', createMuseumInputSchema.parse({ title, description })));
      router.push(`/studio/${museum.id}`);
    } catch (failure) { setError(describeFailure(failure)); }
    finally { setPending(false); }
  }
  async function logout() {
    if ((title || description) && !window.confirm('新展馆信息尚未保存，仍要退出登录吗？')) return;
    setPending(true); setError(null);
    try { await apiRequest('/api/auth/logout', z.strictObject({ ok: z.literal(true) }), { method: 'POST' }); router.replace('/login'); }
    catch (failure) { setError(describeFailure(failure)); }
    finally { setPending(false); }
  }
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-10">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-700 pb-7">
      <div><Link href="/" className="font-serif text-3xl text-amber-100">拾物馆</Link><h1 className="mt-2 text-sm text-stone-400">团队制作工作台</h1></div>
      {member && <div className="flex items-center gap-4 text-sm"><span className="text-stone-400">{member.username}</span><button className={buttonClass} disabled={pending} onClick={logout}>退出登录</button></div>}
    </header>
    <Notice error={error} />
    {!loaded ? <div className="py-12"><p className="text-stone-400">{error ? '未能读取工作台。' : '正在读取工作台…'}</p>{error && <button className={`${buttonClass} mt-4`} onClick={() => setReload((value) => value + 1)}>重新读取</button>}</div> : <div className="mt-9 grid gap-9 lg:grid-cols-[1fr_340px]">
      <section><h2 className="mb-5 text-xl">正在制作的展馆</h2>{museums.length === 0 && <p className="py-8 text-stone-400">还没有展馆。从右侧创建一个纪念展。</p>}
        <ul className="grid gap-4 sm:grid-cols-2">{museums.map((museum) => <li key={museum.id}><a href={`/studio/${museum.id}`} className={`${panelClass} block h-full transition hover:border-amber-100/50`}>
          <span className="text-xs text-amber-100/60">{museum.shareEnabled ? '分享已启用' : '内部草稿'}</span><h3 className="mt-3 text-xl">{museum.title}</h3><p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-400">{museum.description || '尚未填写展馆简介'}</p><p className="mt-5 text-xs text-stone-500">草稿版本 {museum.version}{museum.publishedVersion !== null ? ` · 已发布版本 ${museum.publishedVersion}` : ' · 尚未发布'}</p>
        </a></li>)}</ul>
      </section>
      <form onSubmit={create} className={`${panelClass} h-fit space-y-5`}><h2 className="text-xl">创建展馆</h2><Field label="展馆名称"><input className={inputClass} required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} /></Field><Field label="展馆简介"><textarea className={inputClass} rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending} /></Field><button className={primaryClass} disabled={pending}>{pending ? '正在创建…' : '创建并收录旧物'}</button></form>
    </div>}
  </main>;
}
