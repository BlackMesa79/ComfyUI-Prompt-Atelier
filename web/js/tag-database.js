/** 按引号状态解析 CSV，支持转义双引号、字段内换行及末尾无换行。 */
export function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') { field += '"'; i++; }
            else if (quoted || field === "") quoted = !quoted;
            else field += ch;
        } else if (!quoted && ch === ",") {
            row.push(field); field = "";
        } else if (!quoted && (ch === "\n" || ch === "\r")) {
            row.push(field);
            if (row.some(value => value !== "")) rows.push(row);
            row = []; field = "";
            if (ch === "\r" && text[i + 1] === "\n") i++;
        } else field += ch;
    }
    if (quoted) throw new Error("CSV 引号未闭合");
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

export class TagDatabase {
    constructor() {
        this.names = []; this.lowerNames = [];
        this.categories = []; this.postCounts = [];
        this.aliases = []; this.lowerAliases = [];
        this.order = []; this.loaded = false; this.generation = 0;
    }

    static normalize(value) { return value.toLowerCase().replace(/_/g, " "); }

    async load(url) {
        const generation = ++this.generation;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("标签库加载失败：HTTP " + response.status);
        const text = await response.text();
        if (generation !== this.generation) return;
        this._parse(text);
    }

    _parse(text) {
        const names = [], lowerNames = [], categories = [], postCounts = [];
        const aliases = [], lowerAliases = [];
        for (const row of parseCSV(text)) {
            if (row.length < 3 || !row[0] || !/^\d+$/.test(row[1]) || !/^\d+$/.test(row[2])) continue;
            names.push(row[0]); lowerNames.push(TagDatabase.normalize(row[0]));
            categories.push(Number(row[1])); postCounts.push(Number(row[2]));
            const values = (row[3] || "").split(",").map(value => value.trim()).filter(Boolean);
            aliases.push(values); lowerAliases.push(values.map(TagDatabase.normalize));
        }
        if (!names.length) throw new Error("标签库没有有效记录");
        this.names = names; this.lowerNames = lowerNames;
        this.categories = categories; this.postCounts = postCounts;
        this.aliases = aliases; this.lowerAliases = lowerAliases;
        // 仅加载时排序，查询按热度遍历，前缀候选达到上限即可停止。
        this.order = Array.from(names.keys()).sort((a, b) => postCounts[b] - postCounts[a]);
        this.loaded = true;
    }

    search(query, max = 20) {
        if (typeof query !== "string") return [];
        const q = TagDatabase.normalize(query);
        if (!q || !this.loaded) return [];
        const numericMax = Number(max);
        max = Number.isFinite(numericMax) ? Math.max(1, Math.min(100, Math.trunc(numericMax))) : 20;
        const prefix = [], substring = [];
        for (const index of this.order) {
            let pos = this.lowerNames[index].indexOf(q), alias = -1;
            const values = this.lowerAliases[index];
            for (let j = 0; j < values.length && pos !== 0; j++) {
                const found = values[j].indexOf(q);
                if (found >= 0 && (pos < 0 || found === 0)) { pos = found; alias = j; }
            }
            if (pos < 0) continue;
            const target = pos === 0 ? prefix : substring;
            if (target.length < max) target.push({ index, alias, matchPos: pos, matchLength: q.length });
            if (prefix.length === max) break;
        }
        return prefix.concat(substring).slice(0, max);
    }

    static formatCount(n) {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
        if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
        return String(n);
    }
}
