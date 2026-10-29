"""Real HTTP integration checks: multiplayer, privacy, payoffs, threshold, friction."""
import concurrent.futures
import importlib.util
import json
import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent


class ClassroomTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        env = dict(os.environ, PORT=str(port), LAN_IP='127.0.0.1', HOST_KEY='test-host', PUBLIC_URL='')
        cls.server = subprocess.Popen([sys.executable,str(ROOT/'server.py')],env=env,
                                      stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if cls.call('/health')['ok']:
                    break
            except OSError:
                time.sleep(.05)
        else:
            cls.server.terminate()
            raise RuntimeError('Server non avviato.')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)

    @classmethod
    def call(cls,path,data=None,token=None,host=False,raw=False,room=None):
        h = {"X-Mission-Room": room or getattr(cls,"active_room","classroom")}
        if token:
            h['X-Player-Token'] = token
        if host:
            h['X-Host-Key'] = 'test-host'
        if path=='/api/join' and data is not None:
            data=dict(data);data.setdefault('first_name','Marco');data.setdefault('last_name','Rossi')
        if data is not None:
            h['Content-Type'] = 'application/json'
        request = Request(cls.base+path, data=None if data is None else json.dumps(data).encode(),headers=h)
        with urlopen(request,timeout=5) as r:
            payload = r.read()
            return payload if raw else json.loads(payload)

    def command(self,command,**kwargs):
        return self.call('/api/host',dict(command=command,**kwargs),host=True)

    def players(self,n=20):
        self.command('reset')
        return [self.call('/api/join',{})['token'] for _ in range(n)]

    def assert_http(self,status,fn):
        with self.assertRaises(HTTPError) as error:
            fn()
        self.assertEqual(error.exception.code,status)


    def test_01_classroom_reward_boundaries_and_stop(self):
        self.__class__.active_room='classroom'
        tokens=self.players(40)
        self.command('start')
        h=self.call('/api/state',host=True)
        self.assertEqual((h['threshold'],h['stop_threshold']),(12,24))
        self.assertAlmostEqual(h['deadline']-h['started'],120)
        for t in tokens[:11]:self.call('/api/choose',{'action':'home'},token=t)
        self.assertFalse(self.call('/api/state',host=True)['failed'])
        self.command('finish')
        self.assertEqual(self.call('/api/state',token=tokens[0])['reward'],'lose')
        self.assertEqual(self.call('/api/state',token=tokens[-1])['reward'],'win')
        tokens=self.players(40);self.command('start')
        for i in range(12):self.command('force_departure',number=i+1)
        h=self.call('/api/state',host=True)
        self.assertTrue(h['failed']);self.assertEqual(h['phase'],'running')
        for i in range(12,24):self.command('force_departure',number=i+1)
        h=self.call('/api/state',host=True)
        self.assertEqual((h['phase'],h['end_reason']),('finished','departure_limit'))
        self.assertEqual(self.call('/api/state',token=tokens[0])['reward'],'win')
        self.assertEqual(self.call('/api/state',token=tokens[-1])['reward'],'lose')
        self.assert_http(400,lambda:self.call('/api/choose',{'action':'home'},token=tokens[-1]))
        self.assertIn(b'forced',self.call('/api/export',host=True,raw=True))

    def test_02_public_counts_own_notification_and_irreversibility(self):
        tokens=self.players(40);self.command('start')
        self.call('/api/choose',{'action':'home'},token=tokens[0])
        a=self.call('/api/state',token=tokens[0]);b=self.call('/api/state',token=tokens[1])
        self.assertEqual(a['events'],[]);self.assertNotIn('reward',a)
        self.assertEqual((b['home'],b['n'],len(b['events'])),(1,40,1))
        for key in ('q','h','threshold','stop_threshold','history','players'):self.assertNotIn(key,b)
        self.assert_http(400,lambda:self.call('/api/choose',{'action':'stay'},token=tokens[0]))
        self.assert_http(403,lambda:self.call('/api/host',{'command':'force_departure'},token=tokens[0]))
        self.command('alert');a=self.call('/api/state',token=tokens[0]);self.assertFalse(a['alert'])
        self.command('finish');self.assertEqual(self.call('/api/state',token=tokens[0])['reward'],'lose')

    def test_03_tester_isolated_and_forced_departures_real(self):
        self.__class__.active_room='tester'
        t=self.players(1)[0];self.command('start')
        h=self.call('/api/state',host=True)
        self.assertAlmostEqual(h['deadline']-h['started'],120)
        s=self.call('/api/state',token=t);self.assertEqual(s['n'],40)
        self.command('force_departure')
        s=self.call('/api/state',token=t)
        self.assertEqual((s['home'],len(s['events']),s['me']['action']),(1,1,'stay'))
        self.assert_http(401,lambda:self.call('/api/state',token=t,room='classroom'))
        self.assertNotEqual(self.call('/api/qr',host=True,raw=True),self.call('/api/qr',host=True,raw=True,room='classroom'))
        self.command('finish');self.assertEqual(self.call('/api/state',token=t)['reward'],'win')
        self.__class__.active_room='classroom'

    def test_04_timer_expiry_without_player_poll(self):
        spec=importlib.util.spec_from_file_location('mars',ROOT/'server.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        game=module.Game();game.players={'one':dict(number=1,action='stay')}
        game.n=1;game.threshold=1;game.stop_threshold=1;game.phase='running';game.deadline=time.time()-.1
        game.tick()
        self.assertEqual((game.phase,game.end_reason),('finished','time_expired'))
        self.assertEqual(game.snapshot('one')['reward'],'win')
        self.assert_http(403,lambda:self.call('/api/qr'))

    def test_05_names_validation_privacy_and_reload(self):
        self.__class__.active_room='classroom';self.command('reset')
        self.assert_http(400,lambda:self.call('/api/join',{'first_name':''}))
        self.assert_http(400,lambda:self.call('/api/join',{'last_name':'a'*61}))
        self.assert_http(400,lambda:self.call('/api/join',{'first_name':'a\nb'}))
        t=self.call('/api/join',{'first_name':'  Marco  ','last_name':"D’Angelo"})['token']
        other=self.call('/api/join',{'first_name':'Giulia','last_name':'Bianchi'})['token']
        h=self.call('/api/state',host=True)
        self.assertEqual(h['players'][0]['first_name'],'Marco')
        self.assertEqual(h['players'][0]['last_name'],"D’Angelo")
        self.assertEqual(self.call('/api/join',{},token=t)['token'],t)
        s=self.call('/api/state',token=other)
        self.assertNotIn('Marco',json.dumps(s));self.assertNotIn('D’Angelo',json.dumps(s,ensure_ascii=False))
        self.assertEqual(s['me']['first_name'],'Giulia')


if __name__=='__main__':unittest.main(verbosity=2)
