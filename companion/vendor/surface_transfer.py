"""Conservative nearest-surface UV and rigid-part transfer between visual LODs."""
import math,json,subprocess,tempfile
from pathlib import Path
from collections import defaultdict
from itertools import product
NATIVE_EXECUTABLE=None

def closest(p,a,b,c):
    sub=lambda x,y:tuple(i-j for i,j in zip(x,y))
    dot=lambda x,y:sum(i*j for i,j in zip(x,y))
    ab,ac,ap=sub(b,a),sub(c,a),sub(p,a)
    d1,d2=dot(ab,ap),dot(ac,ap)
    if d1<=0 and d2<=0:return (1,0,0)
    bp=sub(p,b);d3,d4=dot(ab,bp),dot(ac,bp)
    if d3>=0 and d4<=d3:return (0,1,0)
    vc=d1*d4-d3*d2
    if vc<=0 and d1>=0 and d3<=0:
        v=d1/(d1-d3);return (1-v,v,0)
    cp=sub(p,c);d5,d6=dot(ab,cp),dot(ac,cp)
    if d6>=0 and d5<=d6:return (0,0,1)
    vb=d5*d2-d1*d6
    if vb<=0 and d2>=0 and d6<=0:
        w=d2/(d2-d6);return (1-w,0,w)
    va=d3*d6-d5*d4
    if va<=0 and d4-d3>=0 and d5-d6>=0:
        w=(d4-d3)/((d4-d3)+(d5-d6));return (0,1-w,w)
    total=va+vb+vc
    if abs(total)<1e-18:return (1,0,0)
    v,w=vb/total,vc/total;return (1-v-w,v,w)

def project(positions,base,detail=False):
    if NATIVE_EXECUTABLE:
        with tempfile.TemporaryDirectory(prefix='wog-surface-') as temp:
            source=Path(temp)/'input.json';target=Path(temp)/'output.json'
            source.write_text(json.dumps({'positions':positions,'base':base,'detail':detail}),encoding='utf8')
            run=subprocess.run([str(NATIVE_EXECUTABLE),'--project',str(source),str(target)],capture_output=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if run.returncode or not target.is_file():raise ValueError('Новая поверхность не совмещается с проверенной моделью')
            return [(int(r[0]),[r[1],r[2]],int(r[3]),r[4]) if detail else (int(r[0]),[r[1],r[2]],int(r[3])) for r in json.loads(target.read_text(encoding='utf8'))]
    old=base['positions'];verts=list(zip(old[::3],old[1::3],old[2::3]))
    extent=max(max(old[i::3])-min(old[i::3]) for i in range(3));cell=max(.04,extent/16);limit=max(.03,extent*(.12 if detail else .025))
    tri=[base['indices'][i:i+3] for i in range(0,len(base['indices']),3)]
    materials=[0]*len(tri)
    for g in base['groups']:
        for i in range(g['start']//3,(g['start']+g['count'])//3):materials[i]=g['materialIndex']
    grid=defaultdict(list);tri_verts=[];bounds=[]
    for i,indices in enumerate(tri):
        v=[verts[k] for k in indices];tri_verts.append(v)
        bounds.append(tuple((min(p[a] for p in v),max(p[a] for p in v)) for a in range(3)))
        ranges=[range(math.floor((min(p[a] for p in v)-limit)/cell),math.floor((max(p[a] for p in v)+limit)/cell)+1) for a in range(3)]
        for key in product(*ranges):grid[key].append(i)
    out=[];uvs=base['uvs'];parts=base.get('rig',{}).get('parts');memo={}
    for p in zip(positions[::3],positions[1::3],positions[2::3]):
        if p in memo:out.append(memo[p]);continue
        candidates=grid.get(tuple(math.floor(v/cell) for v in p),[])
        best=None;dist=limit**2
        for i in candidates:
            bound=bounds[i]
            dx=max(bound[0][0]-p[0],0,p[0]-bound[0][1]);dy=max(bound[1][0]-p[1],0,p[1]-bound[1][1]);dz=max(bound[2][0]-p[2],0,p[2]-bound[2][1])
            if dx*dx+dy*dy+dz*dz>dist:continue
            indices=tri[i];v=tri_verts[i];w=closest(p,*v)
            d=sum((p[a]-sum(v[k][a]*w[k] for k in range(3)))**2 for a in range(3))
            if d<=dist:
                dist=d;main=max(range(3),key=lambda k:w[k]);best=(materials[i],[sum(uvs[indices[k]*2+a]*w[k] for k in range(3)) for a in range(2)],parts[indices[main]] if parts else 0)
        if best is None:raise ValueError('Новая поверхность не совмещается с проверенной моделью')
        item=(*best,math.sqrt(dist)) if detail else best;memo[p]=item;out.append(item)
    return out
