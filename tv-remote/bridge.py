#!/usr/bin/env python3
"""Local web and ADB bridge for the TV Remote page.

The browser connects to this PC at http://127.0.0.1:8765. Android TV images are
shown in the TV's browser through a read-only page served on the local network.
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
ADB = ROOT.parent / "tools" / "platform-tools" / "adb.exe"
PROFILE = ROOT.parent / "tools" / "adb-profile"
ENDPOINT = PROFILE / "tv-endpoint"
MEDIA = ROOT / "shared"
PORT = int(os.environ.get("TV_REMOTE_PORT", "8765"))
MAX_IMAGE_BYTES = 12 * 1024 * 1024
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
KEYS = {
    "up": "KEYCODE_DPAD_UP", "down": "KEYCODE_DPAD_DOWN",
    "left": "KEYCODE_DPAD_LEFT", "right": "KEYCODE_DPAD_RIGHT",
    "enter": "KEYCODE_DPAD_CENTER", "back": "KEYCODE_BACK",
    "home": "KEYCODE_HOME", "menu": "KEYCODE_MENU",
    "volume_up": "KEYCODE_VOLUME_UP", "volume_down": "KEYCODE_VOLUME_DOWN",
    "mute": "KEYCODE_VOLUME_MUTE", "play_pause": "KEYCODE_MEDIA_PLAY_PAUSE",
    "rewind": "KEYCODE_MEDIA_REWIND", "forward": "KEYCODE_MEDIA_FAST_FORWARD",
}


def adb(*args: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    if not ADB.is_file():
        raise RuntimeError("Android Platform Tools are missing. Use start-bridge.ps1 to set up the bridge.")
    PROFILE.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["ANDROID_SDK_HOME"] = str(PROFILE)
    env["ANDROID_USER_HOME"] = str(PROFILE / ".android")
    return subprocess.run([str(ADB), *args], capture_output=True, text=True, timeout=timeout, env=env)


def endpoint() -> str:
    try:
        return ENDPOINT.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def run_tv(*args: str, timeout: int = 20) -> str:
    target = endpoint()
    if not target:
        raise RuntimeError("Pair and connect the TV first; its connection address is not saved yet.")
    result = adb("-s", target, *args, timeout=timeout)
    output = (result.stdout + result.stderr).strip()
    if result.returncode:
        raise RuntimeError(output or "ADB command failed.")
    return output


def host_ip_for(tv_endpoint: str) -> str:
    address = tv_endpoint.rsplit(":", 1)[0]
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect((address, 1))
        return probe.getsockname()[0]


def decode_data_url(value: str) -> tuple[bytes, str]:
    match = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)", value or "")
    if not match:
        raise ValueError("Use a PNG, JPEG, or WebP image.")
    data = base64.b64decode(match.group(2), validate=True)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be smaller than 12 MB.")
    extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[match.group(1)]
    return data, extension


def save_image_message(message: dict) -> str:
    token = uuid.uuid4().hex
    MEDIA.mkdir(parents=True, exist_ok=True)
    image_bytes, extension = decode_data_url(message.get("data", ""))
    image_file = f"{token}{extension}"
    (MEDIA / image_file).write_bytes(image_bytes)
    drawing_file = None
    if message.get("drawing"):
        drawing_bytes, drawing_ext = decode_data_url(message["drawing"])
        if drawing_ext != ".png":
            raise ValueError("Drawing must be a PNG overlay.")
        drawing_file = f"{token}-drawing.png"
        (MEDIA / drawing_file).write_bytes(drawing_bytes)
    metadata = {
        "name": Path(str(message.get("name", "Photo"))).name[:100],
        "image": image_file,
        "drawing": drawing_file,
    }
    (MEDIA / f"{token}.json").write_text(json.dumps(metadata), encoding="utf-8")
    return token


class Handler(SimpleHTTPRequestHandler):
    server_version = "LivingRoomRemote/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, _format, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/bridge"):
            self.websocket()
            return
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/screen/"):
            token = parsed.path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[a-f0-9]{32}", token):
                self.send_error(404)
                return
            file = MEDIA / f"{token}.json"
            if not file.is_file():
                self.send_error(404)
                return
            self.send_bytes(file.read_bytes(), "application/json; charset=utf-8", cache="no-store")
            return
        if parsed.path.startswith("/shared/"):
            filename = parsed.path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[a-f0-9]{32}(?:-drawing)?\.(?:png|jpg|webp|json)", filename):
                self.send_error(404)
                return
            file = MEDIA / filename
            if not file.is_file():
                self.send_error(404)
                return
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            self.send_bytes(file.read_bytes(), mime)
            return
        return super().do_GET()

    def send_bytes(self, content: bytes, content_type: str, cache: str = "private, max-age=120"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def websocket(self):
        origin = self.headers.get("Origin", "")
        allowed = {"http://localhost:8765", "http://127.0.0.1:8765"}
        if origin not in allowed:
            self.send_error(403, "Open the remote from this computer at http://127.0.0.1:8765")
            return
        if self.headers.get("Upgrade", "").lower() != "websocket":
            self.send_error(400, "WebSocket upgrade required")
            return
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "Missing WebSocket key")
            return
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        try:
            while True:
                frame = self.read_frame()
                if frame is None:
                    break
                opcode, payload = frame
                if opcode == 8:
                    self.write_frame(8, b"")
                    break
                if opcode == 9:
                    self.write_frame(10, payload)
                    continue
                if opcode != 1:
                    continue
                try:
                    message = json.loads(payload.decode("utf-8"))
                    response = self.handle_message(message)
                except Exception as exc:
                    response = {"type": "error", "message": str(exc)}
                self.write_frame(1, json.dumps(response).encode("utf-8"))
        except (ConnectionError, OSError, ValueError, struct.error):
            pass

    def read_exact(self, count: int) -> bytes:
        chunks = bytearray()
        while len(chunks) < count:
            part = self.rfile.read(count - len(chunks))
            if not part:
                raise ConnectionError("Socket closed")
            chunks.extend(part)
        return bytes(chunks)

    def read_frame(self):
        head = self.read_exact(2)
        opcode = head[0] & 0x0F
        length = head[1] & 0x7F
        masked = bool(head[1] & 0x80)
        if length == 126:
            length = struct.unpack("!H", self.read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.read_exact(8))[0]
        if length > MAX_IMAGE_BYTES * 2 + 1024:
            raise ValueError("Message is too large")
        mask = self.read_exact(4) if masked else b""
        payload = self.read_exact(length)
        if masked:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return opcode, payload

    def write_frame(self, opcode: int, payload: bytes):
        length = len(payload)
        if length < 126:
            header = bytes((0x80 | opcode, length))
        elif length < 65536:
            header = bytes((0x80 | opcode, 126)) + struct.pack("!H", length)
        else:
            header = bytes((0x80 | opcode, 127)) + struct.pack("!Q", length)
        self.wfile.write(header + payload)
        self.wfile.flush()

    def handle_message(self, message: dict) -> dict:
        kind = message.get("type")
        if kind == "status":
            target = endpoint()
            if not target:
                return {"type": "status", "connected": False, "message": "Pair and connect your TV first."}
            result = adb("devices", "-l")
            is_connected = any(
                fields and fields[0] == target and fields[1] == "device"
                for fields in (line.split() for line in result.stdout.splitlines())
            )
            return {"type": "status", "connected": is_connected, "name": "Android TV" if is_connected else "TV not connected"}
        if kind == "command":
            command = message.get("command", "")
            if command == "open_wifi_settings":
                run_tv("shell", "am", "start", "-a", "android.settings.WIFI_SETTINGS")
            elif command in KEYS:
                run_tv("shell", "input", "keyevent", KEYS[command])
            else:
                raise ValueError("That TV command is not supported.")
            return {"type": "ack", "command": command}
        if kind == "text":
            text = str(message.get("text", ""))
            if not text or len(text) > 500:
                raise ValueError("Text must be between 1 and 500 characters.")
            run_tv("shell", "input", "text", text.replace(" ", "%s"))
            return {"type": "ack", "command": "text"}
        if kind == "show_image":
            token = save_image_message(message)
            target = endpoint()
            if not target:
                raise RuntimeError("TV connection is not set up yet.")
            try:
                host = host_ip_for(target)
            except OSError as exc:
                raise RuntimeError("Could not find this computer's Wi-Fi address.") from exc
            url = f"http://{host}:{PORT}/screen.html?id={token}"
            run_tv("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url)
            return {"type": "ack", "command": "show_image", "url": url}
        raise ValueError("Unknown message type.")


def main():
    PROFILE.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"TV remote ready at http://127.0.0.1:{PORT}", flush=True)
    print("Keep this window open while using the remote. The TV and this PC must share Wi-Fi.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
