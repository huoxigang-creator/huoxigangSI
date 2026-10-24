#!/usr/bin/env python3
from pathlib import Path
import re,shutil,subprocess
paths=[Path('/etc/nginx/sites-enabled/gugemei-public').resolve(),Path('/etc/nginx/sites-enabled/gugemei-si').resolve()]
changed=[]
try:
 for path in paths:
  text=path.read_text()
  match=re.search(r'(location = /api/cad-recognition \{\s*client_max_body_size )29m;',text)
  if not match: raise RuntimeError('Expected previous CAD location: '+str(path))
  backups=Path('/opt/gugemei/nginx-backups-v1691');backups.mkdir(exist_ok=True)
  backup=backups/path.name
  if backup.exists(): raise RuntimeError('Backup already exists')
  shutil.copy2(path,backup);changed.append((path,backup))
  text=text[:match.start()]+text[match.start():].replace('client_max_body_size 29m;','client_max_body_size 135m;',1)
  text=text.replace('# 20MB CAD becomes up to 28MB base64 JSON. Other endpoints keep their existing limit.','# 100MB binary CAD; 135MB also accommodates legacy base64 JSON. Other endpoints unchanged.')
  path.write_text(text)
 subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 print('CAD HTTP/HTTPS body limit updated to 135m for 100MB files')
except Exception:
 for path,backup in changed: shutil.copy2(backup,path)
 subprocess.run(['nginx','-t'],check=False)
 raise
