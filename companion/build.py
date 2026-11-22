"""Build the Windows test companion without packaging installed game assets."""
from pathlib import Path
import shutil, subprocess, sys, zipfile

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent
WORK=REPO/'.build-cache'/'planner-package'
WORK.mkdir(parents=True,exist_ok=True)
subprocess.run(['npm.cmd','run','build'],cwd=REPO/'arma-planner-ui',check=True)
subprocess.run(['dotnet','publish',str(ROOT/'converter/NativeExport.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-p:DebugType=None','-o',str(WORK/'native')],check=True)
subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--console','--name','WOG-Planner-Worker','--paths',str(ROOT/'vendor'),'--add-data',str(ROOT/'vendor/browser_loader.js')+';vendor','--collect-submodules','vendor','--distpath',str(WORK/'dist'),'--workpath',str(WORK/'build'),'--specpath',str(WORK),str(ROOT/'planner_worker.py')],cwd=ROOT,check=True)
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
