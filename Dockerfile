FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package.json ./
RUN npm install --production

# 复制源码
COPY server.js ./
COPY public ./public

# 数据持久化目录
RUN mkdir -p /app/data

# 如果没有 data.json，首次启动时从英伟达密钥.txt 导入
ENV NODE_ENV=production

EXPOSE 20128

CMD ["node", "server.js"]
