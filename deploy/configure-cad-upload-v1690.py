#!/usr/bin/env python3
"""Only enlarge the CAD endpoint body limit; preserve existing proxy/auth headers."""
from pathlib import Path
import re, shutil, subprocess
paths=[Path('/etc/nginx/sites-enabled/gugemei-public').resolve(),Path('/etc/nginx/sites-enabled/gugemei-si').resolve()]
changed=[]
try:
    for path in paths:
        text=path.read_text()
        if 'location = /api/cad-recognition' in text:
            raise RuntimeError('CAD location already exists; inspect before updating: '+str(path))
        match=re.search(r'    location / \{\n(.*?)\n    \}',text,re.S)
        if not match: raise RuntimeError('Proxy location missing: '+str(path))
        body=match.group(1)
        if 'proxy_pass http://127.0.0.1:3700;' not in body: raise RuntimeError('Unexpected upstream')
        backup_dir=Path('/opt/gugemei/nginx-backups-v1690')
        backup_dir.mkdir(exist_ok=True)
        backup=backup_dir/path.name
        if backup.exists(): raise RuntimeError('Backup already exists: '+str(backup))
        shutil.copy2(path,backup)
        location='    # 20MB CAD becomes up to 28MB base64 JSON. Other endpoints keep their existing limit.\n    location = /api/cad-recognition {\n        client_max_body_size 29m;\n'+body+'\n    }\n\n'
        path.write_text(text[:match.start()]+location+text[match.start():])
        changed.append((path,backup))
    subprocess.run(['nginx','-t'],check=True)
    subprocess.run(['systemctl','reload','nginx'],check=True)
    print('CAD HTTP/HTTPS upload limit configured: 29m')
except Exception:
    for path,backup in changed: shutil.copy2(backup,path)
    subprocess.run(['nginx','-t'],check=False)
    raise
