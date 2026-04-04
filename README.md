# QIHANG v0.1 Monorepo

本仓库实现 QIHANG Website v0.1：公共官网 + 在线 Demo + 登录控制台（训练、评测、发布闭环，支持 mock AI）。

## 目录

- `apps/web`: Next.js 前端
- `apps/api`: FastAPI + SQLAlchemy 后端 API
- `docker`: Dockerfiles 与本地完整开发栈 compose（其中 worker 直接复用 `apps/api` 代码）
- `scripts/dev.sh`: 一键启动本机快速开发环境

## 一键启动

前提：
- 已安装 Docker / Docker Compose
- macOS 如果使用 Colima，需要先确保 Colima 已启动，且 Docker context 指向 `colima`

推荐先做一次环境确认：

```bash
docker info
docker context ls
```

如果你在 macOS 上用 Colima，建议先执行：

```bash
colima start
docker context use colima
```

首次启动前，建议先复制一份本地 env：

```bash
cp .env.example .env
```

然后在仓库根目录执行：

```bash
./scripts/dev.sh
```

默认现在走“本机快速模式”：
- `postgres`、`redis`、`minio`、`minio-init` 继续通过 Docker Compose 启动
- `api`、`worker`、`web` 改为本机进程启动，避免每次改代码都重新构建镜像
- 再次执行同一个命令时，会先停掉旧的本机进程，再用当前文件版本重启
- `api` 用 `uvicorn --reload`，`web` 用 `next dev`，所以大多数前后端改动本身就会自动热更新

如果你明确想强制重装本机依赖，再执行：

```bash
./scripts/dev.sh --rebuild
```

如果你需要把旧进程、旧容器状态一起清掉，并顺手清空本地 Playwright 产物，再执行：

```bash
./scripts/dev.sh --clean
```

如果你要回到原来的完整 Docker 构建模式，再执行：

```bash
./scripts/dev.sh --docker
```

如果你要启用 Gmail 验证码邮件，再编辑根目录 `.env`，填入：

```bash
SMTP_USER=your-mailbox@gmail.com
SMTP_PASSWORD=your-16-char-gmail-app-password
SMTP_FROM_ADDRESS=your-mailbox@gmail.com
```

`.env` 已被 `.gitignore` 忽略，不要把真实密码写回仓库里的 `docker/docker-compose.yml`。

如果这里报：

```bash
zsh: permission denied: ./scripts/dev.sh
```

说明脚本缺少执行权限，先执行：

```bash
chmod +x ./scripts/dev.sh
```

这个脚本会自动完成：
- 默认启动 `postgres`、`redis`、`minio`、`minio-init` 容器，并本机启动 `api`、`worker`、`web`
- 每次运行前先轻量清理一次 Docker 的无用残留：停止容器、悬空镜像、构建缓存
- 自动停掉旧的本机 `api` / `worker` / `web` 进程，避免端口冲突
- 当 `apps/api/pyproject.toml` 或 `apps/web/package*.json` 变化时，自动补装本机依赖；显式执行 `--rebuild` 时会强制重装
- 等待 API、Web、Worker 都进入可用状态后再返回
- 本机日志统一写入 `tmp/dev-local/logs`
- 如果你明确指定 `--docker`，才会走原来的镜像构建和容器替换逻辑

启动完成后访问：
- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API 健康检查: `http://localhost:8000/health`
- MinIO Console: `http://localhost:9001`

所有端口默认只绑定到 `127.0.0.1`，不会对局域网公开。

说明：
- 默认 `./scripts/dev.sh` 不再重建 `web` / `api` / `worker` 镜像，所以本机改代码后的启动速度会明显更快
- 默认每次运行会做一次轻量 Docker 清理；只有 `--docker` 模式命中磁盘不足时，才会进一步清理未使用的大镜像并自动重试构建
- `./scripts/dev.sh` 会等待 `API`、`Web`、`Worker` 都可访问后再返回；首次本机依赖安装会慢一些，之后通常只需要数秒
- `worker` 没有热更新机制；如果你改了 Celery 任务代码，可以继续直接再执行一次 `./scripts/dev.sh`
- 启动时如果看到 `Docker Compose requires buildx plugin to be installed`，只影响 `--docker` 模式；默认本机快速模式不会构建应用镜像

如果你只是想确认服务是否已经起来，执行：

```bash
curl -I http://localhost:3000
curl -I http://localhost:8000/health
docker compose -f docker/docker-compose.yml ps
```

如果你需要停止整套服务，执行：

```bash
pkill -F tmp/dev-local/pids/web.pid 2>/dev/null || true
pkill -F tmp/dev-local/pids/api.pid 2>/dev/null || true
pkill -F tmp/dev-local/pids/worker.pid 2>/dev/null || true
docker compose -f docker/docker-compose.yml down
```

说明：
- 如果目标是“本机改代码后快速验证整套服务”，直接使用 `./scripts/dev.sh`
- 如果你要验证真正的容器构建结果，再切到 `./scripts/dev.sh --docker`

默认本地账号：
- MinIO 用户名：`minioadmin`
- MinIO 密码：`minioadmin`

默认本地对象存储 bucket：
- `qihang-private`
- `qihang-demo`

其中：
- `qihang-private` 用于数据集、训练产物、模型产物
- `qihang-demo` 用于匿名 Demo 临时文件，默认配置 1 天生命周期清理

## 本地开发默认值

一键启动默认会把 Docker 内网地址自动换成本机地址，核心值包括：
- `COOKIE_DOMAIN=""`
- `COOKIE_SECURE=false`
- `S3_ENDPOINT=http://localhost:9000`
- `S3_PRESIGN_ENDPOINT=http://localhost:9000`
- `S3_PRIVATE_BUCKET=qihang-private`
- `S3_DEMO_BUCKET=qihang-demo`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
- `NEXT_PUBLIC_ASSET_ORIGIN=http://localhost:9000`

API 启动时会自动建表，因此本地一键启动不需要再手动执行迁移。

如果你想改本地非敏感默认值，优先改根目录 `.env`。涉及密码、JWT、SMTP 这类 secret 时，也统一改根目录 `.env`。`./scripts/dev.sh` 在默认本机快速模式下会自动读取这个文件，并把 `postgres` / `redis` / `minio` / `api` 这些 Docker 内网地址改写成对应的 `localhost` 地址。只有在 `--docker` 模式下，才直接按 compose 内部地址运行。

## Gmail SMTP 与部署

推荐约定：

- 本地开发：复制 `.env.example` 为 `.env`
- 服务器部署：把同样的变量放到仓库外的文件，例如 `/etc/mingrun/mingrun.env`
- 该文件权限设为 `600`
- Gmail 只使用 App Password，不使用邮箱登录密码

服务器上建议这样启动：

```bash
docker compose \
  --env-file /etc/mingrun/mingrun.env \
  -f docker/docker-compose.yml \
  up -d --build
```

这样做的好处是：

- secret 不进 Git
- 更新代码时不需要重写密码
- 同一套 compose 可以同时用于本地和服务器
- 以后切换到 SES、Postmark、Resend 时，只需要改 env 文件，不用改代码

如果当前仓库里出现过真实 Gmail App Password，建议现在就去 Google 账户后台把这枚 App Password 轮换掉。

## API 重点

- 统一前缀：`/api/v1`
- 统一错误结构：
```json
{
  "error": {
    "code": "string_enum",
    "message": "human_readable",
    "details": {},
    "request_id": "uuid"
  }
}
```
- Auth: `register/login/logout/me`，Access Token 通过 HttpOnly Cookie
- Upload: presign + complete + worker 异步处理
- 所有浏览器危险方法请求需要 `Origin/Referer` + `X-CSRF-Token`
- Train: job 状态机 + 轮询 + SSE 事件流
- Model Registry: versions + alias 发布/回滚

## 数据库迁移

```bash
cd apps/api
uv pip install -e '.[dev]'
alembic upgrade head
```

迁移说明：
- `202602150001`: 初始 schema（按 Spec）
- `202602150002`: 软删与清理状态字段
- `202602150003`: 性能索引与约束增强
- `202603120001`: 清理 ORM 重复匿名索引并补齐命名索引

## 测试

后端集成测试：
```bash
cd apps/api
uv venv .venv
uv pip install --python .venv/bin/python -e '.[dev]'
.venv/bin/python -m pytest -q
```

## 人工验收脚本

1. 打开 `/` 与 `/demo`，上传图片，确认结果与圆盘屏模拟器显示。
2. 注册账号并进入 `/app`。
3. 创建项目 -> 创建数据集 -> 上传样本 -> 打标签 -> Commit 版本。
4. 创建训练任务（mock）-> 在 `/app/train/{id}` 查看状态、日志和曲线。
5. 在 `/app/models/{id}` 设置 alias=prod，并执行 rollback。
6. 删除数据集后，列表不可见，后端保留软删与异步清理入口。

## 图片素材占位（ImagePlaceholder）

部分品牌图片素材（Logo、广告图、耳机特写等）尚未就绪，代码中使用 `<ImagePlaceholder>` 组件占位。

使用方式：
```tsx
import { ImagePlaceholder } from "@/components/ImagePlaceholder";

<ImagePlaceholder label="品牌 Logo" aspect="3/1" icon="logo" />
<ImagePlaceholder label="耳机正面特写" aspect="16/9" icon="photo" />
```

- `label`：素材描述，标注该位置需要什么图
- `aspect`：宽高比（如 `"16/9"`、`"1/1"`、`"3/1"`）
- `icon`：占位图标类型 — `image` | `logo` | `photo` | `video`

渲染效果：品牌蓝虚线边框 + 图标 + 标签文字，自动适配亮/暗主题。

**注意：** 现有的 `AssetPlaceholder` 组件是内容卡片占位（`eyebrow/title/summary/specs`），用于产品特性描述，和 `ImagePlaceholder` 用途不同。

**替换素材时：** 全局搜索 `ImagePlaceholder` 找到所有待替换位置，将组件替换为 `<Image>` 或 `<img>` 即可。

## 常见问题

- `./scripts/dev.sh` 报 `zsh: permission denied: ./scripts/dev.sh`：执行 `chmod +x ./scripts/dev.sh` 后重试。
- `Cannot connect to the Docker daemon at unix:///Users/.../.colima/default/docker.sock`：通常是 Docker CLI 正在使用 `colima` context，但 Colima 没启动。先执行：

```bash
colima start
docker context use colima
docker info
```

- `colima start` 失败且日志里出现 `attach disk ... in use by instance "colima"`：说明上一次 Colima 退出不干净。先执行：

```bash
colima stop --force
colima start
docker context use colima
```

- `./scripts/dev.sh` 卡住：先执行 `docker compose -f docker/docker-compose.yml logs -f` 看具体服务日志；如果刚改过前后端文件，脚本这次可能正在自动重建镜像。
- `docker-web` 卡在 `RUN npm ci`：第一次构建通常最慢，`sharp` 之类的依赖会在安装阶段下载或校验原生二进制。现在 `docker/Dockerfile.web` 会对 `npm ci` 自动重试 3 次，并支持通过根目录 `.env` 里的 `NPM_CONFIG_REGISTRY` 切换 registry；如果想确认不是假卡住，可单独执行 `docker compose --progress=plain -f docker/docker-compose.yml build web` 看详细进度。
- `docker-web` 报 `npm ERR! ECONNRESET` / `network aborted`：这是 Docker 构建期连 npm registry 被重置。优先在根目录 `.env` 里设置 `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`，然后重新执行 `docker compose -f docker/docker-compose.yml build web`。
- Cookie 不生效：检查 `COOKIE_DOMAIN`、`COOKIE_SECURE`、`CORS_ORIGINS` 是否仍是本地默认值。
- 上传失败：确认 MinIO 可访问，且 bucket 名称为 `qihang-private` / `qihang-demo`。
- 浏览器出现对象存储或跨域错误：检查 `NEXT_PUBLIC_ASSET_ORIGIN`、`S3_PRESIGN_ENDPOINT`、CSP 和本地端口是否一致。
- 训练任务不执行：检查 `worker` 和 `redis` 是否健康。

## 运维命令

查看服务状态：

```bash
docker compose -f docker/docker-compose.yml ps
```

查看日志：

```bash
docker compose -f docker/docker-compose.yml logs -f
```

停止整套本地栈：

```bash
docker compose -f docker/docker-compose.yml down
```
