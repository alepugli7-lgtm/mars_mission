#!/usr/bin/env python3
"""Missione Marte: single-process classroom server, no external services."""
import csv
import io
import json
import math
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent
LOCK = threading.RLock()
ALERT = ("CRITICAL ALERT — MAJOR SYSTEM FAILURE\n\n"
         "A major failure has damaged the base’s life-support systems.\n\n"
         "Repairs are still possible, but they require enough crew members to stay.\n\n"
         "If too many astronauts leave, we can no longer guarantee that those remaining "
         "will make it home to their families.\n\n"
         "Return capsules are currently operational.\n"
         "You must decide: stay with the crew, or secure your return to Earth.")


class Game:
    def __init__(self, tester=False):
        self.tester = tester
        self.reset()

    def reset(self):
        self.epoch = secrets.token_hex(8)
        self.phase = 'lobby'
        self.players = {}
        self.events = []
        self.q = 30
        self.h = 60
        self.deadline = None
        self.end_reason = None
        self.stop_threshold = 0
        self.n = 0
        self.threshold = 0
        self.alert = False
        self.message = ALERT
        self.fast = True
        self.started = None
        self.finished = None

    def event(self, kind, **values):
        self.events.append(dict(id=len(self.events)+1, kind=kind, time=time.time(), **values))

    def home(self):
        return sum(p['action'] == 'home' for p in self.players.values())

    def failed(self):
        return self.home() >= self.threshold

    def finish(self, reason):
        if self.phase == 'running':
            self.phase = 'finished'
            self.finished = time.time()
            self.end_reason = reason
            self.event('finish', home=self.home(), reason=reason)

    def tick(self):
        if self.phase == 'running':
            if time.time() >= self.deadline:
                self.finish('time_expired')
            elif self.home() >= self.stop_threshold:
                self.finish('departure_limit')

    def depart(self, p, forced=False):
        if self.phase != 'running' or p['action'] == 'home':
            raise ValueError('This departure is not available.')
        p['action'] = 'home'
        p['pending'] = None
        self.event('home', home=self.home(), fast=self.fast, actor=p['number'], forced=forced)
        self.tick()

    def snapshot(self, token=None, host=False):
        self.tick()
        p = self.players.get(token)
        result = dict(epoch=self.epoch, phase=self.phase, alert=self.alert,
                      message=self.message if self.alert else '', fast=self.fast,
                      deadline=self.deadline, server_time=time.time(), end_reason=self.end_reason,
                      n=self.n or len(self.players), home=self.home(),
                      events=[{k:v for k,v in e.items() if k in ('id','time')}
                              for e in self.events if e['kind']=='home'
                              and (not p or e.get('actor') != p['number'])],
                      me={k:v for k,v in p.items() if k in ('number','action')} if p else None)
        if p and not host and p['action']=='home':
            result.update(alert=False,message='',events=[])
        if self.phase=='finished' and p:
            win = (p['action']=='home') == self.failed()
            result.update(reward='win' if win else 'lose', mission_failed=self.failed(),
                          outcome='safe_return' if p['action']=='home' else ('dead' if self.failed() else 'success'))
        if host:
            result.update(tester=self.tester,q=self.q,h=self.h,threshold=self.threshold,
                          stop_threshold=self.stop_threshold,joined=sum(not p.get('virtual') for p in self.players.values()),
                          failed=self.failed(),started=self.started,finished=self.finished,history=self.events,
                          players=[dict(number=p['number'],action=p['action'],virtual=p.get('virtual',False)) for p in self.players.values()])
        return result


GAMES = {"classroom": Game(), "tester": Game(tester=True)}
HOST_KEY = os.environ.get('HOST_KEY') or secrets.token_urlsafe(24)
PUBLIC_URL = os.environ.get('PUBLIC_URL', '').rstrip('/')
if PUBLIC_URL and (urlsplit(PUBLIC_URL).scheme not in ('http', 'https') or
                   not urlsplit(PUBLIC_URL).netloc or urlsplit(PUBLIC_URL).query or
                   urlsplit(PUBLIC_URL).fragment):
    raise SystemExit('PUBLIC_URL must be an http(s) URL without query or fragment.')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No player tokens, identities or host keys in access logs.

    def send(self, status, body, mime='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def host(self):
        return secrets.compare_digest(self.headers.get('X-Host-Key', ''), HOST_KEY)

    def token(self):
        return self.headers.get('X-Player-Token', '')

    def base_url(self):
        # PUBLIC_URL is explicit; local mode uses an allowlisted Host.
        if PUBLIC_URL:
            return PUBLIC_URL
        hostname = self.headers.get('Host', '')
        if hostname not in self.server.allowed_hosts:
            raise ValueError('Host not allowed. Set PUBLIC_URL to your domain.')
        return 'http://' + hostname

    def game(self):
        room = parse_qs(urlsplit(self.path).query).get("room", [self.headers.get("X-Mission-Room", "classroom")])[0]
        return GAMES.get(room, GAMES["classroom"])

    def do_GET(self):
        GAME = self.game()
        path = urlsplit(self.path).path
        if path in ('/', '/host', '/tester'):
            return self.send(200, (ROOT/'static'/'index.html').read_bytes(), 'text/html; charset=utf-8')
        if path == '/app.js':
            return self.send(200, (ROOT/'static'/'app.js').read_bytes(), 'text/javascript; charset=utf-8')
        if path == '/health':
            return self.send(200, {'ok': True})
        if path == '/api/state':
            with LOCK:
                GAME.tick()
                if not self.host() and self.token() not in GAME.players:
                    return self.send(401, {'error':'Join the mission to continue.'})
                data = GAME.snapshot(self.token(), self.host())
                if self.host():
                    try:
                        data['join_url'] = self.base_url() + ('/tester' if GAME.tester else '/')
                    except ValueError as e:
                        return self.send(400, {'error':str(e)})
                return self.send(200, data)
        if path in ('/api/qr', '/api/export'):
            if not self.host():
                return self.send(403, {'error':'Mission control access required.'})
            if path == '/api/qr':
                try:
                    from reportlab.graphics.barcode.qr import QrCodeWidget
                    from reportlab.graphics.shapes import Drawing
                    from reportlab.graphics import renderSVG
                    w = QrCodeWidget(self.base_url() + ('/tester' if GAME.tester else '/'), barLevel='M', barBorder=4)
                    d = Drawing(100, 100)
                    d.add(w)
                    return self.send(200, renderSVG.drawToString(d).encode(), 'image/svg+xml')
                except (ImportError, ValueError) as e:
                    return self.send(503, {'error':str(e)})
            with LOCK:
                out = io.StringIO()
                writer = csv.writer(out)
                writer.writerow(['seconds','event','home','participants','threshold','fast','actor','forced','end_reason'])
                for e in GAME.events:
                    writer.writerow([round(e['time']-(GAME.started or e['time']), 2), e['kind'],
                                     e.get('home',''), GAME.n, GAME.threshold, e.get('fast',''), e.get('actor',''), e.get('forced',''), e.get('reason','')])
                return self.send(200, out.getvalue().encode('utf-8-sig'), 'text/csv; charset=utf-8')
        return self.send(404, {'error':'Page not found.'})

    def do_POST(self):
        GAME = self.game()
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                raise ValueError('Invalid request.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Invalid request.')
            path = urlsplit(self.path).path
            with LOCK:
                GAME.tick()
                if path == '/api/join':
                    # Retry/reload is idempotent while a token is still valid.
                    if self.token() in GAME.players:
                        return self.send(200, {'token':self.token()})
                    if GAME.phase != 'lobby':
                        raise ValueError('The mission has started. Wait for the next round.')
                    if GAME.tester and len(GAME.players) >= 1:
                        raise ValueError('Solo tester has one player. Reset before joining again.')
                    if len(GAME.players) >= 200:
                        raise ValueError('Crew full (maximum 200).')
                    token = secrets.token_urlsafe(24)
                    GAME.players[token] = dict(number=len(GAME.players)+1, action='stay', pending=None)
                    return self.send(200, {'token':token})
                if path in ('/api/choose', '/api/prepare'):
                    p = GAME.players.get(self.token())
                    if not p:
                        return self.send(401, {'error':'Please rejoin the mission.'})
                    if GAME.phase != 'running':
                        raise ValueError('Choices are open only during the mission.')
                    action = data.get('action')
                    if action not in ('stay','home'):
                        raise ValueError('Invalid action.')
                    if p['action'] == 'home':
                        if action != 'home':
                            raise ValueError('Your return is final. You cannot rejoin the mission.')
                        return self.send(200, {'ok':True})
                    if path == '/api/prepare':
                        if action != 'home':
                            raise ValueError('Invalid procedure.')
                        p['pending'] = time.monotonic()
                        return self.send(200, {'ok':True})
                    if action == 'home' and p['action'] != 'home' and not GAME.fast:
                        if p['pending'] is None or time.monotonic()-p['pending'] < 4:
                            raise ValueError('Complete the four-second return procedure.')
                    if p['action'] != action:
                        GAME.depart(p)
                    return self.send(200, {'ok':True})
                if path == '/api/host':
                    if not self.host():
                        return self.send(403, {'error':'Invalid host key.'})
                    command = data.get('command')
                    if command == 'reset':
                        GAME.reset()
                    elif command == 'configure':
                        if GAME.phase != 'lobby':
                            raise ValueError('Configure the threshold before launch.')
                        q = 30
                        if type(q) is not int or not 20 <= q <= 70:
                            raise ValueError('Threshold must be between 20% and 70%.')
                        GAME.q = q
                        GAME.fast = bool(data.get('fast',True))
                    elif command == 'start':
                        if GAME.phase != 'lobby' or len(GAME.players) < (1 if GAME.tester else 4):
                            raise ValueError('Classroom mode requires 4 players; solo tester requires 1. Start from the lobby.')
                        if GAME.tester:
                            for number in range(2,41):
                                GAME.players['virtual-'+str(number)] = dict(number=number,action='stay',pending=None,virtual=True)
                        GAME.n = len(GAME.players)
                        GAME.threshold = math.ceil(GAME.n*GAME.q/100)
                        GAME.stop_threshold = math.ceil(GAME.n*GAME.h/100)
                        GAME.phase = 'running'
                        GAME.started = time.time()
                        GAME.deadline = GAME.started + 60
                        GAME.event('start', home=0, fast=GAME.fast)
                    elif command in ('force_departure','test_notification'):
                        if GAME.phase != 'running':
                            raise ValueError('Start the mission first.')
                        candidates = [p for p in GAME.players.values() if p['action']=='stay']
                        if data.get('number') is not None:
                            candidates = [p for p in candidates if p['number']==data['number']]
                        elif GAME.tester:
                            candidates = [p for p in candidates if p.get('virtual')]
                        if not candidates:
                            raise ValueError('No eligible astronaut remains.')
                        GAME.depart(candidates[0], forced=True)
                    elif command in ('alert','fast','finish'):
                        if GAME.phase != 'running':
                            raise ValueError('Start the mission first.')
                        if command == 'alert':
                            message = str(data.get('message') or ALERT).strip()
                            if not 1 <= len(message) <= 800:
                                raise ValueError('Message must contain 1 to 800 characters.')
                            GAME.message = message
                            if not GAME.alert:
                                GAME.alert = True
                                GAME.event('alert', home=GAME.home(), fast=GAME.fast)
                        elif command == 'fast':
                            GAME.fast = bool(data.get('value',True))
                            GAME.event('fast' if GAME.fast else 'slow', home=GAME.home(), fast=GAME.fast)
                        else:
                            GAME.finish('host_stop')
                    else:
                        raise ValueError('Invalid command.')
                    return self.send(200, {'ok':True})
                return self.send(404, {'error':'Operation not found.'})
        except (ValueError, TypeError) as e:
            return self.send(400, {'error':str(e) or 'Invalid request.'})


def clock_loop():
    while True:
        with LOCK:
            for game in GAMES.values():
                game.tick()
        time.sleep(0.1)


def serve():
    threading.Thread(target=clock_loop,daemon=True).start()
    port = int(os.environ.get('PORT','8000'))
    bind = os.environ.get('BIND','0.0.0.0')
    local_ip = os.environ.get('LAN_IP','')
    if not local_ip:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(('192.0.2.1',80))
                local_ip = s.getsockname()[0]
        except OSError:
            local_ip = '127.0.0.1'
    server = ThreadingHTTPServer((bind,port), Handler)
    server.allowed_hosts = {f'localhost:{port}',f'127.0.0.1:{port}',f'{local_ip}:{port}'}
    base = PUBLIC_URL or f'http://{local_ip}:{port}'
    print('\nMARS MISSION\nPlayers: '+base+'\nHost: '+base+'/host#'+HOST_KEY+
          '\nShare ONLY the player QR. Ctrl+C to stop.\n', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    serve()
