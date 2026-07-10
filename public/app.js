// ============ 前端应用 ============

const API = '';
let adminKey = localStorage.getItem('adminKey') || '';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 检查是否需要认证
  const needAuth = await checkAuth();
  if (needAuth && !adminKey) {
    showLogin();
    return;
  }
  if (needAuth) {
    // 验证已保存的 key 是否有效
    const valid = await tryLogin(adminKey);
    if (!valid) {
      showLogin();
      return;
    }
  }
  initApp();
});

function initApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appMain').style.display = '';
  loadKeys();
  loadStats();
  loadLogs();
  loadSettings();
  initModelDropdown();
  
  setInterval(loadStats, 3000);
  setInterval(loadLogs, 5000);
  setInterval(loadKeys, 5000);
}

// ============ 认证 ============

async function checkAuth() {
  try {
    const res = await fetch(`${API}/api/auth/status`);
    const data = await res.json();
    return data.requireAuth;
  } catch (e) {
    return false;
  }
}

async function tryLogin(key) {
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
    return data.success;
  } catch (e) {
    return false;
  }
}

function showLogin() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appMain').style.display = 'none';
  document.getElementById('loginKeyInput').focus();
}

async function doLogin() {
  const key = document.getElementById('loginKeyInput').value.trim();
  if (!key) {
    showLoginError('请输入管理员密钥');
    return;
  }
  const btn = document.getElementById('loginBtn');
  btn.textContent = '验证中...';
  btn.disabled = true;
  
  const valid = await tryLogin(key);
  if (valid) {
    adminKey = key;
    localStorage.setItem('adminKey', key);
    initApp();
  } else {
    showLoginError('密钥错误，请重试');
  }
  btn.textContent = '登 录';
  btn.disabled = false;
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

function logout() {
  adminKey = '';
  localStorage.removeItem('adminKey');
  showLogin();
}

// 给所有 fetch 加上认证头
async function authFetch(url, options = {}) {
  if (adminKey) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      options.headers.set('X-Admin-Key', adminKey);
    } else {
      options.headers['X-Admin-Key'] = adminKey;
    }
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    showLogin();
    throw new Error('认证失败');
  }
  return res;
}

// ============ Key 管理 ============

async function loadKeys() {
  try {
    const res = await authFetch(`${API}/api/keys`);
    const keys = await res.json();
    renderKeys(keys);
  } catch (e) {
    console.error('加载 Key 失败:', e);
  }
}

function renderKeys(keys) {
  const container = document.getElementById('keyList');
  
  if (keys.length === 0) {
    container.innerHTML = '<div class="empty-state">🔑 还没有添加 API Key<br><small>点击上方 "添加 Key" 按钮开始</small></div>';
    return;
  }

  container.innerHTML = keys.map((k, i) => `
    <div class="key-item ${k.status || 'idle'}">
      <div class="key-status ${k.enabled ? (k.status || 'idle') : 'disabled'}"></div>
      <div class="key-info">
        <div class="key-text">${escapeHtml(k.key)}</div>
        <div class="key-meta">
          <span>📤 ${k.requests} 次</span>
          <span>❌ ${k.errors} 错误</span>
          ${k.lastUsed ? `<span>🕐 ${formatTime(k.lastUsed)}</span>` : ''}
        </div>
      </div>
      <div class="key-actions">
        <button class="btn-toggle ${k.enabled ? 'enabled' : 'disabled'}" onclick="toggleKey(${k.id})">
          ${k.enabled ? '启用' : '禁用'}
        </button>
        <button class="btn-icon" onclick="copyKey(this.dataset.key)" data-key="${escapeAttr(k.fullKey)}" title="复制">📋</button>
        <button class="btn-icon btn-danger" onclick="deleteKey(${k.id})" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function toggleKey(id) {
  try {
    await authFetch(`${API}/api/keys/${id}/toggle`, { method: 'PUT' });
    loadKeys();
    showToast('Key 状态已切换');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

async function deleteKey(id) {
  if (!confirm('确定要删除这个 Key 吗？')) return;
  try {
    await authFetch(`${API}/api/keys/${id}`, { method: 'DELETE' });
    loadKeys();
    loadStats();
    showToast('Key 已删除');
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

// ============ 添加 Key ============

function showAddKeyModal() {
  document.getElementById('addKeyModal').style.display = 'flex';
  document.getElementById('newKeyInput').focus();
}

function hideAddKeyModal() {
  document.getElementById('addKeyModal').style.display = 'none';
  document.getElementById('newKeyInput').value = '';
}

async function addKeys() {
  const input = document.getElementById('newKeyInput').value.trim();
  if (!input) {
    showToast('请输入 API Key', 'error');
    return;
  }

  const keys = input.split('\n').map(k => k.trim()).filter(k => k.length > 0);
  let added = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      const res = await authFetch(`${API}/api/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      if (res.ok) added++;
      else failed++;
    } catch (e) {
      failed++;
    }
  }

  hideAddKeyModal();
  loadKeys();
  loadStats();
  
  if (failed > 0) {
    showToast(`添加了 ${added} 个 Key，${failed} 个失败`);
  } else {
    showToast(`成功添加 ${added} 个 Key ✅`);
  }
}

// ============ 统计 ============

async function loadStats() {
  try {
    const res = await authFetch(`${API}/api/stats`);
    const stats = await res.json();
    
    document.getElementById('totalRequests').textContent = stats.totalRequests;
    document.getElementById('totalErrors').textContent = stats.totalErrors;
    document.getElementById('activeKeys').textContent = `${stats.activeKeys}/${stats.totalKeys}`;
    document.getElementById('uptime').textContent = stats.uptimeFormatted;
    
    document.getElementById('serverStatus').classList.remove('offline');
  } catch (e) {
    document.getElementById('serverStatus').classList.add('offline');
  }
}

// ============ 日志 ============

async function loadLogs() {
  try {
    const res = await authFetch(`${API}/api/logs?limit=80`);
    const logs = await res.json();
    renderLogs(logs);
  } catch (e) {
    // 静默失败
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logList');
  
  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无日志</div>';
    return;
  }

  container.innerHTML = logs.map(log => `
    <div class="log-item ${log.type}">
      <span class="log-time">${formatLogTime(log.time)}</span>
      <div class="log-msg">
        ${escapeHtml(log.message)}
        ${log.detail ? `<div class="log-detail">${escapeHtml(log.detail)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function clearLogs() {
  document.getElementById('logList').innerHTML = '<div class="empty-state">日志已清空</div>';
}

// ============ 设置 ============

async function loadSettings() {
  try {
    const res = await authFetch(`${API}/api/settings`);
    const settings = await res.json();
    
    document.getElementById('settingBaseUrl').value = settings.baseUrl || '';
    document.getElementById('settingModel').value = settings.model || '';
    document.getElementById('settingProxyKey').value = settings.proxyKey || '';
  } catch (e) {
    console.error('加载设置失败:', e);
  }
}

async function saveSettings() {
  const baseUrl = document.getElementById('settingBaseUrl').value.trim();
  const model = document.getElementById('settingModel').value.trim();
  const proxyKey = document.getElementById('settingProxyKey').value;
  
  try {
    await authFetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, model, proxyKey })
    });
    showToast('设置已保存 ✅');
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// ============ 工具函数 ============

function copyEndpoint() {
  copyToClipboard('http://localhost:20128/v1');
  showToast('代理地址已复制 📋');
}

function copyKey(key) {
  copyToClipboard(key);
  showToast('Key 已复制 📋');
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// 切换代理 Key 显示/隐藏
function toggleProxyKeyVisibility() {
  const input = document.getElementById('settingProxyKey');
  const btn = document.getElementById('toggleProxyKeyEye');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  return d.toLocaleDateString('zh-CN');
}

function formatLogTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ 模型下拉选择器 ============

let allModels = [];

async function initModelDropdown() {
  const input = document.getElementById('settingModel');
  const dropdown = document.getElementById('modelDropdown');
  const searchInput = document.getElementById('modelSearch');
  const modelList = document.getElementById('modelList');

  // 加载模型列表
  await loadModels();

  // 点击输入框打开下拉
  input.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // 搜索过滤
  searchInput.addEventListener('input', () => {
    filterModels(searchInput.value);
  });

  // 阻止搜索框点击冒泡
  searchInput.addEventListener('click', (e) => e.stopPropagation());

  // 点击外部关闭
  document.addEventListener('click', () => {
    closeDropdown();
  });

  // 阻止下拉框内部点击冒泡
  dropdown.addEventListener('click', (e) => e.stopPropagation());

  // 键盘导航
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      toggleDropdown();
    }
    if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusNextItem(1);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusNextItem(-1);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const focused = modelList.querySelector('.model-item.focused');
      if (focused) {
        selectModel(focused.dataset.id);
      }
    }
  });
}

async function loadModels() {
  const modelList = document.getElementById('modelList');
  try {
    const res = await authFetch('/api/models');
    const data = await res.json();
    allModels = data.models || [];
    renderModels(allModels);
  } catch (e) {
    modelList.innerHTML = '<div class="model-empty">❌ 加载模型列表失败</div>';
  }
}

function renderModels(models) {
  const modelList = document.getElementById('modelList');
  const currentModel = document.getElementById('settingModel').value;

  if (models.length === 0) {
    modelList.innerHTML = '<div class="model-empty">没有找到匹配的模型</div>';
    return;
  }

  modelList.innerHTML = models.map(m => {
    const provider = (m.owned_by || '').toLowerCase();
    const badgeClass = ['deepseek', 'meta', 'google', 'mistral', 'nvidia', 'qwen'].includes(provider) ? provider : '';
    const isSelected = m.id === currentModel;

    return `
      <div class="model-item ${isSelected ? 'selected' : ''}" 
           data-id="${escapeAttr(m.id)}" 
           onclick="selectModel('${escapeAttr(m.id)}')">
        <span class="model-name">${escapeHtml(m.id)}</span>
        <span class="model-badge ${badgeClass}">${escapeHtml(m.owned_by || '')}</span>
      </div>
    `;
  }).join('');
}

function filterModels(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    renderModels(allModels);
    return;
  }
  const filtered = allModels.filter(m =>
    m.id.toLowerCase().includes(q) ||
    (m.owned_by || '').toLowerCase().includes(q)
  );
  renderModels(filtered);
}

function selectModel(modelId) {
  const input = document.getElementById('settingModel');
  input.value = modelId;
  closeDropdown();
  // 高亮选中的
  renderModels(allModels);
}

function toggleDropdown() {
  const dropdown = document.getElementById('modelDropdown');
  const isOpen = dropdown.classList.contains('open');
  if (isOpen) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function openDropdown() {
  const dropdown = document.getElementById('modelDropdown');
  const searchInput = document.getElementById('modelSearch');
  dropdown.classList.add('open');
  searchInput.value = '';
  filterModels('');
  setTimeout(() => searchInput.focus(), 50);
}

function closeDropdown() {
  const dropdown = document.getElementById('modelDropdown');
  dropdown.classList.remove('open');
}

function focusNextItem(direction) {
  const modelList = document.getElementById('modelList');
  const items = modelList.querySelectorAll('.model-item');
  if (items.length === 0) return;

  let currentIdx = -1;
  items.forEach((item, i) => {
    if (item.classList.contains('focused')) currentIdx = i;
  });

  items.forEach(item => item.classList.remove('focused'));

  let nextIdx = currentIdx + direction;
  if (nextIdx < 0) nextIdx = items.length - 1;
  if (nextIdx >= items.length) nextIdx = 0;

  items[nextIdx].classList.add('focused');
  items[nextIdx].scrollIntoView({ block: 'nearest' });
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
