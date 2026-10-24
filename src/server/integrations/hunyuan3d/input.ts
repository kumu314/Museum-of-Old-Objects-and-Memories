import { Hunyuan3DError } from './errors';
import {
  HUNYUAN_IMAGE_MAX_BYTES,
  HUNYUAN_IMAGE_MAX_PX,
  HUNYUAN_IMAGE_MIN_PX,
  type HunyuanGenerationInput,
  type HunyuanImageMime,
} from './types';

function inputError(message: string): never {
  throw new Hunyuan3DError('INPUT_INVALID', message);
}

const VALID_MIMES: readonly HunyuanImageMime[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * 输入图片预检，提交给任何混元 3D 通道（官方云 API 或网页反代）之前执行。
 * 这是本工程自己的预算控制，避免用无效输入消耗生成额度；真实通道限制以
 * 官方文档/实测为准。
 */
export function assertValidGenerationImage(image: HunyuanGenerationInput['image']): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
    image.width < HUNYUAN_IMAGE_MIN_PX || image.height < HUNYUAN_IMAGE_MIN_PX ||
    image.width > HUNYUAN_IMAGE_MAX_PX || image.height > HUNYUAN_IMAGE_MAX_PX) {
    inputError(`混元 3D 输入图片每边必须为 ${HUNYUAN_IMAGE_MIN_PX} 至 ${HUNYUAN_IMAGE_MAX_PX} 像素。`);
  }
  if (!VALID_MIMES.includes(image.mime)) inputError('混元 3D 输入图片必须是 JPEG、PNG 或 WebP。');
  if (image.bytes.byteLength === 0 || image.bytes.byteLength > HUNYUAN_IMAGE_MAX_BYTES) {
    inputError(`混元 3D 输入图片不能为空或超过 ${HUNYUAN_IMAGE_MAX_BYTES} 字节。`);
  }
}
