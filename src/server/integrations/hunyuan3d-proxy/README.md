# 混元 3D 网页反代适配器（演示路径）

对接本机 [hunyuan3d-proxy](https://github.com/montezl/hunyuan3d-proxy)（腾讯混元 3D 网页端反向代理）的 **concept（概念站）** 通道，复用 `../hunyuan3d` 的共享类型、错误、GLB 校验与下载策略。生产路径仍是官方云 API 适配器（`../hunyuan3d`）；本模块是**演示用**的第二 provider，二者实现同一个 `Hunyuan3DClient` 接口，但均尚未接入应用的持久化任务与发布链路。

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
- 同一客户端实例对同一任务只自动提交一次纹理；演示时须复用实例。提交失败记为 `TEXTURE_STAGE_SUBMIT_FAILED`，实例内不会自动重试。**本模块尚未接入持久化编排**：重建实例或重启会丢失提交记录，不能将再次轮询当成安全重试；先人工核对上游是否已经接受提交及其结果。接入 C 的任务编排前，必须持久化纹理提交状态与外部任务标识，并处理提交结果不明的恢复，不能仅凭几何 jobId 宣称已支持安全恢复。
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

1. `genUploadInfo` 返回的 COS 临时凭证字段名（`encryptTmpSecretId/Key/Token` 等）来自网页 SPA 逆向记录，没有真实样本；`parseCosUploadInfo` 按别名容错，字段缺失时受控失败。
2. 结果 GLB 的实际下载域名：默认沿用 [共享腾讯 COS 来源策略](../hunyuan3d/README.md#结果下载来源策略)，包含受约束的 `myqcloud.com` 与 `tencentcos.cn` 地域/存储桶端点。真实响应出现其他域名时，须先核实来源并复核共享允许策略；`resultUrlPolicy` 覆盖仅供测试注入本地假服务，不用于绕过真实结果的来源校验。
3. 真实输出的坐标、正面、原点与尺度仍无保证；入库前按 §9.6 由 D 规范化。
4. 上传与生成均会消耗网页端积分（concept 与主站积分池独立）。

## 真实样本验证（2026-10-24）

反代经真实上游生成并下载了一个白模 GLB（`demo.glb`，8,995,424 字节，文生几何链路）。用本工程 `validateGlb` 与当前 `GLTFLoader.parseAsync` 验证：

- 通过：1 网格、约 499,706 三角形（对应默认 `faceCount` 500000）、无任何扩展（未用 Draco/KTX2），当前加载链可直接解析。
- **materials=0、无贴图**：几何阶段产物即白模，印证 `downloadGlb` 的 `materials > 0` 拒绝逻辑与自动接续纹理阶段的必要性。
- 包围盒约 0.744 × 0.697 × 0.744（米），minY=0、X/Z 近似居中；尺度仍无供应商保证，入库前仍需规范化与标定。
- 仍未验证：图片 `image2geometry` 全链路、纹理阶段真实成品、结果 URL 域名、COS 上传凭证字段名。

## 验证

`tests/server/hunyuan3d-proxy.test.ts` 用本地假反代 + 假 COS 覆盖：登录预检、COS PUT 签名与令牌头、几何提交参数、两阶段轮询、自动接续纹理的进程内去重、白模拒绝、未登录、errNo 错误码映射、上传地址来源校验、超时。全部离线，不消耗积分、不访问腾讯。

合入前补充的回归按[反代源码](https://github.com/montezl/hunyuan3d-proxy)区分两种响应：`genUploadInfo` 是主站透明代理，直接解析上传凭证；`/api/text3d/texture` 的 `ok=true` 仅代表本地封装完成，必须继续检查 `data.status` 与 `data.body` 中的上游结果和作品 ID。COS 签名依据[官方规范](https://cloud.tencent.com/document/product/436/7778)编码头部值；HTTP 测试地址必须显式注入策略，默认上传仅允许腾讯 COS 的 HTTPS 地址。无效纹理列表不能被当成空列表触发新提交。
