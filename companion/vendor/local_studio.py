"""WOG local viewer. Game files are read-only; generated files stay in cache."""
import gzip, hashlib, json, math, mimetypes, os, re, secrets, struct, subprocess, sys, threading, time, webbrowser
from asset_transport import AssetTransport
from collections import defaultdict,Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SITE = 'https://wogreplay.ru/'
CACHE = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'WOG-Studio'
LIMIT = 512 * 1024 * 1024
CONVERTER = (Path(sys.executable).parent if getattr(sys,'frozen',False) else Path(__file__).parent)/'WOG-Studio.exe'

def safe_path(name):
    if not isinstance(name,str) or len(name)>500 or not re.fullmatch(r'[a-zA-Z0-9_./-]+',name):
        raise ValueError('Недопустимый путь')
    if name.startswith('/') or any(x in ('..','.','') for x in name.split('/')):
        raise ValueError('Недопустимый путь')
    if not name.startswith(('data/','models/','maps/','terrain/','environment/','vendor/','icons/','markers/','fonts/','roads/')) and '/' in name:
        raise ValueError('Недопустимая папка')
    if Path(name).suffix.lower() not in ('.json','.js','.css','.html','.svg','.webp','.png','.jpg','.bin','.gz','.brdata','.wasm','.woff','.woff2','.txt'):
        raise ValueError('Недопустимый тип файла')
    return name

def import_package(filename):
    path=Path(filename)
    if path.stat().st_size>LIMIT: raise ValueError('Файл больше 512 МБ')
    with path.open('rb') as f:
        packed=f.read(2)==b'\x1f\x8b';f.seek(0)
        stream=gzip.GzipFile(fileobj=f) if packed else f
        raw=stream.read(LIMIT+1)
    if len(raw)>LIMIT: raise ValueError('Распакованный файл больше 512 МБ')
    doc=json.loads(raw)
    if doc.get('format')!='WOG-Studio-Replay' or doc.get('version')!=1: raise ValueError('Это не повтор WOG Studio')
    replay=doc.get('replay','')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,160}',replay): raise ValueError('Неверное имя повтора')
    files=doc.get('files',{})
    if not isinstance(files,dict) or len(files)>4000: raise ValueError('Неверный список ресурсов')
    checked=[]
    for name,text in files.items():
        safe_path(name)
        if not isinstance(text,str): raise ValueError('Неверное содержимое ресурса')
        if name.startswith('data/') and not name.startswith('data/'+replay+'/'): raise ValueError('Данные другого повтора')
        checked.append((name,text))
    manifest=json.loads(files['data/'+replay+'/manifest.json'])
    if type(manifest.get('chunks')) is not int or not 1<=manifest['chunks']<=2000:raise ValueError('Неверное число блоков')
    for i in range(manifest['chunks']):
        if 'data/'+replay+'/'+str(i)+'.json' not in files: raise ValueError('В повторе не хватает кадров')
    # Separate imports avoid stale optional files, old runtimes or model overrides.
    digest=hashlib.sha256(raw).hexdigest()[:16]
    root=CACHE/'replays'/(replay+'-'+digest)
    for name,text in checked:
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text,encoding='utf8')
    (root/'studio-project.json').write_text(json.dumps(doc.get('project',{})),encoding='utf8')
    return root,replay,manifest

class Store:
    def __init__(self,root,replay,manifest):
        self.root,self.replay,self.manifest=root,replay,manifest
        self.cache=CACHE/'assets';self.lock=threading.Lock();self.locks={}
        self.transport=AssetTransport();self.token=secrets.token_hex(32)
        self.viewer_origin=None;self.control_url=''
    def read(self,name,version='',original=False):
        name=safe_path(name)
        cache=self.cache/('versions/'+hashlib.sha256(version.encode()).hexdigest()[:24]) if version else self.cache
        for base in ((self.root,cache) if original else (self.root/'overrides',self.root,cache)):
            p=base/name
            if p.is_file():return p.read_bytes()
        # Imported replay is authoritative; never silently replace it with newer server data.
        if not name.startswith(('models/','maps/','terrain/','environment/','vendor/','icons/','markers/','fonts/','roads/')):raise FileNotFoundError(name)
        with self.lock: gate=self.locks.setdefault((name,version),threading.Lock())
        with gate:
            target=cache/name
            if target.is_file():return target.read_bytes()
            target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.tmp')
            data=self.transport.read(name,version=version)
            if len(data)>LIMIT:raise ValueError('Asset too large')
            if name.endswith('.json'):json.loads(data)
            tmp.write_bytes(data);tmp.replace(target)
            return data
    def json(self,name,version='',original=False):return json.loads(self.read(name,version,original))

def handler(store):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def allowed(self,private=False):
            host=self.headers.get('Host','')
            hosts=('127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port))
            if host not in hosts:return False
            return not private or (secrets.compare_digest(self.headers.get('X-WOG-Local',''),store.token) and self.headers.get('Origin','http://'+host) in ('http://'+host,store.viewer_origin))
        def end_headers(self):
            if store.viewer_origin and self.path.startswith('/__local/') and self.headers.get('Origin')==store.viewer_origin:
                self.send_header('Access-Control-Allow-Origin',store.viewer_origin)
                self.send_header('Vary','Origin')
            super().end_headers()
        def do_OPTIONS(self):
            if not self.allowed() or not self.path.startswith('/__local/') or self.headers.get('Origin')!=store.viewer_origin:return self.send_error(403)
            self.send_response(204);self.send_header('Access-Control-Allow-Methods','GET, POST')
            self.send_header('Access-Control-Allow-Headers','X-WOG-Local, X-Asset-Status')
            self.send_header('Access-Control-Max-Age','3600');self.end_headers()
        def do_POST(self):
            if not self.allowed():return self.send_error(403)
            if self.path=='/__local/reset':
                if not self.allowed(True):return self.send_error(403)
                store.transport.reset();self.send_response(204);self.end_headers();return
            if self.path.startswith('/__local/result/'):
                if not self.allowed(True):return self.send_error(403)
                try:
                    size=int(self.headers.get('Content-Length','-1'));status=int(self.headers.get('X-Asset-Status','502'))
                    if not 0<=size<=LIMIT:return self.send_error(413)
                    self.connection.settimeout(30);data=self.rfile.read(size)
                    if len(data)!=size:return self.send_error(400)
                    found=store.transport.finish(self.path.rsplit('/',1)[-1],status,data)
                    self.send_response(204 if found else 410);self.end_headers();return
                except (ValueError,TimeoutError,ConnectionError):return self.send_error(400)
            if self.path.startswith('/api/replays/'):return self.do_GET()
            self.send_error(405)
        def do_GET(self):
            if not self.allowed():return self.send_error(403)
            path=unquote(urlsplit(self.path).path).lstrip('/')
            try:
                if path=='__local/jobs':
                    if not self.allowed(True):return self.send_error(403)
                    data=json.dumps(store.transport.poll(urlsplit(self.path).query=='ready=1')).encode();ctype='application/json'
                elif path=='__local/loader.js':
                    text=(Path(__file__).parent/'browser_loader.js').read_text(encoding='utf8')
                    data=text.replace('__TOKEN__',json.dumps(store.token)).replace('__SITE__',json.dumps(SITE)).replace('__CONTROL__',json.dumps(store.control_url)).encode();ctype='text/javascript'
                elif path=='api/replays/'+store.replay+'/mission-context':
                    try:result={'status':'available','context':store.json('data/'+store.replay+'/mission-context.json')}
                    except FileNotFoundError:result={'status':'unavailable'}
                    data=json.dumps(result).encode();ctype='application/json'
                elif path.startswith('api/replays/'):
                    data=b'{"state":"ready"}';ctype='application/json'
                elif path=='api/catalog':
                    data=json.dumps({'missions':[{'id':store.replay,'title':store.manifest.get('title',store.replay),'available':True}]}).encode();ctype='application/json'
                else:
                    if path in ('','studio','studio/'):path='studio.html'
                    version=parse_qs(urlsplit(self.path).query).get('v',[''])[0][:256]
                    data=store.read(path,version);ctype={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm'}.get(Path(path).suffix.lower()) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
                    if path in ('3d.js','studio-app.js','replay-app.js'):
                        from native_assets import patch_texture_wrapping
                        data=patch_texture_wrapping(data.decode('utf8')).encode()
                    if path=='studio.html':
                        html=re.sub(r'<base\s+href="[^"]*"\s*>','<base href="/">',data.decode('utf8'))
                        data=html.replace('<head>','<head><script src="/__local/loader.js"></script>',1).encode()
                self.send_response(200);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(data)
            except (ValueError,FileNotFoundError,HTTPError):self.send_error(404)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception:self.send_error(502,'Asset download failed; check connection')
    return Handler

def pbo_entries(path):
    with path.open('rb') as f:
        def z():
            result=bytearray()
            while True:
                b=f.read(1)
                if not b or len(result)>8192:raise ValueError('Invalid PBO header')
                if b==b'\0':return result.decode('utf8',errors='replace')
                result.extend(b)
        props={};rows=[]
        for _ in range(200000):
            name=z();h=struct.unpack('<5I',f.read(20))
            if not name and h[0]==0x56657273:
                while (key:=z()):props[key]=z()
                continue
            if not name:break
            rows.append((name,h))
        offset=f.tell();result={};prefix=props.get('prefix',path.stem).lower().strip('\\')
        for name,h in rows:
            if Path(name).suffix.lower() in ('.p3d','.paa','.pac'):
                result[(prefix+'\\'+name).lower().lstrip('\\')]={'archive':str(path),'offset':offset,'size':h[4],'method':h[0],'rawSize':h[1]}
            offset+=h[4]
        return result

def legacy_frame(reference,base,meta):
    """Recover only the recorded original LOD's normalization, not a guessed offset."""
    if reference.get('missingProxies') or abs(reference['lod']-meta['lod'])>.0001:raise ValueError('Нет исходного LOD для проверки привязки')
    used={i for face in reference['triangles'] for i in face[:3]}
    lo=[min(reference['positions'][i*3+a]*(-1 if a==0 else 1) for i in used) for a in range(3)]
    hi=[max(reference['positions'][i*3+a]*(-1 if a==0 else 1) for i in used) for a in range(3)]
    bounds=[(min(base['positions'][a::3]),max(base['positions'][a::3])) for a in range(3)]
    if any(abs(hi[a]-lo[a]-(b[1]-b[0]))>max(.06,(b[1]-b[0])*.05) for a,b in enumerate(bounds)):raise ValueError('Изменились размеры исходной модели')
    origin=[(lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2]
    from surface_transfer import project
    projected=project([reference['positions'][i*3+a]*(-1 if a==0 else 1)-origin[a] for i in sorted(used) for a in range(3)],base,True)
    extent=max(b[1]-b[0] for b in bounds)
    if sum(p[3]>max(.03,extent*.025) for p in projected)>len(projected)*.1:raise ValueError('Исходный LOD не совпадает с моделью повтора')
    return {**meta,'nativeOrigin':origin,'orientationConvention':'forward-negative-z','legacyMirrorX':True}

def transfer_model(raw,base,meta):
    """Transfer the existing UV atlas and rigid-part assignments conservatively.
    New shape comes from native P3D. Any unsupported/new surface retains old model.
    """
    if raw.get('missingProxies'):raise ValueError('Не найдены составные части модели')
    origin=meta.get('nativeOrigin')
    if not origin or meta.get('orientationConvention')!='forward-negative-z':raise ValueError('Не подтверждена система координат')
    if meta.get('legacyMirrorX'):
        raw={**raw,'positions':[v*(-1 if i%3==0 else 1) for i,v in enumerate(raw['positions'])],'triangles':[[t[0],t[2],t[1],t[3]] for t in raw['triangles']]}
    if len(raw['triangles'])*3<=len(base['indices']):raise ValueError('Исходная модель уже достаточно подробная')
    used=sorted({i for face in raw['triangles'] for i in face[:3]});remap={old:new for new,old in enumerate(used)}
    raw={**raw,'positions':[v for i in used for v in raw['positions'][i*3:i*3+3]],'triangles':[[remap[i] for i in face[:3]]+[face[3]] for face in raw['triangles']],'vertexBones':[raw.get('vertexBones',['']*(max(used)+1))[i] for i in used]}
    positions=[v-origin[i%3] for i,v in enumerate(raw['positions'])]
    old=base['positions'];uv=base.get('uvs');rig=base.get('rig')
    if not uv or not base.get('groups'):raise ValueError('Нет проверенной UV-развёртки')
    from surface_transfer import project
    mapped=project(positions,base,True)
    extent=max(max(old[i::3])-min(old[i::3]) for i in range(3))
    # Fine details can be absent from a simplified LOD. Reject widespread mismatch,
    # while permitting a few new handles/spokes near the validated surface.
    if sum(item[3]>max(.03,extent*.025) for item in mapped)>len(mapped)*.1:raise ValueError('Слишком много новых поверхностей без проверенной текстуры')
    indices=[];groups=[]
    for m in range(len(base['materials'])):
        start=len(indices)
        for a,b,c,_ in raw['triangles']:
            mats=[mapped[x][0] for x in (a,b,c)]
            if max(set(mats),key=lambda k:(mats.count(k),-k))==m:indices.extend((a,b,c))
        if len(indices)>start:groups.append({'start':start,'count':len(indices)-start,'materialIndex':m})
    output={'positions':positions,'indices':indices,'uvs':[v for item in mapped for v in item[1]],'groups':groups,'materials':base['materials']}
    if rig:
        # A native bone may not be split across different rigid joints by proximity.
        assignments=defaultdict(Counter)
        for i,bone in enumerate(raw.get('vertexBones',[])):
            if bone:assignments[bone][mapped[i][2]]+=1
        dominant={}
        for bone,counts in assignments.items():
            part,n=counts.most_common(1)[0]
            if n/sum(counts.values())<.95:raise ValueError('Неоднозначное сопоставление анимации')
            dominant[bone]=part
        output['rig']={**rig,'parts':[dominant.get(raw['vertexBones'][i],item[2]) for i,item in enumerate(mapped)]}
    return output

def write_override(store,name,value):
    dest=store.root/'overrides'/safe_path(name);dest.parent.mkdir(parents=True,exist_ok=True)
    temp=dest.with_suffix(dest.suffix+'.tmp');temp.write_text(json.dumps(value,separators=(',',':')),encoding='utf8')
    packed=Path(str(dest)+'.brdata');temporary=Path(str(packed)+'.tmp')
    subprocess.run([str(CONVERTER),'--pack-brotli',str(temp),str(temporary)],check=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    temp.replace(dest);temporary.replace(packed)

def upgrade(store,folders,quality,log):
    from native_assets import run_upgrade
    run_upgrade(store,folders,quality,log,sys.modules[__name__])


def main():
    if '--worker' not in sys.argv:return
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf8',line_buffering=True)
    if hasattr(sys.stdin,'reconfigure'):sys.stdin.reconfigure(encoding='utf8')
    servers=[];current=None
    for line in sys.stdin:
        try:
            command=json.loads(line)
            if 'open' in command:
                root,replay,manifest=import_package(command['open']);current=Store(root,replay,manifest)
                server=ThreadingHTTPServer(('127.0.0.1',0),handler(current));servers.append(server)
                control=ThreadingHTTPServer(('127.0.0.1',0),handler(current));servers.append(control)
                current.viewer_origin='http://127.0.0.1:'+str(server.server_port)
                current.control_url='http://127.0.0.1:'+str(control.server_port)
                threading.Thread(target=control.serve_forever,daemon=True).start()
                threading.Thread(target=server.serve_forever,daemon=True).start()
                url='http://127.0.0.1:'+str(server.server_port)+'/studio?replay='+replay+'&lang=ru&local=1'
                webbrowser.open(url);print('Открыт '+manifest.get('title',replay)+'\n'+url,flush=True)
            elif 'upgrade' in command:
                try:
                    if not current:raise ValueError('Сначала откройте повтор.')
                    upgrade(current,command['upgrade'],command.get('quality',command.get('budget','medium')),lambda message:print(message,flush=True))
                finally:print('@@done',flush=True)
            elif command.get('restore') and current:
                folder=current.root/'overrides'
                if folder.exists():folder.rename(folder.with_name('overrides-backup-'+str(time.time_ns())))
                print('Восстановлены модели сайта. Обновите страницу студии.',flush=True)
        except Exception as e:print('Ошибка: '+str(e),flush=True)
    for server in servers:server.shutdown()

if __name__=='__main__':main()
