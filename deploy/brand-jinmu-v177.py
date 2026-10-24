"""Brand an isolated latest application build for Jinmu; never copy business data."""
from pathlib import Path
import re,sys,json
root=Path(sys.argv[1]).resolve()
if root.name!='app-new-v177' or root.parent!=Path('/opt/gugemei/cust-friend'):raise SystemExit('Unexpected staging directory')
client=root/'dist/client/_next/static/chunks'
files=[p for p in (root/'dist').rglob('*') if p.is_file() and p.suffix in {'.js','.json','.html','.css'}]
mapping={p.name:p.stem+'-jinmu-v177.js' for p in client.glob('*.js') if not p.stem.endswith('-jinmu-v177')}
changed=0
for p in files:
 s=p.read_text(encoding='utf-8');new=s
 new=new.replace('连云港固美格家具有限公司','连云港锦木全屋定制家居有限公司').replace('连云港锦木家具有限公司','连云港锦木全屋定制家居有限公司').replace('固美格','锦木')
 new=new.replace('©2020连云港锦木全屋定制家居有限公司 版权所有','©2025连云港锦木全屋定制家居有限公司')
 for old,name in mapping.items():new=new.replace(old,name)
 if new!=s:p.write_text(new,encoding='utf-8');changed+=1
for old,new in mapping.items():(client/old).rename(client/new)
# Every relative JavaScript import from a renamed client module must still resolve.
for p in client.glob('*.js'):
 for name in re.findall(r"(?:from|import)\s*\(?[\"'`]([.]/[^\"'`]+\.js)[\"'`]",p.read_text(encoding='utf-8')):
  if not (p.parent/name).is_file():raise SystemExit('Missing client dependency: '+name)
print(json.dumps({'changed_files':changed,'renamed_client_modules':len(mapping),'brand':'Jinmu','version':'V-1-7-7'}))
