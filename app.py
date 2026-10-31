"""demoputter · desktop shell (pywebview)

后端能力（暴露给前端 JS 通过 window.pywebview.api 调用）：
  - 本地目录浏览、工作区扫描
  - Git：init / status / add / commit / push / log / remote
  - 构建：在指定目录运行命令并回传输出
  - 发布：调用 GitHub API 创建 release（用已构建产物或自动构建）

启动: python app.py
"""
import os
import sys
import json
import shutil
import subprocess
import urllib.request

import webview

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def run(cmd, cwd, timeout=120):
    """运行命令，返回 (ok, output)。"""
    try:
        p = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
            shell=isinstance(cmd, str),
            encoding='utf-8', errors='replace',
        )
        out = (p.stdout or '') + (p.stderr or '')
        return p.returncode == 0, out.strip()
    except subprocess.TimeoutExpired:
        return False, f'命令超时（{timeout} 秒）'
    except Exception as e:
        return False, str(e)


def is_git_repo(path):
    return os.path.isdir(os.path.join(path, '.git'))


def safe_join(base, *parts):
    p = os.path.abspath(os.path.join(base, *parts))
    if not p.startswith(os.path.abspath(base)):
        raise ValueError('路径越界')
    return p


class Api:
    def __init__(self):
        self.window = None
        self._token = ''

    # ---------- GitHub API 代理（避免 WebView 的 CORS 限制） ----------
    def set_token(self, token):
        self._token = (token or '').strip()
        return {'ok': bool(self._token)}

    def gh_request(self, method, path, body=None):
        """在 Python 侧请求 GitHub API，前端只管传路径。"""
        try:
            url = 'https://api.github.com' + path
            data = None
            if body is not None:
                data = json.dumps(body).encode('utf-8')
            req = urllib.request.Request(url, data=data, method=method, headers={
                'Authorization': f'Bearer {self._token}',
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'demoputter',
            })
            with urllib.request.urlopen(req, timeout=25) as r:
                raw = r.read().decode('utf-8', errors='replace')
                return {'ok': True, 'status': r.status, 'data': json.loads(raw) if raw else None}
        except urllib.error.HTTPError as e:
            body_text = ''
            try:
                body_text = e.read().decode('utf-8', errors='replace')
            except Exception:
                pass
            try:
                msg = json.loads(body_text).get('message', '') if body_text else ''
            except Exception:
                msg = body_text[:200]
            return {'ok': False, 'status': e.code, 'error': f'{e.code} {msg}'}
        except Exception as e:
            return {'ok': False, 'status': 0, 'error': str(e)}

    # ---------- 目录 ----------
    def pick_dir(self):
        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            return {'ok': True, 'path': result[0]}
        return {'ok': False, 'path': ''}

    def list_workspace(self, path):
        """列出目录内容（跳过 .git），标出文件大小与修改时间。"""
        try:
            if not os.path.isdir(path):
                return {'ok': False, 'error': '目录不存在'}
            items = []
            for name in sorted(os.listdir(path)):
                if name in ('.git', 'node_modules', '__pycache__', '.next', 'dist', 'build'):
                    continue
                full = os.path.join(path, name)
                try:
                    st = os.stat(full)
                    items.append({
                        'name': name,
                        'dir': os.path.isdir(full),
                        'size': 0 if os.path.isdir(full) else st.st_size,
                        'mtime': int(st.st_mtime),
                    })
                except OSError:
                    continue
            return {'ok': True, 'path': path, 'isGit': is_git_repo(path), 'items': items}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def read_file(self, path):
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                return {'ok': True, 'content': f.read()}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def write_file(self, path, content):
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    # ---------- Git ----------
    def git_status(self, path):
        if not is_git_repo(path):
            return {'ok': True, 'isGit': False, 'changed': [], 'branch': ''}
        ok, out = run(['git', 'status', '--porcelain', '-b'], path)
        changed = []
        branch = ''
        for line in out.splitlines():
            if line.startswith('##'):
                branch = line[3:].split('...')[0].strip()
            elif line.strip():
                changed.append({'code': line[:2].strip(), 'file': line[3:].strip()})
        return {'ok': True, 'isGit': True, 'branch': branch, 'changed': changed}

    def git_init(self, path):
        if is_git_repo(path):
            return {'ok': True, 'message': '已经是 git 仓库'}
        ok1, out1 = run(['git', 'init', '-b', 'main'], path)
        if not ok1:
            ok1, out1 = run(['git', 'init'], path)
        # 写一个 .gitignore（如果不存在）
        gi = os.path.join(path, '.gitignore')
        if not os.path.exists(gi):
            with open(gi, 'w', encoding='utf-8') as f:
                f.write('# 依赖\nnode_modules/\n__pycache__/\n\n# 构建产物\ndist/\nbuild/\n.next/\n\n# 系统\n.DS_Store\nThumbs.db\n')
        return {'ok': ok1, 'message': out1 or '已初始化为 git 仓库'}

    def git_commit(self, path, message):
        if not is_git_repo(path):
            return {'ok': False, 'error': '不是 git 仓库，请先初始化'}
        run(['git', 'add', '-A'], path)
        ok, out = run(['git', 'commit', '-m', message or 'update'], path)
        if not ok and 'nothing to commit' in out:
            return {'ok': True, 'message': '没有需要提交的改动'}
        return {'ok': ok, 'message': out}

    def git_push(self, path, remote='origin', branch=''):
        if not is_git_repo(path):
            return {'ok': False, 'error': '不是 git 仓库'}
        if not branch:
            _, b = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], path)
            branch = b.strip() or 'main'
        ok, out = run(['git', 'push', '-u', remote, branch], path, timeout=180)
        if not ok and ('No configured push destination' in out or 'has no upstream' in out):
            return {'ok': False, 'error': '还没有配置远程仓库，请先执行 git remote add origin <url>'}
        return {'ok': ok, 'message': out}

    def git_log(self, path, limit=20):
        if not is_git_repo(path):
            return {'ok': True, 'commits': []}
        ok, out = run(['git', 'log', f'-{limit}', '--pretty=format:%h|%s|%an|%ar'], path)
        commits = []
        for line in out.splitlines():
            parts = line.split('|', 3)
            if len(parts) == 4:
                commits.append({'sha': parts[0], 'msg': parts[1], 'author': parts[2], 'when': parts[3]})
        return {'ok': True, 'commits': commits}

    def git_remote(self, path):
        if not is_git_repo(path):
            return {'ok': True, 'remote': ''}
        _, url = run(['git', 'remote', 'get-url', 'origin'], path)
        return {'ok': True, 'remote': url.strip()}

    def git_set_remote(self, path, url):
        if not is_git_repo(path):
            return {'ok': False, 'error': '不是 git 仓库'}
        run(['git', 'remote', 'remove', 'origin'], path)
        ok, out = run(['git', 'remote', 'add', 'origin', url], path)
        return {'ok': ok, 'message': out or '远程已设置'}

    def git_add_commit_push(self, path, message):
        """一键：add → commit → push。"""
        r1 = self.git_commit(path, message)
        if not r1.get('ok'):
            return r1
        r2 = self.git_push(path)
        return {'ok': r2.get('ok'), 'message': (r1.get('message', '') + '\n' + r2.get('message', '')).strip()}

    # ---------- 构建 ----------
    def build(self, path, cmd, timeout=300):
        if not cmd:
            cmd = self.detect_build_cmd(path)
        ok, out = run(cmd, path, timeout=timeout)
        return {'ok': ok, 'cmd': cmd, 'output': out}

    def detect_build_cmd(self, path):
        """根据项目特征猜构建命令。"""
        if os.path.exists(os.path.join(path, 'package.json')):
            try:
                with open(os.path.join(path, 'package.json'), 'r', encoding='utf-8') as f:
                    pkg = json.load(f)
                if 'build' in pkg.get('scripts', {}):
                    return 'npm run build'
            except Exception:
                pass
            return 'npm run build'
        if os.path.exists(os.path.join(path, 'pyproject.toml')) or os.path.exists(os.path.join(path, 'setup.py')):
            return 'python -m build'
        if os.path.exists(os.path.join(path, 'Cargo.toml')):
            return 'cargo build --release'
        if os.path.exists(os.path.join(path, 'go.mod')):
            return 'go build'
        return 'echo "没有识别到构建脚本，请手动填写命令"'

    # ---------- 发布 ----------
    def create_release(self, token, owner, repo, tag, name, body, files=None):
        """调用 GitHub API 创建 release，可选上传产物。"""
        try:
            api = f'https://api.github.com/repos/{owner}/{repo}/releases'
            payload = json.dumps({
                'tag_name': tag, 'name': name or tag, 'body': body or '',
                'draft': False, 'prerelease': False,
            }).encode()
            req = urllib.request.Request(api, data=payload, method='POST', headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'demoputter',
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                return {'ok': True, 'json': json.loads(r.read().decode())}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    # ---------- 灰度 ----------
    def create_canary(self, path, branch='canary'):
        """一键建灰度分支：从当前分支拉 canary 并推送。"""
        if not is_git_repo(path):
            return {'ok': False, 'error': '不是 git 仓库'}
        _, cur = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], path)
        cur = cur.strip() or 'main'
        run(['git', 'checkout', '-B', branch], path)
        ok, out = run(['git', 'push', '-u', 'origin', branch], path, timeout=180)
        run(['git', 'checkout', cur], path)
        return {'ok': ok, 'message': out or f'灰度分支 {branch} 已创建并推送'}

    # ---------- 系统 ----------
    def open_path(self, path):
        try:
            os.startfile(path)  # Windows
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}


def main():
    # 起一个本地 HTTP 服务托管页面（避免 file:// 下 WebView2 的网络/CORS 问题）
    import threading
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from functools import partial

    port = 18791
    handler = partial(SimpleHTTPRequestHandler, directory=BASE_DIR)
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    api = Api()
    window = webview.create_window(
        'demoputter',
        f'http://127.0.0.1:{port}/index.html',
        js_api=api,
        width=1440, height=900,
        min_size=(1080, 640),
        background_color='#f6f8fb',
    )
    api.window = window
    try:
        webview.start(debug=False)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
