const initSqlJs = require('sql.js');
const fs = require('fs');

const DB_PATH = './autopremium.db';

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql) => { const s = db.prepare(sql); const r = []; while(s.step()) r.push(s.getAsObject()); s.free(); return r; };

  const antes = q('SELECT COUNT(*) as n FROM clientes')[0].n;
  console.log(`\n📊 Clientes antes: ${antes}`);

  fs.copyFileSync(DB_PATH, DB_PATH + '.backup');
  console.log(`💾 Backup: autopremium.db.backup`);

  db.run(`DELETE FROM clientes WHERE nit IS NULL OR TRIM(nit) = ''`);

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  const despues = q('SELECT COUNT(*) as n FROM clientes')[0].n;
  console.log(`✅ Clientes después: ${despues}`);
  console.log(`🗑️  Eliminados: ${antes - despues}\n`);

  db.close();
});