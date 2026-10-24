#!/usr/bin/env python3
"""Require encrypted public access, secure sessions, and throttle password guesses."""
from pathlib import Path
import re,shutil,subprocess
backups=Path('/opt/gugemei/security-backups-v1692');backups.mkdir(exist_ok=True)
public=Path('/etc/nginx/sites-enabled/gugemei-public').resolve();tls=Path('/etc/nginx/sites-enabled/gugemei-si').resolve()
rate=Path('/etc/nginx/conf.d/gugemei-auth-limit.conf')
dropin=Path('/etc/systemd/system/gugemei.service.d/recovery-security.conf')
changed=[]
def save(path,text):
 backup=backups/(path.name+'.backup')
 if backup.exists(): raise RuntimeError('Backup already exists: '+str(backup))
 existed=path.exists()
 if existed: shutil.copy2(path,backup)
 path.parent.mkdir(parents=True,exist_ok=True);changed.append((path,backup,existed));path.write_text(text)
try:
 text=public.read_text()
 if 'listen 8080;' not in text: raise RuntimeError('Unexpected public config')
 save(public,text.replace('server {','server {\n    # Preserve POST method while moving all public requests onto TLS.\n    return 308 https://www.xn--si-5r5cy60d.com$request_uri;',1))
 text=tls.read_text()
 if 'location = /api/auth/login' in text: raise RuntimeError('Existing login-specific location requires review')
 match=re.search(r'    location / \{\n(.*?)\n    \}',text,re.S)
 if not match: raise RuntimeError('Proxy location missing')
 body=match.group(1)
 if 'proxy_pass http://127.0.0.1:3700;' not in body: raise RuntimeError('Unexpected upstream')
 location='    location = /api/auth/login {\n        limit_req zone=gugemei_auth_per_ip burst=5 nodelay;\n        limit_req_status 429;\n'+body+'\n    }\n\n'
 updated=text[:match.start()]+location+text[match.start():]
 save(tls,updated.replace('server {','server {\n    add_header Strict-Transport-Security "max-age=31536000" always;',1))
 if rate.exists() or dropin.exists(): raise RuntimeError('Security config already exists; inspect before replacing')
 save(rate,'limit_req_zone $binary_remote_addr zone=gugemei_auth_per_ip:10m rate=5r/m;\n')
 save(dropin,'[Service]\nEnvironment=GUGEMEI_SECURE_COOKIE=true\n')
 subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 print('HTTPS redirect and password throttling applied; secure cookie flag takes effect on service restart')
except Exception:
 for path,backup,existed in reversed(changed):
  if existed:shutil.copy2(backup,path)
  elif path.exists():path.unlink()
 subprocess.run(['nginx','-t'],check=False);subprocess.run(['systemctl','daemon-reload'],check=False)
 raise
