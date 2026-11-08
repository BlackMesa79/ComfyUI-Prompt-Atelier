const FILE = "prompt_atelier_snippets.json";
// 仅用于旧版片段库迁移；新文件存在时始终优先读取新文件。
const LEGACY_FILE = "prompt_snippets.json";
export const DEFAULT_CATEGORIES = ["角色", "正面", "负面", "构图", "表情动作"];

export function createSnippetId() {
    return globalThis.crypto?.randomUUID?.() ?? "snippet-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
}

export function validateSnippetData(data) {
    if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.snippets)) throw new Error("片段库格式无效，需要 version: 1 或 2 和 snippets 数组");
    const ids = new Set();
    return data.snippets.map(item => {
        if (!item || ["id", "name", "category", "content", "createdAt", "updatedAt"].some(key => typeof item[key] !== "string") || !item.id || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt)) || (item.description !== undefined && typeof item.description !== "string") || ids.has(item.id)) {
            throw new Error("片段字段、时间或 id 无效（同一文件的 id 不可重复）");
        }
        if (!item.name.trim()) throw new Error("名称不能为空");
        if (!item.content.trim()) throw new Error("内容不能为空");
        ids.add(item.id);
        return { id: item.id, name: item.name, category: item.category.trim() || DEFAULT_CATEGORIES[0], content: item.content, description: item.description ?? "", createdAt: item.createdAt, updatedAt: item.updatedAt };
    });
}

// v1 只在内存中迁移；下一次事务保存时统一写回 v2。
export function normalizeSnippetData(data) {
    const snippets = validateSnippetData(data);
    if (data.version === 2 && !Array.isArray(data.categories)) throw new Error("分类列表必须是数组");
    const categories = [];
    for (const raw of data.version === 1 ? DEFAULT_CATEGORIES : data.categories) {
        if (typeof raw !== "string" || !raw.trim()) throw new Error("分类名不能为空且必须是字符串");
        if (!categories.includes(raw.trim())) categories.push(raw.trim());
    }
    for (const item of snippets) if (!categories.includes(item.category)) categories.push(item.category);
    return { version: 2, categories, snippets };
}

// 搜索和侧边栏共用：名称前缀、名称子串、分类、内容；同级最近更新优先。
export function searchSnippets(snippets, query = "", category = "") {
    const q = query.trim().toLowerCase();
    return snippets.filter(item => !category || item.category === category).map(item => {
        const name = item.name.toLowerCase();
        const rank = !q || name.startsWith(q) ? 0 : name.includes(q) ? 1 : item.category.toLowerCase().includes(q) ? 2 : item.content.toLowerCase().includes(q) ? 3 : -1;
        return { item, rank };
    }).filter(match => match.rank >= 0).sort((a, b) => a.rank - b.rank || Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt) || a.item.id.localeCompare(b.item.id)).map(({ item }) => ({ ...item, kind: "snippet", matchPos: Math.max(0, item.name.toLowerCase().indexOf(q)), matchLength: item.name.toLowerCase().includes(q) ? q.length : 0 }));
}

export class SnippetStore extends EventTarget {
    constructor(api) {
        super();
        this.api = api;
        this.snippets = [];
        this.categoryList = [...DEFAULT_CATEGORIES];
        this.loaded = false;
        this.pending = null;
        this.queue = Promise.resolve();
        this.corruptRaw = null;
        this.warning = "";
    }

    notify(message) {
        this.warning = message;
        this.dispatchEvent(new CustomEvent("warning", { detail: message }));
    }

    load() {
        if (this.loaded) return Promise.resolve();
        if (this.pending) return this.pending;
        this.pending = (async () => {
            let response = await this.api.getUserData(FILE);
            if (response.status === 404) {
                const legacy = await this.api.getUserData(LEGACY_FILE);
                if (legacy.status !== 404) {
                    if (!legacy.ok) throw new Error("读取旧片段库失败：HTTP " + legacy.status);
                    // 直接传递原始字节，保留 BOM、换行及损坏数据，不提前升级格式。
                    const bytes = await legacy.arrayBuffer();
                    const saved = await this.api.storeUserData(FILE, bytes, { overwrite: false, stringify: false, throwOnError: false });
                    if (!saved?.ok && saved?.status !== 409) throw new Error("迁移片段库失败：HTTP " + saved?.status);
                    if (saved.ok) console.info("[PromptAtelier] 旧片段库已原样迁移，旧文件保留");
                    // 其他页面可能已创建新文件；409 时也读取新文件，绝不回退覆盖。
                    response = await this.api.getUserData(FILE);
                    if (!response.ok) throw new Error("读取迁移后的片段库失败：HTTP " + response.status);
                }
            }
            if (response.status === 404) { this.loaded = true; return; }
            if (!response.ok) throw new Error("读取片段库失败：HTTP " + response.status);
            const bytes = await response.arrayBuffer();
            const raw = new TextDecoder().decode(bytes);
            try {
                const data = normalizeSnippetData(JSON.parse(raw));
                this.snippets = data.snippets; this.categoryList = data.categories;
            }
            catch (error) {
                this.corruptRaw = bytes;
                this.notify("片段库损坏：" + error.message + "。首次保存前会备份原文件，备份失败则禁止覆盖。");
            }
            this.loaded = true;
            this.dispatchEvent(new Event("change"));
        })().catch(error => { this.notify(error.message); throw error; }).finally(() => { this.pending = null; });
        return this.pending;
    }

    categories() { return [...this.categoryList]; }
    search(query, max = Infinity, category = "") { return searchSnippets(this.snippets, query, category).slice(0, max); }
    exportData() { return { version: 2, categories: this.categories(), snippets: this.snippets.map(item => ({ ...item })) }; }

    async write(file, data, stringify) {
        const response = await this.api.storeUserData(file, data, { overwrite: true, stringify });
        if (response && !response.ok) throw new Error("保存失败：HTTP " + response.status);
    }

    mutate(transform) {
        // 排队时才读取最新缓存；成功才提交，失败保持原状态，所有界面看到同一事务结果。
        const task = this.queue.then(async () => {
            await this.load();
            const next = normalizeSnippetData(transform(this.exportData()));
            if (this.corruptRaw !== null) {
                const backup = "prompt_atelier_snippets.backup-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + createSnippetId() + ".json";
                await this.write(backup, this.corruptRaw, false);
                this.corruptRaw = null;
                this.notify("原片段库已备份到 " + backup);
            }
            await this.write(FILE, next, true);
            this.snippets = next.snippets; this.categoryList = next.categories;
            this.warning = "";
            this.dispatchEvent(new Event("change"));
        }).catch(error => { this.notify(error.message); throw error; });
        this.queue = task.catch(() => {});
        return task;
    }

    save(draft) {
        const id = draft.id || createSnippetId();
        return this.mutate(data => {
            const items = data.snippets;
            const old = items.find(item => item.id === id);
            const now = new Date().toISOString();
            const item = { id, name: draft.name.trim(), category: draft.category.trim(), content: draft.content, description: draft.description ?? "", createdAt: old?.createdAt ?? now, updatedAt: now };
            if (!item.category) throw new Error("分类名不能为空");
            return { ...data, snippets: [...items.filter(item => item.id !== id), item] };
        });
    }

    remove(id) { return this.mutate(data => ({ ...data, snippets: data.snippets.filter(item => item.id !== id) })); }

    categoryName(value, categories, previous) {
        const name = typeof value === "string" ? value.trim() : "";
        if (!name) throw new Error("分类名不能为空");
        if (name !== previous && categories.includes(name)) throw new Error("分类已存在");
        return name;
    }

    addCategory(value) {
        return this.mutate(data => {
            data.categories.push(this.categoryName(value, data.categories));
            return data;
        });
    }

    renameCategory(previous, value) {
        return this.mutate(data => {
            if (!data.categories.includes(previous)) throw new Error("分类不存在，请刷新后重试");
            const name = this.categoryName(value, data.categories, previous);
            data.categories = data.categories.map(category => category === previous ? name : category);
            const now = new Date().toISOString();
            data.snippets = data.snippets.map(item => item.category === previous ? { ...item, category: name, updatedAt: now } : item);
            return data;
        });
    }

    deleteCategory(name, target = "") {
        return this.mutate(data => {
            if (!data.categories.includes(name)) throw new Error("分类不存在，请刷新后重试");
            if (data.snippets.some(item => item.category === name)) {
                if (target === name || !data.categories.includes(target)) throw new Error("请选择另一个分类接收片段");
                const now = new Date().toISOString();
                data.snippets = data.snippets.map(item => item.category === name ? { ...item, category: target, updatedAt: now } : item);
            }
            data.categories = data.categories.filter(category => category !== name);
            return data;
        });
    }

    moveCategory(name, direction) {
        return this.mutate(data => {
            const index = data.categories.indexOf(name), next = index + direction;
            if (index < 0 || ![-1, 1].includes(direction) || next < 0 || next >= data.categories.length) throw new Error("无法继续移动分类");
            [data.categories[index], data.categories[next]] = [data.categories[next], data.categories[index]];
            return data;
        });
    }

    importData(data) {
        const imported = normalizeSnippetData(data);
        // 同 id 由导入覆盖；分类取有序并集，保留未被任何片段使用的分类。
        return this.mutate(current => ({
            version: 2,
            categories: [...new Set([...current.categories, ...imported.categories])],
            snippets: [...new Map([...current.snippets, ...imported.snippets].map(item => [item.id, item])).values()],
        }));
    }
}

// 内容原样保留，仅处理与前后文交界的自动逗号；已有后缀逗号优先复用。
export function insertSnippet(el, content, start, end, autoComma) {
    let value = content;
    if (autoComma) {
        const after = el.value.slice(end);
        if (/,\s*$/.test(value)) {
            const duplicate = /^\s*,[ \t]*/.exec(after);
            if (duplicate) end += duplicate[0].length;
            if (!/\s$/.test(value)) value += " ";
        } else if (!/^\s*[,):\]}>|]/.test(after)) value += ", ";
    }
    el.setRangeText(value, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}
