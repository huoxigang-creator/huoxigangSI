from pathlib import Path
import hashlib,shutil,subprocess
base=Path('/opt/gugemei/cust-friend')
new=base/'app-new-v172'
archive=Path('/opt/gugemei/gugemei-standalone-v172.tar.gz')
expected='28fd36c88b8a5e338620e67b1f2a9ef4ade13cbf61e3b21d8b61352b5f6b865f'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Archive checksum mismatch')
if new.exists():
 if new.is_symlink() or new.resolve()!=Path('/opt/gugemei/cust-friend/app-new-v172'):raise SystemExit('Unsafe staging path')
 if not {p.name for p in new.iterdir()}<={'dist','public','server.js','package.json','node_modules'}:raise SystemExit('Unexpected staging contents')
 shutil.rmtree(new)
new.mkdir()
subprocess.run(['tar','-xzf',str(archive),'-C',str(new)],check=True)
subprocess.run(['python3',str(base/'brand-jinmu-v172.py'),str(new)],check=True)
print('Latest Jinmu application staged; no live data copied or changed')
