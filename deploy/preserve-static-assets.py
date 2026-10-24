"""Retain immutable assets referenced by already open pages; never overwrite new assets."""
from pathlib import Path
import shutil
import sys

def preserve(old, new):
    src=Path(old)/'dist/client/_next/static'
    dst=Path(new)/'dist/client/_next/static'
    if not src.is_dir() or not dst.is_dir(): raise ValueError('Application static directories missing')
    count=0
    for f in src.rglob('*'):
        if not f.is_file() or f.is_symlink(): continue
        target=dst/f.relative_to(src)
        if target.exists(): continue
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,target)
        count+=1
    return count

if __name__=='__main__':
    print('Retained static assets:',preserve(sys.argv[1],sys.argv[2]))
