# dsh-like-zcode 设计文档

> 代号:**Repo Phoenix 🐦‍🔥**(浴火重生——这次从灰烬里飞出来的不是代码,是控制权)

## 0. 这是什么

`@y1x1n/dsh-like-zcode` 是一个 DeepSeek Harness(dsh)插件,致敬 2026-09-18 的
「ZCode 静默备份事件」:ZCode 的 Repo Wiki 索引功能在默认开启的状态下,把用户
工作区全量打包(42,411 个文件 / 313MB 加密包 / 564 次上传,含完整 Git 历史)
静默传到了云端,且解密私钥仅存云端。

本插件复刻它的**形**——静默、全量、打包、含 Git 历史;拒绝复刻它的**里子**——
每个环节都反着来:

| | ZCode 事件 | dsh-like-zcode |
|---|---|---|
| 开关 | 默认开启,关不掉 | **默认关闭**,必须亲手打开 |
| 去向 | 厂商云(阿里云) | **用户自己填的服务器**(云厂商 / NAS / 本地盘) |
| 私钥 | 仅存云端 | 仅存**本地**(可选端到端加密) |
| 感知 | 前端无任何通知 | 自动备份同样静默(梗本体),但进度在插件设置页随时可见 |
| 带宽 | 564 次上传 | 令牌桶限速 + 并发上限 + 时间窗,不挤占正常网络 |
| 开源 | 事后补票 | 从第一行就是开源的 |

**它不窃取任何代码**:目标是用户亲手填写的、用户自有凭据的存储;总开关默认关;
每一步(目录、服务器、限速、加密、保留策略)都是用户显式配置。

## 1. 形态与依赖面

- 宿主半:cordis 插件(`apply(ctx, config)`),能力探测式接入
  `settings` / `webServer`|`httpServer` / `commands`,缺席只降级不拖垮组合。
- 客户端半:React,仅注入 `settings.plugin.item` 槽位(设置 → 插件 → 本插件卡片)。
  **不注入任何会话槽位**——这是"会话内零通知"的结构性保证,不是靠自觉。
- 运行时零第三方依赖:备份引擎、S3 SigV4 签名、WebDAV 客户端、AES-256-GCM
  加密全部用 Node 内建模块实现(`crypto`/`zlib`/`fs`/`fetch`)。自主可控不是口号。

## 2. 备份模型:快照 + 内容寻址去重

远端目录布局(全部位于用户配置的 `remotePrefix` 之下):

```
<remotePrefix>/
├── meta.json                     插件标记:{plugin:'dsh-like-zcode', note:…}
├── keymeta.json                  加密元数据:{salt, check}(仅启用加密时;明文存放,不含密钥)
├── blobs/<sha256前2位>/<sha256>  内容寻址存储块(gzip 压缩后[+AES-256-GCM 加密])
└── snapshots/<id>.json.gz        快照清单(gzip,可选加密)
```

快照清单(manifest)v1 结构:

```jsonc
{
  "v": 1,
  "id": "20260927-223000",
  "root": "E:\\demo",
  "startedAt": 1790000000000,
  "finishedAt": 1790000001000,
  "host": "DESKTOP-XXX",
  "counts": { "files": 42411, "bytes": 328425472, "uploaded": 3, "uploadedBytes": 1048576,
              "skippedUnchanged": 42408, "skippedTooBig": 0, "errors": 0 },
  "files": [ { "p": "src/index.ts", "h": "<sha256>", "s": 1234, "m": 1790000000000 } ]
}
```

一次运行的状态机:`idle → scanning → uploading → finalizing → done|error`,
全程支持 `pause / resume / cancel`。

### 为什么是"清单 + 去重块"而不是整包 tar

ZCode 事件里的 313MB 加密包每次都要全量重传。内容寻址 + 去重意味着:
第二次备份只有真正变化的文件会走网络(通常接近 0 字节),却保留了每一次
运行时点的完整快照——比"整包"更快、更省、更能体现"564 次上传"有多多余。

### 加密(可选,默认关)

- 密钥:`scrypt(passphrase, salt)`,salt 存 `keymeta.json`,**私钥永不离开本机**
  (反着致敬"私钥仅存云端")。
- 存储块:`gzip → AES-256-GCM`。IV = `HMAC-SHA256(key, "iv:" + 明文hash).slice(0,12)`,
  即**收敛加密**:同一内容密文相同,去重依旧成立;代价是"内容是否相同"这一信息
  本身对服务器可见——这是内容寻址去重的固有属性,文档明示,由用户选择是否启用加密。
- 清单同样加密;`keymeta.json` 中存 `HMAC(key, "like-zcode-check")` 用于校验口令。

### 带宽自律(不挤占正常网络)

- **令牌桶限速**:`maxUploadKBps`(默认 4096 KB/s),全局作用于所有上传字节。
- **并发上限**:默认 2 路上传。
- **自适应退避**:运行中对后端做轻量 RTT 探测,延迟升高自动降速至 50%/25%,恢复后回升。
- **时间窗**:`window` 模式下只在配置时段(默认 02:00–07:00)自动备份。

### 大文件

- 单文件上限 `maxFileMB`(默认 512MB),超限记录为 `skippedTooBig` 并在日志说明。
- S3 后端对 >32MB 的块走 multipart(16MB 分片,峰值内存约 2×16MB)。

## 3. 后端接口

```ts
interface BackupBackend {
  kind: 'localdir' | 'webdav' | 's3'
  init(): Promise<void>                        // 建目录骨架 / 写 meta.json
  hasBlob(hash: string): Promise<boolean>      // HEAD
  putBlob(hash: string, data: Buffer): Promise<void>       // 内容块
  getBlob(hash: string): Promise<Buffer>       // 还原用
  putManifest(id: string, data: Buffer): Promise<void>
  listManifests(): Promise<{ id: string; size: number; lastModified: number }[]>
  getManifest(id: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>     // 保留策略清理
  test(): Promise<string>                      // 连通性测试(设置页按钮)
  probeLatency?(): Promise<number | null>      // 自适应限速用
}
```

| 后端 | 覆盖场景 |
|---|---|
| `localdir` | 本地/移动硬盘、U 盘、Windows 映射盘(`Z:\` → SMB/CIFS 直连 NAS) |
| `webdav` | 群晖/威联通 NAS、坚果云、Nextcloud、Alist、InfiniCloud 等 |
| `s3` | 任何 S3 兼容:阿里云 OSS、腾讯云 COS、七牛 Kodo、华为 OBS、Cloudflare R2、Backblaze B2、MinIO、AWS S3 |

各厂商接入参数详见 [BACKENDS.md](./BACKENDS.md)。

## 4. 静默的边界(说清楚"无通知")

- **自动备份(计划触发)**:不产生任何会话消息、任何 UI 提示、任何弹窗。
  日志只落本地 `~/.dsh/like-zcode/logs/`。这是梗本体的复刻。
- **手动动作**(`/backup` 命令、设置页按钮):用户亲手触发,给一句确认文案,
  不跟踪刷屏。用户自己的操作应当有回声。
- **可见性**:`设置 → 插件 → Like ZCode` 卡片实时轮询 `/dsh-like-zcode/status`
  展示进度(阶段/进度条/速度/ETA/当前文件/快照历史)。
- **总闸**:插件配置 `enabled` 默认 `false`——不配置服务器、不打开开关,
  它一个字节都不会动。

## 5. dsh 宿主接入面(能力探测,同 dsh-cli-bridge 纪律)

| 服务 | 用法 | 缺席时 |
|---|---|---|
| `settings` | `settings.register('like-zcode', ConfigSchema)` + watch → 引擎热更新 | 用 patch 层默认配置,设置卡只读 |
| `webServer`/`httpServer` | exact 路由 `/dsh-like-zcode/{status,snapshots,log,run,pause,resume,cancel,test}` | 设置页显示降级提示 |
| `commands` | `/backup [now|status|pause|resume|cancel]` | 仅设置页可用 |

调度器:60s 心跳,`interval` / `window` 两种自动模式;`manual` 只响应手动触发。
进程内运行,不弹子进程、不注册系统服务、不写注册表、不开机自启。

## 6. 安全与边界

- 路由沿用 `assertTrustedOrigin` 围栏(Origin/Host 校验 + DNS rebinding 防线)。
- 凭据(S3 SK / WebDAV 密码 / 口令)只存 dsh `settings.yaml` 与本地日志脱敏后形态,
  不进快照、不进日志、不进状态文件;HTTP 接口对凭据字段做脱敏。
- 不收集遥测、不检查更新、不访问任何非用户配置的域名(代码里没有别的 URL)。
