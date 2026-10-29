/* ============================================================
   demoputter · app.js
   纯前端 GitHub 工作台：token → 仓库 → 文件树 → 编辑 → 提交
   所有数据只存在浏览器 localStorage，不经过任何第三方服务器。
   ============================================================ */
const API = 'https://api.github.com';
const LS_KEY = 'demoputter.token';

const state = {
  token: '',
  user: null,
  repos: [],
  repo: null,      // { owner, name, branch }
  tree: [],
  file: null,      // { path, sha, content }
  dirty: false,
};

const $ = (id) => document.getElementById(id);

/* ---------------- 基础 ---------------- */
function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast ' + kind; }, 3200);
}

function setStatus(text, mode = '') {
  $('statusText').textContent = text;
  $('status').className = 'status ' + mode;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + state.token,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return data;
}

/* ---------------- 连接 ---------------- */
async function connect() {
  const token = $('token').value.trim();
  if (!token) return toast('先填 token', 'err');
  state.token = token;
  setStatus('验证中…');
  try {
    const me = await api('/user');
    state.user = me;
    localStorage.setItem(LS_KEY, token);
    $('fpToken').textContent = token.slice(0, 7) + '…' + token.slice(-4);
    setStatus(`已连接 ${me.login}`, 'on');
    await loadRepos();
  } catch (e) {
    state.token = '';
    setStatus('连接失败', 'err');
    toast('连接失败：' + e.message, 'err');
  }
}

function disconnect() {
  state.token = '';
  state.user = null;
  state.repos = [];
  state.repo = null;
  localStorage.removeItem(LS_KEY);
  $('token').value = '';
  $('fpToken').textContent = '-';
  $('fpRepo').textContent = '-';
  $('fpFile').textContent = '-';
  $('repoList').innerHTML = '<div class="empty"><span class="big">◈</span>连接 token 后加载</div>';
  $('treeBody').innerHTML = '<div class="empty"><span class="big">◇</span>选一个仓库</div>';
  $('previewBody').innerHTML = '<div class="empty"><span class="big">◌</span>点一个文件看内容</div>';
  $('filePath').textContent = '未选择文件';
  $('saveBtn').style.display = 'none';
  setStatus('未连接');
}

/* ---------------- 仓库 ---------------- */
async function loadRepos() {
  $('repoList').innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    const repos = await api('/user/repos?per_page=100&sort=updated');
    state.repos = repos;
    renderRepos();
  } catch (e) {
    $('repoList').innerHTML = `<div class="empty">加载失败<br>${e.message}</div>`;
  }
}

function renderRepos() {
  const list = $('repoList');
  if (!state.repos.length) {
    list.innerHTML = '<div class="empty">没有仓库</div>';
    return;
  }
  list.innerHTML = state.repos.map(r => {
    const active = state.repo && state.repo.name === r.name && state.repo.owner === r.owner.login;
    return `<div class="repo ${active ? 'active' : ''}" data-owner="${r.owner.login}" data-name="${r.name}" data-branch="${r.default_branch}">
      <div class="name">${esc(r.name)} <span class="badge ${r.private ? 'priv' : 'pub'}">${r.private ? 'PRIVATE' : 'PUBLIC'}</span></div>
      <div class="meta">${r.language || '—'} · ${new Date(r.updated_at).toLocaleDateString()}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.repo').forEach(el => {
    el.onclick = () => selectRepo(el.dataset.owner, el.dataset.name, el.dataset.branch);
  });
}

async function selectRepo(owner, name, branch) {
  state.repo = { owner, name, branch };
  $('fpRepo').textContent = `${owner}/${name}`;
  $('branchBadge').textContent = branch;
  $('treeTitle').textContent = name;
  renderRepos();
  await loadTree('');
}

/* ---------------- 文件树 ---------------- */
async function loadTree(path) {
  const { owner, name, branch } = state.repo;
  $('treeBody').innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    const items = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${branch}`);
    state.tree = Array.isArray(items) ? items : [items];
    state.currentPath = path;
    renderTree(state.tree, path);
  } catch (e) {
    $('treeBody').innerHTML = `<div class="empty">加载失败<br>${e.message}</div>`;
  }
}

function renderTree(items, basePath) {
  const container = $('treeBody');
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'tree';

  if (basePath) {
    const up = document.createElement('div');
    up.className = 'item';
    up.innerHTML = '<span class="ico">↑</span><span class="nm">..</span>';
    up.onclick = () => {
      const parent = basePath.split('/').slice(0, -1).join('/');
      loadTree(parent);
    };
    root.appendChild(up);
  }

  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'item ' + (it.type === 'dir' ? 'dir' : 'file');
    el.innerHTML = `<span class="ico">${it.type === 'dir' ? '▸' : '·'}</span><span class="nm">${esc(it.name)}</span>`;
    el.onclick = () => {
      if (it.type === 'dir') loadTree(it.path);
      else loadFile(it.path, it.sha);
    };
    root.appendChild(el);
  });

  container.appendChild(root);
  container.classList.add('fade-in');
  setTimeout(() => container.classList.remove('fade-in'), 400);
}

/* ---------------- 文件读取 / 编辑 ---------------- */
async function loadFile(path, sha) {
  const { owner, name, branch } = state.repo;
  $('previewBody').innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    const data = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${branch}`);
    const content = data.content
      ? decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))))
      : '';
    state.file = { path, sha: data.sha, content };
    state.dirty = false;
    showEditor(path, content);
    $('fpFile').textContent = path.length > 28 ? '…' + path.slice(-28) : path;
  } catch (e) {
    $('previewBody').innerHTML = `<div class="empty">读取失败<br>${e.message}</div>`;
  }
}

function showEditor(path, content) {
  $('filePath').textContent = path;
  const body = $('previewBody');
  body.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'editor-wrap';
  const nums = document.createElement('div');
  nums.className = 'line-nums';
  const ta = document.createElement('textarea');
  ta.id = 'editor';
  ta.value = content;
  ta.spellcheck = false;

  const sync = () => {
    const n = ta.value.split('\n').length;
    nums.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('<br>');
    nums.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('input', () => { state.dirty = true; sync(); });
  ta.addEventListener('scroll', () => { nums.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
      sync();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      commitFile();
    }
  });

  wrap.appendChild(nums);
  wrap.appendChild(ta);
  body.appendChild(wrap);
  sync();
  $('saveBtn').style.display = 'inline-block';
  $('saveBtn').onclick = () => { state.file.content = ta.value; toast('已保存到本地草稿', 'ok'); };
  $('commitBtn').disabled = false;
  $('pushBtn').disabled = false;
  $('workflowBtn').disabled = false;
}

/* ---------------- 提交 ---------------- */
async function commitFile() {
  if (!state.file || !state.repo) return;
  const ta = $('editor');
  if (!ta) return toast('先打开一个文件', 'err');
  const content = ta.value;
  const msg = prompt('提交信息（commit message）', `update ${state.file.path}`);
  if (msg === null) return;
  const { owner, name, branch } = state.repo;
  $('commitBtn').disabled = true;
  $('commitBtn').innerHTML = '<span class="spin"></span>';
  try {
    const res = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(state.file.path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg || `update ${state.file.path}`,
        content: btoa(unescape(encodeURIComponent(content))),
        sha: state.file.sha,
        branch,
      }),
    });
    state.file.sha = res.content.sha;
    state.dirty = false;
    toast('提交并推送成功', 'ok');
    setStatus(`已提交 · ${res.commit.sha.slice(0, 7)}`, 'on');
  } catch (e) {
    toast('提交失败：' + e.message, 'err');
  } finally {
    $('commitBtn').disabled = false;
    $('commitBtn').textContent = '提交';
  }
}

/* ---------------- 工作流 ---------------- */
async function showWorkflows() {
  if (!state.repo) return;
  const { owner, name } = state.repo;
  $('previewBody').innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    const runs = await api(`/repos/${owner}/${name}/actions/runs?per_page=10`);
    const items = runs.workflow_runs || [];
    if (!items.length) {
      $('previewBody').innerHTML = '<div class="empty">没有工作流运行记录</div>';
      return;
    }
    const html = items.map(r => `
      <div class="repo" style="cursor:default">
        <div class="name">${esc(r.name)} <span class="badge ${r.conclusion === 'success' ? 'pub' : r.conclusion === 'failure' ? 'priv' : ''}">${esc(r.conclusion || r.status)}</span></div>
        <div class="meta">${esc(r.head_branch)} · ${new Date(r.created_at).toLocaleString()}</div>
      </div>`).join('');
    $('previewBody').innerHTML = `<div class="markdown-preview" style="padding:17px">${html}</div>`;
    $('filePath').textContent = '工作流运行记录';
  } catch (e) {
    $('previewBody').innerHTML = `<div class="empty">读取失败<br>${e.message}</div>`;
  }
}

/* ---------------- 工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- 绑定 ---------------- */
$('connectBtn').onclick = connect;
$('disconnectBtn').onclick = disconnect;
$('refreshBtn').onclick = () => state.token && loadRepos();
$('commitBtn').onclick = commitFile;
$('pushBtn').onclick = commitFile;
$('workflowBtn').onclick = showWorkflows;
$('token').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

/* 自动恢复 token */
(function boot() {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    $('token').value = saved;
    connect();
  }
})();
