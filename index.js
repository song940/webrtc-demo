import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  DefaultPeerConnectionConfig as config,
} from 'https://lsong.org/scripts/webrtc.js';
import { ready } from 'https://lsong.org/scripts/dom.js';
import { format } from 'https://lsong.org/scripts/time.js';
import { getUserMedia } from 'https://lsong.org/scripts/media.js';

var localVideo, remoteVideo;
var localVideoStream = null;
var callButton, answerButton, endCallButton, sendButton, roomInput;

const uri = new URL(location.href);
const key = uri.searchParams.get('key');

// wss://broker.hivemq.com:8884
// wss://broker.emqx.io:8084/mqtt
const clientId = 'webrtc_' + Math.random().toString(16).substring(2, 8);
const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { clientId });

client.on('error', (err) => {
  console.debug('Connection error: ', err)
  client.end()
})

client.on('reconnect', () => {
  console.debug('Reconnecting...')
})

client.on('connect', () => {
  console.debug('Client connected:' + clientId);
  sendMessage({ type: 'join' });
  client.subscribe(`webrtc/${key}`);
});

client.on('message', (topic, data, packet) => {
  const message = JSON.parse(data);
  if (message.clientId === clientId) return;
  console.debug('Message:', topic, message);
  switch (message.type) {
    case 'join':
      callButton.disabled = false;
      break;
    case 'sdp':
      answerButton.disabled = false;
      const sdp = new RTCSessionDescription(message.sdp);
      pc.setRemoteDescription(sdp);
      break;
    case 'candidate':
      const candidate = new RTCIceCandidate(message.candidate);
      pc.addIceCandidate(candidate);
      break;
    case 'close':
      endCall();
      break;
  }
});

const sendMessage = data => {
  const topic = `webrtc/${key}`;
  const message = JSON.stringify({ ...data, clientId });
  const options = { qos: 0, retain: false };
  client.publish(topic, message, options);
};

const pc = new RTCPeerConnection(config);

// once remote stream arrives, show it in the remote video element
pc.addEventListener("iceconnectionstatechange", () => {
  console.debug("ice state:", pc.iceConnectionState);
  if (pc.iceConnectionState === 'connected') {
    callButton.disabled = true;
    answerButton.disabled = true;
    endCallButton.disabled = false;
  }
});

pc.addEventListener("signalingstatechange", () => {
  console.debug("signaling state:", pc.signalingState);
});

// send any ice candidates to the other peer
pc.addEventListener("icecandidate", e => {
  if (!e || !e.candidate) return;
  console.debug('candidate:', e.candidate);
  sendMessage({ type: "candidate", candidate: e.candidate });
});

pc.addEventListener("track", e => {
  console.debug("streams:", e.streams);
  remoteVideo.srcObject = e.streams[0];
});

const createMessage = message => {
  const li = document.createElement('li');
  const time = document.createElement('time');
  const content = document.createElement('span');
  time.textContent = format('{hh}:{mm}:{ss}');
  content.textContent = message;
  li.appendChild(time);
  li.appendChild(content);
  messages.appendChild(li);
};

const prepareChannel = channel => {
  console.debug("preparing channel", channel);
  channel.addEventListener('open', () => {
    sendButton.disabled = false;
  });
  channel.addEventListener('message', e => {
    const message = e.data;
    console.debug("received message", message);
    createMessage(message);
  });
  sendButton.addEventListener("click", () => {
    const text = message.value;
    if (!text) return;
    channel.send(text);
    message.value = '';
  });
};

pc.addEventListener("datachannel", e => {
  prepareChannel(e.channel);
});

export async function createAndSendOffer() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.debug("createOffer", offer);
  sendMessage({ type: "sdp", sdp: offer });
};

export async function createAndSendAnswer() {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  console.debug("createAnswer", answer);
  sendMessage({ type: "sdp", sdp: answer });
};

const openCameraAndAddStream = async () => {
  const video = {
    // facingMode: {
    //   exact: 'environment'
    // }
  };
  // get the local stream, show it in the local video element and send it
  const stream = await getUserMedia({ audio: true, video });
  localVideo.srcObject = localVideoStream = stream;
  // pc.addStream(localVideoStream);
  for (const track of localVideoStream.getTracks()) {
    pc.addTrack(track, localVideoStream);
  }
};

// run start(true) to initiate a call
export async function initiateCall() {
  console.debug("initiateCall");
  const channel = pc.createDataChannel('chat');
  prepareChannel(channel);
  await openCameraAndAddStream();
  createAndSendOffer();
};

async function answerCall() {
  console.debug("answerCall");
  await openCameraAndAddStream();
  createAndSendAnswer();
};

function endCall() {
  console.debug("endCall");
  pc.close();
  for (const track of localVideoStream.getTracks()) {
    track.stop();
  }
};

ready(async () => {
  callButton = document.getElementById("call");
  answerButton = document.getElementById("answer");
  endCallButton = document.getElementById("end");
  localVideo = document.getElementById('localVideo');
  remoteVideo = document.getElementById('remoteVideo');
  sendButton = document.getElementById('send');
  roomInput = document.getElementById('room');

  roomInput.value = key;
  callButton.addEventListener("click", initiateCall);
  answerButton.addEventListener("click", answerCall);
  endCallButton.addEventListener("click", () => {
    sendMessage({ type: 'close' });
    endCall();
  });
});
