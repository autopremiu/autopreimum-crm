const initSqlJs = require('sql.js');
const fs = require('fs');

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync('./autopremium.db'));
  const q = (sql, p=[]) => {
    const s = db.prepare(sql);
    s.bind(p);
    const r = [];
    while(s.step()) r.push(s.getAsObject());
    s.free();
    return r;
  };

  console.log('\n===== DIAGNÓSTICO DE DUPLICADOS =====\n');
  console.log('Total clientes:', q('SELECT COUNT(*) as n FROM clientes')[0].n);

  console.log('NIT duplicados:', q(`
    SELECT COUNT(*) as n FROM (
      SELECT nit FROM clientes
      WHERE nit IS NOT NULL AND TRIM(nit) != ''
      GROUP BY nit HAVING COUNT(*) > 1
    )
  `)[0].n);

  console.log('Email duplicados:', q(`
    SELECT COUNT(*) as n FROM (
      SELECT email FROM clientes
      WHERE email IS NOT NULL AND TRIM(email) != ''
      GROUP BY email HAVING COUNT(*) > 1
    )
  `)[0].n);

  console.log('NIT vacíos:', q(`
    SELECT COUNT(*) as n FROM clientes
    WHERE nit IS NULL OR TRIM(nit) = ''
  `)[0].n);

  console.log('Email vacíos:', q(`
    SELECT COUNT(*) as n FROM clientes
    WHERE email IS NULL OR TRIM(email) = ''
  `)[0].n);

  console.log('\nEjemplos NIT duplicados (top 5):');
  q(`
    SELECT nit, COUNT(*) as cnt FROM clientes
    WHERE nit IS NOT NULL AND TRIM(nit) != ''
    GROUP BY nit HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 5
  `).forEach(r => console.log('  NIT:', r.nit, '-> aparece', r.cnt, 'veces'));

  console.log('\nEjemplos Email duplicados (top 5):');
  q(`
    SELECT email, COUNT(*) as cnt FROM clientes
    WHERE email IS NOT NULL AND TRIM(email) != ''
    GROUP BY email HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 5
  `).forEach(r => console.log('  Email:', r.email, '-> aparece', r.cnt, 'veces'));

  console.log('\nPrimeros 3 registros de ejemplo:');
  q('SELECT id, nit, primer_nombre, primer_apellido, email, movil FROM clientes LIMIT 3')
    .forEach(r => console.log(' ', JSON.stringify(r)));

  console.log('\n=====================================\n');
  db.close();
});