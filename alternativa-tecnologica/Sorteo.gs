/** BECAS DE FOTOCOPIAS - Alternativa Tecnológica
 *  Pegar en un Google Sheet NUEVO (Extensiones > Apps Script), junto con el archivo Sorteo.html.
 *  Recargá el Sheet y usá el menú "Sorteo AT". Los ganadores solo los ve quien tenga acceso a este Sheet. */
const CARRERAS = ['Ingeniería Mecánica', 'Ingeniería Eléctrica', 'Ingeniería Electrónica', 'Ingeniería Civil', 'Ingeniería en Sistemas de Información'];
const P = () => PropertiesService.getScriptProperties();

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sorteo AT')
    .addItem('1) Crear formulario de becas', 'crearFormulario')
    .addItem('2) Hacer sorteo', 'abrirSorteo')
    .addItem('3) Nuevo mes (empezar inscripción nueva)', 'nuevoCiclo').addToUi();
}

function crearFormulario() {
  const f = FormApp.create('Becas de fotocopias - Alternativa Tecnológica');
  f.setDescription('Pueden participar estudiantes de Ingeniería (Mecánica, Eléctrica, Electrónica, Civil y Sistemas). Una inscripción por persona.');
  const letras = '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{2,40}$';
  const txt = (t, re, msg) => f.addTextItem().setTitle(t).setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText(msg).requireTextMatchesPattern(re).build());
  txt('Apellido', letras, 'Solo letras.');
  txt('Nombre', letras, 'Solo letras.');
  txt('DNI', '^\\d{7,8}$', 'Solo números, sin puntos ni espacios (7 u 8 dígitos).');
  txt('Legajo', '^\\d{5}$', 'El legajo tiene 5 números. Sin letras ni símbolos.');
  f.addListItem().setTitle('Carrera').setChoiceValues(CARRERAS).setRequired(true);
  f.addTextItem().setTitle('Mail').setRequired(true).setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  txt('Celular', '^\\d{8,13}$', 'Solo números, sin espacios ni guiones (ej: 3814123456).');
  f.setDestination(FormApp.DestinationType.SPREADSHEET, SpreadsheetApp.getActive().getId());
  P().setProperty('CICLO', String(Date.now()));
  SpreadsheetApp.getUi().alert('Formulario creado.\n\nLINK PARA COMPARTIR (ponelo en la web):\n' + f.getPublishedUrl() +
    '\n\nPara editarlo:\n' + f.getEditUrl() + '\n\nCada mes, abrí o cerrá la recepción desde el Form (pestaña Respuestas > "Aceptando respuestas").');
}

function nuevoCiclo() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Nuevo mes', 'Los inscriptos anteriores no participarán del próximo sorteo (quedan guardados en la hoja). ¿Continuar?', ui.ButtonSet.YES_NO) == ui.Button.YES) {
    P().setProperty('CICLO', String(Date.now())); ui.alert('Listo. El próximo sorteo solo contará las inscripciones nuevas.');
  }
}

function hojaResp_() {
  return SpreadsheetApp.getActive().getSheets().find(s => s.getName() != 'Ganadores' && s.getLastColumn() > 0 &&
    s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].indexOf('Legajo') >= 0);
}

/** Inscriptos válidos del ciclo actual (sin repetidos de legajo ni DNI) que todavía no ganaron en este ciclo. */
function candidatos_() {
  const s = hojaResp_(); if (!s) throw new Error('Todavía no hay respuestas. Creá el formulario primero.');
  const v = s.getDataRange().getValues(), h = v.shift(), ix = n => h.indexOf(n);
  const desde = Number(P().getProperty('CICLO') || 0), leg = new Set(), dni = new Set(), out = [];
  v.forEach(r => {
    if (!r[0] || new Date(r[0]).getTime() < desde) return;
    let l = String(r[ix('Legajo')]).trim(); if (/^\d{1,5}$/.test(l)) l = l.padStart(5, '0');
    const d = String(r[ix('DNI')]).replace(/\D/g, ''), c = r[ix('Carrera')];
    if (!/^\d{5}$/.test(l) || !/^\d{7,8}$/.test(d) || CARRERAS.indexOf(c) < 0 || leg.has(l) || dni.has(d)) return;
    leg.add(l); dni.add(d);
    out.push({ apellido: String(r[ix('Apellido')]).trim(), nombre: String(r[ix('Nombre')]).trim(), legajo: l, dni: d, carrera: c, mail: r[ix('Mail')], celular: String(r[ix('Celular')]) });
  });
  const g = SpreadsheetApp.getActive().getSheetByName('Ganadores'), ya = new Set();
  if (g && g.getLastRow() > 1) g.getDataRange().getValues().slice(1).forEach(r => { if (String(r[1]) == P().getProperty('CICLO')) ya.add(String(r[2])); });
  return out.filter(x => !ya.has(x.legajo));
}

function abrirSorteo() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('Sorteo').setWidth(620).setHeight(640), 'Sorteo de becas de fotocopias');
}
function datosSorteo() { const c = candidatos_(); return { total: c.length, nombres: c.map(x => x.apellido + ', ' + x.nombre).slice(0, 400) }; }

function sortear(n) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const pool = candidatos_(); n = Math.floor(Number(n));
    if (!(n >= 1) || n > pool.length) throw new Error('Hay ' + pool.length + ' participantes disponibles.');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const gan = pool.slice(0, n), ss = SpreadsheetApp.getActive();
    let g = ss.getSheetByName('Ganadores');
    if (!g) { g = ss.insertSheet('Ganadores'); g.appendRow(['Fecha', 'Ciclo', 'Legajo', 'Apellido', 'Nombre', 'DNI', 'Carrera', 'Mail', 'Celular']); g.getRange('A:I').setNumberFormat('@'); g.setFrozenRows(1); }
    const f = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    gan.forEach(x => g.appendRow([f, P().getProperty('CICLO'), x.legajo, x.apellido, x.nombre, x.dni, x.carrera, x.mail, x.celular]));
    return gan.map(x => ({ n: x.apellido + ', ' + x.nombre, l: x.legajo, c: x.carrera }));
  } finally { lock.releaseLock(); }
}
