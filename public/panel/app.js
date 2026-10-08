const $ = (id) => document.getElementById(id);

const zone = "America/Bogota";

let panel = null;
let filter = "all";
let speedTimer = 0;
let toastTimer = 0;
let mqttClient = null;
let mqttStatus = "connecting";

const STOPS = [0, 5, 10, 30, 60];

const MQTT_URL = "wss://broker.emqx.io:8084/mqtt";
const MQTT_CMD_TOPIC = "alimentador-mascotas-felipe/servo/cmd";
const MQTT_STATE_TOPIC = "alimentador-mascotas-felipe/servo/state";

const savedTopic = localStorage.getItem("alimentador-topic");

function toast(message) {
  const node = $("toast");
  if (!node) return;

  node.textContent = message;
  node.classList.add("toast-on");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => node.classList.remove("toast-on"),
    1600
  );
}

function clock(ms) {
  if (!ms) return "—";

  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  }).format(ms);
}

function stamp(ms) {
  if (!ms) return "—";

  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  }).format(ms);
}

function dayLabel(ms) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    timeZone: zone,
  }).format(ms);
}

function hms(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));

  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");

  return `${h}:${m}:${s}`;
}

function mqttLabel(value) {
  if (value === "on") return "Conectado";
  if (value === "connecting") return "Conectando";
  if (value === "error") return "Error";
  return "Apagado";
}

function boardLabel(data) {
  if (!data.online) return "Sin enlace";
  return data.boardOnline ? "En línea" : "En espera";
}

function servoLabel(data) {
  if (!data.running) return "Detenido";
  if (!data.speed) return "En pausa";

  return `Girando ${data.speed}%`;
}

function setText(id, value) {
  const node = $(id);

  if (node) {
    node.textContent = value;
  }
}

function showTab(name) {
  document.body.dataset.tab = name;

  document.querySelectorAll("[data-tab-btn]").forEach((button) => {
    const on = button.dataset.tabBtn === name;

    button.classList.toggle("tab-on", on);

    if (on) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function historyNodes(items, limit) {
  const box = document.createElement("div");

  const shown = items
    .filter(
      (item) => filter === "all" || item.kind === filter
    )
    .slice(0, limit || items.length);

  if (!shown.length) {
    const empty = document.createElement("p");

    empty.className = "empty muted";
    empty.textContent = "No hay acciones con este filtro.";

    box.append(empty);

    return box;
  }

  let lastDay = "";

  for (const item of shown) {
    const day = dayLabel(item.at);

    if (!limit && day !== lastDay) {
      lastDay = day;

      const title = document.createElement("p");

      title.className = "day";
      title.textContent = day;

      box.append(title);
    }

    const row = document.createElement("div");
    row.className = "hist";

    const left = document.createElement("span");

    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "0.6rem";

    const dot = document.createElement("i");

    dot.className =
      item.kind === "on"
        ? "dot dot-on"
        : "dot";

    const label = document.createElement("span");

    label.textContent = item.label;

    left.append(dot, label);

    const time = document.createElement("time");

    time.textContent = clock(item.at);

    row.append(left, time);

    box.append(row);
  }

  return box;
}

function createInitialPanel() {
  return {
    online: navigator.onLine,
    mqtt: mqttStatus,
    mqttEnabled: true,

    boardOnline: false,

    running: false,
    speed: 100,
    direction: "cw",
    autoStopSec: 0,

    ssid: "LEON",
    ip: "192.168.101.22",
    voltage: "5.0 V",

    deviceLabel: "ESP32 + SG5010",

    brokerUrl: MQTT_URL,
    tcpHost: "broker.emqx.io",
    tcpPort: 1883,

    topic: "alimentador-mascotas-felipe/servo",

    cmdTopic: MQTT_CMD_TOPIC,
    stateTopic: MQTT_STATE_TOPIC,

    username: "",
    history: [],

    boardSeenAt: null,
    runStartedAt: null,
  };
}

function paint() {
  if (!panel) return;

  panel.mqtt = mqttStatus;

  const online =
    navigator.onLine &&
    mqttStatus === "on";

  panel.online = online;

  const board = boardLabel({
    ...panel,
    online,
  });

  const servo = servoLabel(panel);

  const mqtt = mqttLabel(panel.mqtt);

  const net = online
    ? "Conectado"
    : "Sin conexión";

  const pillClass =
    online
      ? "pill"
      : "pill pill-bad";

  if ($("net-pill")) {
    $("net-pill").className = pillClass;
    $("net-pill").textContent =
      online ? "En línea" : "Sin red";
  }

  if ($("status-pill")) {
    $("status-pill").className = pillClass;
    $("status-pill").textContent =
      online ? "En línea" : "Sin red";
  }

  setText(
    "header-ip",
    panel.ip || "—"
  );

  setText("mini-board", board);
  setText("mini-servo", servo);
  setText("tile-board", board);

  setText(
    "tile-ssid",
    panel.ssid || "—"
  );

  setText(
    "tile-volt",
    panel.voltage || "5.0 V"
  );

  setText("row-net", net);
  setText("row-mqtt", mqtt);
  setText("row-board", board);

  setText(
    "row-ssid",
    panel.ssid || "—"
  );

  setText(
    "row-ip",
    panel.ip || "—"
  );

  setText("row-servo", servo);

  setText(
    "row-last",
    panel.history[0]
      ? stamp(panel.history[0].at)
      : "—"
  );

  setText("set-net", net);
  setText("set-mqtt", mqtt);
  setText("set-board", board);

  setText(
    "set-seen",
    panel.boardSeenAt
      ? stamp(panel.boardSeenAt)
      : "Esperando placa"
  );

  setText(
    "device-label",
    panel.deviceLabel
  );

  setText(
    "info-name",
    panel.deviceLabel
  );

  if ($("btn-on")) {
    $("btn-on").disabled =
      !online || panel.running;
  }

  if ($("btn-off")) {
    $("btn-off").disabled =
      !panel.running;
  }

  const speed = $("speed");

  if (speed) {
    if (document.activeElement !== speed) {
      speed.value = String(panel.speed);
    }

    speed.style.setProperty(
      "--pct",
      `${speed.value}%`
    );

    setText(
      "speed-label",
      `${speed.value} %`
    );
  }

  const spin = $("spin");

  if (spin && speed) {
    const turning =
      panel.running &&
      Number(speed.value) > 0;

    spin.classList.toggle(
      "spinning",
      turning
    );

    spin.classList.toggle(
      "spin-ccw",
      panel.direction === "ccw"
    );

    const seconds = Math.max(
      0.45,
      2.1 -
        (Number(speed.value) / 100) *
          1.6
    ).toFixed(2);

    spin.style.setProperty(
      "--spin",
      `${seconds}s`
    );
  }

  if ($("preview-history")) {
    $("preview-history").replaceChildren(
      historyNodes(panel.history, 4)
    );
  }

  if ($("history-list")) {
    $("history-list").replaceChildren(
      historyNodes(panel.history)
    );
  }

  if ($("dir-cw")) {
    $("dir-cw").classList.toggle(
      "seg-on",
      panel.direction !== "ccw"
    );
  }

  if ($("dir-ccw")) {
    $("dir-ccw").classList.toggle(
      "seg-on",
      panel.direction === "ccw"
    );
  }

  document
    .querySelectorAll("[data-stop]")
    .forEach((button) => {
      button.classList.toggle(
        "seg-on",
        Number(button.dataset.stop) ===
          panel.autoStopSec
      );
    });

  if ($("mqtt-toggle")) {
    $("mqtt-toggle").setAttribute(
      "aria-checked",
      "true"
    );
  }

  if ($("mqtt-url") &&
      document.activeElement !== $("mqtt-url")) {
    $("mqtt-url").value = MQTT_URL;
  }

  if ($("mqtt-host") &&
      document.activeElement !== $("mqtt-host")) {
    $("mqtt-host").value =
      "broker.emqx.io";
  }

  if ($("mqtt-port") &&
      document.activeElement !== $("mqtt-port")) {
    $("mqtt-port").value = "1883";
  }

  if ($("mqtt-topic") &&
      document.activeElement !== $("mqtt-topic")) {
    $("mqtt-topic").value =
      "alimentador-mascotas-felipe/servo";
  }

  setText(
    "mqtt-topics",
    `Orden: ${MQTT_CMD_TOPIC} · Estado: ${MQTT_STATE_TOPIC}`
  );

  const info = [
    ["Modelo", "SG5010"],
    ["Controlador", "ESP32"],
    ["Tipo", "Rotación continua"],
    ["Señal", "PWM 50 Hz"],
    ["Pulso de parada", "1800 µs"],
    ["Rango de giro", "1800–2000 µs"],
    ["Alimentación", panel.voltage || "5.0 V"],
    ["Internet", net],
    ["Placa", board],
    ["Pin de señal", "GPIO 19"],
    [
      "Sentido actual",
      panel.direction === "ccw"
        ? "Antihorario"
        : "Horario",
    ],
    ["Red Wi-Fi", panel.ssid || "—"],
    ["Dirección IP", panel.ip || "—"],
    ["Servidor", "MQTT / EMQX"],
  ];

  const rows = document.createElement("div");

  for (const [label, value] of info) {
    const line = document.createElement("div");

    line.className = "line";

    const a = document.createElement("span");
    const b = document.createElement("span");

    a.textContent = label;
    b.textContent = value;

    line.append(a, b);
    rows.append(line);
  }

  if ($("info-rows")) {
    $("info-rows").replaceChildren(rows);
  }

  const started =
    panel.running &&
    panel.runStartedAt
      ? Date.now() -
        panel.runStartedAt
      : 0;

  setText("uptime", hms(started));
  setText("row-up", hms(started));
}

function addHistory(kind, label) {
  if (!panel) return;

  panel.history.unshift({
    kind,
    label,
    at: Date.now(),
  });

  panel.history =
    panel.history.slice(0, 100);
}

function connectMqtt() {
  if (
    typeof mqtt === "undefined"
  ) {
    mqttStatus = "error";
    paint();

    toast("No se pudo cargar MQTT");

    return;
  }

  mqttStatus = "connecting";
  paint();

  const clientId =
    "panel-" +
    Math.random()
      .toString(16)
      .slice(2, 10);

  mqttClient = mqtt.connect(
    MQTT_URL,
    {
      clientId,
      clean: true,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
      keepalive: 30,
    }
  );

  mqttClient.on("connect", () => {
    mqttStatus = "on";

    mqttClient.subscribe(
      MQTT_STATE_TOPIC,
      { qos: 0 },
      (error) => {
        if (error) {
          console.error(
            "Error suscribiendo:",
            error
          );
        }
      }
    );

    paint();
  });

  mqttClient.on("reconnect", () => {
    mqttStatus = "connecting";
    paint();
  });

  mqttClient.on("close", () => {
    mqttStatus = "connecting";
    paint();
  });

  mqttClient.on("error", (error) => {
    console.error(
      "MQTT error:",
      error
    );

    mqttStatus = "error";
    paint();
  });

  mqttClient.on(
    "message",
    (topic, payload) => {
      if (
        topic !== MQTT_STATE_TOPIC
      ) {
        return;
      }

      const message =
        payload
          .toString()
          .trim()
          .toUpperCase();

      if (
        message === "ON"
      ) {
        panel.running = true;
        panel.boardOnline = true;
        panel.boardSeenAt =
          Date.now();

        if (!panel.runStartedAt) {
          panel.runStartedAt =
            Date.now();
        }

        paint();

        return;
      }

      if (
        message === "OFF"
      ) {
        panel.running = false;
        panel.boardOnline = true;
        panel.boardSeenAt =
          Date.now();
        panel.runStartedAt = null;

        paint();
      }
    }
  );
}

function publishCommand(message) {
  if (
    !mqttClient ||
    !mqttClient.connected
  ) {
    toast("MQTT no está conectado");
    return false;
  }

  mqttClient.publish(
    MQTT_CMD_TOPIC,
    message,
    {
      qos: 0,
      retain: false,
    }
  );

  return true;
}

function pull() {
  if (!panel) {
    panel = createInitialPanel();
  }

  panel.mqtt = mqttStatus;
  panel.online =
    navigator.onLine &&
    mqttStatus === "on";

  paint();
}

function post(body) {
  if (!body || !body.op) {
    return Promise.reject(
      new Error("Comando inválido")
    );
  }

  if (
    body.op === "on"
  ) {
    if (!publishCommand("ON")) {
      return Promise.reject(
        new Error("MQTT")
      );
    }

    panel.running = true;
    panel.boardOnline = true;
    panel.boardSeenAt =
      Date.now();
    panel.runStartedAt =
      Date.now();

    addHistory(
      "on",
      "Servo encendido"
    );

    paint();

    return Promise.resolve();
  }

  if (
    body.op === "off"
  ) {
    if (!publishCommand("OFF")) {
      return Promise.reject(
        new Error("MQTT")
      );
    }

    panel.running = false;
    panel.boardOnline = true;
    panel.boardSeenAt =
      Date.now();
    panel.runStartedAt = null;

    addHistory(
      "off",
      "Servo apagado"
    );

    paint();

    return Promise.resolve();
  }

  if (
    body.op === "speed"
  ) {
    panel.speed =
      Number(body.speed) || 0;

    paint();

    return Promise.resolve();
  }

  if (
    body.op === "direction"
  ) {
    panel.direction =
      body.direction === "ccw"
        ? "ccw"
        : "cw";

    paint();

    return Promise.resolve();
  }

  if (
    body.op === "autostop"
  ) {
    panel.autoStopSec =
      Number(body.autoStopSec) || 0;

    paint();

    return Promise.resolve();
  }

  if (
    body.op === "mqtt"
  ) {
    toast(
      "MQTT está configurado para EMQX"
    );

    return Promise.resolve();
  }

  return Promise.resolve();
}

function confirmOn() {
  return (
    localStorage.getItem(
      "mi-servo-confirm"
    ) === "1"
  );
}

async function turnOn() {
  try {
    await post({
      op: "on",
    });

    toast("Servo encendido");
  } catch {
    toast("No se pudo enviar");
  }
}

function bind() {
  document
    .querySelectorAll(
      "[data-tab-btn]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () =>
          showTab(
            button.dataset.tabBtn
          )
      );
    });

  $("btn-on").addEventListener(
    "click",
    () => {
      if (!navigator.onLine) {
        toast("Sin internet");
        return;
      }

      if (confirmOn()) {
        const sense =
          panel &&
          panel.direction === "ccw"
            ? "antihorario"
            : "horario";

        $("ask-body").textContent =
          `Girará al ${$("speed").value}% en sentido ${sense}.`;

        $("ask").hidden = false;

        return;
      }

      void turnOn();
    }
  );

  $("btn-off").addEventListener(
    "click",
    async () => {
      try {
        await post({
          op: "off",
        });

        toast("Servo apagado");
      } catch {
        toast("No se pudo enviar");
      }
    }
  );

  $("ask-no").addEventListener(
    "click",
    () => {
      $("ask").hidden = true;
    }
  );

  $("ask-yes").addEventListener(
    "click",
    () => {
      $("ask").hidden = true;
      void turnOn();
    }
  );

  $("speed").addEventListener(
    "input",
    () => {
      $("speed").style.setProperty(
        "--pct",
        `${$("speed").value}%`
      );

      setText(
        "speed-label",
        `${$("speed").value} %`
      );

      clearTimeout(speedTimer);

      speedTimer = setTimeout(
        () => {
          void post({
            op: "speed",
            speed: Number(
              $("speed").value
            ),
          }).catch(() =>
            toast(
              "No se pudo enviar"
            )
          );
        },
        250
      );
    }
  );

  $("dir-cw").addEventListener(
    "click",
    () =>
      void post({
        op: "direction",
        direction: "cw",
      }).catch(() =>
        toast(
          "No se pudo enviar"
        )
      )
  );

  $("dir-ccw").addEventListener(
    "click",
    () =>
      void post({
        op: "direction",
        direction: "ccw",
      }).catch(() =>
        toast(
          "No se pudo enviar"
        )
      )
  );

  const stops = $("stops");

  for (const seconds of STOPS) {
    const button =
      document.createElement(
        "button"
      );

    button.type = "button";
    button.className = "seg";

    button.dataset.stop =
      String(seconds);

    button.textContent =
      seconds === 0
        ? "Off"
        : `${seconds}s`;

    button.addEventListener(
      "click",
      () => {
        void post({
          op: "autostop",
          autoStopSec: seconds,
        }).catch(() =>
          toast(
            "No se pudo enviar"
          )
        );
      }
    );

    stops.append(button);
  }

  document
    .querySelectorAll(
      "[data-filter]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          filter =
            button.dataset.filter;

          document
            .querySelectorAll(
              "[data-filter]"
            )
            .forEach((item) =>
              item.classList.toggle(
                "seg-on",
                item === button
              )
            );

          if (panel) {
            $("history-list")
              .replaceChildren(
                historyNodes(
                  panel.history
                )
              );
          }
        }
      );
    });

  $("confirm-toggle").setAttribute(
    "aria-checked",
    confirmOn()
      ? "true"
      : "false"
  );

  $("confirm-toggle").addEventListener(
    "click",
    () => {
      const next =
        !confirmOn();

      localStorage.setItem(
        "mi-servo-confirm",
        next ? "1" : "0"
      );

      $("confirm-toggle").setAttribute(
        "aria-checked",
        next ? "true"
        : "false"
      );
    }
  );

  $("mqtt-toggle").addEventListener(
    "click",
    () => {
      toast(
        "MQTT directo por EMQX"
      );
    }
  );

  $("mqtt-save").addEventListener(
    "click",
    () => {
      localStorage.setItem(
        "alimentador-topic",
        MQTT_CMD_TOPIC
      );

      toast(
        "MQTT guardado"
      );
    }
  );

  $("endpoint").textContent =
    `${location.origin}/panel/index.html`;

  $("copy-endpoint").addEventListener(
    "click",
    async () => {
      try {
        await navigator.clipboard.writeText(
          $("endpoint").textContent
        );

        toast("Enlace copiado");
      } catch {
        toast("No se pudo copiar");
      }
    }
  );

  showTab("inicio");
}

bind();

panel = createInitialPanel();

paint();

connectMqtt();

void pull();

setInterval(
  () => {
    if (
      !panel ||
      !panel.running ||
      !panel.runStartedAt
    ) {
      return;
    }

    const text =
      hms(
        Date.now() -
          panel.runStartedAt
      );

    setText(
      "uptime",
      text
    );

    setText(
      "row-up",
      text
    );
  },
  1000
);

window.addEventListener(
  "offline",
  () => {
    if (panel) {
      panel.online = false;
    }

    mqttStatus = "error";

    paint();
  }
);

window.addEventListener(
  "online",
  () => {
    mqttStatus = "connecting";

    paint();

    if (
      mqttClient &&
      !mqttClient.connected
    ) {
      mqttClient.reconnect();
    }
  }
);ssss