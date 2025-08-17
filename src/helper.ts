import { MarkdownView, App } from "obsidian";
import { parse } from "path-browserify";

interface Image {
  path: string;
  name: string;
  source: string;
}
// ![](./dsa/aa.png) local image should has ext, support ![](<./dsa/aa.png>), support ![](image.png "alt")
// ![](https://dasdasda) internet image should not has ext
const REGEX_FILE =
  /\!\[(.*?)\]\(<(\S+\.\w+)>\)|\!\[(.*?)\]\((\S+\.\w+)(?:\s+"[^"]*")?\)|\!\[(.*?)\]\((https?:\/\/.*?)\)/g;
const REGEX_WIKI_FILE = /\!\[\[(.*?)(\s*?\|.*?)?\]\]/g;
// <img src="url"/> HTML image tag support
const REGEX_HTML_IMG = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;

export default class Helper {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  getFrontmatterValue(key: string, defaultValue: any = undefined) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return undefined;
    }
    const path = file.path;
    const cache = this.app.metadataCache.getCache(path);

    let value = defaultValue;
    if (cache?.frontmatter && cache.frontmatter.hasOwnProperty(key)) {
      value = cache.frontmatter[key];
    }
    return value;
  }

  getEditor() {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView) {
      return mdView.editor;
    } else {
      return null;
    }
  }

  getValue() {
    const editor = this.getEditor();
    return editor.getValue();
  }

  setValue(value: string) {
    const editor = this.getEditor();
    const { left, top } = editor.getScrollInfo();
    const position = editor.getCursor();

    editor.setValue(value);
    editor.scrollTo(left, top);
    editor.setCursor(position);
  }

  // get all file urls, include local and internet
  getAllFiles(): Image[] {
    const editor = this.getEditor();
    let value = editor.getValue();
    return this.getImageLink(value);
  }

  getImageLink(value: string): Image[] {
    const matches = value.matchAll(REGEX_FILE);
    const WikiMatches = value.matchAll(REGEX_WIKI_FILE);
    const HtmlMatches = value.matchAll(REGEX_HTML_IMG);

    let fileArray: Image[] = [];

    // 处理 Markdown 格式：![](url)
    for (const match of matches) {
      const source = match[0];

      let name = match[1];
      let path = match[2];
      if (name === undefined) {
        name = match[3];
      }
      if (path === undefined) {
        path = match[4];
      }
      // 处理第三个匹配组：https URL
      if (name === undefined) {
        name = match[5];
      }
      if (path === undefined) {
        path = match[6];
      }

      fileArray.push({
        path: path,
        name: name,
        source: source,
      });
    }

    // 处理 Wiki 格式：![[image]]
    for (const match of WikiMatches) {
      let name = parse(match[1]).name;
      const path = match[1];
      const source = match[0];
      if (match[2]) {
        name = `${name}${match[2]}`;
      }
      fileArray.push({
        path: path,
        name: name,
        source: source,
      });
    }

    // 处理 HTML 格式：<img src="url"/>
    for (const match of HtmlMatches) {
      const source = match[0];  // 完整的 <img> 标签
      const path = match[1];    // src 属性中的 URL
      
      // 从URL中提取文件名作为name，如果提取失败则使用默认名称
      let name = "image";
      try {
        const url = new URL(path);
        const pathname = url.pathname;
        const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (filename && filename.includes('.')) {
          name = filename.split('?')[0]; // 去掉查询参数
        } else if (pathname !== '/') {
          name = pathname.substring(1); // 去掉开头的 '/'
        }
      } catch {
        // URL解析失败，使用默认名称
        name = path.includes('/') ? path.split('/').pop().split('?')[0] : "image";
      }

      fileArray.push({
        path: path,
        name: name,
        source: source,
      });
    }

    return fileArray;
  }

  hasBlackDomain(src: string, blackDomains: string) {
    if (blackDomains.trim() === "") {
      return false;
    }
    const blackDomainList = blackDomains.split(",").filter(item => item !== "");
    let url = new URL(src);
    const domain = url.hostname;

    return blackDomainList.some(blackDomain => domain.includes(blackDomain));
  }
}
