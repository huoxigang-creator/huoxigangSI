from pathlib import Path
import subprocess
p=Path('/etc/nginx/sites-enabled/gugemei-si').resolve()
s=p.read_text()
marker='    # V1699: compress public hashed assets only; never cache private API responses.\n'
if marker not in s:
    anchor='    server_name xn--si-5r5cy60d.com www.xn--si-5r5cy60d.com;\n'
    block=marker+'''    location ^~ /_next/static/ {
        alias /opt/gugemei/app/dist/client/_next/static/;
        gzip on;
        gzip_vary on;
        gzip_proxied any;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_types application/javascript text/javascript text/css application/wasm image/svg+xml;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Strict-Transport-Security "max-age=31536000" always;
    }
'''
    if anchor not in s: raise SystemExit('Expected main site server missing')
    backup=p.with_name(p.name+'.before-v1699')
    if not backup.exists(): backup.write_text(s)
    p.write_text(s.replace(anchor,anchor+'\n'+block,1))
    try:
        subprocess.run(['nginx','-t'],check=True)
        subprocess.run(['systemctl','reload','nginx'],check=True)
    except Exception:
        p.write_text(s)
        subprocess.run(['nginx','-t'],check=False)
        raise
print('Main site static compression configured; private routes and friend site unchanged')
