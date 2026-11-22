"""Read installed optic models and their alpha textures; never run game scripts."""
import json, subprocess
from pathlib import Path
from configs import read, rap

def prepare_optics(index,work,store,app,log):
    definitions={
      'binocular':('a3\\weapons_f\\reticle\\optics_binoculars.p3d','binocular_ca.paa','binocular_axis01_ca.paa'),
      'abrams':('rhsusf\\addons\\rhsusf_m1a1\\gunneroptics_m1a1.p3d','puskohled.paa','gunneroptics_m1a1_x3_ca.paa')}
    jobs=[];result={}
    for name,(source,*_) in definitions.items():
        if source in index: jobs.append({'source':source,'output':str(work/(name+'-optic.json')),'highestDetail':True,'textureDirectory':str(store.root/'overrides/models/local-textures'),'textureSize':2048})
    if not jobs:return result
    path=work/'optic-jobs.json';path.write_text(json.dumps(jobs),encoding='utf8')
    subprocess.run([str(app.CONVERTER),'--convert',str(work/'index.json'),str(path)],check=True,capture_output=True,timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    for name,(source,mask,reticle) in definitions.items():
        path=work/(name+'-optic.json')
        if source not in index or not path.exists():continue
        raw=json.loads(path.read_text('utf8'));textures=dict(zip(raw['textures'],raw['nativeMaterials']))
        find=lambda suffix:next((m.get('texture') for t,m in textures.items() if t.lower().endswith(suffix)),None)
        result[name]={'mask':find(mask),'reticle':find(reticle),'sourceModel':source, 'geometry':{'positions':raw['positions'],'uvs':raw['uvs'],'triangles':raw['triangles'],'materials':raw['nativeMaterials'],'maskMaterial':next(i for i,t in enumerate(raw['textures']) if t.lower().endswith(mask))}}
    config=index.get('a3\\weapons_f\\config.bin')
    if config and 'binocular' in result:
        try:
            b=rap(read(config))['CfgWeapons']['Binocular']
            result['binocular']['minimumFovRadians']=b['opticsZoomMin']
        except (KeyError,ValueError):log('Предел бинокля не прочитан; используется стандартный предел.')
    return result
