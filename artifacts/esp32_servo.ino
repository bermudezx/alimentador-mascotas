/*
  ALIMENTADOR DE MASCOTAS
  ESP32 + SG5010 (rotación continua) + WiFiManager + MQTT

  Wi-Fi:
    - Si ya hay una red guardada, se conecta automáticamente.
    - Si no hay una red guardada, crea el AP:
        ALIMENTADOR-SETUP
      y permite configurar la Wi-Fi desde el celular.

  MQTT:
    broker.emqx.io:1883
    comando: alimentador-mascotas-felipe/servo/cmd
    estado:  alimentador-mascotas-felipe/servo/state

  Pines:
    Servo -> GPIO 19
    LED   -> GPIO 18
    Botón -> GPIO 5 (INPUT_PULLUP)

  SG5010:
    GIRAR = 2000 us
    PARAR = 1500 us
*/

#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>

// =====================================================
// MQTT
// =====================================================

const char* MQTT_SERVER = "broker.emqx.io";
const int MQTT_PORT = 1883;

const char* MQTT_TOPIC_CMD =
  "alimentador-mascotas-felipe/servo/cmd";

const char* MQTT_TOPIC_STATE =
  "alimentador-mascotas-felipe/servo/state";

// =====================================================
// PINES
// =====================================================

const int PIN_SERVO = 19;
const int PIN_LED = 18;
const int PIN_BOTON = 5;

// =====================================================
// SERVO
// =====================================================

const int GIRAR = 2000;
const int PARAR = 1500;

// =====================================================
// OBJETOS
// =====================================================

Servo servo360;

WiFiClient espClient;
PubSubClient mqtt(espClient);

WiFiManager wm;

// =====================================================
// VARIABLES
// =====================================================

bool girando = false;
bool botonAnterior = HIGH;

unsigned long ultimoIntentoMQTT = 0;

// =====================================================
// CONTROLAR SERVO
// =====================================================

void actualizarServo() {

  if (girando) {

    digitalWrite(PIN_LED, HIGH);

    servo360.writeMicroseconds(GIRAR);

    Serial.println("GIRANDO");

  } else {

    digitalWrite(PIN_LED, LOW);

    servo360.writeMicroseconds(PARAR);

    Serial.println("DETENIDO");
  }
}

// =====================================================
// PUBLICAR ESTADO
// =====================================================

void publicarEstado() {

  if (!mqtt.connected()) {
    return;
  }

  const char* mensaje =
    girando ? "ON" : "OFF";

  mqtt.publish(
    MQTT_TOPIC_STATE,
    mensaje,
    true
  );

  Serial.print("Estado enviado: ");
  Serial.println(mensaje);
}

// =====================================================
// RECIBIR MQTT
// =====================================================

void recibirMQTT(
  char* topic,
  byte* payload,
  unsigned int length
) {

  String mensaje = "";

  for (
    unsigned int i = 0;
    i < length;
    i++
  ) {
    mensaje += (char)payload[i];
  }

  mensaje.trim();

  Serial.println();
  Serial.println("======================");
  Serial.println("COMANDO MQTT");
  Serial.print("Mensaje: ");
  Serial.println(mensaje);
  Serial.println("======================");

  if (
    mensaje == "ON" ||
    mensaje == "on" ||
    mensaje == "1"
  ) {

    girando = true;

    actualizarServo();
    publicarEstado();

    Serial.println(">>> ORDEN REMOTA: ENCENDER");
  }

  else if (
    mensaje == "OFF" ||
    mensaje == "off" ||
    mensaje == "0"
  ) {

    girando = false;

    actualizarServo();
    publicarEstado();

    Serial.println(">>> ORDEN REMOTA: APAGAR");
  }

  (void)topic;
}

// =====================================================
// CONECTAR MQTT SIN BLOQUEAR
// =====================================================

void conectarMQTT() {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (mqtt.connected()) {
    return;
  }

  if (
    millis() - ultimoIntentoMQTT < 5000
  ) {
    return;
  }

  ultimoIntentoMQTT = millis();

  Serial.println("Intentando conectar MQTT...");

  String clientID = "ESP32-Alimentador-";
  clientID += String(
    (uint32_t)ESP.getEfuseMac(),
    HEX
  );

  if (
    mqtt.connect(clientID.c_str())
  ) {

    Serial.println("MQTT CONECTADO");

    mqtt.subscribe(
      MQTT_TOPIC_CMD
    );

    Serial.print("Suscrito a: ");
    Serial.println(MQTT_TOPIC_CMD);

    publicarEstado();

  } else {

    Serial.print("MQTT error: ");
    Serial.println(mqtt.state());
  }
}

// =====================================================
// BOTON FISICO
// =====================================================

void leerBoton() {

  bool botonActual =
    digitalRead(PIN_BOTON);

  if (
    botonAnterior == HIGH &&
    botonActual == LOW
  ) {

    delay(50);

    if (
      digitalRead(PIN_BOTON) == LOW
    ) {

      girando = !girando;

      actualizarServo();

      publicarEstado();

      while (
        digitalRead(PIN_BOTON) == LOW
      ) {
        delay(10);
      }

      delay(50);
    }
  }

  botonAnterior =
    botonActual;
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(500);

  Serial.println();
  Serial.println("==============================");
  Serial.println("   ALIMENTADOR DE MASCOTAS");
  Serial.println("==============================");

  // ---------------------------------------------------
  // LED
  // ---------------------------------------------------

  pinMode(
    PIN_LED,
    OUTPUT
  );

  digitalWrite(
    PIN_LED,
    LOW
  );

  // ---------------------------------------------------
  // BOTON
  // ---------------------------------------------------

  pinMode(
    PIN_BOTON,
    INPUT_PULLUP
  );

  // ---------------------------------------------------
  // WIFI MANAGER
  //
  // IMPORTANTE:
  // Primero dejamos que WiFiManager termine.
  // Después conectamos el servo.
  // Así no interferimos con el control PWM.
  // ---------------------------------------------------

  wm.setConfigPortalTimeout(180);

  Serial.println("Configurando Wi-Fi...");

  bool conectado =
    wm.autoConnect("ALIMENTADOR-SETUP");

  if (!conectado) {

    Serial.println(
      "No se pudo configurar Wi-Fi."
    );

    delay(1000);

    ESP.restart();
  }

  Serial.println();
  Serial.println("Wi-Fi conectado");
  Serial.print("SSID: ");
  Serial.println(WiFi.SSID());
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  // ---------------------------------------------------
  // SERVO
  // ---------------------------------------------------

  servo360.setPeriodHertz(50);

  servo360.attach(
    PIN_SERVO,
    500,
    2500
  );

  girando = false;

  servo360.writeMicroseconds(
    PARAR
  );

  Serial.println("Servo detenido");

  // ---------------------------------------------------
  // MQTT
  // ---------------------------------------------------

  mqtt.setServer(
    MQTT_SERVER,
    MQTT_PORT
  );

  mqtt.setCallback(
    recibirMQTT
  );

  mqtt.setBufferSize(256);

  Serial.println("Sistema listo");
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  // 1. BOTON
  leerBoton();

  // 2. MQTT
  conectarMQTT();

  if (
    mqtt.connected()
  ) {
    mqtt.loop();
  }

  delay(5);
}
