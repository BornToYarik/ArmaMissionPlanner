"""Portable local planner, sharing WOG Studio's cache/native asset transport."""
import concurrent.futures, gzip, io, json, os, re, secrets, socket, subprocess, sys, tempfile, threading, time, webbrowser
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs
from http.server import ThreadingHTTPServer
BASE=Path(sys.executable).parent if getattr(sys,'frozen',False) else Path(__file__).parent
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
from vendor import local_studio as studio
from configs import prepare_mission
SITE='https://wogreplay.ru/'
NET=build_opener(ProxyHandler())
LOCAL=build_opener(ProxyHandler({}))
ASSET_ROOTS=[Path(p) for p in os.environ.get('WOG_PLANNER_ASSETS','').split(os.pathsep) if p]

def download(path,method='GET',body=None,headers=None):
    if not re.fullmatch(r'(?:api/catalog|api/replays/[a-zA-Z0-9_-]{1,160}(?:/leave)?|data/[a-zA-Z0-9_-]{1,160}/[a-zA-Z0-9.-]+\.json)',path):raise ValueError('Invalid source route')
    # Windows' HTTPS client uses the OS trust store (including legitimate
    # user-managed VPN roots). Certificate verification stays enabled.
    curl=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/curl.exe'
    if os.name=='nt' and curl.is_file():
        with tempfile.TemporaryDirectory(prefix='wog-history-') as folder:
            output=Path(folder)/'response.json'
            args=[str(curl),'--silent','--show-error','--compressed','--max-time','90','--max-filesize',str(256*1024*1024),'--request',method,'--output',str(output),'--write-out','%{http_code}','--user-agent','WOG-Planner/1']
            for key,value in (headers or {}).items():args+=['--header',key+': '+value]
            if body is not None:args+=['--data-binary','@-']
            result=subprocess.run(args+[SITE+path],input=body,capture_output=True,timeout=100,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:raise OSError(result.stderr.decode('utf8',errors='replace')[:500])
            if not output.is_file() or output.stat().st_size>256*1024*1024:raise ValueError('Replay response too large')
            raw=output.read_bytes();status=int(result.stdout)
            if not 200<=status<300:raise HTTPError(SITE+path,status,'Replay server error',{},io.BytesIO(raw))
            return json.loads(raw)
    request=Request(SITE+path,data=body,method=method,headers={'Accept-Encoding':'gzip','User-Agent':'WOG-Planner/1',**(headers or {})})
    with NET.open(request,timeout=90) as r:
        data=r.read(256*1024*1024+1)
        if len(data)>256*1024*1024:raise ValueError('Replay response too large')
        if r.headers.get('Content-Encoding')=='gzip':data=gzip.decompress(data)
        return json.loads(data)

class Store(studio.Store):
    def read(self,name,version='',original=False):
        studio.safe_path(name)
        for root in ([self.root] if original else [self.root/'overrides',self.root])+ASSET_ROOTS:
            p=root/name
            if p.is_file():return p.read_bytes()
        if name=='models/planning-native-catalog.json':raise FileNotFoundError(name)
        return super().read(name,version,original)

def proxy_handler(store,backend):
    parent=studio.handler(store)
    class Handler(parent):
        def response(self,status,data,ctype='application/json'):
            if not isinstance(data,bytes):data=json.dumps(data,ensure_ascii=False).encode('utf8')
            self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-cache');self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if not self.allowed():return self.send_error(403)
            path=urlsplit(self.path).path
            if path=='/api/planning/replays':
                try:
                    world=parse_qs(urlsplit(self.path).query).get('world',[''])[0].lower();data=download('api/catalog');missions=data if isinstance(data,list) else data.get('missions',[])
                    self.response(200,{'missions':[m for m in missions if str(m.get('world','')).lower()==world]})
                except Exception as e:self.response(502,{'error':str(e)})
                return
            match=re.fullmatch(r'/api/planning/replays/([a-zA-Z0-9_-]{1,160})',path)
            if match:
                ident=match[1];viewer=secrets.token_hex(16);headers={'X-Replay-Viewer':viewer}
                try:
                    state=download('api/replays/'+ident,'POST',b'',headers)
                    until=time.monotonic()+600
                    while state.get('state')!='ready':
                        if state.get('state')=='error':raise ValueError(state.get('error','Replay preparation failed'))
                        if time.monotonic()>until:raise TimeoutError('Запись ещё готовится. Повторите выбор позже.')
                        time.sleep(3);state=download('api/replays/'+ident,headers=headers)
                    manifest=download('data/'+ident+'/manifest.json')
                    if manifest.get('world')!=store.manifest['world']:raise ValueError('Карта записи не совпадает')
                    n=manifest.get('chunks');
                    if not isinstance(n,int) or not 0<n<=200:raise ValueError('Unsupported replay chunk count')
                    cache=store.root/'history';cache.mkdir(exist_ok=True);version=re.sub('[^a-zA-Z0-9]','',str(manifest.get('dataVersion') or manifest.get('sourceHash') or ''))
                    saved=cache/(ident+'-'+version+'.json')
                    if saved.exists():return self.response(200,saved.read_bytes())
                    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:chunks=list(pool.map(lambda i:download('data/'+ident+'/'+str(i)+'.json'),range(n)))
                    data={'manifest':manifest,'chunks':chunks};raw=json.dumps(data,separators=(',',':')).encode();tmp=saved.with_suffix('.tmp');tmp.write_bytes(raw);tmp.replace(saved);self.response(200,raw)
                except Exception as e:self.response(502,{'error':str(e)})
                finally:
                    try:download('api/replays/'+ident+'/leave','POST',b'',headers)
                    except Exception:pass
                return
            if path.startswith(('/__local/','/models/','/maps/','/terrain/','/environment/','/roads/','/markers/')):return super().do_GET()
            self.forward()
        def do_POST(self):
            if self.path.startswith('/__local/'):return super().do_POST()
            if not self.allowed() or self.headers.get('Origin',store.viewer_origin)!=store.viewer_origin:return self.send_error(403)
            self.forward()
        def forward(self):
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<=length<=64*1024*1024:return self.send_error(413)
                body=self.rfile.read(length) if length else None
                req=Request(backend+self.path,data=body,method=self.command,headers={'Content-Type':self.headers.get('Content-Type','application/octet-stream')})
                with LOCAL.open(req,timeout=90) as r:
                    data=r.read();ctype=r.headers.get('Content-Type','application/octet-stream')
                    if 'text/html' in ctype:data=data.replace(b'<head>',b'<head><script src="/__local/loader.js"></script>',1)
                    if self.path=='/api/mission/upload' and r.status==200:
                        mission=json.loads(data);store.mission=mission;store.manifest['world']=mission['worldName'].lower()
                    self.response(r.status,data,ctype)
            except HTTPError as e:self.response(e.code,e.read(),e.headers.get('Content-Type','text/plain'))
            except Exception as e:self.response(502,{'error':str(e)})
    return Handler

def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf8',line_buffering=True)
    if hasattr(sys.stdin,'reconfigure'):sys.stdin.reconfigure(encoding='utf8')
    studio.CONVERTER=BASE/'WOG-Planner.exe'
    root=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'WOG-Planner';root.mkdir(parents=True,exist_ok=True)
    port=free_port();env=os.environ.copy();env['WOG_PLANNER_PORT']=str(port)
    backend=BASE/'PlannerBackend'/'ArmaMissionPlanner.Api.exe'
    process=subprocess.Popen([str(backend)],cwd=backend.parent,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    base='http://127.0.0.1:'+str(port);servers=[];store=None
    try:
        for _ in range(100):
            try:LOCAL.open(base,timeout=1).close();break
            except Exception:time.sleep(.1)
        for line in sys.stdin:
            try:
                c=json.loads(line)
                if c.get('open'):
                    path=Path(c['open']);blob=path.read_bytes()
                    if len(blob)>64*1024*1024:raise ValueError('PBO больше 64 МБ')
                    boundary=secrets.token_hex(16);body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name.replace(chr(34),"")}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+blob+f'\r\n--{boundary}--\r\n'.encode()
                    mission=json.load(LOCAL.open(Request(base+'/api/mission/upload',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary}),timeout=60))
                    if store is None:
                        store=Store(root,'planning',{'world':mission['worldName'].lower()});store.mission=mission
                        server=ThreadingHTTPServer(('127.0.0.1',0),proxy_handler(store,base));control=ThreadingHTTPServer(('127.0.0.1',0),studio.handler(store));servers=[server,control]
                        store.viewer_origin='http://127.0.0.1:'+str(server.server_port);store.control_url='http://127.0.0.1:'+str(control.server_port)
                        for s in servers:threading.Thread(target=s.serve_forever,daemon=True).start()
                    else:store.mission=mission;store.manifest['world']=mission['worldName'].lower()
                    if os.environ.get('WOG_PLANNER_NO_BROWSER')!='1':webbrowser.open(store.viewer_origin)
                    print('Открыта миссия: '+mission['name']+'\n'+store.viewer_origin,flush=True)
                elif c.get('upgrade'):
                    try:
                        if not store:raise ValueError('Сначала откройте миссию')
                        prepare_mission(store,store.mission,c['upgrade'],c.get('quality','medium'),studio,lambda m:print(m,flush=True))
                        studio.upgrade(store,c['upgrade'],c.get('quality','medium'),lambda m:print(m,flush=True))
                        print('Готово. Обновите 3D-вкладку планировщика.',flush=True)
                    finally:print('@@done',flush=True)
                elif c.get('restore') and store:
                    folder=store.root/'overrides'
                    if folder.exists():folder.rename(folder.with_name('overrides-backup-'+str(time.time_ns())))
                    print('Восстановлены исходные модели.',flush=True)
            except Exception as e:print('Ошибка: '+str(e),flush=True)
    finally:
        for s in servers:s.shutdown()
        process.terminate()

if __name__=='__main__':main()
