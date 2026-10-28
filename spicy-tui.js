// @ts-nocheck
// SpicyTUI — terminal-style command line for Spotify, designed to sit on top of Spicy Lyrics.
// Install: copy to <spicetify config>/Extensions/, then
//   spicetify config extensions spicy-tui.js && spicetify apply
(function SpicyTUI() {
    "use strict";

    // ───────────────────────── pure logic (unit-tested in Node) ─────────────────────────

    // kind "simple" = the bare command does something on Enter; "args" = needs an argument first
    const C = (name, kind, usage, desc, examples = []) => ({ name, kind, usage, desc, examples });
    const COMMANDS = [
        C("song", "args", "/song <name>", "search and play a song", ["/song be my baby"]),
        C("artist", "args", "/artist <name> [song words] [-r]", "play an artist or one of their songs; -r = random from \"This Is\"", ["/artist radiohead", "/artist radiohead creep", "/artist radiohead -r"]),
        C("album", "args", "/album <name>", "search and play an album", ["/album ok computer"]),
        C("playlist", "args", "/playlist <name> [-r]", "play one of your playlists; -r = random song from it", ["/playlist chill", "/playlist chill -r"]),
        C("liked", "simple", "/liked [-r]", "play Liked Songs; -r = random song", ["/liked -r"]),
        C("recent", "args", "/recent [filter]", "pick from recently played songs"),
        C("lucky", "simple", "/lucky", "random song from a random playlist of yours"),
        C("radio", "simple", "/radio", "start a radio from the current song"),
        C("next", "simple", "/next  (/n)", "skip to the next song"),
        C("prev", "simple", "/prev  (/p)", "previous song"),
        C("pause", "simple", "/pause", "pause playback"),
        C("play", "simple", "/play", "resume playback"),
        C("toggle", "simple", "/toggle", "play / pause"),
        C("restart", "simple", "/restart", "jump to the start of the song"),
        C("seek", "args", "/seek <time>", "jump to a time or skip by seconds", ["/seek 1:30", "/seek +10", "/seek -10"]),
        C("vol", "args", "/vol <0-100>  (/volume)", "set or change the volume", ["/vol 40", "/vol +5", "/vol -5"]),
        C("shuffle", "simple", "/shuffle [on|off]", "toggle shuffle, or set it"),
        C("repeat", "simple", "/repeat [off|all|one]", "cycle repeat, or set it"),
        C("queue", "args", "/queue <song>", "add a song to the end of the queue; /queue clear empties it", ["/queue creep", "/queue clear"]),
        C("playnext", "args", "/playnext <song>", "make a song play right after the current one", ["/playnext creep"]),
        C("like", "simple", "/like", "like the current song"),
        C("unlike", "simple", "/unlike", "remove the current song from Liked Songs"),
        C("add", "args", "/add <playlist>", "add the current song to one of your playlists", ["/add chill"]),
        C("now", "simple", "/now", "show the current song"),
        C("goto", "args", "/goto <artist|album>", "open the current song's artist or album page", ["/goto artist"]),
        C("copy", "simple", "/copy", "copy the current song's link"),
        C("lyrics", "simple", "/lyrics", "open or close the Spicy Lyrics page"),
        C("fullscreen", "simple", "/fullscreen", "toggle Spicy Lyrics fullscreen (shortcut: Ctrl/Cmd + F)"),
        C("romanize", "simple", "/romanize", "toggle romanized lyrics (Spicy page must be open)"),
        C("sleep", "args", "/sleep <minutes|off>", "pause playback after a delay", ["/sleep 30", "/sleep off"]),
        C("clear", "simple", "/clear", "clear the input and messages"),
        C("help", "simple", "/help [command]", "list commands, or details for one; /help keys for shortcuts", ["/help seek"]),
    ];
    const ALIASES = { n: "next", p: "prev", volume: "vol" };
    const COMMAND_NAMES = new Set(COMMANDS.map((c) => c.name));
    const FLAG_CMDS = new Set(["artist", "playlist", "liked"]);

    const FLAG_RE = /(^|\s)(--random|-r)(?=\s|$)/gi;
    const PARTIAL_FLAG_RE = /(^|\s)--?[a-z]*$/i;

    function findCommand(name) {
        const n = String(name || "").toLowerCase();
        const canon = ALIASES[n] || n;
        return COMMANDS.find((c) => c.name === canon) || null;
    }

    // "/artist daft punk -r" -> { stage:"args", cmd:"artist", query:"daft punk", random:true, flagHint:false }
    function parseInput(raw) {
        const text = String(raw || "");
        if (!text.trim()) return { stage: "empty" };
        if (text[0] !== "/") return { stage: "args", cmd: "song", query: text.trim(), random: false, implicit: true };
        const m = text.match(/^\/(\S*)(\s+([\s\S]*))?$/);
        const typed = (m[1] || "").toLowerCase();
        if (m[2] === undefined) return { stage: "command", partial: typed };
        const cmd = ALIASES[typed] || typed;
        let rest = m[3] || "";
        const random = FLAG_RE.test(rest);
        FLAG_RE.lastIndex = 0;
        rest = rest.replace(FLAG_RE, " ");
        const takesFlags = FLAG_CMDS.has(cmd);
        const partialFlag = takesFlags && !random && PARTIAL_FLAG_RE.test(rest);
        if (partialFlag) rest = rest.replace(PARTIAL_FLAG_RE, " ");
        return { stage: "args", cmd, query: rest.replace(/\s+/g, " ").trim(), random, flagHint: partialFlag };
    }

    // commands starting with what was typed; an exact name or alias (/n, /p) goes first
    function matchCommands(partial) {
        const p = String(partial || "").toLowerCase();
        const list = COMMANDS.filter((c) => c.name.startsWith(p));
        const exact = p ? findCommand(p) : null;
        return exact ? [exact, ...list.filter((c) => c !== exact)] : list;
    }

    function parseTime(s) {
        if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return null;
        let sec = 0;
        for (const n of s.split(":").map(Number)) sec = sec * 60 + n;
        return sec * 1000;
    }
    // "1:30" -> {abs 90000}; "+10" -> {rel 10000}; "-10" -> {rel -10000}
    function parseSeek(arg) {
        const s = String(arg || "").trim();
        if (!s) return null;
        const m = s.match(/^([+-])\s*(.+)$/);
        if (m) {
            const ms = parseTime(m[2]);
            return ms == null ? null : { mode: "rel", ms: m[1] === "-" ? -ms : ms };
        }
        const ms = parseTime(s);
        return ms == null ? null : { mode: "abs", ms };
    }
    function parseVolume(arg, current) {
        const m = String(arg || "").trim().match(/^([+-])?\s*(\d{1,3})%?$/);
        if (!m) return null;
        const n = Number(m[2]);
        const v = m[1] === "+" ? current + n : m[1] === "-" ? current - n : n;
        return Math.max(0, Math.min(100, v));
    }
    function parseOnOff(arg, current) {
        const a = String(arg || "").trim().toLowerCase();
        if (!a) return !current;
        if (a === "on" || a === "true") return true;
        if (a === "off" || a === "false") return false;
        return null;
    }
    // returns 0 (off) | 1 (all) | 2 (one) | null
    function parseRepeat(arg, current) {
        const a = String(arg || "").trim().toLowerCase();
        if (!a) return (current + 1) % 3;
        const map = { off: 0, all: 1, context: 1, playlist: 1, one: 2, track: 2, song: 2 };
        return a in map ? map[a] : null;
    }
    function parseSleep(arg) {
        const a = String(arg || "").trim().toLowerCase();
        if (a === "off" || a === "cancel" || a === "stop") return { off: true };
        if (/^\d+(\.\d+)?$/.test(a) && Number(a) > 0) return { minutes: Number(a) };
        return null;
    }
    function formatTime(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
        return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(r).padStart(2, "0");
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
        module.exports = { normalizeSearchV2, parseInput, matchCommands, findCommand, filterByWords, rankArtistResults, pickThisIs,
            parseSeek, parseVolume, parseOnOff, parseRepeat, parseSleep, formatTime, COMMANDS, ALIASES };
        return;
    }

    // ───────────────────────── Spotify runtime ─────────────────────────

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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


    // ── helpers for the extra commands ──
    const cur = () => Spicetify.Player?.data?.item || Spicetify.Player?.data?.track || null;
    const curName = (it) => it?.name || it?.metadata?.title || "";
    const curArtists = (it) => (it?.artists || []).map((a) => a.name).join(", ") || it?.metadata?.artist_name || "";
    const idOf = (uri) => String(uri || "").split(":").pop();
    const needTrack = () => {
        const it = cur();
        if (!it?.uri) throw new Error("nothing is playing");
        return it;
    };

    function getLikedSongsUri() {
        try {
            const internal = Spicetify.Platform?.LibraryAPI?._likedSongsUri;
            if (internal) return internal;
            const user = Spicetify.Platform?.LocalStorageAPI?.namespace;
            return user ? `spotify:user:${user}:collection` : "";
        } catch (e) { return ""; }
    }

    let notify = () => {};   // set to the status-line writer once the UI exists

    // songs played while the extension was running; used when Spotify's recently-played request fails
    let localRecent = [];
    try { localRecent = JSON.parse(localStorage.getItem("spicytui:recent") || "[]"); } catch (e) { localRecent = []; }
    function trackSongChange() {
        const it = cur();
        if (!it?.uri || !String(it.uri).startsWith("spotify:track:")) return;
        const entry = { name: curName(it), uri: it.uri, artists: (it.artists || []).map((a) => ({ name: a.name })) };
        localRecent = [entry, ...localRecent.filter((t) => t.uri !== entry.uri)].slice(0, 30);
        try { localStorage.setItem("spicytui:recent", JSON.stringify(localRecent)); } catch (e) { /* storage may be unavailable */ }
    }

    let recentCache = { t: 0, items: [] };
    async function getRecent() {
        if (Date.now() - recentCache.t < 30000 && recentCache.items.length) return recentCache.items;
        try {
            const res = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me/player/recently-played?limit=30");
            const seen = new Set();
            const items = (res.items || []).map((i) => i.track).filter((t) => t && t.uri && !seen.has(t.uri) && seen.add(t.uri))
                .map((t) => ({ name: t.name, uri: t.uri, artists: t.artists || [] }));
            if (items.length) { recentCache = { t: Date.now(), items }; return items; }
        } catch (e) { /* fall back to the local list */ }
        return localRecent;
    }

    // add to the end of the queue, or in front of whatever you queued before
    async function queueTrack(uri, playNext) {
        let queued = [];
        if (playNext) {
            try {
                queued = (Spicetify.Queue?.nextTracks || [])
                    .filter((t) => t?.contextTrack?.metadata?.is_queued === "true" || t?.provider === "queue")
                    .map((t) => ({ uri: t.contextTrack?.uri || t.uri })).filter((t) => t.uri);
            } catch (e) { queued = []; }
        }
        if (playNext && queued.length) {
            await Spicetify.Platform.PlayerAPI.clearQueue();
            await Spicetify.addToQueue([{ uri }, ...queued]);
        } else {
            await Spicetify.addToQueue([{ uri }]);
        }
    }

    // the expand-arrows button Spicy Lyrics adds to the playbar
    // Enter: click the playbar button. Exit: click the page's own X (Close) so Spicy runs its exit animation and navigation.
    function toggleSpicyFullscreen() {
        const page = document.getElementById("SpicyLyricsPage");
        if (page && page.classList.contains("Fullscreen")) {
            const close = page.querySelector("#Close");
            if (close) { close.click(); return; }
            if (document.fullscreenElement) { document.exitFullscreen(); return; }
        }
        const b = document.getElementById("SpicyLyrics_FullscreenButton");
        if (!b) throw new Error("Spicy Lyrics fullscreen button not found");
        b.click();
    }

    let sleepTimer = 0, sleepAt = 0;

    // Commands that run straight from the typed text. Each returns a status message (or { msg, keep }).
    const DIRECT = {
        next: async () => { Spicetify.Player.next(); return "next"; },
        prev: async () => { Spicetify.Player.back(); return "previous"; },
        pause: async () => { Spicetify.Player.pause(); return "paused"; },
        play: async () => { Spicetify.Player.play(); return "playing"; },
        toggle: async () => { Spicetify.Player.togglePlay(); return Spicetify.Player.isPlaying() ? "playing" : "paused"; },
        restart: async () => { Spicetify.Player.seek(0); return "restarted"; },
        seek: async (p) => {
            const t = parseSeek(p.query);
            if (!t) throw new Error("usage: /seek 1:30 | +10 | -10");
            const dur = Spicetify.Player.getDuration();
            const target = Math.max(0, Math.min(dur, t.mode === "abs" ? t.ms : Spicetify.Player.getProgress() + t.ms));
            Spicetify.Player.seek(target);
            return `seek ${formatTime(target)} / ${formatTime(dur)}`;
        },
        vol: async (p) => {
            const now = Math.round(Spicetify.Player.getVolume() * 100);
            if (!p.query) return `volume ${now}`;
            const v = parseVolume(p.query, now);
            if (v == null) throw new Error("usage: /vol 40 | +5 | -5");
            Spicetify.Player.setVolume(v / 100);
            return `volume ${v}`;
        },
        shuffle: async (p) => {
            const v = parseOnOff(p.query, Spicetify.Player.getShuffle());
            if (v == null) throw new Error("usage: /shuffle [on|off]");
            Spicetify.Player.setShuffle(v);
            return `shuffle ${v ? "on" : "off"}`;
        },
        repeat: async (p) => {
            const v = parseRepeat(p.query, Spicetify.Player.getRepeat());
            if (v == null) throw new Error("usage: /repeat [off|all|one]");
            Spicetify.Player.setRepeat(v);
            return `repeat ${["off", "all", "one"][v]}`;
        },
        like: async () => {
            const it = needTrack();
            if (!(await Spicetify.Player.getHeart())) await Spicetify.Player.toggleHeart();
            return `liked ${curName(it)}`;
        },
        unlike: async () => {
            const it = needTrack();
            if (await Spicetify.Player.getHeart()) await Spicetify.Player.toggleHeart();
            return `unliked ${curName(it)}`;
        },
        radio: async () => {
            const it = needTrack();
            Spicetify.Player.playUri(`spotify:station:track:${idOf(it.uri)}`);
            setTimeout(() => {   // Spotify may reject station URIs; say so instead of failing silently
                const d = Spicetify.Player.data;
                const ctx = String(d?.context?.uri || d?.contextUri || d?.context_uri || "");
                if (!ctx.includes("station")) notify("radio didn't start; this Spotify version may not support it", 6000);
            }, 2500);
            return `radio: ${curName(it)}`;
        },
        now: async () => {
            const it = needTrack();
            const album = it.album?.name || it.metadata?.album_title || "";
            return [curName(it), curArtists(it), album].filter(Boolean).join(" · ");
        },
        copy: async () => {
            const it = needTrack();
            const url = `https://open.spotify.com/track/${idOf(it.uri)}`;
            if (Spicetify.Platform?.ClipboardAPI?.copy) await Spicetify.Platform.ClipboardAPI.copy(url);
            else await navigator.clipboard.writeText(url);
            return "link copied";
        },
        goto: async (p) => {
            const it = needTrack();
            const what = p.query.toLowerCase();
            if (what !== "artist" && what !== "album") throw new Error("usage: /goto artist | album");
            const uri = what === "artist" ? (it.artists?.[0]?.uri || it.metadata?.artist_uri) : (it.album?.uri || it.metadata?.album_uri);
            if (!uri) throw new Error(`no ${what} found for this song`);
            Spicetify.Platform.History.push(`/${what}/${idOf(uri)}`);
            return `opened ${what}`;
        },
        lyrics: async () => {
            const H = Spicetify.Platform.History;
            if (H.location?.pathname === "/SpicyLyrics") H.goBack();
            else H.push("/SpicyLyrics");
            return "";
        },
        fullscreen: async () => { toggleSpicyFullscreen(); return ""; },
        romanize: async () => {
            const b = document.getElementById("RomanizationToggle");
            if (!b) throw new Error("open the Spicy Lyrics page first");
            b.click();
            return "";
        },
        liked: async (p) => {
            const uri = getLikedSongsUri();
            if (!uri) throw new Error("couldn't find your Liked Songs");
            if (p.random) return `random: ${await playRandomFromPlaylist(uri)}`;
            Spicetify.Player.playUri(uri);
            return "playing Liked Songs";
        },
        lucky: async () => {
            const pools = [...(await getMyPlaylists())];
            const liked = getLikedSongsUri();
            if (liked) pools.push({ name: "Liked Songs", uri: liked });
            if (!pools.length) throw new Error("no playlists found");
            const pl = pools[Math.floor(Math.random() * pools.length)];
            return `lucky (${pl.name}): ${await playRandomFromPlaylist(pl.uri)}`;
        },
        sleep: async (p) => {
            const s = parseSleep(p.query);
            if (!s) throw new Error("usage: /sleep <minutes> | off");
            clearTimeout(sleepTimer);
            if (s.off) { sleepAt = 0; return "sleep timer off"; }
            sleepAt = Date.now() + s.minutes * 60000;
            sleepTimer = setTimeout(() => { Spicetify.Player.pause(); sleepAt = 0; Spicetify.showNotification?.("SpicyTUI: sleep timer, paused"); }, s.minutes * 60000);
            return `pausing in ${s.minutes} min`;
        },
        // clear + help need the UI, they are attached in main()
    };

    const trackLabel = (t) => ({ label: t.name, sub: (t.artists || []).map((a) => a.name).join(", ") });
    const playUri = (uri) => Spicetify.Player.playUri(uri);

    const VISIBLE = 5;        // rows shown at once (the list scrolls when there are more)
    const SEARCH_LIMIT = 10;  // search results kept
    const LIST_LIMIT = 40;    // playlists / history kept
    const hintRow = (label, sub) => ({ key: "hint:" + label, label, sub, isHint: true });
    const completeText = (c) => `/${c.name}` + (c.kind === "simple" ? "" : " ");

    const OPTIONS = { shuffle: ["on", "off"], repeat: ["off", "all", "one"], goto: ["artist", "album"] };
    const HINTS = {
        seek: [["1:30", "jump to a time"], ["+10 / -10", "skip seconds"]],
        vol: [["0-100", "set the volume"], ["+5 / -5", "change the volume"]],
        sleep: [["<minutes>", "pause playback after"], ["off", "cancel the timer"]],
    };

    // Build suggestion rows for a parsed input. Each row: { key, label, sub, fill, run(parsedAtExecution) }.
    async function suggest(p) {
        if (p.stage === "empty") return [];
        if (p.stage === "command") {
            return matchCommands(p.partial).map((c) => ({ key: "cmd:" + c.name, label: c.usage, sub: c.desc, complete: completeText(c) }));
        }
        const q = p.query;
        const flagHint = p.flagHint ? [hintRow("-r, --random", "play a random song")] : [];

        if (OPTIONS[p.cmd]) {
            return OPTIONS[p.cmd].filter((o) => o.startsWith(q.toLowerCase()))
                .map((o) => ({ key: "opt:" + o, label: o, sub: "", fill: o, run: async () => DIRECT[p.cmd]({ query: o, random: false }) }));
        }
        if (HINTS[p.cmd]) return q ? [] : HINTS[p.cmd].map(([a, b]) => hintRow(a, b));

        if (p.cmd === "playlist") {
            const mine = filterByWords(await getMyPlaylists(), q, (x) => x.name).slice(0, LIST_LIMIT);
            return [...flagHint, ...mine.map((pl) => ({
                key: pl.uri, label: pl.name, fill: pl.name, sub: p.random ? "▶ random song" : "playlist",
                run: async (now) => {
                    if (now.random) return `random: ${await playRandomFromPlaylist(pl.uri)}`;
                    playUri(pl.uri);
                    return `playing ${pl.name}`;
                },
            }))];
        }
        if (p.cmd === "add") {
            const mine = filterByWords(await getMyPlaylists(), q, (x) => x.name).slice(0, LIST_LIMIT);
            return mine.map((pl) => ({
                key: pl.uri, label: pl.name, fill: pl.name, sub: "add current song",
                run: async () => {
                    const it = needTrack();
                    await Spicetify.Platform.PlaylistAPI.add(pl.uri, [it.uri], { after: "end" });
                    return `added ${curName(it)} to ${pl.name}`;
                },
            }));
        }
        if (p.cmd === "recent") {
            const items = filterByWords(await getRecent(), q, (t) => t.name + " " + (t.artists || []).map((a) => a.name).join(" ")).slice(0, LIST_LIMIT);
            return items.map((t) => ({ key: t.uri, ...trackLabel(t), fill: t.name, run: async () => { playUri(t.uri); return `playing ${t.name}`; } }));
        }
        if (p.cmd === "queue" || p.cmd === "playnext") {
            const next = p.cmd === "playnext";
            if (!q) return [hintRow("<song name>", next ? "play right after this song" : "add to the queue"), ...(next ? [] : [hintRow("clear", "empty the queue")])];
            if (!next && q.toLowerCase() === "clear") {
                return [{ key: "queue-clear", label: "clear", sub: "empty the queue", fill: "clear", run: async () => { await Spicetify.Platform.PlayerAPI.clearQueue(); return "queue cleared"; } }];
            }
            const r = await searchAll(q);
            return r.tracks.slice(0, SEARCH_LIMIT).map((t) => ({
                key: t.uri, ...trackLabel(t), fill: t.name,
                run: async () => { await queueTrack(t.uri, next); return `${next ? "next up" : "queued"}: ${t.name}`; },
            }));
        }
        if (!q) return flagHint;
        if (p.cmd === "song") {
            const r = await searchAll(q);
            return r.tracks.slice(0, SEARCH_LIMIT).map((t) => ({
                key: t.uri, ...trackLabel(t), fill: t.name,
                run: async () => { playUri(t.uri); return `playing ${t.name}`; },
            }));
        }
        if (p.cmd === "album") {
            const r = await searchAll(q);
            return r.albums.slice(0, SEARCH_LIMIT).map((a) => ({
                key: a.uri, label: a.name, fill: a.name,
                sub: (a.artists || []).map((x) => x.name).join(", ") + (a.release_date ? ` · ${a.release_date.slice(0, 4)}` : ""),
                run: async () => { playUri(a.uri); return `playing ${a.name}`; },
            }));
        }
        if (p.cmd === "artist") {
            const r = await searchAll(q);
            const rows = rankArtistResults(q, r.artists, r.tracks).slice(0, SEARCH_LIMIT);
            return [...flagHint, ...rows.map((row) => {
                if (row.kind === "artist") {
                    return {
                        key: row.data.uri, label: row.data.name, fill: row.data.name, sub: p.random ? "▶ random song" : "artist",
                        run: async (now) => {
                            if (now.random) return await playArtistRandom(row.data);
                            playUri(row.data.uri);
                            return `playing ${row.data.name}`;
                        },
                    };
                }
                const t = row.data;
                return {
                    key: t.uri, ...trackLabel(t), fill: `${(t.artists || [])[0]?.name || ""} ${t.name}`.trim(),
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
.stui-more{padding:2px 12px 0;text-align:right;font-size:12px;color:rgba(255,255,255,.55)}
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
        let top = 0;             // first visible row (the list scrolls, VISIBLE rows at a time)
        let navigated = false;   // true once the user moved the highlight with the arrow keys
        let chosen = null;       // row completed into the input, waiting for Enter to play it
        let token = 0;
        let statusTimer = 0;
        let debounce = 0;

        // command history (Up / Down on an empty input)
        let hist = [];
        let histIdx = -1;
        try { hist = JSON.parse(localStorage.getItem("spicytui:history") || "[]").slice(-50); } catch (e) { hist = []; }
        const pushHistory = (text) => {
            const t = String(text || "").trim();
            if (!t || hist[hist.length - 1] === t) return;
            hist.push(t);
            hist = hist.slice(-50);
            try { localStorage.setItem("spicytui:history", JSON.stringify(hist)); } catch (e) { /* storage may be unavailable */ }
        };

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
        notify = say;
        trackSongChange();
        Spicetify.Player.addEventListener("songchange", trackSongChange);

        function render() {
            list.textContent = "";
            if (sel < 0) top = 0;
            else if (sel < top) top = sel;
            else if (sel >= top + VISIBLE) top = sel - VISIBLE + 1;
            top = Math.max(0, Math.min(top, Math.max(0, rows.length - VISIBLE)));
            rows.slice(top, top + VISIBLE).forEach((r, k) => {
                const i = top + k;
                const row = el("div", { className: "stui-row" + (i === sel ? " sel" : "") + (r.isHint ? " hint" : "") },
                    el("span", { className: "l", textContent: r.label }), el("span", { className: "s", textContent: r.sub || "" }));
                row.addEventListener("mousedown", (e) => { e.preventDefault(); r.complete ? complete(r) : execute(r); });
                list.append(row);
            });
            const below = rows.length - (top + VISIBLE);
            if (top > 0 || below > 0) {
                list.append(el("div", { className: "stui-more", textContent: (top > 0 ? `↑ ${top}  ` : "") + (below > 0 ? `↓ ${below} more` : "") }));
            }
        }

        function chosenValid() {
            if (!chosen) return false;
            const a = parseInput(input.value), b = parseInput(chosen.value);
            return a.stage === "args" && a.cmd === b.cmd && a.query === b.query;
        }

        function showHelp(q) {
            const name = String(q || "").toLowerCase().replace(/^\//, "");
            const c = name ? findCommand(name) : null;
            if (name === "keys") {
                rows = [hintRow("Tab", "complete the highlighted (or first) match"), hintRow("Enter", "run it; after Tab, plays that exact match"),
                    hintRow("↑ ↓", "move the highlight; on an empty input = history"), hintRow("/  ·  Esc", "focus  ·  leave the input"), hintRow("Ctrl/Cmd + F", "toggle Spicy Lyrics fullscreen")];
            } else if (c) {
                rows = [hintRow(c.usage, ""), hintRow(c.desc, ""), ...c.examples.slice(0, 3).map((e) => hintRow(e, "example"))];
            } else {
                rows = [...COMMANDS.map((x) => ({ key: "help:" + x.name, label: x.usage, sub: x.desc, complete: completeText(x) })),
                    { key: "help:keys", label: "/help keys", sub: "keyboard shortcuts", complete: "/help keys" }];
            }
            sel = -1;
            render();
        }
        DIRECT.help = async (p) => { showHelp(p.query); return { keep: true }; };
        DIRECT.clear = async () => { input.value = ""; chosen = null; rows = []; sel = -1; render(); return ""; };

        async function refresh() {
            const my = ++token;
            const p = parseInput(input.value);
            if (p.stage === "args" && p.cmd === "help") { showHelp(p.query); return; }
            if (chosenValid()) {                       // already completed: keep the list hidden, only offer the -r hint
                rows = p.flagHint ? [hintRow("-r, --random", "play a random song")] : [];
                sel = -1; render();
                return;
            }
            let next = [];
            try { next = await suggest(p); } catch (e) { if (my === token) say("search failed: " + (e.message || e)); }
            if (my !== token) return;
            rows = next;
            navigated = false;
            sel = -1;
            render();
            if (!rows.length && p.stage === "args" && p.query && !OPTIONS[p.cmd] && !HINTS[p.cmd] && COMMAND_NAMES.has(p.cmd)) say("no matches", 1500);
        }

        // put a row's text into the input (never plays)
        function complete(row) {
            if (!row) return;
            histIdx = -1;
            if (row.complete) {
                input.value = row.complete;
                chosen = null;
                input.focus();
                refresh();
                return;
            }
            const p = parseInput(input.value);
            const cmd = p.stage === "args" ? p.cmd : "song";
            input.value = `/${cmd} ${row.fill}${p.random ? " -r" : ""} `;
            chosen = { value: input.value, key: row.key, row };
            rows = []; sel = -1; navigated = false;      // the choice is in the input, hide the list
            render();
            input.focus();
        }

        function finish(msg, keep, raw) {
            pushHistory(raw);
            histIdx = -1;
            if (msg) say(msg);
            if (!keep) { input.value = ""; chosen = null; rows = []; sel = -1; render(); }
        }

        async function runDirect(name, p) {
            const raw = input.value;
            try {
                const out = await DIRECT[name](p);
                finish(typeof out === "string" ? out : out?.msg, out && out.keep, raw);
            } catch (e) {
                say("error: " + (e.message || e), 5000);
            }
        }

        async function execute(row) {
            if (!row || row.isHint || !row.run) return;
            const raw = input.value;
            try {
                finish(await row.run(parseInput(raw)), false, raw);
            } catch (e) {
                say("error: " + (e.message || e), 5000);
            }
        }

        const firstPlayable = () => rows.find((r) => !r.isHint && (r.run || r.complete));

        function historyStep(dir) {
            if (!hist.length) return;
            histIdx = dir < 0 ? Math.min(histIdx + 1, hist.length - 1) : histIdx - 1;
            input.value = histIdx < 0 ? "" : hist[hist.length - 1 - histIdx];
            if (histIdx < 0) histIdx = -1;
            chosen = null; rows = []; sel = -1; render();
            const end = input.value.length;
            input.setSelectionRange(end, end);
        }

        input.addEventListener("input", () => {
            histIdx = -1;
            if (!chosenValid()) chosen = null;
            clearTimeout(debounce);
            debounce = setTimeout(refresh, 120);
        });

        input.addEventListener("keydown", (e) => {
            e.stopPropagation(); // keep Spotify's own hotkeys out of our input
            const p = parseInput(input.value);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!rows.length) {
                    if (input.value === "" || histIdx >= 0) historyStep(e.key === "ArrowUp" ? -1 : 1);
                    return;
                }
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
                if (p.stage === "empty") return;
                if (p.stage === "command") {
                    if (navigated && sel >= 0) { complete(rows[sel]); return; }
                    const c = findCommand(p.partial);
                    if (c && c.kind === "simple") { runDirect(c.name, { stage: "args", cmd: c.name, query: "", random: false }); return; }
                    if (rows[0]) complete(rows[0]);
                    else say(`unknown command: /${p.partial}`);
                    return;
                }
                if (chosenValid()) { execute(chosen.row); return; }
                if (navigated && sel >= 0 && rows[sel] && !rows[sel].isHint) { complete(rows[sel]); return; }
                if (!COMMAND_NAMES.has(p.cmd)) { say(`unknown command: /${p.cmd}`); return; }
                if (DIRECT[p.cmd]) { runDirect(p.cmd, p); return; }
                (async () => {   // rows can be empty (e.g. input recalled from history), so look them up first
                    let row = firstPlayable();
                    if (!row) {
                        try { row = (await suggest(p)).find((r) => !r.isHint && r.run); } catch (err) { say("search failed: " + (err.message || err)); return; }
                    }
                    if (row) execute(row); else say("no matches", 1500);
                })();
            } else if (e.key === "Escape") {
                input.value = ""; chosen = null; rows = []; sel = -1; histIdx = -1; render(); input.blur();
            }
        });
        input.addEventListener("keyup", (e) => e.stopPropagation());
        input.addEventListener("keypress", (e) => e.stopPropagation());
        input.addEventListener("focus", placeAboveNowPlayingBar);

        // Ctrl+F (Cmd+F on Mac) toggles Spicy Lyrics fullscreen from anywhere; Ctrl+Cmd+F is left to macOS
        document.addEventListener("keydown", (e) => {
            if (e.key.toLowerCase() !== "f" || e.altKey || e.shiftKey || e.ctrlKey === e.metaKey) return;
            e.preventDefault();
            e.stopPropagation();
            try { toggleSpicyFullscreen(); } catch (err) { say("error: " + err.message, 4000); }
        }, true);

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
