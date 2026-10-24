import {
  memoirAiInputSchema, memoirChapterOutputForSourcesSchema, memoirDemoActionSchema, memoirDemoStateSchema,
  memoirParagraphsForSourcesSchema, publicMemoirChapterSchema, memoirOpeningTopics,
  type InterviewSession, type MemoirAnswerRevision, type MemoirDemoAction, type MemoirDemoState, type MemoirDemoWorkspace,
} from '../../contracts';
import { DemoRuleError } from '../direction1/demo-error';

const fixtureId = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const fixtureDate = '2026-10-24T00:00:00.000Z';
export const memoirDemoTopics = [
  { id: fixtureId(10), ...memoirOpeningTopics.childhood },
  { id: fixtureId(11), ...memoirOpeningTopics.school },
  { id: fixtureId(12), ...memoirOpeningTopics.work },
  { id: fixtureId(13), ...memoirOpeningTopics.legacy },
] as const;

export function createMemoirDemo(): MemoirDemoState {
  const sessions = memoirDemoTopics.map((topic, index) => ({
    id: fixtureId(20 + index), memoirId: fixtureId(1), topic: { id: topic.id, title: topic.title, disposition: 'open' },
    state: index === 0 ? 'active' : 'paused', currentQuestionId: fixtureId(30 + index), version: 1,
    createdAt: fixtureDate, updatedAt: fixtureDate,
  }));
  return memoirDemoStateSchema.parse({ provenance: 'demo', generation: 'fixture', data: {
    state: 'ready', workspace: {
      memoir: { id: fixtureId(1), ownerId: fixtureId(2), museumId: null, title: 'DEMO · 一段虚构的生活记忆', version: 1,
        createdAt: fixtureDate, updatedAt: fixtureDate },
      sourceVersion: 1, currentSessionId: fixtureId(20), sessions,
      questions: memoirDemoTopics.map((topic, index) => ({ id: fixtureId(30 + index), sessionId: fixtureId(20 + index),
        topicId: topic.id, kind: 'opening', text: topic.question, basedOnAnswerRevisionIds: [], createdAt: fixtureDate })),
      answers: [{ id: fixtureId(40), answerId: fixtureId(41), memoirId: fixtureId(1), sessionId: fixtureId(20), questionId: fixtureId(30),
        revision: 1, kind: 'interview', text: '【合成回答】我记得门口有一棵树，可能是桂花树，具体年份已经记不清。', createdAt: fixtureDate }],
      chapter: { id: fixtureId(3), memoirId: fixtureId(1), title: '尚未整理的章节', version: 1, currentRevisionId: null,
        createdAt: fixtureDate, updatedAt: fixtureDate },
      drafts: [], revisions: [], confirmations: [], publications: [], interviewQuotaRemaining: 3,
    },
  } });
}

export function currentDemoSession(workspace: MemoirDemoWorkspace): InterviewSession {
  const session = workspace.sessions.find(({ id }) => id === workspace.currentSessionId);
  if (!session) throw new DemoRuleError('INTERVIEW_STATE_CONFLICT', '当前访谈不存在，请重置演示。');
  return session;
}
export function latestDemoAnswers(workspace: MemoirDemoWorkspace): MemoirAnswerRevision[] {
  const answers = new Map<string, MemoirAnswerRevision>();
  for (const answer of workspace.answers) {
    const previous = answers.get(answer.answerId);
    if (!previous || answer.revision > previous.revision) answers.set(answer.answerId, answer);
  }
  return [...answers.values()];
}
function requireActive(session: InterviewSession) {
  if (session.state !== 'active' || session.topic.disposition !== 'open') {
    throw new DemoRuleError('INTERVIEW_STATE_CONFLICT', '当前话题已暂停或结束，请先选择可继续的话题。');
  }
}
export function currentDemoConfirmation(workspace: MemoirDemoWorkspace) {
  return workspace.confirmations.findLast((confirmation) => confirmation.revisionId === workspace.chapter.currentRevisionId
    && confirmation.sourceVersion === workspace.sourceVersion);
}

export function applyMemoirDemo(
  original: MemoirDemoState, rawAction: MemoirDemoAction,
  runtime = { newId: () => crypto.randomUUID(), now: () => new Date().toISOString() },
): MemoirDemoState {
  const action = memoirDemoActionSchema.parse(rawAction);
  if (original.data.state === 'deleted') throw new DemoRuleError('NOT_FOUND', '演示自传已删除，旧操作不能恢复资料。');
  if (original.data.workspace.memoir.version !== action.expectedVersion) {
    throw new DemoRuleError('VERSION_CONFLICT', '演示内容已变更，请核对当前版本；输入仍保留。');
  }
  const now = runtime.now();
  if (action.type === 'delete_memoir') return memoirDemoStateSchema.parse({
    provenance: 'demo', generation: 'fixture', data: { state: 'deleted', deletedAt: now },
  });
  const workspace = structuredClone(original.data.workspace);
  const session = currentDemoSession(workspace);
  const replaceSession = (next: InterviewSession) => {
    workspace.sessions = workspace.sessions.map((item) => item.id === next.id ? next : item);
  };
  if (action.type === 'save_answer') {
    requireActive(session);
    const previous = latestDemoAnswers(workspace).find((answer) => answer.questionId === session.currentQuestionId);
    workspace.answers.push({ id: runtime.newId(), answerId: previous?.answerId ?? runtime.newId(),
      memoirId: workspace.memoir.id, sessionId: session.id, questionId: session.currentQuestionId,
      revision: (previous?.revision ?? 0) + 1, kind: 'interview', text: action.text, createdAt: now });
    workspace.sourceVersion += 1;
  } else if (action.type === 'followup_fixture') {
    requireActive(session);
    if (workspace.interviewQuotaRemaining === 0) throw new DemoRuleError('INTERVIEW_QUOTA_EXHAUSTED', '演示深访额度已用完；仍可保存、整理、编辑及导出。');
    const answer = latestDemoAnswers(workspace).find((item) => item.questionId === session.currentQuestionId);
    if (!answer) throw new DemoRuleError('VALIDATION_ERROR', '请先保存当前回答，再请求一个演示追问。');
    const questionId = runtime.newId();
    workspace.questions.push({ id: questionId, sessionId: session.id, topicId: session.topic.id, kind: 'followup',
      text: '关于你刚才主动提供的内容，还有哪一处是你愿意补充的？', basedOnAnswerRevisionIds: [answer.id], createdAt: now });
    replaceSession({ ...session, state: 'active', currentQuestionId: questionId, version: session.version + 1, updatedAt: now });
    workspace.interviewQuotaRemaining -= 1;
  } else if (action.type === 'pause') {
    requireActive(session);
    replaceSession({ ...session, state: 'paused', version: session.version + 1, updatedAt: now });
  } else if (action.type === 'resume') {
    if (session.state !== 'paused' || session.topic.disposition !== 'open' || session.currentQuestionId === null) {
      throw new DemoRuleError('INTERVIEW_STATE_CONFLICT', '已跳过、拒绝或结束的话题不会自动恢复追问。');
    }
    replaceSession({ ...session, state: 'active', currentQuestionId: session.currentQuestionId, version: session.version + 1, updatedAt: now });
  } else if (action.type === 'skip' || action.type === 'refuse' || action.type === 'next') {
    requireActive(session);
    replaceSession({ ...session, state: 'completed', currentQuestionId: null,
      topic: { ...session.topic, disposition: action.type === 'refuse' ? 'refused' : action.type === 'skip' ? 'skipped' : 'completed' },
      version: session.version + 1, updatedAt: now });
  } else if (action.type === 'select_topic') {
    const topic = memoirDemoTopics[action.topicIndex];
    const next = workspace.sessions.find((item) => item.topic.id === topic?.id);
    if (!next || next.topic.disposition !== 'open' || next.currentQuestionId === null) {
      throw new DemoRuleError('INTERVIEW_STATE_CONFLICT', '已拒绝、跳过或完成的话题不会重新排入访谈。');
    }
    if (session.id !== next.id && session.state === 'active') replaceSession({ ...session, state: 'paused', version: session.version + 1, updatedAt: now });
    replaceSession({ ...next, state: 'active', currentQuestionId: next.currentQuestionId, version: next.version + 1, updatedAt: now });
    workspace.currentSessionId = next.id;
  } else if (action.type === 'chapter_fixture') {
    if (action.sourceVersion !== workspace.sourceVersion) throw new DemoRuleError('VERSION_CONFLICT', '回答来源已经变化，请重新选择来源。');
    const input = memoirAiInputSchema.parse({ memoirId: workspace.memoir.id, sourceVersion: workspace.sourceVersion, sources: latestDemoAnswers(workspace) });
    const paragraphs = input.sources.flatMap((answer) => {
      const points = Array.from(answer.text);
      return Array.from({ length: Math.ceil(points.length / 1_000) }, (_, index) => {
        const start = index * 1_000;
        const end = Math.min(points.length, start + 1_000);
        return { id: runtime.newId(), text: points.slice(start, end).join(''), sources: [{ answerRevisionId: answer.id, start, end }] };
      });
    });
    const output = memoirChapterOutputForSourcesSchema(input).parse({ title: `${session.topic.title} · 演示原文摘录`, paragraphs });
    workspace.drafts.push({ id: runtime.newId(), memoirId: workspace.memoir.id, chapterId: workspace.chapter.id,
      sourceVersion: workspace.sourceVersion, generation: 'fixture', aiOperationId: null, output, createdAt: now });
  } else if (action.type === 'save_chapter') {
    if (action.sourceVersion !== workspace.sourceVersion) throw new DemoRuleError('VERSION_CONFLICT', '章节来源已变化，请先核对回答；编辑内容仍保留。');
    const input = memoirAiInputSchema.parse({ memoirId: workspace.memoir.id, sourceVersion: workspace.sourceVersion, sources: latestDemoAnswers(workspace) });
    memoirParagraphsForSourcesSchema(input).parse(action.paragraphs);
    if (action.derivedFromDraftId !== null && !workspace.drafts.some((draft) => draft.id === action.derivedFromDraftId
      && draft.sourceVersion === workspace.sourceVersion)) throw new DemoRuleError('VERSION_CONFLICT', '所选样例草稿已过期，请重新整理并核对。');
    const revisionId = runtime.newId();
    workspace.revisions.push({ id: revisionId, chapterId: workspace.chapter.id, version: workspace.chapter.version + 1,
      sourceVersion: workspace.sourceVersion, title: action.title, paragraphs: action.paragraphs,
      derivedFromDraftId: action.derivedFromDraftId, createdAt: now });
    workspace.chapter = { ...workspace.chapter, title: action.title, version: workspace.chapter.version + 1, currentRevisionId: revisionId, updatedAt: now };
  } else if (action.type === 'confirm_chapter') {
    const revision = workspace.revisions.find((item) => item.id === workspace.chapter.currentRevisionId);
    if (!revision || revision.id !== action.revisionId || revision.sourceVersion !== workspace.sourceVersion) {
      throw new DemoRuleError('VERSION_CONFLICT', '只能确认当前编辑稿及当前来源，请先核对或保存新稿。');
    }
    if (!currentDemoConfirmation(workspace)) workspace.confirmations.push({ id: runtime.newId(), chapterId: workspace.chapter.id,
      revisionId: revision.id, sourceVersion: workspace.sourceVersion, confirmedBy: workspace.memoir.ownerId, confirmedAt: now });
  } else if (action.type === 'publish_chapter') {
    const confirmation = currentDemoConfirmation(workspace);
    const revision = workspace.revisions.find((item) => item.id === workspace.chapter.currentRevisionId);
    if (!confirmation || confirmation.id !== action.confirmationId || !revision) throw new DemoRuleError('MEMOIR_NOT_CONFIRMED', '请先核对并确认当前章节，再单独授权公开。');
    if (workspace.publications.some((item) => item.confirmationId === confirmation.id && item.revokedAt === null)) return original;
    workspace.publications = workspace.publications.map((item) => item.revokedAt === null ? { ...item, revokedAt: now } : item);
    const publicationId = runtime.newId();
    workspace.publications.push({ id: publicationId, chapterId: workspace.chapter.id, confirmedRevisionId: revision.id,
      confirmationId: confirmation.id, consentVersion: workspace.chapter.version, privacyAcknowledgedAt: now, grantedAt: now, revokedAt: null,
      publicData: publicMemoirChapterSchema.parse({ publicationId, chapterId: workspace.chapter.id, title: revision.title,
        paragraphs: revision.paragraphs.map(({ text }) => text), publishedAt: now }) });
  } else if (action.type === 'revoke_chapter') {
    workspace.publications = workspace.publications.map((item) => item.revokedAt === null ? { ...item, revokedAt: now } : item);
  } else if (action.type === 'exhaust_demo_quota') {
    workspace.interviewQuotaRemaining = 0;
  }
  workspace.memoir = { ...workspace.memoir, version: workspace.memoir.version + 1, updatedAt: now };
  return memoirDemoStateSchema.parse({ provenance: 'demo', generation: 'fixture', data: { state: 'ready', workspace } });
}

export function exportMemoirDemo(state: MemoirDemoState, format: 'markdown' | 'json'): string {
  if (state.data.state !== 'ready') throw new DemoRuleError('NOT_FOUND', '演示自传已删除，无法导出。');
  if (format === 'json') return JSON.stringify(state, null, 2);
  const workspace = state.data.workspace;
  const literal = (text: string) => {
    const longestRun = Math.max(2, ...[...text.matchAll(/~+/gu)].map(([run]) => run.length));
    const fence = '~'.repeat(longestRun + 1);
    return `${fence}text\n${text}\n${fence}`;
  };
  return ['# DEMO 自传导出', '> 合成资料；非实时 AI；仅来自当前浏览器标签页。JSON 包保留完整来源关系。',
    '## 原始回答与修订', ...workspace.answers.map((answer) => `### 回答 ${answer.id} / 修订 ${answer.revision}\n${literal(answer.text)}`),
    '## 样例草稿（未确认）', ...workspace.drafts.map((draft) => `### ${draft.output.title}\n${literal(JSON.stringify(draft.output, null, 2))}`),
    '## 用户编辑版本', ...workspace.revisions.map((revision) => `### ${revision.title} / 版本 ${revision.version}\n${literal(JSON.stringify(revision, null, 2))}`),
    '## 确认记录', literal(JSON.stringify(workspace.confirmations, null, 2)),
    '## 逐章公开许可及撤销记录', literal(JSON.stringify(workspace.publications, null, 2)),
  ].join('\n\n');
}
