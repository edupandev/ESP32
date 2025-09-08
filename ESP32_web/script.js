// ===== Conectar no HiveMQ MQTT Broker =====
const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

client.on("connect", function () {
  document.getElementById("status").textContent = "✅ Conectado ao HiveMQ";
  client.subscribe("painel_led_test");
});

client.on("message", function (topic, message) {
  document.getElementById("status").textContent +=
    "\n📩 " + topic + " => " + message.toString();
});

// Converte #hex para RGB
function hexToRgb(hex) {
  const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return res
    ? {
        r: parseInt(res[1], 16),
        g: parseInt(res[2], 16),
        b: parseInt(res[3], 16),
      }
    : null;
}

// Envia comando MQTT
function enviar() {
  const brilho = parseInt(document.getElementById("input_Brightness").value);
  const cor = hexToRgb(document.getElementById("input_Color").value);
  const tamanho = document.getElementById("input_Text_Size").value;
  const ypos = document.getElementById("input_Y_Position").value;
  const velocidade = document.getElementById("input_Scrolling_Speed").value;
  const texto = document.getElementById("input_Scrolling_Text").value;

  const msg = {
    brilho: brilho,
    cor: [cor.r, cor.g, cor.b],
    tamanho: tamanho,
    ypos: ypos,
    velocidade: velocidade,
    texto: texto,
  };

  client.publish("painel_led_test", JSON.stringify(msg));
  document.getElementById("status").textContent +=
    "\n📤 Enviado: " + JSON.stringify(msg);
}
