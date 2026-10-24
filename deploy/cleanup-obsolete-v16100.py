"""One-time cleanup of verified obsolete main-site program artifacts only."""
from pathlib import Path
import json,re,shutil,sys,subprocess
base=Path('/opt/gugemei').resolve()
if '--apply' in sys.argv and (base/'cleanup-v16100-result.json').exists():
    raise SystemExit('This one-time cleanup has already completed')
keep={'app','app-prev2-v16100','app-prev2-v1699','gugemei-standalone-v16100.tar.gz','gugemei-standalone-v1699.tar.gz'}
allowed={'dist','public','node_modules','server.js','package.json'}
def program_only(p):
    if p.is_symlink() or not p.is_dir():return False
    children={x.name for x in p.iterdir()}
    return {'dist','server.js'}<=children and children<=allowed|{'app'} and ('app' not in children or program_only(p/'app'))
plan=[];skipped=[]
for p in base.iterdir():
    if p.name in keep or p.is_symlink(): continue
    if p.is_file() and re.fullmatch(r'gugemei-standalone-v[0-9]+\.tar\.gz',p.name): plan.append(p)
    elif p.is_dir() and re.fullmatch(r'app-(?:prev.*|backup-v[0-9]+|failed-v[0-9]+|v[0-9]+-prev[0-9]*)',p.name):
        if 'keep' in p.name: skipped.append(p.name);continue
        children={x.name for x in p.iterdir()}
        if program_only(p): plan.append(p)
        else: skipped.append(p.name)
for p in plan:
    if p.resolve().parent!=base or p.name in keep or p.is_symlink(): raise RuntimeError('Unsafe cleanup target')
report={'targets':[str(p) for p in sorted(plan)],'preserved_unknown_or_marked_keep':skipped,'keep':sorted(keep)}
(base/'cleanup-v16100-plan.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'directories':sum(p.is_dir() for p in plan),'archives':sum(p.is_file() for p in plan),'skipped':skipped}))
if '--apply' in sys.argv:
    subprocess.run(['systemctl','is-active','--quiet','gugemei'],check=True)
    subprocess.run(['systemctl','is-active','--quiet','gugemei-cust-friend'],check=True)
    before=shutil.disk_usage(base).free
    for p in plan:
        if p.is_dir():shutil.rmtree(p)
        else:p.unlink()
    after=shutil.disk_usage(base).free
    result={'deleted_targets':len(plan),'freed_bytes':after-before,'free_bytes':after}
    (base/'cleanup-v16100-result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
