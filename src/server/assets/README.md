# 素材校验与处理（D 主责）

服务端字节层：校验上传文件的实际格式、大小和可解析性，生成对外图片版本。模块不写数据库、不生成对外路由、不判断展馆归属。

## 导出

```ts
import {
  AssetError,
  AUDIO_MAX_BYTES,
  IMAGE_MAX_BYTES,
  validateAndProcessImage,
  validateAudio,
} from "./index.js";
```

输入统一为 `{ bytes: Uint8Array, declaredMimeType?: string }`。**不使用客户端文件名判断格式；C 生成存储路径。**

## 限额（开发书 §9.7）

| 项目 | 值 |
| --- | --- |
| 图片格式 | 静态 JPEG、PNG、WebP |
| 图片字节 | ≤ 10,485,760 |
| 图片尺寸 | 每轴 ≤ 8192，且总像素 ≤ 32,000,000 |
| 音频格式 | MP3、M4A（AAC）、WAV（PCM） |
| 音频字节 | ≤ 20,971,520 |
| 动图 | 拒绝（APNG、动画 WebP） |

边界值本身允许；超过 1 字节/1 像素即拒绝。格式签名、声明 MIME 和实际解析结果必须一致；`application/octet-stream` 视为未知，由实际字节决定。

## 图片结果

`validateAndProcessImage` 返回：

```ts
{
  kind: "image",
  sourceFormat: "jpeg" | "png" | "webp",
  sourceWidth, sourceHeight,   // 应用 EXIF 方向后的原图尺寸
  width, height,               // display 版本尺寸
  variants: [
    { kind: "display",   bytes, mimeType: "image/webp", width, height, byteLength, sha256 },
    { kind: "texture",   bytes, ... },
    { kind: "thumbnail", bytes, ... }
  ]
}
```

- `display` 最长边 2048；`texture` 最长边 2048、质量更高；`thumbnail` 最长边 480。都不放大小图。
- 输出均为 WebP；自动应用 EXIF 方向、转为 sRGB、不保留 EXIF/XMP/IPTC/方向等元数据。
- 原图字节不包含在结果里。若业务需要保留原始文件，由 C 在授权访问下单独存储；分享接口只能返回处理后的版本。
- `sha256` 可用于文件标识或去重，但不要把它当成访问凭据。

## 音频结果

`validateAudio` 返回 `{ kind: "audio", format, mimeType, bytes, byteLength, sha256 }`。音频不转码、不覆盖原始字节；浏览器实际播放仍需在验收设备上检查。

- MP3：容器 MPEG，编码必须是 MPEG Layer III。
- M4A：容器品牌属于 M4A/MP4 系列，编码必须是 AAC，且不得含视频轨。
- WAV：RIFF/WAVE，编码必须是 PCM；浮点 WAV 返回 415。
- 已知限制：`music-metadata` 能解析常见文件；极少数非标准容器可能被拒绝为 400。真实样例由 E 抽检。

## 错误契约

| `AssetError.code` | HTTP |
| --- | --- |
| `VALIDATION_ERROR` | 400 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 |

`message` 可直接展示；`cause` 仅供服务端诊断。素材处理失败不能被包装成上传成功。

## C 需要接入的部分

1. 根依赖增加 `sharp`、`music-metadata`。`sharp` 是原生依赖，部署环境必须实际安装并验证；`music-metadata` 仅服务端使用。
2. 上传路由在鉴权、展馆归属和大小预检后调用本模块；把返回的变体字节写到服务端持久目录，数据库只引用完整可读的文件。
3. 文件写入与数据库提交分开：数据库事务失败时，只清理本次新增且确认未被引用/未提交的文件；不能因为响应发送失败就删除已提交素材。
4. 替换图片/音频时生成新文件和新素材记录，不覆盖旧快照引用的文件；首版不自动物理清理历史素材。
5. 分享素材接口只返回当前快照包含的处理后版本，设置验证过的 `Content-Type` 与 `X-Content-Type-Options: nosniff`，不暴露存储路径。
6. 数据库提交成功但响应失败时，先核对提交结果，不盲目重放非幂等操作。

## 依赖与验证

- 运行时：`sharp`、`music-metadata`。
- 测试：`vitest`，`src/server/assets/__tests__/` 共 29 个用例。
- 已验证：JPEG/PNG/WebP、alpha、方向校正、GPS/设备元数据清除、动图拒绝、GIF/TIFF 拒绝、MIME 不一致、空文件、10 MiB/8192px/32MP 边界、损坏文件、MP3/M4A(AAC)/WAV(PCM)、ALAC/浮点 WAV/Ogg/带视频轨 MP4 拒绝、20 MiB 边界、损坏 MP3、截断 WAV/M4A。
- 测试环境：Node.js 20.19.0、sharp 0.35.5、music-metadata 11.16.1、Vitest 2.1.9。
- 未执行：真实手机浏览器播放、C 的存储/数据库接入、真实获准照片的端到端样例、上传中断与数据库回滚联调。素材夹具均为合成数据（正弦音、纯色图、EXIF GPS 测试图），不含真实用户素材。
