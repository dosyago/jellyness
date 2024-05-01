const express = require('express');
const { Server } = require('ws');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { RTCPeerConnection, RTCSessionDescription } = require('@roamhq/wrtc');

const PORT = 8999;
const SSLCERTS_DIR = path.resolve(os.homedir(), 'sslcerts');
const app = express();

// SSL credentials
const options = {
  key: fs.readFileSync(path.resolve(SSLCERTS_DIR, 'privkey.pem')),
  cert: fs.readFileSync(path.resolve(SSLCERTS_DIR, 'fullchain.pem'))
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
      <h2>Jellyness</h2>
      <pre id="messages"></pre>
      <input type="text" id="messageBox" placeholder="Type a message...">
      <script>
        const ws = new WebSocket('wss://' + location.host);
        const pc = new RTCPeerConnection();
        let chatChannel;

        pc.onicecandidate = event => {
          if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
          }
        };

        pc.ondatachannel = event => {
          chatChannel = event.channel;
          chatChannel.onmessage = e => {
            document.getElementById('messages').textContent += \`\n\${e.data}\`;
          };
          chatChannel.onopen = () => console.log('Channel opened');
          chatChannel.onclose = () => console.log('Channel closed');
        };

        ws.onmessage = async ({data}) => {
          const msg = JSON.parse(data);
          if (msg.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
          } else if (msg.type === 'candidate') {
            await pc.addIceCandidate(msg.candidate);
          }
        };

        document.getElementById('messageBox').addEventListener('keypress', function(e) {
          if (e.key === 'Enter' && chatChannel) {
            if (this.value.startsWith('/name ')) {
              nickname = this.value.split(' ')[1];
              document.getElementById('messages').textContent += \`\nName changed to \${nickname}\`;
            } else {
              chatChannel.send(this.value);
            }
            this.value = '';
          }
        });
      </script>
    </body>
    </html>
  `);
});

let adminChannel = null;
const peers = {};

wss.on('connection', function(ws) {
  const id = Date.now();
  const pc = new RTCPeerConnection();
  let nickname = `User${id}`;

  peers[id] = { ws, pc, nickname };

  pc.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };

  const channel = pc.createDataChannel('chat');
  channel.onmessage = event => {
    console.log(`${nickname}: ${event.data}`);
    broadcastMessage(`${nickname}: ${event.data}`, id);
  };
  channel.onopen = () => {
    console.log(`Data channel with ${id} opened`);
    peers[id].channel = channel;
  };
  channel.onclose = () => console.log(`Data channel with ${id} closed`);

  ws.on('message', async message => {
    const data = JSON.parse(message);
    console.log(data);
    switch (data.type) {
      case 'offer':
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
        break;
      case 'candidate':
        if (data.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
        break;
      case 'bye':
        pc.close();
        break;
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket with ${id} closed`);
    pc.close();
    delete peers[id];
  });
});

server.listen(PORT, () => {
  console.log(`Secure server running on https://localhost:${PORT}`);
});

// Broadcast message to all users
function broadcastMessage(message, senderId) {
  Object.keys(peers).forEach(id => {
    if (peers[id].channel && peers[id].channel.readyState === 'open' && id != senderId) {
      peers[id].channel.send(message);
    }
  });
}

// Admin REPL to interact with connected users
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'ADMIN> '
});

rl.prompt();
rl.on('line', line => {
  if (line.startsWith('/name ')) {
    const newName = line.split(' ')[1];
    console.log(`Admin name changed to ${newName}`);
  } else {
    broadcastMessage(`*Admin: ${line}`, null);
  }
  rl.prompt();
});

