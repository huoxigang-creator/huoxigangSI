from pathlib import Path
import subprocess
p=Path('/etc/nginx/sites-enabled/gugemei-friend').resolve()
s=p.read_text()
marker='    # Jinmu V172: compress public hashed assets only; never cache private API responses.\n'
if marker not in s:
    anchor='    server_name jm.xn--si-5r5cy60d.com friend.xn--si-5r5cy60d.com;\n'
    block=marker+'''    location ^~ /_next/static/ {
        alias /opt/gugemei/cust-friend/app/dist/client/_next/static/;
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
    backup=p.with_name(p.name+'.before-v172')
    if not backup.exists(): backup.write_text(s)
    p.write_text(s.replace(anchor,anchor+'\n'+block,1))
    try:
        subprocess.run(['nginx','-t'],check=True)
        subprocess.run(['systemctl','reload','nginx'],check=True)
    except Exception:
        p.write_text(s)
        subprocess.run(['nginx','-t'],check=False)
        raise
print('Jinmu static compression configured; private routes unchanged')

drop=Path('/etc/systemd/system/gugemei-cust-friend.service.d')
drop.mkdir(exist_ok=True)
config=drop/'latest-v172.conf'
config.write_text('[Service]\nEnvironment=GUGEMEI_SECURE_COOKIE=true\nEnvironment=DWG_TO_DXF_CMD=/opt/gugemei/tools/dwg2dxf-limited\n')
subprocess.run(['systemctl','daemon-reload'],check=True)
