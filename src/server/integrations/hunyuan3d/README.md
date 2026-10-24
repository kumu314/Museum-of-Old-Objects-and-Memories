# 腾讯混元 3D 适配器

服务端外部调用适配器，使用腾讯云混元生 3D **专业版**，保留为生产路径。只负责提交、查询、下载和模型边界校验；用户归属、任务持久化、去重、额度、版本、快照和发布由 C 编排，当前尚未接入应用任务链路。本官方云 API 适配器尚无真实账号调用验收记录；concept 演示通道的独立白模历史见 [网页反代适配器](../hunyuan3d-proxy/README.md)，不代表完整照片生成流程通过。

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

当前 `createHunyuan3DClient` 只接收显式配置对象，不自动读取环境变量。以下是交给 C 接入时的建议命名，尚未纳入应用配置校验或 `.env.example`，仅设置这些变量不会启用生成服务：

```env
HUNYUAN_SECRET_ID=
HUNYUAN_SECRET_KEY=
HUNYUAN_REGION=
```

模型版本的建议环境名为 `HUNYUAN_3D_MODEL=3.0|3.1`；选用特定版本时通过配置对象的 `model` 传入，超时与下载上限可分别通过 `timeoutMs`、`maxDownloadBytes` 指定。密钥不得进入客户端、Git、日志或错误响应。`endpoint` 只允许测试注入；生产必须使用官方域名。

## 结果下载来源策略

供应商返回的结果 URL 属于不可信输入。`downloadGlb` 默认策略（`assertProviderResultUrl`）在发出任何请求前强制执行：

1. 仅接受 HTTPS，拒绝 URL 内嵌凭据和非 443 端口。
2. 主机仅接受 `cos.<region>.myqcloud.com` / `cos.<region>.tencentcos.cn` 地域端点及其 `<bucket>-<appid>.` 存储桶端点（按 DNS 标签边界匹配，签名 query 原样保留）。地域端点见[查询接口示例](https://cloud.tencent.com/document/api/1804/123448)，新旧域名见 [COS 官方说明](https://cloud.tencent.com/document/product/436/67768)。真实响应的桶域名仍需首次真实调用后复核；不得放宽为任意域名。
3. 主机解析出的全部地址必须在公网范围：环回、RFC1918、链路本地（含 169.254.169.254 元数据）、CGNAT、组播、保留段一律拒绝；IPv4-mapped IPv6 按内嵌 IPv4 判断，解析失败同样拒绝。
4. 重定向保持禁用（`redirect: 'error'`），不存在绕过策略的跳转。
5. 剩余风险：fetch 建立连接时会再次解析 DNS，理论上存在针对已允许域名的 DNS rebinding 窗口；COS 权威解析由腾讯控制，风险可接受，已记录在代码注释。

## 响应大小上限

API JSON 响应（1 MiB）与 GLB 下载（`maxDownloadBytes`，默认 64 MiB）都在流式读取过程中执行字节上限：先核对 `Content-Length`，再逐块累计，超限立即终止读取，不先完整缓冲再判断。请求结束时统一中止未完成的响应体，保证 HTTP 错误和声明长度超限的提前拒绝同样会关闭连接。

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

- 输入接受 JPEG/PNG/WebP；当前适配器限制每边 128–5000 px、字节数 ≤6 MiB（6,291,456 字节）。现有上传链允许 10 MiB/8192 px，**不能把上传结果未经再次检查直接提交**；应由图片处理模块产出符合混元限制的图片，并保留已保存的输入素材记录与来源。当前上传链只保存处理后的展示图与缩略图，不保留原始上传图片字节。
- Pro 默认返回 OBJ、GLB。不要在请求中传 `ResultFormat=GLB`；官方 Pro 页列的 `ResultFormat` 只有 STL/USDZ/FBX，GLB 需要从 `ResultFile3Ds` 按 `Type` 选择。
- `JobId` 和结果 URL 官方均为 24 小时有效。C 必须持久化任务并尽快下载；供应商 URL 不能作为永久分享地址。
- 适配器不自动重试提交；付费提交结果不明时先按已有 JobId 查询。查询失败、超时和 `FAIL` 分别由上层映射，不能把未知状态当成功。
- 下载结果经过 GLB 容器与基本场景结构校验：文件头、分块与分量偏移对齐、`asset.version`、必需扩展能力表、scene→node→mesh→primitive→POSITION accessor→bufferView→BIN 的引用完整性、索引与字节边界、外部资源引用。缺少展示场景时拒绝。必需扩展按当前裸 `GLTFLoader` 能力收敛：只允许 `KHR_materials_unlit`；Draco、Meshopt、KTX2/Basis 即使供应商漏写声明也会按实际使用位置拒绝；未知必需扩展默认拒绝。测试基准是包含真实几何的最小三角形 GLB，并用项目实际版本的 `GLTFLoader.parseAsync` 冒烟验证。该同步检查不是完整 glTF 合规或纹理解码验证，不能替代 D 入库前的完整解析、资源预算、规范化和 A/D 的浏览器验收。
- 结果坐标、正面、原点和尺度没有供应商保证。D 在入库前按开发书 §9.6 规范化到 +Z、Y-up、底部中心和有依据的米制尺寸；未知尺度必须标记，不能宣称真实物理尺寸。
- 当前没有调用真实腾讯云 API；测试使用本地假上游，不能当作生成成功证据。

## C 需要接入

1. 扩展服务端配置校验和 `.env.example`（键名由 C 统一；不提交真实值）。
2. 持久化任务：用户/展馆/展品归属、输入素材及版本、外部 JobId、状态、尝试次数、结果和失败类型；提交去重、刷新/重启查询、额度/并发限制。
3. 提交前检查输入图片是否属于当前用户且满足混元限制；生成结果通过本适配器校验后作为私有资产保存，替换产生新版本，不覆盖旧快照。
4. 映射 `Hunyuan3DError` 到共享错误契约：配置/输入错误、上游不可用、任务失败、结果缺失、下载失败、GLB 无效、超时；不要把供应商原始消息或签名 URL 返回给客户端。
5. 失败保留原照片、讲述和已有模型；提交结果不明时先查询，不自动重新付费提交。
6. 与 A 确认模型朝向、陈列 scale、资源预算和目标设备；资源上限在实测后冻结，不预先编造。

## 额度用完后如何替换 API 与凭据

生产通道支持**服务端热替换**，不需要改代码或重启进程：编辑（或新建）
`.local/model-provider.json`（Git 已忽略，仅本机可读），下一次生成请求即生效：

```json
{
  "provider": "hunyuan-cloud",
  "cloud": {
    "secretId": "新的 SecretId",
    "secretKey": "新的 SecretKey",
    "region": "ap-guangzhou",
    "endpoint": "https://ai3d.tencentcloudapi.com/",
    "model": "3.1",
    "timeoutMs": 60000
  }
}
```

- `endpoint` 可指向兼容同一协议（TC3-HMAC-SHA256 + `SubmitHunyuanTo3DProJob` /
  `QueryHunyuanTo3DProJob`）的其他网关；生产必须是 HTTPS，且地址不携带凭据或查询串；HTTP 环回地址仅允许 `NODE_ENV=test`。
- `provider` 可锁定 `hunyuan-cloud` 或 `hunyuan-proxy`（演示反代），便于在额度用完后
  显式切换；也可省略，按可用性自动选择（配置了云 API 就用云 API）。
- 配置文件优先于环境变量；只有文件不存在才回退环境变量，路径、权限、语法或字段错误均受控失败，不会静默换通道。
- 演示反代可在 JSON 中设置 `proxyBaseUrl`，提交和查询均使用该地址，沿用 HTTP(S) 地址校验与测试来源开关限制。
- 采纳结果要求展品仍处于生成时的来源版本；生成后保存其他改动需重新生成，采纳后旧确认（含确认人）失效。
- 凭据只存在于服务端文件；不要通过 API 返回、不要写日志、不要提交仓库。
- 不做自动降级：额度不足会明确提示，由你替换凭据或切换到演示通道，避免在不知情时
  改用另一条付费/演示链路。

## 真实调用验证（2026-10-24）

使用真实腾讯云账号对 Pro 接口完成一次端到端调用（768×768 合成 JPEG，`Model 3.1`、`EnablePBR`）：

- 提交返回真实 `JobId`；轮询约 **173 秒**后 `DONE`，`ResultCreditConsumed` = **30**。
- 结果文件含 OBJ 与 GLB；GLB **39,869,948 字节**，1 网格、1 材质、3 张贴图，`extensionsUsed: KHR_materials_specular`，无必需扩展（当前加载链可直接解析）。
- 本工程 `validateGlb` 二次校验通过；下载经过来源策略与流式字节上限。
- 注意：近 40 MB 的结果对浏览器与目标设备偏重，入库前仍需按 A/D 实测冻结资源预算（面数/贴图/字节上限），不能直接据此宣称性能可接受。

## 验证

本地测试覆盖 TC3 请求头形状、提交/查询/下载（含 COS 签名 query 保留）、API 错误、任务失败、超时、输入限制、下载来源策略（HTTPS/COS 域名/公网地址/重定向禁用）、流式大小上限、GLB 引用结构与解码扩展拒绝，并以项目实际 GLTFLoader 冒烟验证基准 fixture；不连接腾讯云，不需要真实 SecretId/SecretKey。真实账号、GLB 质量、耗时、扣费、素材授权和外传仍需单独获得授权后验证。
