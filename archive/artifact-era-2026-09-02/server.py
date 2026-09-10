#!/usr/bin/env python3
"""
Clocktower Companion — local host server.

Zero-install, zero-account way to test the game on everyone's own phones
tonight: this serves clocktower_local.html and a tiny in-memory JSON
store over your Wi-Fi. No Firebase/Supabase, no internet required beyond
being on the same network. Requires only Python 3 (already on every Mac,
most Linux, and installable free on Windows) — nothing to pip install.

Usage:
    python3 server.py
    (then open the address it prints, on your own phone/laptop too, to try it)

Keep this file and clocktower_local.html in the same folder. Stop the
game (Ctrl+C) any time; state lives only in memory and resets on restart.

This is a stopgap for one evening, not the real rollout — see the
project notes for the plan to move this onto a small free hosted
backend (Firebase/Supabase) once you have time to set that up properly,
which will also fix "share this link with anyone" for good.
"""
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'clocktower_local.html')
PORT = 8420

lock = threading.Lock()
docs = {}     # path -> value
locks = {}    # path -> {holder, expiresAt}
version = 0


def bump():
    global version
    version += 1


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; comment this out if you want request logs

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            try:
                with open(HOST_FILE, 'rb') as f:
                    body = f.read()
            except FileNotFoundError:
                self._send_json({'error': 'clocktower_local.html not found next to server.py'}, 500)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == '/api/dump':
            with lock:
                self._send_json({'docs': docs, 'version': version})
            return
        self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        if self.path == '/api/set':
            body = self._read_json()
            with lock:
                docs[body.get('path')] = body.get('data')
                bump()
            self._send_json({'ok': True})
            return
        if self.path == '/api/update':
            body = self._read_json()
            with lock:
                p = body.get('path')
                cur = docs.get(p) or {}
                if not isinstance(cur, dict):
                    cur = {}
                cur = {**cur, **(body.get('data') or {})}
                docs[p] = cur
                bump()
            self._send_json({'ok': True})
            return
        if self.path == '/api/delete':
            body = self._read_json()
            with lock:
                docs.pop(body.get('path'), None)
                bump()
            self._send_json({'ok': True})
            return
        if self.path == '/api/acquire':
            body = self._read_json()
            p = body.get('path')
            holder = body.get('holder')
            ttl_ms = body.get('ttlMs') or 3000
            now = time.time() * 1000
            with lock:
                cur = locks.get(p)
                if cur is None or cur['expiresAt'] < now or cur['holder'] == holder:
                    locks[p] = {'holder': holder, 'expiresAt': now + ttl_ms}
                    self._send_json({'acquired': True})
                else:
                    self._send_json({'acquired': False})
            return
        self._send_json({'error': 'not found'}, 404)


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


if __name__ == '__main__':
    ip = local_ip()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('')
    print('  Clocktower Companion is running.')
    print('')
    print(f'  On this computer:   http://localhost:{PORT}')
    print(f'  On phones (same Wi-Fi as this computer): http://{ip}:{PORT}')
    print('')
    print('  Share that second address with your friends — that\'s tonight\'s "join code".')
    print('  Press Ctrl+C to stop.')
    print('')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.')
