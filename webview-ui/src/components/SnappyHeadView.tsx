/* eslint-disable pixel-agents/no-inline-colors */
import { useEffect, useMemo, useRef, useState } from 'react';

import { OfficeCanvas } from '../office/components/OfficeCanvas.js';
import { EditorState } from '../office/editor/editorState.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { snappyStateUrl } from '../runtime.js';

type HeadMode = 'idle' | 'listening' | 'thinking' | 'working' | 'done' | 'blocked' | 'error';
type LaneStatus = 'idle' | 'queued' | 'active' | 'waiting' | 'blocked' | 'paused' | 'done';

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
  roster?: unknown[];
  signals?: unknown[];
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
  const state = live?.state;
  const mode = state?.mode || 'idle';
  const modeColor = MODE_COLORS[mode];

  const nowText = state?.now || state?.task || null;
  const sortedLanes = useMemo(
    () => [...lanes].sort((a, b) => laneOrder(a, 0) - laneOrder(b, 0)),
    [lanes],
  );

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{
        background: 'var(--snappy-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ══ TOP BAR — one line, always fits ══════════════════════════ */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'rgba(8,12,22,0.92)',
          borderBottom: `1px solid color-mix(in srgb, ${modeColor} 30%, rgba(255,255,255,0.06))`,
          minHeight: 40,
        }}
      >
        {/* Mode LED + name */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: modeColor,
              boxShadow: `0 0 10px ${modeColor}, 0 0 4px ${modeColor}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: modeColor,
            }}
          >
            {mode}
          </span>
        </div>

        {/* Separator */}
        <span style={{ color: 'var(--snappy-frame)', fontSize: 12, flexShrink: 0 }}>·</span>

        {/* Headline — fills remaining space, ellipsis */}
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            fontSize: 14,
            fontWeight: 800,
            color: 'var(--snappy-text-bright)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {state?.headline || 'Connecting…'}
        </div>

        {/* Error badge — top-right */}
        {error && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--snappy-mode-error)',
              border: '1px solid var(--snappy-mode-error)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            ERR
          </span>
        )}
      </div>

      {/* ══ OFFICE CANVAS — takes all remaining height ═══════════════ */}
      <div style={{ flex: '1 1 0', position: 'relative', minHeight: 0 }}>
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
        {/* Bottom scrim — fades into the NOW panel */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '35%',
            background:
              'linear-gradient(0deg, rgba(8,12,22,0.95) 0%, rgba(8,12,22,0.5) 60%, rgba(8,12,22,0) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ══ BOTTOM PANEL — NOW + lane LEDs ═══════════════════════════ */}
      <div
        style={{
          flexShrink: 0,
          background: 'rgba(8,12,22,0.96)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '10px 12px 10px',
        }}
      >
        {/* NOW label + task text */}
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--snappy-text-muted)',
              marginRight: 8,
            }}
          >
            NOW
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--snappy-text-strong)',
              lineHeight: 1.25,
            }}
          >
            {nowText ?? (live ? 'Idle' : `awaiting ${snappyStateUrl}`)}
          </span>
        </div>

        {/* Lane LEDs — single row, no wrapping */}
        {sortedLanes.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              overflowX: 'auto',
              scrollbarWidth: 'none',
            }}
          >
            {sortedLanes.map((lane) => {
              const color = LANE_STATUS_COLOR[lane.status];
              const isActive = ACTIVE_STATUSES.has(lane.status);
              return (
                <div
                  key={lane.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: color,
                      boxShadow: isActive ? `0 0 8px ${color}, 0 0 3px ${color}` : 'none',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: isActive ? 'var(--snappy-text-soft)' : 'var(--snappy-text-muted)',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {shortLane(lane.title)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
