# 混元 3D 网页反代适配器（演示路径）

对接本机 [hunyuan3d-proxy](https://github.com/montezl/hunyuan3d-proxy)（腾讯混元 3D 网页端反向代理）的 **concept（概念站）** 通道，复用 `../hunyuan3d` 的共享类型、错误、GLB 校验与下载策略。生产路径仍是官方云 API 适配器（`../hunyuan3d`）；本模块是**演示用**的第二 provider，二者实现同一个 `Hunyuan3DClient` 接口，现已接入应用持久化任务、私有模型入库、来源未变时自动入柜与幂等采纳；生成模型发布快照在当前工作区通过迁移 0017 接入（尚未提交）。确认与发布仍由用户明确操作，完整验收及真实样例范围见 [验收清单](../../../../docs/11-验收清单.md)。

## 合规与凭据边界

- 上游是逆向的网页端接口，使用个人微信 Cookie 会话（反代项目自述仅用于学习用途）。只作为 hackathon 演示路径；不得写成生产承诺。
- Cookie 属于凭据：只保存在反代进程的 `data/cookies.json`，绝不进入本仓库、客户端、日志或错误响应。
- 反代默认只绑定 `127.0.0.1`；不要把端口转发到公网。
- 上游接口、签名和额度随时可能变化，失败必须受控降级，不能把演示通道当成可靠服务。

## 生成管线（concept，两阶段）

```
上传照片（genUploadInfo → COS PUT）
  → POST /game3d/geometry_generation/image2geometry   （白模，worksId）
  → 轮询 get_works_list（pipelineStatus 0/1 → WAIT/RUN）
  → 几何 SUCCESS 后自动 POST /api/text3d/texture      （图生纹理）
  → 轮询纹理作品（dependonWorksInfo 关联）
  → DONE：texturePaintingRsp.glbUrl（成品 PBR GLB）
```

- 对 C 仍呈现单一 `jobId`（几何 worksId），通过上游作品关联寻找纹理结果。
- 适配器提供纹理提交抢占与记录钩子，应用编排使用数据库持久化；未提供钩子的独立调用仅有实例内去重，不能声称支持重启恢复。纹理上游明确返回非零业务错误码时进入 FAIL / TEXTURE_SUBMIT_REJECTED，允许用户修正条件后新建生成任务，不自动重试。提交结果未知保持 RUN / TEXTURE_SUBMIT_UNKNOWN，提示持久化且跨实例保留，核对关联作品前不再提交。
- 白模同样有 `glbUrl`：`downloadGlb` 在 GLB 校验通过后额外要求 `materials > 0`，否则按 `INVALID_GLB` 拒绝。
- `remainingTimes()` 返回 concept 积分池余量，供 B12 额度验收使用。

## 配置

```ts
const client = createHunyuanWebProxyClient({
  baseUrl: 'http://127.0.0.1:8812',
  // timeoutMs / maxDownloadBytes / modelVersion（默认 v3.1）/ faceCount（默认 500000）
});
```

## 未验证项（真实试跑后核对）

1. ~~`genUploadInfo` 返回的 COS 临时凭证字段名~~ **已按 2026-10-24 真实响应核对**：`encryptTmpSecretId` / `encryptTmpSecretKey` / `encryptToken`（临时凭证），`bucketName` / `region` / `location`（PUT 目标），`resourceUrl` 为混元站内下载代理地址（`3d.hunyuan.tencent.com/api/3d/resource/download?resourceId=...`，作为生成任务的图片引用，不是 COS 直链）。上传 = 用临时凭证按 COS XML 签名 PUT 到 `https://{bucket}.cos.{region}.myqcloud.com/{location}`（`x-cos-security-token` 参与签名计算）。
2. 结果 GLB 的实际下载域名：默认沿用 [共享腾讯 COS 来源策略](../hunyuan3d/README.md#结果下载来源策略)，包含受约束的 `myqcloud.com` 与 `tencentcos.cn` 地域/存储桶端点。真实响应出现其他域名时，须先核实来源并复核共享允许策略；`resultUrlPolicy` 覆盖仅供测试注入本地假服务，不用于绕过真实结果的来源校验。
3. 真实输出的坐标、正面、原点与尺度仍无保证；入库前按 §9.6 由 D 规范化。
4. 上传与生成均会消耗网页端积分（concept 与主站积分池独立）。

## 当前上游阻塞（2026-10-24 实测）

应用侧链路（提交 → 轮询 → 纹理接续 → 下载）已打通到提交并被上游受理，但**上游首个处理步骤失败**：

- 所有实验输入（WebP/JPEG、合成图/真实照片、512–768px、`image2geometry` / `_singleimage` / `5views2geometry`、带/不带 `worksType`、`apose`）都被受理后进入 `hunyuan-3d-images-subject-segmentation`，随后以 `errorCode 400 / "http client codec StatusCode: Bad Request"` 失败。
- 传 COS 直链会改为 `errNo 200010 审核失败`（桶非公开，审核服务读不到）。
- 反代项目文档记录过同类上游步骤 7/7 全失败（`text2texture` 预处理），说明这是供应商侧/账号侧问题，不是参数格式问题。
- 当时的额度说明不作为扣费保证；当前应用只展示安全错误分类，不向用户透传上游原始错误文本。

结论：**不能宣称照片生成链路已通过**。需要等上游恢复、更换账号/Region，或改走官方云 API（需 SecretId/SecretKey 与额度）。

## 真实协议差异（2026-10-24，实测）

- `image2geometry` **必须带 `requestId`**（格式 `go` + 12 位十六进制），缺失时上游返回 `errNo 200002 输入参数错误`。
- 提交成功时返回**裸对象** `{requestId, worksId, ...}`，没有 `{errNo,data}` 信封；失败时用 4xx 携带 `{errNo,errMsg}`。客户端因此**先看文档内容再判 HTTP 状态**，不会再把真实错误掩盖成“结构无效”。
- `get_works_list` 会把**多个 JSON 文档直接拼接**返回（无分隔符），需按括号深度切分；作品失败原因在 `modelInfo.errorCode/errorMsg`（`errorCode` 是数字），执行状态可能只在 `status` 字段而非 `pipelineStatus`。
- 已用我们自己的客户端对真实反代完成一次 `submitImage`：返回真实 worksId，首次查询为 `WAIT`。

## 真实上传验证（2026-10-24）

用真实反代的临时凭证执行了一次完整的 `genUploadInfo` → COS PUT：**PUT 返回 200**，证明 PUT 目标推导（bucket/region/location）与临时凭证签名（`x-cos-security-token` 参与 q-header-list）均被 COS 接受。`resourceUrl` 站内下载地址无会话 Cookie 时返回 401，属预期——该地址由混元服务端在任务上下文内解析，不作为公开图片地址；应用侧只在生成请求中引用它，不向客户端暴露。

## 真实样本验证（2026-10-24）

反代经真实上游生成并下载了一个白模 GLB（`demo.glb`，8,995,424 字节，文生几何链路）。用本工程 `validateGlb` 与当前 `GLTFLoader.parseAsync` 验证：

- 通过：1 网格、约 499,706 三角形（对应默认 `faceCount` 500000）、无任何扩展（未用 Draco/KTX2），当前加载链可直接解析。
- **materials=0、无贴图**：几何阶段产物即白模，印证 `downloadGlb` 的 `materials > 0` 拒绝逻辑与自动接续纹理阶段的必要性。
- 包围盒约 0.744 × 0.697 × 0.744（米），minY=0、X/Z 近似居中；尺度仍无供应商保证，入库前仍需规范化与标定。
- 仍未验证：图片 `image2geometry` 全链路、纹理阶段真实成品、结果 URL 域名、COS 上传凭证字段名。

## 验证

`tests/server/hunyuan3d-proxy.test.ts` 用本地假反代 + 假 COS 覆盖：登录预检、COS PUT 签名与令牌头、几何提交参数、两阶段轮询、自动接续纹理的进程内去重、白模拒绝、未登录、errNo 错误码映射、上传地址来源校验、超时。全部离线，不消耗积分、不访问腾讯。

合入前补充的回归按[反代源码](https://github.com/montezl/hunyuan3d-proxy)区分两种响应：`genUploadInfo` 是主站透明代理，直接解析上传凭证；`/api/text3d/texture` 的 `ok=true` 仅代表本地封装完成，必须继续检查 `data.status` 与 `data.body` 中的上游结果和作品 ID。COS 签名依据[官方规范](https://cloud.tencent.com/document/product/436/7778)编码头部值；HTTP 测试地址必须显式注入策略，默认上传仅允许腾讯 COS 的 HTTPS 地址。无效纹理列表不能被当成空列表触发新提交。


### PR 复核后的任务恢复约定（2026-10-24）

应用编排通过数据库抢占纹理提交，在发出请求前持久化标记，并记录取得的纹理 worksId。进程重启或另一实例接管时先查询关联作品；已有提交标记而未查到作品时保持运行状态，不再次提交。几何提交响应丢失时保留 SUBMITTING / SUBMIT_UNKNOWN，须人工核对反代作品记录，不能直接点击重试付费。

`HUNYUAN_PROXY_ALLOW_INSECURE_UPLOAD=1` 仅允许 `NODE_ENV=test`，且上传、下载仅限环回 IP 的 HTTP(S) 地址；生产配置会拒绝该开关。
