# 素材测试夹具

全部为合成数据，不含真实用户照片或录音，也不代表产品样例内容。

| 文件 | 用途 |
| --- | --- |
| `image/animated.webp` | 两帧动画 WebP，验证 415 拒绝 |
| `image/animated.png` | 两帧 APNG，验证 415 拒绝 |
| `image/oriented-gps.jpg` | 120×60，EXIF Orientation=6、Make/Model 和 GPS IFD，验证方向校正与元数据清除 |
| `audio/tone.wav` | 0.6 秒 440Hz PCM WAV |
| `audio/tone.mp3` | 同一段声音的 MP3（MPEG Layer III） |
| `audio/tone.m4a` | 同一段声音的 AAC/M4A |
| `audio/tone_alac.m4a` | ALAC/M4A，验证 415 拒绝 |
| `audio/tone_float.wav` | 浮点 PCM WAV，验证 415 拒绝 |
| `audio/tone.ogg` | Vorbis/Ogg，验证 415 拒绝 |
| `audio/tone_video_track.bin` | 实际为带 H.264 视频轨和 AAC 音轨的 MP4；改扩展名以避开仓库对 `*.mp4` 的忽略规则，验证 415 拒绝 |

音频夹具由 ffmpeg 7.1 生成；动画图片由 ffmpeg 生成；`oriented-gps.jpg` 由 Pillow + piexif 生成。重新生成时应保持上述属性，不加入真实素材。
