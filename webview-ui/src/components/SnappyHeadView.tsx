/* eslint-disable pixel-agents/no-inline-colors */
import { useEffect, useMemo, useRef, useState } from 'react';

import { snappyStateUrl } from '../runtime.js';

type HeadMode = 'idle' | 'listening' | 'thinking' | 'working' | 'done' | 'blocked' | 'error';
type LaneStatus = 'idle' | 'queued' | 'active' | 'waiting' | 'blocked' | 'paused' | 'done';

type HeadLane = { id: string; title: string; status: LaneStatus; task: string };
type HeadCard = { label: string; value: string; tone?: string };

type HeadState = {
  mode: HeadMode;
  headline: string;
  detail: string;
  task: string;
  now?: string;
  recent?: string;
  need?: string;
  lanes?: HeadLane[];
  roster?: HeadCard[];
  signals?: HeadCard[];
  recipes?: string[];
  source?: string;
};

type LivePayload = {
  ok: boolean;
  state: HeadState;
  fresh: boolean;
  stale_reason: string | null;
  age_ms: number;
};

/* ── tokens ───────────────────────────────────────────────── */
const MODE_BG: Record<HeadMode, string> = {
  idle:      '#e8e9ed',
  listening: '#dfecff',
  thinking:  '#fff0ad',
  working:   '#d7f5de',
  done:      '#e3dcff',
  blocked:   '#ffd9d6',
  error:     '#ffd9b8',
};
const MODE_DOT: Record<HeadMode, string> = {
  idle:      '#b8bcc4',
  listening: '#3aa9ff',
  thinking:  '#f8b61d',
  working:   '#24b24a',
  done:      '#7a5cff',
  blocked:   '#e5443e',
  error:     '#f1791f',
};
const LANE_DOT: Record<LaneStatus, string> = {
  active:  '#24b24a',
  queued:  '#3aa9ff',
  waiting: '#f8b61d',
  paused:  '#b8bcc4',
  blocked: '#e5443e',
  done:    '#7a5cff',
  idle:    '#b8bcc4',
};

const PAPER   = '#fbf9f4';
const PAPER2  = '#f2efe6';
const INK     = '#0e0e13';
const MUTED   = '#5c5a52';
const HI_NOW  = '#fff7c2';
const HI_NEXT = '#edf1ff';

/* ── data polling ─────────────────────────────────────────── */
function useLiveState() {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(snappyStateUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as LivePayload;
        if (!cancelled) { setLive(payload); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return { live, error, clock };
}

/* ── helpers ──────────────────────────────────────────────── */
function today() {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function laneAbbr(title: string): string {
  return title.replace(/-regen$/i, '').slice(0, 3).toUpperCase();
}

/* ── sub-components ───────────────────────────────────────── */
function PxDot({ status, size = 10 }: { status: string; size?: number }) {
  const color = (LANE_DOT as Record<string, string>)[status] ?? MODE_DOT['idle'];
  const animate = status === 'active' || status === 'working' || status === 'blocked';
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      border: '1px solid #000',
      background: color,
      flexShrink: 0,
      verticalAlign: 'middle',
      animation: animate ? 'sfblink 1.2s steps(2) infinite' : 'none',
    }} />
  );
}

function ModeBadge({ mode }: { mode: HeadMode }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: '2px solid #000', padding: '3px 12px 2px',
      fontSize: 14, textTransform: 'uppercase', letterSpacing: '1.5px',
      boxShadow: '2px 2px 0 #000',
      fontFamily: "'Silkscreen', monospace",
      background: MODE_BG[mode],
    }}>
      <PxDot status={mode} size={10} />
      {mode}
    </div>
  );
}

function RowPast({ time, title, dot, outputs }: {
  time: string; title: string; dot: string; outputs: string[];
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 1fr',
      padding: '3px 14px 3px 0',
    }}>
      <div style={{
        textAlign: 'right', paddingRight: 14,
        fontFamily: "'Silkscreen', monospace", fontSize: 11, color: MUTED,
        position: 'relative',
      }}>
        {time}
        <span style={{
          position: 'absolute', right: -1, top: 5,
          width: 7, height: 7, background: '#000', border: '1px solid #000',
        }} />
      </div>
      <div style={{ paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, color: '#333' }}>
          <PxDot status={dot} size={8} />
          <span style={{ color: '#444' }}>{title}</span>
          <span style={{ color: '#1a8c38', fontSize: 15 }}>✓</span>
        </div>
        {outputs.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {outputs.slice(0, 2).map((o, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center',
                border: '1px solid #000', padding: '0 5px',
                fontSize: 12, background: '#fff',
                fontFamily: "'VT323', monospace",
              }}>▤ {o}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RowNow({ time, title, detail, progress }: {
  time: string; title: string; detail?: string; progress?: number;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 1fr',
      background: HI_NOW,
      borderTop: '2px solid #000', borderBottom: '2px solid #000',
      padding: '9px 14px 9px 0',
      margin: '4px 0',
      position: 'relative',
    }}>
      <span style={{
        position: 'absolute', left: 78, top: -9,
        background: '#000', color: '#fff',
        fontFamily: "'Silkscreen', monospace", fontSize: 10, letterSpacing: 2,
        padding: '1px 6px',
      }}>NOW</span>
      <div style={{
        textAlign: 'right', paddingRight: 14,
        fontFamily: "'Silkscreen', monospace", fontSize: 11, color: MUTED,
        position: 'relative',
      }}>
        {time}
        <span style={{
          position: 'absolute', right: -3, top: 5,
          width: 11, height: 11, background: '#000', border: '1px solid #000',
          animation: 'sfblink 1.2s steps(2) infinite',
        }} />
      </div>
      <div style={{ paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PxDot status="working" size={12} />
          <span style={{
            fontFamily: "'Jersey 10', monospace", fontSize: 28, lineHeight: 1.0, letterSpacing: '0.5px',
          }}>{title}</span>
        </div>
        {detail && (
          <div style={{
            background: '#000', color: '#9bff9b', padding: '4px 8px',
            fontFamily: "'VT323', monospace", fontSize: 14, letterSpacing: '0.5px',
            lineHeight: 1.25, maxHeight: 40, overflow: 'hidden',
            border: '1px solid #000',
          }}>▸ {detail}<span style={{
            display: 'inline-block', width: 6, height: 12, background: '#9bff9b',
            verticalAlign: '-1px', animation: 'sfblink 0.6s steps(2) infinite', marginLeft: 2,
          }} /></div>
        )}
        <div style={{ height: 9, background: '#fff', border: '1px solid #000', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${progress ?? 45}%`,
            background: 'repeating-linear-gradient(45deg, #24b24a 0 4px, #1a8c38 4px 8px)',
            animation: 'sfbarfill 6s linear infinite',
          }} />
        </div>
      </div>
    </div>
  );
}

function RowNext({ time, title, dot }: { time: string; title: string; dot: string }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 1fr',
      background: `linear-gradient(to right, transparent 71px, ${HI_NEXT} 71px)`,
      padding: '3px 14px 3px 0',
    }}>
      <div style={{
        textAlign: 'right', paddingRight: 14,
        fontFamily: "'Silkscreen', monospace", fontSize: 11, color: MUTED,
        position: 'relative',
      }}>
        {time}
        <span style={{
          position: 'absolute', right: -1, top: 5,
          width: 7, height: 7, background: HI_NEXT, border: '1px solid #000',
        }} />
      </div>
      <div style={{ paddingLeft: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 17 }}>
        <PxDot status={dot} size={8} />
        <span>{title}</span>
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '2px 14px',
      fontFamily: "'Silkscreen', monospace", fontSize: 10, letterSpacing: '1.5px',
      color: MUTED,
      borderTop: '1px dashed #bbb',
      background: PAPER2,
    }}>{label}</div>
  );
}

function ReadyCard({ title, sub, hot }: { title: string; sub: string; hot?: boolean }) {
  return (
    <div style={{
      border: '1px solid #000', background: '#fff',
      padding: '7px 9px', fontSize: 16, lineHeight: 1.18,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <span style={{ flex: 1, fontSize: 15, lineHeight: 1.1 }}>{title}</span>
        {hot && <span style={{
          fontFamily: "'Silkscreen', monospace", fontSize: 8,
          background: '#e5443e', color: '#fff', padding: '0 4px',
        }}>NEW</span>}
      </div>
      <div style={{ fontSize: 13, color: '#555', marginTop: 3 }}>{sub}</div>
    </div>
  );
}

function CmdRow({ k, label, go, hot }: { k: string; label: string; go: string; hot?: boolean }) {
  return (
    <div style={{
      border: '1px solid #000', background: hot ? '#fff0ad' : '#fff',
      padding: '3px 8px', fontFamily: "'VT323', monospace", fontSize: 16, lineHeight: 1.15,
      display: 'flex', gap: 7, alignItems: 'center',
    }}>
      <span style={{
        background: '#000', color: '#fff', fontFamily: "'Silkscreen', monospace", fontSize: 10,
        padding: '2px 6px', letterSpacing: '0.5px', flexShrink: 0,
      }}>{k}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#777', flexShrink: 0 }}>{go}</span>
    </div>
  );
}

function MeterRow({ label, pct, val }: { label: string; pct: number; val: string }) {
  const tone = pct > 80 ? '#e5443e' : pct > 55 ? '#f8b61d' : '#24b24a';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 52px', gap: 7, alignItems: 'center', fontSize: 13 }}>
      <span style={{ fontFamily: "'Silkscreen', monospace", fontSize: 9, letterSpacing: 1, color: '#555' }}>{label}</span>
      <span style={{ height: 9, border: '1px solid #000', background: '#fff', position: 'relative', overflow: 'hidden' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: tone }} />
      </span>
      <span style={{ fontFamily: "'VT323', monospace", fontSize: 14, textAlign: 'right' }}>{val}</span>
    </div>
  );
}

/* ── main view ────────────────────────────────────────────── */
export function SnappyHeadView(_props: { officeState?: unknown; layoutReady?: boolean }) {
  const { live, error, clock } = useLiveState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Inject Google Fonts
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=VT323&family=Silkscreen:wght@400;700&family=Jersey+10&display=swap';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes sfblink { 50% { opacity: 0.35; } }
      @keyframes sfbarfill { 0% { width: 20%; } 100% { width: 95%; } }
      @keyframes sfbars { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
    `;
    document.head.appendChild(style);
    return () => { link.remove(); style.remove(); };
  }, []);

  // Scale to fill viewport
  useEffect(() => {
    const update = () => {
      const W = 800, H = 560;
      const sx = window.innerWidth / W;
      const sy = window.innerHeight / H;
      setScale(Math.min(sx, sy));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const state = live?.state;
  const mode: HeadMode = state?.mode ?? 'idle';
  const lanes = useMemo(() => state?.lanes ?? [], [state]);
  const signals = useMemo(() => state?.signals ?? [], [state]);
  const roster = useMemo(() => (state?.roster ?? []) as HeadCard[], [state]);

  // Derive timeline events from HeadState
  const nowText = state?.now ?? state?.task ?? null;
  const nowTime = clock ? clock.slice(0, 5) : '--:--';

  const pastEvents = useMemo(() => {
    if (!state?.recent) return [];
    return state.recent.split(/[·\n]/).map(s => s.trim()).filter(Boolean).slice(0, 2).map((t, i) => ({
      time: `~${i === 0 ? '-2m' : '-8m'}`,
      title: t.length > 40 ? t.slice(0, 40) + '…' : t,
      dot: 'done',
      outputs: [] as string[],
    }));
  }, [state]);

  const nextEvents = useMemo(() => {
    const queued = lanes.filter(l => l.status === 'queued' || l.status === 'waiting');
    return queued.slice(0, 2).map(l => ({
      time: 'soon',
      title: l.title.replace(/-regen$/i, '').replace(/-/g, ' '),
      dot: l.status,
    }));
  }, [lanes]);

  const activeLanes = lanes.filter(l => l.status === 'active');
  const readyItems: { title: string; sub: string; hot?: boolean }[] = [
    ...roster.slice(0, 2).map(r => ({ title: r.label, sub: r.value })),
    ...(state?.need ? [{ title: 'Needs attention', sub: state.need, hot: true }] : []),
  ];

  const cmds = [
    { k: '/sweep', label: 'triage inbox', go: 'haiku · ~90s' },
    { k: '/log',   label: 'log last 2h to invoice', go: '5 blocks' },
    { k: '/ask',   label: 'free prompt', go: 'natural language' },
    { k: '/run',   label: 'run agent now', go: 'pick lane' },
  ];

  const meters = signals.slice(0, 3).map(s => {
    const num = parseFloat(s.value);
    const pct = isNaN(num) ? 30 : Math.min(num, 100);
    return { label: s.label.toUpperCase().slice(0, 5), pct, val: s.value };
  });

  const ran  = pastEvents.length;
  const now  = nowText ? 1 : 0;
  const next = nextEvents.length;
  const ready = readyItems.length;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw', height: '100vh',
        background: '#1f2128',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div style={{
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        width: 800, height: 560,
        fontFamily: "'VT323', ui-monospace, monospace",
        background: PAPER,
        color: INK,
        overflow: 'hidden',
        WebkitFontSmoothing: 'none' as const,
        boxSizing: 'border-box' as const,
        border: '1px solid #000',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: `0 0 0 1px #333, 0 0 70px -10px rgba(255, 220, 160, 0.25)`,
      }}>

        {/* ── Title bar ── */}
        <div style={{
          height: 24, borderBottom: '1px solid #000',
          display: 'flex', alignItems: 'center', padding: '0 8px',
          position: 'relative',
          background: 'repeating-linear-gradient(to bottom, #000 0, #000 1px, #fbf9f4 1px, #fbf9f4 3px)',
          flexShrink: 0,
        }}>
          <span style={{ width: 12, height: 12, background: PAPER, border: '1px solid #000', display: 'inline-block' }} />
          <span style={{
            position: 'absolute', left: 0, right: 0, textAlign: 'center',
            fontSize: 18, lineHeight: '24px', pointerEvents: 'none',
          }}>
            <span style={{ background: PAPER, padding: '0 10px' }}>Snappy · Operator</span>
          </span>
        </div>

        {/* ── Top bar ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center',
          padding: '7px 14px 8px',
          borderBottom: '1px solid #000',
          background: PAPER,
          flexShrink: 0,
        }}>
          {/* Date */}
          <div style={{ fontSize: 20, lineHeight: 1.05, whiteSpace: 'nowrap' }}>
            {today()}
          </div>

          {/* Counts */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'stretch', flexWrap: 'wrap' }}>
            {[
              { n: ran,  l: 'ran',   bg: PAPER2 },
              { n: now,  l: 'now',   bg: HI_NOW },
              { n: next, l: 'next',  bg: HI_NEXT },
              { n: ready,l: 'ready', bg: '#ffe7c2' },
            ].map(s => (
              <span key={s.l} style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 5,
                padding: '0 7px', border: '1px solid #000', lineHeight: '22px',
                background: s.bg,
              }}>
                <span style={{ fontSize: 22, fontFamily: "'Jersey 10', monospace", lineHeight: '22px' }}>{s.n}</span>
                <span style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 1 }}>{s.l}</span>
              </span>
            ))}
            <span style={{ alignSelf: 'center', color: MUTED, fontSize: 13, marginLeft: 6, whiteSpace: 'nowrap' }}>
              {state?.headline ?? (error ? `⚠ ${error}` : 'awaiting state…')}
            </span>
          </div>

          {/* Mode + clock */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ModeBadge mode={mode} />
            <span style={{ fontFamily: "'Silkscreen', monospace", fontSize: 11, color: MUTED, letterSpacing: 1 }}>{clock}</span>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 300px',
          flex: 1, overflow: 'hidden',
          minHeight: 0,
        }}>

          {/* Left: timeline */}
          <div style={{
            overflow: 'hidden',
            padding: '6px 0',
            position: 'relative',
            background: `linear-gradient(to right, transparent 70px, #000 70px, #000 71px, transparent 71px), ${PAPER}`,
          }}>
            {pastEvents.length > 0 && (
              <>
                <SectionHeader label={`RAN · ${ran}`} />
                {pastEvents.map((e, i) => <RowPast key={i} {...e} />)}
              </>
            )}

            <SectionHeader label="NOW" />
            {nowText
              ? <RowNow time={nowTime} title={nowText} detail={state?.detail} />
              : (
                <div style={{ padding: '12px 14px 12px 84px', fontSize: 16, color: MUTED, fontFamily: "'Silkscreen', monospace" }}>
                  {live ? 'idle' : `awaiting · ${snappyStateUrl}`}
                </div>
              )
            }

            {nextEvents.length > 0 && (
              <>
                <SectionHeader label={`NEXT · ${next}`} />
                {nextEvents.map((e, i) => <RowNext key={i} {...e} />)}
              </>
            )}

            {activeLanes.length > 0 && activeLanes.some(l => l.task) && (
              <>
                <SectionHeader label="ACTIVE" />
                {activeLanes.filter(l => l.task).slice(0, 2).map((l, i) => (
                  <RowNext key={i} time={laneAbbr(l.title)} title={l.task} dot="active" />
                ))}
              </>
            )}
          </div>

          {/* Right: side panels */}
          <div style={{
            borderLeft: '1px solid #000',
            background: PAPER,
            padding: '8px 10px',
            display: 'flex', flexDirection: 'column', gap: 7,
            overflow: 'hidden',
          }}>
            {/* Mic/voice panel */}
            <div style={{
              border: '1px solid #000', background: '#000', color: '#9bff9b',
              padding: '7px 10px', fontFamily: "'VT323', monospace",
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3,
                fontFamily: "'Silkscreen', monospace", fontSize: 9, letterSpacing: '1.5px', color: '#fff',
              }}>
                <span style={{ width: 8, height: 8, background: '#9bff9b', display: 'inline-block', animation: 'sfblink 1.2s steps(2) infinite' }} />
                <span>MIC</span>
                <span style={{ marginLeft: 'auto', color: '#9bff9b', fontSize: 9, letterSpacing: 1 }}>
                  WAKE: "snappy"
                </span>
              </div>
              <div style={{ fontSize: 15, color: '#9bff9b', lineHeight: 1.15 }}>
                ▸ {mode === 'listening' ? (state?.detail ?? 'listening…') : 'room quiet'}
                <span style={{ display: 'inline-block', width: 5, height: 11, background: '#9bff9b', verticalAlign: '-1px', animation: 'sfblink 0.6s steps(2) infinite', marginLeft: 2 }} />
              </div>
            </div>

            {/* Ready for you */}
            {readyItems.length > 0 && (
              <div style={{
                border: '1px solid #000', background: '#ffe7c2',
                padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5,
                boxShadow: '2px 2px 0 #000',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: "'Silkscreen', monospace", fontSize: 9, letterSpacing: '1.5px', color: '#333',
                  marginBottom: 2,
                }}>
                  <span>◆ READY FOR YOU</span>
                  <span style={{ background: '#000', color: '#fff', padding: '0 4px', marginLeft: 'auto' }}>{readyItems.length}</span>
                </div>
                {readyItems.slice(0, 2).map((r, i) => (
                  <ReadyCard key={i} title={r.title} sub={r.sub} hot={r.hot} />
                ))}
              </div>
            )}

            {/* Suggested commands */}
            <div style={{
              border: '1px solid #000', background: PAPER,
              padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
              boxShadow: '2px 2px 0 #000', flex: 1,
            }}>
              <div style={{ fontFamily: "'Silkscreen', monospace", fontSize: 9, letterSpacing: '1.5px', color: '#333', marginBottom: 2 }}>
                / COMMANDS
              </div>
              {cmds.map((c, i) => <CmdRow key={i} k={c.k} label={c.label} go={c.go} hot={i === 0} />)}
            </div>

            {/* Machine meters */}
            {meters.length > 0 && (
              <div style={{
                border: '1px solid #000', background: PAPER,
                padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5,
              }}>
                <div style={{ fontFamily: "'Silkscreen', monospace", fontSize: 9, letterSpacing: '1.5px', color: '#333', marginBottom: 1 }}>
                  ▤ MACHINE
                </div>
                {meters.map((m, i) => <MeterRow key={i} {...m} />)}
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom bar: lane LEDs ── */}
        <div style={{
          borderTop: '1px solid #000',
          display: 'grid', gridTemplateColumns: '1fr auto',
          padding: '5px 14px',
          background: `repeating-linear-gradient(to right, ${PAPER} 0 2px, ${PAPER2} 2px 4px)`,
          fontSize: 14,
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'nowrap', overflow: 'hidden', alignItems: 'center' }}>
            {lanes.map((l) => (
              <span key={l.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontFamily: "'Silkscreen', monospace", fontSize: 10, letterSpacing: 1,
              }}>
                <PxDot status={l.status} size={9} />
                {laneAbbr(l.title)}
              </span>
            ))}
          </div>
          <span style={{ fontFamily: "'Silkscreen', monospace", fontSize: 10, color: MUTED, letterSpacing: 1 }}>
            mac-mini · {clock} · {lanes.length} lanes
          </span>
        </div>
      </div>
    </div>
  );
}
