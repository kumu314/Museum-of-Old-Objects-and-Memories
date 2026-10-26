export const modelManifest = {
  'camera-01': {
    displayName: '复古相机', eraLabel: '年代待考',
    modelKey: 'camera-01', kind: 'glb',
    path: new URL('./assets/camera-01.glb', import.meta.url).href,
    version: 'polyhaven-camera-01-1k-no-strap-1',
    source: 'https://polyhaven.com/a/Camera_01', license: 'CC0-1.0',
    approximation: '公开演示资产，非海鸥双反相机，非物主藏品复原', thumbnail: null,
  },
  cassette: {
    displayName: '手录磁带', eraLabel: '年代待考',
    modelKey: 'cassette', kind: 'glb',
    path: new URL('./assets/cassette.glb', import.meta.url).href,
    version: 'authored-cassette-2', source: '项目自建模型，依据用户参考图重绘标签',
    license: '本项目演示用途；未引入第三方模型', approximation: '完整外壳、双面标签与卷轴模型；内部机械为示意，非实物精确复原', thumbnail: null,
  },
  ticket: {
    displayName: '旧车票', eraLabel: '年代待考',
    modelKey: 'ticket', kind: 'glb',
    path: new URL('./assets/ticket.glb', import.meta.url).href,
    version: 'authored-paper-ticket-2', source: '项目自建纸张模型，依据用户参考图重绘票面',
    license: '本项目演示用途；未引入第三方模型', approximation: '双面弯曲纸张、折痕及连续厚度；未提供背面保持空白示意，非实物精确复原', thumbnail: null,
  },
} as const;
export type CabinetModelKey = keyof typeof modelManifest;
