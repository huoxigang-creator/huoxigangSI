#!/usr/bin/env bash
set -euo pipefail
# GNU LibreDWG 0.14, pinned source; source + license retained for reproducibility.
version=0.14
root=/opt/gugemei/tools
source_sha=62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275
mkdir -p "$root/src" "$root/libredwg-$version/bin"
cd "$root/src"
archive=libredwg-$version-mirror.tar.xz
if [ ! -f "$archive" ]; then
  curl --fail --location --max-time 180 -o "$archive" "https://mirrors.tuna.tsinghua.edu.cn/gnu/libredwg/libredwg-$version.tar.xz"
fi
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$source_sha"
if [ ! -x "$root/libredwg-$version/bin/dwg2dxf" ]; then
  tar -xJf "$archive"
  cd "libredwg-$version"
  ./configure --prefix="$root/libredwg-$version" --disable-bindings --disable-docs --disable-shared CFLAGS='-O0 -g0 --param=ggc-min-expand=5 --param=ggc-min-heapsize=4096' > "$root/libredwg-$version-configure.log" 2>&1
  /usr/bin/prlimit --as=943718400 -- nice -n 15 make -j1 -C src CFLAGS='-O0 -g0 --param=ggc-min-expand=5 --param=ggc-min-heapsize=4096' > "$root/libredwg-$version-build.log" 2>&1
  /usr/bin/prlimit --as=943718400 -- nice -n 15 make -j1 -C programs CFLAGS='-O0 -g0 --param=ggc-min-expand=5 --param=ggc-min-heapsize=4096' dwg2dxf dxf2dwg >> "$root/libredwg-$version-build.log" 2>&1
  install -m 755 programs/dwg2dxf programs/dxf2dwg "$root/libredwg-$version/bin/"
  install -m 644 COPYING "$root/libredwg-$version/COPYING"
fi
cat > "$root/dwg2dxf-limited" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
# 640 MiB virtual address space, 100 MiB output, 100 CPU seconds; 110 s wall time.
exec /usr/bin/prlimit --as=671088640 --fsize=104857600 --cpu=100 -- /usr/bin/timeout --signal=TERM --kill-after=5s 110s /opt/gugemei/tools/libredwg-0.14/bin/dwg2dxf "$@"
WRAPPER
chmod 755 "$root/dwg2dxf-limited"
mkdir -p /etc/systemd/system/gugemei.service.d
cat > /etc/systemd/system/gugemei.service.d/dwg-converter.conf <<'UNIT'
[Service]
Environment="DWG_TO_DXF_CMD=/opt/gugemei/tools/dwg2dxf-limited"
UNIT
systemctl daemon-reload
"$root/dwg2dxf-limited" --version
# The application is restarted by the matching release installer after code validation.
