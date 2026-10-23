# 私有仓库跨平台构建

本源码可在 Windows、macOS、Linux 本地构建；桌面程序内置服务端，不依赖 Docker。请在目标系统构建其安装包，macOS 的 DMG 应在 Mac 上生成。

## 获取源码

使用 Gitea 页面提供的私有仓库克隆地址，登录自己的 Gitea 账号，不把密码或 Token 写入地址或提交文件。

```bash
git clone <Gitea 页面上的克隆地址> boleserver
cd boleserver
npm ci
npm run build
```

需要 Node.js 24 和 npm。首次安装会下载 Electron；`npm ci` 可重复使用锁文件中的版本。

## Windows x64

```powershell
npx electron-builder --win nsis portable --x64 --publish=never
```

## macOS

```bash
npx electron-builder --mac dmg --arm64 --publish=never
# Intel Mac 使用 --x64
```

## Linux

```bash
npx electron-builder --linux AppImage deb --x64 --publish=never
# ARM64 设备使用 --arm64
```

Linux 若提示缺少系统库，请安装发行版对应的 GTK、NSS、X11 与音频运行依赖。构建输出位于 dist-electron/，不提交到源码；安装包通过私有 Gitea Releases 附件同步。

桌面版首次启动先选择数据目录，再进入管理后台设置密码。数据保存在选择的目录中；更新程序时保留数据目录。代码同步与用户数据库、音乐文件同步相互独立。

未配置代码签名的本地构建不会获得 Windows/macOS 开发者签名；macOS 对外分发时可另行配置签名和公证。
