export const HUNYUAN_3D_ENDPOINT = 'https://ai3d.tencentcloudapi.com/';
export const HUNYUAN_3D_VERSION = '2025-05-13';
export const HUNYUAN_IMAGE_MIN_PX = 128;
export const HUNYUAN_IMAGE_MAX_PX = 5_000;
export const HUNYUAN_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

export type Hunyuan3DErrorCode =
  | 'CONFIG_INVALID'
  | 'INPUT_INVALID'
  | 'UPSTREAM_ERROR'
  | 'JOB_FAILED'
  | 'RESULT_MISSING'
  | 'DOWNLOAD_FAILED'
  | 'INVALID_GLB'
  | 'TIMEOUT';

export type HunyuanImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type HunyuanGenerationInput = {
  image: {
    bytes: Uint8Array;
    mime: HunyuanImageMime;
    width: number;
    height: number;
  };
  generateType?: 'Normal' | 'LowPoly' | 'Geometry' | 'Sketch';
  enablePbr?: boolean;
  faceCount?: number;
  model?: '3.0' | '3.1';
};

export type HunyuanJobStatus = 'WAIT' | 'RUN' | 'FAIL' | 'DONE';

export type HunyuanFile = {
  type: string;
  url: string;
  previewImageUrl?: string;
};

export type HunyuanJob = {
  jobId: string;
  status: HunyuanJobStatus;
  errorCode?: string;
  errorMessage?: string;
  files: HunyuanFile[];
  creditsConsumed?: number;
};

export type HunyuanGlbStats = {
  byteLength: number;
  meshCount: number;
  materialCount: number;
  imageCount: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
};

export type Hunyuan3DConfig = {
  secretId: string;
  secretKey: string;
  region: string;
  /** Must remain the official endpoint outside tests. */
  endpoint?: string;
  model?: '3.0' | '3.1';
  timeoutMs?: number;
  maxDownloadBytes?: number;
};

export type Hunyuan3DClient = {
  submitImage(input: HunyuanGenerationInput): Promise<{ jobId: string; requestId?: string }>;
  queryJob(jobId: string): Promise<HunyuanJob>;
  downloadGlb(file: HunyuanFile): Promise<{ bytes: Uint8Array; stats: HunyuanGlbStats }>;
};
