const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

const deviceList = document.getElementById("deviceList");
const status = document.getElementById("status");

client.on("connect", function () {
  status.textContent = "✅ Conectado ao HiveMQ";

  // Subscreve aos tópicos
  client.subscribe("painel_led_test");
  client.subscribe("painel_led_dispositivos");
});

client.on("message", function (topic, message) {
  const msg = message.toString();

  if (topic === "painel_led_dispositivos") {
    // Adiciona o nome do dispositivo ao select, se não existir
    if (![...deviceList.options].some(opt => opt.value === msg)) {
      const opt = document.createElement("option");
      opt.value = msg;
      opt.textContent = msg;
      deviceList.appendChild(opt);
    }
  } else {
    status.textContent += `\n📩 ${topic} => ${msg}`;
  }
});

// Função hexToRgb permanece igual
function hexToRgb(hex) {
  const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return res
    ? { r: parseInt(res[1], 16), g: parseInt(res[2], 16), b: parseInt(res[3], 16) }
    : null;
}

// Função enviar() agora pega o painel selecionado
function enviar() {
  const brilho = parseInt(document.getElementById("input_Brightness").value);
  const cor = hexToRgb(document.getElementById("input_Color").value);
  const corFundo = hexToRgb(document.getElementById("input_Background").value);
  const tamanho = document.getElementById("input_Text_Size").value;
  const ypos = document.getElementById("input_Y_Position").value;
  const modo = document.getElementById("input_Mode").value;
  const velocidade = document.getElementById("input_Scrolling_Speed").value;
  const texto = document.getElementById("input_Scrolling_Text").value;
  const destino = deviceList.value; // pega o painel selecionado

  const msg = {
    destino: destino,
    brilho: brilho,
    cor: [cor.r, cor.g, cor.b],
    corFundo: [corFundo.r, corFundo.g, corFundo.b],
    tamanho: tamanho,
    ypos: ypos,
    modo: modo,
    velocidade: modo === "scroll" ? velocidade : 0,
    texto: texto,
  };

  client.publish("painel_led_test", JSON.stringify(msg));
  status.textContent += `\n📤 Enviado para ${destino}: ${JSON.stringify(msg)}`;
}
