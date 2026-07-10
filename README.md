# nvidia-free

**免费使用 NVIDIA NIM API，实现高并发 AI 编程体验。**

带 Web 管理面板，支持多 Key 轮询、自定义代理 Key、模型选择。

## 快速开始

### 方式一：Docker 一键部署（推荐）

```bash
# 克隆项目
git clone <your-repo-url> && cd nvidia-free

# 一键启动
docker compose up -d

# 查看日志
docker compose logs -f
```

启动后访问 `http://你的IP:20128` 打开管理面板。

### 方式二：本地运行

```bash
# 安装依赖
npm install

# 启动
npm start

# 或 Windows 双击
启动.bat
```

## 功能

- 🎨 **Web 管理面板**：可视化管理 API Key、查看日志、配置模型
- 🔄 **多 Key 轮询**：添加多个 NVIDIA API Key，自动轮询负载均衡
- 🛡️ **自定义代理 Key**：可设置客户端连接密码，防止滥用
- 📋 **模型选择器**：从 NVIDIA API 自动拉取可用模型列表，点击选择
- 📊 **实时监控**：请求统计、错误计数、运行时间
- 🐳 **Docker 部署**：一键 `docker compose up -d` 启动

## 客户端配置

在 Claude Code / Cursor / Codex 等工具中配置：

```
Endpoint:  http://你的IP:20128/v1
API Key:   管理面板中设置的代理 Key（如未设置则任意值）
Model:     选择支持的模型
```

## Docker 部署详解

### 目录结构

```
nvidia-free/
├── Dockerfile
├── docker-compose.yml
├── server.js
├── public/          # 前端页面
└── data/            # 挂载目录，保存 keys 和配置（自动生成）
```

### 自定义端口

修改 `docker-compose.yml` 中的端口映射：

```yaml
ports:
  - "8080:20128"  # 改为 8080
```

### 导入已有 Key

1. 通过管理面板 Web UI 添加
2. 或将 `英伟达密钥.txt` 挂载进容器（取消 `docker-compose.yml` 中的注释）

### 数据持久化

`./data` 目录会自动挂载到容器内，保存所有配置和 Key 数据。容器重建不会丢失。

## 环境要求

- Node.js 16+（本地运行）
- Docker + Docker Compose（容器部署）

## 获取英伟达 API Key

访问 https://build.nvidia.com/ 注册并获取免费 API Key。

使用 `注册脚本.txt` 中的油猴脚本可以一键获取 Key。

## 许可证

MIT
