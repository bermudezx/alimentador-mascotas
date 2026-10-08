import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  getMqttStatus,
  publishServo,
  subscribeMqttStatus,
} from "@/lib/mqtt-link";
import type { Direction, HistoryItem } from "@/lib/servo-types";

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

  applyMqttState: (state: string) => void;
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

function addHistory(
  history: HistoryItem[],
  kind: "on" | "off"
): HistoryItem[] {
  const now = Date.now();

  const item: HistoryItem = {
    id: `${kind}-${now}`,
    kind,
    label: kind === "on" ? "Servo encendido" : "Servo apagado",
    at: now,
  };

  return [item, ...history].slice(0, 100);
}

function mqttOnline() {
  return getMqttStatus() === "on";
}

export const useServoStore = create<ServoState>()(
  persist(
    (set, get) => ({
      online: false,
      boardOnline: false,

      running: false,
      speed: 100,
      runStartedAt: null,

      history: SEED_HISTORY,

      ssid: "",
      ip: "",
      voltage: "5.0 V",

      deviceLabel: "ESP32 + SG5010",

      direction: "cw",
      autoStopSec: 0,
      confirmStart: false,

      boardSeenAt: null,

      applyMqttState: (state) => {
        const connected = mqttOnline();

        if (state === "ON") {
          set({
            online: connected,
            boardOnline: true,
            running: true,
            runStartedAt: get().runStartedAt ?? Date.now(),
            boardSeenAt: Date.now(),
          });
        } else if (state === "OFF") {
          set({
            online: connected,
            boardOnline: true,
            running: false,
            runStartedAt: null,
            boardSeenAt: Date.now(),
          });
        }
      },

      markOffline: () => {
        set({
          online: false,
          boardOnline: false,
        });
      },

      refresh: async () => {
        const connected = mqttOnline();

        set({
          online: connected,
        });
      },

      turnOn: async () => {
        const state = get();

        if (!mqttOnline() || state.running) {
          return false;
        }

        const ok = publishServo({
          running: true,
          speed: state.speed,
          direction: state.direction,
          autoStopSec: state.autoStopSec,
        });

        if (!ok) {
          return false;
        }

        set({
          online: true,
          boardOnline: true,
          running: true,
          runStartedAt: Date.now(),
          boardSeenAt: Date.now(),
          history: addHistory(state.history, "on"),
        });

        return true;
      },

      turnOff: async () => {
        const state = get();

        if (!state.running) {
          return false;
        }

        const ok = publishServo({
          running: false,
          speed: state.speed,
          direction: state.direction,
          autoStopSec: state.autoStopSec,
        });

        if (!ok) {
          return false;
        }

        set({
          online: true,
          boardOnline: true,
          running: false,
          runStartedAt: null,
          boardSeenAt: Date.now(),
          history: addHistory(state.history, "off"),
        });

        return true;
      },

      setSpeed: (value) => {
        set({
          speed: Math.min(100, Math.max(0, Math.round(value))),
        });
      },

      pushSpeed: async (value) => {
        const state = get();

        set({
          speed: Math.min(100, Math.max(0, Math.round(value))),
        });

        if (state.running) {
          publishServo({
            running: true,
            speed: value,
            direction: state.direction,
            autoStopSec: state.autoStopSec,
          });
        }
      },

      setDirection: async (value) => {
        set({
          direction: value,
        });

        const state = get();

        if (state.running) {
          publishServo({
            running: true,
            speed: state.speed,
            direction: value,
            autoStopSec: state.autoStopSec,
          });
        }
      },

      setAutoStopSec: async (value) => {
        set({
          autoStopSec: value,
        });
      },

      setConfirmStart: (value) => {
        set({
          confirmStart: value,
        });
      },
    }),
    {
      name: "mi-servo",

      storage: createJSONStorage(() => localStorage),

      skipHydration: true,

      partialize: (state) => ({
        confirmStart: state.confirmStart,
      }),
    }
  )
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