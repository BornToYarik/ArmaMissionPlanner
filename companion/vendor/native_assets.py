"""Local native geometry and textures, independent of the website's simplified LOD."""
import copy, hashlib, json, re, subprocess
from pathlib import Path

PROFILES = {'low': (12000, 3000, 1024), 'medium': (30000, 8000, 2048), 'high': (60000, 20000, 4096)}

def normalize(source):
    return source.replace('/', '\\').lower().lstrip('\\')

def profile(value):
    return PROFILES.get(str(value), PROFILES['low' if value == 12000 else 'high' if value == 60000 else 'medium'])

def source_for(meta, lookup):
    source=normalize(meta.get('sourceModel') or meta.get('source') or '')
    return source or lookup.get(Path(meta['file']).stem, '')

def native_model(raw, meta, base=None, environment=False):
    if not raw['triangles'] or not raw.get('nativeMaterials'):raise ValueError('Нет геометрии или материалов')
    mirror=not environment and not meta.get('nativeOrigin')
    signs=(-1,1,-1) if environment else (-1,1,1) if mirror else (1,1,1)
    origin=(0,0,0) if environment else meta.get('nativeOrigin',raw['legacyOrigin'])
    positions=[v*signs[i%3]-origin[i%3] for i,v in enumerate(raw['positions'])]
    materials=copy.deepcopy(raw['nativeMaterials']);indices=[];groups=[]
    for i,material in enumerate(materials):
        if environment:
            if material.get('texture'):material['texture']='../'+material['texture']
            rgb=material.get('color',[1,1,1]);material['color']='#'+''.join(f'{max(0,min(255,round(v*255))):02x}' for v in rgb)
        start=len(indices)
        for a,b,c,m in raw['triangles']:
            if m==i:indices.extend((a,c,b) if mirror else (a,b,c))
        if len(indices)>start:groups.append({'start':start,'count':len(indices)-start,'materialIndex':i})
    result={'positions':positions,'uvs':raw['uvs'],'indices':indices,'groups':groups,'materials':materials,
            'sourceLod':raw['lod'],'localNative':True,'textureSource':'Installed Arma P3D UVs and PAA textures'}
    if environment:
        result['bounds']=[[min(positions[a::3]) for a in range(3)],[max(positions[a::3]) for a in range(3)]]
        result['minY']=result['bounds'][0][1]
    rig=(base or {}).get('rig')
    if rig:
        # Bind by recorded skeleton ancestry, not a proximity vote across different LODs.
        direct={}
        for mount in rig.get('mounts',[]):
            names=mount['key'].lower().split(':')
            if len(names)==2:direct[names[0]]=mount['yaw']+1;direct[names[1]]=mount['pitch']+1
        parents={b['name']:b['parent'] for b in raw.get('bones',[])}
        def part(bone):
            seen=set()
            while bone and bone not in seen:
                if bone in direct:return direct[bone]
                seen.add(bone);bone=parents.get(bone,'')
            return 0
        result['rig']={**rig,'parts':[part(b) for b in raw['vertexBones']]}
    return result

def patch_texture_wrapping(text):
    # Older exported bundles assume every actor texture is a clamped atlas.
    # The expression is confined to that assignment; native UVs can repeat.
    return re.sub(r'(\b([\w$]+)\.wrapS=\2\.wrapT=)([\w$]+)\.ClampToEdgeWrapping',r'\1\3.RepeatWrapping',text)

def run_upgrade(store, folders, quality, log, app):
    actor_budget,nature_budget,texture_size=profile(quality)
    index={};archives=set()
    for folder in folders:
        for file in Path(folder).rglob('*.pbo'):
            file=file.resolve()
            if file in archives:continue
            archives.add(file)
            try:index.update(app.pbo_entries(file))
            except (OSError,ValueError):continue
            if len(archives)%200==0:log('Проверено архивов: '+str(len(archives)))
    work=store.root/'conversion-native';work.mkdir(exist_ok=True)
    (work/'index.json').write_text(json.dumps(index),encoding='utf8')
    try:actors=store.json('data/'+store.replay+'/actor-index.json',original=True)
    except FileNotFoundError:
        try:actors=store.json('data/'+store.replay+'/actor-pack.json',original=True)['catalog']
        except FileNotFoundError:actors=store.json('models/catalog.json',original=True)
    env_path='environment/worlds/'+store.manifest['world']+'.json'
    environment=store.json(env_path,original=True)
    mission_path='data/'+store.replay+'/mission-context.json'
    try:mission=store.json(mission_path,original=True)
    except (FileNotFoundError,json.JSONDecodeError):mission=None
    lookup={hashlib.sha1(source.encode()).hexdigest()[:12]:source for source in index if source.endswith('.p3d')}
    report=[];models=[];jobs=[]
    targets=[('actor',actors['models'],None),('environment',environment['models'],environment)]
    if mission and mission.get('assetCatalog'):targets.append(('mission',mission['assetCatalog']['models'],mission['assetCatalog']))
    texture_dir=store.root/'overrides/models/local-textures'
    seen={};visibility_owners={}
    for kind,entries,owner in targets:
        iterable=entries.items() if isinstance(entries,dict) else enumerate(entries)
        for key,meta in iterable:
            if not meta:continue
            source=source_for(meta,lookup)
            if kind=='actor' and (key==actors.get('infantry') or key=='b_soldier_01'):continue
            if source not in index:
                report.append({'model':str(key),'kind':kind,'result':'Сохранена модель сайта: исходник не найден','file':meta.get('file')});continue
            budget=nature_budget if meta.get('category') in ('tree','bush','rock') else actor_budget
            highest=hasattr(store,'mission') and kind=='environment' and meta.get('category') in ('building','rock')
            signature=(source,budget,meta.get('lod'),highest)
            if signature not in seen:
                output=work/(str(len(jobs))+'.json');seen[signature]=output
                job={'source':source,'output':str(output),'budget':budget,'textureDirectory':str(texture_dir),'textureSize':texture_size}
                if highest:job['highestDetail']=True
                if 'lod' in meta:job['referenceLod']=meta['lod']
                jobs.append(job)
            models.append((kind,str(key),meta,seen[signature]))
            if hasattr(store,'mission') and kind=='environment' and meta.get('category') in ('tree','bush'):
                visibility_signature=(source,'visibility-highest')
                if visibility_signature not in seen:
                    output=work/(str(len(jobs))+'.json');seen[visibility_signature]=output
                    jobs.append({'source':source,'output':str(output),'highestDetail':True,'textureDirectory':str(texture_dir),'textureSize':texture_size})
                visibility_meta={**meta,'file':'visibility/'+hashlib.sha1(source.encode()).hexdigest()[:16]+'.json'}
                models.append(('visibility',str(key),visibility_meta,seen[visibility_signature]))
                visibility_owners[id(visibility_meta)]=meta
    executable=app.CONVERTER
    if not executable.is_file():raise ValueError('Рядом с утилитой отсутствует WOG-Studio.exe')
    good=0;actor_overrides={}
    # Batches keep logs live and isolate a corrupt native model from the rest.
    for start in range(0,len(jobs),16):
        batch=jobs[start:start+16]
        for job in batch:
            Path(job['output']).unlink(missing_ok=True);Path(job['output']+'.error').unlink(missing_ok=True)
        batch_path=work/'jobs.json';batch_path.write_text(json.dumps(batch),encoding='utf8')
        log(f'Модели и исходные текстуры: {start+1}–{min(start+16,len(jobs))} из {len(jobs)}')
        subprocess.run([str(executable),'--convert',str(work/'index.json'),str(batch_path)],capture_output=True,timeout=900,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        batch_files={j['output'] for j in batch}
        for kind,key,meta,path in models:
            if str(path) not in batch_files:continue
            try:
                if not path.is_file():raise ValueError('Не удалось прочитать исходный P3D')
                raw=json.loads(path.read_text(encoding='utf8'));base=store.json(meta['file'],meta.get('assetVersion',''),original=True) if kind=='actor' else None
                result=native_model(raw,meta,base,kind!='actor')
                file=meta['file'] if kind=='actor' else 'environment/'+meta['file']
                app.write_override(store,file,result)
                if kind=='actor':actor_overrides[key]=result
                elif kind=='visibility':
                    visibility_owners[id(meta)]['visibilityFile']=meta['file']
                    visibility_owners[id(meta)]['visibilitySourceLod']=raw['lod']
                else:
                    meta.pop('pack',None);meta.update(bounds=result['bounds'],minY=result['minY'],triangles=len(result['indices'])//3)
                good+=1
                report.append({'model':key,'kind':kind,'file':file,'result':'Геометрия и текстуры из установленной сборки','before':len(base['indices'])//3 if base else None,'after':len(result['indices'])//3,'lod':raw['lod'],'missingProxies':raw.get('missingProxies',[]),'missingTextures':[m['missingTexture'] for m in raw['nativeMaterials'] if m.get('missingTexture')]})
            except Exception as e:report.append({'model':key,'kind':kind,'result':'Сохранена модель сайта: '+str(e)[:160]});log(key+': '+str(e)[:160])
        app.write_override(store,env_path,environment)
        if mission:app.write_override(store,mission_path,mission)
        (store.root/'model-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        log('Подготовлено моделей: '+str(good))
    # Legacy exports may embed geometry in an actor pack instead of separate files.
    try:
        pack=store.json('data/'+store.replay+'/actor-pack.json',original=True)
        pack['models'].update(actor_overrides);app.write_override(store,'data/'+store.replay+'/actor-pack.json',pack)
    except FileNotFoundError:pass
    (store.root/'model-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    log('Готово. Подготовлено моделей: '+str(good)+'. Обновите страницу студии.')
