import mqtt, { type MqttClient } from "mqtt";

export type MqttConfig = {
  enabled: boolean;
  url: string;
  tcpHost: string;
  tcpPort: number;
  topic: string;
  username: string;
  password: string;
};

export type ServoCommand = {
  running: boolean;
  speed: number;
  direction: "cw" | "ccw";
  autoStopSec: number;
};

export type MqttLinkStatus = "off" | "connecting" | "on" | "error";

export const MQTT_DEFAULTS: MqttConfig = {
  enabled: true,
  url: "wss://broker.emqx.io:8084/mqtt",
  tcpHost: "broker.emqx.io",
  tcpPort: 1883,
  topic: "alimentador-mascotas-felipe/servo",
  username: "",
  password: "",
};

const STORAGE_KEY = "mi-servo-mqtt";

type Listener = () => void;
type BoardStateListener = (state: string) => void;

const listeners = new Set<Listener>();

let status: MqttLinkStatus = "off";
let client: MqttClient | null = null;
let activeKey = "";
let onBoardState: BoardStateListener | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setStatus(next: MqttLinkStatus) {
  if (status === next) return;
  status = next;
  emit();
}

export function loadMqttConfig(): MqttConfig {
  if (typeof localStorage === "undefined") {
    return MQTT_DEFAULTS;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return MQTT_DEFAULTS;
    }

    const parsed = JSON.parse(raw) as Partial<MqttConfig>;

    return {
      enabled: parsed.enabled !== false,
      url:
        typeof parsed.url === "string" && parsed.url
          ? parsed.url
          : MQTT_DEFAULTS.url,
      tcpHost:
        typeof parsed.tcpHost === "string" && parsed.tcpHost
          ? parsed.tcpHost
          : MQTT_DEFAULTS.tcpHost,
      tcpPort: Number(parsed.tcpPort) || MQTT_DEFAULTS.tcpPort,
      topic: sanitizeTopic(parsed.topic || MQTT_DEFAULTS.topic),
      username:
        typeof parsed.username === "string"
          ? parsed.username.slice(0, 64)
          : "",
      password:
        typeof parsed.password === "string"
          ? parsed.password.slice(0, 64)
          : "",
    };
  } catch {
    return MQTT_DEFAULTS;
  }
}

export function saveMqttConfig(config: MqttConfig) {
  const next = {
    ...config,
    topic: sanitizeTopic(config.topic),
    tcpPort: Number(config.tcpPort) || 1883,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

  void connectMqtt(onBoardState ?? undefined);

  return next;
}

export function sanitizeTopic(value: string) {
  const cleaned = value
    .replace(/[^\w./-]/g, "")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 64);

  return cleaned || MQTT_DEFAULTS.topic;
}

export function cmdTopic(config = loadMqttConfig()) {
  return `${config.topic}/cmd`;
}

export function stateTopic(config = loadMqttConfig()) {
  return `${config.topic}/state`;
}

export function getMqttStatus() {
  return status;
}

export function subscribeMqttStatus(listener: Listener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function publishServo(command: ServoCommand) {
  const config = loadMqttConfig();

  if (!config.enabled || !client?.connected) {
    return false;
  }

  // El ESP32 espera directamente "ON" o "OFF".
  const message = command.running ? "ON" : "OFF";

  client.publish(cmdTopic(config), message, {
    qos: 0,
  });

  return true;
}

export async function connectMqtt(
  onState?: (state: string) => void,
) {
  if (onState) {
    onBoardState = onState;
  }

  if (typeof window === "undefined") {
    return;
  }

  const config = loadMqttConfig();

  if (!config.enabled) {
    client?.end(true);
    client = null;
    activeKey = "";
    setStatus("off");
    return;
  }

  const key = `${config.url}|${config.topic}|${config.username}`;

  if (client && activeKey === key) {
    return;
  }

  client?.end(true);
  client = null;

  activeKey = key;
  setStatus("connecting");

  const next = mqtt.connect(config.url, {
    clientId: `panel-${Math.random().toString(16).slice(2, 10)}`,
    username: config.username || undefined,
    password: config.password || undefined,
    keepalive: 30,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    clean: true,
  });

  client = next;

  next.on("connect", () => {
    if (client !== next) return;

    setStatus("on");

    next.subscribe(stateTopic(config), {
      qos: 0,
    });
  });

  next.on("close", () => {
    if (client !== next) return;

    setStatus(
      loadMqttConfig().enabled
        ? "connecting"
        : "off",
    );
  });

  next.on("error", () => {
    if (client !== next) return;

    setStatus("error");
  });

  next.on("message", (_topic, payload) => {
    if (!onBoardState) return;

    const message = payload.toString().trim();

    // El ESP32 publica directamente "ON" o "OFF".
    if (message === "ON" || message === "OFF") {
      onBoardState(message);
      return;
    }

    // Compatibilidad por si otro dispositivo publica JSON.
    try {
      const body = JSON.parse(message) as {
        state?: string;
        running?: boolean;
      };

      if (body.state === "ON" || body.state === "OFF") {
        onBoardState(body.state);
        return;
      }

      if (typeof body.running === "boolean") {
        onBoardState(body.running ? "ON" : "OFF");
      }
    } catch {
      // Ignorar mensajes que no sean estados válidos.
    }
  });
}