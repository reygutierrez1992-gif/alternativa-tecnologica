/* Servicio de Alternativa Tecnológica (Cloudflare Worker + KV "DB").
   Variables: GH_REPO ("usuario/repo"), GH_BRANCH ("main"), ADMIN_EMAIL, SITE_ORIGIN (https://usuario.github.io)
   Secretos: GH_TOKEN (permiso Contents: read/write solo de ese repo), JWT_SECRET (texto largo al azar), ADMIN_PASSWORD */
const enc = new TextEncoder(), dec = new TextDecoder();
let CORS = {};
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...CORS } });
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const toB64 = t => { let s = ''; for (const b of enc.encode(t)) s += String.fromCharCode(b); return btoa(s); };
const str = (v, n = 300) => String(v == null ? '' : v).trim().slice(0, n);
const num = v => { const n = Number(String(v).replace(',', '.')); return n > 0 ? Math.round(n * 100) / 100 : 0; };
const menuL = m => (Array.isArray(m) ? m : []).slice(0, 6).map(x => ({ n: str(x.n, 60), p: num(x.p), d: Math.min(100, num(x.d)), a: x.a !== false })).filter(x => x.n);
const mtxt = m => (m || []).map(x => x.n + (x.p ? ' $' + x.p : '') + (x.d ? ' -' + x.d + '%' : '') + (x.a ? '' : ' (NO disponible)')).join('; ');
const CAMPOS = ['descripcion', 'novedades', 'descuento', 'condiciones', 'vigenteHasta', 'horario', 'direccion', 'telefono'];

async function hmac(env, d) { const k = await crypto.subtle.importKey('raw', enc.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(d))); }
const sign = async (env, p) => { const b = b64u(enc.encode(JSON.stringify(p))); return b + '.' + await hmac(env, b); };
async function verify(env, t) { const [b, s] = (t || '').split('.'); if (!b || s !== await hmac(env, b)) return null; const p = JSON.parse(dec.decode(unb64u(b))); return p.exp > Date.now() ? p : null; }
async function pbk(pw, salt) { const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']); return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64u(salt), iterations: 100000, hash: 'SHA-256' }, k, 256)); }
const same = async (env, a, b) => await hmac(env, a) === await hmac(env, b);

const gh = (env, path, o = {}) => fetch('https://api.github.com/repos/' + env.GH_REPO + '/contents/' + path + (o.method ? '' : '?ref=' + env.GH_BRANCH),
  { ...o, headers: { Authorization: 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'at-worker', Accept: 'application/vnd.github+json' } });
async function readJSON(env, path) {
  const r = await gh(env, path); if (!r.ok) throw new Error('No se pudo leer GitHub (' + r.status + ')');
  const j = await r.json(); return { sha: j.sha, data: JSON.parse(dec.decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0)))) };
}
async function put(env, path, b64, msg, sha) {
  const r = await gh(env, path, { method: 'PUT', body: JSON.stringify({ message: msg, content: b64, branch: env.GH_BRANCH, sha }) });
  if (!r.ok) throw new Error('No se pudo guardar en GitHub (' + r.status + ')');
}
async function audit(env, u, a, ref, d) {
  await env.DB.put('a:' + String(9e12 - Date.now()).padStart(13, '0') + Math.random().toString(36).slice(2, 5), '1',
    { metadata: { f: new Date().toISOString(), u, a, r: str(ref, 80), d: str(d, 450) }, expirationTtl: 63072000 });
}
function diff(a, b) {
  const out = [];
  [...CAMPOS, 'nombre', 'categoria', 'activo', 'menu', 'imagen'].forEach(k => {
    let x = a[k], y = b[k]; if (k == 'menu') { x = mtxt(x); y = mtxt(y); }
    if (String(x ?? '') != String(y ?? '')) out.push(k == 'imagen' ? 'imagen: nueva imagen' : k + ': "' + str(x, 120) + '" → "' + str(y, 120) + '"');
  });
  return out;
}
async function aplicar(env, localId, c, actor, admin) {
  const { sha, data } = await readJSON(env, 'data/locales.json');
  let l = data.locales.find(x => x.id == localId);
  if (!l) {
    if (!admin) throw new Error('Local inexistente.');
    l = { id: 'l' + Date.now().toString(36), nombre: '', categoria: 'Otro', imagen: '', menu: [], activo: true }; data.locales.push(l);
  }
  const antes = JSON.parse(JSON.stringify(l));
  if (admin) { if (c.nombre != null) l.nombre = str(c.nombre, 80); if (c.categoria != null) l.categoria = str(c.categoria, 40); if (c.activo != null) l.activo = !!c.activo; }
  CAMPOS.forEach(k => { if (c[k] != null) l[k] = str(c[k], k == 'novedades' ? 800 : 300); });
  if (c.menu) l.menu = menuL(c.menu);
  if (!l.nombre) throw new Error('Falta el nombre del local.');
  if (c.imagenData) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(c.imagenData); if (!m) throw new Error('Imagen inválida.');
    const p = 'images/' + l.id + '-' + Date.now() + '.jpg'; await put(env, p, m[1], 'Imagen de ' + l.nombre); l.imagen = p;
  }
  data.actualizado = new Date().toISOString();
  await put(env, 'data/locales.json', toB64(JSON.stringify(data, null, 1)), 'Actualiza ' + l.nombre + ' (' + actor + ')', sha);
  return { id: l.id, nombre: l.nombre, cambios: diff(antes, l) };
}
async function aplicarNoticia(env, c, actor) {
  let sha, data = { noticias: [] };
  try { ({ sha, data } = await readJSON(env, 'data/noticias.json')); } catch (e) { /* primera noticia */ }
  let n = c.id ? data.noticias.find(x => x.id == c.id) : null;
  if (c.eliminar && n) { data.noticias = data.noticias.filter(x => x !== n); }
  else {
    if (!n) { n = { id: 'n' + Date.now().toString(36), fecha: new Date().toISOString().slice(0, 10), imagen: '' }; data.noticias.unshift(n); }
    n.titulo = str(c.titulo, 120); n.texto = str(c.texto, 2000); n.importante = !!c.importante; n.activo = c.activo !== false;
    if (!n.titulo) throw new Error('Falta el título.');
    if (c.imagenData) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(c.imagenData); if (!m) throw new Error('Imagen inválida.');
      const p = 'images/' + n.id + '-' + Date.now() + '.jpg'; await put(env, p, m[1], 'Imagen de noticia'); n.imagen = p;
    }
  }
  await put(env, 'data/noticias.json', toB64(JSON.stringify(data, null, 1)), 'Noticias (' + actor + ')', sha);
  return n ? n.titulo : '';
}
async function usuario(env, me) { // revalida el usuario en cada pedido
  if (me.role == 'admin') return me;
  const u = JSON.parse(await env.DB.get('u:' + me.email) || 'null');
  if (!u || u.activo === false) throw new Error('Tu usuario está desactivado.');
  return { ...me, local: u.local };
}

export default {
  async fetch(req, env) {
    CORS = { 'access-control-allow-origin': env.SITE_ORIGIN || '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method == 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(req.url).pathname;
    try {
      const body = req.method == 'POST' ? await req.json() : {};
      if (path == '/login') {
        const email = str(body.email, 100).toLowerCase(), pw = String(body.password || '');
        const f = Number(await env.DB.get('f:' + email) || 0); if (f >= 8) throw new Error('Demasiados intentos. Esperá 15 minutos.');
        let user = null;
        if (email == String(env.ADMIN_EMAIL).toLowerCase()) { if (await same(env, pw, env.ADMIN_PASSWORD)) user = { role: 'admin', local: '' }; }
        else { const u = JSON.parse(await env.DB.get('u:' + email) || 'null'); if (u && u.activo !== false && await pbk(pw, u.salt) == u.hash) user = { role: 'local', local: u.local }; }
        if (!user) { await env.DB.put('f:' + email, String(f + 1), { expirationTtl: 900 }); return J({ error: 'Mail o contraseña incorrectos.' }, 401); }
        await env.DB.delete('f:' + email); await audit(env, email, 'Inicio de sesión', '', '');
        return J({ token: await sign(env, { email, ...user, exp: Date.now() + 8 * 3600e3 }) });
      }
      let me = await verify(env, (req.headers.get('authorization') || '').slice(7));
      if (!me) return J({ error: 'Sesión vencida. Ingresá de nuevo.' }, 401);
      me = await usuario(env, me); const admin = me.role == 'admin';
      if (path == '/me') return J({ email: me.email, role: me.role, local: me.local });
      if (path == '/datos') return J((await readJSON(env, 'data/locales.json')).data);
      if (path == '/propose') {
        const id = str(body.localId, 40), c = body.cambios || {};
        if (admin) { const r = await aplicar(env, id, c, me.email, true); await audit(env, me.email, 'Editó local (directo)', r.nombre, r.cambios.join(' | ') || 'Sin cambios'); return J({ aplicado: true }); }
        if (id != me.local) throw new Error('Ese local no es tuyo.');
        const ok = { menu: c.menu, imagenData: c.imagenData }; CAMPOS.forEach(k => ok[k] = c[k]);
        const old = await env.DB.list({ prefix: 'p:' });
        for (const k of old.keys) { const v = JSON.parse(await env.DB.get(k.name) || '{}'); if (v.localId == id) await env.DB.delete(k.name); }
        await env.DB.put('p:' + Date.now() + Math.random().toString(36).slice(2, 5), JSON.stringify({ localId: id, email: me.email, fecha: new Date().toISOString(), cambios: ok }), { expirationTtl: 2592000 });
        await audit(env, me.email, 'Propuso cambios', id, 'Pendiente de aprobación'); return J({ pendiente: true });
      }
      if (path == '/pending') {
        const ks = (await env.DB.list({ prefix: 'p:' })).keys, out = [];
        for (const k of ks) { const v = JSON.parse(await env.DB.get(k.name)); if (admin || v.localId == me.local) { if (!admin) delete v.cambios.imagenData; out.push({ pid: k.name, ...v }); } }
        const ultimo = admin ? null : JSON.parse(await env.DB.get('r:' + me.local) || 'null');
        return J({ pendientes: out, ultimo });
      }
      if (!admin) return J({ error: 'Sin permiso.' }, 403);
      if (path == '/decide') {
        const v = JSON.parse(await env.DB.get(str(body.pid, 60)) || 'null'); if (!v) throw new Error('El cambio ya no existe.');
        let nom = v.localId;
        if (body.aceptar) { const r = await aplicar(env, v.localId, v.cambios, v.email + ' (aprobó ' + me.email + ')', false); nom = r.nombre; await audit(env, me.email, 'Aprobó cambios', nom, r.cambios.join(' | ')); }
        else await audit(env, me.email, 'Rechazó cambios', nom, str(body.motivo, 200));
        await env.DB.put('r:' + v.localId, JSON.stringify({ ok: !!body.aceptar, motivo: str(body.motivo, 200), fecha: new Date().toISOString() }));
        await env.DB.delete(body.pid); return J({ ok: true });
      }
      if (path == '/datos-noticias') { try { return J((await readJSON(env, 'data/noticias.json')).data); } catch (e) { return J({ noticias: [] }); } }
      if (path == '/noticia') { const t = await aplicarNoticia(env, body, me.email); await audit(env, me.email, body.eliminar ? 'Eliminó noticia' : 'Publicó/editó noticia', t, ''); return J({ ok: true }); }
      if (path == '/users') return J({ usuarios: (await env.DB.list({ prefix: 'u:' })).keys.map(k => ({ email: k.name.slice(2), ...k.metadata })) });
      if (path == '/user') {
        const email = str(body.email, 100).toLowerCase(), key = 'u:' + email; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Mail inválido.');
        const old = JSON.parse(await env.DB.get(key) || 'null') || {}; let { salt, hash } = old;
        if (body.password) { if (String(body.password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.'); salt = b64u(crypto.getRandomValues(new Uint8Array(16))); hash = await pbk(String(body.password), salt); }
        if (!hash) throw new Error('Falta la contraseña.');
        const v = { salt, hash, local: str(body.local, 40), activo: body.activo !== false };
        await env.DB.put(key, JSON.stringify(v), { metadata: { local: v.local, activo: v.activo } });
        await audit(env, me.email, 'Gestionó usuario', email, 'Local: ' + v.local + ' · activo: ' + v.activo + (body.password ? ' · nueva contraseña' : '')); return J({ ok: true });
      }
      if (path == '/audit') return J({ items: (await env.DB.list({ prefix: 'a:', limit: 300 })).keys.map(k => k.metadata) });
      return J({ error: 'No encontrado' }, 404);
    } catch (e) { return J({ error: e.message }, 400); }
  }
};
