"""Build the Windows test companion without packaging installed game assets."""
from pathlib import Path
import argparse, shutil, subprocess, sys, zipfile, ssl

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent
parser=argparse.ArgumentParser()
parser.add_argument('--work-dir',default='.build-cache/planner-package')
args=parser.parse_args()
WORK=(REPO/args.work_dir).resolve()
if REPO.resolve() not in WORK.parents: raise SystemExit('Build directory must be inside the repository')
WORK.mkdir(parents=True,exist_ok=True)
subprocess.run(['npm.cmd','run','build'],cwd=REPO/'arma-planner-ui',check=True)
subprocess.run(['dotnet','publish',str(ROOT/'converter/NativeExport.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-p:DebugType=None','-o',str(WORK/'native')],check=True)
# Preserve any CA policy resource required by the Python distribution.
ssl_policy=Path(ssl.__file__).with_name('codex-rejected-cas.pem')
ssl_data=['--add-data',str(ssl_policy)+';.'] if ssl_policy.is_file() else []
subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--console','--name','WOG-Planner-Worker','--paths',str(ROOT/'vendor'),'--add-data',str(ROOT/'vendor/browser_loader.js')+';vendor','--collect-submodules','vendor',*ssl_data,'--distpath',str(WORK/'dist'),'--workpath',str(WORK/'build'),'--specpath',str(WORK),str(ROOT/'planner_worker.py')],cwd=ROOT,check=True)
package=WORK/'dist/WOG-Planner-Worker'
subprocess.run(['dotnet','publish',str(REPO/'ArmaMissionPlanner.Api/ArmaMissionPlanner.Api.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-p:DebugType=None','-o',str(package/'PlannerBackend')],check=True)
shutil.copy2(WORK/'native/WOG-Studio.exe',package/'WOG-Planner.exe')
# The asset converter is also invoked under its established executable name.
# One executable is sufficient: worker points at WOG-Planner.exe.
shutil.copy2(ROOT/'README.txt',package)
shutil.copy2(ROOT/'converter/vendor/LICENSE-UKSFTA.txt',package)
archive=WORK/'WOG-3D-Planner-test.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for file in sorted(package.rglob('*')):
        if file.is_file():z.write(file,Path('WOG-3D-Planner')/file.relative_to(package))
print(archive)
