import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Cliente MQTT 3.1.1 por TCP.
 *
 * Java se conecta directamente a:
 *
 * broker.emqx.io:1883
 *
 * Y publica:
 *
 * alimentador-mascotas-felipe/servo/cmd
 *
 * con:
 *
 * ON
 * OFF
 */
final class MqttSession implements Runnable {

    private final PanelStore store;
    private final Object lock = new Object();

    private String pending = "";
    private volatile String password = "";
    private volatile boolean stop = false;

    private Socket socket;
    private OutputStream out;

    private int packetId = 1;

    MqttSession(PanelStore store) {
        this.store = store;
    }

    /**
     * Recibe el comando que viene desde la página.
     *
     * El PanelStore manda algo como:
     *
     * {"running":true,...}
     *
     * o:
     *
     * {"running":false,...}
     */
    void publish(String json) {

        System.out.println();
        System.out.println("================================");
        System.out.println("[MQTT] COMANDO DESDE PAGINA");
        System.out.println("[MQTT] JSON: " + json);
        System.out.println("================================");

        synchronized (lock) {
            pending = json;
        }

        trySend();
    }

    void setPassword(String value) {

        if (value != null) {
            password = value;
        }
    }

    void reconnect() {
        close();
    }

    @Override
    public void run() {

        System.out.println("[MQTT] Hilo MQTT iniciado");

        while (!stop) {

            if (!store.mqttEnabled) {

                setStatus("off");
                close();

                sleep(800);
                continue;
            }

            try {

                System.out.println("[MQTT] Intentando conectar...");
                System.out.println(
                    "[MQTT] Broker: "
                    + store.tcpHost
                    + ":"
                    + store.tcpPort
                );

                connect();

                setStatus("on");

                System.out.println("[MQTT] CONECTADO CORRECTAMENTE");
                System.out.println(
                    "[MQTT] Suscrito a: "
                    + store.topic
                    + "/state"
                );

                /*
                 * Si había un comando esperando antes de conectar,
                 * lo enviamos ahora.
                 */
                trySend();

                readLoop();

            } catch (IOException error) {

                System.out.println(
                    "[MQTT] ERROR: "
                    + error.getMessage()
                );

                setStatus(
                    store.mqttEnabled
                        ? "error"
                        : "off"
                );

            } finally {

                close();
            }

            if (!stop && store.mqttEnabled) {

                setStatus("connecting");

                System.out.println(
                    "[MQTT] Reconectando en 4 segundos..."
                );

                sleep(4000);
            }
        }

        System.out.println("[MQTT] Hilo MQTT detenido");
    }

    /**
     * Conecta con el broker MQTT.
     */
    private void connect() throws IOException {

        setStatus("connecting");

        Socket next = new Socket();

        next.connect(
            new InetSocketAddress(
                store.tcpHost,
                store.tcpPort
            ),
            8000
        );

        /*
         * Timeout para no dejar bloqueado el hilo
         * esperando indefinidamente un paquete MQTT.
         */
        next.setSoTimeout(1500);

        socket = next;
        out = next.getOutputStream();

        String clientId =
            "java-"
            + Integer.toHexString(
                (int) (System.nanoTime() & 0xfffffff)
            );

        System.out.println(
            "[MQTT] Client ID: "
            + clientId
        );

        send(
            connectPacket(
                clientId,
                store.username,
                password
            )
        );

        InputStream input =
            next.getInputStream();

        byte[] ack = readPacket(input);

        if (
            ack.length < 4
            || (ack[0] & 0xF0) != 0x20
            || ack[3] != 0
        ) {

            throw new IOException(
                "CONNACK rechazado"
            );
        }

        System.out.println(
            "[MQTT] CONNACK OK"
        );

        /*
         * Nos suscribimos al estado del ESP32.
         */
        send(
            subscribePacket(
                store.topic + "/state"
            )
        );

        System.out.println(
            "[MQTT] SUBSCRIBED: "
            + store.topic
            + "/state"
        );
    }

    /**
     * Lee mensajes que llegan desde MQTT.
     */
    private void readLoop() throws IOException {

        long lastPing =
            System.currentTimeMillis();

        InputStream in =
            socket.getInputStream();

        while (
            !stop
            && store.mqttEnabled
        ) {

            try {

                byte[] packet =
                    readPacket(in);

                if (packet.length == 0) {
                    continue;
                }

                int type =
                    packet[0] & 0xF0;

                /*
                 * PUBLISH
                 */
                if (type == 0x30) {

                    onPublish(packet);
                }

                /*
                 * PINGRESP
                 */
                else if (type == 0xD0) {

                    System.out.println(
                        "[MQTT] PINGRESP"
                    );
                }

            } catch (
                java.net.SocketTimeoutException timeout
            ) {

                /*
                 * Cada 20 segundos mandamos PINGREQ
                 * para mantener viva la conexión.
                 */
                if (
                    System.currentTimeMillis()
                    - lastPing
                    > 20_000L
                ) {

                    send(
                        new byte[] {
                            (byte) 0xC0,
                            0x00
                        }
                    );

                    lastPing =
                        System.currentTimeMillis();

                    System.out.println(
                        "[MQTT] PINGREQ"
                    );
                }

                /*
                 * También intentamos enviar cualquier
                 * comando pendiente.
                 */
                trySend();
            }
        }
    }

    /**
     * Procesa mensajes PUBLISH recibidos.
     *
     * El ESP32 publica:
     *
     * ON
     * OFF
     */
    private void onPublish(byte[] packet) {

        try {

            int index = 1;

            /*
             * Leer Remaining Length.
             */
            int multiplier = 1;
            int remaining = 0;
            int encoded;

            do {

                if (index >= packet.length) {
                    return;
                }

                encoded =
                    packet[index++] & 0xFF;

                remaining +=
                    (encoded & 127)
                    * multiplier;

                multiplier *= 128;

            } while (
                (encoded & 128) != 0
                && index < packet.length
            );

            /*
             * MQTT PUBLISH QoS 0:
             *
             * 2 bytes = topic length
             * topic
             * payload
             */
            if (index + 2 > packet.length) {
                return;
            }

            int topicLen =
                ((packet[index] & 0xFF) << 8)
                | (packet[index + 1] & 0xFF);

            int bodyAt =
                index + 2 + topicLen;

            if (
                bodyAt < 0
                || bodyAt > packet.length
            ) {
                return;
            }

            String topic =
                new String(
                    packet,
                    index + 2,
                    topicLen,
                    StandardCharsets.UTF_8
                );

            String body =
                new String(
                    packet,
                    bodyAt,
                    packet.length - bodyAt,
                    StandardCharsets.UTF_8
                ).trim();

            System.out.println();
            System.out.println(
                "[MQTT] MENSAJE RECIBIDO"
            );
            System.out.println(
                "[MQTT] Topic: "
                + topic
            );
            System.out.println(
                "[MQTT] Mensaje: "
                + body
            );

            synchronized (store) {

                /*
                 * Estado ON.
                 */
                if (
                    "ON".equalsIgnoreCase(body)
                ) {

                    store.syncRunning(true);

                    store.noteBoard(
                        store.ssid,
                        store.ip,
                        store.voltage
                    );

                    System.out.println(
                        "[MQTT] ESP32: ENCENDIDO"
                    );

                    return;
                }

                /*
                 * Estado OFF.
                 */
                if (
                    "OFF".equalsIgnoreCase(body)
                ) {

                    store.syncRunning(false);

                    store.noteBoard(
                        store.ssid,
                        store.ip,
                        store.voltage
                    );

                    System.out.println(
                        "[MQTT] ESP32: APAGADO"
                    );

                    return;
                }

                /*
                 * Compatibilidad con JSON anterior.
                 */
                String run =
                    PanelStore.field(
                        body,
                        "running"
                    );

                if (
                    "true".equalsIgnoreCase(run)
                ) {

                    store.syncRunning(true);

                } else if (
                    "false".equalsIgnoreCase(run)
                ) {

                    store.syncRunning(false);
                }

                String ssid =
                    PanelStore.field(
                        body,
                        "ssid"
                    );

                String ip =
                    PanelStore.field(
                        body,
                        "ip"
                    );

                String voltage =
                    PanelStore.field(
                        body,
                        "voltage"
                    );

                if (
                    !ssid.isBlank()
                    || !ip.isBlank()
                    || !voltage.isBlank()
                ) {

                    store.noteBoard(
                        ssid,
                        ip,
                        voltage
                    );

                } else {

                    store.noteBoard(
                        store.ssid,
                        store.ip,
                        store.voltage
                    );
                }
            }

        } catch (Exception error) {

            System.out.println(
                "[MQTT] Error procesando mensaje: "
                + error.getMessage()
            );
        }
    }

    /**
     * Envía el comando pendiente al ESP32.
     */
    private void trySend() {

        String json;

        synchronized (lock) {

            json = pending;

            if (
                json == null
                || json.isBlank()
            ) {
                return;
            }

            /*
             * Si todavía no hay conexión,
             * dejamos el comando guardado.
             */
            if (out == null) {

                System.out.println(
                    "[MQTT] Todavia no hay conexion."
                );

                return;
            }

            pending = "";
        }

        try {

            String mensaje =
                commandPayload(json);

            String topic =
                store.topic + "/cmd";

            System.out.println();
            System.out.println(
                "[MQTT] PUBLICANDO..."
            );

            System.out.println(
                "[MQTT] Topic: "
                + topic
            );

            System.out.println(
                "[MQTT] Mensaje: "
                + mensaje
            );

            /*
             * PUBLICAR MQTT.
             */
            send(
                publishPacket(
                    topic,
                    mensaje
                )
            );

            System.out.println(
                "[MQTT] PUBLICADO CORRECTAMENTE"
            );

        } catch (IOException error) {

            System.out.println(
                "[MQTT] ERROR AL PUBLICAR: "
                + error.getMessage()
            );

            /*
             * Devolvemos el comando a la cola
             * para intentar nuevamente.
             */
            synchronized (lock) {

                if (
                    pending == null
                    || pending.isBlank()
                ) {

                    pending = json;
                }
            }

            close();
        }
    }

    /**
     * Convierte el JSON del panel en ON/OFF.
     */
    private static String commandPayload(
        String json
    ) {

        if (json == null) {
            return "";
        }

        String value =
            json.trim();

        /*
         * Si ya viene como ON/OFF.
         */
        if (
            "ON".equalsIgnoreCase(value)
        ) {
            return "ON";
        }

        if (
            "OFF".equalsIgnoreCase(value)
        ) {
            return "OFF";
        }

        /*
         * Si viene como JSON:
         *
         * {"running":true}
         */
        String running =
            PanelStore.field(
                value,
                "running"
            );

        if (
            "true".equalsIgnoreCase(running)
        ) {

            return "ON";
        }

        if (
            "false".equalsIgnoreCase(running)
        ) {

            return "OFF";
        }

        /*
         * Si llega otro JSON,
         * lo mandamos tal cual.
         */
        return value;
    }

    /**
     * Envía bytes al broker.
     */
    private void send(
        byte[] packet
    ) throws IOException {

        OutputStream current =
            out;

        if (current == null) {

            throw new IOException(
                "Socket MQTT cerrado"
            );
        }

        current.write(packet);
        current.flush();
    }

    /**
     * Actualiza el estado MQTT mostrado
     * por el panel.
     */
    private void setStatus(
        String status
    ) {

        synchronized (store) {

            store.mqttStatus =
                status;
        }
    }

    /**
     * Cierra la conexión.
     */
    private void close() {

        Socket current =
            socket;

        socket = null;
        out = null;

        if (current != null) {

            try {

                current.close();

            } catch (IOException ignored) {

                // Ya estaba cerrado.
            }
        }
    }

    /**
     * Paquete CONNECT MQTT 3.1.1.
     */
    private static byte[] connectPacket(
        String clientId,
        String username,
        String password
    ) {

        boolean auth =
            username != null
            && !username.isBlank();

        byte flags = 0x02;

        if (auth) {
            flags |= (byte) 0x80;
        }

        if (
            auth
            && password != null
            && !password.isEmpty()
        ) {
            flags |= 0x40;
        }

        byte[] body =
            concat(
                utf("MQTT"),

                new byte[] {
                    0x04,
                    flags,
                    0x00,
                    0x1E
                },

                utf(clientId),

                auth
                    ? utf(username)
                    : new byte[0],

                (flags & 0x40) != 0
                    ? utf(password)
                    : new byte[0]
            );

        return packet(
            (byte) 0x10,
            body
        );
    }

    /**
     * Paquete SUBSCRIBE.
     */
    private byte[] subscribePacket(
        String topic
    ) {

        int id =
            packetId++;

        if (packetId > 65000) {
            packetId = 1;
        }

        byte[] body =
            concat(
                new byte[] {
                    (byte) (id >> 8),
                    (byte) id
                },

                utf(topic),

                new byte[] {
                    0x00
                }
            );

        return packet(
            (byte) 0x82,
            body
        );
    }

    /**
     * Paquete PUBLISH QoS 0.
     */
    private static byte[] publishPacket(
        String topic,
        String payload
    ) {

        return packet(
            (byte) 0x30,

            concat(
                utf(topic),

                payload.getBytes(
                    StandardCharsets.UTF_8
                )
            )
        );
    }

    /**
     * Construye un paquete MQTT.
     */
    private static byte[] packet(
        byte type,
        byte[] body
    ) {

        byte[] header =
            remaining(body.length);

        byte[] result =
            new byte[
                1
                + header.length
                + body.length
            ];

        result[0] = type;

        System.arraycopy(
            header,
            0,
            result,
            1,
            header.length
        );

        System.arraycopy(
            body,
            0,
            result,
            1 + header.length,
            body.length
        );

        return result;
    }

    /**
     * Codifica Remaining Length MQTT.
     */
    private static byte[] remaining(
        int length
    ) {

        byte[] encoded =
            new byte[4];

        int count = 0;

        do {

            int piece =
                length % 128;

            length /= 128;

            if (length > 0) {
                piece |= 0x80;
            }

            encoded[count++] =
                (byte) piece;

        } while (length > 0);

        return Arrays.copyOf(
            encoded,
            count
        );
    }

    /**
     * String MQTT UTF-8 con longitud
     * de dos bytes.
     */
    private static byte[] utf(
        String value
    ) {

        if (value == null) {
            value = "";
        }

        byte[] text =
            value.getBytes(
                StandardCharsets.UTF_8
            );

        byte[] result =
            new byte[
                2 + text.length
            ];

        result[0] =
            (byte) (text.length >> 8);

        result[1] =
            (byte) text.length;

        System.arraycopy(
            text,
            0,
            result,
            2,
            text.length
        );

        return result;
    }

    /**
     * Une varios arrays.
     */
    private static byte[] concat(
        byte[]... parts
    ) {

        int size = 0;

        for (byte[] part : parts) {

            size += part.length;
        }

        byte[] result =
            new byte[size];

        int at = 0;

        for (byte[] part : parts) {

            System.arraycopy(
                part,
                0,
                result,
                at,
                part.length
            );

            at += part.length;
        }

        return result;
    }

    /**
     * Lee un paquete MQTT completo.
     */
    private static byte[] readPacket(
        InputStream in
    ) throws IOException {

        int type =
            in.read();

        if (type < 0) {

            throw new IOException(
                "Conexion cerrada"
            );
        }

        int multiplier = 1;
        int remaining = 0;
        int encoded;
        int guard = 0;

        do {

            encoded =
                in.read();

            if (encoded < 0) {

                throw new IOException(
                    "Conexion cerrada"
                );
            }

            remaining +=
                (encoded & 127)
                * multiplier;

            multiplier *= 128;

            guard++;

            if (guard > 4) {

                throw new IOException(
                    "Remaining Length MQTT invalido"
                );
            }

        } while (
            (encoded & 128) != 0
        );

        byte[] packet =
            new byte[
                1
                + guard
                + remaining
            ];

        packet[0] =
            (byte) type;

        /*
         * Reconstruir Remaining Length.
         */
        int temp =
            remaining;

        for (int i = 0; i < guard; i++) {

            int piece =
                temp % 128;

            temp /= 128;

            if (i < guard - 1) {
                piece |= 0x80;
            }

            packet[1 + i] =
                (byte) piece;
        }

        /*
         * Leer cuerpo.
         */
        int offset =
            1 + guard;

        int read = 0;

        while (
            read < remaining
        ) {

            int n =
                in.read(
                    packet,
                    offset + read,
                    remaining - read
                );

            if (n < 0) {

                throw new IOException(
                    "Conexion cerrada"
                );
            }

            read += n;
        }

        return packet;
    }

    /**
     * Espera sin bloquear el proceso.
     */
    private static void sleep(
        long ms
    ) {

        try {

            Thread.sleep(ms);

        } catch (
            InterruptedException ignored
        ) {

            Thread.currentThread()
                .interrupt();
        }
    }
}