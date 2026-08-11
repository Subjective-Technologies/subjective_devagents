package chat.subjective.mobile;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLSocketFactory;

@CapacitorPlugin(name = "SubjectiveIrc")
public class SubjectiveIrcPlugin extends Plugin {
    private static final String PREFS = "subjective_irc";
    private static final String DEFAULT_NAME = "Subjective LAN";
    private static final String DEFAULT_HOST = "192.168.0.250";
    private static final int DEFAULT_PORT = 6667;
    private static final boolean DEFAULT_TLS = false;
    private static final String DEFAULT_CHANNEL = "#subjective";
    private static final String DEFAULT_NICK = "Tomasso";
    private static final String DEFAULT_REALNAME = "Tomasso";
    private static final String NOTIFICATION_CHANNEL_ID = "subjective_messages";

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, UserRecord> channelUsers = new LinkedHashMap<>();
    private final List<String> namesBuffer = new ArrayList<>();
    private final List<ConnectionConfig> bookmarks = new ArrayList<>();

    private Socket socket;
    private BufferedReader reader;
    private OutputStream writer;
    private boolean connected;
    private boolean registered;
    private String name = DEFAULT_NAME;
    private String host = DEFAULT_HOST;
    private int port = DEFAULT_PORT;
    private boolean useTls = DEFAULT_TLS;
    private String channel = DEFAULT_CHANNEL;
    private String nick = DEFAULT_NICK;
    private String realname = DEFAULT_REALNAME;
    private String currentNick = DEFAULT_NICK;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private int notificationId = 1000;

    @Override
    public void load() {
        super.load();
        loadSettings();
        createNotificationChannel();
        requestNotificationPermission();
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        loadSettings();
        call.resolve(publicConfig());
    }

    @PluginMethod
    public void saveConfig(PluginCall call) {
        ConnectionConfig next = ConnectionConfig.fromJson(call.getObject("active") == null ? call.getData() : call.getObject("active"));
        applyConnection(next);
        if (call.getBoolean("saveBookmark", true)) ensureBookmark(next);
        saveSettings();
        emitConfig();
        emitSystem(channel, "Connection set to " + host + ":" + port + " " + channel);
        restartConnection();
        JSObject result = ok();
        result.put("config", publicConfig());
        call.resolve(result);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        io.execute(this::connectIrc);
        call.resolve(ok());
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        io.execute(this::disconnectIrc);
        call.resolve(ok());
    }

    @PluginMethod
    public void sendMessage(PluginCall call) {
        String target = valueOr(call.getString("target"), channel);
        String text = valueOr(call.getString("text"), "").replaceAll("[\\r\\n]+", " ").trim();
        if (text.isEmpty()) {
            call.resolve(failed());
            return;
        }
        io.execute(() -> {
            boolean sent = writeIrc("PRIVMSG " + target + " :" + text);
            if (sent) {
                JSObject event = baseEvent("message", target);
                event.put("from", currentNick);
                event.put("text", text);
                event.put("mine", true);
                event.put("time", System.currentTimeMillis());
                event.put("private", !target.startsWith("#"));
                emit(event);
            }
        });
        call.resolve(ok());
    }

    @PluginMethod
    public void sendImage(PluginCall call) {
        emitSystem(valueOr(call.getString("target"), channel), "Use paste or Android share-to-copy for images in this build.");
        call.resolve(failed());
    }

    @PluginMethod
    public void sendImageData(PluginCall call) {
        String target = valueOr(call.getString("target"), channel);
        String fileName = valueOr(call.getString("fileName"), "pasted-" + System.currentTimeMillis() + ".png");
        String mimeType = valueOr(call.getString("mimeType"), "image/png");
        JSArray byteArray = call.getArray("bytes");
        if (byteArray == null) {
            call.resolve(failed());
            return;
        }
        try {
            byte[] bytes = bytesFromArray(byteArray);
            io.execute(() -> sendDccBuffer(target, fileName, mimeType, bytes));
            call.resolve(ok());
        } catch (JSONException error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        call.resolve(ok());
    }

    @PluginMethod
    public void log(PluginCall call) {
        call.resolve(ok());
    }

    @PluginMethod
    public void executeCommand(PluginCall call) {
        String commandLine = valueOr(call.getString("command"), "");
        String target = valueOr(call.getString("target"), channel);
        if (commandLine.isEmpty()) {
            call.resolve(failed());
            return;
        }
        JSObject result = executeSlashCommand(commandLine, target);
        call.resolve(result);
    }

    private JSObject executeSlashCommand(String commandLine, String defaultTarget) {
        String raw = valueOr(commandLine, "");
        if (raw.isEmpty()) return failed();

        String command = raw.startsWith("/") ? raw.substring(1) : raw;
        int spaceIndex = command.indexOf(' ');
        String name = (spaceIndex == -1 ? command : command.substring(0, spaceIndex)).toLowerCase(Locale.ROOT);
        String argsText = spaceIndex == -1 ? "" : command.substring(spaceIndex + 1).trim();
        String target = valueOr(defaultTarget, channel);

        switch (name) {
            case "server": {
                ConnectionConfig next = parseServerConnection(argsText);
                if (next == null) return failed();
                applyConnection(next);
                ensureBookmark(next);
                saveSettings();
                emitConfig();
                emitSystem(channel, "Connection set to " + host + ":" + port + " " + channel);
                restartConnection();
                JSObject result = ok();
                result.put("focusTarget", next.channel);
                return result;
            }
            case "nick": {
                String nextNick = firstToken(argsText);
                if (nextNick.isEmpty()) return failed();
                if (!writeIrc("NICK " + nextNick)) return failed();
                nick = nextNick;
                currentNick = nextNick;
                saveSettings();
                emitConfig();
                emitSystem(channel, "Nickname changed to " + nextNick);
                return ok();
            }
            case "join": {
                String nextChannel = firstToken(argsText);
                if (nextChannel.isEmpty()) return failed();
                String channelName = normalizeChannel(nextChannel);
                channel = channelName;
                saveSettings();
                emitConfig();
                channelUsers.clear();
                namesBuffer.clear();
                emitUsers();
                if (!writeIrc("JOIN " + channelName)) return failed();
                writeIrc("NAMES " + channelName);
                emitSystem(channelName, "Joining " + channelName);
                JSObject result = ok();
                result.put("focusTarget", channelName);
                return result;
            }
            case "part": {
                String partTarget = firstToken(argsText);
                String partReason = remainderAfterFirstToken(argsText);
                String actualTarget = partTarget.startsWith("#") ? partTarget : target;
                String actualReason = partTarget.startsWith("#") ? partReason : argsText;
                if (actualTarget.isEmpty()) return failed();
                channelUsers.clear();
                namesBuffer.clear();
                emitUsers();
                String commandLineText = actualReason.isEmpty()
                    ? "PART " + actualTarget
                    : "PART " + actualTarget + " :" + actualReason;
                if (!writeIrc(commandLineText)) return failed();
                emitSystem(actualTarget, "Parted " + actualTarget);
                return ok();
            }
            case "msg": {
                String msgTarget = firstToken(argsText);
                String msgText = remainderAfterFirstToken(argsText);
                if (msgTarget.isEmpty() || msgText.isEmpty()) return failed();
                if (!writeIrc("PRIVMSG " + msgTarget + " :" + msgText)) return failed();
                emitMessage(msgTarget, currentNick, msgText, true);
                JSObject result = ok();
                result.put("focusTarget", msgTarget);
                return result;
            }
            case "query": {
                String queryTarget = firstToken(argsText);
                String queryText = remainderAfterFirstToken(argsText);
                if (queryTarget.isEmpty()) return failed();
                if (!queryText.isEmpty() && !writeIrc("PRIVMSG " + queryTarget + " :" + queryText)) return failed();
                if (!queryText.isEmpty()) emitMessage(queryTarget, currentNick, queryText, true);
                JSObject result = ok();
                result.put("focusTarget", queryTarget);
                return result;
            }
            case "me": {
                if (argsText.isEmpty()) return failed();
                if (!sendAction(target, argsText)) return failed();
                emitMessage(target, currentNick, "* " + currentNick + " " + argsText, true);
                return ok();
            }
            case "notice": {
                String noticeTarget = firstToken(argsText);
                String noticeText = remainderAfterFirstToken(argsText);
                if (noticeTarget.isEmpty() || noticeText.isEmpty()) return failed();
                if (!writeIrc("NOTICE " + noticeTarget + " :" + noticeText)) return failed();
                emitSystem(noticeTarget, "Notice to " + noticeTarget + ": " + noticeText);
                JSObject result = ok();
                result.put("focusTarget", noticeTarget);
                return result;
            }
            case "topic": {
                if (argsText.isEmpty()) return failed();
                if (!writeIrc("TOPIC " + target + " :" + argsText)) return failed();
                emitSystem(target, "Topic updated for " + target);
                return ok();
            }
            case "names": {
                String namesTarget = firstToken(argsText);
                if (!namesTarget.startsWith("#")) namesTarget = target;
                if (!writeIrc("NAMES " + namesTarget)) return failed();
                JSObject result = ok();
                result.put("focusTarget", namesTarget);
                return result;
            }
            case "whois": {
                String whoisTarget = firstToken(argsText);
                if (whoisTarget.isEmpty()) return failed();
                if (!writeIrc("WHOIS " + whoisTarget)) return failed();
                JSObject result = ok();
                result.put("focusTarget", whoisTarget);
                return result;
            }
            case "away": {
                if (!writeIrc(argsText.isEmpty() ? "AWAY" : "AWAY :" + argsText)) return failed();
                emitSystem(target, argsText.isEmpty() ? "Away cleared" : "Set away: " + argsText);
                return ok();
            }
            case "connect":
                restartConnection();
                return ok();
            case "disconnect":
            case "quit":
                io.execute(() -> disconnectIrc(true));
                return ok();
            case "raw":
                if (!writeIrc(argsText.isEmpty() ? command : argsText)) return failed();
                return ok();
            default:
                if (!writeIrc(command)) return failed();
                return ok();
        }
    }

    private void emitMessage(String target, String from, String text, boolean mine) {
        JSObject event = baseEvent("message", target);
        event.put("from", from);
        event.put("text", text);
        event.put("mine", mine);
        event.put("time", System.currentTimeMillis());
        event.put("private", !target.startsWith("#"));
        emit(event);
    }

    private boolean sendAction(String target, String text) {
        return writeIrc("PRIVMSG " + target + " :\u0001ACTION " + text + "\u0001");
    }

    private void waitForSocketClose() {
        for (int i = 0; i < 50; i++) {
            if (socket == null) return;
            try {
                Thread.sleep(100);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void restartConnection() {
        io.execute(() -> {
            disconnectIrc(false);
            waitForSocketClose();
            connectIrc();
        });
    }

    private static String firstToken(String value) {
        String next = valueOr(value, "");
        int space = next.indexOf(' ');
        return space == -1 ? next.trim() : next.substring(0, space).trim();
    }

    private static String remainderAfterFirstToken(String value) {
        String next = valueOr(value, "");
        int space = next.indexOf(' ');
        return space == -1 ? "" : next.substring(space + 1).trim();
    }

    private ConnectionConfig parseServerConnection(String argsText) {
        List<String> tokens = new ArrayList<>();
        for (String token : valueOr(argsText, "").trim().split("\\s+")) {
            if (!token.isEmpty()) tokens.add(token);
        }
        if (tokens.isEmpty()) return null;

        boolean nextTls = useTls;
        for (int i = 0; i < tokens.size(); i++) {
            if (isTlsToken(tokens.get(i))) {
                nextTls = isTlsTokenValue(tokens.remove(i));
                break;
            }
        }

        String nextHost = tokens.isEmpty() ? "" : tokens.remove(0);
        if (nextHost.isEmpty()) return null;

        int nextPort = port;
        if (!tokens.isEmpty() && tokens.get(0).matches("^\\d+$")) nextPort = Integer.parseInt(tokens.remove(0));

        String nextChannel = channel;
        if (!tokens.isEmpty() && tokens.get(0).startsWith("#")) nextChannel = tokens.remove(0);

        String nextNick = nick;
        if (!tokens.isEmpty() && !tokens.get(0).matches("^\\d+$") && !tokens.get(0).startsWith("#")) nextNick = tokens.remove(0);

        String nextRealname = tokens.isEmpty() ? nextNick : joinTokens(tokens);
        return new ConnectionConfig(name, nextHost, nextPort, nextTls, nextChannel, nextNick, nextRealname);
    }

    private static boolean isTlsToken(String value) {
        return value != null && value.matches("(?i)^(1|true|yes|on|tls|ssl)$");
    }

    private static boolean isTlsTokenValue(String value) {
        return value != null && value.matches("(?i)^(1|true|yes|on|tls|ssl)$");
    }

    private static String joinTokens(List<String> tokens) {
        StringBuilder result = new StringBuilder();
        for (String token : tokens) {
            if (result.length() > 0) result.append(' ');
            result.append(token);
        }
        return result.toString();
    }

    private void connectIrc() {
        if (socket != null) return;
        try {
            startConnectionService("Connecting to " + host + ":" + port);
            emitStatus("reconnecting", "Connecting...");
            socket = useTls
                ? SSLSocketFactory.getDefault().createSocket(host, port)
                : new Socket(host, port);
            reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            writer = socket.getOutputStream();
            connected = true;
            registered = false;
            acquireWakeLock();
            currentNick = nick;
            channelUsers.clear();
            namesBuffer.clear();
            updateConnectionService("Connected to " + host + ":" + port);
            emitStatus("connected", "Connected to " + host + ":" + port);
            writeIrc("NICK " + nick);
            writeIrc("USER " + nick + " 0 * :" + realname);
            String line;
            while ((line = reader.readLine()) != null) handleIrcLine(line);
        } catch (Exception error) {
            emitStatus("error", error.getMessage());
        } finally {
            connected = false;
            registered = false;
            closeSocket();
            releaseWakeLock();
            emitStatus("disconnected", "Disconnected");
            emitUsers();
        }
    }

    private void disconnectIrc() {
        disconnectIrc(false);
    }

    private void disconnectIrc(boolean stopService) {
        if (connected) writeIrc("QUIT :Subjective Chat Android closed");
        closeSocket();
        if (stopService) stopConnectionService();
    }

    private void closeSocket() {
        try {
            if (socket != null) socket.close();
        } catch (Exception ignored) {
        }
        socket = null;
        reader = null;
        writer = null;
    }

    private boolean writeIrc(String command) {
        if (writer == null || !connected) return false;
        try {
            writer.write((command + "\r\n").getBytes(StandardCharsets.UTF_8));
            writer.flush();
            return true;
        } catch (Exception error) {
            emitStatus("error", error.getMessage());
            return false;
        }
    }

    private void handleIrcLine(String line) {
        IrcMessage message = parseIrcLine(line);
        if ("PING".equals(message.command)) {
            writeIrc("PONG :" + firstParam(message));
            return;
        }
        if ("001".equals(message.command)) {
            registered = true;
            writeIrc("JOIN " + channel);
            writeIrc("NAMES " + channel);
            emitSystem(channel, "Joined " + channel);
            return;
        }
        if ("353".equals(message.command)) {
            if (message.params.size() > 3 && isConfiguredChannel(message.params.get(2))) {
                Collections.addAll(namesBuffer, message.params.get(3).split("\\s+"));
            }
            return;
        }
        if ("366".equals(message.command)) {
            channelUsers.clear();
            for (String userNick : namesBuffer) setChannelUser(userNick);
            namesBuffer.clear();
            emitUsers();
            return;
        }
        if ("433".equals(message.command)) {
            emitStatus("error", nick + " is already in use.");
            return;
        }
        if ("JOIN".equals(message.command) && !message.params.isEmpty() && isConfiguredChannel(message.params.get(0))) {
            String userNick = nickFromPrefix(message.prefix);
            setChannelUser(userNick);
            emitUsers();
            JSObject event = baseEvent("join", channel);
            event.put("nick", userNick);
            event.put("channel", cleanChannelName(message.params.get(0)));
            emit(event);
            return;
        }
        if ("PART".equals(message.command) && !message.params.isEmpty() && isConfiguredChannel(message.params.get(0))) {
            String userNick = nickFromPrefix(message.prefix);
            removeChannelUser(userNick);
            emitUsers();
            JSObject event = baseEvent("part", channel);
            event.put("nick", userNick);
            emit(event);
            return;
        }
        if ("QUIT".equals(message.command)) {
            String userNick = nickFromPrefix(message.prefix);
            removeChannelUser(userNick);
            emitUsers();
            JSObject event = baseEvent("part", channel);
            event.put("nick", userNick);
            emit(event);
            return;
        }
        if ("NICK".equals(message.command) && !message.params.isEmpty()) {
            String oldNick = nickFromPrefix(message.prefix);
            String newNick = message.params.get(0);
            if (oldNick.equalsIgnoreCase(currentNick)) currentNick = newNick;
            renameChannelUser(oldNick, newNick);
            emitUsers();
            emitSystem(channel, oldNick + " is now " + newNick);
            return;
        }
        if ("PRIVMSG".equals(message.command) && message.params.size() > 1) {
            String from = nickFromPrefix(message.prefix);
            String target = message.params.get(0);
            String text = message.params.get(1);
            if (text.startsWith("\u0001") && text.endsWith("\u0001")) {
                handleCtcp(from, target, text.substring(1, text.length() - 1));
                return;
            }
            String conversation = conversationTarget(target, from);
            JSObject event = baseEvent("message", conversation);
            event.put("from", from);
            event.put("text", text);
            event.put("mine", from.equalsIgnoreCase(currentNick));
            event.put("time", System.currentTimeMillis());
            event.put("private", conversation.equals(from));
            emit(event);
            showNotification(from + " in " + conversation, text);
        }
    }

    private void handleCtcp(String from, String target, String body) {
        if ("VERSION".equals(body)) {
            writeIrc("NOTICE " + from + " :\u0001VERSION Subjective Chat Android IRC client\u0001");
            return;
        }
        if (!body.startsWith("DCC ")) return;
        List<String> parts = splitDcc(body);
        if (parts.size() < 5 || !"SEND".equals(parts.get(1))) return;
        String fileName = parts.get(2);
        String dccHost = decodeDccAddress(parts.get(3));
        int dccPort = Integer.parseInt(parts.get(4));
        String contextTarget = dccContextTarget(parts);
        String conversation = contextTarget.isEmpty() ? conversationTarget(target, from) : contextTarget;
        io.execute(() -> receiveDccFile(from, conversation, fileName, dccHost, dccPort));
    }

    private void receiveDccFile(String from, String target, String fileName, String dccHost, int dccPort) {
        emitSystem(target, "Receiving " + fileName + " from " + from);
        try (Socket incoming = new Socket(dccHost, dccPort);
             InputStream input = incoming.getInputStream();
             OutputStream output = incoming.getOutputStream();
             ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int read;
            int received = 0;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
                received += read;
                output.write(new byte[] {
                    (byte) (received >> 24),
                    (byte) (received >> 16),
                    (byte) (received >> 8),
                    (byte) received
                });
                output.flush();
            }
            emitImage(target, "incoming", from, fileName, buffer.toByteArray(), mimeFor(fileName));
            showNotification(from + " in " + target, "Picture: " + fileName);
        } catch (Exception error) {
            emitSystem(target, "DCC error for " + fileName + ": " + error.getMessage());
        }
    }

    private void sendDccBuffer(String target, String fileName, String mimeType, byte[] bytes) {
        if (!registered) {
            emitSystem(target, "Connect before sending an image.");
            return;
        }
        List<String> recipients = target.startsWith("#") ? channelRecipients() : Collections.singletonList(target);
        if (recipients.isEmpty()) emitSystem(target, "No DCC recipients are available.");
        for (String recipient : recipients) announceDccSend(recipient, fileName, bytes, target.startsWith("#") ? target : "");
        emitImage(target, "outgoing", currentNick, fileName, bytes, mimeType);
    }

    private void announceDccSend(String recipient, String fileName, byte[] bytes, String sourceTarget) {
        try (ServerSocket server = new ServerSocket(0)) {
            String dccHost = localDccHost();
            int dccPort = server.getLocalPort();
            String quoted = fileName.contains(" ") ? "\"" + fileName + "\"" : fileName;
            String context = sourceTarget.isEmpty() ? "" : " SUBJECTIVE_TARGET " + encodeURIComponent(sourceTarget);
            writeIrc("PRIVMSG " + recipient + " :\u0001DCC SEND " + quoted + " " + encodeDccAddress(dccHost) + " " + dccPort + " " + bytes.length + context + "\u0001");
            server.setSoTimeout(120000);
            try (Socket peer = server.accept(); OutputStream output = peer.getOutputStream()) {
                output.write(bytes);
                output.flush();
            }
        } catch (Exception error) {
            emitSystem(channel, "DCC send failed for " + fileName + ": " + error.getMessage());
        }
    }

    private JSObject publicConfig() {
        JSObject result = new JSObject();
        result.put("name", name);
        result.put("host", host);
        result.put("port", port);
        result.put("tls", useTls);
        result.put("channel", channel);
        result.put("nick", nick);
        result.put("realname", realname);
        result.put("downloadDir", "Android app storage");
        JSArray saved = new JSArray();
        for (ConnectionConfig bookmark : bookmarks) saved.put(bookmark.toJson());
        result.put("bookmarks", saved);
        return result;
    }

    private void emitConfig() {
        JSObject event = publicConfig();
        event.put("type", "config");
        emit(event);
    }

    private void loadSettings() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        name = prefs.getString("name", DEFAULT_NAME);
        host = prefs.getString("host", DEFAULT_HOST);
        port = prefs.getInt("port", DEFAULT_PORT);
        useTls = prefs.getBoolean("tls", DEFAULT_TLS);
        channel = normalizeChannel(prefs.getString("channel", DEFAULT_CHANNEL));
        nick = prefs.getString("nick", DEFAULT_NICK);
        realname = prefs.getString("realname", nick);
        currentNick = nick;
        bookmarks.clear();
        String rawBookmarks = prefs.getString("bookmarks", "");
        if (!rawBookmarks.isEmpty()) {
            try {
                JSONArray array = new JSONArray(rawBookmarks);
                for (int i = 0; i < array.length(); i++) bookmarks.add(ConnectionConfig.fromJson(array.getJSONObject(i)));
            } catch (Exception ignored) {
            }
        }
        ensureBookmark(activeConnection());
    }

    private void saveSettings() {
        JSONArray array = new JSONArray();
        for (ConnectionConfig bookmark : bookmarks) array.put(bookmark.toJson());
        getContext().getSharedPreferences(PREFS, 0).edit()
            .putString("name", name)
            .putString("host", host)
            .putInt("port", port)
            .putBoolean("tls", useTls)
            .putString("channel", channel)
            .putString("nick", nick)
            .putString("realname", realname)
            .putString("bookmarks", array.toString())
            .apply();
    }

    private ConnectionConfig activeConnection() {
        return new ConnectionConfig(name, host, port, useTls, channel, nick, realname);
    }

    private void applyConnection(ConnectionConfig next) {
        name = next.name;
        host = next.host;
        port = next.port;
        useTls = next.tls;
        channel = next.channel;
        nick = next.nick;
        realname = next.realname;
        currentNick = nick;
        channelUsers.clear();
        namesBuffer.clear();
    }

    private void ensureBookmark(ConnectionConfig next) {
        String key = next.key();
        bookmarks.removeIf(item -> item.key().equals(key));
        bookmarks.add(0, next);
        while (bookmarks.size() > 24) bookmarks.remove(bookmarks.size() - 1);
    }

    private IrcMessage parseIrcLine(String line) {
        String rest = line;
        String prefix = "";
        if (rest.startsWith(":")) {
            int space = rest.indexOf(' ');
            prefix = rest.substring(1, space);
            rest = rest.substring(space + 1);
        }
        String trailing = null;
        int trailingIndex = rest.indexOf(" :");
        if (trailingIndex >= 0) {
            trailing = rest.substring(trailingIndex + 2);
            rest = rest.substring(0, trailingIndex);
        }
        String[] rawParts = rest.trim().isEmpty() ? new String[0] : rest.trim().split("\\s+");
        String command = rawParts.length == 0 ? "" : rawParts[0];
        List<String> params = new ArrayList<>();
        for (int i = 1; i < rawParts.length; i++) params.add(rawParts[i]);
        if (trailing != null) params.add(trailing);
        return new IrcMessage(prefix, command, params);
    }

    private void emitStatus(String state, String text) {
        JSObject event = new JSObject();
        event.put("type", "status");
        event.put("state", state);
        event.put("text", text == null ? "" : text);
        emit(event);
    }

    private void emitSystem(String target, String text) {
        JSObject event = baseEvent("system", target);
        event.put("text", text);
        emit(event);
    }

    private void emitUsers() {
        JSArray users = new JSArray();
        List<UserRecord> sorted = new ArrayList<>(channelUsers.values());
        sorted.sort((a, b) -> a.nick.compareToIgnoreCase(b.nick));
        for (UserRecord user : sorted) {
            JSObject item = new JSObject();
            item.put("nick", user.nick);
            item.put("modes", user.modes);
            item.put("self", user.nick.equalsIgnoreCase(currentNick));
            users.put(item);
        }
        JSObject event = new JSObject();
        event.put("type", "users");
        event.put("channel", channel);
        event.put("users", users);
        emit(event);
    }

    private void emitImage(String target, String direction, String from, String fileName, byte[] bytes, String mimeType) {
        JSObject event = baseEvent("dcc-complete", target);
        event.put("direction", direction);
        event.put("from", from);
        event.put("fileName", fileName);
        event.put("filePath", "");
        event.put("url", "data:" + valueOr(mimeType, "image/png") + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
        event.put("size", bytes.length);
        event.put("image", true);
        emit(event);
    }

    private void emit(JSObject event) {
        main.post(() -> notifyListeners("appEvent", event, true));
    }

    private JSObject baseEvent(String type, String target) {
        JSObject event = new JSObject();
        event.put("type", type);
        event.put("target", valueOr(target, channel));
        return event;
    }

    private JSObject ok() {
        JSObject result = new JSObject();
        result.put("ok", true);
        return result;
    }

    private JSObject failed() {
        JSObject result = new JSObject();
        result.put("ok", false);
        return result;
    }

    private static String valueOr(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static byte[] bytesFromArray(JSONArray array) throws JSONException {
        byte[] bytes = new byte[array.length()];
        for (int i = 0; i < array.length(); i++) bytes[i] = (byte) (array.getInt(i) & 0xff);
        return bytes;
    }

    private static String firstParam(IrcMessage message) {
        return message.params.isEmpty() ? "" : message.params.get(0);
    }

    private static String nickFromPrefix(String prefix) {
        int bang = prefix.indexOf('!');
        return bang >= 0 ? prefix.substring(0, bang) : prefix;
    }

    private static List<String> splitDcc(String body) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < body.length(); i++) {
            char value = body.charAt(i);
            if (value == '"') {
                quoted = !quoted;
                continue;
            }
            if (Character.isWhitespace(value) && !quoted) {
                if (current.length() > 0) {
                    parts.add(current.toString());
                    current.setLength(0);
                }
                continue;
            }
            current.append(value);
        }
        if (current.length() > 0) parts.add(current.toString());
        return parts;
    }

    private static String dccContextTarget(List<String> parts) {
        int index = parts.indexOf("SUBJECTIVE_TARGET");
        if (index == -1 || index + 1 >= parts.size()) return "";
        return decodeURIComponent(parts.get(index + 1));
    }

    private static String encodeURIComponent(String value) {
        return value.replace("%", "%25").replace("#", "%23").replace(" ", "%20");
    }

    private static String decodeURIComponent(String value) {
        return value.replace("%23", "#").replace("%20", " ").replace("%25", "%");
    }

    private static String normalizeNick(String rawNick) {
        return rawNick.replaceFirst("^[~&@%+]+", "");
    }

    private void setChannelUser(String rawNick) {
        if (rawNick == null || rawNick.trim().isEmpty()) return;
        String modes = rawNick.replaceFirst("^([~&@%+]*).*$", "$1");
        String userNick = normalizeNick(rawNick);
        channelUsers.put(userNick.toLowerCase(Locale.ROOT), new UserRecord(userNick, modes));
    }

    private void removeChannelUser(String userNick) {
        channelUsers.remove(userNick.toLowerCase(Locale.ROOT));
    }

    private void renameChannelUser(String oldNick, String newNick) {
        UserRecord record = channelUsers.remove(oldNick.toLowerCase(Locale.ROOT));
        if (record != null) channelUsers.put(newNick.toLowerCase(Locale.ROOT), new UserRecord(newNick, record.modes));
    }

    private List<String> channelRecipients() {
        List<String> recipients = new ArrayList<>();
        for (UserRecord user : channelUsers.values()) {
            if (!user.nick.equalsIgnoreCase(currentNick)) recipients.add(user.nick);
        }
        return recipients;
    }

    private static String cleanChannelName(String value) {
        return value == null ? "" : value.replaceFirst("^:", "");
    }

    private boolean isConfiguredChannel(String candidate) {
        return cleanChannelName(candidate).equalsIgnoreCase(channel);
    }

    private String conversationTarget(String target, String from) {
        if (target.equalsIgnoreCase(currentNick) || target.equalsIgnoreCase(nick)) return from;
        if (target.equalsIgnoreCase(channel)) return channel;
        return target;
    }

    private static String normalizeChannel(String value) {
        String next = valueOr(value, DEFAULT_CHANNEL);
        return next.startsWith("#") ? next : "#" + next;
    }

    private static String decodeDccAddress(String value) {
        if (!value.matches("^\\d+$")) return value;
        long number = Long.parseLong(value);
        return ((number >> 24) & 255) + "." + ((number >> 16) & 255) + "." + ((number >> 8) & 255) + "." + (number & 255);
    }

    private static String encodeDccAddress(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return host;
        long value = 0;
        for (String part : parts) value = (value << 8) + Integer.parseInt(part);
        return String.valueOf(value);
    }

    private static String localDccHost() throws Exception {
        for (NetworkInterface networkInterface : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            for (InetAddress address : Collections.list(networkInterface.getInetAddresses())) {
                if (address instanceof Inet4Address && !address.isLoopbackAddress()) return address.getHostAddress();
            }
        }
        return InetAddress.getLocalHost().getHostAddress();
    }

    private static String mimeFor(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".avif")) return "image/avif";
        return "image/png";
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager powerManager = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SubjectiveChat:IrcConnection");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
        if (wifiManager != null) {
            wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "SubjectiveChat:IrcWifi");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wakeLock = null;
        wifiLock = null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "IRC messages",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Incoming IRC messages and DCC images");
        NotificationManager manager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        if (getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        getActivity().requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4101);
    }

    private void showNotification(String title, String text) {
        if (Build.VERSION.SDK_INT >= 33 && getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent launchIntent = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            getContext(),
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(getContext().getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        NotificationManager manager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notificationId++, builder.build());
    }

    private void startConnectionService(String text) {
        IrcForegroundService.start(getContext(), "Subjective IRC", text);
    }

    private void updateConnectionService(String text) {
        IrcForegroundService.start(getContext(), "Subjective IRC", text);
    }

    private void stopConnectionService() {
        IrcForegroundService.stop(getContext());
    }

    private static class IrcMessage {
        final String prefix;
        final String command;
        final List<String> params;

        IrcMessage(String prefix, String command, List<String> params) {
            this.prefix = prefix;
            this.command = command;
            this.params = params;
        }
    }

    private static class UserRecord {
        final String nick;
        final String modes;

        UserRecord(String nick, String modes) {
            this.nick = nick;
            this.modes = modes;
        }
    }

    private static class ConnectionConfig {
        final String name;
        final String host;
        final int port;
        final boolean tls;
        final String channel;
        final String nick;
        final String realname;

        ConnectionConfig(String name, String host, int port, boolean tls, String channel, String nick, String realname) {
            this.name = valueOr(name, DEFAULT_NAME);
            this.host = valueOr(host, DEFAULT_HOST);
            this.port = port > 0 ? port : DEFAULT_PORT;
            this.tls = tls;
            this.channel = normalizeChannel(channel);
            this.nick = valueOr(nick, DEFAULT_NICK);
            this.realname = valueOr(realname, this.nick);
        }

        static ConnectionConfig fromJson(JSObject object) {
            return fromJson((JSONObject) object);
        }

        static ConnectionConfig fromJson(JSONObject object) {
            if (object == null) return new ConnectionConfig(DEFAULT_NAME, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_TLS, DEFAULT_CHANNEL, DEFAULT_NICK, DEFAULT_REALNAME);
            return new ConnectionConfig(
                object.optString("name", DEFAULT_NAME),
                object.optString("host", DEFAULT_HOST),
                object.optInt("port", DEFAULT_PORT),
                object.optBoolean("tls", DEFAULT_TLS),
                object.optString("channel", DEFAULT_CHANNEL),
                object.optString("nick", DEFAULT_NICK),
                object.optString("realname", object.optString("nick", DEFAULT_NICK))
            );
        }

        JSObject toJson() {
            JSObject object = new JSObject();
            object.put("name", name);
            object.put("host", host);
            object.put("port", port);
            object.put("tls", tls);
            object.put("channel", channel);
            object.put("nick", nick);
            object.put("realname", realname);
            return object;
        }

        String key() {
            return (host + ":" + port + ":" + channel + ":" + nick).toLowerCase(Locale.ROOT);
        }
    }
}
