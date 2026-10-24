from pathlib import Path
import hashlib,shutil,subprocess
base=Path('/opt/gugemei/cust-friend')
new=base/'app-new-v176'
archive=Path('/opt/gugemei/gugemei-standalone-v176.tar.gz')
expected='ce714abf02e4cbcef486bd0f97d1ef7f353a667abf7f4bc8870c33088fccf230'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Archive checksum mismatch')
if new.exists():
 if new.is_symlink() or new.resolve()!=Path('/opt/gugemei/cust-friend/app-new-v176'):raise SystemExit('Unsafe staging path')
 if not {p.name for p in new.iterdir()}<={'dist','public','server.js','package.json','node_modules'}:raise SystemExit('Unexpected staging contents')
 shutil.rmtree(new)
new.mkdir()
subprocess.run(['tar','-xzf',str(archive),'-C',str(new)],check=True)
subprocess.run(['python3',str(base/'brand-jinmu-v176.py'),str(new)],check=True)
print('Latest Jinmu application staged; no live data copied or changed')
