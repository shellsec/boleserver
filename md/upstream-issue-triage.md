# 上游 Issues 核查（2026-10-23）

范围：XCQ0607/lxserver 当日 11 个未关闭 Issue，对照克隆提交 d428806；优先 LX 音源及在线播放。只读核查，没有向上游发送评论或修改 Issue 状态。静态代码证据不等同于在报告者设备上复现。

| Issue | 当前判断 | 依据和处理建议 |
|---|---|---|
| [#443 音源更新需要重新导入](https://github.com/XCQ0607/lxserver/issues/443) | 确认缺少服务端直接更新入口 | 原 `customSourceHandlers.ts:handleImport` 遇到同 ID 直接拒绝；`app.js` 的 updateAlert 只打开下载网页。本次清单订阅支持原位更新与失效恢复；普通非订阅 JS 导入的一键更新仍可后续补齐。 |
| [#447 网络歌单新增歌曲消失](https://github.com/XCQ0607/lxserver/issues/447) | 确认存在覆盖本地新增的代码路径，建议优先完善 | `app.js:handleListClick` 在自动更新开启时触发 `handleRefreshList`；后者直接 `list.list = newList`。只存在本地的新增项会被远端清单覆盖。建议网络歌单与本地歌单分开，或保留本地增量。本次不改歌单同步语义。 |
| [#448 箭头音乐 Subsonic 无响应](https://github.com/XCQ0607/lxserver/issues/448) | 待具体客户端/音源/歌曲复现 | 评论确认协议为 Subsonic；维护者反馈音流和 substreamer 可播。现有 Subsonic 也调用 LX `callUserApiGetMusicUrl`，本次有超时/恢复改进，但不能据此宣称修复箭头客户端兼容。 |
| [#445 后台路由](https://github.com/XCQ0607/lxserver/issues/445) | 配置迁移与旧路径需排查，尚无确定代码根因 | 评论提示 v2.1.3 改过配置。当前默认播放器 `/`、管理 `/admin/`，并有动态路径映射；需要原配置、完整访问 URL 和反代规则。 |
| [#458 Not Found](https://github.com/XCQ0607/lxserver/issues/458) | 信息不足，和 #445 合并排查 | 无版本/配置/日志，不能只凭页面文字断定源故障。先检查 player.path、admin.path、静态文件和旧 PWA 缓存。 |
| [#438 自定义目录不刷新/批量元信息](https://github.com/XCQ0607/lxserver/issues/438) | 部分仍存在，部分已有实现 | `customMusicManager.ts:getCustomMusicList` 仅索引不存在时扫描，外部文件改动要手动同步；批量更新元信息/嵌入歌词在 `customDir.js` 已实现，受写权限控制。 |
| [#439 自定义目录树/翻页](https://github.com/XCQ0607/lxserver/issues/439) | 目录树是新需求，翻页转发已有实现 | `customDir.js` 为 lm-page-first/prev/next/last 注册独立监听；不能仅根据 HTML 的 LocalMusicManager onclick 判定翻页失效。底部遮挡需视口测试。 |
| [#456 未关联平台的本地歌曲入歌单](https://github.com/XCQ0607/lxserver/issues/456) | 本地文件身份模型扩展需求 | 当前在线歌单/LX 同步以平台歌曲身份为基础。需同时设计本地文件持久 ID、播放端点、Subsonic 序列化及跨设备行为，非本次 LX 音源订阅范围。 |
| [#426 飞牛音乐接入](https://github.com/XCQ0607/lxserver/issues/426) | 新协议适配需求 | 非现有 LX 音源故障，不建议在订阅改动中混入。 |
| [#360 CPU 20–30%](https://github.com/XCQ0607/lxserver/issues/360) | 尚待性能证据 | 未提供重现负载/CPU profile，可能涉及目录扫描、缓存或媒体任务，不能仅由标题判因。本次修复临时音源校验定时器泄漏，不据此声称修复该 Issue。 |
| [#450 Android 前端美化](https://github.com/XCQ0607/lxserver/issues/450) | 第三方前端的设计求助 | 不属于本仓库确定缺陷。 |

补充确定缺陷：普通远程 JS 音源导入，在同意 VM 模式后重试引用未定义 `filename`，会导致导入失败。本次已加回归测试并修复。订阅验证还增加临时定时器释放、禁用自动原生 VM 试探以及监控关闭，避免多次更新残留运行资源。

建议后续顺序：普通 URL 源的一键更新 → 网络歌单本地新增保护 → 带实际 LX 音源的 Web/Subsonic 客户端回归 → 部署配置诊断。其余 NAS 本地库扩展、飞牛和前端风格可以单独排期。
