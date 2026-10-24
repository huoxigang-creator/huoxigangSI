from pathlib import Path
import hashlib,shutil,subprocess
base=Path('/opt/gugemei/cust-friend')
new=base/'app-new-v1720'
archive=Path('/opt/gugemei/gugemei-standalone-v1720.tar.gz')
expected='1fee845915482b0315726a9e2e787c5dada716ad7c682483b69b7c7020575982'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Archive checksum mismatch')
if new.exists():
 if new.is_symlink() or new.resolve()!=Path('/opt/gugemei/cust-friend/app-new-v1720'):raise SystemExit('Unsafe staging path')
 if not {p.name for p in new.iterdir()}<={'dist','public','server.js','package.json','node_modules'}:raise SystemExit('Unexpected staging contents')
 shutil.rmtree(new)
new.mkdir()
subprocess.run(['tar','-xzf',str(archive),'-C',str(new)],check=True)
subprocess.run(['python3',str(base/'brand-jinmu-v1720.py'),str(new)],check=True)
print('Latest Jinmu application staged; no live data copied or changed')
