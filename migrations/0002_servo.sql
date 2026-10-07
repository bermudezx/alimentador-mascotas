create table if not exists servo_device (
  id int primary key,
  running boolean not null default false,
  speed int not null default 100,
  direction text not null default 'cw',
  auto_stop_sec int not null default 0,
  run_started_at timestamptz,
  ssid text not null default 'Casa_Felipe',
  ip text not null default '192.168.1.25',
  voltage text not null default '5.0 V',
  device_label text not null default 'ESP32 + SG5010',
  board_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint servo_device_singleton check (id = 1)
);

insert into servo_device (id)
values (1)
on conflict (id) do nothing;

create table if not exists servo_actions (
  id bigserial primary key,
  kind text not null,
  label text not null,
  at timestamptz not null default now()
);

insert into servo_actions (kind, label, at)
select kind, label, at
from (
  values
    ('on'::text, 'Servo encendido'::text, timestamptz '2026-10-01 15:20:00+00'),
    ('off', 'Servo apagado', timestamptz '2026-10-01 15:15:00+00'),
    ('on', 'Servo encendido', timestamptz '2026-10-01 14:42:00+00'),
    ('off', 'Servo apagado', timestamptz '2026-10-01 14:37:00+00'),
    ('on', 'Servo encendido', timestamptz '2026-10-01 13:11:00+00')
) as seed(kind, label, at)
where not exists (select 1 from servo_actions);
