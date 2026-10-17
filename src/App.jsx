import { useCallback, useEffect, useRef, useState } from "react";

const STORE_KEY = "study-player:v2";
const LEGACY_KEY = "study-player:v1";
const RATES = [0.75, 1, 1.25, 1.5, 2];

/* ---------- helpers ---------- */

const ID_RE = /^[\w-]{11}$/;

function parseVideoId(raw) {
  const s = raw.trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www|m)\./, "");
    let id = null;
    if (host === "youtu.be") {
      id = u.pathname.split("/")[1];
    } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      id =
        u.searchParams.get("v") ||
        (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1];
    }
    return id && ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function fetchTitle(id) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`
    );
    return r.ok ? (await r.json()).title : null;
  } catch {
    return null;
  }
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
  } catch {
    return {};
  }
}

let ytPromise;
function loadYT() {
  if (!ytPromise) {
    ytPromise = new Promise((resolve) => {
      if (window.YT?.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return ytPromise;
}

/* ---------- icons ---------- */

const PATHS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  prev: "M6 6h2v12H6zM9.5 12 18 18V6z",
  next: "M16 6h2v12h-2zM6 18l8.5-6L6 6z",
  x: "M6 6l12 12M18 6 6 18",
};

function Icon({ name, className = "h-5 w-5" }) {
  const stroke = name === "x";
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill={stroke ? "none" : "currentColor"}
      stroke={stroke ? "currentColor" : "none"}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ---------- app ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function loadPlaylists() {
  const saved = readStore().playlists;
  if (Array.isArray(saved)) return saved;
  // Carry over the single playlist saved by the previous version
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (old?.list?.length) return [{ id: uid(), name: "My playlist", videos: old.list }];
  } catch {
    /* nothing to migrate */
  }
  return [];
}

export default function App() {
  const [playlists, setPlaylists] = useState(loadPlaylists);
  const [openId, setOpenId] = useState(null); // playlist currently open
  const [currentId, setCurrentId] = useState(null); // video currently selected
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  const openPlaylist = playlists.find((p) => p.id === openId) ?? null;
  const list = openPlaylist?.videos ?? [];

  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const latest = useRef({ list, currentId });
  latest.current = { list, currentId };

  // Persist playlists
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ playlists }));
    } catch {
      /* storage unavailable: app still works for this session */
    }
  }, [playlists]);

  const setVideos = (plId, fn) =>
    setPlaylists((ps) => ps.map((p) => (p.id === plId ? { ...p, videos: fn(p.videos) } : p)));

  const step = useCallback((dir) => {
    const { list, currentId } = latest.current;
    const i = list.findIndex((v) => v.id === currentId);
    const target = list[i + dir];
    if (target) setCurrentId(target.id);
  }, []);

  // Clicking a video in the open playlist starts playing it
  const selectVideo = (id) => {
    if (id === latest.current.currentId) {
      playerRef.current?.playVideo();
      return;
    }
    setCurrentId(id);
  };

  // Create the YouTube player once
  useEffect(() => {
    let dead = false;
    loadYT().then((YT) => {
      if (dead || !mountRef.current) return;
      const el = document.createElement("div");
      mountRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        width: "100%",
        height: "100%",
        playerVars: {
          rel: 0, // end-of-video suggestions limited to the same channel
          controls: 0, // we render our own controls
          modestbranding: 1,
          iv_load_policy: 3, // no annotations
          disablekb: 1,
          fs: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e) => {
            setPlaying(e.data === YT.PlayerState.PLAYING);
            setEnded(e.data === YT.PlayerState.ENDED);
            if (e.data === YT.PlayerState.ENDED) step(1);
          },
        },
      });
    });
    return () => {
      dead = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      if (mountRef.current) mountRef.current.innerHTML = "";
      setReady(false);
    };
  }, [step]);

  // Load and play the selected video; stop when nothing is selected
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    if (!currentId) {
      p.stopVideo();
      return;
    }
    setRate(1);
    p.loadVideoById(currentId);
  }, [currentId, ready]);

  // Poll playback position
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      setTime(p.getCurrentTime());
      setDuration(p.getDuration() || 0);
    }, 500);
    return () => clearInterval(t);
  }, [ready]);

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p || !latest.current.currentId) return;
    p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo();
  }, []);

  const seekBy = useCallback((d) => {
    const p = playerRef.current;
    if (p) p.seekTo(Math.max(0, p.getCurrentTime() + d), true);
  }, []);

  // Keyboard: space = play/pause, arrows = seek 10s
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return;
      if (!latest.current.currentId) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") seekBy(10);
      else if (e.code === "ArrowLeft") seekBy(-10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seekBy]);

  /* ----- playlists ----- */

  const createPlaylist = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const pl = { id: uid(), name: n, videos: [] };
    setPlaylists((ps) => [...ps, pl]);
    setName("");
    setError("");
    setOpenId(pl.id);
    setCurrentId(null);
  };

  const openList = (id) => {
    if (id === openId) return;
    setOpenId(id);
    setCurrentId(null); // player stays hidden until a video is chosen
    setError("");
  };

  const startNew = () => {
    setOpenId(null);
    setCurrentId(null);
    setError("");
  };

  const deletePlaylist = (pl) => {
    if (pl.videos.length && !window.confirm(`Delete "${pl.name}" and its ${pl.videos.length} video(s)?`)) return;
    setPlaylists((ps) => ps.filter((p) => p.id !== pl.id));
    if (pl.id === openId) {
      setOpenId(null);
      setCurrentId(null);
    }
  };

  /* ----- videos in the open playlist ----- */

  const addVideo = (e) => {
    e.preventDefault();
    if (!openPlaylist) return;
    const id = parseVideoId(input);
    if (!id) return setError("That isn't a YouTube link or video ID. Check it and try again.");
    if (list.some((v) => v.id === id)) {
      return setError("That video is already in this playlist.");
    }
    const plId = openPlaylist.id;
    setError("");
    setInput("");
    setVideos(plId, (vs) => [...vs, { id, title: `Video ${id}` }]);
    fetchTitle(id).then(
      (t) => t && setVideos(plId, (vs) => vs.map((v) => (v.id === id ? { ...v, title: t } : v)))
    );
  };

  const removeVideo = (id) => {
    setVideos(openId, (vs) => vs.filter((v) => v.id !== id));
    if (id === currentId) setCurrentId(null);
  };

  const clearVideos = () => {
    setVideos(openId, () => []);
    setCurrentId(null);
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    playerRef.current?.setPlaybackRate(next);
    setRate(next);
  };

  const idx = list.findIndex((v) => v.id === currentId);
  const current = list[idx];
  const btn =
    "grid h-9 w-9 place-items-center rounded-full text-nord-mute transition hover:bg-nord-wash hover:text-nord-ink disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-nord-ink antialiased">
      {/* Logo at the far top-left, "How to use" link at the far top-right */}
      <header className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="text-3xl font-bold text-black">Focus- Organize lectures and notes.</div>
        <a
          href="/how-to-use.html"
          target="_blank"
          rel="noopener"
          className="shrink-0 pt-2 text-[15px] font-medium text-nord-accent underline-offset-4 hover:underline focus-visible:underline"
        >
          How to use
        </a>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-5 pb-8 pt-4 sm:px-8">
        {/* Add bar (adds to the open playlist) */}
        <form onSubmit={addVideo} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            disabled={!openPlaylist}
            placeholder={openPlaylist ? "Paste a YouTube link or video ID" : "Open a playlist to add videos"}
            aria-label="YouTube link or video ID"
            className="min-w-0 flex-1 rounded-lg border border-nord-line bg-white px-4 py-2.5 text-[15px] outline-none transition placeholder:text-nord-mute/70 focus:border-nord-accent focus:ring-2 focus:ring-nord-accent/20 disabled:cursor-not-allowed disabled:bg-nord-wash"
          />
          <button
            type="submit"
            disabled={!openPlaylist}
            className="rounded-lg bg-nord-ink px-5 py-2.5 text-[15px] font-medium text-white transition hover:bg-nord-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nord-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-nord-ink"
          >
            Add
          </button>
        </form>
        <p className="mt-2 h-5 text-sm text-red-600" role="alert">
          {error}
        </p>

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main>
            {/* Player: invisible until a video is chosen */}
            <div className={current ? "" : "hidden"}>
              <div className="relative aspect-video overflow-hidden rounded-xl bg-nord-ink">
                <div ref={mountRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />

                {/* Click shield: blocks YouTube's hover overlays, click toggles play */}
                {current && !ended && (
                  <button
                    onClick={toggle}
                    aria-label={playing ? "Pause" : "Play"}
                    className="absolute inset-0 cursor-pointer"
                  />
                )}

                {/* Replaces YouTube's end screen on the last video */}
                {current && ended && (
                  <div className="absolute inset-0 grid place-items-center bg-white text-center">
                    <div>
                      <p className="text-lg font-medium">End of playlist</p>
                      <button
                        onClick={() => {
                          playerRef.current?.seekTo(0, true);
                          playerRef.current?.playVideo();
                        }}
                        className="mt-3 rounded-lg border border-nord-line px-4 py-2 text-sm font-medium hover:bg-nord-wash"
                      >
                        Replay this video
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {current && (
                <h1 className="mt-4 line-clamp-2 text-xl font-semibold leading-snug tracking-tight">
                  {current.title}
                </h1>
              )}

              {/* Controls */}
              <div className="mt-3 flex items-center gap-1">
                <button className={btn} onClick={() => step(-1)} disabled={idx <= 0} aria-label="Previous video">
                  <Icon name="prev" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-full bg-nord-ink text-white transition hover:bg-nord-accent disabled:opacity-30"
                  onClick={toggle}
                  disabled={!current}
                  aria-label={playing ? "Pause" : "Play"}
                >
                  <Icon name={playing ? "pause" : "play"} />
                </button>
                <button
                  className={btn}
                  onClick={() => step(1)}
                  disabled={idx < 0 || idx >= list.length - 1}
                  aria-label="Next video"
                >
                  <Icon name="next" />
                </button>

                <span className="ml-3 w-12 text-right text-sm tabular-nums text-nord-mute">{fmt(time)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={1}
                  value={Math.min(time, duration || 1)}
                  onChange={(e) => {
                    setTime(+e.target.value);
                    playerRef.current?.seekTo(+e.target.value, true);
                  }}
                  disabled={!current}
                  aria-label="Seek"
                  className="mx-2 h-1 flex-1 cursor-pointer accent-nord-accent"
                />
                <span className="w-12 text-sm tabular-nums text-nord-mute">{fmt(duration)}</span>

                <button
                  onClick={cycleRate}
                  disabled={!current}
                  aria-label="Playback speed"
                  className="ml-2 rounded-md px-2 py-1 text-sm font-medium tabular-nums text-nord-mute hover:bg-nord-wash hover:text-nord-ink disabled:opacity-30"
                >
                  {rate}×
                </button>
              </div>
              <p className="mt-3 text-xs text-nord-mute">Space to play or pause. Left and right arrows skip 10 seconds.</p>
            </div>

            {/* Shown instead of the player until a video is chosen */}
            {!current && (
              <div className="grid aspect-video place-items-center rounded-xl bg-nord-wash p-6 text-center">
                {openPlaylist ? (
                  <div>
                    <p className="text-lg font-medium">
                      {list.length ? "Pick a video to start" : "This playlist is empty"}
                    </p>
                    <p className="mt-1 text-nord-mute">
                      {list.length
                        ? "Choose one from the playlist to play it."
                        : "Paste a link above to add your first video."}
                    </p>
                  </div>
                ) : (
                  <form onSubmit={createPlaylist} className="w-full max-w-sm">
                    <p className="text-xl font-semibold">Create a playlist</p>
                    <p className="mt-1 text-sm text-nord-mute">
                      {playlists.length
                        ? "Or open one of your playlists."
                        : "Name it, then add videos from YouTube."}
                    </p>
                    <div className="mt-4 flex gap-2">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={60}
                        placeholder="Playlist name"
                        aria-label="Playlist name"
                        className="min-w-0 flex-1 rounded-lg border border-nord-line bg-white px-4 py-2.5 text-[15px] outline-none transition placeholder:text-nord-mute/70 focus:border-nord-accent focus:ring-2 focus:ring-nord-accent/20"
                      />
                      <button
                        type="submit"
                        disabled={!name.trim()}
                        className="rounded-lg bg-nord-ink px-5 py-2.5 text-[15px] font-medium text-white transition hover:bg-nord-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nord-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-nord-ink"
                      >
                        Create
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </main>

          {/* Playlists, stacked vertically; the open one lists its videos */}
          <aside aria-label="Playlists">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Playlists ({playlists.length})</h2>
              {openPlaylist && (
                <button onClick={startNew} className="text-sm text-nord-mute hover:text-nord-ink">
                  + New
                </button>
              )}
            </div>

            {playlists.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-nord-line p-4 text-sm text-nord-mute">
                Playlists you create appear here and are saved in this browser.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {playlists.map((pl) => {
                  const isOpen = pl.id === openId;
                  return (
                    <li
                      key={pl.id}
                      className={`rounded-xl border ${isOpen ? "border-nord-accent" : "border-nord-line"}`}
                    >
                      <div className="group relative">
                        <button
                          onClick={() => openList(pl.id)}
                          aria-expanded={isOpen}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3 pr-11 text-left transition ${
                            isOpen ? "rounded-t-xl bg-nord-wash" : "rounded-xl hover:bg-nord-wash/60"
                          }`}
                        >
                          <span className="truncate font-medium">{pl.name}</span>
                          <span className="shrink-0 text-sm tabular-nums text-nord-mute">{pl.videos.length}</span>
                        </button>
                        <button
                          onClick={() => deletePlaylist(pl)}
                          aria-label={`Delete playlist ${pl.name}`}
                          className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-nord-mute opacity-60 hover:bg-white hover:text-nord-ink group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {isOpen && (
                        <div className="border-t border-nord-line p-2">
                          {pl.videos.length === 0 ? (
                            <p className="p-2 text-sm text-nord-mute">No videos yet. Paste a link above.</p>
                          ) : (
                            <>
                              <ul className="space-y-1">
                                {pl.videos.map((v) => {
                                  const active = v.id === currentId;
                                  return (
                                    <li key={v.id} className="group relative">
                                      <button
                                        onClick={() => selectVideo(v.id)}
                                        aria-current={active}
                                        className={`flex w-full items-center gap-3 rounded-lg border-l-2 p-2 pr-9 text-left transition ${
                                          active
                                            ? "border-nord-accent bg-nord-wash"
                                            : "border-transparent hover:bg-nord-wash/60"
                                        }`}
                                      >
                                        <img
                                          src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                                          alt=""
                                          loading="lazy"
                                          className="aspect-video w-24 shrink-0 rounded-md bg-nord-line object-cover"
                                        />
                                        <span className="line-clamp-2 text-sm leading-snug">{v.title}</span>
                                      </button>
                                      <button
                                        onClick={() => removeVideo(v.id)}
                                        aria-label={`Remove ${v.title}`}
                                        className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-nord-mute opacity-60 hover:bg-white hover:text-nord-ink group-hover:opacity-100 focus-visible:opacity-100"
                                      >
                                        <Icon name="x" className="h-3.5 w-3.5" />
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                              <div className="px-2 pt-2 text-right">
                                <button onClick={clearVideos} className="text-sm text-nord-mute hover:text-nord-ink">
                                  Clear
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </div>

      {/* Footer notice */}
      <footer className="px-4 pb-4 text-3xl font-bold text-black">
        Uploading Notes feature will be available within 24 hrs.
      </footer>
    </div>
  );
}
