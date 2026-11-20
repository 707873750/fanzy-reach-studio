# 视频上传

规则核对日期：2026-11-20。支持 Instagram、X、Pinterest、TikTok、Bluesky、Facebook 的浏览器上传流程。平台界面和账号权限仍可能变化；未确认上传完成时不提交，提交后缺少明确成功证据时保留“结果待确认”。

## 使用方式

素材库可导入 MP4、M4V、MOV、WebM，保存来源文件夹，显示视频封面、时长和尺寸，可筛选视频。选择单条视频后可用“播放所选视频”在系统播放器预览。

发布采用跨平台兼容格式：MP4/M4V 容器、H.264、8 位 yuv420p，AAC 音轨或无音轨。MOV/WebM 等文件可导入，但不符合兼容格式时会明确提示重新导出，不会静默转码或剪短视频。应用导入上限为十进制 1 GB。每个视频单独建草稿，图片按既有批量规则分组，二者不混合上传。

| 平台 | 本应用校验范围 | 说明 |
| --- | --- | --- |
| X | 0.5–140 秒，512 MB，最高 60 fps | 按普通账号；不推测 Premium 资格。尺寸及画幅另行校验。 |
| Bluesky | 最长 600 秒，300 MB | 当前官方客户端常量；账号须验证邮箱，服务端额度仍由平台判断。 |
| Pinterest | 4–300 秒，应用上限 1 GB | 普通视频 Pin，非广告；须填写图板。 |
| Instagram | 3–180 秒，1 GB，至少 720p / 30 fps，画幅 9:16–1.91:1 | 保守的应用兼容范围，**不代表平台或所有账号的最长视频时长**。 |
| TikTok | 3–600 秒，1 GB | 保守的应用兼容范围，实际账号额度和时长以 Studio 为准。 |
| Facebook | 最长 4 小时，1 GB | 应用处理上限；Meta 已公告新版视频统一为 Reels，不再按旧的短 Reel 时长限制。 |

视频在建草稿前及准备上传前校验；后者重新探测实际文件，防止素材被替换后绕过限制。选择多平台时若任一平台不兼容，整批创建停止并提示原因，不会留下部分草稿。可以取消选择不适用的平台。

图片替代文本不适用于当前视频自动发布流程，填写时会停止并提示清空。AI 文案只读取视频封面，不分析完整画面或声音，也不生成视频替代文本。

## 官方依据与适用范围

- [X 视频上传帮助](https://help.x.com/en/using-x/x-videos)：普通账号与 Premium 配额不同。
- [Bluesky 官方客户端常量](https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts)：`VIDEO_MAX_DURATION_MS` 为 10 分钟，`VIDEO_MAX_SIZE` 为 300,000,000 字节；旧博客的 60 秒或 3 分钟说明不作为当前上限。
- [Pinterest 普通 Pin 规格](https://help.pinterest.com/en/article/review-pin-specs)：网页 MP4/M4V，视频 4 秒至 5 分钟；此页未提供普通视频 Pin 的统一大小上限，因此 1 GB 明确标为应用上限。
- [Instagram 帮助中心](https://help.instagram.com/1038071743007909)：本次读取要求登录，无法核实所有账号当前上限，应用采用以上兼容范围，不宣传为官方最大值。
- [TikTok 创作帮助](https://support.tiktok.com/en/using-tiktok/creating-videos/camera-tools)：本次无法读取完整规则；不将付费 Series 或广告规格套用于普通 Studio 上传。
- [Meta 视频统一为 Reels 的公告](https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/)：公告取消旧 Reels 时长、格式限制；应用仍限制处理文件体积。

## 实现与验证

FFprobe 探测时长、帧率、视频/音频编码、像素格式和旋转后的尺寸；FFmpeg 提取封面。二进制随 npm 依赖打包并从 ASAR 解包目录运行，子进程隐藏窗口且设有超时。大文件哈希使用流式读取；视频上传使用 Playwright 原生文件控件，不将视频编码为 Base64 注入页面。上传处理等待上限 10 分钟，单任务总上限 15 分钟。

`node tests/video-media.test.mjs` 测试真实视频元信息、封面、六平台导出、规则边界、原子批次创建、混合素材分组和删除。

`.venv/Scripts/python.exe -m unittest discover -s python -p test_video.py -v` 在拦截网络的浏览器页面测试六平台原生上传、失败时禁止提交和视频数量校验。此测试不等于实际账号发布验收；未自动发布任何真实内容。

发布安装包时需同时重建 Python worker（`npm run build:publisher`）和 Electron（`npm run build`），否则旧 worker 不支持新增的视频任务。遵循 `ffmpeg-static` / `ffprobe-static` 所附二进制许可证并随分发保留相应文件。

2026-11-20 上传故障修复：Instagram 处理首次 Reels 说明；X 区分上传进度与播放器/字数进度，并重新获取上传完成后替换的发布按钮；TikTok 支持视频预览转为封面后的“已上传”状态，关闭已识别的首次使用说明，保留原有检查设置。三个平台均使用真实账号的临时登录快照验证到最终提交检查点，诊断拒绝提交，未发布帖子。

Facebook 增加被动监听本次 `ComposerStoryCreateMutation` 的确认：必须在提交后、文案与附件匹配，且响应含创建成功的 story ID；失败、草稿和未知响应仍保留待确认。单元及浏览器拦截测试覆盖此分支，但真实发布响应尚待下一次发布验证。`scripts/diagnose-video-upload.py` 仅用于本地准备阶段诊断，始终拒绝最终提交。

同日第二轮确认修复：实际截图中的 Instagram 完成文案为“你的 Reels 已分享。”，现已纳入弹窗/通知识别，并捕获短暂出现的提示；旧提示、编辑框和信息流同文案不作为本次成功依据。Facebook 日志证实已匹配本次创建请求，且收到无错误的 `story_create` 响应；读取真实页面加载的 `ComposerStoryCreateMutation.graphql` 定义后，补充直接位于 `story_create` 下的 `story_id`、`post_id` 确认方式，不再要求完整 `story` 对象。未重发真实帖子；新增分支已通过拦截响应回归，待下一次真实发布验证。

## 发布记录中的帖子地址

发布成功后保存可确认的帖子链接，在记录详情中显示地址、打开帖子和复制按钮。Pinterest、Bluesky 保留既有响应链接；Facebook 优先采用返回的帖子 URL，缺失时使用本次请求的作者 ID 和返回的 post ID 组成 permalink；X、Instagram 增加匹配本次文案与媒体的创建响应提取，以及新成功通知中的帖子链接提取。TikTok 只有返回明确的作品 ID 与对应分享地址/作者时才保存链接，项目 ID 不当作作品地址。

主页、个人资料页、上传页和内容管理页不会保存或展示为帖子地址。平台原生排程暂不填写正式地址；平台未提供链接、旧版本未保存地址时明确显示缺失，不根据文案猜测或自动重发。此功能没有自动回查旧记录。新增 X/Instagram 响应分支及其他平台的链接提取已通过拦截响应测试，实际可用性仍取决于发布时网页返回的数据。
