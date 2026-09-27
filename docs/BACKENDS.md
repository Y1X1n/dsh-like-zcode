# 备份目标接入指南(各云厂商 / NAS / 本地)

本插件支持三类后端,**全部由你持有凭据**:

| 后端 | 覆盖 | 何时选它 |
|---|---|---|
| `localdir` | 本地盘、移动硬盘、U 盘、**Windows 映射盘(SMB 直连 NAS)** | 最简单;NAS 走局域网,零公网流量 |
| `webdav` | 群晖、威联通、坚果云、Nextcloud、Alist 等 | NAS 有 WebDAV 套件时;或用网盘 |
| `s3` | 阿里云 OSS、腾讯云 COS、七牛、华为 OBS、Cloudflare R2、Backblaze B2、MinIO、AWS | 主流云对象存储 |

通用设置项:

- **路径前缀**(`remotePrefix`):远端数据全部放在该前缀目录下,默认 `dsh-like-zcode`;
  同一个 bucket/目录可以用不同前缀隔离多台机器的备份
- **测试连接**:保存前先点它,连通性立等可见(只做只读探测,不落数据)

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

## WebDAV

| 字段 | 填法 |
|---|---|
| 地址 | 形如 `http://nas:5005` 或 `https://dav.jianguoyun.com/dav/`(末尾带不带 `/` 均可) |
| 用户名 / 密码 | 见各家说明;坚果云必须用**应用密码** |

### 群晖 DSM

1. 套件中心 → 安装 **WebDAV Server** → 启用 HTTP(5005)或 HTTPS(5006)端口
2. 地址填 `http://NAS局域网IP:5005`,账号密码即 DSM 登录账密
3. 建议为备份单独建一个 DSM 账号,只授予目标共享目录读写权

### 坚果云

1. 登录网页版 → 账户信息 → 安全选项 → **添加应用密码**
2. 地址 `https://dav.jianguoyun.com/dav/`,用户名 = 注册邮箱,密码 = 应用密码
3. 注意:免费版流量配额较小(上传 1GB/月量级),大仓库建议配合去重 + 夜间窗口,或换 NAS/对象存储

### Nextcloud / ownCloud

```
地址:https://你的域名/remote.php/dav/files/<你的用户名>/
```

### Alist

```
地址:http://Alist主机:5244/dav/
账号密码:Alist 后台设定的 WebDAV 凭据
```

### 威联通 QTS

QTS 原生 WebDAV 不统一,两条路任选:装 **HybridMount** 启用 WebDAV,或更省事——
直接用 SMB 映射盘走 `localdir` 后端。

---

## S3 兼容(云厂商)

| 字段 | 说明 |
|---|---|
| Endpoint | 各家 S3 兼容端点(见下表),带不带 `https://` 均可 |
| Region | 各家区域标识 |
| Bucket | 先在控制台建好 |
| AccessKeyId / SecretAccessKey | 控制台创建的密钥(建议最小权限:只授该 bucket 读写) |
| path-style | 寻址方式:MinIO/R2/B2 勾选(true);多数公有云保持勾选即可,个别失败再取消尝试虚拟主机式 |

### 阿里云 OSS

```
Endpoint:https://oss-cn-hangzhou.aliyuncs.com    Region:oss-cn-hangzhou
```

Region 与 Endpoint 的地域段保持一致(如北京:`oss-cn-beijing`);Bucket 选择与服务器同地域可走内网端点(`oss-cn-hangzhou-internal.aliyuncs.com`,免流量费)。

### 腾讯云 COS

```
Endpoint:https://cos.ap-beijing.myqcloud.com     Region:ap-beijing
```

同样有内网端点 `cos.ap-beijing-internal.myqcloud.com`(与云主机同地域时)。

### 七牛云 Kodo

```
Endpoint:https://s3.cn-north-1.qiniucs.com       Region:cn-north-1
```

(按存储区域替换:S3 兼容端点在七牛控制台「空间概览 → S3 兼容」可查。)

### 华为云 OBS

```
Endpoint:https://obs.cn-north-4.myhuaweicloud.com  Region:cn-north-4
```

### Cloudflare R2

```
Endpoint:https://<账户ID>.r2.cloudflarestorage.com   Region:auto   path-style:勾选
```

账户 ID 在 R2 控制台右上;需先创建 API Token(权限:Object Read & Write,仅指定 bucket)。

### Backblaze B2

```
Endpoint:https://s3.us-west-004.backblazeb2.com   Region:us-west-004   path-style:勾选
```

(Endpoint 在 B2 Bucket 详情页的 "S3 Endpoint"。)

### MinIO / 自建对象存储

```
Endpoint:http://minio主机:9000    Region:留空(默认 us-east-1)   path-style:勾选
```

### AWS S3

```
Endpoint:https://s3.us-east-1.amazonaws.com       Region:us-east-1
```

新_bucket 强制虚拟主机式寻址,若 path-style 报错请取消勾选。

---

## 加密与多机注意事项

- 开启加密后,`keymeta.json`(仅 salt + 校验令牌)存在远端与本地;换机器备份时填同一口令即可对上
- **开启加密后建议更换路径前缀**:旧前缀里可能有未加密的历史数据块
- 追加式贡献多台机器:同前缀即同仓库,内容寻址自动跨机器去重
