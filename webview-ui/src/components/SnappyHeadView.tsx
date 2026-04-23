import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

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
  idle: '#7f8ca8',
  listening: '#44d4ff',
  thinking: '#ffbf47',
  working: '#62db90',
  done: '#28d9bf',
  blocked: '#ff6673',
  error: '#ff914d',
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

function modeChip(mode: HeadMode): CSSProperties {
  return {
    borderColor: MODE_COLORS[mode],
    color: '#eef5ff',
    background: `${MODE_COLORS[mode]}26`,
    boxShadow: `0 0 0 1px ${MODE_COLORS[mode]}55 inset`,
  };
}

function toneBorder(tone: HeadCard['tone']): string {
  switch (tone) {
    case 'good':
      return '#62db90';
    case 'warn':
      return '#ffbf47';
    case 'bad':
      return '#ff6673';
    case 'info':
      return '#44d4ff';
    default:
      return '#5f6b86';
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
      const lanes = [...(payload.state.lanes || [])].sort((a, b) => laneOrder(a, 0) - laneOrder(b, 0));
      const seatIds = seatIdsByPosition(officeState);
      const desiredIds: number[] = [];
      let followId: number | null = null;

      lanes.forEach((lane, index) => {
        const agentId = laneAgentId(lane, index);
        desiredIds.push(agentId);
        const preferredSeatId = seatIds[SEAT_SLOT_BY_LANE[lane.id] ?? index] || seatIds[index] || undefined;
        if (!officeState.characters.has(agentId)) {
          officeState.addAgent(agentId, undefined, undefined, preferredSeatId, true, lane.title);
          officeState.setTeamInfo(agentId, 'snappy-os', lane.title, false, undefined, false);
        }

        officeState.setAgentTool(agentId, ACTIVE_STATUSES.has(lane.status) ? cleanTask(lane.task) : null);
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
        if (!response.ok) {
          throw new Error(`HTTP ${response.status.toString()}`);
        }
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

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: '#101827' }}>
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

      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{
          height: '24%',
          background: 'linear-gradient(180deg, rgba(8,12,22,0.78) 0%, rgba(8,12,22,0.24) 62%, rgba(8,12,22,0) 100%)',
        }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{
          height: '22%',
          background: 'linear-gradient(0deg, rgba(8,12,22,0.82) 0%, rgba(8,12,22,0.28) 58%, rgba(8,12,22,0) 100%)',
        }}
      />

      <div className="absolute top-8 left-8 right-8 flex items-start justify-between gap-16">
        <div
          className="pointer-events-none"
          style={{
            maxWidth: '58%',
            padding: '12px 16px',
            background: 'rgba(14, 22, 38, 0.74)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            boxShadow: '0 14px 42px rgba(0,0,0,0.24)',
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#96a4c2', marginBottom: 6 }}>
            Snappy Office
          </div>
          <div className="flex items-center gap-10 flex-wrap" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 28, lineHeight: 1.05, fontWeight: 900, color: '#eef5ff' }}>
              {state?.headline || 'Connecting to snappy state'}
            </div>
            <div
              style={{
                ...modeChip(state?.mode || 'idle'),
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 999,
                border: '1px solid',
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: MODE_COLORS[state?.mode || 'idle'],
                  boxShadow: `0 0 10px ${MODE_COLORS[state?.mode || 'idle']}`,
                }}
              />
              {state?.mode || 'idle'}
            </div>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.3, color: '#d4dceb' }}>
            {state?.detail || 'Pixel Agents renderer awaiting head-screen state'}
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {lanes.map((lane) => (
              <span
                key={lane.id}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#edf3ff',
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {lane.title} · {lane.status}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-10" style={{ width: 320 }}>
          {signals.map((signal) => (
            <div
              key={signal.label}
              style={{
                padding: '12px 14px',
                background: 'rgba(14, 22, 38, 0.74)',
                border: `1px solid ${toneBorder(signal.tone)}`,
                borderRadius: 14,
                boxShadow: '0 14px 42px rgba(0,0,0,0.20)',
              }}
            >
              <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#96a4c2', marginBottom: 4 }}>
                {signal.label}
              </div>
              <div style={{ fontSize: 18, lineHeight: 1.15, fontWeight: 800, color: '#f2f6ff' }}>
                {signal.value}
              </div>
            </div>
          ))}
          {error && (
            <div style={{ padding: '12px 14px', background: 'rgba(50, 14, 20, 0.78)', border: '1px solid #ff6673', borderRadius: 14, color: '#fff1f3', fontSize: 14, fontWeight: 700 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="absolute left-8 right-8 flex items-end justify-between gap-16" style={{ bottom: 106 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: '58%' }}>
          {recipes.map((recipe) => (
            <span
              key={recipe}
              style={{
                padding: '7px 10px',
                borderRadius: 999,
                background: 'rgba(14, 22, 38, 0.74)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#f2f6ff',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {recipe}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, maxWidth: '36%', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {roster.slice(0, 4).map((item) => (
            <div
              key={item.label}
              style={{
                minWidth: 120,
                padding: '10px 12px',
                background: 'rgba(14, 22, 38, 0.74)',
                borderLeft: `4px solid ${toneBorder(item.tone)}`,
                borderRadius: 12,
                borderTop: '1px solid rgba(255,255,255,0.06)',
                borderRight: '1px solid rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.15, color: '#f2f6ff' }}>{item.label}</div>
              <div style={{ fontSize: 12, lineHeight: 1.25, color: '#aab6d1', marginTop: 4 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="absolute left-8 right-8 bottom-8"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.05fr 1.35fr 0.9fr',
          gap: 12,
        }}
      >
        {[
          { label: 'Now', value: state?.now || state?.task || 'Waiting for state' },
          { label: 'Recent', value: state?.recent || 'No recent output surfaced' },
          {
            label: 'Need',
            value: live ? (state?.need || 'None') : `source · ${snappyStateUrl} · awaiting first poll`,
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              padding: '14px 16px',
              background: 'rgba(14, 22, 38, 0.82)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              boxShadow: '0 14px 42px rgba(0,0,0,0.24)',
              minHeight: 74,
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#96a4c2', marginBottom: 6 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 20, lineHeight: 1.15, fontWeight: 900, color: '#eff5ff' }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
