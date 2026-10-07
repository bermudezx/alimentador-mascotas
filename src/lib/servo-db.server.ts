import { getSql } from "@/lib/db";
import type { ActionKind, Direction, HistoryItem, PanelSnapshot } from "@/lib/servo-types";

export type { ActionKind, Direction, HistoryItem, PanelSnapshot };

type DeviceRow = {
  running: boolean;
  speed: number;
  direction: string;
  auto_stop_sec: number;
  run_started_ms: number | null;
  ssid: string;
  ip: string;
  voltage: string;
  device_label: string;
  board_seen_ms: number | null;
};

const BOARD_TTL_MS = 12_000;

function asDirection(value: string): Direction {
  return value === "ccw" ? "ccw" : "cw";
}

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[^\w .:_-]/g, "").slice(0, max);
}

async function expireAutoStop() {
  const sql = await getSql();
  await sql`
    with stopped as (
      update servo_device
      set running = false, run_started_at = null, updated_at = now()
      where id = 1
        and running
        and auto_stop_sec > 0
        and run_started_at is not null
        and extract(epoch from (now() - run_started_at)) >= auto_stop_sec
      returning id
    )
    insert into servo_actions (kind, label)
    select 'off', 'Servo apagado' from stopped
  `;
}

export async function readPanel(): Promise<PanelSnapshot> {
  await expireAutoStop();
  const sql = await getSql();
  const [device] = await sql<DeviceRow>`
    select
      running,
      speed,
      direction,
      auto_stop_sec,
      case when run_started_at is null then null
        else (extract(epoch from run_started_at) * 1000)::bigint end as run_started_ms,
      ssid,
      ip,
      voltage,
      device_label,
      case when board_seen_at is null then null
        else (extract(epoch from board_seen_at) * 1000)::bigint end as board_seen_ms
    from servo_device
    where id = 1
  `;
  const actions = await sql<{ id: number; kind: string; label: string; at_ms: number }>`
    select id, kind, label, (extract(epoch from at) * 1000)::bigint as at_ms
    from servo_actions
    order by at desc, id desc
    limit 40
  `;
  const boardSeenAt = device?.board_seen_ms ? Number(device.board_seen_ms) : null;
  return {
    boardOnline: boardSeenAt != null && Date.now() - boardSeenAt < BOARD_TTL_MS,
    running: Boolean(device?.running),
    speed: Number(device?.speed ?? 100),
    direction: asDirection(device?.direction ?? "cw"),
    autoStopSec: Number(device?.auto_stop_sec ?? 0),
    runStartedAt: device?.run_started_ms ? Number(device.run_started_ms) : null,
    ssid: device?.ssid || "Casa_Felipe",
    ip: device?.ip || "192.168.1.25",
    voltage: device?.voltage || "5.0 V",
    deviceLabel: device?.device_label || "ESP32 + SG5010",
    boardSeenAt,
    history: actions.map((row) => ({
      id: String(row.id),
      kind: row.kind === "off" ? "off" : "on",
      label: row.label,
      at: Number(row.at_ms),
    })),
  };
}

export async function commandPower(action: ActionKind): Promise<PanelSnapshot> {
  const sql = await getSql();
  if (action === "on") {
    const updated = await sql<{ id: number }>`
      update servo_device
      set running = true, run_started_at = now(), updated_at = now()
      where id = 1 and running = false
      returning id
    `;
    if (updated.length) {
      await sql`insert into servo_actions (kind, label) values ('on', 'Servo encendido')`;
    }
  } else {
    const updated = await sql<{ id: number }>`
      update servo_device
      set running = false, run_started_at = null, updated_at = now()
      where id = 1 and running = true
      returning id
    `;
    if (updated.length) {
      await sql`insert into servo_actions (kind, label) values ('off', 'Servo apagado')`;
    }
  }
  return readPanel();
}

export async function commandSpeed(speed: number): Promise<PanelSnapshot> {
  const sql = await getSql();
  const next = Math.min(100, Math.max(0, Math.round(speed)));
  await sql`update servo_device set speed = ${next}, updated_at = now() where id = 1`;
  return readPanel();
}

export async function commandConfig(input: {
  direction?: Direction;
  autoStopSec?: number;
}): Promise<PanelSnapshot> {
  const sql = await getSql();
  if (input.direction) {
    await sql`update servo_device set direction = ${input.direction}, updated_at = now() where id = 1`;
  }
  if (input.autoStopSec != null) {
    const seconds = [0, 5, 10, 30, 60].includes(input.autoStopSec) ? input.autoStopSec : 0;
    await sql`update servo_device set auto_stop_sec = ${seconds}, updated_at = now() where id = 1`;
  }
  return readPanel();
}

export async function boardCheckIn(body: {
  ssid?: unknown;
  ip?: unknown;
  voltage?: unknown;
}): Promise<PanelSnapshot> {
  const sql = await getSql();
  const ssid = clean(body.ssid, 32);
  const ip = clean(body.ip, 40);
  const voltage = clean(body.voltage, 16);
  await sql`
    update servo_device
    set
      board_seen_at = now(),
      ssid = case when ${ssid} = '' then ssid else ${ssid} end,
      ip = case when ${ip} = '' then ip else ${ip} end,
      voltage = case when ${voltage} = '' then voltage else ${voltage} end,
      updated_at = now()
    where id = 1
  `;
  return readPanel();
}
