// ===================== INIT =====================
const browserId = "WEB_" + Math.random().toString(16).slice(2, 8);
let editingPhase = 'red', slideIndex = 0, scrollX = 0, map;
let markers = {}, devicesStatus = {}, devicesLastSeen = {}, selectedDeviceId = null;
let mapInitialized = false;
let loginRetries = 0;
const MAX_LOGIN_RETRIES = 3;
let loginRetryTimer = null;

const canvas = document.getElementById('p10Canvas');
const ctx = canvas.getContext('2d');

// Hardware real: 6 painéis de 20×40 = 120×40 LEDs
// Canvas: 720×240px = exatamente 6px por LED
const LED_COLS   = 96;
const LED_ROWS   = 40;
const LED_PX     = 6;
// Altura real das letras no painel (em LEDs/pixels)
const ALTURA_GRANDE = 10;  // tamanho 3
const ALTURA_MEDIO  = 13;  // tamanho 2

let devicesMemory = {};
if (localStorage.getItem('pmv_multi_v1')) {
    try { devicesMemory = JSON.parse(localStorage.getItem('pmv_multi_v1')); } catch(e) {}
}

// ===================== PALETA DE CORES =====================
const PALETA = [
    { hex: '#000000', label: 'Preto'   },
    { hex: '#ffffff', label: 'Branco'  },
    { hex: '#ffff00', label: 'Amarelo' },
    { hex: '#ff8c00', label: 'Laranja' },
    { hex: '#00ff00', label: 'Verde'   },
    { hex: '#042649b0', label: 'Azul'    },
];

function buildColorPicker(containerId, hiddenId, defaultColor) {
    const container = document.getElementById(containerId);
    PALETA.forEach(p => {
        const sw = document.createElement('div');
        sw.className = 'color-swatch' + (p.hex === defaultColor ? ' selected' : '');
        sw.style.background = p.hex;
        sw.dataset.color = p.hex;
        sw.title = p.label;
        sw.onclick = () => {
            container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
            document.getElementById(hiddenId).value = p.hex;
            updateMemory();
        };
        container.appendChild(sw);
    });
}

buildColorPicker('tColorPicker',  'tColor',  '#ffff00');
buildColorPicker('bgColorPicker', 'bgColor', '#000000');

function syncColorPickerUI(containerId, hiddenId) {
    const val = document.getElementById(hiddenId).value.toLowerCase();
    document.querySelectorAll(`#${containerId} .color-swatch`).forEach(sw => {
        sw.classList.toggle('selected', sw.dataset.color === val);
    });
}

// ===================== MQTT =====================
const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt", {
    reconnectPeriod: 3000,
    connectTimeout: 10000,
});

client.on('connect', () => {
    client.subscribe("painel_led_status");
    client.subscribe("painel_led_sync");
    client.subscribe("auth/response");
});

// Rastreia quais devices já tiveram sync recebido nesta sessão
const syncRecebido = {};

client.on('message', (topic, message) => {

    if (topic === "auth/response") {
        try {
            const res = JSON.parse(message.toString());
            if (res.id !== browserId) return;
            clearTimeout(loginRetryTimer);
            if (res.status === "success") {
                loginRetries = 0;
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('loginStatus').innerText = '';
                if (!map) {
                    map = L.map('map', { zoomControl: false }).setView([0, 0], 2);
                    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);
                }
                // Pede a todos os painéis para republicar seu estado atual
                client.publish('painel_led_sync_request', JSON.stringify({ target: 'all' }));
            } else {
                loginRetries++;
                if (loginRetries < MAX_LOGIN_RETRIES) {
                    document.getElementById('loginStatus').innerText = `Tentativa ${loginRetries}/${MAX_LOGIN_RETRIES}...`;
                    loginRetryTimer = setTimeout(() => tentarLogin(), 1500);
                } else {
                    loginRetries = 0;
                    document.getElementById('btnLogin').disabled = false;
                    document.getElementById('btnLogin').innerText = "ENTRAR";
                    document.getElementById('loginStatus').innerText = '';
                    alert("Acesso Negado: " + (res.reason || "Credenciais inválidas"));
                }
            }
        } catch (e) {}
    }

    if (topic === "painel_led_status") {
        try {
            const data = JSON.parse(message.toString());
            const id = data.dispositivo || "PMV-Desconhecido";
            devicesLastSeen[id] = Date.now();
            devicesStatus[id] = data;
            if (!devicesMemory[id]) {
                devicesMemory[id] = {
                    red:   { text: "PARE\nOBRAS", modo: "fixed",  tamanho: "2", cor: "#ff8c00", fundo: "#000000", align: "center", valign: "center" },
                    green: { text: "SIGA\nLIVRE",  modo: "slide",  tamanho: "2", cor: "#00ff00", fundo: "#000000", align: "center", valign: "center" }
                };
            }
            updateDeviceOnMap(id, data);
            if (selectedDeviceId === id) refreshUIElements(data);
        } catch (e) {}
    }

    if (topic === "painel_led_sync") {
        try {
            const syncData = JSON.parse(message.toString());
            const id = syncData.target;
            if (id) {
                devicesMemory[id] = {
                    red: {
                        text:    syncData.mensagensRed.join('\n'),
                        modo:    syncData.r_modo,
                        tamanho: String(syncData.r_tam),
                        cor:     rgb565ToHex(syncData.r_cor),
                        fundo:   "#000000",
                        align:   syncData.r_align  || "center",
                        valign:  syncData.r_valign || "center"
                    },
                    green: {
                        text:    syncData.mensagensGreen.join('\n'),
                        modo:    syncData.g_modo,
                        tamanho: String(syncData.g_tam),
                        cor:     rgb565ToHex(syncData.g_cor),
                        fundo:   "#000000",
                        align:   syncData.g_align  || "center",
                        valign:  syncData.g_valign || "center"
                    }
                };
                localStorage.setItem('pmv_multi_v1', JSON.stringify(devicesMemory));
                syncRecebido[id] = true;
                // Renderiza e restaura placeholder
                if (selectedDeviceId === id) {
                    document.getElementById('msgInput').placeholder = 'Texto...';
                    renderForm();
                }
            }
        } catch (e) {}
    }
});

// ===================== LOGIN =====================
function tentarLogin() {
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    client.publish("auth/request", JSON.stringify({ id: browserId, user, pass }));
    loginRetryTimer = setTimeout(() => {
        loginRetries++;
        if (loginRetries < MAX_LOGIN_RETRIES) {
            document.getElementById('loginStatus').innerText = `Tentativa ${loginRetries}/${MAX_LOGIN_RETRIES}... sem resposta`;
            tentarLogin();
        } else {
            loginRetries = 0;
            document.getElementById('btnLogin').disabled = false;
            document.getElementById('btnLogin').innerText = "ENTRAR";
            document.getElementById('loginStatus').innerText = 'Sem resposta. Verifique a conexão.';
        }
    }, 5000);
}

function logar() {
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    if (!user || !pass) { alert("Preencha usuário e senha!"); return; }
    loginRetries = 0;
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnLogin').innerText = "AUTENTICANDO...";
    document.getElementById('loginStatus').innerText = "Conectando...";
    tentarLogin();
}

// ===================== MAPA =====================
function updateDeviceOnMap(id, data) {
    if (!map) return;
    if (!markers[id]) {
        markers[id] = L.circleMarker([data.lat, data.lng], {
            radius: 12, fillColor: "#007bff", color: "#fff", weight: 3, opacity: 1, fillOpacity: 0.9
        }).addTo(map);
        markers[id].on('click', () => {
            selectedDeviceId = id;
            document.getElementById('control-panel').style.display = 'block';
            refreshUIElements(data);
            if (syncRecebido[id]) {
                // Sync já chegou nesta sessão — dados do hardware confirmados
                renderForm();
            } else {
                // Sync ainda não chegou — pede ao hardware e aguarda
                document.getElementById('msgInput').value = '';
                document.getElementById('msgInput').placeholder = 'Aguardando dados do painel...';
                // Republica pedido de sync para este device específico
                client.publish('painel_led_sync_request', JSON.stringify({ target: id }));
                // Aguarda até 5s; quando o sync chegar, renderForm() será chamado
                // automaticamente pelo handler do painel_led_sync
            }
        });
    }
    markers[id].setLatLng([data.lat, data.lng]);
    if (!mapInitialized) { map.setView([data.lat, data.lng], 15); mapInitialized = true; }
    else if (selectedDeviceId === id) map.panTo(new L.LatLng(data.lat, data.lng));
}

function refreshUIElements(data) {
    const hVermelho = data.vermelho;
    document.getElementById('ledRed').classList.toggle('active', hVermelho);
    document.getElementById('ledGreen').classList.toggle('active', !hVermelho);
    document.getElementById('statusTxt').innerText = hVermelho ? "VERMELHO ATIVO" : "VERDE ATIVO";
    document.getElementById('devName').innerText = data.dispositivo;
    const btn = document.getElementById('btnSalvar');
    btn.disabled = !hVermelho;
    btn.innerText = hVermelho ? "SALVAR EM " + data.dispositivo : "BLOQUEADO (VERDE)";
    const conn = document.getElementById('connStatus');
    conn.innerText = "● ONLINE"; conn.className = "online-text";
}

// ===================== FORM =====================
function renderForm() {
    if (!selectedDeviceId || !devicesMemory[selectedDeviceId]) return;
    const config = devicesMemory[selectedDeviceId][editingPhase];
    document.getElementById('msgInput').value     = config.text    || '';
    document.getElementById('modoExibicao').value = config.modo    || 'fixed';
    document.getElementById('fSize').value        = config.tamanho || '2';
    document.getElementById('align').value        = config.align   || 'center';
    document.getElementById('valign').value       = config.valign  || 'center';
    document.getElementById('tColor').value       = config.cor     || '#ffff00';
    document.getElementById('bgColor').value      = config.fundo   || '#000000';
    syncColorPickerUI('tColorPicker',  'tColor');
    syncColorPickerUI('bgColorPicker', 'bgColor');
    document.getElementById('selectRed').className   = 'state-btn' + (editingPhase === 'red'   ? ' btn-editing-red'   : '');
    document.getElementById('selectGreen').className = 'state-btn' + (editingPhase === 'green' ? ' btn-editing-green' : '');
}

function updateMemory() {
    if (!selectedDeviceId) return;
    devicesMemory[selectedDeviceId][editingPhase] = {
        text:    document.getElementById('msgInput').value,
        modo:    document.getElementById('modoExibicao').value,
        tamanho: document.getElementById('fSize').value,
        align:   document.getElementById('align').value,
        valign:  document.getElementById('valign').value,
        cor:     document.getElementById('tColor').value,
        fundo:   document.getElementById('bgColor').value,
    };
    localStorage.setItem('pmv_multi_v1', JSON.stringify(devicesMemory));
}

function setEditingPhase(p) { editingPhase = p; scrollX = 0; renderForm(); }
function fecharPainel() { document.getElementById('control-panel').style.display = 'none'; selectedDeviceId = null; }

// ===================== TIMEOUT OFFLINE =====================
setInterval(() => {
    Object.keys(devicesLastSeen).forEach(id => {
        const isOffline = (Date.now() - devicesLastSeen[id] > 8000);
        if (markers[id]) markers[id].setStyle({ fillColor: isOffline ? "#7f8c8d" : "#007bff" });
        if (isOffline && selectedDeviceId === id) {
            document.getElementById('connStatus').innerText = "● OFFLINE";
            document.getElementById('connStatus').className = "offline-text";
            document.getElementById('btnSalvar').disabled = true;
        }
    });
}, 2000);

// ===================== PREVIEW — MOTOR DE RENDERIZAÇÃO =====================
const offCanvas = document.createElement('canvas');
offCanvas.width  = LED_COLS;
offCanvas.height = LED_ROWS;
const offCtx = offCanvas.getContext('2d');

// Calibração exata: fonte monospaced para aproximar bitmap GFX
// Grande=10px altura letra, Médio=13px altura letra (medidos no painel real)
function getFontSpec(tamanho) {
    if (tamanho === '3') return { size: 14, bold: true };
    return                      { size: 13, bold: false };
}

// Calcula Y da baseline no offscreen (espelho do calcY1 do firmware)
function calcY1Preview(valign, altLetra, duasLinhas) {
    const espaco = 2;
    if (valign === 'top') {
        return altLetra + 1;
    } else if (valign === 'bottom') {
        if (duasLinhas) return LED_ROWS - altLetra - espaco - 1;
        return LED_ROWS - 2;
    } else { // center
        const blocoTotal = duasLinhas ? (altLetra * 2 + espaco) : altLetra;
        const topoBloco  = Math.floor((LED_ROWS - blocoTotal) / 2);
        return topoBloco + altLetra;
    }
}

// Desenha acento no offCtx (espelho dos acentos do firmware)
function desenharAcentoPreview(tipo, bx, by, maiuscula, cor) {
    const oy = maiuscula ? -12 : -9;
    offCtx.fillStyle = cor;
    switch (tipo) {
        case 1: // ^ circunflexo
            offCtx.fillRect(bx+2, by+oy,   1, 1);  // pico
            offCtx.fillRect(bx+1, by+oy+1, 1, 1);  // esq
            offCtx.fillRect(bx+3, by+oy+1, 1, 1);  // dir
            break;
        case 2: // ' agudo
            offCtx.fillRect(bx+2, by+oy,   1, 1);
            offCtx.fillRect(bx+1, by+oy+1, 1, 1);
            break;
        case 3: // ` grave
            offCtx.fillRect(bx+1, by+oy,   1, 1);
            offCtx.fillRect(bx+2, by+oy+1, 1, 1);
            break;
        case 4: // ~ til
            offCtx.fillRect(bx+1, by+oy,   1, 1);
            offCtx.fillRect(bx+3, by+oy,   1, 1);
            offCtx.fillRect(bx+2, by+oy+1, 1, 1);
            break;
        case 5: // cedilha
            offCtx.fillRect(bx+3, by+1, 1, 1);
            offCtx.fillRect(bx+3, by+2, 1, 1);
            offCtx.fillRect(bx+4, by+2, 1, 1);
            offCtx.fillRect(bx+4, by+3, 1, 1);
            offCtx.fillRect(bx+3, by+3, 1, 1);
            offCtx.fillRect(bx+2, by+4, 1, 1);
            offCtx.fillRect(bx+1, by+4, 1, 1);
            break;
    }
}

// Mapa de acentos para o preview (mesmo esquema do firmware)
const ACENTO_MAP = {
    'À':{'base':'A','tipo':3,'M':true}, 'Á':{'base':'A','tipo':2,'M':true},
    'Â':{'base':'A','tipo':1,'M':true}, 'Ã':{'base':'A','tipo':4,'M':true},
    'Ç':{'base':'C','tipo':5,'M':true}, 'È':{'base':'E','tipo':3,'M':true},
    'É':{'base':'E','tipo':2,'M':true}, 'Ê':{'base':'E','tipo':1,'M':true},
    'Ì':{'base':'I','tipo':3,'M':true}, 'Í':{'base':'I','tipo':2,'M':true},
    'Î':{'base':'I','tipo':1,'M':true}, 'Ò':{'base':'O','tipo':3,'M':true},
    'Ó':{'base':'O','tipo':2,'M':true}, 'Ô':{'base':'O','tipo':1,'M':true},
    'Õ':{'base':'O','tipo':4,'M':true}, 'Ù':{'base':'U','tipo':3,'M':true},
    'Ú':{'base':'U','tipo':2,'M':true}, 'Û':{'base':'U','tipo':1,'M':true},
    'à':{'base':'a','tipo':3,'M':false},'á':{'base':'a','tipo':2,'M':false},
    'â':{'base':'a','tipo':1,'M':false},'ã':{'base':'a','tipo':4,'M':false},
    'ç':{'base':'c','tipo':5,'M':false},'è':{'base':'e','tipo':3,'M':false},
    'é':{'base':'e','tipo':2,'M':false},'ê':{'base':'e','tipo':1,'M':false},
    'ì':{'base':'i','tipo':3,'M':false},'í':{'base':'i','tipo':2,'M':false},
    'î':{'base':'i','tipo':1,'M':false},'ò':{'base':'o','tipo':3,'M':false},
    'ó':{'base':'o','tipo':2,'M':false},'ô':{'base':'o','tipo':1,'M':false},
    'õ':{'base':'o','tipo':4,'M':false},'ù':{'base':'u','tipo':3,'M':false},
    'ú':{'base':'u','tipo':2,'M':false},'û':{'base':'u','tipo':1,'M':false},
};

function drawTextWithAccents(text, x, y, cor) {
    let cx = x;
    for (const ch of text) {
        const ai = ACENTO_MAP[ch];
        if (ai) {
            const bx = cx;
            offCtx.fillStyle = cor;
            offCtx.fillText(ai.base, cx, y);
            cx += offCtx.measureText(ai.base).width;
            desenharAcentoPreview(ai.tipo, bx, y, ai.M, cor);
        } else {
            offCtx.fillStyle = cor;
            offCtx.fillText(ch, cx, y);
            cx += offCtx.measureText(ch).width;
        }
    }
    return cx;
}

function loop() {
    if (!selectedDeviceId || !devicesMemory[selectedDeviceId]) {
        requestAnimationFrame(loop); return;
    }

    const conf   = devicesMemory[selectedDeviceId][editingPhase];
    const linhas = conf.text.split('\n').filter(x => x.trim().length > 0);
    const modo   = conf.modo   || 'fixed';
    const align  = conf.align  || 'center';
    const valign = conf.valign || 'center';
    const corTxt = conf.cor    || '#ffff00';
    const corFnd = conf.fundo  || '#000000';
    const tam    = conf.tamanho || '2';
    const fSpec  = getFontSpec(tam);
    const altLetra = (tam === '3') ? ALTURA_GRANDE : ALTURA_MEDIO;

    // Fundo canvas principal
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Offscreen
    offCtx.fillStyle = corFnd;
    offCtx.fillRect(0, 0, LED_COLS, LED_ROWS);

                offCtx.font = `${fSpec.bold ? "bold " : ""}${fSpec.size}px Arial, sans-serif`;
    offCtx.textBaseline = "alphabetic";

    if (linhas.length > 0) {
        if (modo === "scroll") {
            const t  = linhas.join("   •   ");
            const y1 = calcY1Preview(valign, altLetra, false);
            drawTextWithAccents(t, scrollX, y1, corTxt);
            scrollX -= 1;
            if (scrollX < -(offCtx.measureText(t).width + 10)) scrollX = LED_COLS;

        } else if (modo === "slide") {
            const numTelas = Math.ceil(linhas.length / 2);
            const tela     = slideIndex % numTelas;
            const l1 = linhas[tela * 2]     || '';
            const l2 = linhas[tela * 2 + 1] || '';
            const dual = l2.length > 0;
            const y1 = calcY1Preview(valign, altLetra, dual);
            const y2 = y1 + altLetra + 2;

            const x1 = align === 'center'
                ? Math.max(0, Math.round((LED_COLS - offCtx.measureText(l1).width) / 2))
                : 1;
            drawTextWithAccents(l1, x1, y1, corTxt);

            if (dual) {
                const x2 = align === 'center'
                    ? Math.max(0, Math.round((LED_COLS - offCtx.measureText(l2).width) / 2))
                    : 1;
                drawTextWithAccents(l2, x2, y2, corTxt);
            }

        } else { // fixed
            const l1 = linhas[0] || '';
            const l2 = linhas[1] || '';
            const dual = l2.length > 0;
            const y1 = calcY1Preview(valign, altLetra, dual);
            const y2 = y1 + altLetra + 2;

            const x1 = align === 'center'
                ? Math.max(0, Math.round((LED_COLS - offCtx.measureText(l1).width) / 2))
                : 1;
            drawTextWithAccents(l1, x1, y1, corTxt);

            if (dual) {
                const x2 = align === 'center'
                    ? Math.max(0, Math.round((LED_COLS - offCtx.measureText(l2).width) / 2))
                    : 1;
                drawTextWithAccents(l2, x2, y2, corTxt);
            }
        }
    }

    // Renderiza LEDs no canvas principal
    const imgData = offCtx.getImageData(0, 0, LED_COLS, LED_ROWS).data;
    const dotOn  = LED_PX * 0.40;
    const dotOff = LED_PX * 0.14;

    ctx.shadowBlur = 0;
    for (let y = 0; y < LED_ROWS; y++) {
        for (let x = 0; x < LED_COLS; x++) {
            const idx = (y * LED_COLS + x) * 4;
            const a   = imgData[idx + 3];
            const px  = x * LED_PX + LED_PX / 2;
            const py  = y * LED_PX + LED_PX / 2;
            if (a > 32) {
                const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2];
                const bright = (r+g+b)/(3*255);
                const radius = dotOn * (0.6 + 0.4 * bright);
                ctx.shadowBlur  = radius * 1.8;
                ctx.shadowColor = corTxt;
                ctx.fillStyle   = `rgb(${r},${g},${b})`;
                ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI*2); ctx.fill();
                ctx.shadowBlur = 0;
            } else {
                ctx.fillStyle = "#1c1c1c";
                ctx.beginPath(); ctx.arc(px, py, dotOff, 0, Math.PI*2); ctx.fill();
            }
        }
    }
    requestAnimationFrame(loop);
}

// ===================== ENVIO MQTT =====================
function enviarMQTT() {
    if (!selectedDeviceId || !devicesStatus[selectedDeviceId] || !devicesStatus[selectedDeviceId].vermelho) {
        alert("Operação bloqueada: O painel deve estar no Vermelho."); return;
    }
    const conf = devicesMemory[selectedDeviceId][editingPhase];
    const hexToRgb = h => {
        const n = parseInt(h.replace('#',''), 16);
        return [(n>>16)&255, (n>>8)&255, n&255];
    };
    const listaMensagens = conf.text.split('\n').map(m => m.trim()).filter(x => x.length > 0);
    const payload = {
        target:    selectedDeviceId,
        alerta:    (editingPhase === 'red'),
        modo:      conf.modo,
        align:     conf.align  || 'center',
        valign:    conf.valign || 'center',
        mensagens: listaMensagens,
        tamanho:   parseInt(conf.tamanho),
        cor:       hexToRgb(conf.cor),
        corFundo:  hexToRgb(conf.fundo),
        velocidade: 5000
    };
    client.publish("painel_led/" + selectedDeviceId, JSON.stringify(payload), { qos: 0 });
    alert("Configuração enviada para: " + selectedDeviceId);
}

// ===================== UTILS =====================
const rgb565ToHex = c => {
    let r = ((c>>11)&0x1F)*255/31|0;
    let g = ((c>>5) &0x3F)*255/63|0;
    let b = ( c     &0x1F)*255/31|0;
    return "#"+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
};

setInterval(() => { slideIndex++; }, 5000);
requestAnimationFrame(loop);

// ===================== LIMITE DE 15 CARACTERES POR LINHA =====================
function limitarTexto() {
    const ta   = document.getElementById('msgInput');
    const info = document.getElementById('charInfo');
    const modo = document.getElementById('modoExibicao').value;
    const MAX  = 15;

    // No modo scroll não limita nem quebra — o texto rola livre
    if (modo === 'scroll') {
        const pos = ta.selectionStart;
        const ate  = ta.value.lastIndexOf('\n', pos - 1);
        const prox = ta.value.indexOf('\n', pos);
        const linhaAtual = ta.value.slice(
            ate === -1 ? 0 : ate + 1,
            prox === -1 ? undefined : prox
        );
        info.innerText = `${linhaAtual.length} chars (scroll — sem limite)`;
        info.style.color = '#888';
        updateMemory();
        return;
    }

    // Modos fixo e slide: máximo 15 chars por linha, quebra automática
    const linhas = ta.value.split('\n');
    const novas  = [];
    let alterou  = false;

    for (let i = 0; i < linhas.length; i++) {
        let linha = linhas[i];
        while (linha.length > MAX) {
            let corte = linha.lastIndexOf(' ', MAX);
            if (corte <= 0) corte = MAX;
            novas.push(linha.slice(0, corte).trimEnd());
            linha = linha.slice(corte).trimStart();
            alterou = true;
        }
        novas.push(linha);
    }

    if (alterou) {
        const pos = ta.selectionStart;
        ta.value = novas.join('\n');
        ta.selectionStart = ta.selectionEnd = Math.min(pos, ta.value.length);
    }

    // Contador da linha atual
    const pos  = ta.selectionStart;
    const ate  = ta.value.lastIndexOf('\n', pos - 1);
    const prox = ta.value.indexOf('\n', pos);
    const linhaAtual = ta.value.slice(
        ate === -1 ? 0 : ate + 1,
        prox === -1 ? undefined : prox
    );
    const tam = linhaAtual.length;
    info.innerText = `${tam}/15 chars na linha atual`;
    info.style.color = tam >= MAX ? '#ff3b30' : '#888';

    updateMemory();
}
