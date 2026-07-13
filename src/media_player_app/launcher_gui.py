"""Small Windows-friendly launcher for the Local Media Player.

The player itself is a local web app. This GUI is only a convenience wrapper
around the same command-line modes used by the .cmd launchers.
"""

from __future__ import annotations

import json
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from tkinter import END, DISABLED, NORMAL, StringVar, Tk
from tkinter import scrolledtext, ttk


APP_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MEDIA_DIR = APP_DIR.parent.parent / "media"
APP_SCRIPT = APP_DIR / "media_player.py"
CODEX_PYTHON = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "python" / "python.exe"
CLOUDFLARED = APP_DIR.parent / "codex" / "tools" / "cloudflared.exe"


@dataclass(frozen=True)
class LaunchMode:
    """One selectable way to run the player."""

    name: str
    host: str
    port: int
    flags: tuple[str, ...]
    url_kind: str
    description: str
    cloudflare: bool = False


MODES = {
    "Local edit": LaunchMode(
        name="Local edit",
        host="127.0.0.1",
        port=8766,
        flags=(),
        url_kind="local",
        description="Normal desktop mode with editing available.",
    ),
    "Phone on Wi-Fi": LaunchMode(
        name="Phone on Wi-Fi",
        host="0.0.0.0",
        port=8766,
        flags=(),
        url_kind="lan",
        description="Use from your phone while it is on the same home network.",
    ),
    "Private Tailscale": LaunchMode(
        name="Private Tailscale",
        host="0.0.0.0",
        port=8768,
        flags=("--read-only",),
        url_kind="tailscale",
        description="Private read-only access from your own Tailscale devices.",
    ),
    "Web share + Cloudflare": LaunchMode(
        name="Web share + Cloudflare",
        host="0.0.0.0",
        port=8767,
        flags=("--web-share",),
        url_kind="cloudflare",
        description="Read-only public temporary link through Cloudflare Tunnel.",
        cloudflare=True,
    ),
    "Web share local only": LaunchMode(
        name="Web share local only",
        host="0.0.0.0",
        port=8767,
        flags=("--web-share",),
        url_kind="lan",
        description="Read-only web-share server without starting Cloudflare.",
    ),
}


class LauncherApp:
    """Tkinter control panel for starting and stopping the local server."""

    def __init__(self) -> None:
        self.root = Tk()
        self.root.title("Media Player Launcher")
        self.root.geometry("720x500")
        self.root.minsize(620, 420)
        self.process: subprocess.Popen[str] | None = None
        self.local_edit_process: subprocess.Popen[str] | None = None
        self.cloudflare_process: subprocess.Popen[str] | None = None
        self.mode_name = StringVar(value="Local edit")
        self.status = StringVar(value="Stopped")
        self.url = StringVar(value="")
        self.public_url = ""

        self.apply_native_theme()
        self.build_ui()
        self.update_mode_text()
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def apply_native_theme(self) -> None:
        """Use the operating system's normal light theme for a simple utility UI."""
        style = ttk.Style(self.root)
        try:
            style.theme_use("vista")
        except Exception:
            pass
        style.configure("Title.TLabel", font=("Segoe UI", 15, "bold"))
        style.configure("Status.TLabel", foreground="#555555")
        style.configure("Primary.TButton", padding=(14, 6))
        style.configure("TButton", padding=(10, 6))

    def build_ui(self) -> None:
        """Create the small control-panel layout."""
        frame = ttk.Frame(self.root, padding=16)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Media Player Launcher", style="Title.TLabel").grid(row=0, column=0, columnspan=4, sticky="w")

        ttk.Label(frame, text="Mode").grid(row=1, column=0, sticky="w", pady=(18, 4))
        mode_box = ttk.Combobox(frame, textvariable=self.mode_name, values=list(MODES), state="readonly", width=28)
        mode_box.grid(row=1, column=1, sticky="we", pady=(18, 4), padx=(8, 12))
        mode_box.bind("<<ComboboxSelected>>", lambda _event: self.update_mode_text())

        ttk.Label(frame, textvariable=self.status, style="Status.TLabel").grid(row=1, column=2, columnspan=2, sticky="e", pady=(18, 4))

        self.description_label = ttk.Label(frame, text="", wraplength=660)
        self.description_label.grid(row=2, column=0, columnspan=4, sticky="we", pady=(0, 14))

        ttk.Button(frame, text="Start", command=self.start, style="Primary.TButton").grid(row=3, column=0, sticky="we", padx=(0, 6))
        ttk.Button(frame, text="Stop", command=self.stop).grid(row=3, column=1, sticky="we", padx=6)
        ttk.Button(frame, text="Restart", command=self.restart).grid(row=3, column=2, sticky="we", padx=6)
        ttk.Button(frame, text="Open URL", command=self.open_url).grid(row=3, column=3, sticky="we", padx=(6, 0))

        ttk.Button(frame, text="Refresh Library", command=self.refresh_library).grid(row=4, column=0, sticky="we", pady=10, padx=(0, 6))
        ttk.Label(frame, textvariable=self.url, wraplength=520, style="Status.TLabel").grid(row=4, column=1, columnspan=3, sticky="w", pady=10)

        ttk.Label(frame, text="Log").grid(row=5, column=0, columnspan=4, sticky="w", pady=(4, 4))

        self.log = scrolledtext.ScrolledText(frame, height=14, state=DISABLED, font=("Consolas", 10), borderwidth=1, relief="solid")
        self.log.grid(row=6, column=0, columnspan=4, sticky="nsew")

        for column in range(4):
            frame.columnconfigure(column, weight=1)
        frame.rowconfigure(6, weight=1)

    def update_mode_text(self) -> None:
        """Refresh the description and predicted URL for the selected mode."""
        mode = MODES[self.mode_name.get()]
        self.description_label.configure(text=mode.description)
        self.public_url = ""
        self.url.set(self.display_url(mode))

    def python_exe(self) -> str:
        """Prefer the bundled Codex Python, then fall back to PATH."""
        return str(CODEX_PYTHON) if CODEX_PYTHON.exists() else sys.executable

    def command(self, mode: LaunchMode) -> list[str]:
        """Build the server process command."""
        return [
            self.python_exe(),
            str(APP_SCRIPT),
            "--media-dir",
            str(DEFAULT_MEDIA_DIR),
            "--host",
            mode.host,
            "--port",
            str(mode.port),
            *mode.flags,
        ]

    def local_edit_command(self) -> list[str]:
        """Build the companion local edit server command for web-share mode."""
        return [
            self.python_exe(),
            str(APP_SCRIPT),
            "--media-dir",
            str(DEFAULT_MEDIA_DIR),
            "--host",
            "127.0.0.1",
            "--port",
            "8766",
        ]

    def start(self) -> None:
        """Start the selected server mode if nothing is already running."""
        if self.process and self.process.poll() is None:
            self.write_log("Already running. Stop or Restart first.\n")
            return
        mode = MODES[self.mode_name.get()]
        self.write_log(f"\nStarting {mode.name}...\n")
        self.write_log(" ".join(self.command(mode)) + "\n")
        self.process = subprocess.Popen(
            self.command(mode),
            cwd=str(APP_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        self.status.set(f"Running: {mode.name}")
        self.url.set(self.display_url(mode))
        threading.Thread(target=self.read_output, args=(self.process, "server"), daemon=True).start()
        if mode.cloudflare:
            self.start_local_edit_server()
            self.start_cloudflare(mode)

    def stop(self) -> None:
        """Stop the server process started by this GUI."""
        stopped_any = False
        if self.cloudflare_process and self.cloudflare_process.poll() is None:
            self.write_log("Stopping Cloudflare tunnel...\n")
            self.cloudflare_process.terminate()
            try:
                self.cloudflare_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.cloudflare_process.kill()
            stopped_any = True
        self.cloudflare_process = None
        self.public_url = ""
        if self.local_edit_process and self.local_edit_process.poll() is None:
            self.write_log("Stopping local edit server...\n")
            self.local_edit_process.terminate()
            try:
                self.local_edit_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.local_edit_process.kill()
            stopped_any = True
        self.local_edit_process = None
        if not self.process or self.process.poll() is not None:
            self.status.set("Stopped")
            if not stopped_any:
                self.write_log("Not running.\n")
            return
        self.write_log("Stopping server...\n")
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        self.status.set("Stopped")

    def restart(self) -> None:
        """Stop and start again using the selected mode."""
        self.stop()
        time.sleep(0.4)
        self.start()

    def open_url(self) -> None:
        """Open the current mode's URL in the default browser."""
        url = self.public_url or self.primary_display_url(MODES[self.mode_name.get()])
        if url:
            webbrowser.open(url)

    def refresh_library(self) -> None:
        """Ask the running server to rescan media without restarting."""
        mode = MODES[self.mode_name.get()]
        url = f"http://127.0.0.1:{mode.port}/api/refresh"
        try:
            with urllib.request.urlopen(url, timeout=8) as response:
                data = json.loads(response.read().decode("utf-8"))
            self.write_log(f"Refresh response: {data}\n")
        except Exception as exc:
            self.write_log(f"Refresh failed: {exc}\n")

    def start_local_edit_server(self) -> None:
        """Start editable localhost mode beside a read-only Cloudflare share."""
        if self.local_edit_process and self.local_edit_process.poll() is None:
            return
        command = self.local_edit_command()
        self.write_log("Starting local edit server on http://127.0.0.1:8766/...\n")
        self.write_log(" ".join(command) + "\n")
        self.local_edit_process = subprocess.Popen(
            command,
            cwd=str(APP_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        threading.Thread(target=self.read_output, args=(self.local_edit_process, "edit"), daemon=True).start()

    def start_cloudflare(self, mode: LaunchMode) -> None:
        """Start cloudflared and watch its output for the public URL."""
        if not CLOUDFLARED.exists():
            self.write_log(f"Could not find cloudflared: {CLOUDFLARED}\n")
            self.write_log("The web-share server is still running locally.\n")
            return
        command = [str(CLOUDFLARED), "tunnel", "--url", f"http://127.0.0.1:{mode.port}"]
        self.write_log("Starting Cloudflare tunnel...\n")
        self.cloudflare_process = subprocess.Popen(
            command,
            cwd=str(APP_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        threading.Thread(target=self.read_output, args=(self.cloudflare_process, "cloudflare"), daemon=True).start()

    def read_output(self, process: subprocess.Popen[str], label: str) -> None:
        """Copy child-process output into the GUI log."""
        assert process.stdout is not None
        for line in process.stdout:
            self.write_log(f"[{label}] {line}")
            if label == "cloudflare":
                self.capture_cloudflare_url(line)
        if process is self.process:
            self.status.set("Stopped")

    def capture_cloudflare_url(self, line: str) -> None:
        """Save and show the temporary trycloudflare.com URL when it appears."""
        match = re.search(r"https://[^\s]+\.trycloudflare\.com", line)
        if not match:
            return
        self.public_url = match.group(0)
        self.url.set(f"Public: {self.public_url}\nRead-only local: http://127.0.0.1:8767/\nEdit local: http://127.0.0.1:8766/")
        self.write_log(f"Cloudflare public link ready: {self.public_url}\n")

    def write_log(self, text: str) -> None:
        """Append text to the log box from any thread."""
        def append() -> None:
            self.log.configure(state=NORMAL)
            self.log.insert(END, text)
            self.log.see(END)
            self.log.configure(state=DISABLED)

        self.root.after(0, append)

    def display_url(self, mode: LaunchMode) -> str:
        """Return the best URL to show for a mode."""
        if mode.url_kind == "cloudflare":
            return f"Public: waiting for Cloudflare...\nRead-only local: http://127.0.0.1:{mode.port}/\nEdit local: http://127.0.0.1:8766/"
        if mode.url_kind == "lan":
            return f"PC: http://127.0.0.1:{mode.port}/\nPhone: http://{local_lan_ip()}:{mode.port}/"
        return self.primary_display_url(mode)

    def primary_display_url(self, mode: LaunchMode) -> str:
        """Return the URL Open URL should use before a Cloudflare URL exists."""
        if mode.url_kind == "local":
            return f"http://127.0.0.1:{mode.port}/"
        if mode.url_kind == "lan":
            return f"http://{local_lan_ip()}:{mode.port}/"
        if mode.url_kind == "tailscale":
            return f"http://{tailscale_ip() or 'YOUR_TAILSCALE_IP'}:{mode.port}/"
        return f"http://127.0.0.1:{mode.port}/"

    def close(self) -> None:
        """Stop the child process before closing the GUI."""
        self.stop()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def local_lan_ip() -> str:
    """Best-effort LAN IP detection without sending data."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return "YOUR_LAN_IP"


def tailscale_ip() -> str:
    """Return the first Tailscale IPv4 address if the CLI is available."""
    candidates = ["tailscale", str(Path("C:/Program Files/Tailscale/tailscale.exe"))]
    for exe in candidates:
        try:
            result = subprocess.run([exe, "ip", "-4"], capture_output=True, text=True, timeout=4, check=False)
        except (OSError, subprocess.SubprocessError):
            continue
        address = result.stdout.strip().splitlines()
        if address:
            return address[0].strip()
    return ""


if __name__ == "__main__":
    LauncherApp().run()
