/* eslint-disable pixel-agents/no-inline-colors */
import { useEffect, useMemo, useRef, useState } from 'react';

import { OfficeCanvas } from '../office/components/OfficeCanvas.js';
import { EditorState } from '../office/editor/editorState.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { snappyStateUrl } from '../runtime.js';

type HeadMode = 'idle' | 'listening' | 'thinking' | 'working' | 'done' | 'blocked' | 'error';
type LaneStatus = 'idle' | 'queued' | 'active' | 'waiting' | 'blocked' | 'paused' | 'done';

type HeadCard = {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
};

type HeadLane = {
  id: string;
  title: string;
  status: LaneStatus;
  task: string;
  detail?: string;
  members?: string[];
  count?: number;
};

type HeadState = {
  mode: HeadMode;
  headline: string;
  detail: string;
  task: string;
  scene?: 'office';
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
  remaining_ms: number | null;
};

const AGENT_ID_BASE = 10000;
const ACTIVE_STATUSES = new Set<LaneStatus>(['active']);
const WAITING_STATUSES = new Set<LaneStatus>(['waiting', 'paused']);
const BLOCKED_STATUSES = new Set<LaneStatus>(['blocked']);
const LANE_PRIORITY = ['sweep', 'content', 'linkedin', 'meetings', 'pods', 'kernel'];
const SEAT_SLOT_BY_LANE: Record<string, number> = {
  sweep: 0,
  content: 1,
  linkedin: 2,
  meetings: 4,
  pods: 6,
  kernel: 7,
};

const MODE_COLORS: Record<HeadMode, string> = {
  idle: 'var(--snappy-mode-idle)',
  listening: 'var(--snappy-mode-listening)',
  thinking: 'var(--snappy-mode-thinking)',
  working: 'var(--snappy-mode-working)',
  done: 'var(--snappy-mode-done)',
  blocked: 'var(--snappy-mode-blocked)',
  error: 'var(--snappy-mode-error)',
};

const LANE_STATUS_COLOR: Record<LaneStatus, string> = {
  active: 'var(--snappy-mode-working)',
  queued: 'var(--snappy-mode-thinking)',
  waiting: 'var(--snappy-mode-thinking)',
  paused: 'var(--snappy-mode-idle)',
  blocked: 'var(--snappy-mode-blocked)',
  done: 'var(--snappy-mode-done)',
  idle: 'var(--snappy-mode-idle)',
};

function seatIdsByPosition(officeState: OfficeState): string[] {
  return [...officeState.seats.entries()]
    .sort((a, b) => {
      if (a[1].seatRow !== b[1].seatRow) return a[1].seatRow - b[1].seatRow;
      if (a[1].seatCol !== b[1].seatCol) return a[1].seatCol - b[1].seatCol;
      return a[0].localeCompare(b[0]);
    })
    .map(([id]) => id);
}

function laneOrder(lane: HeadLane, index: number): number {
  const p = LANE_PRIORITY.indexOf(lane.id);
  return p >= 0 ? p : LANE_PRIORITY.length + index;
}

function laneAgentId(lane: HeadLane, index: number): number {
  const p = LANE_PRIORITY.indexOf(lane.id);
  return AGENT_ID_BASE + (p >= 0 ? p : 100 + index);
}

function cleanTask(text: string | undefined): string | null {
  const value = (text || '').trim();
  return value ? value : null;
}

function toneBorder(tone: HeadCard['tone']): string {
  switch (tone) {
    case 'good':
      return 'var(--snappy-mode-working)';
    case 'warn':
      return 'var(--snappy-mode-thinking)';
    case 'bad':
      return 'var(--snappy-mode-blocked)';
    case 'info':
      return 'var(--snappy-mode-listening)';
    default:
      return 'var(--snappy-frame)';
  }
}

function useSnappyScene(officeState: OfficeState, layoutReady: boolean) {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const managedIdsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!layoutReady) return;
    let cancelled = false;

    const syncOffice = (payload: LivePayload) => {
      const lanes = [...(payload.state.lanes || [])].sort(
        (a, b) => laneOrder(a, 0) - laneOrder(b, 0),
      );
      const seatIds = seatIdsByPosition(officeState);
      const desiredIds: number[] = [];
      let followId: number | null = null;

      lanes.forEach((lane, index) => {
        const agentId = laneAgentId(lane, index);
        desiredIds.push(agentId);
        const preferredSeatId =
          seatIds[SEAT_SLOT_BY_LANE[lane.id] ?? index] || seatIds[index] || undefined;
        if (!officeState.characters.has(agentId)) {
          officeState.addAgent(agentId, undefined, undefined, preferredSeatId, true, lane.title);
          officeState.setTeamInfo(agentId, 'snappy-os', lane.title, false, undefined, false);
        }

        officeState.setAgentTool(
          agentId,
          ACTIVE_STATUSES.has(lane.status) ? cleanTask(lane.task) : null,
        );
        officeState.setAgentActive(agentId, ACTIVE_STATUSES.has(lane.status));

        if (BLOCKED_STATUSES.has(lane.status)) {
          officeState.showPermissionBubble(agentId);
          if (followId === null) followId = agentId;
        } else {
          officeState.clearPermissionBubble(agentId);
          if (WAITING_STATUSES.has(lane.status)) {
            officeState.showWaitingBubble(agentId);
          }
          if (followId === null && ACTIVE_STATUSES.has(lane.status)) {
            followId = agentId;
          }
        }
      });

      for (const id of managedIdsRef.current) {
        if (!desiredIds.includes(id)) {
          officeState.removeAgent(id);
        }
      }
      managedIdsRef.current = desiredIds;
      officeState.cameraFollowId = followId;
    };

    const poll = async () => {
      try {
        const response = await fetch(snappyStateUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
        const payload = (await response.json()) as LivePayload;
        if (cancelled) return;
        setLive(payload);
        setError(null);
        syncOffice(payload);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [layoutReady, officeState]);

  return { live, error };
}

interface SnappyHeadViewProps {
  officeState: OfficeState;
  layoutReady: boolean;
}

// Condense lane title to a short readable label
function shortLane(title: string): string {
  return title
    .replace(/-regen$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SnappyHeadView({ officeState, layoutReady }: SnappyHeadViewProps) {
  const { live, error } = useSnappyScene(officeState, layoutReady);
  const [zoom, setZoom] = useState(2.4);
  const panRef = useRef({ x: 0, y: 0 });
  const editorState = useMemo(() => new EditorState(), []);

  const lanes = useMemo(() => live?.state.lanes || [], [live]);
  const roster = useMemo(() => live?.state.roster || [], [live]);
  const signals = useMemo(() => live?.state.signals || [], [live]);
  const recipes = useMemo(() => live?.state.recipes || [], [live]);
  const state = live?.state;
  const mode = state?.mode || 'idle';
  const modeColor = MODE_COLORS[mode];

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: 'var(--snappy-bg)' }}
    >
      {/* ── Pixel office canvas ────────────────────────────────────── */}
      <OfficeCanvas
        officeState={officeState}
        onClick={() => {}}
        isEditMode={false}
        editorState={editorState}
        onEditorTileAction={() => {}}
        onEditorEraseAction={() => {}}
        onEditorSelectionChange={() => {}}
        onDeleteSelected={() => {}}
        onRotateSelected={() => {}}
        onDragMove={() => {}}
        editorTick={0}
        zoom={zoom}
        onZoomChange={setZoom}
        panRef={panRef}
      />

      {/* ── Lighter scrims — let the office breathe ──────────────── */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{
          height: '30%',
          background:
            'linear-gradient(180deg, rgba(8,12,22,0.88) 0%, rgba(8,12,22,0.55) 50%, rgba(8,12,22,0) 100%)',
        }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{
          height: '28%',
          background:
            'linear-gradient(0deg, rgba(8,12,22,0.92) 0%, rgba(8,12,22,0.50) 55%, rgba(8,12,22,0) 100%)',
        }}
      />

      {/* ══ TOP STRIP ═══════════════════════════════════════════════ */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{ padding: '14px 18px 0' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* Left: headline + mode + lanes */}
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            {/* Headline row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <div
                style={{
                  fontSize: 36,
                  lineHeight: 1.0,
                  fontWeight: 900,
                  color: 'var(--snappy-text-bright)',
                  letterSpacing: '-0.01em',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {state?.headline || 'Connecting…'}
              </div>
              {/* Mode chip */}
              <div
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: `1px solid ${modeColor}`,
                  background: `color-mix(in srgb, ${modeColor} 14%, rgba(10,16,28,0.7))`,
                  fontSize: 13,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--snappy-text-bright)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: modeColor,
                    boxShadow: `0 0 8px ${modeColor}`,
                    flexShrink: 0,
                  }}
                />
                {mode}
              </div>
            </div>

            {/* Detail line */}
            {state?.detail && (
              <div
                style={{
                  fontSize: 15,
                  color: 'var(--snappy-text-soft)',
                  marginBottom: 10,
                  lineHeight: 1.3,
                }}
              >
                {state.detail}
              </div>
            )}

            {/* Lane status dots — compact, colored by status */}
            {lanes.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[...lanes]
                  .sort((a, b) => laneOrder(a, 0) - laneOrder(b, 0))
                  .map((lane) => (
                    <div
                      key={lane.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: `1px solid color-mix(in srgb, ${LANE_STATUS_COLOR[lane.status]} 35%, rgba(255,255,255,0.08))`,
                        background: `color-mix(in srgb, ${LANE_STATUS_COLOR[lane.status]} 10%, rgba(10,16,28,0.65))`,
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--snappy-text-soft)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: LANE_STATUS_COLOR[lane.status],
                          flexShrink: 0,
                          boxShadow: ACTIVE_STATUSES.has(lane.status)
                            ? `0 0 6px ${LANE_STATUS_COLOR[lane.status]}`
                            : 'none',
                        }}
                      />
                      {shortLane(lane.title)}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Right: signals */}
          {signals.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                flexShrink: 0,
                width: 200,
              }}
            >
              {signals.slice(0, 4).map((sig) => (
                <div
                  key={sig.label}
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(10,16,28,0.75)',
                    border: `1px solid ${toneBorder(sig.tone)}`,
                    borderRadius: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: 'var(--snappy-text-muted)',
                      marginBottom: 3,
                    }}
                  >
                    {sig.label}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      lineHeight: 1.1,
                      fontWeight: 900,
                      color: 'var(--snappy-text-bright)',
                    }}
                  >
                    {sig.value}
                  </div>
                </div>
              ))}
              {error && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'var(--snappy-danger-bg)',
                    border: '1px solid var(--snappy-mode-blocked)',
                    borderRadius: 12,
                    color: 'var(--snappy-danger-text)',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ BOTTOM STRIP ════════════════════════════════════════════ */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{ padding: '0 18px 14px' }}
      >
        {/* Recipes + Roster row — sits just above the 3-grid */}
        {(recipes.length > 0 || roster.length > 0) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: 12,
              marginBottom: 10,
            }}
          >
            {/* Recipes — active plan/tasks */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 0' }}>
              {recipes.slice(0, 6).map((recipe) => (
                <span
                  key={recipe}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(14,22,38,0.72)',
                    border: '1px solid var(--snappy-panel-border)',
                    color: 'var(--snappy-text-bright)',
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {recipe}
                </span>
              ))}
            </div>

            {/* Roster cards */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
              {roster.slice(0, 3).map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(10,16,28,0.78)',
                    borderLeft: `3px solid ${toneBorder(item.tone)}`,
                    borderRadius: 10,
                    borderTop: '1px solid var(--snappy-panel-border-soft)',
                    borderRight: '1px solid var(--snappy-panel-border-soft)',
                    borderBottom: '1px solid var(--snappy-panel-border-soft)',
                    minWidth: 100,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: 'var(--snappy-text-bright)',
                      lineHeight: 1.15,
                    }}
                  >
                    {item.label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--snappy-text-subtle)', marginTop: 3 }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NOW · RECENT · NEED — the main 3-grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr 0.85fr', gap: 10 }}>
          {[
            { label: 'NOW', value: state?.now || state?.task || 'Waiting for state' },
            { label: 'RECENT', value: state?.recent || 'No recent output' },
            { label: 'NEED', value: live ? state?.need || 'None' : `awaiting · ${snappyStateUrl}` },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: '12px 14px',
                background: 'rgba(10,16,28,0.82)',
                border: '1px solid var(--snappy-panel-border)',
                borderRadius: 14,
                minHeight: 66,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: 'var(--snappy-text-muted)',
                  marginBottom: 5,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 18,
                  lineHeight: 1.2,
                  fontWeight: 900,
                  color: 'var(--snappy-text-strong)',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Error (no signals column to absorb it) */}
      {error && signals.length === 0 && (
        <div
          className="absolute top-8 right-8 pointer-events-none"
          style={{
            width: 200,
            padding: '12px 14px',
            background: 'var(--snappy-danger-bg)',
            border: '1px solid var(--snappy-mode-blocked)',
            borderRadius: 12,
            color: 'var(--snappy-danger-text)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
