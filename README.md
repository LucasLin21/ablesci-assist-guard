# 科研通半自动化应助Chrome浏览器插件

**AbleSci Assist Guard** 是一个面向科研通 / AbleSci 文献互助场景的半自动化应助 Chrome 插件。

本项目针对科研通文献互助平台打造，也就是 [https://www.ablesci.com/](https://www.ablesci.com/)。

它适合经常在科研通帮助他人应助文献的用户，用来减少重复点击、重复打开 DOI、重复定位 PDF、重复复制下载路径等机械操作。插件会把常见步骤串成一个“人在环路中”的辅助流程，但下载、上传和最终提交仍由用户自己确认。

> 当前版本适配 **Chrome 浏览器**。  
> 使用者需要自备有权限的账号，并确保所有文献访问、下载、分享和上传行为合法合规。

English name: **AbleSci Assist Guard**.

## 名称说明

- 中文定位：**科研通半自动化应助Chrome浏览器插件**
- 扩展名称：**AbleSci Assist Guard**
- 适用浏览器：**Chrome 浏览器**

## 项目定位

这个插件不是爬虫，也不是全自动下载器。它是针对科研通文献互助平台 [https://www.ablesci.com/](https://www.ablesci.com/) 的半自动化辅助工具。它的定位是：

- 帮你刷新科研通求助列表。
- 帮你接取当前页面中合适的求助帖。
- 帮你抓取标题、DOI、出版商入口。
- 帮你打开 DOI / 出版商页面。
- 帮你识别并点击明确的 `View PDF` 入口。
- 在你手动下载 PDF 后，帮你自动复制本地 PDF 路径。
- 帮你回到科研通上传页时更快选择文件。

它不会：

- 绕过付费墙、验证码、机构登录或出版商访问控制。
- 静默自动下载订阅全文。
- 自动上传 PDF 文件。
- 自动提交应助表单。
- 收集账号、密码、Cookie 或 PDF 文件内容。

## 适用场景

适合以下用户：

- 已经有科研通 / AbleSci 账号。
- 自备有权限的学校、机构或出版商访问账号。
- 经常手动帮助别人应助文献。
- 自己已经拥有合法访问相关文献的权限。
- 希望减少重复浏览器操作。
- 使用 Chrome 浏览器。

暂不适合：

- 希望完全无人值守批量下载的人。
- 希望自动上传、自动提交的人。
- 未确认自己是否有权访问或分享文献的人。

## 功能概览

### 1. Elsevier 求助中一键流程

点击插件面板里的 `Elsevier求助中` 后，插件会：

1. 强制刷新 Elsevier 求助中列表。
2. 等待列表加载完成。
3. 自动接本页最后一条可见求助。
4. 进入求助详情页。
5. 抓取标题、DOI 和来源链接。
6. 打开 DOI / 出版商页面。
7. 如果识别到明确的 `View PDF`，自动进入 PDF 查看页。

### 2. 扫描列表流程

点击 `扫描列表` 后，插件会扫描当前页面可见求助，并在面板中列出。

你可以选择其中某一条，点击 `打开求助`，插件会从这一条开始进入同样的半自动流程。

### 3. PDF 下载后路径复制

进入 ScienceDirect PDF 查看页后：

1. 插件开始监听新的 PDF 下载记录。
2. 你手动点击 Chrome PDF 查看器右上角下载按钮。
3. 下载完成后，插件自动识别刚下载的 PDF。
4. 插件把本地 PDF 路径复制到剪贴板。
5. 回到科研通上传页后，点击 `浏览文件`，直接粘贴路径即可。

### 4. 上传区域辅助

在科研通求助详情页，插件会尝试高亮上传区域，方便你快速定位。

注意：上传文件和最终提交仍然需要你自己手动确认。

### 5. OpenAlex 开放获取查询

插件可以通过 OpenAlex 查询开放获取候选信息，用于辅助判断是否存在开放获取来源。

## 安装教程

详细图文式文字教程见：

[docs/USAGE.zh-CN.md](docs/USAGE.zh-CN.md)

简要安装步骤：

1. 下载本项目代码。
2. 解压到一个固定文件夹。
3. 打开 Chrome 浏览器。
4. 进入 `chrome://extensions/`。
5. 打开右上角 `开发者模式`。
6. 点击 `加载已解压的扩展程序`。
7. 选择包含 `manifest.json` 的项目文件夹。
8. 打开或刷新 `https://www.ablesci.com/`。
9. 页面右下角出现 `AbleSci Assist Guard` 面板即安装成功。

## 权限说明

插件请求以下权限：

- `storage`：保存临时流程状态。
- `tabs`：打开 DOI、出版商和检索页面。
- `scripting`：Manifest V3 扩展运行所需。
- `downloads`：读取 Chrome 下载记录，用于找到用户刚刚下载完成的 PDF。
- `clipboardWrite`：复制本地 PDF 文件路径，方便用户在文件选择框中粘贴。

插件的站点权限限制在：

- `www.ablesci.com`
- `doi.org`
- `scholar.google.com`
- `www.google.com`
- `api.openalex.org`
- `www.sciencedirect.com`
- `pdf.sciencedirectassets.com`

## 文件结构

```text
.
├── manifest.json
├── background.js
├── content.js
├── content.css
├── popup.html
├── popup.css
├── docs/
│   └── USAGE.zh-CN.md
├── README.md
├── PRIVACY.md
├── SECURITY.md
├── CONTRIBUTING.md
└── LICENSE
```

## 开发说明

这是一个普通的 Manifest V3 Chrome 扩展，不需要构建步骤。

修改代码后：

1. 进入 `chrome://extensions/`。
2. 找到 AbleSci Assist Guard。
3. 点击刷新扩展。
4. 刷新科研通或出版商页面。

## 免责声明

本项目仅用于减少用户在合法、手动监督场景下的重复浏览器操作。使用者需要自备有权限的账号，并自行确认是否有权访问、下载、分享或上传相关文献；一切使用均应合法合规。

本项目不隶属于科研通 / AbleSci、Elsevier、ScienceDirect、OpenAlex、Google 或任何出版商。

## License

MIT License. See [LICENSE](LICENSE).
