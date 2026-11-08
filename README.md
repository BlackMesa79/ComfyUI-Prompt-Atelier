# ComfyUI-Prompt-Atelier · 提示词工坊

为 ComfyUI 多行提示词文本框提供 Danbooru 标签、LoRA、embedding 补全和可分类的提示词片段库。纯 ESM，无构建步骤，无 npm 依赖；Python 后端使用 ComfyUI 自带的 aiohttp。

## 安装

在 ComfyUI 的 `custom_nodes` 目录中运行：

```sh
git clone https://github.com/BlackMesa79/ComfyUI-Prompt-Atelier
```

也可在 GitHub 仓库选择 **Code → Download ZIP**，解压到 `ComfyUI/custom_nodes/ComfyUI-Prompt-Atelier/`。确保该目录直接包含 `__init__.py`、`py/` 和 `web/`，避免重复嵌套。重启 ComfyUI 并刷新浏览器。

首次使用需要下载标签库：点击页面提示条的「📥 下载标签库」，或在浏览器开发者工具 Console 执行：

```js
await window.PromptAtelier.updateTags()
```

后端从 PYU224/tagdb-updater 下载、校验并保存到扩展目录的 `web/tags/danbooru.csv`。CSV 不随仓库分发。未下载时仍可使用模型补全和片段库；更新失败通常保留原标签库。

## 标签、括号与模型补全

- 输入部分标签即可查询；空格与下划线等价、忽略大小写，名称和别名都能匹配，前缀优先，按热度排列。
- 候选显示分类色条、使用数量和别名对应的真实标签；确认使用原始标签名。
- 默认转义字面括号：`aru` → `aru \(blue archive\), `，已转义括号不重复转义；可关闭括号转义。
- 输入 `<lora:` 或 `lora:` 查询 LoRA，插入 `<lora:名称:1.0>`；输入 `embedding:` 查询 embedding。输入 `lor` / `emb` 也有前缀引导项。
- LoRA 去除文件扩展名，保留子目录；模型名不做标签括号转义。模型列表按需刷新，失败保留已有缓存。
- 自动逗号避免重复已有逗号，也不会在紧邻权重闭合符前追加。补全会替换当前完整词段。

**原生 CLIPTextEncode 不解析 `<lora:...>`。** 这项功能只补全文本；实际加载 LoRA 需使用 LoRA 加载节点，或支持该语法的提示词节点。原生文本编码支持 embedding 语法。

## 提示词片段库

输入 `snip:` 列出片段，或输入 `snip:关键词` 查询名称、分类和内容；支持中文与空格，名称前缀优先，同级最近更新优先。`sni` 提供模式引导。插入时保留片段的括号、反斜杠和换行，仅处理与前后文交界的自动逗号。

选中节点文本框中的非空文本，点击「＋ 保存为片段」或按 **Ctrl+Shift+S**。名称默认取内容前 20 个字符，可编辑名称、分类、内容和说明。分类下拉末尾可新建分类。

侧边栏书签图标打开「片段库」：支持新建、搜索、分类筛选、编辑、删除、复制、插入到最近聚焦的文本框、JSON 导入和导出。若宿主不支持侧栏，使用设置里的「打开片段库」；也可执行 `window.PromptAtelier.openSnippets()`。

「管理分类」支持新建、重命名、上移/下移及删除。默认分类为角色、正面、负面、构图、表情动作；非空分类删除前必须选择接收分类并再次确认。重命名和移动删除会一起保存分类及片段，失败时保留原状态。

数据经 ComfyUI 用户数据 API 保存，默认位置为 `ComfyUI/user/default/prompt_atelier_snippets.json`；多用户环境各自保存。v2 格式包含 `version`、`categories`、`snippets`。v1 读取时只在内存升级，首次保存才写 v2。导入接受 v1/v2：分类有序合并，同 id 片段由导入内容覆盖，不同 id 的同名片段保留。导出可作手动备份。

损坏片段库会提示警告。首次写入前备份原始字节到 `prompt_atelier_snippets.backup-<时间戳>-<唯一标识>.json`，备份失败则禁止覆盖。多个浏览器页面同时编辑尚无跨页面冲突合并；建议避免并行修改。程序插入使用 `setRangeText`，撤销行为可能与手工输入不同。

## 标签库自动更新

周期可选关闭、每天（24 小时）、每周（7 天）、每月（30 天），默认每周。上游 GitHub Actions 计划每周一 **03:00 UTC** 更新；实际执行时间可能延迟。

后端启动约 60 秒后检查，此后每小时检查，按最后成功检查时间计算周期，不依赖浏览器打开。失败后自动重试至少间隔一小时，手动更新可立即重试；已有更新进行时返回 409。条件请求使用 ETag / Last-Modified，304 只更新成功检查时间。内容变化时通知前端重新加载。

配置保存于 `ComfyUI/user/prompt_atelier.json`（实际根目录由 `folder_paths.get_user_directory()` 决定）。更新策略由该 ComfyUI 实例共享，页面加载时以后端配置为准。设置说明显示上次成功检查时间，含 304。损坏配置回退默认值并记录原因。

下载在 **ComfyUI 服务端**进行，使用 `aiohttp.ClientSession(trust_env=True)`，代理由启动 ComfyUI 时的 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量生效；修改后需重启服务。浏览器代理不会自动变成后端代理。

后端接口：`GET /prompt-atelier/tags`、`GET /prompt-atelier/status`、`POST /prompt-atelier/update`、`GET/POST /prompt-atelier/config`。配置 POST 接受例如 `{"auto_update":"weekly"}`。

## 全部设置

设置分组为 **PromptAtelier**。以下 ID 均加前缀 `PromptAtelier.`。

| ID 后缀 | 显示项 | 默认值 / 说明 |
| --- | --- | --- |
| enabled | 启用提示词自动补全 | 开启 |
| escapeParentheses | 插入时转义括号 | 开启，仅标签 |
| completeLoras | 补全 LoRA | 开启 |
| completeEmbeddings | 补全 embedding | 开启 |
| completeSnippets | 补全片段 (snip:) | 开启，关闭不影响侧栏和选区保存 |
| autoComma | 补全后自动追加逗号 | 开启 |
| maxSuggestions | 最大候选数 | 20，范围 1–100 |
| autoUpdate | 标签库自动更新 | weekly，支持 off/daily/weekly/monthly |
| UpdateTags | 📥 更新标签库 | 操作按钮，部分新版设置面板不显示；可用 Console 入口 |
| OpenSnippets | 打开片段库 | 仅侧栏 API 不可用时注册，默认关闭，打开后复位 |

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 上下选择候选 | ↑ / ↓ |
| 确认候选 | Tab / Enter，或点击候选 |
| 关闭候选 / 对话框 | Esc |
| 将非空选区保存为片段 | Ctrl+Shift+S |
| 保存片段编辑表单 | Ctrl+Enter |

无候选或存在非空选区时，不拦截候选确认按键。选区变化会关闭失效下拉并显示保存按钮；输入法组字期间不确认补全。

## 从 Prompt Autocomplete 迁移

安装新版本后，**删除 custom_nodes 中旧扩展目录，避免两个版本同时加载**，再重启。删除前可手动将旧目录的 `web/tags/danbooru.csv` 复制到新目录同一位置；代码不迁移 CSV。

- 新片段文件不存在而 `prompt_snippets.json` 存在时，自动按原始字节复制到 `prompt_atelier_snippets.json`；包括损坏文件也原样复制，随后显示损坏保护提示。两个文件都存在时只读取新文件。旧备份文件保留原名，不自动搬移。
- 原始设置字典中显式保存的 `PromptAutocomplete.*` 迁移到 `PromptAtelier.*`；仅新键不存在时写入，显式 false 也保留。默认值不当作用户保存过的值，旧键保留。
- `user/prompt_autocomplete.json` 在新配置不存在时原样复制为 `user/prompt_atelier.json`；损坏内容按默认规则回退，服务仍可启动。

迁移不删除旧文件，按新文件 / 新键是否存在实现幂等，成功后记录日志。用户数据在 `user/` 中，删除旧扩展目录不会删除这些文件；请先自行确认有无放在扩展目录中的额外数据。

## 共存与兼容性

与 **ComfyUI-Custom-Scripts 的 Text Autocomplete** 同时启用会出现两个下拉框，请关闭其中一个补全功能。

在 **ComfyUI v0.44.1 / 前端 1.57.6** 的接口基础上测试：本轮包括内嵌 Python 桩测试、独立无头 Chrome 的迁移与交互回归。未自动部署，真实宿主主题、其他扩展组合和代理下载仍需安装后验收。

扩展引用 `scripts/widgets.js` 内部模块并包装 `ComfyWidgets.STRING`，前端升级时可能需要适配。仅对多行 STRING widget 提供补全。

## Roadmap

- AI 提示词调优：计划支持 Ollama / DeepSeek / OpenAI / Claude；当前版本尚未实现。

## 致谢 / Third-party

- [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)，作者 **pythongosssss**，MIT：移植其 caret 位置计算代码。相关文件 `web/js/autocomplete-ui.js` 保留完整版权与许可声明。
- [textarea-caret-position](https://github.com/component/textarea-caret-position)，作者 **Jonathan Ong**，MIT：上述光标计算中的镜像文本框实现，完整声明保留在同一文件。
- 原移植文件还包含 [textcomplete](https://github.com/yuku/textcomplete) 的来源及 MIT 声明，继续保留。
- [PYU224/tagdb-updater](https://github.com/PYU224/tagdb-updater)，MIT：运行时下载标签 CSV 的来源，数据不随本仓库分发。上游计划见其 `.github/workflows/update-tags.yml`。
- 标签名称、分类、投稿数量及别名源自 [Danbooru](https://danbooru.donmai.us/) 公开数据，经上述上游项目整理。本项目非 Danbooru 官方项目，不分发图片；上游代码的 MIT 声明不代表对全部原始数据另行授予许可，使用数据应遵循来源要求。

本项目使用 MIT License，Copyright (c) 2026 BlackMesa79，见 [LICENSE](LICENSE)。`pyproject.toml` 使用 Registry 文档支持的 `license = { file = "LICENSE" }`；发布到 Comfy Registry 前需注册发布者并填写 `PublisherId`。GitHub 发布不依赖 Registry 注册。

## English

**Prompt Atelier** adds Danbooru tag, LoRA and embedding autocomplete plus a categorized prompt snippet library to ComfyUI multiline text widgets. Pure ESM, no build or npm dependencies; aiohttp is supplied by ComfyUI.

### Installation

Run `git clone https://github.com/BlackMesa79/ComfyUI-Prompt-Atelier` inside `ComfyUI/custom_nodes/`. Alternatively, download the repository ZIP and extract it into `ComfyUI/custom_nodes/ComfyUI-Prompt-Atelier/`, with `__init__.py` directly in that folder. Restart ComfyUI and refresh the browser.

On first use, click the tag download notice or run `await window.PromptAtelier.updateTags()` in the browser console. Tags are downloaded by the server to `web/tags/danbooru.csv` and are not bundled in this repository.

### Features and usage

- Tag completion: category color bars, counts, aliases, case-insensitive matching, equivalent spaces/underscores, optional parenthesis escaping and automatic commas.
- Type `<lora:` / `lora:` or `embedding:` for model names. Native **CLIPTextEncode does not parse LoRA tags**; use an appropriate loader/parser. Embeddings are supported by native text encoding.
- Type `snip:` to search saved snippets. Select text and click the save button or press **Ctrl+Shift+S**. Snippet contents retain parentheses, backslashes and newlines.
- The bookmark sidebar supports search, category filtering, editing, deletion, copying, insertion and JSON import/export. Manage categories with rename, reorder and move-before-delete controls. Default data location: `ComfyUI/user/default/prompt_atelier_snippets.json`. Corrupt files must be backed up successfully before replacement; v1 upgrades to v2 only on saving.
- Automatic updates: off/daily/weekly/monthly, default weekly. The upstream schedule is Monday 03:00 UTC. Server checks start after about 60 seconds and repeat hourly. Proxy configuration uses the server's `HTTP_PROXY` / `HTTPS_PROXY` environment variables. Configuration: `ComfyUI/user/prompt_atelier.json`.
- Settings group: **PromptAtelier**. All autocomplete switches default on; maximum suggestions defaults to 20 (1–100). The complete settings table above includes update and fallback snippet-library actions.
- Keys: **↑/↓** select, **Tab/Enter** accept, **Esc** dismiss, **Ctrl+Shift+S** save selected text, **Ctrl+Enter** submit the snippet editor. Click candidates to accept.

Legacy snippets, explicitly stored settings and update configuration migrate automatically only when their new counterparts are absent; legacy files and keys remain. Remove the old extension directory before restarting, and manually copy its CSV if desired. See the migration section above.

Disable either this autocomplete or ComfyUI-Custom-Scripts Text Autocomplete to avoid duplicate dropdowns. Tested against ComfyUI **v0.44.1 / frontend 1.57.6** APIs using isolated backend and headless-browser tests; real-host integration still needs deployment acceptance. The internal `scripts/widgets.js` dependency may require adaptation after frontend upgrades.

Planned: AI prompt refinement with Ollama / DeepSeek / OpenAI / Claude. MIT; see the third-party credits and retained notices above.
