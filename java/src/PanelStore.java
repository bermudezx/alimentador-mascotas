import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Estado compartido del servo.
 * No guarda claves de MQTT.
 */
final class PanelStore {

    static final ZoneId ZONE =
        ZoneId.of("America/Bogota");

    /*
     * IMPORTANTE:
     * ServoServer se ejecuta desde la carpeta java.
     *
     * Por eso el panel.json está en:
     *
     * java/data/panel.json
     *
     * y desde esa carpeta se accede como:
     *
     * data/panel.json
     */
    private static final Path FILE =
        Path.of("data/panel.json");

    boolean running;

    int speed = 100;

    String direction = "cw";

    int autoStopSec;

    long runStartedAt;

    String ssid = "";

    String ip = "";

    String voltage = "5.0 V";

    long boardSeenAt;

    boolean mqttEnabled = true;

    String brokerUrl =
        "wss://broker.emqx.io:8084/mqtt";

    String tcpHost =
        "broker.emqx.io";

    int tcpPort = 1883;

    /*
     * Topic principal del proyecto.
     */
    String topic =
        "alimentador-mascotas-felipe/servo";

    String username = "";

    String mqttStatus = "off";

    final List<HistoryItem> history =
        new ArrayList<>();

    private int nextId = 1;


    static final class HistoryItem {

        final int id;

        final long at;

        final String kind;

        final String label;


        HistoryItem(
            int id,
            long at,
            String kind,
            String label
        ) {

            this.id = id;

            this.at = at;

            this.kind = kind;

            this.label = label;
        }
    }


    void loadOrSeed() {

        if (Files.isRegularFile(FILE)) {

            try {

                applyJson(
                    Files.readString(FILE)
                );

                /*
                 * Nos aseguramos de utilizar el topic
                 * correcto aunque el archivo viejo tenga
                 * una configuración anterior.
                 */
                if (
                    topic == null
                    || topic.isBlank()
                    || topic.equals(
                        "mi-servo/sg5010"
                    )
                ) {

                    topic =
                        "alimentador-mascotas-felipe/servo";
                }

                return;

            } catch (IOException ignored) {

                history.clear();
            }
        }


        long on =
            ZonedDateTime.of(
                2026,
                10,
                1,
                10,
                20,
                0,
                0,
                ZONE
            )
            .toInstant()
            .toEpochMilli();


        remember(
            "off",
            "Apagado",
            on - 40 * 60_000L
        );

        remember(
            "on",
            "Encendido",
            on - 12 * 60_000L
        );

        remember(
            "off",
            "Apagado",
            on - 5 * 60_000L
        );

        save();
    }


    void remember(
        String kind,
        String label,
        long at
    ) {

        history.add(
            0,
            new HistoryItem(
                nextId++,
                at,
                kind,
                label
            )
        );

        if (history.size() > 40) {

            history.remove(
                history.size() - 1
            );
        }
    }


    boolean turnOn() {

        if (running) {
            return false;
        }

        running = true;

        runStartedAt =
            System.currentTimeMillis();

        remember(
            "on",
            "Encendido",
            runStartedAt
        );

        save();

        return true;
    }


    boolean turnOff(
        String label
    ) {

        if (!running) {
            return false;
        }

        running = false;

        runStartedAt = 0;

        remember(
            "off",
            label,
            System.currentTimeMillis()
        );

        save();

        return true;
    }


    void setSpeed(
        int value
    ) {

        speed =
            Math.max(
                0,
                Math.min(
                    100,
                    value
                )
            );

        remember(
            "on",
            "Velocidad " + speed + "%",
            System.currentTimeMillis()
        );

        save();
    }


    void setDirection(
        String value
    ) {

        direction =
            "ccw".equals(value)
                ? "ccw"
                : "cw";

        remember(
            "on",
            "ccw".equals(direction)
                ? "Sentido antihorario"
                : "Sentido horario",
            System.currentTimeMillis()
        );

        save();
    }


    void setAutoStop(
        int seconds
    ) {

        autoStopSec =
            seconds == 5
            || seconds == 10
            || seconds == 30
            || seconds == 60
                ? seconds
                : 0;

        save();
    }


    void noteBoard(
        String nextSsid,
        String nextIp,
        String nextVoltage
    ) {

        if (
            nextSsid != null
            && !nextSsid.isBlank()
        ) {

            ssid =
                clip(
                    nextSsid,
                    32
                );
        }

        if (
            nextIp != null
            && !nextIp.isBlank()
        ) {

            ip =
                clip(
                    nextIp,
                    40
                );
        }

        if (
            nextVoltage != null
            && !nextVoltage.isBlank()
        ) {

            voltage =
                clip(
                    nextVoltage,
                    16
                );
        }

        boardSeenAt =
            System.currentTimeMillis();

        save();
    }


    void expire() {

        long now =
            System.currentTimeMillis();

        if (
            running
            && autoStopSec > 0
            && runStartedAt > 0
            && now >=
                runStartedAt
                + autoStopSec * 1000L
        ) {

            turnOff(
                "Parada automática"
            );
        }
    }


    boolean boardOnline() {

        return
            boardSeenAt > 0
            && System.currentTimeMillis()
                - boardSeenAt
                < 20_000L;
    }


    void syncRunning(
        boolean next
    ) {

        if (running == next) {
            return;
        }

        running = next;

        runStartedAt =
            next
                ? System.currentTimeMillis()
                : 0;

        remember(
            next
                ? "on"
                : "off",

            next
                ? "Encendido"
                : "Apagado",

            System.currentTimeMillis()
        );

        save();
    }


    String commandJson() {

        return
            "{\"running\":"
            + running
            + ",\"speed\":"
            + speed
            + ",\"direction\":\""
            + direction
            + "\",\"autoStopSec\":"
            + autoStopSec
            + "}";
    }


    String toJson() {

        StringBuilder out =
            new StringBuilder(1024);

        out.append(
            "{\"running\":"
        ).append(running);

        out.append(
            ",\"speed\":"
        ).append(speed);

        out.append(
            ",\"direction\":\""
        ).append(direction)
         .append('"');

        out.append(
            ",\"autoStopSec\":"
        ).append(autoStopSec);

        out.append(
            ",\"runStartedAt\":"
        ).append(runStartedAt);

        out.append(
            ",\"online\":true"
        );

        out.append(
            ",\"boardOnline\":"
        ).append(boardOnline());

        out.append(
            ",\"boardSeenAt\":"
        ).append(boardSeenAt);

        out.append(
            ",\"ssid\":\""
        ).append(esc(ssid))
         .append('"');

        out.append(
            ",\"ip\":\""
        ).append(esc(ip))
         .append('"');

        out.append(
            ",\"voltage\":\""
        ).append(esc(voltage))
         .append('"');

        out.append(
            ",\"deviceLabel\":\"ESP32 + SG5010\""
        );

        out.append(
            ",\"mqtt\":\""
        ).append(esc(mqttStatus))
         .append('"');

        out.append(
            ",\"mqttEnabled\":"
        ).append(mqttEnabled);

        out.append(
            ",\"brokerUrl\":\""
        ).append(esc(brokerUrl))
         .append('"');

        out.append(
            ",\"tcpHost\":\""
        ).append(esc(tcpHost))
         .append('"');

        out.append(
            ",\"tcpPort\":"
        ).append(tcpPort);

        out.append(
            ",\"topic\":\""
        ).append(esc(topic))
         .append('"');

        out.append(
            ",\"username\":\""
        ).append(esc(username))
         .append('"');

        out.append(
            ",\"cmdTopic\":\""
        ).append(esc(topic))
         .append("/cmd\"");

        out.append(
            ",\"stateTopic\":\""
        ).append(esc(topic))
         .append("/state\"");

        out.append(
            ",\"history\":["
        );


        for (
            int i = 0;
            i < history.size();
            i++
        ) {

            HistoryItem item =
                history.get(i);

            if (i > 0) {
                out.append(',');
            }

            out.append(
                "{\"id\":"
            ).append(item.id);

            out.append(
                ",\"at\":"
            ).append(item.at);

            out.append(
                ",\"kind\":\""
            ).append(item.kind)
             .append('"');

            out.append(
                ",\"label\":\""
            ).append(
                esc(item.label)
            ).append("\"}");
        }


        out.append("]}");

        return out.toString();
    }


    void save() {

        try {

            Files.createDirectories(
                FILE.getParent()
            );

            Files.writeString(
                FILE,
                toJson(),
                StandardCharsets.UTF_8
            );

        } catch (IOException ignored) {

            /*
             * El estado en memoria continúa funcionando.
             */
        }
    }


    private void applyJson(
        String json
    ) {

        running =
            "true".equals(
                field(
                    json,
                    "running"
                )
            );

        speed =
            clamp(
                number(json, "speed"),
                0,
                100,
                100
            );

        direction =
            "ccw".equals(
                field(
                    json,
                    "direction"
                )
            )
                ? "ccw"
                : "cw";

        autoStopSec =
            number(
                json,
                "autoStopSec"
            );

        runStartedAt =
            longField(
                json,
                "runStartedAt"
            );

        ssid =
            field(
                json,
                "ssid"
            );

        ip =
            field(
                json,
                "ip"
            );

        String savedVoltage =
            field(
                json,
                "voltage"
            );

        if (!savedVoltage.isBlank()) {
            voltage = savedVoltage;
        }

        boardSeenAt =
            longField(
                json,
                "boardSeenAt"
            );

        mqttEnabled =
            !"false".equals(
                field(
                    json,
                    "mqttEnabled"
                )
            );

        String url =
            field(
                json,
                "brokerUrl"
            );

        if (!url.isBlank()) {
            brokerUrl = url;
        }

        String host =
            field(
                json,
                "tcpHost"
            );

        if (!host.isBlank()) {
            tcpHost = host;
        }

        int port =
            number(
                json,
                "tcpPort"
            );

        if (port > 0) {
            tcpPort = port;
        }

        String savedTopic =
            field(
                json,
                "topic"
            );

        if (
            !savedTopic.isBlank()
            && !savedTopic.equals(
                "mi-servo/sg5010"
            )
        ) {

            topic =
                topicOf(savedTopic);

        } else {

            topic =
                "alimentador-mascotas-felipe/servo";
        }

        username =
            field(
                json,
                "username"
            );


        int from =
            json.indexOf(
                "\"history\":"
            );

        if (from >= 0) {

            int cursor =
                json.indexOf(
                    '[',
                    from
                );

            while (cursor >= 0) {

                int idAt =
                    json.indexOf(
                        "\"id\":",
                        cursor + 1
                    );

                int endArray =
                    json.indexOf(
                        ']',
                        cursor
                    );

                if (
                    idAt < 0
                    || (
                        endArray >= 0
                        && idAt > endArray
                    )
                ) {
                    break;
                }

                int id =
                    numberAt(
                        json,
                        idAt + 5
                    );

                long at =
                    longField(
                        slice(
                            json,
                            idAt,
                            idAt + 80
                        ),
                        "at"
                    );

                String kind =
                    "off".equals(
                        field(
                            slice(
                                json,
                                idAt,
                                idAt + 160
                            ),
                            "kind"
                        )
                    )
                        ? "off"
                        : "on";

                String label =
                    field(
                        slice(
                            json,
                            idAt,
                            idAt + 220
                        ),
                        "label"
                    );

                if (id >= nextId) {
                    nextId =
                        id + 1;
                }

                history.add(
                    new HistoryItem(
                        id,
                        at,
                        kind,
                        label
                    )
                );

                cursor = idAt;

                if (history.size() >= 40) {
                    break;
                }
            }
        }
    }


    private static String slice(
        String json,
        int start,
        int end
    ) {

        return json.substring(
            start,
            Math.min(
                json.length(),
                end
            )
        );
    }


    static String field(
        String json,
        String key
    ) {

        if (json == null) {
            return "";
        }

        String needle =
            "\"" + key + "\":";

        int at =
            json.indexOf(
                needle
            );

        if (at < 0) {
            return "";
        }

        at += needle.length();

        while (
            at < json.length()
            && json.charAt(at) == ' '
        ) {
            at++;
        }

        if (at >= json.length()) {
            return "";
        }

        if (
            json.charAt(at) == '"'
        ) {

            int end =
                json.indexOf(
                    '"',
                    at + 1
                );

            return
                end < 0
                    ? ""
                    : json.substring(
                        at + 1,
                        end
                    );
        }

        int end = at;

        while (
            end < json.length()
            && ",}]".indexOf(
                json.charAt(end)
            ) < 0
        ) {
            end++;
        }

        return json.substring(
            at,
            end
        ).trim();
    }


    static int number(
        String json,
        String key
    ) {

        int at =
            json.indexOf(
                "\"" + key + "\":"
            );

        if (at < 0) {
            return 0;
        }

        return numberAt(
            json,
            at + key.length() + 3
        );
    }


    static long longField(
        String json,
        String key
    ) {

        String raw =
            field(
                json,
                key
            ).replaceAll(
                "[^0-9-]",
                ""
            );

        if (
            raw.isBlank()
            || "-".equals(raw)
        ) {
            return 0;
        }

        try {

            return Long.parseLong(raw);

        } catch (
            NumberFormatException ignored
        ) {

            return 0;
        }
    }


    private static int numberAt(
        String json,
        int at
    ) {

        if (
            at < 0
            || at >= json.length()
        ) {
            return 0;
        }

        while (
            at < json.length()
            && (
                json.charAt(at) == ' '
                || json.charAt(at) == ':'
            )
        ) {
            at++;
        }

        int end = at;

        if (
            end < json.length()
            && (
                json.charAt(end) == '-'
                || Character.isDigit(
                    json.charAt(end)
                )
            )
        ) {

            end++;

            while (
                end < json.length()
                && Character.isDigit(
                    json.charAt(end)
                )
            ) {
                end++;
            }

            try {

                return Integer.parseInt(
                    json.substring(
                        at,
                        end
                    )
                );

            } catch (
                NumberFormatException ignored
            ) {

                return 0;
            }
        }

        return 0;
    }


    private static int clamp(
        int value,
        int min,
        int max,
        int fallback
    ) {

        if (
            value < min
            || value > max
        ) {
            return fallback;
        }

        return value;
    }


    static String esc(
        String value
    ) {

        if (value == null) {
            return "";
        }

        return value
            .replace(
                "\\",
                "\\\\"
            )
            .replace(
                "\"",
                "\\\""
            )
            .replace(
                "\n",
                ""
            )
            .replace(
                "\r",
                "");
    }


    static String clip(
        String value,
        int max
    ) {

        String cleaned =
            value.trim();

        return
            cleaned.length() <= max
                ? cleaned
                : cleaned.substring(
                    0,
                    max
                );
    }


    static String topicOf(
        String value
    ) {

        String cleaned =
            value == null
                ? ""
                : value
                    .replaceAll(
                        "[^\\w./-]",
                        ""
                    )
                    .replaceAll(
                        "^/+|/+$",
                        ""
                    );

        if (
            cleaned.isBlank()
            || cleaned.length() > 64
        ) {

            return
                "alimentador-mascotas-felipe/servo";
        }

        return cleaned;
    }


    long seenAge() {

        return
            boardSeenAt == 0
                ? -1
                : Instant.now()
                    .toEpochMilli()
                    - boardSeenAt;
    }
}