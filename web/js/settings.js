import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const defaults = { enabled: true, maxSuggestions: 20, autoComma: true, escapeParentheses: true, completeLoras: true, completeEmbeddings: true, completeSnippets: true, autoUpdate: "weekly" };
export const settings = { ...defaults };
let registered = false;
let updating = null;

const AUTO_UPDATE_ID = "PromptAtelier.autoUpdate";
let configQueue = Promise.resolve();
let backendConfig = null;
let synchronizing = false;
let autoDefinition = null;

// 只根据服务端原始字典判断显式保存状态，不能用带默认值的设置 getter。
export async function migrateSettings() {
    const response = await api.fetchApi("/settings");
    if (!response.ok) throw new Error("读取原始设置失败：HTTP " + response.status);
    const raw = await response.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("原始设置不是字典");
    const legacyPrefix = "PromptAutocomplete.";
    for (const [oldId, value] of Object.entries(raw)) {
        if (!oldId.startsWith(legacyPrefix)) continue;
        const id = "PromptAtelier." + oldId.slice(legacyPrefix.length);
        if (Object.hasOwn(raw, id)) continue;
        // 先显式持久化，避免设置管理器因值等于默认值而跳过写入。
        const saved = await api.storeSetting(id, value);
        if (!saved?.ok) throw new Error("迁移设置失败：" + id + " HTTP " + saved?.status);
        raw[id] = value;
        // 注册设置前同步缓存，使首次 onChange 就能取得迁移后的值。
        await app.ui.settings.setSettingValueAsync(id, value);
        console.info("[PromptAtelier] 已迁移设置，旧键保留：", id);
    }
}

function queueConfig(action) {
    const task = configQueue.then(action);
    configQueue = task.catch(() => {});
    return task;
}

async function applyConfig(config) {
    backendConfig = config;
    settings.autoUpdate = config.auto_update;
    const time = config.last_success_at ? new Date(config.last_success_at).toLocaleString() : "尚未成功更新";
    const tooltip = "由后端调度，启动约 60 秒后检查，此后每小时检查。上游每周一 03:00 UTC 更新。上次成功更新：" + time;
    if (autoDefinition) autoDefinition.tooltip = tooltip;
    const manager = app.ui.settings;
    // 目标前端公开 settingsLookup，更新响应式定义使说明文字随状态刷新。
    if (manager.settingsLookup?.[AUTO_UPDATE_ID]) manager.settingsLookup[AUTO_UPDATE_ID].tooltip = tooltip;
    synchronizing = true;
    try {
        if (manager.getSettingValue(AUTO_UPDATE_ID) !== config.auto_update) {
            if (manager.setSettingValueAsync) await manager.setSettingValueAsync(AUTO_UPDATE_ID, config.auto_update);
            else await manager.setSettingValue?.(AUTO_UPDATE_ID, config.auto_update);
        }
    } finally { synchronizing = false; }
}

async function requestConfig(options) {
    const response = await api.fetchApi("/prompt-atelier/config", options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "标签更新配置请求失败：HTTP " + response.status);
    if (!["off", "daily", "weekly", "monthly"].includes(data.auto_update)) throw new Error("后端更新周期无效");
    return data;
}

export function syncAutoUpdateConfig() {
    return queueConfig(async () => { await applyConfig(await requestConfig()); });
}

function registerAutoUpdate(manager) {
    // addSetting 会立即回调本地旧值；注册阶段忽略它，首次读取以后端为准。
    let registering = true;
    autoDefinition = {
        id: AUTO_UPDATE_ID, name: "标签库自动更新", type: "combo", defaultValue: "weekly",
        options: [{ text: "关闭", value: "off" }, { text: "每天", value: "daily" }, { text: "每周", value: "weekly" }, { text: "每月", value: "monthly" }],
        tooltip: "上次成功更新：正在读取后端配置…",
        onChange: value => {
            if (registering || synchronizing) return;
            void queueConfig(async () => {
                try {
                    await applyConfig(await requestConfig({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto_update: value }) }));
                } catch (error) {
                    if (backendConfig) await applyConfig(backendConfig);
                    throw error;
                }
            }).catch(error => console.warn("[PromptAtelier] 自动更新设置保存失败", error));
        },
    };
    manager.addSetting(autoDefinition);
    registering = false;
}

export function updateTags() {
    if (updating) return updating;
    updating = (async () => {
        const response = await api.fetchApi("/prompt-atelier/update", { method: "POST" });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "标签库更新失败");
        window.dispatchEvent(new CustomEvent("prompt-atelier:reload"));
        console.info("[PromptAtelier] 标签库下载完成", data);
        void syncAutoUpdateConfig().catch(error => console.warn("[PromptAtelier] 更新状态同步失败", error));
        return data;
    })().finally(() => { updating = null; });
    return updating;
}

export function registerSettings() {
    if (registered) return;
    try {
        const manager = app.ui.settings;
        for (const [key, name, type] of [
            ["enabled", "启用提示词自动补全", "boolean"],
            ["escapeParentheses", "插入时转义括号", "boolean"],
            ["completeLoras", "补全 LoRA", "boolean"],
            ["completeEmbeddings", "补全 embedding", "boolean"],
            ["completeSnippets", "补全片段 (snip:)", "boolean"],
            ["autoComma", "补全后自动追加逗号", "boolean"],
            ["maxSuggestions", "最大候选数", "number"],
        ]) {
            const normalize = value => {
                if (type !== "number") return value === true;
                const numericMax = Number(value);
                return Number.isFinite(numericMax) ? Math.max(1, Math.min(100, Math.trunc(numericMax))) : 20;
            };
            const id = "PromptAtelier." + key;
            manager.addSetting({
                id, name, type, defaultValue: settings[key],
                attrs: type === "number" ? { min: 1, max: 100, step: 1 } : undefined,
                onChange: value => { settings[key] = normalize(value); window.dispatchEvent(new Event("prompt-atelier:settings")); },
            });
            const value = manager.getSettingValue(id);
            if (value !== undefined) settings[key] = normalize(value);
        }
        registerAutoUpdate(manager);
        registered = true;
        // 自定义控件只增强旧版面板，独立下载入口由入口模块安装。
        try {
            manager.addSetting({
                id: "PromptAtelier.UpdateTags",
                name: "📥 更新标签库",
                type: () => {
                    try {
                        const row = document.createElement("tr");
                        const cell = document.createElement("td");
                        cell.colSpan = 2;
                        const button = document.createElement("button");
                        button.textContent = "📥 更新标签库";
                        button.onclick = async () => {
                            button.disabled = true;
                            button.textContent = "正在下载…";
                            try {
                                const result = await updateTags();
                                button.textContent = "已更新 " + result.tag_count + " 条标签";
                            } catch (error) { button.textContent = "更新失败：" + error.message; }
                            finally { button.disabled = false; }
                        };
                        cell.appendChild(button); row.appendChild(cell);
                        return row;
                    } catch (error) {
                        console.warn("[PromptAtelier] 旧版更新按钮无法渲染，请使用全局下载入口", error);
                        return document.createElement("tr");
                    }
                },
            });
        } catch (error) {
            console.info("[PromptAtelier] 当前面板不支持自定义按钮，请调用 window.PromptAtelier.updateTags()", error);
        }
    } catch (error) {
        Object.assign(settings, defaults);
        registered = false;
        console.warn("[PromptAtelier] 设置不可用但补全仍工作，已使用默认设置", error);
    }
}
