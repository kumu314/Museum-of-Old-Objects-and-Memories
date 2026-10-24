# 混元 3D 网页反代适配器（演示路径）

对接本机 [hunyuan3d-proxy](https://github.com/montezl/hunyuan3d-proxy)（腾讯混元 3D 网页端反向代理）的 **concept（概念站）** 通道，复用 `../hunyuan3d` 的共享类型、错误、GLB 校验与下载策略。生产路径仍是官方云 API 适配器（`../hunyuan3d`）；本模块是**演示用**的第二 provider，二者实现同一个 `Hunyuan3DClient` 接口，C 的编排层无需感知差别。

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

- 对 C 仍呈现单一 `jobId`（几何 worksId）；纹理作品不需要额外持久化字段。
- 每个进程对同一任务只自动发起一次纹理提交；提交失败记为任务失败（`TEXTURE_STAGE_SUBMIT_FAILED`），重试由上层显式决定，不自动重复消耗积分。进程重启后允许再试一次。
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
2. 结果 GLB 的实际下载域名：默认沿用腾讯 COS 主机策略（`*.cos.*.myqcloud.com`，与官方桶域名清单一致）；真实响应出现其他域名时通过 `resultUrlPolicy` 显式调整，不放宽默认。
3. 真实输出的坐标、正面、原点与尺度仍无保证；入库前按 §9.6 由 D 规范化。
4. 上传与生成均会消耗网页端积分（concept 与主站积分池独立）。

## 验证

`tests/server/hunyuan3d-proxy.test.ts` 用本地假反代 + 假 COS 覆盖：登录预检、COS PUT 签名与令牌头、几何提交参数、两阶段轮询、自动接续纹理的进程内去重、白模拒绝、未登录、errNo 错误码映射、上传地址来源校验、超时。全部离线，不消耗积分、不访问腾讯。
