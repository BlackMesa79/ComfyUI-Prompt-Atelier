import { api } from "../../../scripts/api.js";

// 按种类共享缓存；失败也记录尝试时间，避免每次按键重试。
export class ModelDatabase {
    constructor() {
        this.cache = Object.fromEntries(["lora", "embedding"].map(kind => [kind, { names: [], checkedAt: -Infinity, pending: null }]));
    }

    refresh(kind) {
        const entry = this.cache[kind];
        if (entry.pending) return entry.pending;
        if (Date.now() - entry.checkedAt < 30_000) return Promise.resolve();
        entry.checkedAt = Date.now();
        entry.pending = (async () => {
            try {
                let names;
                if (kind === "embedding") names = await api.getEmbeddings();
                else {
                    const response = await api.fetchApi("/models/loras", { cache: "no-store" });
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    names = await response.json();
                }
                if (!Array.isArray(names) || names.some(name => typeof name !== "string")) throw new Error("模型列表格式错误");
                // 只剥离文件名的最后一个扩展名，保留目录及其分隔符。
                entry.names = [...new Set(names.map(name => kind === "lora" ? name.replace(/\.[^./\\]+$/, "") : name))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
            } catch (error) {
                console.warn("[PromptAtelier] " + kind + " 列表加载失败", error);
            } finally { entry.checkedAt = Date.now(); }
        })().finally(() => { entry.pending = null; });
        return entry.pending;
    }

    load() { return Promise.all([this.refresh("embedding"), this.refresh("lora")]); }

    search(kind, query, max) {
        const q = query.toLowerCase();
        const prefix = [], substring = [];
        for (const name of this.cache[kind].names) {
            const pos = name.toLowerCase().indexOf(q);
            if (pos < 0) continue;
            (pos === 0 ? prefix : substring).push({ kind, name, matchPos: pos, matchLength: q.length });
        }
        return prefix.concat(substring).slice(0, max);
    }
}
