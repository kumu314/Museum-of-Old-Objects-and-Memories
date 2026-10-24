# 首页演示照片

`home-landscape.webp` 是首页原有 Unsplash 风景演示图的本地优化副本，非用户上传素材、非真实藏品或生成模型。

- 原有地址：https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&h=1200&q=80
- 原始响应：144981 字节；保留 900 × 1200 构图。
- 使用已有 sharp 应用方向、清除元数据并转为 WebP（quality 85），不引入新依赖。
- 通过 `new URL(..., import.meta.url)` 打包为带内容哈希的静态资源；仅用于公开首页演示，不改变私有素材和分享接口的禁止缓存规则。
- 此处不将 Unsplash 图片归入模型的 CC0 许可；如替换素材，需保留对应来源与使用依据。

重新生成：先将上述地址响应保存为本地文件，再调用 `sharp(input).rotate().webp({ quality: 85 }).toFile(output)`。
