// --- WebSocket-Verbindung aufbauen ---
const socket = new WebSocket('wss://nosch.uber.space/web-rooms/');
let clientId = null;
let balance = 10000;
let isHost = false;
let gameState = "waiting";
let hasBetThisRound = false;
let bets = [];

const colorsSequence = Array(32).fill().map((_, i) => i % 2 === 0 ? 'black' : 'red');

const colorGerman = { red: 'Rot', black: 'Schwarz' };
const colorEmojis = { red: '🔴', black: '⚫' };

const clientIdSpan = document.getElementById('client-id');
const balanceSpan = document.getElementById('balance');
const betColor = document.getElementById('bet-color');
const betAmount = document.getElementById('bet-amount');
const placeBetBtn = document.getElementById('place-bet');
const spinBtn = document.getElementById('spin-button');
const hostSection = document.getElementById('host-section');
const resultDisplay = document.getElementById('result-display');


// --- Bei Verbindungsaufbau dem Raum beitreten ---
socket.addEventListener('open', () => {
  send('*enter-room*', 'roulette-room');
  resultDisplay.textContent = 'Verbunden! Warte auf Spieler-ID...';
});

function send(...msg) {
  socket.send(JSON.stringify(msg));
}


// --- Empfangene Nachrichten verarbeiten ---
socket.addEventListener('message', (event) => {
  const incoming = JSON.parse(event.data);
  const type = incoming[0];

// Je nach Nachrichtentyp verschiedene Aktionen
  switch (type) {
    case '*client-id*':
      clientId = incoming[1];
      clientIdSpan.textContent = clientId;
      balanceSpan.textContent = balance;

      if (clientId == 0) {
        isHost = true;
        hostSection.style.display = 'block';
        resultDisplay.textContent = '🎯 Du bist der Host! Warte auf Wetten...';
      } else {
        resultDisplay.textContent = '🎲 Bereit zum Spielen! Platziere deine Wette.';
      }

      const extendedSequence = [...colorsSequence, ...colorsSequence, ...colorsSequence];
      document.getElementById('strip-inner').innerHTML = extendedSequence.map((c, index) => {
        return `<div class="slot ${c}" data-color="${c}" data-index="${index}" id="slot-${index}">${colorEmojis[c]}</div>`;
      }).join('');
      break;

    case 'bet': {
      const [_, id, color, amount] = incoming;
      bets.push({ id, color, amount });

      if (isHost) {
        resultDisplay.textContent = `💰 Spieler ${id} hat ${amount} auf ${colorGerman[color]} gesetzt`;
      }

      // Zeige dem Spieler seine eigene Wette an
      if (id === clientId) {
        resultDisplay.textContent = `📝 Du hast ${amount} auf ${colorGerman[color]} gesetzt`;
        placeBetBtn.disabled = true;
      }

      break;
    }

    case 'result': {
      const [_, color, animationSeed] = incoming;
      animateRouletteStrip(color, animationSeed);
      break;
    }

    case 'outcome': {
      const [_, id, status, payout] = incoming;
      handleOutcomeLocally(id, status, payout);
      break;
    }

    case 'new-round': {
      gameState = "waiting";
      hasBetThisRound = false;
      if (balance > 0) placeBetBtn.disabled = false;
      resultDisplay.textContent = `🌀 Neue Runde gestartet – setze deine Wette!`;
      break;
    }

    default:
      console.log("Empfangen:", incoming);
  }
});


// --- Animation des Roulette-Streifens ---
function animateRouletteStrip(winningColor, animationSeed) {
  const stripInner = document.getElementById('strip-inner');
  stripInner.style.transition = 'none';
  stripInner.style.left = '0px';
  void stripInner.offsetWidth;

  const extendedSequence = [...colorsSequence, ...colorsSequence, ...colorsSequence];
  const middleStart = colorsSequence.length;

  const matchingIndices = [];
  for (let i = middleStart; i < middleStart * 2; i++) {
    if (extendedSequence[i] === winningColor) {
      matchingIndices.push(i);
    }
  }

  const slotWidth = 80;
  const pointerPosition = 250;
  const targetIndex = matchingIndices[animationSeed % matchingIndices.length];
  const finalOffset = (targetIndex * slotWidth + slotWidth / 2) - pointerPosition;

  stripInner.style.transition = 'left 3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  stripInner.style.left = `-${finalOffset}px`;
  resultDisplay.textContent = `🎲 Das Rad dreht sich...`;

  setTimeout(() => {
    const finalLeft = parseFloat(getComputedStyle(stripInner).left);
    const centerIndex = Math.round((-finalLeft + pointerPosition) / slotWidth);
    const slots = document.querySelectorAll('.slot');
    const centerSlot = slots[centerIndex];

    if (centerSlot) {
      const actualColor = centerSlot.dataset.color;
      console.log(`✅ Animation beendet: Erwartet: ${winningColor}, Tatsächlich: ${actualColor}`);
      resultDisplay.textContent = `🎉 Ergebnis: ${colorGerman[actualColor]} ${colorEmojis[actualColor]}`;

      if (isHost) {
        evaluateBets(actualColor);
      }
    }
  }, 3100);
}


// --- Gewinn-/Verlustberechnung durch den Host ---
function evaluateBets(winningColor) {
  bets.forEach(bet => {
    const won = bet.color === winningColor;
    const payout = won ? bet.amount * 2 : 0;

    if (bet.id === clientId) {
      handleOutcomeLocally(bet.id, won ? 'win' : 'lose', payout);
    } else {
      send('*broadcast-message*', ['outcome', bet.id, won ? 'win' : 'lose', payout]);
    }
  });

  setTimeout(() => {
    bets = [];
    send('*broadcast-message*', ['new-round']);

    gameState = "waiting";
    hasBetThisRound = false;
    if (balance > 0) placeBetBtn.disabled = false;
    resultDisplay.textContent = `🌀 Neue Runde gestartet – setze deine Wette!`;
  }, 4000);
}

function handleOutcomeLocally(id, status, payout) {
  if (id !== clientId) return;

  if (status === 'win') {
    balance += payout;
    resultDisplay.textContent += ` – Du gewinnst ${payout}! 🎉`;
  } else {
    resultDisplay.textContent += ` – Du hast verloren 😢`;
  }

  balanceSpan.textContent = balance;
}

placeBetBtn.addEventListener('click', () => {
  if (gameState !== "waiting") return;
  if (hasBetThisRound) return;

  const color = betColor.value;
  const amount = parseInt(betAmount.value);

  if (amount > balance || amount <= 0) return;

  balance -= amount;
  balanceSpan.textContent = balance;

  hasBetThisRound = true;

  const betMsg = ['bet', clientId, color, amount];
  send('*broadcast-message*', betMsg);

  // Host verarbeitet eigene Wette sofort lokal
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(betMsg) }));
});

spinBtn.addEventListener('click', () => {
  if (!isHost || gameState !== "waiting") return;

  gameState = "spinning";
  placeBetBtn.disabled = true;
  spinBtn.disabled = true;

  const colors = ['red', 'black'];
  const result = colors[Math.floor(Math.random() * colors.length)];
  const animationSeed = Math.floor(Math.random() * 10000);

  send('*broadcast-message*', ['result', result, animationSeed]);
  animateRouletteStrip(result, animationSeed);

  setTimeout(() => {
    spinBtn.disabled = false;
  }, 7000);
});

socket.addEventListener('close', () => {
  resultDisplay.textContent = '❌ Verbindung zum Server verloren!';
});

socket.addEventListener('error', (error) => {
  resultDisplay.textContent = '❌ Websocket-Fehler!';
});
