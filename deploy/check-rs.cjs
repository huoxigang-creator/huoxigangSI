const db=require('better-sqlite3')('/var/lib/gugemei/gugemei.sqlite');
const rows=db.prepare('SELECT owner,data FROM recognition_settings').all();
rows.forEach(r=>{
  try {
    const d=JSON.parse(r.data);
    console.log('owner:', r.owner);
    console.log('default_provider:', d.default_provider);
    console.log('model:', d.model);
    console.log('has_encrypted_key:', !!d.encrypted_key);
    if(d.encrypted_key) console.log('key_prefix:', d.encrypted_key.substring(0,20)+'...');
  } catch(e) { console.log(r.owner, r.data); }
});
