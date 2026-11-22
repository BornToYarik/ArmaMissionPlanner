"""Read-only installed addon inspection. No SQF is executed or game file edited."""
import copy, hashlib, json, struct
from pathlib import Path
from vendor.mission_parser import rap, text_sqm, InvalidMission

def entries(path):
    with path.open('rb') as f:
        def z():
            value=bytearray()
            while True:
                b=f.read(1)
                if not b or len(value)>8192: raise ValueError('Invalid PBO')
                if b==b'\0': return value.decode('utf8',errors='replace')
                value.extend(b)
        rows=[];props={}
        for _ in range(200000):
            name=z();h=struct.unpack('<5I',f.read(20))
            if not name and h[0]==0x56657273:
                while (key:=z()):props[key]=z()
                continue
            if not name:break
            rows.append((name,h))
        offset=f.tell();prefix=props.get('prefix',path.stem).strip('\\').lower();out={}
        for name,h in rows:
            key=(prefix+'\\'+name.replace('/','\\')).strip('\\').lower()
            if Path(name).suffix.lower() in ('.bin','.cpp','.p3d','.paa','.pac','.rtm'):
                out[key]={'archive':str(path),'offset':offset,'size':h[4],'method':h[0],'rawSize':h[1]}
            offset+=h[4]
        return out

def read(entry):
    if max(entry['size'],entry['rawSize'])>64*1024*1024:raise ValueError('Config too large')
    with open(entry['archive'],'rb') as f:f.seek(entry['offset']);data=f.read(entry['size'])
    if not entry['method']:return data
    if entry['method']!=0x43707273:raise ValueError('Unknown compression')
    out=bytearray();q=0
    while len(out)<entry['rawSize']:
        flags=data[q];q+=1
        for bit in range(8):
            if len(out)>=entry['rawSize']:break
            if flags&(1<<bit):out.append(data[q]);q+=1
            else:
                a,b=data[q:q+2];q+=2;distance=a+((b&240)<<4);length=(b&15)+3
                if not distance or len(out)+length>entry['rawSize']:raise ValueError('Invalid LZSS')
                for _ in range(length):
                    i=len(out)-distance;out.append(out[i] if i>=0 else 32)
    if q+4!=len(data) or sum(out)&0xffffffff!=struct.unpack_from('<I',data,q)[0]:raise ValueError('Invalid checksum')
    return bytes(out)

def lower(v):return {k.lower():lower(x) for k,x in v.items()} if isinstance(v,dict) else v
def vehicle_fields(node):
    keys={'__inherit','__external','__delete','model','maxspeed','transportsoldier','hasdriver','hasgunner','hascommander','proxytype','proxyindex','gunnername','primarygunner','primaryobserver','gunneraction','commanding','dontcreateai','enginepower','peaktorque','braketorque','displayname','ispersonTurret'.lower()}
    out={k.lower():v for k,v in node.items() if k.lower() in keys}
    turrets=next((v for k,v in node.items() if k.lower()=='turrets'),None)
    if isinstance(turrets,dict):out['turrets']={k.lower():vehicle_fields(v) if isinstance(v,dict) else v for k,v in turrets.items()}
    return out
def merge(a,b):
    out=copy.deepcopy(a)
    for k,v in b.items():
        if isinstance(v,dict) and v.get('__delete'):out.pop(k,None)
        elif isinstance(v,dict) and v.get('__external'):continue
        elif isinstance(v,dict) and isinstance(out.get(k),dict):
            out[k]=copy.deepcopy(v) if v.get('__inherit',None)=='' else merge(out[k],v)
        elif k!='__inherit' or v:out[k]=copy.deepcopy(v)
    return out

def turret_seats(node):
    # Base Vehicle/NewTurret declarations are templates, not occupied positions.
    # Keep configured FFV and commander positions, including nested turrets.
    total=0
    for key,seat in node.items():
        if key.startswith('__') or not isinstance(seat,dict):continue
        if seat.get('__external') or seat.get('__delete'):continue
        usable=any(k in seat for k in ('gunneraction','proxyindex','proxytype','gunnername'))
        total+=int(usable and seat.get('hasgunner',1)>0)+turret_seats(seat.get('turrets',{}))
    return total

def scan(folders,cache,log):
    paths=[];seen=set()
    for folder in folders:
        # Folder order is the user's selected addon order. Dependencies within
        # the set are topologically applied before dependants.
        for p in sorted(Path(folder).rglob('*.pbo')):
            p=p.resolve()
            if p not in seen:seen.add(p);paths.append(p)
    signature=hashlib.sha256(json.dumps([(str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in paths]).encode()).hexdigest()
    saved=cache/'config-index.json'
    if saved.exists():
        d=json.loads(saved.read_text('utf8'))
        if d.get('signature')==signature and d.get('schema')==8:return d
    index={};addons=[];errors=[]
    for i,p in enumerate(paths):
        try:
            contents=entries(p);index.update(contents)
            for name,e in contents.items():
                if not name.endswith(('\\config.bin','\\config.cpp')):continue
                if name.endswith('.cpp') and name[:-4]+'.bin' in contents:continue
                full=rap(read(e),config=True) if name.endswith('.bin') else text_sqm(read(e),config=True)
                patches=lower(next((v for k,v in full.items() if k.lower()=='cfgpatches'),{}))
                vehicles=next((v for k,v in full.items() if k.lower()=='cfgvehicles'),{})
                config={'cfgvehicles':{k.lower():vehicle_fields(v) for k,v in vehicles.items() if isinstance(v,dict)}}
                addons.append({'path':str(p),'config':config,'patches':set(patches),'requires':{str(r).lower() for v in patches.values() if isinstance(v,dict) for r in v.get('requiredaddons',[])}})
                del full,vehicles
        except (OSError,ValueError,IndexError,struct.error,InvalidMission) as e:errors.append({'file':p.name,'error':str(e)})
        if i%100==0:log(f'Конфиги и модели: {i+1}/{len(paths)} архивов')
    ordered=[];done=set();todo=addons[:];known=set().union(*(a['patches'] for a in addons)) if addons else set()
    while todo:
        ready=[a for a in todo if not((a['requires']&known)-done-a['patches'])]
        if not ready:
            errors.append({'error':'Цикл зависимостей конфигов; сохранён порядок выбранных папок'});ready=todo[:1]
        ready_ids={id(a) for a in ready}
        for a in ready:ordered.append(a);done.update(a['patches'])
        todo=[a for a in todo if id(a) not in ready_ids]
    classes={}
    for a in ordered:
        for name,body in a['config'].get('cfgvehicles',{}).items():
            if isinstance(body,dict):
                if body.get('__delete'):classes.pop(name,None);continue
                if body.get('__external'):continue
                # Arma patches class X:X keep the previously loaded parent;
                # replacing it with X would break the entire inheritance chain.
                body=copy.deepcopy(body)
                if str(body.get('__inherit','')).lower()==name:body.pop('__inherit',None)
                classes[name]=merge(classes.get(name,{}),body)
    memo={}
    def resolve(name,visiting=None):
        name=name.lower()
        if name in memo:return memo[name]
        visiting=set(visiting or ())
        if name in visiting:return {}
        visiting.add(name);own=classes.get(name,{})
        base=resolve(own.get('__inherit',''),visiting) if own.get('__inherit') else {}
        memo[name]=merge(base,own);return memo[name]
    def lineage(name):
        out=[]
        while name and name not in out:
            out.append(name);name=classes.get(name,{}).get('__inherit','').lower()
        return out
    refs={}
    for name in classes:
        c=resolve(name);ancestors=lineage(name);model=str(c.get('model','')).replace('/','\\').strip('\\').lower()
        if model and not model.endswith('.p3d'):model+='.p3d'
        kind='foot' if 'man' in ancestors else 'tracked' if 'tank' in ancestors else 'air' if 'air' in ancestors else 'water' if 'ship' in ancestors else 'wheeled' if 'landvehicle' in ancestors and 'staticweapon' not in ancestors else 'static'
        # Engine defaults documented in CfgVehicles Config Reference:
        # transportSoldier=0, hasDriver=true; -1 disables the driver's seat.
        cargo=c.get('transportsoldier',0);driver=c.get('hasdriver',1);seats=None
        if kind!='foot' and ('landvehicle' in ancestors or 'air' in ancestors or 'ship' in ancestors):
            if isinstance(cargo,(int,float)) and isinstance(driver,(int,float)):
                seats=max(0,int(cargo))+int(driver>0)+turret_seats(c.get('turrets',{}))
        refs[name]={'sourceModel':model,'mobility':kind,'gameplay':kind!='static' or 'staticweapon' in ancestors,'maxSpeed':c.get('maxspeed'),'capacity':seats,'seatConfig':{k:c[k] for k in ['hasdriver','hasgunner','hascommander','transportsoldier','turrets'] if k in c},'displayName':c.get('displayname'),'enginePower':c.get('enginepower'),'peakTorque':c.get('peaktorque'),'brakeTorque':c.get('braketorque'),'source':'installed-addon-config','configSignature':signature}
    out={'schema':8,'signature':signature,'classes':refs,'index':index,'errors':errors}
    cache.mkdir(parents=True,exist_ok=True);saved.write_text(json.dumps(out,separators=(',',':')),encoding='utf8');return out

def prepare_mission(store,mission,folders,quality,app,log):
    from vendor.native_assets import native_model,profile
    import subprocess
    data=scan(folders,store.root,log);index=data['index'];refs=data['classes'];work=store.root/'mission-native';work.mkdir(exist_ok=True)
    ip=work/'index.json';ip.write_text(json.dumps(index),encoding='utf8')
    needed={o['vehicleClass'].lower() for o in mission.get('planningScene',[])}
    catalog={'classes':{},'models':{},'parameters':{k:refs[k] for k in needed if k in refs},'configErrors':len(data['errors'])};jobs=[];sources={};budget,_,texture_size=profile(quality)
    for key in needed:
        ref=refs.get(key,{});source=ref.get('sourceModel')
        if not source or source not in index:continue
        mid=hashlib.sha1(source.encode()).hexdigest()[:16];catalog['classes'][key]=mid
        if mid in sources:continue
        sources[mid]=source;jobs.append({'source':source,'output':str(work/(mid+'.json')),'budget':budget,'textureDirectory':str(store.root/'overrides/models/local-textures'),'textureSize':texture_size})
    for start in range(0,len(jobs),12):
        batch=jobs[start:start+12];jp=work/'jobs.json';jp.write_text(json.dumps(batch),encoding='utf8');log(f'Объекты миссии из сборки: {start+1}–{min(start+12,len(jobs))}/{len(jobs)}')
        subprocess.run([str(app.CONVERTER),'--convert',str(ip),str(jp)],check=True,capture_output=True,timeout=900,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        for job in batch:
            p=Path(job['output']);mid=p.stem
            if not p.exists():continue
            raw=json.loads(p.read_text('utf8'));result=native_model(raw,{'sourceModel':job['source']},environment=True)
            name='models/planning/'+mid+'.json';app.write_override(store,name,result)
            catalog['models'][mid]={'file':name,'sourceModel':job['source'],'nativeOrigin':True,'bounds':result['bounds'],'missingProxies':raw.get('missingProxies',[])}
    app.write_override(store,'models/planning-native-catalog.json',catalog)
    log(f'Готово: {len(catalog["models"])} общих моделей, {len(catalog["parameters"])} классов с параметрами. Ошибок чтения конфигов: {len(data["errors"])}.')
    return catalog
