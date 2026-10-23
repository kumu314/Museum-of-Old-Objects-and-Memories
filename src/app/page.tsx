/**
 * 工程骨架的占位页，不是产品页面。
 * 参观界面与工作台分别由 B、A 在自己的分支实现后替换本文件。
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">拾物馆</h1>
      <p className="text-stone-600">
        工程骨架已就位，产品功能尚未实现。这一页只用于确认开发、构建与检查链路可用。
      </p>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-stone-500">当前阶段</dt>
        <dd>G0 工程初始化</dd>
        <dt className="text-stone-500">框架</dt>
        <dd>Next.js 16 App Router · React 19.3 · TypeScript 5.9</dd>
        <dt className="text-stone-500">数据</dt>
        <dd>PostgreSQL（连接与迁移待在各自环境验证）</dd>
      </dl>
    </main>
  );
}
