/* ============================================================
   demoputter · app.js
   核心：token → 仓库 → 文件/提交/PR/Issue/动作/发布
   ============================================================ */
const API = 'https://api.github.com';
const LS_TOKEN = 'demoputter.token';
const LS_REPO = 'demoputter.repo';

const S = {
  token: '',
  user: null,
  repos: [],
  repo: null,       // { owner, name, branch }
  tree: [],
  treePath: '',
  file: null,       // { path, sha, content }
  dirty: false,
  view: 'files',
  filter: '',
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 提示 ---------- */
let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast ' + kind; }, 3200);
}

/* ---------- 日志 ---------- */
function log(msg, kind = '') {
  const term = $('terminal');
  if (!term) return;
  const line = el('div', 'term-line');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  line.innerHTML = `<span style="color:#98a2b8">${time}</span> <span class="${kind}">${esc(msg)}</span>`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
  while (term.children.length > 200) term.removeChild(term.firstChild);
}

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + S.token,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${(data && data.message) || res.statusText}`);
  return data;
}

/* ---------- 连接 ---------- */
async function connect(token) {
  S.token = (token || '').trim();
  if (!S.token) throw new Error('令牌为空');
  const me = await api('/user');
  S.user = me;
  localStorage.setItem(LS_TOKEN, S.token);
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('statusText').textContent = me.login;
  $('statusDot').classList.add('ok');
  log(`已连接 GitHub：${me.login}`, 'ok');
  await loadRepos();
}

async function loadRepos() {
  try {
    const repos = await api('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');
    S.repos = repos;
    renderRail();
    log(`加载了 ${repos.length} 个仓库`, 'info');
    const last = localStorage.getItem(LS_REPO);
    const target = repos.find(r => `${r.owner.login}/${r.name}` === last) || repos[0];
    if (target) await selectRepo(target.owner.login, target.name, target.default_branch);
  } catch (e) {
    toast('加载仓库失败：' + e.message, 'err');
    log('加载仓库失败：' + e.message, 'err');
  }
}

/* ---------- 一级：仓库列表 ---------- */
function renderRail() {
  const box = $('railRepos');
  box.innerHTML = '';
  S.repos.slice(0, 12).forEach(r => {
    const active = S.repo && S.repo.name === r.name && S.repo.owner === r.owner.login;
    const btn = el('button', 'rail-item' + (active ? ' active' : ''));
    btn.title = `${r.full_name}${r.private ? '（私有）' : ''}`;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M4 12h16M4 17h10"/></svg><span>${esc(r.name.slice(0, 8))}</span>`;
    btn.onclick = () => selectRepo(r.owner.login, r.name, r.default_branch);
    box.appendChild(btn);
  });
}

/* ---------- 仓库切换下拉 ---------- */
function showRepoDropdown() {
  closeDropdown();
  const dd = el('div', 'dropdown');
  dd.id = 'repoDropdown';
  S.repos.forEach(r => {
    const item = el('div', 'dd-item' + (S.repo && S.repo.name === r.name ? ' active' : ''));
    item.innerHTML = `${esc(r.name)} <span style="color:var(--dim-2);font-size:11px">${r.private ? '私有' : '公开'}</span>`;
    item.onclick = () => { closeDropdown(); selectRepo(r.owner.login, r.name, r.default_branch); };
    dd.appendChild(item);
  });
  const rect = $('repoSwitch').getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(dd);
  setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
}
function closeDropdown() {
  const d = $('repoDropdown');
  if (d) d.remove();
}

/* ---------- 选仓库 ---------- */
async function selectRepo(owner, name, branch) {
  S.repo = { owner, name, branch: branch || 'main' };
  localStorage.setItem(LS_REPO, `${owner}/${name}`);
  $('repoOwner').textContent = owner;
  $('repoName').textContent = name;
  $('statusRepo').textContent = `${owner}/${name}`;
  renderRail();
  log(`切换到仓库 ${owner}/${name}`, 'info');
  await loadTree('');
  refreshCounts();
}

/* ---------- 文件树 ---------- */
async function loadTree(path) {
  const body = $('fileTree');
  body.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const { owner, name, branch } = S.repo;
    const items = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${branch}`);
    const arr = Array.isArray(items) ? items : [items];
    arr.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    S.tree = arr;
    S.treePath = path;
    renderTree(arr, path, body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">加载失败<br>${esc(e.message)}</div>`;
  }
}

function renderTree(items, basePath, container) {
  container.innerHTML = '';
  if (basePath) {
    const up = el('div', 'ft-row', '<span class="tw">↑</span><span class="fi">·</span><span class="nm">..</span>');
    up.onclick = () => loadTree(basePath.split('/').slice(0, -1).join('/'));
    container.appendChild(up);
  }
  items.forEach(it => {
    const isDir = it.type === 'dir';
    const row = el('div', 'ft-row' + (S.file && S.file.path === it.path ? ' active' : ''));
    row.innerHTML = `<span class="tw">${isDir ? '▸' : ''}</span>
      <span class="fi" style="color:${isDir ? 'var(--blue)' : 'var(--dim)'}">${isDir ? '▸' : '·'}</span>
      <span class="nm">${esc(it.name)}</span>`;
    row.onclick = () => isDir ? loadTree(it.path) : loadFile(it.path, it.sha);
    container.appendChild(row);
  });
}

/* ---------- 文件 ---------- */
async function loadFile(path, sha) {
  const code = $('code');
  code.value = '加载中…';
  try {
    const { owner, name, branch } = S.repo;
    const data = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${branch}`);
    let content = '';
    if (data.content) content = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
    S.file = { path, sha: data.sha, content };
    S.dirty = false;
    code.value = content;
    $('breadcrumb').innerHTML = `<span class="f">${esc(path)}</span>`;
    $('btnSave').disabled = false;
    $('btnCommit').disabled = false;
    updateGutter();
    log(`打开 ${path}（${content.length} 字符）`);
  } catch (e) {
    code.value = '加载失败：' + e.message;
    log('打开文件失败：' + e.message, 'err');
  }
}

function updateGutter() {
  const n = $('code').value.split('\n').length;
  $('gutter').innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('<br>');
}

/* ---------- 提交 ---------- */
async function commitFile() {
  if (!S.file) return;
  const content = $('code').value;
  const msg = prompt('提交信息', `更新 ${S.file.path}`);
  if (msg === null) return;
  const { owner, name, branch } = S.repo;
  try {
    const res = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(S.file.path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg || `更新 ${S.file.path}`,
        content: btoa(unescape(encodeURIComponent(content))),
        sha: S.file.sha,
        branch,
      }),
    });
    S.file.sha = res.content.sha;
    S.dirty = false;
    toast('提交成功', 'ok');
    log(`提交成功 ${res.commit.sha.slice(0, 7)}`, 'ok');
  } catch (e) {
    toast('提交失败：' + e.message, 'err');
    log('提交失败：' + e.message, 'err');
  }
}

/* ---------- 视图切换 ---------- */
function loadView(view) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  const isFiles = view === 'files';
  $('tabs').style.display = isFiles ? 'flex' : 'none';
  $('bottom').style.display = isFiles ? 'flex' : 'none';
  if (view === 'commits') loadCommits();
  if (view === 'pulls') loadPulls();
  if (view === 'issues') loadIssues();
  if (view === 'actions') loadActions();
  if (view === 'releases') loadReleases();
  if (view === 'settings') renderSettings();
}

function viewHead(title, sub, buttons = []) {
  const box = el('div', 'list-head');
  box.innerHTML = `<h2>${esc(title)}</h2><span class="sub">${esc(sub)}</span>`;
  const right = el('div', 'right');
  buttons.forEach(b => right.appendChild(b));
  box.appendChild(right);
  return box;
}
function rowList(rows) {
  const box = el('div', 'row-list');
  if (!rows.length) { box.innerHTML = '<div class="empty-state">没有内容</div>'; return box; }
  rows.forEach(r => box.appendChild(r));
  return box;
}
function failState(msg) {
  const d = el('div', 'empty-state');
  d.innerHTML = '加载失败<br>' + esc(msg);
  return d;
}

/* 提交 */
async function loadCommits() {
  const c = $('listCommits');
  c.innerHTML = '<div class="loading">加载提交…</div>';
  try {
    const { owner, name, branch } = S.repo;
    const list = await api(`/repos/${owner}/${name}/commits?sha=${branch}&per_page=30`);
    const rows = list.filter(x => !S.filter || x.commit.message.toLowerCase().includes(S.filter)).map(x => {
      const row = el('div', 'row clickable');
      const date = new Date(x.commit.author.date).toLocaleString('zh-CN', { hour12: false });
      row.innerHTML = `<span class="num">${esc(x.sha.slice(0, 7))}</span>
        <div class="main-txt"><div class="title">${esc(x.commit.message.split('\n')[0])}</div>
        <div class="meta">${esc(x.commit.author.name)} · ${esc(date)}</div></div>
        <span class="tag ok">已推送</span>`;
      row.onclick = () => window.open(x.html_url, '_blank');
      return row;
    });
    c.innerHTML = '';
    c.appendChild(viewHead('提交', `${branch} 分支 · 最近 ${rows.length} 次`));
    c.appendChild(rowList(rows));
  } catch (e) { c.innerHTML = ''; c.appendChild(failState(e.message)); }
}

/* PR */
async function loadPulls() {
  const c = $('listPulls');
  c.innerHTML = '<div class="loading">加载拉取请求…</div>';
  try {
    const { owner, name } = S.repo;
    const list = await api(`/repos/${owner}/${name}/pulls?state=all&per_page=30`);
    const rows = list.filter(x => !S.filter || x.title.toLowerCase().includes(S.filter)).map(p => {
      const row = el('div', 'row clickable');
      const tag = p.state === 'closed' ? (p.merged_at ? 'merged' : 'closed') : (p.draft ? 'draft' : 'open');
      const tagText = { open: '开启', closed: '已关闭', merged: '已合并', draft: '草稿' }[tag];
      row.innerHTML = `<span class="num">#${p.number}</span>
        <div class="main-txt"><div class="title">${esc(p.title)}</div>
        <div class="meta">from <b>${esc(p.head.ref)}</b> → ${esc(p.base.ref)} · ${esc(p.user.login)}</div></div>
        <span class="tag ${tag}">${tagText}</span>`;
      row.onclick = () => window.open(p.html_url, '_blank');
      return row;
    });
    c.innerHTML = '';
    c.appendChild(viewHead('拉取请求', `共 ${rows.length} 个`));
    c.appendChild(rowList(rows));
  } catch (e) { c.innerHTML = ''; c.appendChild(failState(e.message)); }
}

/* Issue */
async function loadIssues() {
  const c = $('listIssues');
  c.innerHTML = '<div class="loading">加载问题…</div>';
  try {
    const { owner, name } = S.repo;
    const list = await api(`/repos/${owner}/${name}/issues?state=all&per_page=30`);
    const only = list.filter(x => !x.pull_request);
    const rows = only.filter(x => !S.filter || x.title.toLowerCase().includes(S.filter)).map(p => {
      const row = el('div', 'row clickable');
      const tag = p.state === 'open' ? 'open' : 'closed';
      const labels = (p.labels || []).map(l => l.name).join('、');
      row.innerHTML = `<span class="num">#${p.number}</span>
        <div class="main-txt"><div class="title">${esc(p.title)}</div>
        <div class="meta">${labels ? '标签：' + esc(labels) + ' · ' : ''}${esc(p.user.login)} · ${p.comments} 条评论</div></div>
        <span class="tag ${tag}">${tag === 'open' ? '开启' : '已关闭'}</span>`;
      row.onclick = () => window.open(p.html_url, '_blank');
      return row;
    });
    const newBtn = el('button', 'btn-primary', '新建问题');
    newBtn.onclick = () => openIssueModal();
    c.innerHTML = '';
    c.appendChild(viewHead('问题', `共 ${rows.length} 个`, [newBtn]));
    c.appendChild(rowList(rows));
  } catch (e) { c.innerHTML = ''; c.appendChild(failState(e.message)); }
}

/* Actions */
async function loadActions() {
  const c = $('listActions');
  c.innerHTML = '<div class="loading">加载动作…</div>';
  try {
    const { owner, name } = S.repo;
    const data = await api(`/repos/${owner}/${name}/actions/runs?per_page=20`);
    const runs = data.workflow_runs || [];
    const rows = runs.map(r => {
      const row = el('div', 'row clickable');
      const tag = r.conclusion === 'success' ? 'ok' : (r.conclusion === 'failure' ? 'fail' : 'run');
      const text = { ok: '成功', fail: '失败', run: r.status }[tag];
      const dur = r.run_started_at && r.updated_at
        ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000) + ' 秒' : '';
      row.innerHTML = `<span class="num">#${r.run_number}</span>
        <div class="main-txt"><div class="title">${esc(r.name)}</div>
        <div class="meta">${esc(r.head_branch)} · ${esc(r.head_sha.slice(0, 7))} · ${dur}</div></div>
        <span class="tag ${tag}">${esc(text)}</span>`;
      row.onclick = () => window.open(r.html_url, '_blank');
      return row;
    });
    c.innerHTML = '';
    c.appendChild(viewHead('动作', runs.length ? `最近 ${runs.length} 次运行` : '没有运行记录'));
    c.appendChild(rowList(rows));
  } catch (e) { c.innerHTML = ''; c.appendChild(failState(e.message + '（可能需要 workflow 权限）')); }
}

/* Releases */
async function loadReleases() {
  const c = $('listReleases');
  c.innerHTML = '<div class="loading">加载发布…</div>';
  try {
    const { owner, name } = S.repo;
    const list = await api(`/repos/${owner}/${name}/releases?per_page=20`);
    const rows = list.map(r => {
      const row = el('div', 'row clickable');
      const date = new Date(r.published_at).toLocaleDateString('zh-CN');
      row.innerHTML = `<span class="num">${esc(r.tag_name)}</span>
        <div class="main-txt"><div class="title">${esc(r.name || r.tag_name)}</div>
        <div class="meta">发布于 ${date}${r.prerelease ? ' · 预发布' : ''}</div></div>
        <span class="tag ${r.prerelease ? 'draft' : 'ok'}">${r.prerelease ? '预发布' : '正式'}</span>`;
      row.onclick = () => window.open(r.html_url, '_blank');
      return row;
    });
    c.innerHTML = '';
    c.appendChild(viewHead('发布', list.length ? `共 ${list.length} 个版本` : '还没有发布'));
    c.appendChild(rowList(rows));
  } catch (e) { c.innerHTML = ''; c.appendChild(failState(e.message)); }
}

/* 设置 */
function renderSettings() {
  const c = $('viewSettings');
  const { owner, name } = S.repo || {};
  const repoObj = S.repos.find(r => r.name === name);
  c.innerHTML = `
    <h2>设置</h2>
    <p class="desc">这些设置只影响本机界面，不会修改远端仓库。</p>
    <div class="set-card">
      <h3>账号</h3>
      <div class="hint">令牌只保存在本机应用存储里，不上传任何服务器。</div>
      <div class="set-field"><label>登录名<div class="sub">${esc(S.user ? S.user.login : '—')}</div></label><button class="btn-ghost" id="setLogout">断开</button></div>
      <div class="set-field"><label>当前仓库<div class="sub">${esc(owner ? owner + '/' + name : '—')}</div></label><span style="color:var(--dim);font-size:12px">${repoObj ? (repoObj.private ? '私有' : '公开') : ''}</span></div>
    </div>
    <div class="set-card">
      <h3>界面</h3>
      <div class="set-field"><label>显示底部日志<div class="sub">在文件视图常驻</div></label><div class="switch on" id="swTerm"></div></div>
    </div>
    <div class="set-card">
      <h3>关于</h3>
      <div class="set-field"><label>版本<div class="sub">demoputter 0.3.0</div></label><span style="color:var(--dim);font-size:12px">MIT 许可证</span></div>
      <div class="set-field"><label>运行时<div class="sub">pywebview + 系统 WebView2</div></label><span style="color:var(--dim);font-size:12px">单文件</span></div>
    </div>`;
  const sw = $('swTerm');
  if (sw) sw.onclick = () => {
    sw.classList.toggle('on');
    $('bottom').style.display = sw.classList.contains('on') && S.view === 'files' ? 'flex' : 'none';
  };
  const lo = $('setLogout');
  if (lo) lo.onclick = () => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_REPO);
    S.token = '';
    $('app').classList.add('hidden');
    $('gate').classList.remove('hidden');
    $('gateToken').value = '';
  };
}

/* 计数 */
async function refreshCounts() {
  if (!S.repo) return;
  const { owner, name } = S.repo;
  try {
    const [pulls, issues] = await Promise.all([
      api(`/repos/${owner}/${name}/pulls?state=open&per_page=100`),
      api(`/repos/${owner}/${name}/issues?state=open&per_page=100`),
    ]);
    const iCount = issues.filter(x => !x.pull_request).length;
    $('cntPulls').textContent = pulls.length || '';
    $('cntIssues').textContent = iCount || '';
  } catch { /* 忽略 */ }
}

/* 新建 Issue */
function openIssueModal() {
  const mask = el('div', 'modal-mask');
  mask.innerHTML = `
    <div class="modal">
      <h3>新建问题</h3>
      <input id="mTitle" placeholder="标题">
      <textarea id="mBody" placeholder="描述（可选）"></textarea>
      <div class="modal-actions">
        <button class="btn-ghost" id="mCancel">取消</button>
        <button class="btn-primary" id="mCreate">创建</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector('#mCancel').onclick = () => mask.remove();
  mask.querySelector('#mCreate').onclick = async () => {
    const title = mask.querySelector('#mTitle').value.trim();
    if (!title) return toast('标题不能为空', 'err');
    const body = mask.querySelector('#mBody').value;
    try {
      const { owner, name } = S.repo;
      const r = await api(`/repos/${owner}/${name}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      toast('问题已创建 #' + r.number, 'ok');
      log(`新建问题 #${r.number}`, 'ok');
      mask.remove();
      loadIssues();
    } catch (e) {
      toast('创建失败：' + e.message, 'err');
    }
  };
}

/* ---------- 启动 ---------- */
function boot() {
  $('gate').classList.remove('hidden');

  $('gateConnect').onclick = async () => {
    const btn = $('gateConnect');
    btn.disabled = true;
    $('gateErr').textContent = '';
    try {
      await connect($('gateToken').value);
    } catch (e) {
      $('gateErr').textContent = '连接失败：' + e.message;
    } finally {
      btn.disabled = false;
    }
  };
  $('gateToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('gateConnect').click(); });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.onclick = () => loadView(item.dataset.view);
  });
  $('repoSwitch').onclick = (e) => { e.stopPropagation(); showRepoDropdown(); };
  $('railRefresh').onclick = () => loadRepos();
  $('railSettings').onclick = () => loadView('settings');
  $('ftRefresh').onclick = () => S.treePath !== undefined && loadTree(S.treePath);
  $('btnCommit').onclick = commitFile;
  $('btnSave').onclick = () => { if (S.file) S.file.content = $('code').value; toast('已暂存（提交才会写入仓库）', 'ok'); };
  $('code').addEventListener('input', () => { S.dirty = true; updateGutter(); });
  $('code').addEventListener('scroll', () => { $('gutter').scrollTop = $('code').scrollTop; });
  $('searchBox').addEventListener('input', (e) => {
    S.filter = e.target.value.trim().toLowerCase();
    if (S.view !== 'files') loadView(S.view);
  });

  // 自动恢复 token
  const saved = localStorage.getItem(LS_TOKEN);
  if (saved) {
    $('gateToken').value = saved;
    connect(saved).catch(e => {
      log('自动连接失败：' + e.message, 'err');
    });
  }
  log('demoputter 0.3.0 已启动');
}

document.addEventListener('DOMContentLoaded', boot);
