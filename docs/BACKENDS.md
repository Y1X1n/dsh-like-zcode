# 备份目标接入指南(逐家详细流程)

本插件支持三类后端,**全部由你持有凭据**。所有厂商预设已内置(设置 → 插件 → Like ZCode → 备份目标 → 服务商预设),选厂商即自动填好 endpoint/region/寻址方式,你只需按下面流程准备"账号 + 桶 + 密钥"。

| 后端 | 覆盖 | 何时选它 |
|---|---|---|
| `localdir` | 本地盘、移动硬盘、U 盘、**Windows 映射盘(SMB 直连 NAS)** | 最简单;NAS 走局域网,零公网流量 |
| `webdav` | 群晖、威联通、坚果云、Nextcloud、Alist、ECS 自建(like-zdav.py) | NAS 有 WebDAV 套件,或手里只有一台云服务器 |
| `s3` | 阿里云 OSS、腾讯云 COS、华为云 OBS、京东云 OSS、七牛 Kodo、Cloudflare R2、Backblaze B2、MinIO、AWS S3 | 主流云对象存储 |

通用字段说明:

- **路径前缀**(`remotePrefix`):远端数据全部放在该前缀之下,默认 `dsh-like-zcode`;
  **0.1.7 起每个备份目录会自动生成自己的子文件夹** `<remotePrefix>/<工作区slug>/`,
  互不掺和;同一台服务器备份多个项目时,桶里就是多个文件夹
- **测试连接**:保存前先点它,只做只读探测,不落数据
- **建议顺手开启端到端加密**:密文落盘,云厂商那边也看不到内容(开启后建议换一个新的路径前缀)

---

## S3 兼容:公有云厂商

所有 S3 兼容厂商的流程都是同一套:**开通服务 → 建桶 → 拿密钥(AK/SK)→ 插件选预设 → 填桶名和密钥 → 测试连接**。差别只在控制台入口和地域代码。

### 阿里云 OSS

1. 开通:控制台搜「对象存储 OSS」,首次使用按提示开通(按量付费,存储约 0.12 元/GB/月)
2. 建桶:OSS 控制台 → **创建 Bucket** → 名称(全网唯一,如 `yixin-backup`)→ 地域选离你最近的(如 **华东1-杭州**)→ 读写权限选**私有** → 其余默认
3. 密钥:右上角头像 → **AccessKey 管理** → 继续使用 AccessKey(或更安全:创建一个 RAM 子账号,只授予该 Bucket 的读写权限)→ 拿到 **AccessKeyId** 和 **AccessKey Secret**
4. 插件:预设选 **阿里云 OSS**(自动填杭州端点)→ **Bucket** 填桶名 → **AK/SK** 填密钥 → 地域按实际桶调整(如 `oss-cn-beijing`)
5. **省流量技巧**:插件跑在与 OSS 同地域的 ECS 上时,把 Endpoint 换成内网形态 `oss-cn-hangzhou-internal.aliyuncs.com`,流量免费
6. 常见坑:AK 被禁用/删了(报 403 InvalidAccessKeyId);时钟偏差(报 RequestTimeTooSkewed,同步系统时间)

### 腾讯云 COS

1. 开通:控制台搜「对象存储 COS」→ 首次开通
2. 建桶:**存储桶列表 → 创建存储桶** → 名称(如 `yixin-backup-1250000000`,会自动带 APPID 后缀,**整个带后缀的名称**填进 Bucket 字段)→ 地域(如 **北京**)→ 权限**私有读写**
3. 密钥:**访问管理 CAM → API 密钥管理** → 新建密钥 → 拿到 **SecretId**(填 AccessKeyId)和 **SecretKey**(填 SecretAccessKey)。注意腾讯的字段名反着叫:SecretId 对应 S3 的 AccessKeyId
4. 插件:预设选 **腾讯云 COS** → Bucket 填完整桶名 → 密钥对号入座 → 地域按实际桶调整(如 `ap-guangzhou`)
5. 常见坑:桶名漏了 APPID 后缀(报签名/NoSuchBucket 错);密钥把 SecretId 当成 SecretKey

### 华为云 OBS

1. 开通:控制台搜「对象存储服务 OBS」
2. 建桶:OBS 控制台 → **创建桶** → 名称 → 区域(如 **华北-北京四**)→ 策略**私有**
3. 密钥:控制台右上角 **我的凭证 → 访问密钥 → 新增访问密钥** → 下载 `credentials.csv` → 里面有 **Access Key Id** 和 **Secret Access Key**
4. 插件:预设选 **华为云 OBS** → Bucket / AK / SK 按实际填
5. 常见坑:华为云 IAM 子用户需要在策略里显式授予 OBS 的读写权限,主账号密钥默认全通

### 京东云 OSS

1. 开通:控制台搜「对象存储」
2. 建桶:对象存储控制台 → **创建空间** → 名称 → 地域(如 **华北-北京**)
3. 密钥:**Access Key 管理**(右上角账号菜单)→ 创建 **Access Key / Secret Key**
4. 插件:预设选 **京东云 OSS**。S3 兼容端点格式为 `s3.{region}.jdcloud-oss.com`,预设填了华北-北京 `https://s3.cn-north-1.jdcloud-oss.com`,其他地域把 `cn-north-1` 换成对应地域代码,以控制台「空间详情 → 兼容 S3」展示的 Endpoint 为准
5. 参考:[京东云官方文档 · 对象存储 兼容 S3](https://docs.jdcloud.com/cn/object-storage-service/product-overview)

### 七牛云 Kodo

1. 开通:控制台搜「对象存储 Kodo」→ **新建空间** → 名称 → 存储区域(如 **华东-浙江**)
2. 密钥:右上角头像 → **密钥管理** → 拿到 **AK / SK**(七牛的 AK/SK 就是 S3 的 AccessKeyId/SecretAccessKey)
3. 插件:七牛暂无内置预设,选 **自定义** + 类型 s3,Endpoint 按 `s3.{region}.qiniucs.com` 填:

| 存储区域 | Endpoint | Region |
|---|---|---|
| 华东-浙江 | `https://s3.cn-east-1.qiniucs.com` | `cn-east-1` |
| 华东-浙江2 | `https://s3.cn-east-2.qiniucs.com` | `cn-east-2` |
| 华北-北京 | `https://s3.cn-north-1.qiniucs.com` | `cn-north-1` |
| 华南-广州 | `https://s3.cn-south-1.qiniucs.com` | `cn-south-1` |
| 北美 | `https://s3.na0.qiniucs.com` | `na0` |
| 东南亚 | `https://s3.as0.qiniucs.com` | `as0` |

4. 常见坑:老空间需要在空间设置里确认 S3 兼容访问可用;签名用 SigV4(本插件已是)

### Cloudflare R2(免费额度最香)

免费额度:**10GB 存储 / 每月 100 万次写 / 1000 万次读 / 流出流量完全免费**——对去重后的代码备份基本用不满。

1. 开通:控制台左侧 **R2 Object Storage** → 按提示激活(需绑一张卡/付款方式,免费额度内不扣费)
2. 建桶:R2 页 → **Create bucket** → 名称(如 `my-backup`)→ Location 选 APAC
3. 拿账户 ID:R2 概览页**右侧边栏的 Account ID**(32 位十六进制)——用于拼 Endpoint
4. 密钥:R2 页 → **Manage R2 API Tokens**(管理 R2 API 令牌)→ **Create API Token** → 权限 **Object Read & Write** → 范围 **Apply to specific buckets only** → 只勾你的桶 → 创建后显示:
   - **Access Key ID** → 插件的 AccessKeyId
   - **Secret Access Key** → 插件的 SecretAccessKey(⚠️ 只显示一次,立即保存)
5. 插件:预设选 **Cloudflare R2** → 把 Endpoint 里的 `<账户ID>` 换成第 3 步的值 → **Bucket** 填桶名 → **Region 保持 auto** → **path-style 保持勾选**
6. 常见坑:Endpoint 里不能带桶名;令牌只显示一次;⚠️ 令牌如果截图/贴到聊天里过,测完建议删掉重建
7. 参考:[Cloudflare R2 文档](https://developers.cloudflare.com/r2/)

### Backblaze B2

1. 建桶:B2 控制台 → **Create a Bucket** → 名称 → **Private**
2. 密钥:App Keys → **Add a New Application Key** → 勾选该桶 → 拿到 **keyID**(AccessKeyId)和 **applicationKey**(SecretAccessKey)
3. 插件:选 **自定义** + 类型 s3。Endpoint 在桶详情页的 **S3 Endpoint**(如 `https://s3.us-west-004.backblazeb2.com`),Region 填 `us-west-004`,**path-style 勾选**
4. 优势:10GB 免费,流出流量便宜;缺点:国内访问速度一般

### MinIO / 自建对象存储

```
Endpoint:http://minio主机:9000    Region:留空(默认 us-east-1)    path-style:勾选
```

密钥:MinIO 控制台 → Access Keys → Create access key。自建的最稳,没有兼容性 surprises。

### AWS S3

```
Endpoint:https://s3.us-east-1.amazonaws.com    Region:us-east-1
```

IAM 建用户拿 AK/SK,只授该桶的 `s3:GetObject/PutObject/ListBucket/DeleteObject`。新桶强制虚拟主机式寻址,path-style 报错就取消勾选。

---

## WebDAV

### 群晖 DSM

1. **套件中心** → 搜索安装 **WebDAV Server** → 启动 → 启用 HTTP(5005)/HTTPS(5006)
2. 建议新建一个 DSM 账号,只授予目标共享文件夹的读写权限(别用 admin)
3. 插件:预设选 **群晖 DSM** → 地址改成 `http://NAS局域网IP:5005` → 账号密码即该 DSM 账号

### 威联通 QTS

QTS 的 WebDAV 支持不成体系,两条路:装 **HybridMount** 启用 WebDAV;或者更省事——
直接把 NAS 共享映射成 Windows 盘走 `localdir`(见下节)。

### 坚果云

1. 登录[网页版](https://www.jianguoyun.com) → 右上角用户名 → **账户信息 → 安全选项 → 添加应用密码**(输入名称如 like-zcode → 生成)
2. 插件:预设选 **坚果云** → 用户名填**注册邮箱** → 密码填**应用密码**(登录密码不行!)
3. 免费额度:**每月上传 1GB / 下载 3GB**,空间约 3GB——纯文档够用,大仓库请去重+限速,或换 NAS/对象存储。以[坚果云帮助中心](https://help.jianguoyun.com)最新政策为准

### Nextcloud / ownCloud

```
地址:https://你的域名/remote.php/dav/files/<你的用户名>/
```

### Alist

```
地址:http://Alist主机:5244/dav/    账号密码:Alist 后台 → 用户 → WebDAV 权限
```

---

## ECS / 云服务器(只有一台云主机?推荐这个)

手里只有一台 ECS、不想上对象存储:随插件附带 **`server/like-zdav.py`**——单文件、
纯 Python 标准库(约两百行,可整个读完再跑)的极简 WebDAV 服务端。不用 docker、
不用 pip、不用 root:

```bash
# 1. 传上服务器
scp server/like-zdav.py user@你的ECS:~/like-zdav.py

# 2. 在 ECS 上启动(--token 换成长口令;安全组放行该端口)
ssh user@你的ECS "nohup python3 ~/like-zdav.py --dir ~/backup --port 8060 --token 换个长口令 >/dev/null 2>&1 &"
```

插件:预设选 **ECS 自建(like-zdav.py)** → 地址改成 `http://ECS公网IP:8060` → 密码填 `--token`。

要点:

- 数据只落在 `--dir` 指定的目录;服务端就一个文件,建议通读一遍再跑
- 开机自启:写一个 systemd unit,或 crontab 加 `@reboot`
- 公网明文 HTTP 有被嗅探的理论风险:介意就套 Nginx 反代加 TLS,或直接开插件的
  端到端加密——密文落盘,服务器自己也看不到内容
- 云厂商安全组/防火墙记得放行端口(阿里云/腾讯云都在控制台"安全组规则"里加)

---

## localdir(本地 / 移动硬盘 / NAS 映射盘)

| 字段 | 填法 |
|---|---|
| 目录 | 备份落盘目录,如 `E:\backups` 或映射盘 `Z:\backups` |

NAS 走 SMB 映射盘(群晖/威联通/TrueNAS/UNRAID 通用):

```bat
:: 映射 NAS 共享到 Z: 盘(资源管理器里操作等效)
net use Z: \\NAS主机名\共享名 /persistent:yes
```

然后把「目录」填 `Z:\backups`。数据全程局域网,不经公网;限速同样生效(保护 NAS 磁盘)。

---

## 加密与多机注意事项

- 开启加密后,`keymeta.json`(仅 salt + 校验令牌)存在远端与本地;换机器备份时填同一口令即可对上
- **开启加密后建议同时更换路径前缀**:旧前缀里可能有未加密的历史数据块
- 多台机器备份到同一前缀:内容寻址自动跨机器去重
- 老版本(0.1.6 及以前)备份的数据在 `<remotePrefix>/` 根下,0.1.7 起新备份在
  `<remotePrefix>/<工作区slug>/` 子文件夹里——旧数据可手动清理,不影响使用
