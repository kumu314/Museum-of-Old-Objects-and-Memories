# 私有素材处理

`processAsset({ inputBuffer, originalName, mime })` 校验原始字节限额、扩展名、签名和实际解析。图片按原始输入限制单轴/总像素，拒绝 APNG 和动态 WebP，先应用 EXIF 方向再重编码 WebP；展示图与 640px 内缩略图均不保留 EXIF/XMP/IPTC/ICC。原始上传图片不保存。音频使用宿主 `ffprobe` 确认容器/编码，再以 `ffmpeg` 完整解码到空输出，拒绝损坏帧；没有修改录音内容。

返回 `ProcessedAsset` 是服务端内部对象。不要直接序列化 Buffer。图片输出 MIME 固定为 `image/webp`；音频输出 MIME 为 `audio/mpeg`、`audio/mp4` 或 `audio/wav`。常见音频 MIME 别名规范化后仍须与实际格式一致。文件名只保留最后一段，不用于存储寻址。

`prepareAsset(processed, uploadDir)` 创建随机 UUID 私有目录，写完全部文件后才返回 `PreparedAsset`。将返回的 `id` 用于素材记录，`contentType` 对应 DB `mime`；字节数和 SHA-256 属于展示文件。图片另有缩略图 key。此函数不操作数据库，核心层随后在已鉴权、已核对归属的事务中保存记录。

文件准备尚未返回而写入失败时，仅删除本调用新建目录；删除失败抛出包含素材 ID 的错误以定位残留。进程被终止留下的 UUID 目录需与素材表/快照引用比对后人工处理，不能根据文件年龄自动删除。

`cleanupUncommittedAsset(prepared, uploadDir, transaction, isReferenced)` 只适用于明确 `not-started` 或 `rolled-back` 的提交状态。调用者提供权威 DB 查询，确认素材记录和快照均未引用此 ID；存在引用或查询失败时保留文件。COMMIT 结果未知、或提交成功后 HTTP 响应发送失败，不能调用此函数。不得在一个笼统的路由 catch 中无条件清理。

`resolveAssetPath(uploadDir, storageKey)` 只接受本模块生成的 UUID 文件键，且仅供服务器读取。路由必须先验证团队身份或当前分享 token、当前快照的素材集合，再读取文件；响应使用已记录 MIME、`private, no-store` 和 `nosniff`。不得将目录/存储键放入公共展示数据。

部署需要 Sharp 的原生运行依赖，以及可执行的 `ffprobe` / `ffmpeg`。此轮实测 FFmpeg 9.0.2，子进程无 shell、仅允许 file/pipe 协议、输出与执行时间有限，临时文件随机命名且仅当前用户可读。依赖缺失按服务器故障处理，不能把未验证音频当成功。

局部验证：`node --import tsx --test tests/server/assets.test.ts`。测试素材完全合成，在系统临时目录创建并清理；不是物主照片或原声。此测试验证处理与落盘，不代替 HTTP 身份/快照授权、浏览器播放和数据库失败流程的联调。
