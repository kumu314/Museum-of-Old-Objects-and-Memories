import type {
  Hunyuan3DClient,
  HunyuanGenerationInput,
  HunyuanJob,
  HunyuanGlbStats,
} from '../hunyuan3d/types';
import type { HunyuanResultUrlPolicy } from '../hunyuan3d/url-policy';

export const HUNYUAN_PROXY_DEFAULT_TIMEOUT_MS = 30_000;
export const HUNYUAN_PROXY_DEFAULT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const HUNYUAN_PROXY_DEFAULT_MODEL_VERSION = 'v3.1';
export const HUNYUAN_PROXY_DEFAULT_FACE_COUNT = 500_000;

export type HunyuanProxyModelVersion = 'v3.0' | 'v3.1' | 'v3.5-preview' | 'v3.5';

export type HunyuanProxyConfig = {
  /** 反代服务地址，例如 http://127.0.0.1:8812。默认只绑定本机，不能对公网开放。 */
  baseUrl: string;
  /** 持久化抢占纹理提交；false 表示已有提交或结果未知，禁止重复付费。 */
  claimTextureSubmission?: (geometryId: string) => Promise<boolean>;
  /** 保存已受理或查询恢复的纹理任务号。 */
  recordTextureSubmission?: (geometryId: string, textureId: string) => Promise<void>;
  timeoutMs?: number;
  maxDownloadBytes?: number;
  /** concept 管线的几何模型版本，默认 v3.1。 */
  modelVersion?: HunyuanProxyModelVersion;
  faceCount?: number;
  /**
   * 覆盖结果/上传地址的内置腾讯 COS 校验。仅限测试注入本地假服务；
   * 生产必须保持默认策略。
   */
  cosHostPolicy?: (url: URL) => void;
  resultUrlPolicy?: HunyuanResultUrlPolicy | undefined;
};

export type HunyuanProxyClient = Hunyuan3DClient & {
  /** concept 积分池余量（对应验收 B12 的额度来源）。 */
  remainingTimes(): Promise<number | undefined>;
};

export type { HunyuanGenerationInput, HunyuanJob, HunyuanGlbStats };
