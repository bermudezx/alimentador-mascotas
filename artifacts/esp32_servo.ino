
/*
  ALIMENTADOR DE MASCOTAS
  ESP32 + SG5010 + WiFiManager + MQTT

  Wi-Fi:
    - Guarda las credenciales al configurar la red.
    - Intenta conectarse automaticamente al arrancar.
    - Abre ALIMENTADOR-SETUP si no consigue conectar.
    - Boton presionado 5 segundos: borra el Wi-Fi guardado.

  MQTT:
    Broker: broker.emqx.io
    Puerto: 1883
    Comando: alimentador-mascotas-felipe/servo/cmd
    Estado:  alimentador-mascotas-felipe/servo/state

  Pines:
    Servo: GPIO 19
    LED:   GPIO 18
    Boton: GPIO 5 (conectado a GND)

  Calibracion:
    GIRAR = 1600 us
    PARAR = 1800 us
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
// PINES Y SERVO
// =====================================================

const int PIN_SERVO = 19;
const int PIN_LED = 18;
const int PIN_BOTON = 5;

const int GIRAR = 1600;
const int PARAR = 1800;

// Se conserva el sentido opuesto usado en la version
// anterior. Verificar el comportamiento fisico.
const int GIRAR_OPUESTO = 2000;

// =====================================================
// OBJETOS
// =====================================================

Servo servo360;
WiFiClient espClient;
PubSubClient mqtt(espClient);
WiFiManager wm;

// =====================================================
// VARIABLES DE CONTROL
// =====================================================

bool girando = false;
int velocidad = 100;
bool direccionHorario = true;

unsigned long ultimoIntentoMQTT = 0;
unsigned long ultimoIntentoWiFi = 0;

// Parada automatica
unsigned long tiempoInicioGiro = 0;
unsigned long autoStopMs = 0;

// Boton
bool botonPresionado = false;
bool pulsacionLargaAtendida = false;
unsigned long inicioBoton = 0;

const unsigned long TIEMPO_DEBOUNCE = 50;
const unsigned long TIEMPO_RESET_WIFI = 5000;

// =====================================================
// CONTROL DEL SERVO
// =====================================================

void actualizarServo() {
  if (!girando || velocidad <= 0) {
    digitalWrite(PIN_LED, LOW);
    servo360.writeMicroseconds(PARAR);
    Serial.println("DETENIDO");
    return;
  }

  digitalWrite(PIN_LED, HIGH);

  int pulso;

  if (direccionHorario) {
    pulso = map(velocidad, 0, 100, PARAR, GIRAR);
  } else {
    pulso = map(
      velocidad, 0, 100, PARAR, GIRAR_OPUESTO
    );
  }

  servo360.writeMicroseconds(pulso);

  Serial.print("GIRANDO | Velocidad: ");
  Serial.print(velocidad);
  Serial.print("% | Pulso: ");
  Serial.println(pulso);
}

// =====================================================
// PUBLICAR ESTADO
// =====================================================

void publicarEstado() {
  if (!mqtt.connected()) {
    return;
  }

  const char* estado = girando ? "ON" : "OFF";

  bool enviado = mqtt.publish(
    MQTT_TOPIC_STATE,
    estado,
    true
  );

  Serial.print("Estado MQTT: ");
  Serial.print(estado);
  Serial.print(" | Enviado: ");
  Serial.println(enviado ? "SI" : "NO");
}

// =====================================================
// ENCENDER Y APAGAR
// =====================================================

void encenderServo() {
  if (!girando) {
    girando = true;
    tiempoInicioGiro = millis();
  }

  actualizarServo();
  publicarEstado();
}

void apagarServo() {
  girando = false;
  tiempoInicioGiro = 0;

  actualizarServo();
  publicarEstado();
}

// =====================================================
// RESTABLECER WIFI
// =====================================================

void restablecerWiFi() {
  Serial.println();
  Serial.println("==============================");
  Serial.println("RESTABLECIENDO CONFIGURACION");
  Serial.println("BORRANDO WIFI GUARDADO");
  Serial.println("==============================");

  // Detener el servo
  girando = false;
  tiempoInicioGiro = 0;
  actualizarServo();
  publicarEstado();

  if (mqtt.connected()) {
    mqtt.disconnect();
  }

  // Borrar credenciales de WiFiManager
  wm.resetSettings();

  // Borrar tambien credenciales de la pila Wi-Fi
  WiFi.disconnect(true, true);

  delay(1000);

  Serial.println("Wi-Fi guardado eliminado");
  Serial.println("Reiniciando ESP32...");

  delay(500);
  ESP.restart();
}

// =====================================================
// BOTON FISICO
// Pulsacion corta: encender/apagar
// Pulsacion de 5 segundos: borrar Wi-Fi
// =====================================================

void leerBoton() {
  bool lectura = digitalRead(PIN_BOTON);
  unsigned long ahora = millis();

  // Detectar nueva pulsacion
  if (lectura == LOW && !botonPresionado) {
    delay(TIEMPO_DEBOUNCE);

    if (digitalRead(PIN_BOTON) == LOW) {
      botonPresionado = true;
      pulsacionLargaAtendida = false;
      inicioBoton = millis();

      Serial.println("Boton presionado");
      Serial.println(
        "Mantener 5 segundos para borrar Wi-Fi"
      );
    }
  }

  // Comprobar pulsacion larga
  if (
    botonPresionado &&
    digitalRead(PIN_BOTON) == LOW
  ) {
    ahora = millis();

    if (
      !pulsacionLargaAtendida &&
      ahora - inicioBoton >= TIEMPO_RESET_WIFI
    ) {
      pulsacionLargaAtendida = true;

      Serial.println("Pulsacion larga detectada");
      restablecerWiFi();
      return;
    }
  }

  // Detectar liberacion del boton
  if (
    botonPresionado &&
    digitalRead(PIN_BOTON) == HIGH
  ) {
    botonPresionado = false;

    if (!pulsacionLargaAtendida) {
      Serial.println("Pulsacion corta");

      if (girando) {
        apagarServo();
      } else {
        encenderServo();
      }
    }
  }
}

// =====================================================
// COMANDOS MQTT
// =====================================================

void recibirMQTT(
  char* topic,
  byte* payload,
  unsigned int length
) {
  if (String(topic) != MQTT_TOPIC_CMD) {
    return;
  }

  String mensaje;
  mensaje.reserve(length);

  for (unsigned int i = 0; i < length; i++) {
    mensaje += (char)payload[i];
  }

  mensaje.trim();

  Serial.print("Comando recibido: ");
  Serial.println(mensaje);

  // ENCENDER
  if (
    mensaje == "ON" ||
    mensaje == "on" ||
    mensaje == "1"
  ) {
    encenderServo();
  }

  // APAGAR
  else if (
    mensaje == "OFF" ||
    mensaje == "off" ||
    mensaje == "0"
  ) {
    apagarServo();
  }

  // VELOCIDAD
  else if (mensaje.startsWith("SPEED:")) {
    String valor = mensaje.substring(6);
    valor.trim();

    if (valor.length() == 0) {
      Serial.println("Velocidad vacia");
      return;
    }

    velocidad = constrain(valor.toInt(), 0, 100);

    if (velocidad == 0) {
      apagarServo();
    } else {
      // No enciende el servo si estaba apagado
      actualizarServo();
    }
  }

  // DIRECCION
  else if (mensaje == "DIR:CW") {
    direccionHorario = true;
    actualizarServo();
  }

  else if (mensaje == "DIR:CCW") {
    direccionHorario = false;
    actualizarServo();
  }

  // PARADA AUTOMATICA
  else if (mensaje.startsWith("AUTOSTOP:")) {
    String valor = mensaje.substring(9);
    valor.trim();

    if (valor.length() == 0) {
      Serial.println("Tiempo automatico vacio");
      return;
    }

    long segundos = valor.toInt();
    segundos = constrain(segundos, 0L, 86400L);

    autoStopMs = (unsigned long)segundos * 1000UL;

    // Reiniciar el conteo si ya esta girando
    if (girando) {
      tiempoInicioGiro = millis();
    }

    Serial.print("Parada automatica: ");
    Serial.print(segundos);
    Serial.println(" segundos");
  }

  else {
    Serial.println("Comando no reconocido");
  }
}

// =====================================================
// RECONEXION WIFI
// =====================================================

void mantenerWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - ultimoIntentoWiFi < 10000) {
    return;
  }

  ultimoIntentoWiFi = millis();

  Serial.println("Wi-Fi desconectado. Reconectando...");
  WiFi.reconnect();
}

// =====================================================
// CONEXION MQTT
// =====================================================

void conectarMQTT() {
  if (
    WiFi.status() != WL_CONNECTED ||
    mqtt.connected()
  ) {
    return;
  }

  if (millis() - ultimoIntentoMQTT < 5000) {
    return;
  }

  ultimoIntentoMQTT = millis();

  Serial.println("Intentando conectar MQTT...");

  String clientID = "ESP32-Alimentador-";
  clientID += String(
    (uint32_t)ESP.getEfuseMac(),
    HEX
  );

  if (mqtt.connect(clientID.c_str())) {
    Serial.println("MQTT conectado");

    if (mqtt.subscribe(MQTT_TOPIC_CMD)) {
      Serial.print("Suscrito a: ");
      Serial.println(MQTT_TOPIC_CMD);
    } else {
      Serial.println("Error al suscribirse");
    }

    publicarEstado();
  } else {
    Serial.print("Error MQTT: ");
    Serial.println(mqtt.state());
  }
}

// =====================================================
// PARADA AUTOMATICA
// =====================================================

void revisarParadaAutomatica() {
  if (!girando || autoStopMs == 0) {
    return;
  }

  if (millis() - tiempoInicioGiro >= autoStopMs) {
    Serial.println("TIEMPO CUMPLIDO: parada automatica");
    apagarServo();
  }
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("==============================");
  Serial.println("ALIMENTADOR DE MASCOTAS");
  Serial.println("==============================");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  pinMode(PIN_BOTON, INPUT_PULLUP);

  // ---------------------------------------------------
  // WIFI
  // ---------------------------------------------------

  WiFi.mode(WIFI_STA);
  WiFi.persistent(true);
  WiFi.setAutoReconnect(true);

  wm.setConfigPortalTimeout(180);

  Serial.println("Configurando Wi-Fi...");

  // Intenta la red guardada y abre portal si hace falta
  bool conectado = wm.autoConnect("ALIMENTADOR-SETUP");

  if (!conectado) {
    Serial.println("No se pudo conectar al Wi-Fi");
    delay(1000);
    ESP.restart();
  }

  Serial.println("Wi-Fi conectado");
  Serial.print("SSID: ");
  Serial.println(WiFi.SSID());
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  // ---------------------------------------------------
  // SERVO
  // ---------------------------------------------------

  servo360.setPeriodHertz(50);
  servo360.attach(PIN_SERVO, 500, 2500);

  girando = false;
  servo360.writeMicroseconds(PARAR);

  Serial.println("Servo detenido");

  // ---------------------------------------------------
  // MQTT
  // ---------------------------------------------------

  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(recibirMQTT);
  mqtt.setBufferSize(256);

  Serial.println("Sistema listo");
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  leerBoton();

  mantenerWiFi();
  conectarMQTT();

  if (mqtt.connected()) {
    mqtt.loop();
  }

  revisarParadaAutomatica();

  delay(5);
}
