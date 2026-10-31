"""demoputter · desktop shell (pywebview)

轻量桌面壳：用系统的 WebView2 渲染，不打包浏览器内核。
启动后就是一个独立窗口，双击即用。

用法:
    python app.py
"""
import os
import sys

import webview

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def main():
    index_path = os.path.join(BASE_DIR, "index.html")
    if not os.path.exists(index_path):
        print(f"找不到 index.html: {index_path}", file=sys.stderr)
        sys.exit(1)

    webview.create_window(
        "demoputter",
        index_path,
        width=1440,
        height=900,
        min_size=(1080, 640),
        background_color="#f6f8fb",
        easy_drag=False,
    )
    webview.start(debug=False)


if __name__ == "__main__":
    main()
