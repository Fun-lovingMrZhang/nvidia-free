const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 20128;
const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ 管理员认证中间件 ============
function requireAdmin(req, res, next) {
  // 未设置 ADMIN_KEY 则跳过认证（向后兼容）
  if (!ADMIN_KEY) return next();
  
  const authHeader = req.headers['x-admin-key'] || req.headers['authorization'] || '';
  const key = authHeader.replace(/^Bearer\s+/i, '').trim();
  
  if (key === ADMIN_KEY) return next();
  
  return res.status(401).json({ error: '需要管理员认证，请提供正确的 Admin Key' });
}

// 检查是否需要认证（给前端用）
app.get('/api/auth/status', (req, res) => {
  res.json({ requireAuth: !!ADMIN_KEY });
});

// 验证管理员密钥
app.post('/api/auth/login', (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY) return res.json({ success: true, message: '未设置管理员密钥' });
  if (key === ADMIN_KEY) return res.json({ success: true });
  return res.status(401).json({ success: false, error: '密钥错误' });
});

// ============ 数据存储 ============
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('加载数据失败:', e.message);
  }
  return { keys: [], settings: { model: 'deepseek-ai/deepseek-r1', baseUrl: 'https://integrate.api.nvidia.com/v1', proxyKey: '' } };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let appData = loadData();

// 如果有英伟达密钥.txt，自动导入
const keyFile = path.join(__dirname, '英伟达密钥.txt');
if (fs.existsSync(keyFile) && appData.keys.length === 0) {
  const lines = fs.readFileSync(keyFile, 'utf-8').split('\n').map(l => l.trim()).filter(l => l.startsWith('nvapi-'));
  lines.forEach(k => {
    appData.keys.push({ key: k, enabled: true, requests: 0, errors: 0, lastUsed: null, status: 'idle' });
  });
  if (lines.length > 0) {
    saveData(appData);
    console.log(`✅ 自动导入了 ${lines.length} 个 API Key`);
  }
}

// ============ 轮询选择器 ============
let currentIndex = 0;

function getNextKey() {
  const enabledKeys = appData.keys.filter(k => k.enabled);
  if (enabledKeys.length === 0) return null;
  
  // 简单轮询
  const key = enabledKeys[currentIndex % enabledKeys.length];
  currentIndex = (currentIndex + 1) % enabledKeys.length;
  return key;
}

// ============ 统计 ============
let stats = {
  totalRequests: 0,
  totalErrors: 0,
  startTime: Date.now(),
  recentLogs: []
};

function addLog(type, message, detail = '') {
  const log = { time: new Date().toISOString(), type, message, detail };
  stats.recentLogs.unshift(log);
  if (stats.recentLogs.length > 200) stats.recentLogs.pop();
}

// ============ API 路由（需要管理员认证）============

// 获取所有 Key
app.get('/api/keys', requireAdmin, (req, res) => {
  res.json(appData.keys.map((k, i) => ({
    id: i,
    key: k.key.substring(0, 12) + '...' + k.key.substring(k.key.length - 6),
    fullKey: k.key,
    enabled: k.enabled,
    requests: k.requests,
    errors: k.errors,
    lastUsed: k.lastUsed,
    status: k.status
  })));
});

// 添加 Key
app.post('/api/keys', requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!key || !key.trim()) return res.status(400).json({ error: 'Key 不能为空' });
  
  const trimmed = key.trim();
  if (appData.keys.find(k => k.key === trimmed)) {
    return res.status(400).json({ error: 'Key 已存在' });
  }
  
  appData.keys.push({ key: trimmed, enabled: true, requests: 0, errors: 0, lastUsed: null, status: 'idle' });
  saveData(appData);
  addLog('info', `添加了新 Key: ${trimmed.substring(0, 12)}...`);
  res.json({ success: true, count: appData.keys.length });
});

// 删除 Key
app.delete('/api/keys/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id < 0 || id >= appData.keys.length) return res.status(404).json({ error: 'Key 不存在' });
  
  const removed = appData.keys.splice(id, 1)[0];
  saveData(appData);
  addLog('info', `删除了 Key: ${removed.key.substring(0, 12)}...`);
  res.json({ success: true });
});

// 切换 Key 状态
app.put('/api/keys/:id/toggle', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id < 0 || id >= appData.keys.length) return res.status(404).json({ error: 'Key 不存在' });
  
  appData.keys[id].enabled = !appData.keys[id].enabled;
  saveData(appData);
  res.json({ success: true, enabled: appData.keys[id].enabled });
});

// 获取统计
app.get('/api/stats', requireAdmin, (req, res) => {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  res.json({
    totalRequests: stats.totalRequests,
    totalErrors: stats.totalErrors,
    activeKeys: appData.keys.filter(k => k.enabled).length,
    totalKeys: appData.keys.length,
    uptime,
    uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
  });
});

// 获取日志
app.get('/api/logs', requireAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(stats.recentLogs.slice(0, limit));
});

// 获取设置
app.get('/api/settings', requireAdmin, (req, res) => {
  res.json(appData.settings);
});

// 更新设置
app.put('/api/settings', requireAdmin, (req, res) => {
  const { model, baseUrl, proxyKey } = req.body;
  if (model !== undefined) appData.settings.model = model;
  if (baseUrl !== undefined) appData.settings.baseUrl = baseUrl;
  if (proxyKey !== undefined) appData.settings.proxyKey = proxyKey;
  saveData(appData);
  res.json({ success: true });
});

// 获取可用模型列表
app.get('/api/models', requireAdmin, async (req, res) => {
  // 使用第一个可用的 Key 来获取模型列表
  const keyObj = appData.keys.find(k => k.enabled && k.key);
  if (!keyObj) {
    return res.json({ models: getDefaultModels() });
  }

  try {
    const response = await fetch(`${appData.settings.baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${keyObj.key}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const models = (data.data || []).map(m => ({
        id: m.id,
        name: m.id,
        owned_by: m.owned_by || 'unknown'
      }));
      // 按名称排序
      models.sort((a, b) => a.id.localeCompare(b.id));
      res.json({ models });
    } else {
      res.json({ models: getDefaultModels() });
    }
  } catch (err) {
    res.json({ models: getDefaultModels() });
  }
});

function getDefaultModels() {
  return [
    { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', owned_by: 'deepseek-ai' },
    { id: 'deepseek-ai/deepseek-v3', name: 'DeepSeek V3', owned_by: 'deepseek-ai' },
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', owned_by: 'meta' },
    { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', owned_by: 'meta' },
    { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B', owned_by: 'google' },
    { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2', owned_by: 'mistralai' },
    { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B', owned_by: 'qwen' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', owned_by: 'nvidia' }
  ];
}

// 测试 Key 连通性
app.post('/api/test-key', requireAdmin, async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Key 不能为空' });
  
  try {
    const response = await fetch(`${appData.settings.baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      res.json({ success: true, message: 'Key 有效 ✅' });
    } else {
      const text = await response.text();
      res.json({ success: false, message: `Key 无效 (${response.status})` });
    }
  } catch (err) {
    res.json({ success: false, message: `连接失败: ${err.message}` });
  }
});

// ============ 调试请求历史 ============
let requestHistory = []; // 保留最近 50 条请求的摘要

function recordRequest(entry) {
  requestHistory.unshift(entry);
  if (requestHistory.length > 50) requestHistory.pop();
}

// 查看最近请求（调试用）
app.get('/api/debug/requests', requireAdmin, (req, res) => {
  res.json({ requests: requestHistory });
});

// ============ 请求分析工具 ============
function analyzeRequest(body) {
  if (!body) return {};
  const info = {
    model: body.model || '(使用默认)',
    messages: body.messages ? body.messages.length : 0,
    stream: !!body.stream,
    hasTools: !!(body.tools && body.tools.length > 0),
    toolCount: body.tools ? body.tools.length : 0,
    maxTokens: body.max_tokens || '(未设置)',
    temperature: body.temperature || '(未设置)',
  };
  // 估算输入 token（粗略：1 token ≈ 4 字符）
  if (body.messages) {
    const totalChars = JSON.stringify(body.messages).length;
    info.estimatedInputTokens = Math.ceil(totalChars / 4);
  }
  return info;
}

// ============ OpenAI 兼容代理 ============
app.all('/v1/*', async (req, res) => {
  // 验证代理 API Key
  if (appData.settings.proxyKey && appData.settings.proxyKey.trim()) {
    const authHeader = req.headers['authorization'] || '';
    const clientKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (clientKey !== appData.settings.proxyKey.trim()) {
      addLog('error', '🔒 代理 Key 验证失败', '客户端提供的 Key 不正确');
      return res.status(401).json({ error: { message: 'API Key 无效，请检查你的代理 Key 配置' } });
    }
  }

  const keyObj = getNextKey();
  if (!keyObj) {
    addLog('error', '没有可用的 API Key');
    return res.status(503).json({ error: { message: '没有可用的 API Key，请先添加 Key' } });
  }

  const targetPath = req.path.replace(/^\/v1/, '');
  const targetUrl = `${appData.settings.baseUrl}${targetPath}`;

  // 转发客户端原始 User-Agent 和其他可选头
  const headers = {
    'Authorization': `Bearer ${keyObj.key}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (req.headers['user-agent']) {
    headers['User-Agent'] = req.headers['user-agent'];
  }

  // 构建请求体
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // 如果没有指定 model，使用默认模型
    if (req.body && !req.body.model) {
      req.body.model = appData.settings.model;
    }
    body = JSON.stringify(req.body);
  }

  // 分析请求内容
  const reqInfo = analyzeRequest(req.body);

  stats.totalRequests++;
  keyObj.requests++;
  keyObj.lastUsed = new Date().toISOString();
  keyObj.status = 'active';

  const isStream = req.body && req.body.stream;
  const keyLabel = keyObj.key.substring(0, 12) + '...';
  const clientUA = req.headers['user-agent'] || 'unknown';

  // 详细日志
  const logDetail = [
    `Model: ${reqInfo.model}`,
    `Messages: ${reqInfo.messages}`,
    `Est.InputTokens: ${reqInfo.estimatedInputTokens || '?'}`,
    `Stream: ${isStream}`,
    `Tools: ${reqInfo.toolCount}`,
    `MaxTokens: ${reqInfo.maxTokens}`,
    `Temp: ${reqInfo.temperature}`,
    `ClientUA: ${clientUA.substring(0, 80)}`
  ].join(' | ');
  addLog('info', `📤 ${req.method} ${targetPath}`, `Key: ${keyLabel} | ${logDetail}`);

  // 记录请求到历史（调试用）
  const reqRecord = {
    time: new Date().toISOString(),
    method: req.method,
    path: targetPath,
    clientUA: clientUA.substring(0, 120),
    ...reqInfo,
    requestBody: null
  };
  // 仅保存 messages 摘要（避免过大），但保存完整 body 到临时变量
  if (req.body && req.body.messages) {
    reqRecord.messageRoles = req.body.messages.map(m => m.role || 'unknown');
    reqRecord.messageLengths = req.body.messages.map(m => (JSON.stringify(m.content || '')).length);
    // 保存前 2 条消息的 role+snippet 用于调试
    reqRecord.messageSnippets = req.body.messages.slice(0, 3).map(m => ({
      role: m.role,
      contentPreview: typeof m.content === 'string' ? m.content.substring(0, 200) : '(非文本内容)'
    }));
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers
    };
    if (body) fetchOptions.body = body;

    const response = await fetch(targetUrl, fetchOptions);

    if (!response.ok) {
      const errText = await response.text();
      keyObj.errors++;
      stats.totalErrors++;
      keyObj.status = 'error';

      let errDetail = errText.substring(0, 300);
      try {
        const errJson = JSON.parse(errText);
        errDetail = errJson.error?.message || errJson.message || errText.substring(0, 300);
      } catch(e) {}

      addLog('error', `❌ 上游错误 ${response.status}`, `Key: ${keyLabel} | Model: ${reqInfo.model} | ${errDetail}`);
      setTimeout(() => { keyObj.status = 'idle'; }, 3000);

      // 记录请求结果
      reqRecord.status = 'error';
      reqRecord.upstreamStatus = response.status;
      reqRecord.errorDetail = errDetail;
      recordRequest(reqRecord);

      // 尝试原样转发上游错误 JSON（兼容 Hermes 等客户端的错误解析）
      try {
        const errJson = JSON.parse(errText);
        return res.status(response.status).json(errJson);
      } catch(e) {
        return res.status(response.status).json({
          error: { message: errText.substring(0, 500), type: 'upstream_error', status: response.status }
        });
      }
    }

    if (isStream) {
      // 流式响应 — 转发所有上游头
      const skipHeaders = new Set(['content-length', 'transfer-encoding', 'connection']);
      response.headers.forEach((value, name) => {
        if (!skipHeaders.has(name.toLowerCase())) {
          res.setHeader(name, value);
        }
      });
      if (!res.getHeader('content-type')) {
        res.setHeader('Content-Type', 'text/event-stream');
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // 统计流式 chunks
      let chunkCount = 0;
      let totalTokens = 0;
      const originalPipe = response.body.pipe.bind(response.body);

      response.body.on('data', (chunk) => {
        chunkCount++;
        // 尝试从 chunk 中提取 usage 信息
        try {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
              const data = JSON.parse(line.slice(6));
              if (data.usage) {
                totalTokens = data.usage.total_tokens || 0;
              }
            }
          }
        } catch(e) {}
      });

      response.body.pipe(res);
      response.body.on('end', () => {
        keyObj.status = 'idle';
        addLog('info', `✅ 流式完成 [${chunkCount} chunks]`, `Key: ${keyLabel} | Model: ${reqInfo.model}${totalTokens ? ` | Tokens: ${totalTokens}` : ''}`);
        reqRecord.status = 'success';
        reqRecord.streamChunks = chunkCount;
        reqRecord.streamTokens = totalTokens;
        recordRequest(reqRecord);
      });
      response.body.on('error', (err) => {
        keyObj.status = 'error';
        keyObj.errors++;
        stats.totalErrors++;
        addLog('error', `❌ 流式错误`, `Key: ${keyLabel} | Model: ${reqInfo.model} | ${err.message}`);
        res.end();
      });
    } else {
      // 非流式响应
      const data = await response.json();
      keyObj.status = 'idle';

      const usage = data.usage || {};
      addLog('info', `✅ 请求成功`, `Key: ${keyLabel} | Model: ${reqInfo.model} | Prompt: ${usage.prompt_tokens || '?'} | Completion: ${usage.completion_tokens || '?'} | Total: ${usage.total_tokens || '?'}${data.choices?.[0]?.finish_reason ? ` | Finish: ${data.choices[0].finish_reason}` : ''}`);

      // 记录请求结果
      reqRecord.status = 'success';
      reqRecord.usage = usage;
      reqRecord.finishReason = data.choices?.[0]?.finish_reason || null;
      recordRequest(reqRecord);

      res.json(data);
    }
  } catch (err) {
    keyObj.errors++;
    stats.totalErrors++;
    keyObj.status = 'error';
    addLog('error', `❌ 请求失败`, `Key: ${keyLabel} | Model: ${reqInfo.model} | ${err.message}`);
    reqRecord.status = 'failed';
    reqRecord.errorDetail = err.message;
    recordRequest(reqRecord);
    setTimeout(() => { keyObj.status = 'idle'; }, 3000);
    res.status(502).json({ error: { message: `代理错误: ${err.message}` } });
  }
});

// ============ 前端路由 ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ 启动 ============
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║         🚀 NVIDIA Free Proxy 已启动         ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  管理面板:  http://localhost:${PORT}            ║`);
  console.log(`║  代理地址:  http://localhost:${PORT}/v1          ║`);
  console.log(`║  已加载 Key: ${String(appData.keys.length).padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
