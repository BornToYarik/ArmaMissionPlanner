"""Bounded, deduplicated browser transport; interrupted responses never enter cache."""
import secrets, threading, time

class AssetTransport:
    def __init__(self):
        self.condition=threading.Condition();self.jobs={};self.done=0;self.failed=0

    def read(self,path,timeout=300,version=''):
        with self.condition:
            job={'id':secrets.token_hex(16),'path':path,'version':version,'leased':0,'event':threading.Event()}
            self.jobs[job['id']]=job
        try:
            if not job['event'].wait(timeout):raise TimeoutError('Нет ответа загрузчика браузера: '+path)
            if job['status']==404:raise FileNotFoundError(path)
            if job['status']!=200:raise OSError('Не удалось загрузить ресурс: '+path)
            return job['data']
        finally:
            with self.condition:
                self.jobs.pop(job['id'],None)
                if job.get('status')==200:self.done+=1
                elif job.get('status')!=404:self.failed+=1

    def poll(self,ready):
        with self.condition:
            now=time.monotonic();jobs=[]
            active=sum(j['leased']>0 and j['leased']>now-145 for j in self.jobs.values() if not j['event'].is_set())
            if ready:
                for job in self.jobs.values():
                    if active>=4:break
                    if job['event'].is_set() or (job['leased'] and job['leased']>now-145):continue
                    job['leased']=now;active+=1;jobs.append({'id':job['id'],'path':job['path'],'version':job['version']})
            return {'jobs':jobs,'waiting':len(self.jobs),'done':self.done,'failed':self.failed}

    def finish(self,job_id,status,data):
        with self.condition:
            job=self.jobs.get(job_id)
            if not job or job['event'].is_set() or not job['leased']:return False
            job.update(status=status,data=data);job['event'].set();return True

    def reset(self):
        with self.condition:
            self.failed=0
            for job in self.jobs.values():
                if not job['event'].is_set():job['leased']=0
