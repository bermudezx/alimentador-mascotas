export type ActionKind = "on" | "off";
export type Direction = "cw" | "ccw";

export type HistoryItem = {
  id: string;
  kind: ActionKind;
  label: string;
  at: number;
};

export type PanelSnapshot = {
  boardOnline: boolean;
  running: boolean;
  speed: number;
  direction: Direction;
  autoStopSec: number;
  runStartedAt: number | null;
  ssid: string;
  ip: string;
  voltage: string;
  deviceLabel: string;
  boardSeenAt: number | null;
  history: HistoryItem[];
};
