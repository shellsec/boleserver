# BoleServer：LX 音源订阅与自动切换

BoleServer 基于 [XCQ0607/lxserver](https://github.com/XCQ0607/lxserver)，保留原有排行榜、歌单、搜索、播放、收藏、同步和 Subsonic 功能。主要新增能力是兼容当前移动端的 LX 音源订阅清单和失败恢复。音质、服务器歌曲缓存和过期清理默认值不作修改。

## 使用

在播放器设置中打开「自定义源管理」，输入 sources.json 的 HTTP(S) 地址，点击「保存并更新订阅」。新订阅源默认启用；已有源的启停状态和排序继续保留。开启原有「自动解析换源」后，播放按源顺序尝试。管理员管理公开订阅，登录用户管理自己的私有订阅。

支持两种清单外层：JSON 数组，或 `{ "sources": [...] }`。例如：

```json
{
  "sources": [
    { "id": "primary", "name": "主音源", "url": "./primary.js" },
    { "id": "backup", "name": "备用音源", "url": "https://example.com/backup.js" }
  ]
}
```

每项必须有唯一 id、name、url。相对地址基于清单地址解析。兼容 BOM；拒绝空清单、重复 ID、非 HTTP(S) 地址。每个清单最多 100 项，每个文件最多 2 MiB，下载期限 15 秒。

## 自动恢复

1. 按现有音源排序解析同一首歌，单次解析最多等待 15 秒。
2. 全部候选失败后，检查用户保存的公开/私有订阅。
3. 仅清单成员、名称、脚本内容或显式授权变化时重新加载；成功更新后最多重试一轮。
4. 每首歌最多一次自动更新，每个订阅作用域/地址每分钟最多检查一次；不后台轮询。
5. 所有脚本下载、校验成功后才替换订阅元数据。失败保留旧文件，手动导入的源不被移除。
6. 自动更新不会升级脚本的原生 VM 授权。新脚本若要求不安全 VM，默认拒绝。

「检查更新」主动检查已保存地址。「清除订阅」停止后续自动更新，保留已经下载的源。清单移除的订阅成员不再加载；其旧脚本文件保留以便回退，不影响手动导入源。

订阅信息位于 `DATA_PATH/users/source/<用户名>/subscription.json`，公开订阅位于 `_open` 目录。服务重启后仍保留。

## API

- `GET /api/custom-source/subscription?username=...`：读取地址和更新状态。
- `POST /api/custom-source/subscription`：JSON 请求 `{ "username": "alice", "action": "save", "url": "https://example.com/sources.json" }`。
- `action` 还支持 `refresh` 和 `clear`，这两项不需要 url。
- 私有操作必须携带匹配用户的现有认证头；公开修改必须携带管理员认证头。显式 `allowUnsafeVM` 授权只允许管理员且要求服务器允许原生 VM。

## 与上游的区分

- 产品、PWA、桌面包、PM2、构建产物和仓库名称使用 BoleServer / boleserver。
- LX Music 同步协议、脚本 `lx` API、平台标识和已有 API 路径保持兼容。
- 保留 Apache-2.0 许可证和上游版权；本地代码目录为 `E:\GITHUB\boleserver`。
- 当前发布为源码推送；Docker/桌面产物需另行构建，不能把上游 lxserver 发行包当作 BoleServer。

## 验证范围

自动测试覆盖清单解析、相对地址、权限隔离、完整下载/校验后替换、失败保留、手动源冲突保护、清除并发取消、原生 VM 授权控制、真实沙箱及本地 HTTP 的完整失效恢复。真实平台榜单/歌单与歌曲播放还受网络、平台接口及所用 LX 音源影响，需接入实际音源验证。

验证命令：`npm test`（15 项）、`npm --ignore-scripts run build`、`npm run test:smoke`。Smoke 使用临时数据和回环监听，覆盖完整服务启动、播放器/管理页、静态资源、品牌注入、音源列表、订阅权限、排行榜定义。
