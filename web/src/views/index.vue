<script setup>
import { reactive, onMounted, ref } from "vue";
import { io } from "socket.io-client";
import { ElMessage } from "element-plus";
import FingerprintJS from '@fingerprintjs/fingerprintjs';
const fpPromise = FingerprintJS.load()
let serverSocketUrl = "wss://iambigchen.cloud/so"
// let serverSocketUrl = "ws://localhost:18080/so"
var PeerConnection =
  window.RTCPeerConnection ||
  window.mozRTCPeerConnection ||
  window.webkitRTCPeerConnection;
var rtcPcParams = {
    iceTransportPolicy: 'relay', //强制走中继
    iceServers: [
        {urls: 'stun:iambigchen.cloud:3478', username: 'suke', credential:'suke119119'}
    ]
}
let localStream = null;
let linkSocket = null;
let RtcPcMaps = new Map();
let ChannelMaps = new Map();
const isShare = ref(false);
const message = ref('')
const messageList = ref([])
const localDevice = reactive({
  audioIn: [],
  videoIn: [],
  audioOut: [],
});
const mediaStatus = reactive({
    video: true,
    audio: true
})
const roomUserList = ref([]);

const userInfo = reactive({
  userId: "1",
  roomId: "1",
  nickname: "1",
});


fpPromise.then(e => {
    return e.get()
}).then(result => {
    userInfo.userId = result.visitorId
})

const selectDevice = reactive({
  audioIn: {},
  videoIn: {},
  audioOut: {},
});

onMounted(() => {
  initInnerLocalDevice();
});

function sendMessageUserRtcChannel () {
    for(const [key, channel] of ChannelMaps) {
        channel.send(message.value)
    }
    messageList.value.push({
        name: userInfo.nickname,
        message: message.value
    })
}

function link() {
  linkSocket = io(serverSocketUrl, {
    reconnectionDelayMax: 10000,
    transports: ["websocket"],
    query: {
      userId: userInfo.userId,
      roomId: userInfo.roomId,
      nickname: userInfo.nickname,
    },
  });
  linkSocket.on("connect", (e) => {
    console.log("server init connect success", linkSocket);
    linkSocket.emit("roomUserList", {
      roomId: userInfo.roomId,
    });
  });
  linkSocket.on("roomUserList", (e) => {
    console.log("roomUserList", e);
    roomUserList.value = e;
    initMeetingRoomPc();
  });
  linkSocket.on("msg", async (e) => {
    console.log("msg", e);
    if (e["type"] === "join" || e["type"] === "leave") {
      const userId = e["data"]["userId"];
      const nickname = e["data"]["nickname"];
      if (e["type"] === "join" && userId !== userInfo.userId) {
        ElMessage.success(nickname + " 加入房间");
        roomUserList.value.push({
          userId: userId,
          nickname: nickname,
          roomId: userInfo.roomId,
        });
      } else if (e["type"] === "leave" && userId !== userInfo.userId) {
        ElMessage.success(nickname + " 离开房间");
        RtcPcMaps.delete(userInfo.userId + "-" + userId);
        removeChildVideoDom(userId);
      }
    }
    if (e["type"] === "call") {
    }
    if (e["type"] === "offer") {
      await onRemoteOffer(e["data"]["userId"], e["data"]["offer"]);
    }
    if (e["type"] === "answer") {
      await onRemoteAnswer(e["data"]["userId"], e["data"]["answer"]);
    }
    if (e["type"] === "candidate") {
      onCandiDate(e["data"]["userId"], e["data"]["candidate"]);
    }
  });
  linkSocket.on("error", (e) => {
    console.log("error", e);
  });
}

function onCandiDate(fromUid, candidate) {
  const localUid = userInfo.userId;
  let pcKey = localUid + "-" + fromUid;
  let pc = RtcPcMaps.get(pcKey);
  pc.addIceCandidate(candidate);
}


async function onRemoteOffer(fromUid, offer) {
  const localUid = userInfo.userId;
  let pcKey = localUid + "-" + fromUid;
  let pc = RtcPcMaps.get(pcKey);
  if (!pc) {
    pc = new PeerConnection(rtcPcParams);
    RtcPcMaps.set(pcKey, pc);
  }
  onPcEvent(pc, localUid, fromUid);
  await createDataChannel(pc,localUid,fromUid)
  for (const track of localStream.getTracks()) {
    pc.addTrack(track);
  }
  await pc.setRemoteDescription(offer);
  let answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  let params = { targetUid: fromUid, userId: localUid, answer: answer };
  linkSocket.emit("answer", params);
}

async function onRemoteAnswer(fromUid, answer) {
  const localUid = userInfo.userId;
  let pcKey = localUid + "-" + fromUid;
  let pc = RtcPcMaps.get(pcKey);
  await pc.setRemoteDescription(answer);
}

async function createDataChannel(pc,localUid,remoteUid) {
    let datachannel = await pc.createDataChannel(localUid+'-'+remoteUid);
    console.log("datachannel "+localUid+'-'+remoteUid,datachannel)
    ChannelMaps.delete(localUid+'-'+remoteUid)
    ChannelMaps.set(localUid+'-'+remoteUid,datachannel)
}

async function onPcEvent(pc, localUid, remoteUid) {
  pc.ontrack = function (event) {
    console.log("ontrack", event);
    createRemoteDomVideoStream(remoteUid, event.track);
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      linkSocket.emit("candidate", {
        targetUid: remoteUid,
        userId: localUid,
        candidate: event.candidate,
      });
    } else {
      /* 在此次协商中，没有更多的候选了 */
      console.log("在此次协商中，没有更多的候选了");
    }
  };
  pc.ondatachannel = function (ev) {
    console.log("Data channel is created!");
    ev.channel.onopen = function () {
      console.log("Data channel ------------open----------------");
    };
    ev.channel.onmessage = function (data) {
      console.log("Data channel ------------msg----------------", data);
      const label = data.target.label
      const message = data.data
      const senderId = label.split('-')[0]
      const user = roomUserList.value.filter(e => {
        return e.userId === senderId
      })[0]
      messageList.value.push({
        name: user.nickname,
        message: message
      })
    };
    ev.channel.onclose = function () {
      console.log("Data channel ------------close----------------");
    };
    ev.channel.onerror = function (err) {
        console.log(`-----err----`, err)
    }
  };
}

function removeChildVideoDom(domId) {
  let video = document.getElementById(domId + "-media");
  if (video) {
    video.parentNode.removeChild(video);
  }
}

function createRemoteDomVideoStream(domId, trick) {
  let parentDom = document.getElementById("userList");
  let id = domId + "-media";
  let video = document.getElementById(id);
  if (!video) {
    video = document.createElement("video");
    video.id = id;
    video.controls = false;
    video.autoplay = true;
    video.muted = false;
    video.style.width = "100%";
    video.style.height = "200px";
  }
  let stream = video.srcObject;
  console.log("stream==>trick", stream, trick);
  if (stream) {
    stream.addTrack(trick);
  } else {
    let newStream = new MediaStream();
    newStream.addTrack(trick);
    video.srcObject = newStream;
    video.muted = true;
    parentDom.appendChild(video);
  }
}

function initMeetingRoomPc() {
  const userIds = roomUserList.value
    .filter((e) => e.userId !== userInfo.userId)
    .map((e) => e.userId);
  userIds.forEach(async (uid) => {
    let pcKey = `${userInfo.userId}-${uid}`;
    let pc = RtcPcMaps.get(pcKey);
    if (!pc) {
      pc = new PeerConnection(rtcPcParams);
      RtcPcMaps.set(pcKey, pc);
    }
    for (const track of localStream.getTracks()) {
      pc.addTrack(track);
    }
    await createDataChannel(pc,userInfo.userId,uid)
    let offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    let params = { targetUid: uid, userId: userInfo.userId, offer: offer };
    linkSocket.emit("offer", params);
    onPcEvent(pc, userInfo.userId, uid);
  });
}
function enterRoom() {
  link();
}

function initInnerLocalDevice() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    alert("浏览器不支持获取媒体设备");
    return;
  }
  let constraints = { video: true, audio: true };
  navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    stream.getTracks().forEach((trick) => {
      trick.stop();
    });
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      devices.forEach((device) => {
        let obj = {
          id: device.deviceId,
          kind: device.kind,
          label: device.label,
        };
        if (device.kind === "audioinput") {
          if (
            localDevice.audioIn.filter((e) => e.id === device.deviceId)
              .length === 0
          ) {
            localDevice.audioIn.push(obj);
            if (!selectDevice.audioIn.id) {
              selectDevice.audioIn = obj;
            }
          }
        }
        if (device.kind === "audiooutput") {
          if (
            localDevice.audioOut.filter((e) => e.id === device.deviceId)
              .length === 0
          ) {
            localDevice.audioOut.push(obj);
            if (!selectDevice.audioOut.id) {
              selectDevice.audioOut = obj;
            }
          }
        } else if (device.kind === "videoinput") {
          if (
            localDevice.videoIn.filter((e) => e.id === device.deviceId)
              .length === 0
          ) {
            localDevice.videoIn.push(obj);
            if (!selectDevice.videoIn.id) {
              selectDevice.videoIn = obj;
            }
          }
        }
      });
      sure();
    });
  });
}

async function getLocalUserMedia(constraints) {
  return await navigator.mediaDevices.getUserMedia(constraints);
}

async function getTargetDeviceMedia(videoId, audioId) {
  const constraints = {
    audio: { deviceId: audioId ? { exact: audioId } : undefined },
    video: {
      deviceId: videoId ? { exact: videoId } : undefined,
      width: 1080,
      height: 720,
      frameRate: { ideal: 24, max: 24 },
    },
  };
  if (window.stream) {
    window.stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
  return await getLocalUserMedia(constraints).catch(handleError);
}

async function getShareMedia() {
  const constraints = {
    video: { width: 1920, height: 1080 },
    audio: false,
  };
  if (window.stream) {
    window.stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
  return await navigator.mediaDevices
    .getDisplayMedia(constraints)
    .catch(handleError);
}

function audioControl(b){
    RtcPcMaps.forEach((v,k) => {
        const senders = v.getSenders();
        const send = senders.find((s) => s.track.kind === 'audio')
        send.track.enabled = b
        mediaStatus.audio = send.track.enabled
    })
    localStream.getAudioTracks()[0].enabled = b
    mediaStatus.audio = b
}
function videoControl(b){
    RtcPcMaps.forEach((v,k) => {
        const senders = v.getSenders();
        const send = senders.find((s) => s.track.kind === 'video')
        send.track.enabled = b
        mediaStatus.video = send.track.enabled
    })
    localStream.getVideoTracks()[0].enabled = b
    mediaStatus.video = b
}

async function sure() {
  let video = document.getElementById("video");
  let stream = video.srcObject;
  if (stream) {
    stream.getAudioTracks().forEach((e) => {
      stream.removeTrack(e);
    });
    stream.getVideoTracks().forEach((e) => {
      stream.removeTrack(e);
    });
  }
  if (localStream) {
      localStream.getTracks().forEach((e) => e.stop());
  }


  localStream = await getTargetDeviceMedia(
    selectDevice.videoIn.id,
    selectDevice.audioIn.id
  );


  for (const [key, localRtcPc] of RtcPcMaps) {
    if (localRtcPc) {
      const senders = localRtcPc.getSenders();
      const sendVideo = senders.find((s) => s.track.kind === "video");
      const sendAudio = senders.find((s) => s.track.kind === "audio");
      for (const track of localStream.getVideoTracks()) {
        sendVideo.replaceTrack(track);
      }
      for (const track of localStream.getAudioTracks()) {
        sendAudio.replaceTrack(track);
      }
    }
  }
  video.srcObject = localStream;
  video.muted = true;
}
async function share() {
  isShare.value = !isShare.value;
  let newStream;
  if (isShare.value) {
    newStream = await getShareMedia();
  } else {
    newStream = await getTargetDeviceMedia(
      selectDevice.videoIn.id,
      selectDevice.audioIn.id
    );
  }
  localStream.getTracks().forEach((e) => e.stop());
  for (const [key, localRtcPc] of RtcPcMaps) {
    if (localRtcPc) {
      const senders = localRtcPc.getSenders();
      const send = senders.find((s) => s.track.kind === "video");
      for (const track of newStream.getVideoTracks()) {
        send.replaceTrack(track);
      }
    }
  }
  localStream = newStream;
  let video = document.getElementById("video");
  video.srcObject = localStream;
  video.muted = true;
}
function handleError(error) {
  alert("摄像头无法正常使用，请检查是否占用或缺失");
  console.error(
    "navigator.MediaDevices.getUserMedia error: ",
    error.message,
    error.name
  );
}
</script>

<template>
  <div class="box">
    <el-form label-width="80">
      <el-row :gutter="20">
        <el-col :span="7">
          <el-form-item label="摄像头">
            <el-select
              v-model="selectDevice.videoIn"
              class="m-2"
              placeholder="Select"
              size="large"
              style="width: 240px"
              value-key="id"
            >
              <el-option
                v-for="item in localDevice.videoIn"
                :key="item.id"
                :label="item.label"
                :value="item"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="7">
          <el-form-item label="麦克风">
            <el-select
              value-key="id"
              v-model="selectDevice.audioIn"
              class="m-2"
              placeholder="Select"
              size="large"
              style="width: 240px"
            >
              <el-option
                v-for="item in localDevice.audioIn"
                :key="item.id"
                :label="item.label"
                :value="item"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <!-- <el-col :span="7">
          <el-form-item label="听筒">
            <el-select
              value-key="id"
              v-model="selectDevice.audioOut"
              class="m-2"
              placeholder="Select"
              size="large"
              style="width: 240px"
            >
              <el-option
                v-for="item in localDevice.audioOut"
                :key="item.id"
                :label="item.label"
                :value="item"
              />
            </el-select>
          </el-form-item>
        </el-col> -->
        <el-col :span="2">
          <el-button type="primary" @click="sure"> 确定 </el-button>
        </el-col>
      </el-row>
      <el-row :gutter="20">
        <!-- <el-col :span="7">
          <el-form-item label="用户ID">
            <el-input v-model="userInfo.userId" style="width: 240px"></el-input>
          </el-form-item>
        </el-col> -->
        <el-col :span="7">
          <el-form-item label="昵称">
            <el-input
              v-model="userInfo.nickname"
              style="width: 240px"
            ></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="7">
          <el-form-item label="房间ID">
            <el-input v-model="userInfo.roomId" style="width: 240px"></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="2">
          <el-button type="primary" @click="enterRoom">进入房间</el-button>
        </el-col>
      </el-row>
    </el-form>
    <div class="df">
      <div class="video">
        <video id="video" autoplay controls muted></video>
        <div>
            <el-button type="primary" @click="share">
            {{ isShare ? "关闭共享" : "共享屏幕" }}
            </el-button>
            <el-button v-if="!mediaStatus.video" @click="videoControl(true)">打开视频</el-button>
            <el-button v-if="mediaStatus.video" @click="videoControl(false)">关闭视频</el-button>
            <el-button v-if="!mediaStatus.audio" @click="audioControl(true)">打开麦克风</el-button>
            <el-button v-if="mediaStatus.audio" @click="audioControl(false)">关闭麦克风</el-button>
		</div>

        <el-row>
            <div style="width: 100%;height: 200px;display: flex;flex-direction: row;align-items: center;">
                <el-form label-width="80px" class="demo-form-inline">
                    <el-form-item label="发送消息">
                        <el-input v-model="message"  placeholder="消息"></el-input>
                    </el-form-item>     
                    <el-form-item>
                    <el-button type="primary" @click="sendMessageUserRtcChannel">点击发送</el-button>
                    </el-form-item>
                </el-form>
                <div class="messageBox">
                    <div v-for="(item, index) in messageList" :key="item.name + index" class="messageBoxItem">
                        <span>{{ item.name }}</span>
                        <p>{{ item.message }}</p>
                    </div>
                </div>
            </div>
        </el-row>
      </div>
      <div class="userList" id="userList"></div>
    </div>
  </div>
</template>

<style scoped>
.box {
  box-sizing: border-box;
  overflow-x: hidden;
  padding: 20px 150px;
  margin: auto;
}
.video {
  width: 720px;

  margin: auto;
}
.video video {
  width: 100%;
  height: 480px;
}
.df {
  display: flex;
  justify-content: space-between;
}
.userList {
  width: 300px;
}
.messageBox{
    margin-left: 20px;
}
.messageBoxItem{
    display: flex;
    align-items: center;
}
.messageBoxItem span{
    margin-right: 10px;
}
.messageBoxItem p{
    color: #999;
}
</style>
