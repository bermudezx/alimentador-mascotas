import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getPanel, setConfig, setPower, setSpeedRemote } from "@/lib/servo.functions";
import { publishServo } from "@/lib/mqtt-link";
import type { Direction, HistoryItem, PanelSnapshot } from "@/lib/servo-types";

export type { Direction, HistoryItem };

const TZ = "America/Bogota";

function at(hour: number, minute: number) {
  return Date.UTC(2026, 9, 1, hour + 5, minute, 0);
}

const SEED_HISTORY: HistoryItem[] = [
  { id: "seed-1", kind: "on", label: "Servo encendido", at: at(10, 20) },
  { id: "seed-2", kind: "off", label: "Servo apagado", at: at(10, 15) },
  { id: "seed-3", kind: "on", label: "Servo encendido", at: at(9, 42) },
  { id: "seed-4", kind: "off", label: "Servo apagado", at: at(9, 37) },
  { id: "seed-5", kind: "on", label: "Servo encendido", at: at(8, 11) },
];

type ServoState = {
  online: boolean;
  boardOnline: boolean;
  running: boolean;
  speed: number;
  runStartedAt: number | null;
  history: HistoryItem[];
  ssid: string;
  ip: string;
  voltage: string;
  deviceLabel: string;
  direction: Direction;
  autoStopSec: number;
  confirmStart: boolean;
  boardSeenAt: number | null;
  applyRemote: (snapshot: PanelSnapshot) => void;
  markOffline: () => void;
  refresh: () => Promise<void>;
  turnOn: () => Promise<boolean>;
  turnOff: () => Promise<boolean>;
  setSpeed: (value: number) => void;
  pushSpeed: (value: number) => Promise<void>;
  setDirection: (value: Direction) => Promise<void>;
  setAutoStopSec: (value: number) => Promise<void>;
  setConfirmStart: (value: boolean) => void;
};

function publishNow() {
  const state = useServoStore.getState();
  publishServo({
    running: state.running,
    speed: state.speed,
    direction: state.direction,
    autoStopSec: state.autoStopSec,
  });
}

let holdUntil = 0;

function hold() {
  holdUntil = Date.now() + 1600;
}

function fromRemote(snapshot: PanelSnapshot, previous: ServoState, fresh: boolean): Partial<ServoState> {
  return {
    online: true,
    boardOnline: snapshot.boardOnline,
    running: fresh ? snapshot.running : previous.running,
    speed: fresh ? snapshot.speed : previous.speed,
    direction: fresh ? snapshot.direction : previous.direction,
    autoStopSec: fresh ? snapshot.autoStopSec : previous.autoStopSec,
    runStartedAt: fresh ? snapshot.runStartedAt : previous.runStartedAt,
    history: snapshot.history,
    ssid: snapshot.ssid,
    ip: snapshot.ip,
    voltage: snapshot.voltage,
    deviceLabel: snapshot.deviceLabel,
    boardSeenAt: snapshot.boardSeenAt,
  };
}

export const useServoStore = create<ServoState>()(
  persist(
    (set, get) => ({
      online: true,
      boardOnline: false,
      running: false,
      speed: 100,
      runStartedAt: null,
      history: SEED_HISTORY,
      ssid: "Casa_Felipe",
      ip: "192.168.1.25",
      voltage: "5.0 V",
      deviceLabel: "ESP32 + SG5010",
      direction: "cw",
      autoStopSec: 0,
      confirmStart: false,
      boardSeenAt: null,
      applyRemote: (snapshot) => {
        set(fromRemote(snapshot, get(), Date.now() > holdUntil));
      },
      markOffline: () => set({ online: false, boardOnline: false }),
      refresh: async () => {
        try {
          const snapshot = await getPanel();
          get().applyRemote(snapshot);
        } catch {
          get().markOffline();
        }
      },
      turnOn: async () => {
        const state = get();
        if (!state.online || state.running) return false;
        hold();
        set({ running: true, runStartedAt: Date.now() });
        publishNow();
        try {
          const snapshot = await setPower({ data: { action: "on" } });
          get().applyRemote(snapshot);
          publishNow();
          return true;
        } catch {
          set({ online: false, running: false, runStartedAt: null });
          return false;
        }
      },
      turnOff: async () => {
        if (!get().running) return false;
        hold();
        set({ running: false, runStartedAt: null });
        publishNow();
        try {
          const snapshot = await setPower({ data: { action: "off" } });
          get().applyRemote(snapshot);
          publishNow();
          return true;
        } catch {
          get().markOffline();
          return false;
        }
      },
      setSpeed: (value) => {
        hold();
        set({ speed: Math.min(100, Math.max(0, Math.round(value))) });
      },
      pushSpeed: async (value) => {
        hold();
        try {
          const snapshot = await setSpeedRemote({ data: { speed: value } });
          get().applyRemote(snapshot);
          publishNow();
        } catch {
          get().markOffline();
        }
      },
      setDirection: async (value) => {
        hold();
        set({ direction: value });
        publishNow();
        try {
          const snapshot = await setConfig({ data: { direction: value } });
          get().applyRemote(snapshot);
          publishNow();
        } catch {
          get().markOffline();
        }
      },
      setAutoStopSec: async (value) => {
        hold();
        set({ autoStopSec: value });
        publishNow();
        try {
          const snapshot = await setConfig({ data: { autoStopSec: value } });
          get().applyRemote(snapshot);
          publishNow();
        } catch {
          get().markOffline();
        }
      },
      setConfirmStart: (value) => set({ confirmStart: value }),
    }),
    {
      name: "mi-servo",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ confirmStart: state.confirmStart }),
    },
  ),
);

export function formatHMS(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatClock(ts: number) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  }).format(ts);
}

export function formatStamp(ts: number) {
  const date = new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  }).format(ts);
  return `${date} ${formatClock(ts)}`;
}

export function formatDay(ts: number) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  }).format(ts);
}
