
/*
  ALIMENTADOR DE MASCOTAS
  ESP32 + SG5010 de rotacion continua + WiFiManager + MQTT

  Wi-Fi:
    - Conecta a una red guardada.
    - Si no existe, abre ALIMENTADOR-SETUP.
    - Mantener el boton 5 segundos restablece la configuracion Wi-Fi.

  MQTT:
    Broker: broker.emqx.io:1883
    Comandos: alimentador-mascotas-felipe/servo/cmd
    Estado:   alimentador-mascotas-felipe/servo/state

  Pines:
    Servo -> GPIO 19
    LED   -> GPIO 18
    Boton -> GPIO 5 (INPUT_PULLUP)

  Calibracion confirmada:
    GIRAR = 1600 us
    PARAR = 1800 us

  Comandos MQTT:
    ON
    OFF
    SPEED:0-100
    DIR:CW
    DIR:CCW
    AUTOSTOP:segundos

  AUTOSTOP:0 desactiva la parada automatica.
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
// CALIBRACION DEL SERVO
// =====================================================

const int GIRAR = 1600;
const int PARAR = 1800;

// Pulso opuesto calculado simetricamente respecto
// al pulso de parada. Debe verificarse en el servo.
const int GIRAR_OPUESTO = PARAR + (PARAR - GIRAR);

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
int velocidad = 100;
bool direccionHorario = true;

unsigned long ultimoIntentoMQTT = 0;

// Parada automatica
unsigned long tiempoInicioGiro = 0;
unsigned long autoStopMs = 0;

// Boton: pulsacion corta y pulsacion larga
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
    // Desde parada (1800) hasta giro calibrado (1600).
    pulso = map(velocidad, 0, 100, PARAR, GIRAR);
  } else {
    // Direccion opuesta estimada de forma simetrica.
    pulso = map(velocidad, 0, 100, PARAR, GIRAR_OPUESTO);
  }

  servo360.writeMicroseconds(pulso);

  Serial.print("GIRANDO | Velocidad: ");
  Serial.print(velocidad);
  Serial.print("% | Pulso: ");
  Serial.println(pulso);
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
// PROCESAR COMANDOS MQTT
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

  Serial.println();
  Serial.print("Comando recibido: ");
  Serial.println(mensaje);

  // Encender
  if (
    mensaje == "ON" ||
    mensaje == "on" ||
    mensaje == "1"
  ) {
    encenderServo();
  }

  // Apagar
  else if (
    mensaje == "OFF" ||
    mensaje == "off" ||
    mensaje == "0"
  ) {
    apagarServo();
  }

  // Velocidad
  else if (mensaje.startsWith("SPEED:")) {
    String valor = mensaje.substring(6);

    if (valor.length() == 0) {
      Serial.println("Error: velocidad vacia");
      return;
    }

    velocidad = constrain(valor.toInt(), 0, 100);

    if (velocidad == 0) {
      apagarServo();
    } else {
      // No enciende el servo si estaba apagado.
      actualizarServo();
    }
  }

  // Direccion
  else if (mensaje == "DIR:CW") {
    direccionHorario = true;
    actualizarServo();
  }

  else if (mensaje == "DIR:CCW") {
    direccionHorario = false;
    actualizarServo();
  }

  // Parada automatica
  else if (mensaje.startsWith("AUTOSTOP:")) {
    String valor = mensaje.substring(9);
    valor.trim();

    if (valor.length() == 0) {
      Serial.println("Error: tiempo automatico vacio");
      return;
    }

    long segundos = valor.toInt();
    segundos = constrain(segundos, 0L, 86400L);

    autoStopMs = (unsigned long)segundos * 1000UL;

    // El nuevo tiempo empieza a contar desde este momento
    // si el servo ya esta girando.
    if (girando) {
      tiempoInicioGiro = millis();
    }

    Serial.print("Parada automatica: ");
    Serial.print(segundos);
    Serial.println(" segundos");

    if (segundos == 0) {
      Serial.println("Parada automatica desactivada");
    }
  }

  else {
    Serial.println("Comando MQTT no reconocido");
  }
}

// =====================================================
// CONEXION MQTT
// =====================================================

void conectarMQTT() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) {
    return;
  }

  if (millis() - ultimoIntentoMQTT < 5000) {
    return;
  }

  ultimoIntentoMQTT = millis();

  Serial.println("Intentando conectar MQTT...");

  String clientID = "ESP32-Alimentador-";
  clientID += String((uint32_t)ESP.getEfuseMac(), HEX);

  if (mqtt.connect(clientID.c_str())) {
    Serial.println("MQTT conectado");

    if (mqtt.subscribe(MQTT_TOPIC_CMD)) {
      Serial.print("Suscrito a: ");
      Serial.println(MQTT_TOPIC_CMD);
    } else {
      Serial.println("No se pudo suscribir al topico");
    }

    publicarEstado();
  } else {
    Serial.print("Error MQTT: ");
    Serial.println(mqtt.state());
  }
}

// =====================================================
// RESTABLECER WIFI
// =====================================================

void restablecerWiFi() {
  Serial.println("Restableciendo configuracion Wi-Fi...");

  // Detener antes de reiniciar.
  girando = false;
  tiempoInicioGiro = 0;
  actualizarServo();

  if (mqtt.connected()) {
    publicarEstado();
    mqtt.disconnect();
  }

  wm.resetSettings();

  delay(500);
  ESP.restart();
}

// =====================================================
// BOTON FISICO
// Pulsacion corta: alterna encendido/apagado.
// Pulsacion de 5 segundos: restablece el Wi-Fi.
// =====================================================


void leerBoton() {
  bool lectura = digitalRead(PIN_BOTON);
  unsigned long ahora = millis();

  // Detectar la primera pulsacion
  if (lectura == LOW && !botonPresionado) {
    delay(TIEMPO_DEBOUNCE);

    if (digitalRead(PIN_BOTON) == LOW) {
      botonPresionado = true;
      pulsacionLargaAtendida = false;
      inicioBoton = millis();

      Serial.println("Boton presionado");
      Serial.println("Mantener 5 segundos para borrar Wi-Fi");
    }
  }

  // Comprobar si sigue presionado
  if (botonPresionado && digitalRead(PIN_BOTON) == LOW) {
    ahora = millis();

    if (!pulsacionLargaAtendida &&
        ahora - inicioBoton >= TIEMPO_RESET_WIFI) {
      pulsacionLargaAtendida = true;

      Serial.println("Pulsacion larga: restableciendo Wi-Fi");
      restablecerWiFi();
    }
  }

  // Detectar cuando se suelta el boton
  if (botonPresionado && digitalRead(PIN_BOTON) == HIGH) {
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
// CONFIGURAR PARADA AUTOMATICA
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
  Serial.println("   ALIMENTADOR DE MASCOTAS");
  Serial.println("==============================");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  pinMode(PIN_BOTON, INPUT_PULLUP);

  // Wi-Fi
  wm.setConfigPortalTimeout(180);

  Serial.println("Configurando Wi-Fi...");

  bool conectado = wm.autoConnect("ALIMENTADOR-SETUP");

  if (!conectado) {
    Serial.println("No se pudo configurar Wi-Fi");
    delay(1000);
    ESP.restart();
  }

  Serial.println("Wi-Fi conectado");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  // Servo
  servo360.setPeriodHertz(50);
  servo360.attach(PIN_SERVO, 500, 2500);

  girando = false;
  servo360.writeMicroseconds(PARAR);

  Serial.println("Servo detenido");

  // MQTT
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

  conectarMQTT();

  if (mqtt.connected()) {
    mqtt.loop();
  }

  revisarParadaAutomatica();

  delay(5);
}
