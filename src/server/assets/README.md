# 私有素材处理

`processAsset({ inputBuffer, originalName, mime })` 校验原始字节限额、扩展名、签名和实际解析。图片按原始输入限制单轴/总像素，拒绝 APNG 和动态 WebP，先应用 EXIF 方向再重编码 WebP；展示图与 640px 内缩略图均不保留 EXIF/XMP/IPTC/ICC。原始上传图片不保存。音频使用宿主 `ffprobe` 确认容器/编码，再以 `ffmpeg` 完整解码到空输出，拒绝损坏帧；没有修改录音内容。

返回 `ProcessedAsset` 是服务端内部对象。不要直接序列化 Buffer。图片输出 MIME 固定为 `image/webp`；音频输出 MIME 为 `audio/mpeg`、`audio/mp4` 或 `audio/wav`。常见音频 MIME 别名规范化后仍须与实际格式一致。文件名只保留最后一段，不用于存储寻址。

`prepareAsset(processed, uploadDir)` 创建随机 UUID 私有目录，写完全部文件后才返回 `PreparedAsset`。将返回的 `id` 用于素材记录，`contentType` 对应 DB `mime`；字节数和 SHA-256 属于展示文件。图片另有缩略图 key。此函数不操作数据库，核心层随后在已鉴权、已核对归属的事务中保存记录。

文件准备尚未返回而写入失败时，仅删除本调用新建目录；删除失败抛出包含素材 ID 的错误以定位残留。进程被终止留下的 UUID 目录需与素材表/快照引用比对后人工处理，不能根据文件年龄自动删除。

`cleanupUncommittedAsset(prepared, uploadDir, transaction, isReferenced)` 只适用于明确 `not-started` 或 `rolled-back` 的提交状态。调用者提供权威 DB 查询，确认素材记录和快照均未引用此 ID；存在引用或查询失败时保留文件。COMMIT 结果未知、或提交成功后 HTTP 响应发送失败，不能调用此函数。不得在一个笼统的路由 catch 中无条件清理。

`resolveAssetPath(uploadDir, storageKey)` 只接受本模块生成的 UUID 文件键，且仅供服务器读取。路由必须先验证团队身份或当前分享 token、当前快照的素材集合，再读取文件；响应使用已记录 MIME、`private, no-store` 和 `nosniff`。不得将目录/存储键放入公共展示数据。

部署需要 Sharp 的原生运行依赖，以及可执行的 `ffprobe` / `ffmpeg`。此轮实测 FFmpeg 9.0.2，子进程无 shell、仅允许 file/pipe 协议、输出与执行时间有限，临时文件随机命名且仅当前用户可读。依赖缺失按服务器故障处理，不能把未验证音频当成功。

局部验证：`node --import tsx --test tests/server/assets.test.ts`。测试素材完全合成，在系统临时目录创建并清理；不是物主照片或原声。此测试验证处理与落盘，不代替 HTTP 身份/快照授权、浏览器播放和数据库失败流程的联调。

## 六格式 HTTP 验收

准备使用隔离数据库和测试账号的本地应用，在执行终端配置 `E2E_BASE_URL`、`E2E_USERNAME`、`E2E_PASSWORD` 后运行：

```sh
node --import tsx --test tests/server/media-http.acceptance.ts
```

此入口不进入默认无服务测试，也不会读取真实用户文件。它生成 JPEG/PNG/WebP 和 MP3/M4A(AAC)/WAV(PCM) 文件，经正式上传、私有读取、确认发布、快照读取和停止分享逐项验证；只移除本次创建的展馆与本次临时文件，不清理历史素材。

2026-10-24 在 Windows、Node.js 26.12.0、PostgreSQL 18.6、FFmpeg 9.0.2 下，六种格式和总体快照/撤销验收均通过（7 项，无跳过）。图像通过解码检查尺寸、方向和敏感元数据；音频通过下载字节一致与完整解码检查。

**这不是浏览器显示或播放验收。** 尚需 B/E 用真实获准素材，在演示浏览器和实际手机验证图片显示、音频主动播放/暂停及切换展品停止上一段音频；不能把 HTTP 200 或 FFmpeg 解码当作设备播放通过。

## 向 C 交接的超限连接问题

Windows + Node.js 26.12.0 的本地 Next 开发服务器中，`tests/e2e/assets-http.test.ts` 可复现以下顺序：超大 raw multipart 上传收到 413 `PAYLOAD_TOO_LARGE`，随后读取馆资料收到 200，再随后的创建展品 POST 可能 `ECONNRESET`。因此此前“超限请求本身直接失败”的描述不准确，不能仅凭服务端 413 日志宣布整条回归通过。

C 需复核 `readAssetUpload` 的提前拒绝与后续连接复用行为。测试不得给创建展品加盲目重试，不能跳过该断言。此前尝试 cancel 请求体未解决，已撤销临时业务层改动；六格式验收是独立补充，不替代这条尚未通过的超限 HTTP 回归。
