const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log("🚗 Auto Premium Service CRM");
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);

  try {
    await initDB();
    console.log("✅ Base de datos inicializada");
  } catch (err) {
    console.error("Error iniciando DB:", err);
  }
});

app.use(cors());
app.use(express.json());

const sesiones = new Map();

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !sesiones.has(token)) return res.status(401).json({ error: 'No autorizado' });
  req.usuario = sesiones.get(token);
  next();
}

app.use(express.static('public'));
const upload = multer({ dest: 'uploads/' });

// ===========================
// POSTGRESQL
// ===========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function dbAll(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

async function dbGet(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

async function initDB() {
  await query(`CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY, nit TEXT, dv TEXT, naturaleza TEXT,
    primer_nombre TEXT, segundo_nombre TEXT, primer_apellido TEXT, segundo_apellido TEXT,
    empresa TEXT, direccion TEXT, telefono TEXT, movil TEXT, email TEXT, gerente TEXT,
    cod_identidad TEXT, cod_sociedad TEXT, cod_actividad TEXT, cod_zona TEXT,
    cod_municipio TEXT, cod_pais TEXT, created_at TIMESTAMP DEFAULT NOW())`);

  await query(`CREATE TABLE IF NOT EXISTS campanas (
    id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, mensaje TEXT NOT NULL,
    canal TEXT NOT NULL, estado TEXT DEFAULT 'borrador',
    total_destinatarios INTEGER DEFAULT 0, enviados INTEGER DEFAULT 0, fallidos INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(), enviado_at TIMESTAMP)`);

  await query(`CREATE TABLE IF NOT EXISTS envios (
    id SERIAL PRIMARY KEY, campana_id INTEGER REFERENCES campanas(id),
    cliente_id INTEGER REFERENCES clientes(id), canal TEXT, destinatario TEXT,
    estado TEXT DEFAULT 'pendiente', error_msg TEXT, enviado_at TIMESTAMP)`);

  await query(`CREATE TABLE IF NOT EXISTS configuracion (clave TEXT PRIMARY KEY, valor TEXT)`);

  await query(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    nombre TEXT, email TEXT, rol TEXT DEFAULT 'usuario',
    reset_token TEXT, reset_token_expiry TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);

  await query(`CREATE TABLE IF NOT EXISTS solicitudes (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    nombre TEXT, email TEXT, estado TEXT DEFAULT 'pendiente', created_at TIMESTAMP DEFAULT NOW())`);

  await query(`CREATE TABLE IF NOT EXISTS plantillas (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, asunto TEXT,
    mensaje TEXT NOT NULL, canal TEXT DEFAULT 'email', created_at TIMESTAMP DEFAULT NOW())`);

  await query(`CREATE TABLE IF NOT EXISTS campanas_programadas (
    id SERIAL PRIMARY KEY, campana_id INTEGER REFERENCES campanas(id),
    fecha_envio TIMESTAMP NOT NULL, cliente_ids TEXT,
    estado TEXT DEFAULT 'pendiente', created_at TIMESTAMP DEFAULT NOW())`);

  const adminExiste = await dbGet("SELECT id FROM usuarios WHERE username = 'admin'");
  if (!adminExiste) {
    const hash = crypto.createHash('sha256').update('admin123').digest('hex');
    await query("INSERT INTO usuarios (username, password_hash, nombre) VALUES ($1,$2,$3)", ['admin', hash, 'Administrador']);
    console.log('👤 Usuario admin creado (user: admin, pass: admin123)');
  }
  console.log('✅ Base de datos inicializada');
}

// ===========================
// AUTH
// ===========================
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const usuario = await dbGet('SELECT * FROM usuarios WHERE username=$1 AND password_hash=$2', [username, hash]);
  if (!usuario) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = generarToken();
  sesiones.set(token, { id: usuario.id, username: usuario.username, nombre: usuario.nombre });
  res.json({ token, nombre: usuario.nombre, username: usuario.username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) sesiones.delete(token);
  res.json({ message: 'Sesión cerrada' });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.usuario));

app.post('/api/auth/cambiar-password', requireAuth, async (req, res) => {
  const { password_actual, password_nuevo } = req.body;
  const hashActual = crypto.createHash('sha256').update(password_actual).digest('hex');
  const usuario = await dbGet('SELECT * FROM usuarios WHERE id=$1 AND password_hash=$2', [req.usuario.id, hashActual]);
  if (!usuario) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  const hashNuevo = crypto.createHash('sha256').update(password_nuevo).digest('hex');
  await query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [hashNuevo, req.usuario.id]);
  res.json({ message: 'Contraseña actualizada' });
});

app.post('/api/auth/recuperar', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Ingresa tu correo' });
  const usuario = await dbGet('SELECT * FROM usuarios WHERE email=$1', [email]);
  if (!usuario) return res.json({ message: 'Si ese correo está registrado, recibirás las instrucciones.' });
  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date(Date.now() + 30 * 60 * 1000);
  await query('UPDATE usuarios SET reset_token=$1, reset_token_expiry=$2 WHERE id=$3', [token, expiry, usuario.id]);
  const config = await obtenerConfig();
  if (!config.email_user || !config.email_pass) return res.status(500).json({ error: 'Email no configurado. Contacta al administrador.' });
  try {
    const transporter = nodemailer.createTransport({
      host: config.email_host || 'smtp.gmail.com', port: parseInt(config.email_port) || 587,
      secure: false, auth: { user: config.email_user, pass: config.email_pass }
    });
    await transporter.sendMail({
      from: `"Auto Premium Service" <${config.email_user}>`, to: email,
      subject: 'Recuperar contraseña - Auto Premium CRM',
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#111;color:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#e30000;padding:24px;text-align:center"><h1 style="margin:0;font-size:28px;letter-spacing:2px">AUTO PREMIUM</h1></div>
        <div style="padding:32px;text-align:center">
          <p style="color:#aaa">Hola <strong style="color:#fff">${usuario.nombre}</strong>, tu código es:</p>
          <div style="font-size:48px;font-weight:700;letter-spacing:12px;color:#f5c400;margin:24px 0;font-family:monospace">${token}</div>
          <p style="color:#666;font-size:13px">Expira en <strong style="color:#fff">30 minutos</strong>.</p>
        </div></div>`
    });
    res.json({ message: 'Si ese correo está registrado, recibirás las instrucciones.' });
  } catch(e) { res.status(500).json({ error: 'Error al enviar el correo.' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, token, nueva_password } = req.body;
  if (!email || !token || !nueva_password) return res.status(400).json({ error: 'Faltan campos' });
  const usuario = await dbGet('SELECT * FROM usuarios WHERE email=$1 AND reset_token=$2', [email, token]);
  if (!usuario) return res.status(400).json({ error: 'Código inválido' });
  if (new Date() > new Date(usuario.reset_token_expiry)) return res.status(400).json({ error: 'Código expirado. Solicita uno nuevo.' });
  if (nueva_password.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  const hash = crypto.createHash('sha256').update(nueva_password).digest('hex');
  await query('UPDATE usuarios SET password_hash=$1, reset_token=NULL, reset_token_expiry=NULL WHERE id=$2', [hash, usuario.id]);
  res.json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
});

app.post('/api/auth/registro', async (req, res) => {
  const { username, password, nombre, email } = req.body;
  if (!username || !password || !nombre || !email) return res.status(400).json({ error: 'Faltan campos' });
  const existeUser = await dbGet('SELECT id FROM usuarios WHERE username=$1', [username]);
  if (existeUser) return res.status(400).json({ error: 'El usuario ya existe' });
  const existeSol = await dbGet("SELECT id FROM solicitudes WHERE username=$1 AND estado='pendiente'", [username]);
  if (existeSol) return res.status(400).json({ error: 'Ya tienes una solicitud pendiente' });
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  await query('INSERT INTO solicitudes (username, password_hash, nombre, email) VALUES ($1,$2,$3,$4)', [username, hash, nombre, email]);
  res.json({ message: 'Solicitud enviada. Espera a que el administrador la apruebe.' });
});

app.get('/api/auth/solicitudes', requireAuth, async (req, res) => {
  res.json(await dbAll("SELECT id, username, nombre, estado, created_at FROM solicitudes ORDER BY created_at DESC"));
});

app.post('/api/auth/solicitudes/:id', requireAuth, async (req, res) => {
  const { accion } = req.body;
  const sol = await dbGet('SELECT * FROM solicitudes WHERE id=$1', [req.params.id]);
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (accion === 'aprobar') {
    try {
      await query('INSERT INTO usuarios (username, password_hash, nombre, email) VALUES ($1,$2,$3,$4)',
        [sol.username, sol.password_hash, sol.nombre, sol.email || '']);
      await query("UPDATE solicitudes SET estado='aprobado' WHERE id=$1", [req.params.id]);
      res.json({ message: `Usuario ${sol.nombre} aprobado` });
    } catch(e) { res.status(400).json({ error: 'El usuario ya existe' }); }
  } else if (accion === 'rechazar') {
    await query("UPDATE solicitudes SET estado='rechazado' WHERE id=$1", [req.params.id]);
    res.json({ message: 'Solicitud rechazada' });
  } else res.status(400).json({ error: 'Acción inválida' });
});

// ===========================
// PLANTILLAS
// ===========================
app.get('/api/plantillas', requireAuth, async (req, res) => res.json(await dbAll('SELECT * FROM plantillas ORDER BY created_at DESC')));

app.post('/api/plantillas', requireAuth, async (req, res) => {
  const { nombre, asunto, mensaje, canal } = req.body;
  if (!nombre || !mensaje) return res.status(400).json({ error: 'Faltan campos' });
  const r = await query('INSERT INTO plantillas (nombre,asunto,mensaje,canal) VALUES ($1,$2,$3,$4) RETURNING id', [nombre, asunto||'', mensaje, canal||'email']);
  res.json({ id: r.rows[0].id, message: 'Plantilla guardada' });
});

app.put('/api/plantillas/:id', requireAuth, async (req, res) => {
  const { nombre, asunto, mensaje, canal } = req.body;
  await query('UPDATE plantillas SET nombre=$1,asunto=$2,mensaje=$3,canal=$4 WHERE id=$5', [nombre, asunto||'', mensaje, canal||'email', req.params.id]);
  res.json({ message: 'Plantilla actualizada' });
});

app.delete('/api/plantillas/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM plantillas WHERE id=$1', [req.params.id]);
  res.json({ message: 'Plantilla eliminada' });
});

// ===========================
// CAMPAÑAS PROGRAMADAS
// ===========================
app.post('/api/campanas/:id/programar', requireAuth, async (req, res) => {
  const { fecha_envio, cliente_ids } = req.body;
  if (!fecha_envio) return res.status(400).json({ error: 'Falta la fecha' });
  const campana = await dbGet('SELECT * FROM campanas WHERE id=$1', [req.params.id]);
  if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
  const r = await query('INSERT INTO campanas_programadas (campana_id,fecha_envio,cliente_ids) VALUES ($1,$2,$3) RETURNING id',
    [req.params.id, fecha_envio, cliente_ids ? JSON.stringify(cliente_ids) : null]);
  await query("UPDATE campanas SET estado='programado' WHERE id=$1", [req.params.id]);
  res.json({ id: r.rows[0].id, message: 'Campaña programada' });
});

app.get('/api/campanas-programadas', requireAuth, async (req, res) => {
  res.json(await dbAll(`SELECT cp.*, c.titulo, c.canal FROM campanas_programadas cp JOIN campanas c ON cp.campana_id=c.id ORDER BY cp.fecha_envio ASC`));
});

app.delete('/api/campanas-programadas/:id', requireAuth, async (req, res) => {
  const prog = await dbGet('SELECT * FROM campanas_programadas WHERE id=$1', [req.params.id]);
  if (prog) await query("UPDATE campanas SET estado='borrador' WHERE id=$1", [prog.campana_id]);
  await query('DELETE FROM campanas_programadas WHERE id=$1', [req.params.id]);
  res.json({ message: 'Programación cancelada' });
});

// ===========================
// EXPORTAR CLIENTES
// ===========================
app.get('/api/clientes/exportar', requireAuth, async (req, res) => {
  const clientes = await dbAll('SELECT * FROM clientes ORDER BY id ASC');
  const campos = ['nit','dv','naturaleza','primer_nombre','segundo_nombre','primer_apellido','segundo_apellido','empresa','direccion','telefono','movil','email','gerente','cod_identidad','cod_sociedad','cod_actividad','cod_zona','cod_municipio','cod_pais'];
  const encabezados = ['NIT','DV','NATURALEZA','1er NOMBRE','2do NOMBRE','1er APELLIDO','2do APELLIDO','EMPRESA','DIRECCION','TELEFONO','MOVIL','EMAIL','GERENTE','COD. IDENTIDAD','COD. SOCIEDAD','COD. ACTIVIDAD','COD. ZONA','COD. MUNICIPIO','COD. PAIS'];
  let csv = encabezados.join(',') + '\n';
  clientes.forEach(c => { csv += campos.map(f => `"${String(c[f]||'').replace(/"/g,'""')}"`).join(',') + '\n'; });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clientes_autopremium.csv"');
  res.send('\uFEFF' + csv);
});

// ===========================
// STATS
// ===========================
app.get('/api/stats', requireAuth, async (req, res) => {
  const totalClientes = parseInt((await dbGet('SELECT COUNT(*) as n FROM clientes'))?.n || 0);
  const totalCampanas = parseInt((await dbGet('SELECT COUNT(*) as n FROM campanas'))?.n || 0);
  const totalEnviados = parseInt((await dbGet("SELECT COALESCE(SUM(enviados),0) as n FROM campanas WHERE estado='completado'"))?.n || 0);
  const ultimasCampanas = await dbAll('SELECT * FROM campanas ORDER BY created_at DESC LIMIT 5');
  res.json({ totalClientes, totalCampanas, totalEnviados, ultimasCampanas });
});

app.get('/api/stats/campanas-por-mes', requireAuth, async (req, res) => {
  const data = await dbAll(`
    SELECT TO_CHAR(created_at,'YYYY-MM') as mes, COUNT(*) as total,
      SUM(enviados) as enviados, SUM(fallidos) as fallidos
    FROM campanas WHERE estado='completado'
    GROUP BY mes ORDER BY mes DESC LIMIT 12`);
  res.json(data.reverse());
});

// ===========================
// CLIENTES
// ===========================
app.get('/api/clientes', requireAuth, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    let where = '', params = [];
    if (search) {
      where = `WHERE primer_nombre ILIKE $1 OR primer_apellido ILIKE $1 OR empresa ILIKE $1 OR nit ILIKE $1 OR email ILIKE $1 OR movil ILIKE $1`;
      params = [`%${search}%`];
    }
    const clientes = await dbAll(`SELECT * FROM clientes ${where} ORDER BY id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, parseInt(limit), offset]);
    const countRow = await dbGet(`SELECT COUNT(*) as total FROM clientes ${where}`, params);
    res.json({ clientes, total: parseInt(countRow?.total||0), page: parseInt(page), limit: parseInt(limit) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clientes/:id', requireAuth, async (req, res) => {
  const c = await dbGet('SELECT * FROM clientes WHERE id=$1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  res.json(c);
});

app.post('/api/clientes', requireAuth, async (req, res) => {
  try {
    const fields = ['nit','dv','naturaleza','primer_nombre','segundo_nombre','primer_apellido','segundo_apellido','empresa','direccion','telefono','movil','email','gerente','cod_identidad','cod_sociedad','cod_actividad','cod_zona','cod_municipio','cod_pais'];
    const values = fields.map(f => req.body[f]||null);
    const placeholders = fields.map((_,i)=>`$${i+1}`).join(',');
    const r = await query(`INSERT INTO clientes (${fields.join(',')}) VALUES (${placeholders}) RETURNING id`, values);
    res.json({ id: r.rows[0].id, message: 'Cliente creado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clientes/:id', requireAuth, async (req, res) => {
  try {
    const fields = ['nit','dv','naturaleza','primer_nombre','segundo_nombre','primer_apellido','segundo_apellido','empresa','direccion','telefono','movil','email','gerente','cod_identidad','cod_sociedad','cod_actividad','cod_zona','cod_municipio','cod_pais'];
    const set = fields.map((f,i)=>`${f}=$${i+1}`).join(',');
    const values = fields.map(f => req.body[f]||null);
    await query(`UPDATE clientes SET ${set} WHERE id=$${fields.length+1}`, [...values, req.params.id]);
    res.json({ message: 'Actualizado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/clientes/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM clientes WHERE id=$1', [req.params.id]);
  res.json({ message: 'Eliminado' });
});

app.post('/api/clientes/importar', requireAuth, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sin archivo' });
  try {
    const workbook = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    const colMap = {
      'NIT':'nit','DV':'dv','NATURALEZA':'naturaleza','1er NOMBRE':'primer_nombre','2do NOMBRE':'segundo_nombre',
      '1er APELLIDO':'primer_apellido','2do APELLIDO':'segundo_apellido','EMPRESA':'empresa','DIRECCION':'direccion',
      'TELEFONO':'telefono','MOVIL':'movil','EMAIL':'email','GERENTE':'gerente','COD. IDENTIDAD':'cod_identidad',
      'COD. SOCIEDAD':'cod_sociedad','COD. ACTIVIDAD':'cod_actividad','COD. ZONA':'cod_zona',
      'COD. MUNICIPIO':'cod_municipio','COD. PAIS':'cod_pais'
    };
    const fields = Object.values(colMap);
    let inserted = 0;
    for (const row of data) {
      const values = Object.entries(colMap).map(([xlsKey]) => {
        const val = row[xlsKey] ?? row[xlsKey.toLowerCase()] ?? null;
        return val != null ? String(val) : null;
      });
      const nit = values[0], email = values[11];
      const existe = await dbGet(
        `SELECT id FROM clientes WHERE COALESCE(NULLIF(TRIM(nit),''),'__')=COALESCE(NULLIF(TRIM($1),''),'__') AND COALESCE(NULLIF(TRIM(email),''),'__')=COALESCE(NULLIF(TRIM($2),''),'__')`,
        [nit||'', email||'']);
      if (existe) continue;
      try {
        const ph = fields.map((_,i)=>`$${i+1}`).join(',');
        await query(`INSERT INTO clientes (${fields.join(',')}) VALUES (${ph})`, values);
        inserted++;
      } catch(e) { /* skip */ }
    }
    fs.unlinkSync(req.file.path);
    res.json({ message: 'Importación completada', total: data.length, insertados: inserted, duplicados: data.length-inserted });
  } catch(e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// CAMPAÑAS
// ===========================
app.get('/api/campanas', requireAuth, async (req, res) => res.json(await dbAll('SELECT * FROM campanas ORDER BY created_at DESC')));

app.get('/api/campanas/:id', requireAuth, async (req, res) => {
  const campana = await dbGet('SELECT * FROM campanas WHERE id=$1', [req.params.id]);
  if (!campana) return res.status(404).json({ error: 'No encontrada' });
  const envios = await dbAll(`SELECT e.*, c.primer_nombre, c.primer_apellido, c.empresa, c.email, c.movil
    FROM envios e LEFT JOIN clientes c ON e.cliente_id=c.id WHERE e.campana_id=$1 ORDER BY e.enviado_at DESC`, [req.params.id]);
  res.json({ ...campana, envios });
});

app.post('/api/campanas', requireAuth, async (req, res) => {
  try {
    const { titulo, mensaje, canal } = req.body;
    if (!titulo || !mensaje || !canal) return res.status(400).json({ error: 'Faltan campos' });
    const r = await query('INSERT INTO campanas (titulo,mensaje,canal) VALUES ($1,$2,$3) RETURNING id', [titulo, mensaje, canal]);
    res.json({ id: r.rows[0].id, message: 'Campaña creada' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/campanas/:id/enviar', requireAuth, async (req, res) => {
  const { cliente_ids } = req.body;
  const campana = await dbGet('SELECT * FROM campanas WHERE id=$1', [req.params.id]);
  if (!campana) return res.status(404).json({ error: 'No encontrada' });
  let clientes;
  if (cliente_ids && cliente_ids.length > 0) {
    const ph = cliente_ids.map((_,i)=>`$${i+1}`).join(',');
    clientes = await dbAll(`SELECT * FROM clientes WHERE id IN (${ph})`, cliente_ids);
  } else {
    clientes = await dbAll('SELECT * FROM clientes');
  }
  const filtrados = clientes.filter(c => campana.canal==='email' ? c.email&&c.email.includes('@') : c.movil&&String(c.movil).length>5);
  await query("UPDATE campanas SET estado='enviando', total_destinatarios=$1, enviado_at=NOW() WHERE id=$2", [filtrados.length, req.params.id]);
  res.json({ message: 'Envío iniciado', total: filtrados.length });
  procesarEnvios(campana, filtrados);
});

async function procesarEnvios(campana, clientes) {
  const config = await obtenerConfig();
  let enviados = 0, fallidos = 0;
  for (const cliente of clientes) {
    try {
      if (campana.canal === 'email') await enviarEmail(config, cliente, campana);
      else if (campana.canal === 'whatsapp') await enviarWhatsApp(config, cliente, campana);
      await query('INSERT INTO envios (campana_id,cliente_id,canal,destinatario,estado,enviado_at) VALUES ($1,$2,$3,$4,$5,NOW())',
        [campana.id, cliente.id, campana.canal, campana.canal==='email'?cliente.email:cliente.movil, 'enviado']);
      enviados++;
    } catch(e) {
      await query('INSERT INTO envios (campana_id,cliente_id,canal,destinatario,estado,error_msg,enviado_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
        [campana.id, cliente.id, campana.canal, campana.canal==='email'?cliente.email:cliente.movil, 'fallido', e.message]);
      fallidos++;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  await query("UPDATE campanas SET estado='completado', enviados=$1, fallidos=$2 WHERE id=$3", [enviados, fallidos, campana.id]);
  console.log(`✅ Campaña ${campana.id}: ${enviados} enviados, ${fallidos} fallidos`);
}

async function enviarEmail(config, cliente, campana) {
  if (!config.email_user || !config.email_pass) throw new Error('Email no configurado.');
  const transporter = nodemailer.createTransport({
    host: config.email_host||'smtp.gmail.com', port: parseInt(config.email_port)||587,
    secure: false, auth: { user: config.email_user, pass: config.email_pass }
  });
  const nombre = [cliente.primer_nombre, cliente.primer_apellido].filter(Boolean).join(' ') || cliente.empresa || 'Cliente';
  const msg = campana.mensaje.replace(/\{nombre\}/gi, nombre).replace(/\{empresa\}/gi, cliente.empresa||'');
  await transporter.sendMail({
    from: `Auto Premium Service <${config.email_user}>`, to: cliente.email, subject: campana.titulo,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#111,#1c1c1c);padding:32px;text-align:center;border-bottom:3px solid #e30000">
        <div style="font-size:12px;letter-spacing:4px;color:#888">AUTO</div>
        <div style="font-size:36px;font-weight:900;color:#fff;letter-spacing:2px">PREMIUM</div>
        <div style="font-size:11px;letter-spacing:3px;color:#888;margin-top:4px">SERVICE</div>
      </div>
      <div style="padding:36px 32px;background:#111">
        <p style="color:#aaa;font-size:15px">Hola, <strong style="color:#fff">${nombre}</strong></p>
        <div style="border-left:3px solid #e30000;padding:20px 24px;background:#1a1a1a;border-radius:0 8px 8px 0;margin:24px 0;color:#ccc;line-height:1.7">
          ${msg.replace(/\n/g,'<br>')}
        </div>
        <p style="color:#666;font-size:12px;text-align:center;border-top:1px solid #222;padding-top:20px">
          © ${new Date().getFullYear()} Auto Premium Service
        </p>
      </div></div>`
  });
}

async function enviarWhatsApp(config, cliente, campana) {
  if (!config.twilio_sid || !config.twilio_token) throw new Error('WhatsApp no configurado.');
  const nombre = [cliente.primer_nombre, cliente.primer_apellido].filter(Boolean).join(' ') || cliente.empresa || 'Cliente';
  let movil = String(cliente.movil).replace(/\D/g,'');
  if (!movil.startsWith('57') && movil.length===10) movil = '57'+movil;
  if (!movil.startsWith('+')) movil = '+'+movil;
  const msg = campana.mensaje.replace(/\{nombre\}/gi, nombre).replace(/\{empresa\}/gi, cliente.empresa||'');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio_sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic '+Buffer.from(`${config.twilio_sid}:${config.twilio_token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: config.twilio_whatsapp_from||'whatsapp:+14155238886', To: `whatsapp:${movil}`, Body: `🚗 *AUTO PREMIUM SERVICE*\n\nHola *${nombre}*,\n\n${msg}` })
  });
  if (!response.ok) { const err = await response.json(); throw new Error(err.message||'Error Twilio'); }
}

async function obtenerConfig() {
  const rows = await dbAll('SELECT clave, valor FROM configuracion');
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

// ===========================
// CONFIGURACIÓN
// ===========================
app.get('/api/config', requireAuth, async (req, res) => {
  const config = await obtenerConfig();
  if (config.email_pass) config.email_pass = '••••••••';
  if (config.twilio_token) config.twilio_token = '••••••••';
  res.json(config);
});

app.post('/api/config', requireAuth, async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      if (v && v !== '••••••••') {
        await query('INSERT INTO configuracion (clave,valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor=$2', [k, v]);
      }
    }
    res.json({ message: 'Configuración guardada' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===========================
// VERIFICADOR PROGRAMADAS
// ===========================
setInterval(async () => {
  try {
    const pendientes = await dbAll(`SELECT cp.*, c.titulo, c.canal, c.mensaje FROM campanas_programadas cp
      JOIN campanas c ON cp.campana_id=c.id WHERE cp.estado='pendiente' AND cp.fecha_envio<=NOW()`);
    for (const prog of pendientes) {
      await query("UPDATE campanas_programadas SET estado='ejecutando' WHERE id=$1", [prog.id]);
      const clienteIds = prog.cliente_ids ? JSON.parse(prog.cliente_ids) : null;
      let clientes;
      if (clienteIds && clienteIds.length > 0) {
        const ph = clienteIds.map((_,i)=>`$${i+1}`).join(',');
        clientes = await dbAll(`SELECT * FROM clientes WHERE id IN (${ph})`, clienteIds);
      } else {
        clientes = await dbAll('SELECT * FROM clientes');
      }
      const filtrados = clientes.filter(c => prog.canal==='email' ? c.email&&c.email.includes('@') : c.movil&&String(c.movil).length>5);
      await query("UPDATE campanas SET estado='enviando', total_destinatarios=$1, enviado_at=NOW() WHERE id=$2", [filtrados.length, prog.campana_id]);
      procesarEnvios(prog, filtrados);
      await query("UPDATE campanas_programadas SET estado='completado' WHERE id=$1", [prog.id]);
    }
  } catch(e) { console.error('Error verificador:', e.message); }
}, 60000);

