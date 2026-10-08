import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Clock,
  Cpu,
  Gauge,
  Globe,
  House,
  Info,
  Play,
  Radio,
  Scan,
  Settings,
  Square,
  Timer,
  UserRound,
  Wifi,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  cmdTopic,
  connectMqtt,
  getMqttStatus,
  loadMqttConfig,
  MQTT_DEFAULTS,
  saveMqttConfig,
  stateTopic,
  subscribeMqttStatus,
  type MqttConfig,
} from "@/lib/mqtt-link";
import {
  formatClock,
  formatDay,
  formatHMS,
  formatStamp,
  useServoStore,
  type Direction,
  type HistoryItem,
} from "@/lib/servo-store";

type Tab = "inicio" | "ajustes" | "historial" | "informacion";

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: "inicio", label: "Inicio", icon: House },
  { id: "ajustes", label: "Ajustes", icon: Settings },
  { id: "historial", label: "Historial", icon: Clock },
  { id: "informacion", label: "Información", icon: Info },
];

const AUTO_STOP = [0, 5, 10, 30, 60];

export function ServoApp() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [toast, setToast] = useState("");
  const [askOn, setAskOn] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const running = useServoStore((s) => s.running);
  const runStartedAt = useServoStore((s) => s.runStartedAt);
  const autoStopSec = useServoStore((s) => s.autoStopSec);
  const turnOff = useServoStore((s) => s.turnOff);
  const refresh = useServoStore((s) => s.refresh);

 useEffect(() => {
  void useServoStore.persist.rehydrate();

  setEndpoint("");

  void connectMqtt((state) => {
    useServoStore.getState().applyMqttState(state);
  });
}, []);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    const onOffline = () => useServoStore.getState().markOffline();
    const onOnline = () => void refresh();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  useEffect(() => {
    if (!running || !runStartedAt || autoStopSec <= 0) return;
    const id = window.setTimeout(() => turnOff(), autoStopSec * 1000);
    return () => window.clearTimeout(id);
  }, [running, runStartedAt, autoStopSec, turnOff]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 1600);
    return () => window.clearTimeout(id);
  }, [toast]);

  function notify(message: string) {
    setToast(message);
  }

  function requestOn() {
    const state = useServoStore.getState();
    if (!state.online) {
      notify("Sin internet");
      return;
    }
    if (state.running) return;
    if (state.confirmStart) {
      setAskOn(true);
      return;
    }
    void state.turnOn().then((ok) => notify(ok ? "Servo encendido" : "No se pudo enviar"));
  }

  function requestOff() {
    const state = useServoStore.getState();
    if (!state.running) {
      notify("El servo ya está detenido");
      return;
    }
    void state.turnOff().then((ok) => notify(ok ? "Servo apagado" : "No se pudo enviar"));
  }

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto w-full max-w-lg px-3 pb-8 lg:max-w-6xl lg:px-6">
        <TabBar tab={tab} onChange={setTab} />
        {tab === "inicio" ? (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <ControlPanel onStart={requestOn} onStop={requestOff} />
            <StatusPanel onHistory={() => setTab("historial")} onInfo={() => setTab("informacion")} />
          </div>
        ) : null}
        {tab === "ajustes" ? (
          <div className="mx-auto max-w-lg">
            <SettingsPanel endpoint={endpoint} notify={notify} />
          </div>
        ) : null}
        {tab === "historial" ? (
          <div className="mx-auto max-w-lg">
            <HistoryPanel />
          </div>
        ) : null}
        {tab === "informacion" ? (
          <div className="mx-auto max-w-lg">
            <InfoPanel endpoint={endpoint} />
          </div>
        ) : null}
      </div>

      <p className={cn("toast", toast && "toast-on")} role="status">
        {toast}
      </p>

      {askOn ? (
        <ConfirmDialog
          title="¿Encender el servo?"
          body={`Girará al ${useServoStore.getState().speed}% en sentido ${
            useServoStore.getState().direction === "cw" ? "horario" : "antihorario"
          }.`}
          confirmLabel="Encender"
          danger={false}
          onCancel={() => setAskOn(false)}
          onConfirm={() => {
            setAskOn(false);
            useServoStore.getState().turnOn().then((ok) => notify(ok ? "Servo encendido" : "No se pudo enviar"));
          }}
        />
      ) : null}
    </main>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="sticky top-0 z-20 -mx-3 mb-3 grid grid-cols-4 border-b border-line bg-bg/95 px-1 backdrop-blur lg:-mx-6 lg:px-4" aria-label="Secciones">
      {TABS.map((item) => {
        const Icon = item.icon;
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted",
              active && "tab-on",
            )}
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(item.id)}
          >
            <Icon className="size-5" strokeWidth={2} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function ControlPanel({ onStart, onStop }: { onStart: () => void; onStop: () => void }) {
  const online = useServoStore((s) => s.online);
  const boardOnline = useServoStore((s) => s.boardOnline);
  const running = useServoStore((s) => s.running);
  const speed = useServoStore((s) => s.speed);
  const ssid = useServoStore((s) => s.ssid);
  const ip = useServoStore((s) => s.ip);
  const voltage = useServoStore((s) => s.voltage);
  const setSpeed = useServoStore((s) => s.setSpeed);
  const pushSpeed = useServoStore((s) => s.pushSpeed);
  const spinning = running && speed > 0;
  const speedTimer = useState<number | null>(null);

  return (
    <section className="flex flex-col gap-3" aria-label="Control remoto">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="gear-badge" aria-hidden="true">
            <Settings className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ESP32 - Servo</h1>
            <p className="text-sm text-muted">Control remoto</p>
          </div>
        </div>
        <div className="text-right">
          <ConnectionPill connected={online} icon />
          <p className="mt-1.5 text-xs text-muted">{ip}</p>
        </div>
      </header>

      <div className="grid grid-cols-[1.15fr_0.85fr] gap-2.5">
        <ServoStage spinning={spinning} />
        <div className="flex flex-col gap-2">
          <MiniStat
            icon={<Wifi className="size-4" />}
            label="Estado ESP32"
            value={boardLabel(online, boardOnline)}
            ok={boardOnline}
          />
          <MiniStat icon={<Settings className="size-4" />} label="Estado del servo" value={servoLabel(running, speed)} ok={spinning} />
          <MiniStat icon={<Clock className="size-4" />} label="Tiempo activo" value={<Uptime />} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" className="btn-power btn-on" onClick={onStart} disabled={!online || running}>
          <Play className="mb-1 size-6 fill-current" />
          ENCENDER
          <small>Girar servo</small>
        </button>
        <button type="button" className="btn-power btn-off" onClick={onStop} disabled={!running}>
          <Square className="mb-1 size-5 fill-current" />
          APAGAR
          <small>Detener servo</small>
        </button>
      </div>

      <section className="panel px-4 py-3.5">
        <h2 className="text-base font-semibold">Control manual</h2>
        <label className="mt-3 flex items-center gap-3 text-sm text-muted">
          <Gauge className="size-4 shrink-0" />
          <span>Velocidad</span>
          <input
            className="speed"
            type="range"
            min={0}
            max={100}
            value={speed}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={speed}
            aria-label="Velocidad"
            style={{ ["--pct" as string]: `${speed}%` }}
            onChange={(event) => {
              const value = Number(event.target.value);
              setSpeed(value);
              if (speedTimer[0]) window.clearTimeout(speedTimer[0]);
              speedTimer[1](window.setTimeout(() => void pushSpeed(value), 250));
            }}
          />
          <span className="w-12 text-right text-fg">{speed} %</span>
        </label>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <Tile
          icon={<Cpu className="size-5" />}
          label="ESP32"
          value={boardLabel(online, boardOnline)}
          tone={boardOnline ? "ok" : online ? "primary" : "stop"}
        />
        <Tile icon={<Wifi className="size-5" />} label="Wi-Fi" value={ssid || "—"} tone="primary" />
        <Tile icon={<Zap className="size-5" />} label="Alimentación" value={voltage} tone="primary" />
      </div>
    </section>
  );
}

function ServoStage({ spinning }: { spinning: boolean }) {
  const direction = useServoStore((s) => s.direction);
  const speed = useServoStore((s) => s.speed);
  const seconds = Math.max(0.45, 2.1 - (speed / 100) * 1.6).toFixed(2);

  return (
    <div className="panel relative min-h-56 overflow-hidden">
      <img
        src="/servo-sg5010.jpg"
        alt="Servo SG5010 de rotación continua"
        className="servo-photo"
      />
      <div className="servo-glow pointer-events-none absolute inset-0 z-10" />
      <svg
        viewBox="0 0 200 200"
        className="pointer-events-none absolute inset-3 z-20 text-sky"
        aria-hidden="true"
      >
        <g
          className={cn("spin-arc", spinning && direction === "ccw" && "spin-ccw")}
          style={spinning ? { ["--spin" as string]: `${seconds}s` } : { animation: "none" }}
        >
          <path
            d="M46 124c-8-22-2-48 24-64"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <path d="M70 58l8 2-6 8" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M154 62c14 16 12 42-12 58"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <path d="M140 122l2-8 8 4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  ok,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  ok?: boolean;
}) {
  return (
    <div className="panel flex flex-1 items-center gap-2 px-2.5 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-tile text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <strong className={cn("block text-sm font-semibold", ok && "text-ok-text")}>{value}</strong>
      </span>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "ok" | "stop" | "primary";
}) {
  return (
    <div className="panel flex flex-col items-center px-2 py-3 text-center">
      <span className="text-muted">{icon}</span>
      <span className="mt-1 text-xs text-muted">{label}</span>
      <strong
        className={cn(
          "mt-0.5 max-w-full truncate text-sm font-bold",
          tone === "ok" && "text-ok-text",
          tone === "stop" && "text-stop-text",
          tone === "primary" && "text-primary-2",
        )}
      >
        {value}
      </strong>
    </div>
  );
}

function StatusPanel({ onHistory, onInfo }: { onHistory: () => void; onInfo: () => void }) {
  const online = useServoStore((s) => s.online);
  const boardOnline = useServoStore((s) => s.boardOnline);
  const running = useServoStore((s) => s.running);
  const speed = useServoStore((s) => s.speed);
  const ssid = useServoStore((s) => s.ssid);
  const ip = useServoStore((s) => s.ip);
  const deviceLabel = useServoStore((s) => s.deviceLabel);
  const history = useServoStore((s) => s.history);
  const last = history[0];
  const mqttStatus = useMqttStatus();

  return (
    <section className="flex flex-col gap-3" aria-label="Estado del sistema">
      <article className="panel px-4 py-3">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Estado del sistema</h2>
          <ConnectionPill connected={online} />
        </div>
        <StatusRow icon={<Globe className="size-4" />} label="Internet" value={online ? "Conectado" : "Sin conexión"} />
        <StatusRow icon={<Radio className="size-4" />} label="MQTT" value={mqttLabel(mqttStatus)} />
        <StatusRow icon={<Cpu className="size-4" />} label="ESP32" value={boardLabel(online, boardOnline)} />
        <StatusRow icon={<Wifi className="size-4" />} label="Wi-Fi" value={ssid || "—"} />
        <StatusRow icon={<IpMark />} label="Dirección IP" value={ip || "—"} />
        <StatusRow icon={<Settings className="size-4" />} label="Estado del servo" value={servoLabel(running, speed)} />
        <StatusRow icon={<Clock className="size-4" />} label="Última acción" value={last ? formatStamp(last.at) : "—"} />
        <StatusRow icon={<Timer className="size-4" />} label="Tiempo activo" value={<Uptime />} />
      </article>

      <article className="panel px-4 py-3">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Historial de acciones</h2>
          <button type="button" className="text-sm font-semibold text-primary" onClick={onHistory}>
            Ver todo
          </button>
        </div>
        {history.length === 0 ? (
          <p className="py-4 text-sm text-muted">Todavía no hay acciones.</p>
        ) : (
          history.slice(0, 5).map((item) => <HistoryRow key={item.id} item={item} />)
        )}
      </article>

      <article className="panel px-4 py-3">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <UserRound className="size-5 text-primary-2" />
          Información del dispositivo
        </h2>
        <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-tile px-3 py-3 text-left" onClick={onInfo}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/30 text-primary">
            <Scan className="size-5" />
          </span>
          <span>
            <strong className="block font-semibold">{deviceLabel}</strong>
            <span className="text-sm text-muted">Control remoto de servo de rotación continua</span>
          </span>
        </button>
      </article>
    </section>
  );
}

function SettingsPanel({ endpoint, notify }: { endpoint: string; notify: (message: string) => void }) {
  const online = useServoStore((s) => s.online);
  const boardOnline = useServoStore((s) => s.boardOnline);
  const boardSeenAt = useServoStore((s) => s.boardSeenAt);
  const direction = useServoStore((s) => s.direction);
  const autoStopSec = useServoStore((s) => s.autoStopSec);
  const confirmStart = useServoStore((s) => s.confirmStart);
  const setDirection = useServoStore((s) => s.setDirection);
  const setAutoStopSec = useServoStore((s) => s.setAutoStopSec);
  const setConfirmStart = useServoStore((s) => s.setConfirmStart);
  const mqttStatus = useMqttStatus();
  const [mqtt, setMqtt] = useState<MqttConfig>(MQTT_DEFAULTS);

  useEffect(() => {
    setMqtt(loadMqttConfig());
  }, []);

  function patch(partial: Partial<MqttConfig>) {
    const next = saveMqttConfig({ ...mqtt, ...partial });
    setMqtt(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Ajustes</h1>
      <section className="panel px-4 py-2">
        <StatusRow icon={<Globe className="size-4" />} label="Internet" value={online ? "Conectado" : "Sin conexión"} />
        <StatusRow icon={<Radio className="size-4" />} label="MQTT" value={mqttLabel(mqttStatus)} />
        <StatusRow icon={<Cpu className="size-4" />} label="Placa ESP32" value={boardLabel(online, boardOnline)} />
        <StatusRow icon={<Clock className="size-4" />} label="Última señal" value={boardSeenAt ? formatStamp(boardSeenAt) : "Esperando placa"} />
      </section>

      <section className="panel px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">MQTT</h2>
          <Toggle on={mqtt.enabled} label="MQTT activo" onClick={() => patch({ enabled: !mqtt.enabled })} />
        </div>
        <p className="mt-1 text-sm text-muted">
          El panel publica en el broker y la ESP32, en el puerto TCP, aplica la orden al momento.
        </p>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm text-muted">WebSocket del broker</span>
          <input className="field" value={mqtt.url} onChange={(event) => setMqtt({ ...mqtt, url: event.target.value })} onBlur={() => patch({ url: mqtt.url })} />
        </label>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <label className="col-span-3 block">
            <span className="mb-1.5 block text-sm text-muted">Host TCP de la placa</span>
            <input className="field" value={mqtt.tcpHost} onChange={(event) => setMqtt({ ...mqtt, tcpHost: event.target.value })} onBlur={() => patch({ tcpHost: mqtt.tcpHost })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">Puerto</span>
            <input
              className="field"
              inputMode="numeric"
              value={String(mqtt.tcpPort)}
              onChange={(event) => setMqtt({ ...mqtt, tcpPort: Number(event.target.value.replace(/\D/g, "").slice(0, 5)) || 0 })}
              onBlur={() => patch({ tcpPort: mqtt.tcpPort || 1883 })}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm text-muted">Tema base</span>
          <input className="field" value={mqtt.topic} onChange={(event) => setMqtt({ ...mqtt, topic: event.target.value })} onBlur={() => patch({ topic: mqtt.topic })} />
        </label>
        <p className="mt-2 text-sm text-muted">Orden: {cmdTopic(mqtt)}</p>
        <p className="text-sm text-muted">Estado: {stateTopic(mqtt)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">Usuario</span>
            <input className="field" autoComplete="off" value={mqtt.username} onChange={(event) => setMqtt({ ...mqtt, username: event.target.value })} onBlur={() => patch({ username: mqtt.username })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">Clave</span>
            <input className="field" type="password" autoComplete="off" value={mqtt.password} onChange={(event) => setMqtt({ ...mqtt, password: event.target.value })} onBlur={() => patch({ password: mqtt.password })} />
          </label>
        </div>
      </section>

      <section className="panel px-4 py-4">
        <h2 className="text-base font-semibold">Enlace de la placa</h2>
        <p className="mt-1 text-sm text-muted">La ESP32, ya en Wi-Fi, consulta esta dirección por internet y aplica encendido, velocidad y sentido.</p>
        <p className="mt-3 break-all rounded-xl bg-tile px-3 py-3 text-sm">{endpoint || "…"}</p>
        <button
          type="button"
          className="seg mt-3 w-full"
          onClick={() => {
            if (!endpoint) return;
            void navigator.clipboard?.writeText(endpoint).then(
              () => notify("Enlace copiado"),
              () => notify("No se pudo copiar"),
            );
          }}
        >
          Copiar enlace
        </button>
      </section>

      <section className="panel px-4 py-3">
        <SettingRow label="Confirmar al encender" hint="Pide confirmación antes de girar">
          <Toggle on={confirmStart} label="Confirmar al encender" onClick={() => setConfirmStart(!confirmStart)} />
        </SettingRow>
      </section>

      <section className="panel px-4 py-4">
        <h2 className="text-base font-semibold">Sentido de giro</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <DirectionButton current={direction} value="cw" onPick={(value) => void setDirection(value)}>
            Horario
          </DirectionButton>
          <DirectionButton current={direction} value="ccw" onPick={(value) => void setDirection(value)}>
            Antihorario
          </DirectionButton>
        </div>
        <h2 className="mt-5 text-base font-semibold">Parada automática</h2>
        <p className="mt-1 text-sm text-muted">Apaga el servo solo, aunque cierres esta pantalla.</p>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {AUTO_STOP.map((seconds) => (
            <button
              key={seconds}
              type="button"
              className={cn("seg text-sm", autoStopSec === seconds && "seg-on")}
              onClick={() => void setAutoStopSec(seconds)}
            >
              {seconds === 0 ? "Off" : `${seconds}s`}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function useMqttStatus() {
  return useSyncExternalStore(subscribeMqttStatus, getMqttStatus, () => "off" as const);
}

function mqttLabel(status: ReturnType<typeof getMqttStatus>) {
  if (status === "on") return "Conectado";
  if (status === "connecting") return "Conectando";
  if (status === "error") return "Error";
  return "Apagado";
}

function HistoryPanel() {
  const history = useServoStore((s) => s.history);
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const shown = history.filter((item) => filter === "all" || item.kind === filter);
  let lastDay = "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Historial</h1>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["all", "Todas"],
            ["on", "Encendido"],
            ["off", "Apagado"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={cn("seg text-sm", filter === id && "seg-on")} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <article className="panel px-4 py-2">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No hay acciones con este filtro.</p>
        ) : (
          shown.map((item) => {
            const day = formatDay(item.at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={item.id}>
                {showDay ? <p className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{day}</p> : null}
                <HistoryRow item={item} />
              </div>
            );
          })
        )}
      </article>
    </div>
  );
}

function InfoPanel({ endpoint }: { endpoint: string }) {
  const ssid = useServoStore((s) => s.ssid);
  const ip = useServoStore((s) => s.ip);
  const voltage = useServoStore((s) => s.voltage);
  const deviceLabel = useServoStore((s) => s.deviceLabel);
  const direction = useServoStore((s) => s.direction);
  const boardOnline = useServoStore((s) => s.boardOnline);
  const online = useServoStore((s) => s.online);

  const rows = [
    ["Modelo", "SG5010"],
    ["Controlador", "ESP32"],
    ["Tipo", "Rotación continua"],
    ["Señal", "PWM 50 Hz"],
    ["Pulso de parada", "1500 µs"],
    ["Rango de giro", "1000–2000 µs"],
    ["Alimentación", voltage],
    ["Internet", online ? "Conectado" : "Sin conexión"],
    ["Placa", boardLabel(online, boardOnline)],
    ["Pin de señal", "GPIO 18"],
    ["Sentido actual", direction === "cw" ? "Horario" : "Antihorario"],
    ["Red Wi-Fi", ssid || "—"],
    ["Dirección IP", ip || "—"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Información</h1>
      <article className="panel px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl border border-primary/30 text-primary">
            <Scan className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">{deviceLabel}</h2>
            <p className="text-sm text-muted">Control remoto de servo de rotación continua</p>
          </div>
        </div>
      </article>
      <article className="panel px-4 py-2">
        {rows.map(([label, value]) => (
          <StatusRow key={label} icon={null} label={label} value={value} />
        ))}
      </article>
      <p className="px-1 text-sm leading-relaxed text-muted">
        Encender guarda la orden en internet. La ESP32, conectada a Wi-Fi, la lee en {endpoint || "/api/device"} y mueve el SG5010. Apagar vuelve al pulso de parada de 1500 µs.
      </p>
    </div>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2.5">
        <span className={cn("size-2 rounded-full", item.kind === "on" ? "bg-ok" : "bg-stop")} />
        {item.label}
      </span>
      <span className="text-sm text-muted">{formatClock(item.at)}</span>
    </div>
  );
}

function StatusRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <span className="flex items-center gap-3">
        {icon ? <span className="text-muted">{icon}</span> : null}
        {label}
      </span>
      <span className="text-right text-muted">{value}</span>
    </div>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="text-sm text-muted">{hint}</span>
      </span>
      {children}
    </div>
  );
}

function DirectionButton({
  current,
  value,
  onPick,
  children,
}: {
  current: Direction;
  value: Direction;
  onPick: (value: Direction) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={cn("seg", current === value && "seg-on")} onClick={() => onPick(value)}>
      {children}
    </button>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} onClick={onClick}>
      <span />
    </button>
  );
}

function ConnectionPill({ connected, icon }: { connected: boolean; icon?: boolean }) {
  return (
    <span className={cn("pill", !connected && "pill-bad")}>
      {icon ? <Wifi className="size-3.5" /> : <span className={cn("size-2 rounded-full", connected ? "bg-ok" : "bg-stop")} />}
      {connected ? "Conectado" : "Desconectado"}
    </span>
  );
}

function IpMark() {
  return (
    <span className="grid h-5 w-5 place-items-center rounded-md bg-tile text-xs font-bold tracking-tight text-muted">
      IP
    </span>
  );
}

function Uptime() {
  const running = useServoStore((s) => s.running);
  const runStartedAt = useServoStore((s) => s.runStartedAt);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running || !runStartedAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running, runStartedAt]);

  const elapsed = running && runStartedAt && now ? now - runStartedAt : 0;
  return <span className="tabular-nums">{formatHMS(elapsed)}</span>;
}

function servoLabel(running: boolean, speed: number) {
  if (running && speed > 0) return "Girando";
  if (running) return "Sin velocidad";
  return "Detenido";
}

function boardLabel(online: boolean, boardOnline: boolean) {
  if (!online) return "Offline";
  return boardOnline ? "Online" : "En espera";
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-bg/70 px-6" role="presentation" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="panel w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="seg" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className={cn("btn-power min-h-11", danger ? "btn-off" : "btn-on")} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
