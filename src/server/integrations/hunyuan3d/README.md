# 腾讯混元 3D 适配器

服务端外部调用适配器，使用腾讯云混元生 3D **专业版**。只负责提交、查询、下载和模型边界校验；用户归属、任务持久化、去重、额度、版本、快照和发布由 C 编排。当前没有真实账号调用证据。

## 官方依据

- 快速开始：<https://cloud.tencent.com/document/product/1804/120757>
- 提交专业版任务：<https://cloud.tencent.com/document/api/1804/123447>
- 查询专业版任务：<https://cloud.tencent.com/document/api/1804/123448>
- File3D：<https://cloud.tencent.com/document/api/1804/120828>
- 接口更新历史：<https://cloud.tencent.com/document/api/1804/120839>
- 计费：<https://cloud.tencent.com/document/product/1804/123461>
- TC3 签名：<https://cloud.tencent.com/document/api/213/30654>

旧 `SubmitHunyuanTo3DJob` / `QueryHunyuanTo3DJob` 已从官方接口列表删除；本适配器使用 `SubmitHunyuanTo3DProJob` / `QueryHunyuanTo3DProJob`，域名 `ai3d.tencentcloudapi.com`，版本 `2025-05-13`。

## 配置

C 在服务端环境提供：

```env
HUNYUAN_SECRET_ID=
HUNYUAN_SECRET_KEY=
HUNYUAN_REGION=
```

可选：`HUNYUAN_3D_MODEL=3.0|3.1`、超时和下载上限由调用方传给 `createHunyuan3DClient`。密钥不得进入客户端、Git、日志或错误响应。`endpoint` 只允许测试注入；生产必须使用官方域名。

## 用法边界

```ts
const client = createHunyuan3DClient({ secretId, secretKey, region });
const { jobId } = await client.submitImage({
  image: { bytes: displayWebpBytes, mime: 'image/webp', width, height },
  enablePbr: true,
});
// 由 C 保存 jobId 并轮询；不要在网络失败后盲目重新提交。
const job = await client.queryJob(jobId);
if (job.status === 'DONE') {
  const glbFile = job.files.find((file) => file.type.toLowerCase() === 'glb');
  if (glbFile) {
    const { bytes, stats } = await client.downloadGlb(glbFile);
    // 交给 C 私有保存；stats 只是边界统计，不证明尺度或视觉质量。
  }
}
```

- 输入只接受当前处理链产出的 JPEG/PNG/WebP；每边 128–5000 px，原始字节 ≤6 MB。现有上传链允许 10 MiB/8192 px，**不能把原图直接提交**；应由图片处理模块产出符合混元限制的图片，并保留原始照片与来源。
- Pro 默认返回 OBJ、GLB。不要在请求中传 `ResultFormat=GLB`；官方 Pro 页列的 `ResultFormat` 只有 STL/USDZ/FBX，GLB 需要从 `ResultFile3Ds` 按 `Type` 选择。
- `JobId` 和结果 URL 官方均为 24 小时有效。C 必须持久化任务并尽快下载；供应商 URL 不能作为永久分享地址。
- 适配器不自动重试提交；付费提交结果不明时先按已有 JobId 查询。查询失败、超时和 `FAIL` 分别由上层映射，不能把未知状态当成功。
- 下载结果经过 GLB 版本、分块、内嵌资源和必需扩展检查。当前加载链不支持 Draco/KTX2，因此相关必需扩展会被拒绝；这不能替代 A/D 的资源预算和浏览器验收。
- 结果坐标、正面、原点和尺度没有供应商保证。D 在入库前按开发书 §9.6 规范化到 +Z、Y-up、底部中心和有依据的米制尺寸；未知尺度必须标记，不能宣称真实物理尺寸。
- 当前没有调用真实腾讯云 API；测试使用本地假上游，不能当作生成成功证据。

## C 需要接入

1. 扩展服务端配置校验和 `.env.example`（键名由 C 统一；不提交真实值）。
2. 持久化任务：用户/展馆/展品归属、输入素材及版本、外部 JobId、状态、尝试次数、结果和失败类型；提交去重、刷新/重启查询、额度/并发限制。
3. 提交前检查输入图片是否属于当前用户且满足混元限制；生成结果通过本适配器校验后作为私有资产保存，替换产生新版本，不覆盖旧快照。
4. 映射 `Hunyuan3DError` 到共享错误契约：配置/输入错误、上游不可用、任务失败、结果缺失、下载失败、GLB 无效、超时；不要把供应商原始消息或签名 URL 返回给客户端。
5. 失败保留原照片、讲述和已有模型；提交结果不明时先查询，不自动重新付费提交。
6. 与 A 确认模型朝向、陈列 scale、资源预算和目标设备；资源上限在实测后冻结，不预先编造。

## 验证

本地测试覆盖 TC3 请求头形状、提交/查询/下载、API 错误、任务失败、超时、输入限制和 GLB 边界；不连接腾讯云，不需要真实 SecretId/SecretKey。真实账号、GLB 质量、耗时、扣费、素材授权和外传仍需单独获得授权后验证。
