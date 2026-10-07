import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** Servidor del panel. Escucha en 127.0.0.1:8090 y el sitio le reenvía /api/panel. */
public final class ServoServer {
  private static final PanelStore store = new PanelStore();
  private static final MqttSession mqtt = new MqttSession(store);

  public static void main(String[] args) throws IOException {
    synchronized (store) {
      store.loadOrSeed();
    }
    Thread link = new Thread(mqtt, "mqtt");
    link.setDaemon(true);
    link.start();
    Thread stopper = new Thread(ServoServer::watchAutoStop, "auto-stop");
    stopper.setDaemon(true);
    stopper.start();

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 8090), 0);
    server.createContext("/api/panel", ServoServer::handle);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.start();
    System.out.println("servo java listo");
  }

  private static void watchAutoStop() {
    while (true) {
      String command = null;
      synchronized (store) {
        boolean was = store.running;
        store.expire();
        if (was && !store.running) command = store.commandJson();
      }
      if (command != null) mqtt.publish(command);
      try {
        Thread.sleep(400);
      } catch (InterruptedException ignored) {
        return;
      }
    }
  }

  private static void handle(HttpExchange exchange) throws IOException {
    try {
      if ("GET".equals(exchange.getRequestMethod())) {
        synchronized (store) {
          store.expire();
          send(exchange, 200, store.toJson());
        }
        return;
      }
      if (!"POST".equals(exchange.getRequestMethod())) {
        send(exchange, 405, "{\"ok\":false}");
        return;
      }
      String body = read(exchange);
      String op = PanelStore.field(body, "op");
      String command = null;
      boolean mqttConfig = false;
      synchronized (store) {
        switch (op) {
          case "on" -> {
            if (store.turnOn()) command = store.commandJson();
          }
          case "off" -> {
            if (store.turnOff("Apagado")) command = store.commandJson();
          }
          case "speed" -> {
            store.setSpeed(PanelStore.number(body, "speed"));
            command = store.commandJson();
          }
          case "direction" -> {
            store.setDirection(PanelStore.field(body, "direction"));
            command = store.commandJson();
          }
          case "autostop" -> store.setAutoStop(PanelStore.number(body, "autoStopSec"));
          case "device" -> store.noteBoard(
              PanelStore.field(body, "ssid"),
              PanelStore.field(body, "ip"),
              PanelStore.field(body, "voltage"));
          case "mqtt" -> {
            store.mqttEnabled = !"false".equals(PanelStore.field(body, "enabled"));
            String url = PanelStore.field(body, "brokerUrl");
            if (!url.isBlank()) store.brokerUrl = PanelStore.clip(url, 160);
            String host = PanelStore.field(body, "tcpHost");
            if (!host.isBlank()) store.tcpHost = PanelStore.clip(host, 80);
            int port = PanelStore.number(body, "tcpPort");
            if (port > 0 && port < 65536) store.tcpPort = port;
            store.topic = PanelStore.topicOf(PanelStore.field(body, "topic"));
            store.username = PanelStore.clip(PanelStore.field(body, "username"), 64);
            mqtt.setPassword(PanelStore.field(body, "password"));
            store.save();
            mqttConfig = true;
          }
          default -> {
            // unknown op still returns the current panel
          }
        }
        store.expire();
      }
      if (mqttConfig) mqtt.reconnect();
      if (command != null) mqtt.publish(command);
      synchronized (store) {
        send(exchange, 200, store.toJson());
      }
    } catch (RuntimeException | IOException error) {
      send(exchange, 500, "{\"online\":false}");
    }
  }

  private static String read(HttpExchange exchange) throws IOException {
    try (InputStream in = exchange.getRequestBody()) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  private static void send(HttpExchange exchange, int status, String json) throws IOException {
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("content-type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
