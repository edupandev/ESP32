const browserId = "WEB_" + Math.random().toString(16).slice(2, 8);
let editingPhase = 'red', slideIndex = 0, scrollX = 400, map;
let markers = {}, devicesStatus = {}, devicesLastSeen = {}, selectedDeviceId = null;
let mapInitialized = false; 

const canvas = document.getElementById('p10Canvas');
const ctx = canvas.getContext('2d');

let devicesMemory = {}; 

// Carrega memória local se existir
if(localStorage.getItem('pmv_multi_v1')) {
    devicesMemory = JSON.parse(localStorage.getItem('pmv_multi_v1'));
}

// Utilitário para converter cores do hardware para HEX
const rgb565ToHex = (color565) => {
    let r = (color565 >> 11) & 0x1F;
    let g = (color565 >> 5) & 0x3F;
    let b = color565 & 0x1F;
    r = Math.round(r * 255 / 31);
    g = Math.round(g * 255 / 63);
    b = Math.round(b * 255 / 31);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

// Conexão MQTT via WebSocket
const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

client.on('connect', () => { 
    console.log("Conectado ao Broker MQTT");
    client.subscribe("painel_led_status"); 
    client.subscribe("painel_led_sync"); 
    client.subscribe("auth/response");
});

client.on('message', (topic, message) => {
    // Lógica de Autenticação
    if (topic === "auth/response") {
        try {
            const res = JSON.parse(message.toString());
            if (res.id === browserId) {
                if (res.status === "success") {
                    document.getElementById('login-screen').style.display = 'none';
                    if (!map) {
                        map = L.map('map', {zoomControl: false}).setView([0, 0], 2);
                        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);
                    }
                } else {
                    alert("Acesso Negado: " + (res.reason || "Credenciais inválidas"));
                    document.getElementById('btnLogin').disabled = false;
                    document.getElementById('btnLogin').innerText = "ENTRAR";
                }
            }
        } catch (e) { console.error("Erro Auth:", e); }
    }

    // Status em Tempo Real dos Dispositivos
    if (topic === "painel_led_status") {
        try {
            const data = JSON.parse(message.toString());
            const id = data.dispositivo || "PMV-Desconhecido";
            devicesLastSeen[id] = Date.now();
            devicesStatus[id] = data;

            if (!devicesMemory[id]) {
                devicesMemory[id] = {
                    red: { text: "PARE\nOBRAS", modo: "fixed", tamanho: "2", cor: "#ff0000", fundo: "#000000" },
                    green: { text: "SIGA\nLIVRE", modo: "slide", tamanho: "2", cor: "#00ff00", fundo: "#000000" }
                };
            }

            updateDeviceOnMap(id, data);
            if (selectedDeviceId === id) refreshUIElements(data);
        } catch (e) { console.error("Erro Status:", e); }
    }

    // Sincronização de configurações do hardware
    if (topic === "painel_led_sync") {
        try {
            const syncData = JSON.parse(message.toString());
            const id = syncData.target;
            if (id) {
                devicesMemory[id] = {
                    red: {
                        text: syncData.mensagensRed.join('\n'),
                        modo: syncData.r_modo,
                        tamanho: String(syncData.r_tam),
                        cor: rgb565ToHex(syncData.r_cor),
                        fundo: "#000000"
                    },
                    green: {
                        text: syncData.mensagensGreen.join('\n'),
                        modo: syncData.g_modo,
                        tamanho: String(syncData.g_tam),
                        cor: rgb565ToHex(syncData.g_cor),
                        fundo: "#000000"
                    }
                };
                localStorage.setItem('pmv_multi_v1', JSON.stringify(devicesMemory));
                if (selectedDeviceId === id) renderForm();
            }
        } catch (e) { console.error("Erro Sync:", e); }
    }
});

function logar() {
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    if (!user || !pass) { alert("Preencha usuário e senha!"); return; }
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnLogin').innerText = "AUTENTICANDO...";
    const authPayload = { id: browserId, user: user, pass: pass };
    client.publish("auth/request", JSON.stringify(authPayload));
}

function updateDeviceOnMap(id, data) {
    if (!map) return;

    if (!markers[id]) {
        markers[id] = L.circleMarker([data.lat, data.lng], {
            radius: 12, fillColor: "#007bff", color: "#fff", weight: 3, opacity: 1, fillOpacity: 0.9
        }).addTo(map);

        markers[id].on('click', () => {
            selectedDeviceId = id;
            document.getElementById('control-panel').style.display = 'block';
            renderForm(); 
            refreshUIElements(data);
        });
    }
    
    markers[id].setLatLng([data.lat, data.lng]);

    if (!mapInitialized) {
        map.setView([data.lat, data.lng], 15);
        mapInitialized = true;
    } else if (selectedDeviceId === id) {
        map.panTo(new L.LatLng(data.lat, data.lng));
    }
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

function renderForm() {
    if (!selectedDeviceId || !devicesMemory[selectedDeviceId]) return;
    const config = devicesMemory[selectedDeviceId][editingPhase];
    document.getElementById('msgInput').value = config.text;
    document.getElementById('modoExibicao').value = config.modo;
    document.getElementById('fSize').value = config.tamanho;
    document.getElementById('tColor').value = config.cor;
    document.getElementById('bgColor').value = config.fundo;
    document.getElementById('selectRed').className = 'state-btn' + (editingPhase === 'red' ? ' btn-editing-red' : '');
    document.getElementById('selectGreen').className = 'state-btn' + (editingPhase === 'green' ? ' btn-editing-green' : '');
}

function updateMemory() {
    if (!selectedDeviceId) return;
    devicesMemory[selectedDeviceId][editingPhase] = {
        text: document.getElementById('msgInput').value,
        modo: document.getElementById('modoExibicao').value,
        tamanho: document.getElementById('fSize').value,
        cor: document.getElementById('tColor').value,
        fundo: document.getElementById('bgColor').value
    };
    localStorage.setItem('pmv_multi_v1', JSON.stringify(devicesMemory));
}

function setEditingPhase(p) { editingPhase = p; scrollX = 400; renderForm(); }
function fecharPainel() { document.getElementById('control-panel').style.display = 'none'; selectedDeviceId = null; }

// Verificação de timeout (Offline)
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

// Motor de Renderização do Preview (Simulação P10)
function loop() {
    if (selectedDeviceId && devicesMemory[selectedDeviceId]) {
        const conf = devicesMemory[selectedDeviceId][editingPhase];
        const mensagens = conf.text.split('\n').filter(x => x.length > 0);
        
        ctx.fillStyle = "#0a0a0a"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const logicWidth = 100, logicHeight = 50;
        const step = canvas.width / logicWidth; 

        const offCanvas = document.createElement('canvas');
        offCanvas.width = logicWidth; offCanvas.height = logicHeight;
        const offCtx = offCanvas.getContext('2d');
        
        if (mensagens.length > 0) {
            offCtx.fillStyle = conf.cor; 
            offCtx.textBaseline = "middle"; 
            offCtx.textAlign = "left";
            let size = conf.tamanho == "1" ? 12 : conf.tamanho == "3" ? 24 : 18;
            offCtx.font = `bold ${size}px Arial`;
            const marginX = 4, centroY = logicHeight / 2;

            if (conf.modo === "scroll") {
                const t = mensagens.join("   -   ");
                offCtx.fillText(t, scrollX, centroY);
                scrollX -= 1.5; 
                if (scrollX < -offCtx.measureText(t).width) scrollX = logicWidth;
            } else if (conf.modo === "slide") {
                offCtx.fillText(mensagens[slideIndex % mensagens.length], marginX, centroY);
            } else {
                if (mensagens.length === 1) { 
                    offCtx.fillText(mensagens[0], marginX, centroY); 
                } else {
                    const subSize = size * 0.85; 
                    offCtx.font = `bold ${subSize}px Arial`;
                    const spacing = subSize * 0.6; 
                    offCtx.fillText(mensagens[0], marginX, centroY - spacing);
                    offCtx.fillText(mensagens[1], marginX, centroY + spacing);
                }
            }
        }

        const imgData = offCtx.getImageData(0, 0, logicWidth, logicHeight).data;
        for (let y = 0; y < logicHeight; y++) {
            for (let x = 0; x < logicWidth; x++) {
                const index = (y * logicWidth + x) * 4;
                const alpha = imgData[index + 3];
                const posX = x * step + step/2, posY = y * step + step/2;
                if (alpha > 128) {
                    ctx.shadowBlur = step * 0.5; ctx.shadowColor = conf.cor; ctx.fillStyle = conf.cor;
                    ctx.beginPath(); ctx.arc(posX, posY, step * 0.35, 0, Math.PI * 2); ctx.fill();
                } else {
                    ctx.shadowBlur = 0; ctx.fillStyle = "#1a1a1a";
                    ctx.beginPath(); ctx.arc(posX, posY, step * 0.15, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
    }
    requestAnimationFrame(loop);
}

function enviarMQTT() {
    if (!selectedDeviceId || !devicesStatus[selectedDeviceId].vermelho) {
        alert("Operação bloqueada: O painel deve estar no Vermelho."); return;
    }
    const conf = devicesMemory[selectedDeviceId][editingPhase];
    const hexToRgb = (h) => {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const listaMensagens = conf.text.split('\n').map(m => m.trim()).filter(x => x.length > 0);
    const payload = {
        target: selectedDeviceId, 
        alerta: (editingPhase === 'red'), 
        modo: conf.modo,
        mensagens: listaMensagens, 
        tamanho: parseInt(conf.tamanho),
        cor: hexToRgb(conf.cor), 
        corFundo: hexToRgb(conf.fundo), 
        velocidade: 2000
    };
    client.publish("painel_led/" + selectedDeviceId, JSON.stringify(payload), { qos: 0 });
    alert("Configuração enviada para: " + selectedDeviceId);
}

setInterval(() => { slideIndex++; }, 2000);
requestAnimationFrame(loop);
