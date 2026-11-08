import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";
import { api } from "../../../scripts/api.js";
import { SnippetStore } from "./snippet-store.js";
import { SnippetLibrary } from "./snippet-ui.js";
import { ModelDatabase } from "./model-database.js";
import { TagDatabase } from "./tag-database.js";
import { TagAutoComplete } from "./autocomplete-ui.js";
import { registerSettings, migrateSettings, updateTags, syncAutoUpdateConfig } from "./settings.js";

const db = new TagDatabase();
const models = new ModelDatabase();
const instances = new WeakMap();
let initialized = false;
let notice = null;
let snippets, library, controller, observer, originalWidget, wrappedWidget;
const activeInstances = new Set();

function destroy() {
    controller?.abort(); observer?.disconnect();
    for (const instance of activeInstances) instance.destroy();
    activeInstances.clear(); library?.destroy();
    notice?.remove(); notice = null;
    if (ComfyWidgets.STRING === wrappedWidget) ComfyWidgets.STRING = originalWidget;
    initialized = false;
}

function showDownloadNotice(message) {
    if (notice) return;
    notice = document.createElement("div");
    notice.className = "pat-notice";
    const text = document.createElement("span");
    text.textContent = message;
    const button = document.createElement("button");
    button.textContent = "📥 下载标签库";
    button.onclick = async () => {
        button.disabled = true;
        try { await updateTags(); }
        catch (error) { text.textContent = "下载失败：" + error.message; }
        finally { button.disabled = false; }
    };
    const close = document.createElement("button");
    close.textContent = "关闭";
    close.onclick = () => { notice?.remove(); notice = null; };
    notice.append(text, button, close);
    document.body.appendChild(notice);
}

async function loadDatabase({ silent = false } = {}) {
    const signal = controller?.signal;
    try {
        const response = await api.fetchApi("/prompt-atelier/status");
        if (!response.ok) throw new Error("状态查询失败：HTTP " + response.status);
        const status = await response.json();
        if (signal?.aborted) return;
        if (!status.exists) {
            if (!silent) showDownloadNotice("首次使用标签补全，需要先下载标签库。");
            return;
        }
        await db.load(api.apiURL("/prompt-atelier/tags"));
        notice?.remove(); notice = null;
    } catch (error) {
        if (signal?.aborted) return;
        console.warn("[PromptAtelier]", error);
        if (!silent) showDownloadNotice("标签库无法加载：" + error.message);
    }
}

app.registerExtension({
    name: "PromptAtelier",
    async init() {
        if (initialized) return;
        try { await migrateSettings(); }
        catch (error) { console.warn("[PromptAtelier] 设置迁移失败，下次加载将重试未完成的键", error); }
        registerSettings();
        controller = new AbortController();
        snippets = new SnippetStore(api);
        library = new SnippetLibrary(app, snippets);
        library.register();
        const href = new URL("../css/autocomplete.css", import.meta.url).href;
        if (!Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(link => link.href === href)) {
            const link = document.createElement("link");
            link.rel = "stylesheet"; link.href = href;
            document.head.appendChild(link);
        }
        // 仅入口模块显式暴露用户可调用的独立下载入口。
        window.PromptAtelier = { updateTags, openSnippets: () => library.openPanel(), destroy };
        window.addEventListener("prompt-atelier:reload", event => { void loadDatabase(event.detail); }, { signal: controller.signal });
        const tagsUpdated = event => {
            console.info("[PromptAtelier] 收到标签库更新通知，重新加载", event.detail);
            window.dispatchEvent(new CustomEvent("prompt-atelier:reload", { detail: { silent: true } }));
            void syncAutoUpdateConfig().catch(error => console.warn("[PromptAtelier] 更新状态同步失败", error));
        };
        api.addEventListener("prompt_atelier.tags_updated", tagsUpdated);
        controller.signal.addEventListener("abort", () => api.removeEventListener("prompt_atelier.tags_updated", tagsUpdated), { once: true });
        window.addEventListener("pagehide", event => { if (!event.persisted) destroy(); }, { signal: controller.signal });
        const original = ComfyWidgets.STRING;
        originalWidget = original;
        ComfyWidgets.STRING = function(node, inputName, inputData) {
            const result = original.apply(this, arguments);
            if (inputData?.[1]?.multiline) {
                const el = result?.widget?.element ?? result?.widget?.inputEl;
                if (el instanceof HTMLTextAreaElement) {
                    const previous = instances.get(el);
                    previous?.destroy(); activeInstances.delete(previous);
                    const instance = new TagAutoComplete(el, db, { models, snippets, library });
                    instances.set(el, instance); activeInstances.add(instance);
                }
            }
            return result;
        };
        wrappedWidget = ComfyWidgets.STRING;
        // 清理已移出节点树的文本区，避免全局监听器保留失效实例。
        observer = new MutationObserver(records => {
            for (const record of records) for (const removed of record.removedNodes) {
                if (!(removed instanceof Element)) continue;
                const elements = [removed, ...removed.querySelectorAll("textarea")];
                for (const el of elements) if (!el.isConnected) {
                    const instance = instances.get(el);
                    instance?.destroy(); activeInstances.delete(instance); instances.delete(el);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        initialized = true;
    },
    async setup() { await Promise.all([syncAutoUpdateConfig().catch(error => console.warn("[PromptAtelier] 配置同步失败", error)), loadDatabase(), models.load(), snippets?.load().catch(() => {})]); },
});
