import { settings } from "./settings.js";
import { insertSnippet } from "./snippet-store.js";

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function listen(controller, target, type, handler, options = {}) {
    target.addEventListener(type, handler, { ...options, signal: controller.signal });
}

export class SnippetLibrary {
    constructor(app, store) {
        this.app = app;
        this.store = store;
        this.controller = new AbortController();
        this.panels = new Set();
        this.dialogs = new Set();
        this.lastTarget = null;
        this.notice = element("div", "pat-snippet-notice");
        this.notice.hidden = true;
        this.notice.setAttribute("role", "status");
        document.body.append(this.notice);
        listen(this.controller, store, "warning", event => this.message(event.detail));
    }

    message(text) {
        if (this.controller.signal.aborted) return;
        this.notice.replaceChildren(element("span", "", text));
        const close = element("button", "", "关闭");
        close.onclick = () => { this.notice.hidden = true; };
        this.notice.append(close);
        this.notice.hidden = false;
    }

    register() {
        try {
            if (typeof this.app.extensionManager?.registerSidebarTab !== "function") throw new Error("当前前端没有侧边栏注册 API");
            this.app.extensionManager.registerSidebarTab({
                id: "prompt-atelier-snippets", icon: "pi pi-bookmark", title: "片段库", tooltip: "提示词片段库", type: "custom",
                render: container => { if (this.controller.signal.aborted) return; this.sidebarCleanup?.(); this.sidebarCleanup = this.renderPanel(container); },
                destroy: () => { this.sidebarCleanup?.(); this.sidebarCleanup = null; },
            });
        } catch (error) {
            console.info("[PromptAtelier] 片段库使用设置入口", error);
            try {
                this.app.ui.settings.addSetting({
                    id: "PromptAtelier.OpenSnippets", name: "打开片段库", defaultValue: false,
                    // boolean 入口兼容不显示自定义控件的新版设置面板，打开后立即复位。
                    type: "boolean", onChange: value => {
                        if (!value || this.controller.signal.aborted) return;
                        this.openPanel();
                        this.app.ui.settings.setSettingValue?.("PromptAtelier.OpenSnippets", false);
                    },
                });
            } catch (settingError) {
                this.message("片段库入口注册失败，可调用 window.PromptAtelier.openSnippets() 打开。");
                console.warn("[PromptAtelier]", settingError);
            }
        }
    }

    attach(el, caret, dropdown, controller) {
        const button = element("button", "pat-save-selection", "＋ 保存为片段");
        button.type = "button";
        button.hidden = true;
        document.body.append(button);
        const remember = () => {
            if (document.activeElement === el) this.lastTarget = { el, start: el.selectionStart, end: el.selectionEnd, value: el.value };
        };
        const hide = () => { button.hidden = true; };
        const refresh = () => {
            remember();
            if (document.activeElement !== el || el.selectionStart === el.selectionEnd || !el.value.slice(el.selectionStart, el.selectionEnd).trim() || !dropdown.hidden) return hide();
            const point = caret.getCursorOffset();
            button.hidden = false;
            const left = point.left ?? document.documentElement.clientWidth - point.right;
            button.style.left = Math.max(window.scrollX + 4, Math.min(left, window.scrollX + window.innerWidth - button.offsetWidth - 4)) + "px";
            button.style.top = Math.max(window.scrollY + 4, Math.min(point.top, window.scrollY + window.innerHeight - button.offsetHeight - 4)) + "px";
        };
        const saveSelection = () => {
            const content = el.value.slice(el.selectionStart, el.selectionEnd);
            if (!content.trim()) return;
            remember(); hide();
            this.openEditor({ content });
        };
        for (const type of ["focus", "select", "pointerup", "keyup", "input"]) listen(controller, el, type, refresh);
        listen(controller, document, "selectionchange", refresh);
        listen(controller, el, "blur", hide);
        listen(controller, el, "scroll", hide);
        listen(controller, document, "scroll", hide, { capture: true, passive: true });
        listen(controller, window, "resize", hide);
        listen(controller, document, "wheel", hide, { capture: true, passive: true });
        listen(controller, button, "pointerdown", event => { event.preventDefault(); });
        listen(controller, button, "click", saveSelection);
        listen(controller, el, "keydown", event => {
            if (!event.isComposing && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s" && el.selectionStart !== el.selectionEnd && el.value.slice(el.selectionStart, el.selectionEnd).trim()) {
                event.preventDefault(); event.stopImmediatePropagation(); saveSelection();
            }
        }, { capture: true });
        controller.signal.addEventListener("abort", () => {
            button.remove();
            if (this.lastTarget?.el === el) this.lastTarget = null;
        }, { once: true });
        return hide;
    }

    modal(title) {
        const controller = new AbortController();
        const previous = document.activeElement;
        const overlay = element("div", "pat-modal-overlay");
        const box = element("div", "pat-modal");
        box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", title);
        box.append(element("h3", "", title)); overlay.append(box); document.body.append(overlay);
        const close = () => { if (controller.signal.aborted) return; controller.abort(); overlay.remove(); this.dialogs.delete(close); if (previous?.isConnected) previous.focus(); };
        this.dialogs.add(close);
        listen(controller, overlay, "keydown", event => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); close(); }
            if (event.key === "Tab") {
                const nodes = [...box.querySelectorAll("input, textarea, select, button")].filter(node => !node.disabled && !node.hidden);
                const first = nodes[0], last = nodes.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });
        return { controller, overlay, box, close };
    }

    openEditor(draft = {}) {
        if (this.controller.signal.aborted) return;
        const { controller, box, close } = this.modal(draft.id ? "编辑片段" : "保存为片段");
        const form = element("form", "pat-snippet-form");
        // 统一由提交校验提示空值与纯空白，避免原生 required 抢先显示不同文案。
        form.noValidate = true;
        const fields = {};
        for (const [key, title, multiline] of [["name", "名称", false], ["category", "分类", false], ["content", "内容", true], ["description", "说明（可选）", true]]) {
            const label = element("label", "", title);
            const input = element(key === "category" ? "select" : multiline ? "textarea" : "input");
            input.name = key;
            input.value = draft[key] ?? (key === "name" ? Array.from(draft.content ?? "").slice(0, 20).join("").replace(/[\r\n]/g, " ") : key === "category" ? "角色" : "");
            if (["name", "content"].includes(key)) input.required = true;
            label.append(input); form.append(label); fields[key] = input;
        }
        let selectedCategory = draft.category ?? this.store.categories()[0] ?? "";
        const updateCategories = () => {
            const values = this.store.categories();
            // 编辑中的分类被另一界面重命名时，跟随该片段的新分类。
            if (!values.includes(selectedCategory)) selectedCategory = this.store.snippets.find(item => item.id === draft.id)?.category ?? values[0] ?? "";
            fields.category.replaceChildren(...values.map(value => { const option = element("option", "", value); option.value = value; return option; }));
            const create = element("option", "", "＋ 新建分类…"); create.value = "";
            fields.category.append(create); fields.category.value = selectedCategory;
            if (!values.length) fields.category.selectedIndex = -1;
        };
        updateCategories(); listen(controller, this.store, "change", updateCategories);
        listen(controller, fields.category, "change", () => {
            if (fields.category.value) { selectedCategory = fields.category.value; return; }
            updateCategories();
            this.editCategory(null, name => {
                if (controller.signal.aborted) return;
                selectedCategory = name; updateCategories(); fields.category.focus();
            });
        });
        const error = element("p", "pat-error"); error.setAttribute("role", "alert");
        const save = element("button", "", "保存"); save.type = "submit";
        const cancel = element("button", "", "取消"); cancel.type = "button";
        listen(controller, cancel, "click", close);
        form.append(error, save, cancel); box.append(form);
        listen(controller, form, "submit", async event => {
            event.preventDefault();
            if (save.disabled) return;
            if (!fields.name.value.trim()) { error.textContent = "名称不能为空"; fields.name.focus(); return; }
            if (!fields.category.value) { error.textContent = "请先新建分类"; fields.category.focus(); return; }
            if (!fields.content.value.trim()) { error.textContent = "内容不能为空"; fields.content.focus(); return; }
            save.disabled = true;
            try {
                await this.store.save({ ...draft, ...Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, node.value])) });
                close();
            } catch (failure) { error.textContent = failure.message; }
            finally { save.disabled = false; }
        });
        listen(controller, form, "keydown", event => {
            if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
        });
        void this.store.load().catch(failure => { error.textContent = failure.message; });
        fields.name.focus();
    }

    editCategory(previous = null, onSaved = () => {}) {
        const { controller, box, close } = this.modal(previous === null ? "新建分类" : "重命名分类");
        const form = element("form", "pat-snippet-form"); form.noValidate = true;
        const label = element("label", "", "分类名"), input = element("input");
        input.name = "categoryName"; input.value = previous ?? ""; label.append(input);
        const error = element("p", "pat-error"); error.setAttribute("role", "alert");
        const save = element("button", "", "确认"), cancel = element("button", "", "取消");
        save.type = "submit"; cancel.type = "button";
        form.append(label, error, save, cancel); box.append(form);
        listen(controller, cancel, "click", close);
        listen(controller, form, "submit", async event => {
            event.preventDefault(); if (save.disabled) return;
            save.disabled = true;
            try {
                if (previous === null) await this.store.addCategory(input.value);
                else await this.store.renameCategory(previous, input.value);
                close(); onSaved(input.value.trim());
            } catch (failure) { error.textContent = failure.message; }
            finally { save.disabled = false; }
        });
        input.focus(); input.select();
    }

    deleteCategory(name) {
        const count = this.store.snippets.filter(item => item.category === name).length;
        if (!count) { void this.store.deleteCategory(name).catch(error => this.message(error.message)); return; }
        const { controller, box, close } = this.modal("删除分类并移动片段");
        const text = element("p", "", "「" + name + "」有 " + count + " 个片段，请选择接收分类。");
        const target = element("select"); target.setAttribute("aria-label", "接收分类");
        for (const category of this.store.categories().filter(value => value !== name)) {
            const option = element("option", "", category); option.value = category; target.append(option);
        }
        const error = element("p", "pat-error"); error.setAttribute("role", "alert");
        const confirm = element("button", "", "继续"), cancel = element("button", "", "取消");
        if (!target.options.length) { error.textContent = "请先新建另一个分类接收片段。"; confirm.disabled = true; }
        box.append(text, target, error, confirm, cancel);
        listen(controller, cancel, "click", close);
        let confirmed = false;
        listen(controller, confirm, "click", async () => {
            if (!confirmed) {
                confirmed = true; target.disabled = true;
                text.textContent = "确定把「" + name + "」中的所有片段移到「" + target.value + "」，并删除原分类？";
                confirm.textContent = "确认移动并删除"; cancel.focus(); return;
            }
            confirm.disabled = true;
            try { await this.store.deleteCategory(name, target.value); close(); }
            catch (failure) { error.textContent = failure.message; confirm.disabled = false; }
        });
        cancel.focus();
    }

    openCategories() {
        if (this.controller.signal.aborted) return;
        const { controller, box, close } = this.modal("管理分类");
        const add = element("button", "", "新建分类"), done = element("button", "", "关闭");
        const list = element("div", "pat-category-list");
        box.append(add, done, list);
        listen(controller, add, "click", () => this.editCategory()); listen(controller, done, "click", close);
        let rows;
        const render = () => {
            if (controller.signal.aborted) return;
            rows?.abort(); rows = new AbortController(); list.replaceChildren();
            const categories = this.store.categories();
            categories.forEach((name, index) => {
                const row = element("article", "pat-snippet-row"); row.dataset.category = name;
                const count = this.store.snippets.filter(item => item.category === name).length;
                row.append(element("strong", "", name), element("span", "", "（" + count + " 个片段）"));
                const controls = element("div", "pat-snippet-actions");
                for (const [title, action, disabled] of [
                    ["重命名", () => this.editCategory(name), false],
                    ["删除", () => this.deleteCategory(name), false],
                    ["上移", () => this.store.moveCategory(name, -1), index === 0],
                    ["下移", () => this.store.moveCategory(name, 1), index === categories.length - 1],
                ]) {
                    const button = element("button", "", title); button.disabled = disabled;
                    listen(rows, button, "click", async () => {
                        button.disabled = true;
                        try { await action(); } catch (error) { this.message(error.message); }
                        finally { button.disabled = disabled; }
                    });
                    controls.append(button);
                }
                row.append(controls); list.append(row);
            });
        };
        listen(controller, this.store, "change", render);
        controller.signal.addEventListener("abort", () => rows?.abort(), { once: true });
        render(); void this.store.load().then(render).catch(error => this.message(error.message)); add.focus();
    }

    confirmDelete(item) {
        const { controller, box, close } = this.modal("删除片段");
        box.append(element("p", "", "确定删除「" + item.name + "」（" + item.category + "）？"));
        const confirm = element("button", "", "确认删除"), cancel = element("button", "", "取消");
        box.append(confirm, cancel);
        listen(controller, cancel, "click", close);
        listen(controller, confirm, "click", async () => {
            confirm.disabled = true;
            try { await this.store.remove(item.id); close(); }
            catch (error) { this.message(error.message); confirm.disabled = false; }
        });
        cancel.focus();
    }

    insert(item) {
        const target = this.lastTarget;
        if (!target?.el.isConnected || target.el.disabled || target.el.readOnly) return this.message("请先聚焦一个节点的多行文本框。");
        // 文本在后台变化后不使用旧范围，避免覆盖非预期内容。
        if (target.value !== target.el.value) return this.message("文本框内容已经变化，请重新定位光标后插入。");
        target.el.focus();
        insertSnippet(target.el, item.content, target.start, target.end, settings.autoComma);
        this.lastTarget = { el: target.el, value: target.el.value, start: target.el.selectionStart, end: target.el.selectionEnd };
    }

    renderPanel(container) {
        const controller = new AbortController();
        const panel = element("section", "pat-snippet-panel");
        const search = element("input"); search.placeholder = "搜索名称、分类或内容"; search.setAttribute("aria-label", "搜索片段");
        const filter = element("select"); filter.setAttribute("aria-label", "分类筛选");
        const actions = element("div", "pat-snippet-actions");
        const list = element("div", "pat-snippet-list");
        const status = element("p", "pat-error"); status.setAttribute("role", "status");
        const button = (label, handler, parent = actions) => {
            const node = element("button", "", label); node.type = "button";
            listen(controller, node, "click", handler); parent.append(node); return node;
        };
        button("新建", () => this.openEditor());
        button("管理分类", () => this.openCategories());
        const file = element("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true;
        button("导入", () => file.click());
        listen(controller, file, "change", async () => {
            const selected = file.files?.[0]; if (!selected) return;
            try { await this.store.importData(JSON.parse(await selected.text())); status.textContent = "导入成功（同 id 以导入为准）"; }
            catch (error) { status.textContent = "导入失败：" + error.message; }
            finally { file.value = ""; }
        });
        button("导出", async () => {
            try {
                await this.store.load();
                const blob = new Blob([JSON.stringify(this.store.exportData(), null, 4)], { type: "application/json" });
                const url = URL.createObjectURL(blob), link = element("a");
                link.href = url; link.download = "prompt_atelier_snippets.json"; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) { status.textContent = error.message; }
        });
        panel.append(search, filter, actions, file, status, list); container.append(panel);
        let rowController;
        const render = () => {
            if (controller.signal.aborted) return;
            rowController?.abort(); rowController = new AbortController();
            const selected = filter.value;
            const all = element("option", "", "全部分类"); all.value = "";
            filter.replaceChildren(all, ...this.store.categories().map(value => { const option = element("option", "", value); option.value = value; return option; }));
            filter.value = this.store.categories().includes(selected) ? selected : "";
            list.replaceChildren();
            const items = this.store.search(search.value, Infinity, filter.value);
            if (!items.length) list.append(element("p", "pat-empty", this.store.snippets.length ? "没有匹配的片段。" : "片段库为空。输入 snip: 使用片段；选中文本后点击「＋ 保存为片段」或按 Ctrl+Shift+S 保存。"));
            for (const item of items) {
                const row = element("article", "pat-snippet-row"); row.dataset.id = item.id;
                row.append(element("strong", "", item.name), element("span", "pat-snippet-badge", item.category), element("p", "pat-snippet-preview", item.content.replace(/\s+/g, " ").slice(0, 160)));
                row.title = item.content;
                const controls = element("div", "pat-snippet-actions");
                for (const [label, handler] of [
                    ["编辑", () => this.openEditor(item)], ["删除", () => this.confirmDelete(item)],
                    ["插入到当前文本框", () => this.insert(item)],
                    ["复制内容", async () => { try { await navigator.clipboard.writeText(item.content); status.textContent = "已复制"; } catch (error) { status.textContent = "复制失败：" + error.message; } }],
                ]) {
                    const control = element("button", "", label);
                    listen(rowController, control, "click", handler); controls.append(control);
                }
                row.append(controls); list.append(row);
            }
        };
        listen(controller, search, "input", render); listen(controller, filter, "change", render);
        listen(controller, this.store, "change", () => { status.textContent = this.store.warning; render(); });
        listen(controller, this.store, "warning", event => { status.textContent = event.detail; });
        status.textContent = this.store.warning;
        render(); void this.store.load().then(render).catch(error => { status.textContent = error.message; });
        const cleanup = () => { controller.abort(); rowController?.abort(); panel.remove(); this.panels.delete(cleanup); };
        this.panels.add(cleanup); return cleanup;
    }

    openPanel() {
        if (this.controller.signal.aborted) return;
        const { controller, box, close } = this.modal("片段库");
        const button = element("button", "", "关闭"); box.append(button);
        listen(controller, button, "click", close);
        const cleanup = this.renderPanel(box);
        controller.signal.addEventListener("abort", cleanup, { once: true });
        button.focus();
    }

    destroy() {
        this.controller.abort();
        for (const close of [...this.dialogs]) close();
        for (const cleanup of [...this.panels]) cleanup();
        this.notice.remove(); this.lastTarget = null;
    }
}
