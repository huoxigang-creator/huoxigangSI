from pathlib import Path
import hashlib,shutil,subprocess
base=Path('/opt/gugemei/cust-friend')
new=base/'app-new-v174'
archive=Path('/opt/gugemei/gugemei-standalone-v174.tar.gz')
expected='badc7e01254d1ffcb219bd0d9ffe1ad9ac0d0d61725d4e256649c2ef5ab14b2a'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Archive checksum mismatch')
if new.exists():
 if new.is_symlink() or new.resolve()!=Path('/opt/gugemei/cust-friend/app-new-v174'):raise SystemExit('Unsafe staging path')
 if not {p.name for p in new.iterdir()}<={'dist','public','server.js','package.json','node_modules'}:raise SystemExit('Unexpected staging contents')
 shutil.rmtree(new)
new.mkdir()
subprocess.run(['tar','-xzf',str(archive),'-C',str(new)],check=True)
subprocess.run(['python3',str(base/'brand-jinmu-v174.py'),str(new)],check=True)
print('Latest Jinmu application staged; no live data copied or changed')
