const express = require('express');
const { Server } = require('ws');
const https = require('https');
const fs = require('fs');
const readline = require('readline');

const SSLCERTS_DIR = path.resolve(os.homedir(), 'sslcerts');
const app = express();

// SSL credentials
const options = {
  key: fs.readFileSync(path.resolve(SSLCERTS_DIR, 'server.key')),
  cert: fs.readFileSync(path.resolve(SSLCERTS_DIR, 'server.cert'))
};

const server = https.createServer(options, app);
const wss = new Server({ server });

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Jellyness - WebRTC Chat</title>
    </head>
    <body>
      <h2>WebRTC Chat</h2>
      <pre id="messages"></pre>
      <input type="text" id="messageBox" placeholder="Type a message...">
      <script>
        const ws = new WebSocket('ws://' + location.host);
        const messages = document.getElementById('messages');
        const messageBox = document.getElementById('messageBox');

        ws.onmessage = ({ data }) => {
          messages.textContent += \`\n${data}\`;
        };

        messageBox.onkeypress = (e) => {
          if (e.key === 'Enter') {
            ws.send(messageBox.value);
            messageBox.value = '';
          }
        };
      </script>
    </body>
    </html>
  `);
});

let adminId = null;
const peers = new Map();

wss.on('connection', function(ws) {
  const id = Date.now();
  let nickname = `User${id}`;

  console.log(`Secure connection received: ${id}`);
  peers.set(id, { ws, nickname });

  ws.on('message', function(message) {
    console.log(`Received: ${message} from ${nickname}`);

    if (message.startsWith('/name ')) {
      const newName = message.split(' ')[1];
      peers.get(id).nickname = newName;
      ws.send(`Name changed to ${newName}`);
      return;
    }

    const formattedMessage = `${id === adminId ? '*' : ''}${nickname}: ${message}`;
    for (let [peerId, peer] of peers) {
      if (peer.ws.readyState === ws.OPEN) {
        peer.ws.send(formattedMessage);
      }
    }
  });

  ws.on('close', () => {
    peers.delete(id);
    console.log(`Connection closed: ${id}`);
  });
});

// REPL for command line interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'talk> '
});

adminId = Date.now();  // Assigning admin ID on start
peers.set(adminId, { ws: null, nickname: 'Admin' });

rl.prompt();

rl.on('line', (line) => {
  if (line.startsWith('/name ')) {
    const newName = line.split(' ')[1];
    peers.get(adminId).nickname = newName;
    console.log(`Admin name changed to ${newName}`);
    rl.prompt();
    return;
  }

  const message = `*${peers.get(adminId).nickname}: ${line}`;
  for (let [id, peer] of peers) {
    if (peer.ws && peer.ws.readyState === peer.ws.OPEN) {
      peer.ws.send(message);
    }
  }
  rl.prompt();
});

server.listen(8999, () => {
  console.log('Secure server running on https://localhost:3000');
});

