import {
  commentIsHidden, deletedCommentStatus, moderatedCommentStatus, managedCommentSchema,
  createCommentInputSchema, discoveryDemoActionSchema, discoveryDemoStateSchema, discoveryMuseumSchema, publicCommentSchema,
  type DiscoveryDemoAction, type DiscoveryDemoMuseum, type DiscoveryDemoState, type DiscoveryMuseum, type PublicComment,
} from '../../contracts';
import { DemoRuleError } from '../direction1/demo-error';

const id = (n: number) => `20000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const now = '2026-10-24T00:00:00.000Z';
export const discoveryDemoActors = [
  { userId: id(1), nickname: 'DEMO · 木盒收藏者' },
  { userId: id(2), nickname: 'DEMO · 车站拾忆人' },
  { userId: id(3), nickname: 'DEMO · 参观者' },
] as const;
export function createDiscoveryDemo(): DiscoveryDemoState {
  const museums = [
    { number: 10, owner: discoveryDemoActors[0], title: '木盒里的四季', description: '几件虚构旧物，一些留待慢慢讲述的日常。', tags: ['日常', '木盒'], exhibitNames: ['旧相机', '搪瓷杯'], mode: 'discoverable' },
    { number: 11, owner: discoveryDemoActors[1], title: '沿途的车票', description: '一座关于合成旅行记忆的小馆，不对应真实人物。', tags: ['旅行', '车票'], exhibitNames: ['纸车票', '旧背包'], mode: 'discoverable' },
    { number: 12, owner: discoveryDemoActors[2], title: '留声的房间', description: 'DEMO 中的一座声音小馆，每个虚构账号只拥有一座馆。', tags: ['声音', '磁带'], exhibitNames: ['磁带机'], mode: 'discoverable' },
    { number: 13, owner: { userId: id(4), nickname: 'DEMO · 私密馆主' }, title: '私密测试标题', description: '不应被发现或搜索。', tags: ['私密哨兵'], exhibitNames: ['私密旧物'], mode: 'private' },
    { number: 14, owner: { userId: id(5), nickname: 'DEMO · 链接馆主' }, title: '持链接测试标题', description: '不应被发现或搜索。', tags: ['链接哨兵'], exhibitNames: ['链接旧物'], mode: 'link_only' },
  ].map((fixture) => ({
    published: { museumId: id(fixture.number), accessEpoch: id(fixture.number + 100), owner: fixture.owner,
      title: fixture.title, description: fixture.description, tags: fixture.tags, exhibitNames: fixture.exhibitNames,
      publishedAt: now, favoriteCount: 0, isFollowing: false, isFavorited: false },
    accessMode: fixture.mode, draftTitle: '未发布修改哨兵', draftTags: ['未发布标签哨兵'],
    settings: { museumId: id(fixture.number), mode: 'open', version: 1 }, bannedUserIds: [],
    comments: fixture.number === 10 ? [
      { id: id(50), museumId: id(10), author: discoveryDemoActors[2], rootId: null, replyToId: null, version: 1,
        createdAt: now, status: 'visible', body: '【合成留言】这只杯子的颜色让我想多看一眼。' },
      { id: id(51), museumId: id(10), author: discoveryDemoActors[0], rootId: id(50), replyToId: id(50), version: 1,
        createdAt: now, status: 'visible', body: '【合成回复】欢迎参观这个演示小馆。' },
    ] : [],
  }));
  return discoveryDemoStateSchema.parse({ provenance: 'demo', generation: 'fixture', data: {
    viewer: discoveryDemoActors[2], museums, follows: [], favorites: [],
  } });
}
export function visibleDemoMuseums(state: DiscoveryDemoState, query = '', followingOnly = false): DiscoveryMuseum[] {
  const { viewer, follows, favorites } = state.data;
  const following = new Set(follows.filter((relation) => relation.followerId === viewer.userId).map((relation) => relation.followedUserId));
  const search = query.trim().toLocaleLowerCase();
  return state.data.museums.filter((museum) => museum.accessMode === 'discoverable')
    .filter((museum) => !followingOnly || following.has(museum.published.owner.userId))
    .filter(({ published }) => !search || [published.owner.nickname, published.title, ...published.tags, ...published.exhibitNames]
      .some((field) => field.toLocaleLowerCase().includes(search)))
    .map(({ published }) => discoveryMuseumSchema.parse({ ...published,
      isFollowing: following.has(published.owner.userId),
      isFavorited: favorites.some((relation) => relation.userId === viewer.userId && relation.museumId === published.museumId),
      favoriteCount: favorites.filter((relation) => relation.museumId === published.museumId).length,
    }));
}
export function visibleDemoComments(museum: DiscoveryDemoMuseum): PublicComment[] {
  const hiddenRoots = new Set(museum.comments.filter((comment) => comment.rootId === null && commentIsHidden(comment.status)).map(({ id }) => id));
  return museum.comments.filter((comment) => !commentIsHidden(comment.status) && !hiddenRoots.has(comment.rootId ?? comment.id))
    .map((comment) => publicCommentSchema.parse(comment));
}
function requireMuseum(state: DiscoveryDemoState, museumId: string, accessEpoch?: string) {
  const museum = state.data.museums.find((item) => item.published.museumId === museumId && item.accessMode === 'discoverable'
    && (accessEpoch === undefined || item.published.accessEpoch === accessEpoch));
  if (!museum) throw new DemoRuleError('NOT_FOUND', '此演示入口已失效或不可访问。');
  return museum;
}
function requireOwner(state: DiscoveryDemoState, museum: DiscoveryDemoMuseum) {
  if (museum.published.owner.userId !== state.data.viewer.userId) throw new DemoRuleError('FORBIDDEN', '只有此馆的演示馆主可以管理。');
}
export function applyDiscoveryDemo(original: DiscoveryDemoState, rawAction: DiscoveryDemoAction,
  runtime = { newId: () => crypto.randomUUID(), now: () => new Date().toISOString() }): DiscoveryDemoState {
  const action = discoveryDemoActionSchema.parse(rawAction);
  const state = structuredClone(original);
  const { viewer } = state.data;
  if (action.type === 'switch_actor') {
    const actor = discoveryDemoActors.find((item) => item.userId === action.userId);
    if (!actor) throw new DemoRuleError('FORBIDDEN', '只能切换到内置虚构身份。');
    state.data.viewer = actor;
  } else if (action.type === 'follow') {
    if (viewer.userId === action.userId) throw new DemoRuleError('VALIDATION_ERROR', '不能关注自己的账号。');
    if (action.following && !visibleDemoMuseums(state).some((museum) => museum.owner.userId === action.userId)) throw new DemoRuleError('NOT_FOUND', '当前没有此账号可发现的展馆。');
    state.data.follows = state.data.follows.filter((relation) => !(relation.followerId === viewer.userId && relation.followedUserId === action.userId));
    if (action.following) state.data.follows.push({ followerId: viewer.userId, followedUserId: action.userId });
  } else {
    // Only an owner can find their hidden synthetic museum in the demo controls.
    const museum = action.type === 'access'
      ? state.data.museums.find((item) => item.published.museumId === action.museumId && item.published.owner.userId === viewer.userId)
      : requireMuseum(state, action.museumId, action.type === 'comment' ? action.accessEpoch : undefined);
    if (!museum) throw new DemoRuleError('NOT_FOUND', '此演示入口已失效或不可访问。');
    if (action.type === 'favorite') {
      if (museum.published.owner.userId === viewer.userId) throw new DemoRuleError('VALIDATION_ERROR', '不能收藏自己的展馆。');
      state.data.favorites = state.data.favorites.filter((relation) => !(relation.userId === viewer.userId && relation.museumId === action.museumId));
      if (action.favorited) state.data.favorites.push({ userId: viewer.userId, museumId: action.museumId });
    } else if (action.type === 'comment') {
      const input = createCommentInputSchema.parse({ operationId: runtime.newId(), accessEpoch: action.accessEpoch,
        rootId: action.rootId, replyToId: action.replyToId, body: action.body });
      if (museum.settings.mode === 'closed') throw new DemoRuleError('COMMENTS_CLOSED', '此演示馆已关闭新增留言，仍可删除自己的留言。');
      if (museum.bannedUserIds.includes(viewer.userId)) throw new DemoRuleError('COMMENTING_BLOCKED', '此演示身份已被本馆禁评，仍可继续参观。');
      if (input.rootId !== null) {
        const visible = visibleDemoComments(museum);
        const root = visible.find((item) => item.id === input.rootId && item.rootId === null);
        const target = visible.find((item) => item.id === input.replyToId && (item.id === input.rootId || item.rootId === input.rootId));
        if (!root || !target) throw new DemoRuleError('THREAD_UNAVAILABLE', '目标线程已变更或不属于本馆，留言文字仍保留。');
      }
      museum.comments.push({ id: runtime.newId(), museumId: action.museumId, author: viewer, rootId: input.rootId,
        replyToId: input.replyToId, version: 1, createdAt: runtime.now(), status: 'visible', body: input.body });
    } else if (action.type === 'access') {
      requireOwner(state, museum);
      museum.accessMode = action.accessMode;
      museum.published.accessEpoch = runtime.newId();
    } else if (action.type === 'comment_mode') {
      requireOwner(state, museum);
      if (museum.settings.version !== action.expectedVersion) throw new DemoRuleError('VERSION_CONFLICT', '留言设置已变化，请核对当前状态。');
      museum.settings = { ...museum.settings, mode: action.mode, version: museum.settings.version + 1 };
    } else {
      const index = museum.comments.findIndex((item) => item.id === action.commentId);
      const comment = museum.comments[index];
      if (!comment) throw new DemoRuleError('NOT_FOUND', '此演示留言不可用。');
      if (action.type === 'delete_comment') {
        if (comment.author.userId !== viewer.userId) throw new DemoRuleError('FORBIDDEN', '只能删除自己的演示留言。');
        if (comment.version !== action.expectedVersion) throw new DemoRuleError('VERSION_CONFLICT', '留言版本已变化，请核对。');
        museum.comments[index] = { id: comment.id, museumId: comment.museumId, author: comment.author, rootId: comment.rootId,
          replyToId: comment.replyToId, version: comment.version + 1, createdAt: comment.createdAt, status: deletedCommentStatus(comment.status) };
      } else if (action.type === 'moderate_comment') {
        requireOwner(state, museum);
        if (comment.version !== action.expectedVersion) throw new DemoRuleError('VERSION_CONFLICT', '留言版本已变化，请核对。');
        museum.comments[index] = managedCommentSchema.parse({ ...comment,
          status: moderatedCommentStatus(comment.status, action.status === 'hidden'), version: comment.version + 1 });
      } else if (action.type === 'ban') {
        requireOwner(state, museum);
        museum.bannedUserIds = museum.bannedUserIds.filter((userId) => userId !== comment.author.userId);
        if (action.banned) museum.bannedUserIds.push(comment.author.userId);
      }
    }
  }
  return discoveryDemoStateSchema.parse(state);
}
