"""Bounded PBO and SQM readers. Data only: never execute SQF or extract paths."""
import hashlib, json, math, re, struct
MAX_MEMBER=32*1024*1024
class InvalidMission(ValueError): pass

def pbo_members(blob):
    if len(blob)>64*1024*1024: raise InvalidMission('pbo-size')
    p=0; entries=[];names=set()
    def zero():
        nonlocal p
        end=blob.find(b'\0',p,min(len(blob),p+4097))
        if end<0: raise InvalidMission('pbo-string')
        raw=blob[p:end]
        try:s=raw.decode('utf8',errors='strict')
        except UnicodeDecodeError:s=raw.decode('cp1251',errors='strict')
        p=end+1;return s
    def header():
        nonlocal p
        if p+20>len(blob):raise InvalidMission('pbo-header')
        h=struct.unpack_from('<5I',blob,p);p+=20;return h
    for _ in range(20001):
        name=zero();h=header()
        if not name and h[0]==0x56657273:
            for _ in range(200):
                key=zero()
                if not key:break
                zero()
            else:raise InvalidMission('pbo-properties')
            continue
        if not name:break
        name=name.replace('\\','/').lower()
        if name.startswith('/') or ':' in name or any(s in ('','..','.') for s in name.split('/')):raise InvalidMission('unsafe-member-path')
        if name in names:raise InvalidMission('duplicate-member')
        names.add(name)
        entries.append((name,h[0],h[1],h[4]))
    else:raise InvalidMission('pbo-members')
    payload_end=p+sum(e[3] for e in entries)
    if payload_end>len(blob):raise InvalidMission('truncated-pbo')
    if len(blob)-payload_end==21:
        if blob[payload_end]!=0 or hashlib.sha1(blob[:payload_end]).digest()!=blob[-20:]:raise InvalidMission('pbo-checksum')
    elif len(blob)!=payload_end:raise InvalidMission('pbo-footer')
    result={};total=0
    for name,method,original,size in entries:
        data=blob[p:p+size];p+=size
        if not(name=='mission.sqm' or name.endswith('.sqf')):continue
        if size>MAX_MEMBER or original>MAX_MEMBER:raise InvalidMission('member-size')
        if method==0:decoded=data
        elif method==0x43707273:
            out=bytearray();q=0
            try:
                while len(out)<original:
                    flags=data[q];q+=1
                    for bit in range(8):
                        if len(out)>=original:break
                        if flags&(1<<bit):out.append(data[q]);q+=1
                        else:
                            a,b=data[q:q+2];q+=2;distance=a+((b&240)<<4);length=(b&15)+3
                            if distance==0 or len(out)+length>original:raise InvalidMission('lzss-range')
                            for _ in range(length):
                                at=len(out)-distance;out.append(out[at] if at>=0 else 32)
                if q+4!=len(data) or sum(out)&0xffffffff!=struct.unpack_from('<I',data,q)[0]:raise InvalidMission('member-checksum')
            except (IndexError,struct.error,ValueError) as e:raise InvalidMission('lzss-data') from e
            decoded=bytes(out)
        else:raise InvalidMission('member-compression')
        total+=len(decoded)
        if total>64*1024*1024:raise InvalidMission('expanded-size')
        result[name]=decoded
    if 'mission.sqm' not in result:raise InvalidMission('missing-sqm')
    return result

def rap(blob,config=False):
    p=16;nodes=0;active=set()
    def read(fmt):
        nonlocal p
        n=struct.calcsize('<'+fmt)
        if p+n>len(blob):raise InvalidMission('rap-bounds')
        value=struct.unpack_from('<'+fmt,blob,p)[0];p+=n;return value
    def zero():
        nonlocal p
        end=blob.find(b'\0',p)
        if end<0 or end-p>MAX_MEMBER:raise InvalidMission('rap-string')
        s=blob[p:end].decode('utf8',errors='replace');p=end+1;return s
    def count():
        value=0
        for shift in range(0,35,7):
            b=read('B');value|=(b&127)<<shift
            if b<128:
                if value>1000000:raise InvalidMission('rap-count')
                return value
        raise InvalidMission('rap-count')
    def value(t,depth):
        if depth>64:raise InvalidMission('rap-depth')
        if t==0:return zero()
        if t==1:return read('f')
        if t==2:return read('i')
        if t==3:return [value(read('B'),depth+1) for _ in range(count())]
        raise InvalidMission('rap-value')
    def body(at,depth=0):
        nonlocal p,nodes
        if depth>64 or at in active or at<16 or at>=len(blob):raise InvalidMission('rap-offset')
        active.add(at);p=at;result={'__inherit':zero()}
        for _ in range(count()):
            nodes+=1
            if nodes>500000:raise InvalidMission('rap-nodes')
            t=read('B')
            if t==0:
                name=zero();offset=read('I');saved=p;result[name]=body(offset,depth+1);p=saved
            elif t==1:
                dtype=read('B');name=zero();result[name]=value(dtype,0)
            elif t==2:
                name=zero();result[name]=[value(read('B'),0) for _ in range(count())]
            elif t in (3,4):result[zero()]=({'__external':True} if t==3 else {'__delete':True}) if config else {}
            else:raise InvalidMission('rap-type')
        active.remove(at);return result
    return body(16)

TOKEN=re.compile(r'\s+|//[^\n]*|/\*[\s\S]*?\*/|"(?:""|[^"\\]|\\.)*"|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|[^\s]')
def text_sqm(blob):
    text=blob.decode('utf-8-sig',errors='strict');tokens=[m.group() for m in TOKEN.finditer(text) if not m.group().isspace() and not m.group().startswith(('//','/*'))];i=0;nodes=0
    if len(tokens)>3000000:raise InvalidMission('sqm-size')
    def take(expect=None):
        nonlocal i
        if i>=len(tokens):raise InvalidMission('sqm-eof')
        t=tokens[i];i+=1
        if expect is not None and t!=expect:raise InvalidMission('sqm-token')
        return t
    def val(depth=0):
        if depth>64:raise InvalidMission('sqm-depth')
        t=take()
        if t=='{':
            a=[]
            while tokens[i]!='}':
                a.append(val(depth+1))
                if tokens[i]==',':take(',')
                elif tokens[i]!='}':raise InvalidMission('sqm-array')
            take('}');return a
        if t.startswith('"'):return t[1:-1].replace('""','"')
        if t.lower() in ('true','false'):return t.lower()=='true'
        try:
            v=float(t) if any(s in t.lower() for s in ('.','e')) else int(t)
            if not math.isfinite(v):raise ValueError()
            return v
        except ValueError:raise InvalidMission('sqm-expression')
    def block(depth=0,closed=False):
        nonlocal nodes
        if depth>64:raise InvalidMission('sqm-depth')
        result={}
        while i<len(tokens) and tokens[i]!='}':
            nodes+=1
            if nodes>500000:raise InvalidMission('sqm-nodes')
            name=take()
            if name=='class':
                name=take();inherit=''
                if tokens[i]==':':take(':');inherit=take()
                if tokens[i]==';':take(';');result[name]={'__inherit':inherit};continue
                take('{');result[name]=block(depth+1,True);result[name]['__inherit']=inherit;take(';')
            else:
                if tokens[i]=='[':take('[');take(']')
                take('=');result[name]=val();take(';')
        if closed:take('}')
        return result
    try:return block()
    except (IndexError,RecursionError) as e:raise InvalidMission('sqm-malformed') from e

def read_sqm(blob):
    return rap(blob) if blob.startswith(b'\0raP') else text_sqm(blob)

def walk(v):
    if isinstance(v,dict):
        yield v
        for c in v.values():yield from walk(c)
    elif isinstance(v,list):
        for c in v:yield from walk(c)

def attrs(n):return {a['property']:a.get('Value',{}).get('data',{}).get('value') for a in walk(n.get('CustomAttributes',{})) if 'property' in a}
def position(n):
    p=n.get('position') or n.get('PositionInfo',{}).get('position')
    return [p[0],p[2],p[1]] if isinstance(p,list) and len(p)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in p) else None

def rotation(angles):
    p,y,r=(angles+[0,0,0])[:3];cp,sp,cy,sy,cr,sr=math.cos(p),math.sin(p),math.cos(y),math.sin(y),math.cos(r),math.sin(r)
    a=[[1,0,0],[0,cp,sp],[0,-sp,cp]];b=[[cr,-sr,0],[sr,cr,0],[0,0,1]];c=[[cy,0,-sy],[0,1,0],[sy,0,cy]]
    mul=lambda a,b:[[sum(a[i][k]*b[k][j] for k in range(3))for j in range(3)]for i in range(3)]
    return sum(mul(mul(a,b),c),[])

def safe_init(code):
    code=re.sub(r'/\*.*?\*/|//[^\r\n]*','',str(code),flags=re.S).strip();statements=[s.strip() for s in code.split(';') if s.strip()]
    patterns=[r'this\s+(?:allowDamage|enableSimulation(?:Global)?)\s+(?:true|false)',r'this\s+setVariable\s*\[\s*"(?:WMT_Side|tf_side)"\s*,\s*(?:sideLogic|west|east|resistance|independent|civilian|"(?:west|east|guer|civ)")\s*(?:,\s*(?:true|false)\s*)?\]']
    return all(any(re.fullmatch(p,s,re.I) for p in patterns) for s in statements)

def bindings(entities,tracks,slots):
    side=lambda s:{'west':'west','east':'east','guer':'independent','independent':'independent','civ':'civilian'}.get(str(s).lower(),str(s).lower())
    candidates={}
    for e in entities:
        ps=tracks.get(str(e['id']),tracks.get(e['id'],[]));p=ps[0] if ps else None
        if not p or p[0]>2:continue
        rows=sorted([(math.hypot(p[1]-o['position'][0],p[2]-o['position'][2]),o) for o in slots if str(o.get('className')).lower()==str(e.get('className')).lower() and(e['type']!='unit' or side(o.get('side'))==side(e.get('side')))],key=lambda r:r[0])
        limit,margin=(12,3)if e['type']=='unit'else(25,8)
        if rows and rows[0][0]<=limit and(len(rows)==1 or rows[1][0]-rows[0][0]>=margin):candidates[str(e['id'])]=rows[0]
    counts={}
    for _,o in candidates.values():counts[o['editorId']]=counts.get(o['editorId'],0)+1
    return {k:{'editorId':o['editorId'],'distance':round(d,2),'confidence':'class-side-initial-position','equipment':o.get('equipment')}for k,(d,o) in candidates.items() if counts[o['editorId']]==1}

def deformer(text,step,resolution):
    if not isinstance(text,str) or not text.startswith('x'):raise InvalidMission('unsupported-deformer')
    values=json.loads(text[1:]);points={}
    for column in values:
        x=column[0]
        if type(x)!=int:raise InvalidMission('deformer-x')
        for segment in column[1:]:
            y=segment[0]
            if type(y)!=int:raise InvalidMission('deformer-y')
            for i,z in enumerate(segment[1:]):
                if type(z)not in(int,float) or not math.isfinite(z):raise InvalidMission('deformer-height')
                if x<=1 or x>=resolution-1 or y+i<=1 or y+i>=resolution-1:continue
                if (x,y+i)in points:raise InvalidMission('deformer-duplicate')
                points[x,y+i]=z
                if len(points)>1000000:raise InvalidMission('deformer-count')
    return {'cellSize':step,'coordinateOrder':'x,y,zASL','points':[[x*step,y*step,z]for(x,y),z in sorted(points.items())]}
