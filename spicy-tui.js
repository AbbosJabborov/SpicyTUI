// @ts-nocheck
// SpicyTUI — terminal-style command line for Spotify, designed to sit on top of Spicy Lyrics.
// Install: copy to <spicetify config>/Extensions/, then
//   spicetify config extensions spicy-tui.js && spicetify apply
(function SpicyTUI() {
    "use strict";

    // ───────────────────────── pure logic (unit-tested in Node) ─────────────────────────

    const COMMANDS = [
        { name: "song", usage: "/song <name>", desc: "search and play a song" },
        { name: "artist", usage: "/artist <name> [song words] [-r]", desc: "play an artist, a specific song, or -r for a random song from \"This Is\"" },
        { name: "album", usage: "/album <name>", desc: "search and play an album" },
        { name: "playlist", usage: "/playlist <name> [-r]", desc: "play one of your playlists, -r for a random song from it" },
        { name: "help", usage: "/help", desc: "show this list" },
    ];

    const FLAG_RE = /(^|\s)(--random|-r)(?=\s|$)/gi;
    const PARTIAL_FLAG_RE = /(^|\s)--?[a-z]*$/i;

    // "/artist daft punk -r" -> { stage:"args", cmd:"artist", query:"daft punk", random:true, flagHint:false }
    function parseInput(raw) {
        const text = String(raw || "");
        if (!text.trim()) return { stage: "empty" };
        if (text[0] !== "/") return { stage: "args", cmd: "song", query: text.trim(), random: false, implicit: true };
        const m = text.match(/^\/(\S*)(\s+([\s\S]*))?$/);
        const cmd = (m[1] || "").toLowerCase();
        if (m[2] === undefined) return { stage: "command", partial: cmd };
        let rest = m[3] || "";
        const random = FLAG_RE.test(rest);
        FLAG_RE.lastIndex = 0;
        rest = rest.replace(FLAG_RE, " ");
        const takesFlags = cmd === "artist" || cmd === "playlist";
        const partialFlag = takesFlags && !random && PARTIAL_FLAG_RE.test(rest);
        if (partialFlag) rest = rest.replace(PARTIAL_FLAG_RE, " ");
        return { stage: "args", cmd, query: rest.replace(/\s+/g, " ").trim(), random, flagHint: partialFlag };
    }

    function matchCommands(partial) {
        const p = String(partial || "").toLowerCase();
        return COMMANDS.filter((c) => c.name.startsWith(p));
    }

    // every word of the query must appear in the name; prefix matches rank first
    function filterByWords(items, query, getName) {
        const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
        const scored = [];
        for (const item of items) {
            const name = String(getName(item) || "").toLowerCase();
            if (!words.every((w) => name.includes(w))) continue;
            const rank = words.length && name.startsWith(words[0]) ? 0 : 1;
            scored.push({ item, rank });
        }
        scored.sort((a, b) => a.rank - b.rank);
        return scored.map((s) => s.item);
    }

    // For /artist: artists whose name starts the query, plus tracks whose artist is named in the query.
    function rankArtistResults(query, artists, tracks) {
        const ql = String(query || "").toLowerCase().trim();
        if (!ql) return [];
        const artistHits = artists.filter((a) => {
            const n = a.name.toLowerCase();
            return n.startsWith(ql) || ql.startsWith(n);
        });
        const trackHits = tracks.filter((t) => (t.artists || []).some((a) => ql.includes(a.name.toLowerCase())));
        const longestArtist = artistHits.reduce((len, a) => Math.max(len, a.name.length), 0);
        const hasExtraWords = ql.length > longestArtist;
        const A = artistHits.map((a) => ({ kind: "artist", data: a }));
        const T = trackHits.map((t) => ({ kind: "track", data: t }));
        return hasExtraWords && T.length ? [...T, ...A] : [...A, ...T];
    }

    // pick Spotify's "This Is <artist>" playlist out of playlist search results
    function pickThisIs(artistName, playlists) {
        const want = `this is ${String(artistName).toLowerCase()}`;
        const spotifyOwned = (playlists || []).filter((p) => p && p.owner && p.owner.id === "spotify");
        return (
            spotifyOwned.find((p) => String(p.name).toLowerCase() === want) ||
            spotifyOwned.find((p) => String(p.name).toLowerCase().startsWith(want)) ||
            null
        );
    }

    // Flatten Spotify's GraphQL searchV2 payload into { tracks, artists, albums, playlists } (uri prefix decides the type).
    function normalizeSearchV2(searchV2) {
        const out = { tracks: [], artists: [], albums: [], playlists: [] };
        const seen = new Set();
        const artistsOf = (d) => (d.artists?.items || []).map((a) => ({ name: a.profile?.name || a.name })).filter((a) => a.name);
        Object.values(searchV2 || {}).forEach((section) => {
            const list = section?.itemsV2 || section?.items;
            if (!Array.isArray(list)) return;
            list.forEach((entry) => {
                const d = entry?.item?.data ?? entry?.data ?? entry;
                const uri = d?.uri;
                const name = d?.name || d?.profile?.name;
                if (typeof uri !== "string" || !name || seen.has(uri)) return;
                seen.add(uri);
                if (uri.startsWith("spotify:track:")) out.tracks.push({ name, uri, artists: artistsOf(d) });
                else if (uri.startsWith("spotify:artist:")) out.artists.push({ name, uri });
                else if (uri.startsWith("spotify:album:")) out.albums.push({ name, uri, artists: artistsOf(d), release_date: d.date?.year ? String(d.date.year) : "" });
                else if (uri.startsWith("spotify:playlist:")) {
                    const o = d.ownerV2?.data;
                    out.playlists.push({ name, uri, owner: { id: o?.username || String(o?.uri || "").split(":").pop() || "" } });
                }
            });
        });
        return out;
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { normalizeSearchV2, parseInput, matchCommands, filterByWords, rankArtistResults, pickThisIs, COMMANDS };
        return;
    }

    // ───────────────────────── Spotify runtime ─────────────────────────

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const MAX_ROWS = 8;

    async function waitForSpicetify() {
        while (!(window.Spicetify && Spicetify.Player && Spicetify.Platform && Spicetify.CosmosAsync && Spicetify.Platform.PlaylistAPI && Spicetify.Platform.RootlistAPI)) {
            await sleep(300);
        }
    }

    const searchCache = new Map();
    const isEmpty = (r) => !(r.tracks.length || r.artists.length || r.albums.length || r.playlists.length);

    async function searchViaGraphQL(q) {
        const defs = Spicetify.GraphQL?.Definitions ?? {};
        const attempts = [];
        if (defs.searchModalResults) {
            attempts.push([defs.searchModalResults, { searchTerm: q, offset: 0, limit: 20, numberOfTopResults: 20, includeAudiobooks: true, includeAuthors: true, includePreRelease: true, includeArtistHasConcertsField: false }]);
        }
        if (defs.searchSuggestions) {
            attempts.push([defs.searchSuggestions, { query: q, offset: 0, limit: 20, numberOfTopResults: 20, includeAuthors: true, includeAlbumPreReleases: true, includeEpisodeContentRatingsV2: true }]);
        }
        for (const [def, vars] of attempts) {
            try {
                const res = await Spicetify.GraphQL.Request(def, vars);
                const out = normalizeSearchV2(res?.data?.searchV2);
                if (!isEmpty(out)) return out;
            } catch (e) { /* try next */ }
        }
        return null;
    }

    async function searchViaWebApi(q) {
        const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=10`;
        const res = await Spicetify.CosmosAsync.get(url);
        return {
            tracks: (res.tracks?.items || []).filter(Boolean),
            artists: (res.artists?.items || []).filter(Boolean),
            albums: (res.albums?.items || []).filter(Boolean),
            playlists: (res.playlists?.items || []).filter(Boolean),
        };
    }

    // one cached search returns every type; callers pick the lists they need
    async function searchAll(q) {
        const key = q.toLowerCase();
        if (searchCache.has(key)) return searchCache.get(key);
        let out = await searchViaGraphQL(q);
        if (!out) out = await searchViaWebApi(q);
        searchCache.set(key, out);
        if (searchCache.size > 60) searchCache.delete(searchCache.keys().next().value);
        return out;
    }

    let playlistCache = null;
    async function getMyPlaylists(force) {
        if (playlistCache && !force) return playlistCache;
        const root = await Spicetify.Platform.RootlistAPI.getContents();
        const out = [];
        (function walk(items) {
            for (const it of items || []) {
                if (it.type === "playlist") out.push({ name: it.name, uri: it.uri });
                else if (it.type === "folder") walk(it.items);
            }
        })(root.items);
        playlistCache = out;
        return out;
    }

    async function playRandomFromPlaylist(uri) {
        const res = await Spicetify.Platform.PlaylistAPI.getContents(uri);
        const tracks = (res.items || []).filter((i) => i && i.uri && i.isPlayable !== false);
        if (!tracks.length) throw new Error("playlist is empty");
        const pick = tracks[Math.floor(Math.random() * tracks.length)];
        Spicetify.Player.playUri(uri, {}, { skipTo: { uri: pick.uri } });
        return pick.name || pick.uri;
    }

    async function playArtistRandom(artist) {
        const res = await searchAll(`This Is ${artist.name}`);
        const pl = pickThisIs(artist.name, res.playlists);
        if (!pl) {
            Spicetify.Player.playUri(artist.uri);
            return `no "This Is ${artist.name}" playlist found, playing artist`;
        }
        const name = await playRandomFromPlaylist(pl.uri);
        return `random: ${name}`;
    }

    const trackLabel = (t) => ({ label: t.name, sub: (t.artists || []).map((a) => a.name).join(", ") });
    const playUri = (uri) => Spicetify.Player.playUri(uri);

    // Build suggestion rows for a parsed input. Each row: { key, label, sub, fill, run(parsedAtExecution) }.
    async function suggest(p) {
        if (p.stage === "empty") return [];
        if (p.stage === "command") {
            return matchCommands(p.partial).map((c) => ({ key: "cmd:" + c.name, label: c.usage, sub: c.desc, complete: `/${c.name} ` }));
        }
        if (p.cmd === "help") return [];
        const q = p.query;
        const hint = p.flagHint
            ? [{ key: "hint", label: "-r, --random", sub: "play a random song", isHint: true }]
            : [];
        if (p.cmd === "playlist") {
            const mine = filterByWords(await getMyPlaylists(), q, (x) => x.name).slice(0, MAX_ROWS);
            return [...hint, ...mine.map((pl) => ({
                key: pl.uri,
                label: pl.name,
                fill: pl.name,
                sub: p.random ? "▶ random song" : "playlist",
                run: async (now) => {
                    if (now.random) return `random: ${await playRandomFromPlaylist(pl.uri)}`;
                    playUri(pl.uri);
                    return `playing ${pl.name}`;
                },
            }))];
        }
        if (!q) return hint;
        if (p.cmd === "song") {
            const r = await searchAll(q);
            return r.tracks.slice(0, MAX_ROWS).map((t) => ({
                key: t.uri, ...trackLabel(t), fill: t.name,
                run: async () => { playUri(t.uri); return `playing ${t.name}`; },
            }));
        }
        if (p.cmd === "album") {
            const r = await searchAll(q);
            return r.albums.slice(0, MAX_ROWS).map((a) => ({
                key: a.uri,
                label: a.name,
                sub: (a.artists || []).map((x) => x.name).join(", ") + (a.release_date ? ` · ${a.release_date.slice(0, 4)}` : ""),
                fill: a.name,
                run: async () => { playUri(a.uri); return `playing ${a.name}`; },
            }));
        }
        if (p.cmd === "artist") {
            const r = await searchAll(q);
            const rows = rankArtistResults(q, r.artists, r.tracks).slice(0, MAX_ROWS);
            return [...hint, ...rows.map((row) => {
                if (row.kind === "artist") {
                    return {
                        key: row.data.uri,
                        label: row.data.name,
                        sub: p.random ? "▶ random song" : "artist",
                        fill: row.data.name,
                        run: async (now) => {
                            if (now.random) return await playArtistRandom(row.data);
                            playUri(row.data.uri);
                            return `playing ${row.data.name}`;
                        },
                    };
                }
                const t = row.data;
                return {
                    key: t.uri, ...trackLabel(t),
                    fill: `${(t.artists || [])[0]?.name || ""} ${t.name}`.trim(),
                    run: async () => { playUri(t.uri); return `playing ${t.name}`; },
                };
            })];
        }
        return [];
    }

    // ───────────────────────── UI ─────────────────────────

    const CSS = `
#stui-root{position:fixed;left:var(--stui-left,8.75vw);bottom:calc(var(--stui-bar,0px) + var(--stui-base,9vh));z-index:99999;
  width:var(--stui-width,max(380px,33vw));max-width:calc(100vw - var(--stui-left,8.75vw) - 20px);
  font:14px/1.4 "JetBrains Mono","Fira Code",ui-monospace,monospace;color:#fff;pointer-events:none}
#stui-root>*{pointer-events:auto}
#stui-list{margin:0 0 8px;padding:4px 0;border-radius:8px;background:rgba(255,255,255,.10);
  backdrop-filter:blur(18px) saturate(1.15);-webkit-backdrop-filter:blur(18px) saturate(1.15);max-height:50vh;overflow:hidden}
#stui-list:empty{display:none}
.stui-row{display:flex;gap:12px;justify-content:space-between;padding:4px 12px;white-space:nowrap;cursor:pointer;color:#fff}
.stui-row .l{overflow:hidden;text-overflow:ellipsis}
.stui-row .s{color:rgba(255,255,255,.62);overflow:hidden;text-overflow:ellipsis;flex:0 1 45%;text-align:right}
.stui-row.sel{background:rgba(255,255,255,.22)}
.stui-row.hint .l{color:rgba(255,255,255,.7);font-style:italic}
#stui-status{padding:0 2px 4px;font-size:12px;color:rgba(255,255,255,.8);text-shadow:0 1px 6px rgba(0,0,0,.45)}
#stui-bar{display:flex;align-items:center;gap:8px;text-shadow:0 1px 8px rgba(0,0,0,.45)}
#stui-prompt{color:rgba(255,255,255,.75);user-select:none}
#stui-input{flex:1;background:transparent;border:0;outline:0;color:#fff;font:inherit;caret-color:#fff;padding:2px 0;min-width:0}
#stui-input::placeholder{color:rgba(255,255,255,.4)}

/* ── Spicy Lyrics layout: title above the poster, poster lifted ── */
body{--stui-lift:40px;--stui-meta-h:78px;--stui-meta-gap:16px}
#SpicyLyricsPage:not(.CompactMode):not(.ForcedCompactMode) .ContentBox .NowBar:has(> .CenteredView > .Header),
#SpicyLyricsPage:not(.CompactMode):not(.ForcedCompactMode) .ContentBox .NowBar:has(> .Header){
  padding-top:calc(50cqh - var(--NowBarWidth)*0.625 - var(--stui-meta-h) - var(--stui-meta-gap) - var(--stui-lift)) !important}
#SpicyLyricsPage:not(.CompactMode):not(.ForcedCompactMode) .ContentBox .NowBar .Header{display:flex !important;flex-direction:column}
#SpicyLyricsPage:not(.CompactMode):not(.ForcedCompactMode) .ContentBox .NowBar .Header > .Metadata{
  order:-1 !important;margin:0 0 var(--stui-meta-gap) !important;min-height:var(--stui-meta-h);
  display:flex;flex-direction:column;justify-content:flex-end;text-align:center;
  opacity:0;transform:translateY(-14px);transition:opacity .25s ease,transform .25s ease}
/* title slides in only while the cursor is over the poster or the title strip */
#SpicyLyricsPage:not(.CompactMode):not(.ForcedCompactMode) .ContentBox .NowBar .Header:has(> .MediaBox:hover) > .Metadata,
#SpicyLyricsPage:not(.CompactMode):not(.ForcedCompactMode) .ContentBox .NowBar .Header > .Metadata:hover{opacity:1;transform:none}

/* poster buttons and dimming only while the cursor is on the poster itself */
#SpicyLyricsPage .ContentBox .NowBar .Header .MediaBox:not(:hover){--ControlsOpacity:0 !important;--ArtworkBrightness:1 !important}
`;

    function el(tag, props = {}, ...kids) {
        const n = document.createElement(tag);
        Object.assign(n, props);
        kids.forEach((k) => n.append(k));
        return n;
    }

    async function main() {
        await waitForSpicetify();

        document.head.append(el("style", { id: "stui-style", textContent: CSS }));

        const list = el("div", { id: "stui-list" });
        const status = el("div", { id: "stui-status" });
        const input = el("input", { id: "stui-input", type: "text", spellcheck: false, autocomplete: "off", placeholder: "/ for commands" });
        const root = el("div", { id: "stui-root" }, list, status, el("div", { id: "stui-bar" }, el("span", { id: "stui-prompt", textContent: ">" }), input));
        document.body.append(root);

        let rows = [];
        let sel = -1;
        let navigated = false;   // true once the user moved the highlight with the arrow keys
        let chosen = null;       // row completed into the input via Tab/Enter, waiting for Enter to play it
        let token = 0;
        let statusTimer = 0;
        let debounce = 0;

        const placeAboveNowPlayingBar = () => {
            const bar = document.querySelector(".Root__now-playing-bar");
            const h = bar && bar.offsetParent ? bar.getBoundingClientRect().height : 0;
            root.style.setProperty("--stui-bar", h > 0 ? h + "px" : "0px");
        };
        placeAboveNowPlayingBar();
        window.addEventListener("resize", placeAboveNowPlayingBar);
        new MutationObserver(placeAboveNowPlayingBar).observe(document.body, { attributes: true, attributeFilter: ["class"] });

        const say = (msg, ms = 3500) => {
            status.textContent = msg || "";
            clearTimeout(statusTimer);
            if (msg) statusTimer = setTimeout(() => (status.textContent = ""), ms);
        };

        function render() {
            list.textContent = "";
            rows.forEach((r, i) => {
                const row = el("div", { className: "stui-row" + (i === sel ? " sel" : "") + (r.isHint ? " hint" : "") },
                    el("span", { className: "l", textContent: r.label }), el("span", { className: "s", textContent: r.sub || "" }));
                row.addEventListener("mousedown", (e) => { e.preventDefault(); r.complete ? complete(r) : execute(r); });
                list.append(row);
            });
            const s = list.querySelector(".sel");
            if (s) s.scrollIntoView({ block: "nearest" });
        }

        function chosenValid() {
            if (!chosen) return false;
            const a = parseInput(input.value), b = parseInput(chosen.value);
            return a.stage === "args" && a.cmd === b.cmd && a.query === b.query;
        }

        async function refresh() {
            const my = ++token;
            const p = parseInput(input.value);
            let next = [];
            try { next = await suggest(p); } catch (e) { if (my === token) say("search failed: " + (e.message || e)); }
            if (my !== token) return;
            rows = next;
            navigated = false;
            sel = chosenValid() ? rows.findIndex((r) => r.key === chosen.key) : -1;
            render();
            if (p.stage === "args" && p.cmd === "help") showHelp();
            else if (!rows.length && p.stage === "args" && p.query) say("no matches", 1500);
        }

        function showHelp() {
            rows = COMMANDS.map((c) => ({ key: "help:" + c.name, label: c.usage, sub: c.desc, complete: `/${c.name} ` }));
            rows.push({ label: "Tab", sub: "complete the highlighted (or first) match", isHint: true });
            rows.push({ label: "Enter", sub: "play it; add -r before Enter for random", isHint: true });
            rows.push({ label: "↑ ↓", sub: "move through matches", isHint: true });
            rows.push({ label: "/ or Esc", sub: "focus / leave the input", isHint: true });
            sel = -1;
            render();
        }

        // put a row's text into the input (never plays)
        function complete(row) {
            if (!row) return;
            if (row.complete) {
                input.value = row.complete;
                chosen = null;
            } else {
                const p = parseInput(input.value);
                const cmd = p.stage === "args" ? p.cmd : "song";
                input.value = `/${cmd} ${row.fill}${p.random ? " -r" : ""} `;
                chosen = { value: input.value, key: row.key, row };
            }
            input.focus();
            refresh();
        }

        async function execute(row) {
            if (!row || row.isHint || !row.run) return;
            try {
                const msg = await row.run(parseInput(input.value));
                if (msg) say(msg);
                input.value = "";
                chosen = null; rows = []; sel = -1; render();
            } catch (e) {
                say("error: " + (e.message || e));
            }
        }

        const firstPlayable = () => rows.find((r) => !r.isHint && (r.run || r.complete));

        input.addEventListener("input", () => {
            if (!chosenValid()) chosen = null;
            clearTimeout(debounce);
            debounce = setTimeout(refresh, 120);
        });

        input.addEventListener("keydown", (e) => {
            e.stopPropagation(); // keep Spotify's own hotkeys out of our input
            const p = parseInput(input.value);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!rows.length) return;
                e.preventDefault();
                const dir = e.key === "ArrowDown" ? 1 : -1;
                let i = sel;
                do { i = i + dir; if (i >= rows.length) i = -1; if (i < -1) i = rows.length - 1; } while (i >= 0 && rows[i].isHint);
                sel = i;
                navigated = i >= 0;
                render();
            } else if (e.key === "Tab") {
                e.preventDefault();
                if (p.flagHint) { input.value = input.value.replace(PARTIAL_FLAG_RE, "$1-r "); refresh(); return; }
                if (chosenValid()) return; // already completed; type -r or press Enter
                const row = sel >= 0 ? rows[sel] : firstPlayable();
                if (row && !row.isHint) complete(row);
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (p.stage === "command" && p.partial === "help") { showHelp(); return; }
                if (p.stage === "command") { complete(sel >= 0 ? rows[sel] : rows[0]); return; }
                if (chosenValid()) { execute(chosen.row); return; }
                if (navigated && sel >= 0 && rows[sel] && !rows[sel].isHint) { complete(rows[sel]); return; }
                const row = firstPlayable();
                if (row) execute(row);
            } else if (e.key === "Escape") {
                input.value = ""; chosen = null; rows = []; sel = -1; render(); input.blur();
            }
        });
        input.addEventListener("keyup", (e) => e.stopPropagation());
        input.addEventListener("keypress", (e) => e.stopPropagation());
        input.addEventListener("focus", placeAboveNowPlayingBar);

        // "/" anywhere focuses the terminal (unless you're typing in another field)
        document.addEventListener("keydown", (e) => {
            if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            e.preventDefault();
            e.stopPropagation();
            input.focus();
            if (!input.value) { input.value = "/"; refresh(); }
        }, true);
    }

    main();
})();
