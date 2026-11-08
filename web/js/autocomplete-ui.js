/*
MIT License

Copyright (c) 2023 pythongosssss

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// caret 位置计算移植自 ComfyUI-Custom-Scripts（pythongosssss，MIT），
// 其中包含 textarea-caret-position（Jonathan Ong，MIT）；完整许可保留如下。
// 本项目适配横纵坐标缩放和文本区滚动。
// https://github.com/pythongosssss/ComfyUI-Custom-Scripts/blob/main/web/js/common/autocomplete.js
/*
    https://github.com/component/textarea-caret-position
    The MIT License (MIT)

    Copyright (c) 2015 Jonathan Ong me@jongleberry.com

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
function getCaretCoordinates(element, position, options) {
    
    
    
    
    var properties = [
        "direction", 
        "boxSizing",
        "width", 
        "height",
        "overflowX",
        "overflowY", 

        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "borderStyle",

        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",

        
        "fontStyle",
        "fontVariant",
        "fontWeight",
        "fontStretch",
        "fontSize",
        "fontSizeAdjust",
        "lineHeight",
        "fontFamily",

        "textAlign",
        "textTransform",
        "textIndent",
        "textDecoration", 

        "letterSpacing",
        "wordSpacing",

        "tabSize",
        "MozTabSize",
    ];

    var isBrowser = typeof window !== "undefined";
    var isFirefox = isBrowser && window.mozInnerScreenX != null;

    // 按需创建镜像元素，模块导入期间不访问 DOM。
    if (!isBrowser) {
        throw new Error("textarea-caret-position#getCaretCoordinates should only be called in a browser");
    }

    var debug = (options && options.debug) || false;
    if (debug) {
        var el = document.querySelector("#input-textarea-caret-position-mirror-div");
        if (el) el.parentNode.removeChild(el);
    }

    
    var div = document.createElement("div");
    div.id = "input-textarea-caret-position-mirror-div";
    document.body.appendChild(div);

    var style = div.style;
    var computed = window.getComputedStyle ? window.getComputedStyle(element) : element.currentStyle; 
    var isInput = element.nodeName === "INPUT";

    
    style.whiteSpace = "pre-wrap";
    if (!isInput) style.wordWrap = "break-word"; 

    
    style.position = "absolute"; 
    if (!debug) style.visibility = "hidden"; 

    
    properties.forEach(function (prop) {
        if (isInput && prop === "lineHeight") {
            
            if (computed.boxSizing === "border-box") {
                var height = parseInt(computed.height);
                var outerHeight =
                    parseInt(computed.paddingTop) +
                    parseInt(computed.paddingBottom) +
                    parseInt(computed.borderTopWidth) +
                    parseInt(computed.borderBottomWidth);
                var targetHeight = outerHeight + parseInt(computed.lineHeight);
                if (height > targetHeight) {
                    style.lineHeight = height - outerHeight + "px";
                } else if (height === targetHeight) {
                    style.lineHeight = computed.lineHeight;
                } else {
                    style.lineHeight = 0;
                }
            } else {
                style.lineHeight = computed.height;
            }
        } else {
            style[prop] = computed[prop];
        }
    });

    if (isFirefox) {
        
        if (element.scrollHeight > parseInt(computed.height)) style.overflowY = "scroll";
    } else {
        style.overflow = "hidden"; 
    }

    div.textContent = element.value.substring(0, position);
    
    
    if (isInput) div.textContent = div.textContent.replace(/\s/g, "\u00a0");

    var span = document.createElement("span");
    
    
    
    
    
    span.textContent = element.value.substring(position) || "."; 
    div.appendChild(span);

    var coordinates = {
        top: span.offsetTop + parseInt(computed["borderTopWidth"]),
        left: span.offsetLeft + parseInt(computed["borderLeftWidth"]),
        height: parseInt(computed["lineHeight"]),
    };

    if (debug) {
        span.style.backgroundColor = "#aaa";
    } else {
        document.body.removeChild(div);
    }

    return coordinates;
}

/*
    Key functions from:
    https://github.com/yuku/textcomplete
    © Yuku Takahashi - This software is licensed under the MIT license.

    The MIT License (MIT)

    Copyright (c) 2015 Jonathan Ong me@jongleberry.com

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const CHAR_CODE_ZERO = "0".charCodeAt(0);
const CHAR_CODE_NINE = "9".charCodeAt(0);

class TextAreaCaretHelper {
    constructor(el, getScale) {
        this.el = el;
        this.getScale = getScale;
    }

    #calculateElementOffset() {
        const rect = this.el.getBoundingClientRect();
        const owner = this.el.ownerDocument;
        if (owner == null) {
            throw new Error("Given element does not belong to document");
        }
        const { defaultView, documentElement } = owner;
        if (defaultView == null) {
            throw new Error("Given element does not belong to window");
        }
        const offset = {
            top: rect.top + defaultView.pageYOffset,
            left: rect.left + defaultView.pageXOffset,
        };
        if (documentElement) {
            offset.top -= documentElement.clientTop;
            offset.left -= documentElement.clientLeft;
        }
        return offset;
    }

    #isDigit(charCode) {
        return CHAR_CODE_ZERO <= charCode && charCode <= CHAR_CODE_NINE;
    }

    #getLineHeightPx() {
        const computedStyle = getComputedStyle(this.el);
        const lineHeight = computedStyle.lineHeight;
        
        
        
        
        if (this.#isDigit(lineHeight.charCodeAt(0))) {
            const floatLineHeight = parseFloat(lineHeight);
            
            
            return this.#isDigit(lineHeight.charCodeAt(lineHeight.length - 1))
                ? floatLineHeight * parseFloat(computedStyle.fontSize)
                : floatLineHeight;
        }
        
        
        return this.#calculateLineHeightPx(this.el.nodeName, computedStyle);
    }

    
    #calculateLineHeightPx(nodeName, computedStyle) {
        const body = document.body;
        if (!body) return 0;

        const tempNode = document.createElement(nodeName);
        tempNode.innerHTML = "&nbsp;";
        Object.assign(tempNode.style, {
            fontSize: computedStyle.fontSize,
            fontFamily: computedStyle.fontFamily,
            padding: "0",
            position: "absolute",
            visibility: "hidden",
            border: "0",
        });
        body.appendChild(tempNode);

        
        if (tempNode instanceof HTMLTextAreaElement) {
            tempNode.rows = 1;
        }

        
        const height = tempNode.offsetHeight;
        body.removeChild(tempNode);

        return height;
    }

    getCursorOffset() {
        const scale = this.getScale();
        const elOffset = this.#calculateElementOffset();
        const elScroll = this.#getElScroll();
        const cursorPosition = this.#getCursorPosition();
        const lineHeight = this.#getLineHeightPx();
        const top = elOffset.top - (elScroll.top * scale) + (cursorPosition.top + lineHeight) * scale;
        const left = elOffset.left + (cursorPosition.left - elScroll.left) * scale;
        const clientTop = this.el.getBoundingClientRect().top;
        if (this.el.dir !== "rtl") {
            return { top, left, lineHeight, clientTop };
        } else {
            const right = document.documentElement ? document.documentElement.clientWidth - left : 0;
            return { top, right, lineHeight, clientTop };
        }
    }

    #getElScroll() {
        return { top: this.el.scrollTop, left: this.el.scrollLeft };
    }

    #getCursorPosition() {
        return getCaretCoordinates(this.el, this.el.selectionEnd);
    }

    getBeforeCursor() {
        return this.el.selectionStart !== this.el.selectionEnd ? null : this.el.value.substring(0, this.el.selectionEnd);
    }

    getAfterCursor() {
        return this.el.value.substring(this.el.selectionEnd);
    }

}

import { app } from "../../../scripts/app.js";
import { TagDatabase } from "./tag-database.js";
import { settings } from "./settings.js";
import { insertSnippet } from "./snippet-store.js";

const CATEGORY_COLORS = { 0: "#3d8bcd", 1: "#e25d5d", 3: "#9b59b6", 4: "#27ae60", 5: "#e67e22" };


// 两侧扫描共用边界规则：奇数个反斜杠表示括号已转义。
function isDelimiter(text, index) {
    const ch = text[index];
    if (ch === "(" || ch === ")") {
        let slashes = 0;
        for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
        return slashes % 2 === 0;
    }
    return /[,\t\n\r:\[\]{}<>|]/.test(ch);
}

function tagSegment(text, end) {
    let start = end, replaceEnd = end;
    while (start > 0 && !isDelimiter(text, start - 1)) start--;
    while (replaceEnd < text.length && !isDelimiter(text, replaceEnd)) replaceEnd++;
    const raw = text.slice(start, end);
    start += raw.length - raw.trimStart().length;
    replaceEnd = end + text.slice(end, replaceEnd).trimEnd().length;
    return { start, replaceEnd, query: raw.trim().replace(/\\([()])/g, "$1") };
}

function modelSegment(text, end) {
    // 模型名允许空格、括号和路径；冒号留给 LoRA 权重。
    const match = /(?:^|[\s,()[\]{}<>|])(<lora:|lora:|embedding:)([^,\t\n\r:<>|]*)$/i.exec(text.slice(0, end));
    if (!match) return null;
    const prefix = match[1], kind = prefix.toLowerCase().includes("lora") ? "lora" : "embedding";
    let start = end - prefix.length - match[2].length;
    // 即使紧贴前文，也必须把已有的左尖括号纳入替换范围。
    if (kind === "lora" && text[start - 1] === "<" && prefix[0] !== "<") start--;
    let replaceEnd = end;
    let depth = 0;
    // 从前缀后扫描整个名称，以保留包裹该表达式的权重括号。
    let i = end - match[2].length;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (/[,\t\n\r:<>|\[\]{}]/.test(ch)) break;
        if (ch === "(") depth++;
        if (ch === ")") { if (!depth) break; depth--; }
    }
    replaceEnd = Math.max(end, i);
    if (kind === "lora") {
        // 已有权重及闭合符随整个 LoRA 表达式一起替换。
        const tail = text.slice(replaceEnd).match(/^(?::[^,\t\n\r<>()[\]{}|]*)?>/);
        if (tail) replaceEnd += tail[0].length;
    }
    return { kind, start, replaceEnd, query: match[2].trim() };
}

// 空格和中文属于查询；前缀必须处于开头、空白后或既有词段边界。
// 从光标向左按标签边界扫描，首个冒号必须属于 snip:；向右同样扫描。
// 因此不会跨逗号、换行、权重等分隔符，已转义括号仍可作为查询文本。
function snippetSegment(text, end) {
    let queryStart = end;
    while (queryStart > 0 && !isDelimiter(text, queryStart - 1)) queryStart--;
    const start = queryStart - 5;
    if (start < 0 || text.slice(start, queryStart).toLowerCase() !== "snip:") return null;
    if (start > 0 && !/\s/.test(text[start - 1]) && !isDelimiter(text, start - 1)) return null;
    let replaceEnd = end;
    while (replaceEnd < text.length && !isDelimiter(text, replaceEnd)) replaceEnd++;
    return { kind: "snippet", start, replaceEnd: end + text.slice(end, replaceEnd).trimEnd().length, query: text.slice(queryStart, end).trim() };
}

function modelEnabled(kind) {
    if (kind === "snippet") return settings.completeSnippets;
    return kind === "lora" ? settings.completeLoras : settings.completeEmbeddings;
}

function escapeParentheses(value) {
    return value.replace(/(\\*)([()])/g, (_, slashes, bracket) => slashes + (slashes.length % 2 ? "" : "\\") + bracket);
}

export class TagAutoComplete {
    constructor(el, db, opts = {}) {
        this.el = el;
        this.db = db;
        this.opts = opts;
        this.controller = new AbortController();
        this.generation = 0;
        this.destroyed = false;
        this.items = [];
        this.selected = 0;
        this.caret = new TextAreaCaretHelper(el, () => app.canvas?.ds?.scale || 1);
        this.dropdown = document.createElement("div");
        this.dropdown.className = "pat-dropdown";
        this.dropdown.setAttribute("role", "listbox");
        this.dropdown.hidden = true;
        document.body.appendChild(this.dropdown);
        this._setup();
        this.hideSelection = opts.library?.attach(el, this.caret, this.dropdown, this.controller);
        if (opts.snippets) opts.snippets.addEventListener("change", () => {
            if (document.activeElement === el) this._schedule();
        }, { signal: this.controller.signal });
        window.addEventListener("prompt-atelier:settings", () => this._hide(), { signal: this.controller.signal });
    }

    _setup() {
        const on = (target, event, handler, options = {}) => target.addEventListener(event, handler, { ...options, signal: this.controller.signal });
        on(this.el, "keydown", event => {
            if (event.isComposing || this.composing) return;
            if (!settings.enabled) { this._hide(); return; }
            if (this.dropdown.hidden) return;
            // 选区非空（如 Ctrl+A 后）说明候选已失效：关闭下拉并放行按键默认行为。
            if (this.el.selectionStart !== this.el.selectionEnd) { this._hide(); return; }
            if (!["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"].includes(event.key)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key === "Escape") this._hide();
            else if (event.key === "ArrowUp" || event.key === "ArrowDown") this._move(event.key === "ArrowUp" ? -1 : 1);
            else this._confirm(this.selected);
        });
        on(this.el, "keyup", event => {
            if (!this.dropdown.hidden && this.el.selectionStart !== this.el.selectionEnd) { this._hide(); return; }
            if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) this._schedule();
        });
        // 先关闭非空选区的候选，再由片段 UI 的同一事件监听器刷新保存按钮。
        // 折叠选区不处理，避免普通输入和光标移动打断补全或重新调度。
        on(document, "selectionchange", () => {
            if (document.activeElement === this.el && this.el.selectionStart !== this.el.selectionEnd) this._hide();
        });
        on(this.el, "input", () => { if (!this.confirming) this._schedule(); });
        on(this.el, "click", () => this._schedule());
        on(this.el, "blur", () => this._hide());
        on(this.el, "compositionstart", () => { this.composing = true; this._hide(); });
        on(this.el, "compositionend", () => { this.composing = false; this._schedule(); });
        on(this.el, "scroll", () => this._hide());
        on(window, "resize", () => this._hide());
        on(document, "wheel", event => { if (!this.dropdown.contains(event.target)) this._hide(); }, { capture: true, passive: true });
        on(this.dropdown, "pointerdown", event => {
            const item = event.target.closest(".pat-item");
            if (!item) return;
            event.preventDefault();
            this._confirm(Number(item.dataset.index));
        });
    }

    _schedule() {
        this._hide();
        if (this.destroyed || this.composing || !settings.enabled) return;
        const generation = this.generation;
        this.timer = setTimeout(() => this._update(generation), 40);
    }

    async _update(generation = this.generation) {
        if (this.destroyed || generation !== this.generation || !settings.enabled || document.activeElement !== this.el) return;
        if (this.el.selectionStart !== this.el.selectionEnd) return this._hide();
        const end = this.el.selectionStart;
        const segment = snippetSegment(this.el.value, end) || modelSegment(this.el.value, end) || tagSegment(this.el.value, end);
        const { start, replaceEnd, query, kind } = segment;
        const snapshot = { value: this.el.value, start, end, replaceEnd };
        let items;
        if (kind === "snippet") {
            if (!settings.completeSnippets || !this.opts.snippets) return this._hide();
            try { await this.opts.snippets.load(); } catch { return this._hide(); }
            if (!settings.completeSnippets) return this._hide();
            items = this.opts.snippets.search(query, settings.maxSuggestions);
        } else if (kind) {
            if (!modelEnabled(kind) || !this.opts.models) return this._hide();
            // 先显示缓存，刷新完成后仅更新仍停留在原处的候选。
            const refresh = this.opts.models.refresh(kind);
            items = this.opts.models.search(kind, query, settings.maxSuggestions);
            refresh.then(() => {
                if (!this._isCurrent(snapshot, generation) || !modelEnabled(kind)) return;
                this.items = this.opts.models.search(kind, query, settings.maxSuggestions);
                this.selected = 0;
                if (this.items.length) this._render();
                else this.dropdown.hidden = true;
            });
        } else {
            if (!query) return this._hide();
            const guides = ["snippet", "embedding", "lora"].filter(mode => modelEnabled(mode) && query.length >= 3 && (mode === "snippet" ? "snip" : mode).startsWith(query.toLowerCase()))
                .map(mode => ({ kind: mode, guide: true, name: mode === "lora" ? "<lora:" : mode === "snippet" ? "snip:" : "embedding:", matchPos: mode === "lora" ? 1 : 0, matchLength: query.length }));
            items = guides.concat(await this.db.search(query, settings.maxSuggestions)).slice(0, settings.maxSuggestions);
        }
        if (!this._isCurrent(snapshot, generation)) return;
        this.snapshot = snapshot;
        this.items = items;
        this.selected = 0;
        if (items.length) this._render();
        else {
            // 空缓存也保留本次请求的代次，让首次加载完成后能显示结果。
            this.dropdown.hidden = true;
        }
    }

    _isCurrent(snapshot, generation) {
        return !this.destroyed && generation === this.generation && settings.enabled && this.el.value === snapshot.value && this.el.selectionStart === snapshot.end && this.el.selectionEnd === snapshot.end && document.activeElement === this.el;
    }

    _render() {
        this.hideSelection?.();
        this.dropdown.replaceChildren();
        for (const [index, match] of this.items.entries()) {
            const row = document.createElement("div");
            row.className = "pat-item" + (match.kind ? " pat-item--" + match.kind : "");
            row.dataset.index = index;
            row.setAttribute("role", "option");
            const bar = document.createElement("span");
            bar.className = "pat-category-bar";
            if (!match.kind) bar.style.backgroundColor = CATEGORY_COLORS[this.db.categories[match.index]] || "#888";
            const label = document.createElement("span");
            label.className = "pat-tag-name";
            const text = match.kind ? match.name : match.alias < 0 ? this.db.names[match.index] : this.db.aliases[match.index][match.alias];
            const mark = document.createElement("mark");
            mark.className = "pat-highlight";
            mark.textContent = text.slice(match.matchPos, match.matchPos + match.matchLength);
            label.append(text.slice(0, match.matchPos), mark, text.slice(match.matchPos + match.matchLength));
            row.append(bar, label);
            if (!match.kind && match.alias >= 0) {
                const real = document.createElement("span");
                real.className = "pat-alias-target";
                real.textContent = "→ " + this.db.names[match.index];
                row.appendChild(real);
            }
            const count = document.createElement("span");
            count.className = match.kind ? "pat-count pat-model-badge" : "pat-count";
            count.textContent = match.kind ? (match.kind === "lora" ? "LoRA" : match.kind === "snippet" ? (match.category || "片段") : "EMB") : TagDatabase.formatCount(this.db.postCounts[match.index]);
            row.title = match.kind === "snippet" && !match.guide ? match.content.replace(/\s+/g, " ").slice(0, 240) : match.kind ? match.name : this.db.names[match.index];
            row.appendChild(count);
            this.dropdown.appendChild(row);
        }
        this.dropdown.hidden = false;
        const point = this.caret.getCursorOffset();
        const left = point.left ?? document.documentElement.clientWidth - point.right;
        this.dropdown.style.left = Math.max(window.scrollX + 4, Math.min(left, window.scrollX + window.innerWidth - this.dropdown.offsetWidth - 4)) + "px";
        this.dropdown.style.top = point.top + "px";
        const height = this.dropdown.offsetHeight;
        if (point.top + height > window.scrollY + window.innerHeight) {
            this.dropdown.style.top = Math.max(window.scrollY + 4, point.top - point.lineHeight * (app.canvas?.ds?.scale || 1) - height) + "px";
        }
        this._setSelected();
    }

    _confirm(index) {
        const item = this.items[index], snapshot = this.snapshot;
        if (this.destroyed || !settings.enabled || !item || !snapshot || this.el.value !== snapshot.value || this.el.selectionStart !== snapshot.end || this.el.selectionEnd !== snapshot.end) return this._hide();
        if (item.kind && !modelEnabled(item.kind)) return this._hide();
        if (item.kind === "snippet" && !item.guide) {
            this.confirming = true;
            try { insertSnippet(this.el, item.content, snapshot.start, snapshot.replaceEnd, settings.autoComma); }
            finally { this.confirming = false; this._hide(); }
            return;
        }
        let value = item.kind ? (item.guide ? item.name : item.kind === "lora" ? "<lora:" + item.name + ":1.0>" : "embedding:" + item.name) : this.db.names[item.index];
        if (!item.kind && settings.escapeParentheses) value = escapeParentheses(value);
        const after = this.el.value.slice(snapshot.replaceEnd);
        if (!item.guide && settings.autoComma && !/^\s*[,):\]}>|]/.test(after)) value += ", ";
        this.confirming = true;
        try {
            this.el.setRangeText(value, snapshot.start, snapshot.replaceEnd, "end");
            this.el.dispatchEvent(new Event("input", { bubbles: true }));
            this.el.dispatchEvent(new Event("change", { bubbles: true }));
        } finally { this.confirming = false; this._hide(); }
        if (item.guide) void this._update();
    }

    _hide() {
        clearTimeout(this.timer);
        this.generation++;
        this.dropdown.hidden = true;
        this.items = [];
    }

    _move(delta) {
        if (!this.items.length) return;
        this.selected = (this.selected + delta + this.items.length) % this.items.length;
        this._setSelected();
    }

    _setSelected() {
        Array.from(this.dropdown.children).forEach((row, index) => {
            row.classList.toggle("pat-item--selected", index === this.selected);
            row.setAttribute("aria-selected", String(index === this.selected));
        });
        const row = this.dropdown.children[this.selected];
        if (row) {
            if (row.offsetTop < this.dropdown.scrollTop) this.dropdown.scrollTop = row.offsetTop;
            else if (row.offsetTop + row.offsetHeight > this.dropdown.scrollTop + this.dropdown.clientHeight) this.dropdown.scrollTop = row.offsetTop + row.offsetHeight - this.dropdown.clientHeight;
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._hide();
        this.controller.abort();
        this.dropdown.remove();
    }
}
