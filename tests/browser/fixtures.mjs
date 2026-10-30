// 所有身份、素材和内容均为隔离合成数据，不读取环境配置或数据库。
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const original = {
  id:id(1),
  museumId:id(2),
  name:'合成测试旧物',
  era:'年代待考',
  slotIndex:0,
  modelKey:'photo-plane',
  caption:'测试展签',
  photoAssetId:id(3),
  audioAssetId:null,
  modelInput:{mode:'single',imageAssetId:id(3)},
  approximation:'测试',
  sourceNotice:'合成测试素材',
  rawStory:'测试讲述',
  transcript:null,
  sourceSegments:[],
  generatedModelAssetId:null,
  version:1,
  confirmedVersion:null,
  confirmationNote:null,
  confirmedAt:null,
  createdAt:'2026-10-25T00:00:00.000Z',
  updatedAt:'2026-10-25T00:00:00.000Z',
};
export const museum = {
  id:id(2),
  title:'合成测试馆',
  description:'',
  version:2,
  publishedVersion:null,
  shareEnabled:false,
  accessMode:'private',
  accessEpoch:null,
  regionCity:null,
  discoveryListed:false,
  createdAt:original.createdAt,
  updatedAt:original.updatedAt,
  exhibits:[original],
};
export const job = {
  id:id(4),
  exhibitId:id(1),
  status:'DONE',
  sourceVersion:1,
  errorCode:null,
  errorMessage:null,
  modelAssetId:id(5),
  stats:null,
  createdAt:original.createdAt,
};

const now = original.createdAt;
export function memoirFixture() {
  return {
    formatVersion:1,
    provenance:'synthetic_online_demo',
    exportedAt:now,
    memoir:{id:id(1),ownerId:id(2),museumId:null,title:'合成自传',version:1,createdAt:now,updatedAt:now},
    sourceVersion:1,
    sessions:[{id:id(3),memoirId:id(1),topic:{id:id(4),title:'测试话题',disposition:'open'},version:1,createdAt:now,updatedAt:now,state:'active',currentQuestionId:id(5)}],
    questions:[{id:id(5),sessionId:id(3),topicId:id(4),kind:'opening',text:'测试问题？',basedOnAnswerRevisionIds:[],createdAt:now}],
    answers:[{id:id(6),answerId:id(7),memoirId:id(1),sessionId:id(3),questionId:id(5),revision:1,kind:'interview',text:'已保存原文',createdAt:now}],
    chapters:[{id:id(8),memoirId:id(1),title:'测试章节',version:1,currentRevisionId:id(9),createdAt:now,updatedAt:now}],
    revisions:[{id:id(9),chapterId:id(8),version:1,sourceVersion:1,title:'测试章节',paragraphs:[{id:id(10),text:'已保存段落',sources:[{answerRevisionId:id(6),start:0,end:6}]}],derivedFromDraftId:null,createdAt:now}],
    drafts:[],
    confirmations:[],
    publications:[],
    aiOperations: [],
  };
}
export const contributionInbox = {
  invitations:[1,2].map(n=>({invitation:{id:id(n),exhibitId:id(n+10),museumId:id(20),inviteeId:id(30),inviteeName:'合成用户',status:'accepted',invitedAt:now,respondedAt:now,revokedAt:null,isDemo:false},exhibitName:`展品${n}`,museumTitle:'合成馆'})),
  contributions:[],
};
