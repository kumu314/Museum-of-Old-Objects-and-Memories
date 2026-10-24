'use client';

import { Brand } from '../navigation/brand';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from '../navigation/navigation-link';
import { z } from 'zod';
import { createMuseumInputSchema, museumDraftSchema } from '../../contracts/museum';
import { ApiFailure, apiRequest, describeFailure, jsonRequest } from './api';
import { Field, Notice } from './ui';
import './workbench.css';

export function StudioHome({ username }: { username: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const museum = await apiRequest('/api/museums', museumDraftSchema, jsonRequest('POST', createMuseumInputSchema.parse({ title, description })));
      router.replace(`/studio/${museum.id}`);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.failure.code === 'MUSEUM_EXISTS') router.replace('/studio');
      else setError(describeFailure(failure));
    } finally { setPending(false); }
  }
  async function logout() {
    if ((title || description) && !window.confirm('展馆信息尚未保存，仍要退出登录吗？')) return;
    setPending(true); setError(null);
    try { await apiRequest('/api/auth/logout', z.strictObject({ ok: z.literal(true) }), { method: 'POST' }); router.replace('/login'); }
    catch (failure) { setError(describeFailure(failure)); }
    finally { setPending(false); }
  }
  return <main className="memory-workbench">
    <header className="workbench-brandbar"><Link href="/" className="workbench-brand"><Brand /></Link><div className="wb-actions"><span>{username}</span><button className="wb-text-link" disabled={pending} onClick={logout}>退出登录</button></div></header>
    <section className="workbench-onboarding"><p className="workbench-eyebrow">我的展馆 · 开始收录</p><h1>给你们的回忆，取一个名字</h1><p className="wb-hint">每个账号拥有一座展馆，里面可以慢慢收录更多旧物。先填写馆名，再留下第一件旧物和它的故事。</p>
      <Notice error={error} /><form className="workbench-fields" onSubmit={create}>
        <Field label="展馆名称"><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} placeholder="例如：我们家的旧时光" /></Field>
        <Field label="展馆简介（可稍后填写）" hint="介绍整座展馆，会显示在馆名下方。每件旧物的回忆在收录时单独填写。"><textarea rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending} /></Field>
        <div><button className="wb-primary" disabled={pending}>{pending ? '正在保存…' : '保存馆名，收录第一件旧物'}</button></div>
      </form></section>
  </main>;
}
