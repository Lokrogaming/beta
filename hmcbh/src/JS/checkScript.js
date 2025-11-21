
/*
 HMCBH — Single-file client-side password checker.
 - Stream-suche in Wortlisten (fetch + ReadableStream).
 - Zeigt Treffer (Datei + Zeilennummer), Live-Fortschritt, und Bruteforce-Zeitestimate.
 - Hinweise: große Dateien können lange dauern; CORS muss von deinem GitHub Pages-Host erlaubt sein.
*/

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const addPathBtn = document.getElementById('addPathBtn');
const manualPath = document.getElementById('manualPath');
const listSelect = document.getElementById('listSelect');
const baseUrlInput = document.getElementById('baseUrl');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const statusEl = document.getElementById('status');
const bar = document.getElementById('bar');
const resultItems = document.getElementById('resultItems');
const foundCountEl = document.getElementById('foundCount');
const selectedListsEl = document.getElementById('selectedLists');
const logEl = document.getElementById('log');
const brutebox = document.getElementById('brutebox');

let controller = null; // AbortController for stopping
let foundCount = 0;

function log(text){
  const t = new Date().toISOString().replace('T',' ').slice(0,19);
  const prev = logEl.textContent === '—' ? '' : logEl.textContent + '\n';
  logEl.textContent = prev + `[${t}] ${text}`;
  logEl.scrollTop = logEl.scrollHeight;
}

function humanTime(seconds){
  if(!isFinite(seconds)) return 'unendlich';
  const units = [
    ['Jahre', 60*60*24*365],
    ['Tage', 60*60*24],
    ['Stunden', 60*60],
    ['Minuten', 60],
    ['Sekunden', 1]
  ];
  let out=[];
  for(const [name,sec] of units){
    const v = Math.floor(seconds/sec);
    if(v>0){ out.push(`${v} ${name}`); seconds -= v*sec; }
  }
  return out.length? out.slice(0,3).join(', ') : 'weniger als 1 Sek.';
}

function calcBruteforceTime(password, charsetPreset, guessesPerSec){
  // charset size presets
  const presets = {
    'lower':26,
    'lower+upper':52,
    'alpha+nums':62,
    'all':95
  };
  const charset = presets[charsetPreset] || 62;
  const length = password.length;
  // combinations ~ charset^length (cap to avoid overflow)
  const combos = Math.pow(charset, length);
  const seconds = combos / guessesPerSec;
  return {combos, seconds};
}

function updateBruteEstimate(){
  const pw = passwordInput.value || '';
  if(!pw){ brutebox.innerHTML = '<em>Gib ein Passwort ein und klicke "Starte Suche".</em>'; return; }
  const charsetPreset = document.getElementById('charsetPreset').value;
  const guesses = Number(document.getElementById('speed').value) || 1000000;
  const {combos, seconds} = calcBruteforceTime(pw, charsetPreset, guesses);
  brutebox.innerHTML = `
    <div class="meta">Länge: <strong>${pw.length}</strong> Zeichen</div>
    <div class="meta">Geschätzte Kombinationen: <strong>${Math.round(combos).toLocaleString()}</strong></div>
    <div class="meta">Angenommene Rate: <strong>${guesses.toLocaleString()} guesses/s</strong></div>
    <div style="margin-top:8px"><strong>Bruteforce-Dauer:</strong> ${humanTime(seconds)}</div>
    <small class="meta">Hinweis: reale Angriffe nutzen Wortlisten, Regeln und GPU-Optimierungen; diese Schätzung ist ein grober Richtwert.</small>
  `;
}

passwordInput.addEventListener('input', updateBruteEstimate);
document.getElementById('charsetPreset').addEventListener('change', updateBruteEstimate);
document.getElementById('speed').addEventListener('change', updateBruteEstimate);

addPathBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  const v = manualPath.value.trim();
  if(!v) return;
  const opt = document.createElement('option');
  opt.value = v;
  opt.text = v;
  opt.selected = true;
  listSelect.appendChild(opt);
  manualPath.value = '';
  updateSelectedLists();
});

function updateSelectedLists(){
  const opts = Array.from(listSelect.selectedOptions).map(o => o.value);
  selectedListsEl.textContent = opts.length ? opts.join(', ') : '—';
}
listSelect.addEventListener('change', updateSelectedLists);
updateSelectedLists();

clearBtn.addEventListener('click',(e)=>{
  e.preventDefault();
  resultItems.innerHTML = '<em>Ergebnisse gelöscht.</em>';
  foundCount = 0;
  foundCountEl.textContent = foundCount;
  log('Ergebnisse gelöscht.');
});

stopBtn.addEventListener('click',(e)=>{
  e.preventDefault();
  if(controller) {
    controller.abort();
    controller = null;
    statusEl.textContent = 'Gestoppt.';
    stopBtn.disabled = true;
    startBtn.disabled = false;
    bar.style.width = '0%';
    log('Suche manuell gestoppt.');
  }
});

startBtn.addEventListener('click', async (e)=>{
  e.preventDefault();
  foundCount = 0;
  foundCountEl.textContent = foundCount;
  resultItems.innerHTML = '';
  logEl.textContent = '—';
  updateBruteEstimate();

  const baseUrl = (baseUrlInput.value || '').trim();
  if(!baseUrl){
    statusEl.textContent = 'Fehler: Basis-URL fehlt.';
    return;
  }
  const password = passwordInput.value;
  const username = usernameInput.value;
  if(!password && !username){
    statusEl.textContent = 'Fehler: Bitte Passwort und/oder Benutzername eingeben.';
    return;
  }

  const lists = Array.from(listSelect.selectedOptions).map(o => o.value);
  if(lists.length===0){ statusEl.textContent = 'Fehler: Wähle mindestens eine Liste aus.'; return; }
  selectedListsEl.textContent = lists.join(', ');
  startBtn.disabled = true;
  stopBtn.disabled = false;
  controller = new AbortController();

  log(`Starte Suche nach Passwort="${password ? '[HIDDEN]' : ''}" username="${username || ''}" in ${lists.length} Datei(en).`);
  statusEl.textContent = 'Suche läuft... (streaming)';
  bar.style.width = '2%';

  // iterate lists sequentially (so UI shows progress)
  for(let i=0;i<lists.length;i++){
    if(!controller) break;
    const rel = lists[i];
    const url = baseUrl.replace(/\/+$/,'/') + rel;
    try{
      await streamSearchFile(url, rel, password, username, controller.signal, i, lists.length);
    }catch(err){
      if(err.name === 'AbortError'){ log(`Fetch ${rel} abgebrochen.`); break; }
      log(`Fehler beim Laden ${rel}: ${err.message}`);
      appendResult({file:rel, status:'error', message:err.message});
    }
    // small gap to allow UI update
    await new Promise(r=>setTimeout(r,200));
  }

  statusEl.textContent = 'Fertig.';
  bar.style.width = '100%';
  startBtn.disabled = false;
  stopBtn.disabled = true;
  controller = null;
  log('Suche beendet.');
});

function appendResult(node){
  // node: {file, status:'found'|'notfound'|'error', details}
  const wrap = document.createElement('div');
  if(node.status === 'found'){
    wrap.className = 'found';
    wrap.innerHTML = `<div><strong>Gefunden in ${escapeHtml(node.file)}</strong></div>
      <div class="meta">Zeile: <strong>${node.line}</strong> — Position (ungefähr): <strong>${node.position}</strong></div>
      <div class="meta">Treffer: <code>${escapeHtml(node.match)}</code></div>
      <div style="margin-top:6px">${node.extra ? '<small class="meta">'+escapeHtml(node.extra)+'</small>' : ''}</div>`;
  } else if(node.status === 'notfound'){
    wrap.className = 'notfound';
    wrap.innerHTML = `<div><strong>Nicht gefunden in ${escapeHtml(node.file)}</strong></div><div class="meta">${node.message || ''}</div>`;
  } else {
    wrap.className = '';
    wrap.innerHTML = `<div><strong>${escapeHtml(node.file)}</strong></div><div class="meta">${escapeHtml(node.message || '')}</div>`;
  }
  // prepend
  if(resultItems.children.length===0 || resultItems.children[0].tagName === 'EM'){
    resultItems.innerHTML = '';
  }
  resultItems.insertBefore(wrap, resultItems.firstChild);
}

/* Streaming line-by-line search to avoid loading entire big files.
   We read the response body as a stream, decode chunks, and split by newline.
*/
async function streamSearchFile(url, relPath, password, username, signal, index, total){
  log(`Lade ${relPath} ...`);
  const resp = await fetch(url, {signal});
  if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const reader = resp.body.getReader();
const decoder = new TextDecoder();
let remainder = '';
let lineNo = 0;
let foundInThisFile = false;
const lowerPassword = password ? password.toLowerCase() : null;
const lowerUsername = username ? username.toLowerCase() : null;

const totalBytes = resp.headers.get('Content-Length') ? Number(resp.headers.get('Content-Length')) : NaN;
let readBytes = 0;


  while(true){
    const res = await reader.read();
    if(res.done) break;
    const chunkText = decoder.decode(res.value, {stream:true});
    readBytes += res.value.length;
    const data = remainder + chunkText;
    const lines = data.split(/\r?\n/);
    remainder = lines.pop(); // last may be partial
    for(const ln of lines){
      lineNo++;
      // simple checks: exact match or contains
      const lower = ln.toLowerCase();
      let matched = false;
      if(password && lower.includes(lowerPassword)) matched = true;
      if(username && lower.includes(lowerUsername)) matched = true;
      if(matched && !foundInThisFile){
        foundInThisFile = true;
        foundCount++;
        foundCountEl.textContent = foundCount;
        const approxPos = Math.max(1, Math.floor((readBytes / Math.max(1,totalBytes || readBytes)) * 100)) + '%';
        appendResult({file:relPath, status:'found', line:lineNo, position:approxPos, match:ln.trim(), extra:`Gefunden beim Streaming — bytes gelesen ${readBytes}${isFinite(totalBytes)?' / '+totalBytes:''}`});
        log(`Treffer in ${relPath} Zeile ${lineNo}`);
        // do not break entire read: continue to find first occurrence only in file
      }
    }

    // update progress bar using file index + proportion
    const fileProgress = isFinite(totalBytes) ? (readBytes / totalBytes) : 0;
    const overall = ((index) + fileProgress) / Math.max(1,total-1);
    bar.style.width = Math.min(100, Math.floor(overall*100)) + '%';
    if(signal.aborted) {
      reader.cancel();
      throw new DOMException('Abgebrochen','AbortError');
    }
  }

  // handle remainder last line
  if(remainder){
    lineNo++;
    const lower = remainder.toLowerCase();
    if((password && lower.includes(lowerPassword)) || (username && lower.includes(lowerUsername))){
      if(!foundInThisFile){
        foundInThisFile = true;
        foundCount++;
        foundCountEl.textContent = foundCount;
        appendResult({file:relPath, status:'found', line:lineNo, position:'EOF', match:remainder.trim()});
        log(`Treffer in ${relPath} Zeile ${lineNo}`);
      }
    }
  }

  if(!foundInThisFile){
    appendResult({file:relPath, status:'notfound', message:'Kein Treffer in dieser Liste.'});
    log(`Kein Treffer in ${relPath}.`);
  }
}

/* small helper */
function escapeHtml(s){
  return (s+'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}

// initial log
log('HMCBH bereit.');

// Accessibility: allow Enter to start
document.getElementById('checker').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && (e.target.tagName !== 'TEXTAREA')) { startBtn.click(); e.preventDefault(); }
});

