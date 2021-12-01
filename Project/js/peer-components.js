let isHost = false;

WL.registerComponent("peer-manager", {
  serverId: { type: WL.Type.String, default: "THISISAWONDERLANDENGINEPLACEHOLDER" },
  networkSendFrequencyInS: { type: WL.Type.Float, default: 0.01 },
  playerHead: { type: WL.Type.Object },
  playerRightHand: { type: WL.Type.Object },
  playerLeftHand: { type: WL.Type.Object },
  networkPlayerPool: { type: WL.Type.Object },
  voiceEnabled: { type: WL.Type.Bool, default: true },
}, {
  init: function() {
    this.streams = {};

    this.activePlayers = {};
    this.currentDataPackage = {};
    this.calls = {};
    this.connections = [];
    this.currentTime = 0.0;

    // Dual quaternions for sending head, left and right hand transforms
    this.headDualQuat = new Float32Array(8);
    this.rightHandDualQuat = new Float32Array(8);
    this.leftHandDualQuat = new Float32Array(8);

    // Records user audio
    this.audio = document.createElement("AUDIO");
    this.audio.id = "localAudio";
    document.body.appendChild(this.audio);

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => { this.localStream = stream; })
      .catch((err) => console.error("User denied audio access.", err));

    this.connectionEstablishedCallbacks = this.connectionEstablishedCallbacks || [];
    this.clientJoinedCallbacks = this.clientJoinedCallbacks || [];
    this.disconnectCallbacks = this.disconnectCallbacks || [];
    this.registeredNetworkCallbacks = this.registeredNetworkCallbacks || {};
  },

  start: function() {
    /* Try to get one of the two types of spawner component */
    this.networkPlayerSpawner =
      this.networkPlayerPool.getComponent("peer-networked-player-pool") ||
      this.networkPlayerPool.getComponent("peer-networked-player-spawner");
  },

  //
  // Host functions
  //
  host: function() {
    this.peer = new Peer(this.serverId);
    this.peer.on("open", this._onHostOpen.bind(this));
    this.peer.on("connection", this._onHostConnected.bind(this));
    this.peer.on("disconnected", this._onDisconnected.bind(this));

    this.peer.on("call", (call) => {
      this.calls[call.peer] = call;
      call.answer(this.localStream);
      call.on("stream", (stream) => {
        const audio = document.createElement("AUDIO");
        audio.id = "remoteAudio" + call.peer;
        document.body.appendChild(audio);
        audio.srcObject = stream;
        audio.autoplay = true;
        this.streams[call.peer] = stream;
      });
    });
  },

  kick: function(id) {
    this.currentDataPackage["disconnect"] = this.currentDataPackage["disconnect"] || [];
    this.currentDataPackage["disconnect"].push(id);
    this._removePlayer(id);
  },

  _onHostOpen: function(id) {
    isHost = true;
    this.serverId = id;
    this.activePlayers[this.serverId] = {};
    for (const cb of this.connectionEstablishedCallbacks) cb();
  },

  _onHostConnected: function(connection) {
    this._hostPlayerJoined(connection.peer, connection.metadata.username);
    this.connections.push(connection);
    connection.on("open", () => {
      // Additional data too be sent on joining can be added here
      connection.send({ joinedPlayers: Object.keys(this.activePlayers), joined: true});
    });
    connection.on("close", () => this._onHostConnectionClose(connection));
    connection.on("data", (data) => this._onHostDataRecieved(data, connection));
    this.object.setTranslationWorld([0, 0, 0]);
  },

  _onHostDataRecieved: function(data, connection) {
    if (data.transforms && this.activePlayers[connection.peer]) {
      this.activePlayers[connection.peer].setTransforms(data.transforms);
    }

    for (const key of Object.keys(data)) {
      if (key == "transforms") continue;
      if (this.registeredNetworkCallbacks[key]) {
        this.registeredNetworkCallbacks[key](data[key]);
      }
    }
    this.currentDataPackage[connection.peer] = data;
  },

  _onHostConnectionClose: function(connection) {
    this._removePlayer(connection.peer);
    this.object.setTranslationWorld([0, -1, 0]);
    this.disconnect();

    this.currentDataPackage["disconnect"] = this.currentDataPackage["disconnect"] || [];
    this.currentDataPackage["disconnect"].push(connection.peer);
  },

  _hostPlayerJoined: function(id) {
    let newPlayer = this.networkPlayerSpawner.getEntity();
    this.activePlayers[id] = newPlayer;
    this.currentDataPackage.joinedPlayers = this.currentDataPackage.joinedPlayers || [];
    this.currentDataPackage.joinedPlayers.push(id);

    for (const cb of this.clientJoinedCallbacks) cb(id, newPlayer);
  },

  //
  // Client functions
  //
  join: function() {
    this.connect(this.serverId);
  },

  connect: function(id) {
    if (!id) return console.error("peer-manager: Connection id parameter missing");
    // Already initialized?
    if (this.peer) return;

    this.peer = new Peer();
    this.peer.on("open", this._clientOnOpen.bind(this));
    this.peer.on("disconnected", this._onDisconnected.bind(this));

    this.connectionId = id;

    this.peer.on("call", (call) => {
      if (!this.voiceEnabled) return;

      this.calls[call.peer] = call;
      call.answer(this.localStream);
      call.on("stream", (stream) => {
        const audio = document.createElement("AUDIO");
        audio.id = "remoteAudio" + id;
        document.body.appendChild(audio);
        audio.srcObject = stream;
        audio.autoplay = true;
        this.streams[id] = stream;
      });
    });
  },

  disconnect: function() {
    if (!this.peer) return;

    this.peer.destroy();
    this.peer = null;
    this.connections = [];
    delete this.connection;
  },

  _onClientConnected: function() {
    this.call(this.serverId);
    isHost = false;
    for (const cb of this.connectionEstablishedCallbacks) cb();
  },

  _onClientDataRecieved: function(data) {
    const registeredCallbacksKeys = Object.keys(this.registeredNetworkCallbacks);
    const joined = "joined" in data;

    for (const key of Object.keys(data)) {
      const value = data[key];
      if (key == "joinedPlayers") {
        for (let j = 0; j < data.joinedPlayers.length; j++) {
          const p = data.joinedPlayers[j];
          // if the join id is the same, ignore
          if (p == this.peer.id || this.activePlayers[p]) continue;
          if (!joined && p != this.serverId) {
            setTimeout(() => { this.call(p); }, Math.floor(500 * j));
          }

          const newPlayer = this.networkPlayerSpawner.getEntity();
          this.activePlayers[p] = newPlayer;
          for (const cb of this.clientJoinedCallbacks) cb(p, newPlayer);
        }
        continue;
      }

      if (key == "call") continue;
      if (key == "disconnect") {
        for (const v of value) this._removePlayer(v);
      }

      if (this.activePlayers[key]) {
        const values = Object.keys(value);
        for (const v of values) {
          if (v == "transforms") {
            this.activePlayers[key].setTransforms(value.transforms);
            continue;
          }

          let includes = registeredCallbacksKeys.includes(v);
          if (includes) this.registeredNetworkCallbacks[v](value[v]);
        }
        continue;
      }

      let includes = registeredCallbacksKeys.includes(key);
      if (includes) this.registeredNetworkCallbacks[key](value);
    }
  },

  _removeAllPlayers: function() {
    const players = Object.keys(this.activePlayers);
    for (const player of players) this._removePlayer(player);
  },

  _removePlayer: function(peerId) {
    if (!this.activePlayers[peerId]) return;

    if (this.calls[peerId]) {
      this.calls[peerId].close();
      delete this.calls[peerId];
    }

    if (this.connections.length) {
      const con = this.connections.find((element) => { return element.peer === peerId; });
      if (con) {
        con.close();
        let index = this.connections.indexOf(con);
        if (index > -1) this.connections.splice(index, 1);
      }
    }

    if (!this.activePlayers[peerId]) return;

    if (Object.keys(this.activePlayers[peerId]).length !== 0) {
      this.activePlayers[peerId].reset();
      this.networkPlayerSpawner.returnEntity(this.activePlayers[peerId]);
    }
    delete this.activePlayers[peerId];
  },

  // All functions
  _onDisconnected: function(connection) {
    this._removeAllPlayers();
    this.disconnect();
    for (let cb of this.disconnectCallbacks) cb(connection.peer);
  },

  call: function(id) {
    if (!this.voiceEnabled) return;

    if(!this.localStream) {
        /* If the page doesn't have permission to access
         * audio stream, creation of the call would fail */
        console.error("Cannot call: no audio stream");
        return;
    }
    const call = this.peer.call(id, this.localStream);
    this.calls[id] = call;
    call.on("stream", (stream) => {
      const audio = document.createElement("AUDIO");
      audio.id = id;
      document.body.appendChild(audio);
      audio.srcObject = stream;
      audio.autoplay = true;
      this.streams[id] = stream;
    });
  },

  _clientOnOpen: function() {
    this.connection = this.peer.connect(this.connectionId, {
      // reliable: true,
      metadata: { username: "TestName" },
    });
    this.connection.on("open", this._onClientConnected.bind(this));
    this.connection.on("data", this._onClientDataRecieved.bind(this));
    this.connection.on("close", this._onClientClose.bind(this));
  },

  _onClientClose: function() {
    if (this.peer) this.peer.destroy();
  },

  addConnectionEstablishedCallback: function(f) {
    this.connectionEstablishedCallbacks = this.connectionEstablishedCallbacks || [];
    this.connectionEstablishedCallbacks.push(f);
  },

  removeConnectionEstablishedCallback: function(f) {
    const index = this.connectionEstablishedCallbacks.indexOf(f);
    if (index <= -1) return;

    this.connectionEstablishedCallbacks.splice(index, 1);
  },
  addClientJoinedCallback: function(f) {
    this.clientJoinedCallbacks = this.clientJoinedCallbacks || [];
    this.clientJoinedCallbacks.push(f);
  },
  removeClientJoinedCallback: function(f) {
    const index = this.clientJoinedCallbacks.indexOf(f);
    if (index <= -1) return

    this.clientJoinedCallbacks.splice(index, 1);
  },
  addDisconnectCallback: function(f) {
    this.disconnectCallbacks = this.disconnectCallbacks || [];
    this.disconnectCallbacks.push(f);
  },
  removeDisconnectCallback: function(f) {
    const index = this.disconnectCallbacks.indexOf(f);
    if (index <= -1) return;

    this.disconnectCallbacks.splice(index, 1);
  },

  addNetworkDataRecievedCallback: function(key, f) {
    this.registeredNetworkCallbacks = this.registeredNetworkCallbacks || {};
    this.registeredNetworkCallbacks[key] = f;
  },

  removeNetworkDataRecievedCallback: function(key) {
    delete this.registeredNetworkCallbacks[key];
  },

  sendPackage: function(key, data) {
    this.currentDataPackage[key] = data;
  },

  sendPackageImmediately: function(key, data) {
    let package = {};
    package[key] = data;

    if (this.connection) {
      this.connection.send(package);
      return;
    }

    for (let con of this.connections) con.send(package);
  },

  toggleMute: function() {
    this.localStream.getTracks()[0].enabled =
      !this.localStream.getTracks()[0].enabled;
  },

  setOwnMute: function(mute) {
    this.localStream.getTracks()[0].enabled = !mute;
  },

  setOtherMute: function(id, mute) {
    if (this.streams[id]) this.streams[id].getTracks()[0].enabled = !mute;
  },

  update: function(dt) {
    if(!this.connection && this.connections.length == 0) return;

    this.currentTime += dt;
    if (this.currentTime < this.networkSendFrequencyInS) return;

    this.currentTime = 0.0;

    this.headDualQuat.set(this.playerHead.transformWorld);
    this.rightHandDualQuat.set(this.playerRightHand.transformWorld);
    this.leftHandDualQuat.set(this.playerLeftHand.transformWorld);

    if (this.connections.length) {
      this.currentDataPackage[this.serverId] = {
        transforms: {
          head: this.headDualQuat,
          rightHand: this.rightHandDualQuat,
          leftHand: this.leftHandDualQuat,
        },
      };

      if (Object.keys(this.currentDataPackage).length == 0) return

      for (let con of this.connections) {
        const currentConnectionId = con.peer;
        const package = Object.fromEntries(
          Object.entries(this.currentDataPackage).filter((e) => { return e[0] != currentConnectionId; })
        );
        if (Object.keys(package).length) con.send(package);
      }
    } else {
      this.currentDataPackage.transforms = {
        head: this.headDualQuat,
        rightHand: this.rightHandDualQuat,
        leftHand: this.leftHandDualQuat,
      };

      this.connection.send(this.currentDataPackage);
    }

    this.currentDataPackage = {};
  },
});

WL.registerComponent("peer-networked-player-pool", {

}, {
  init: function() {
    this.inactivePool = [];
    for (let c of this.object.children) {
      this.inactivePool.push(c.getComponent("peer-networked-player"));
    }
  },
  getEntity: function() {
    if (this.inactivePool.length) return this.inactivePool.shift();
    console.error("peer-networked-player-pool: No more inactive entities");
  },
  returnEntity: function(entity) {
    this.inactivePool.push(entity);
  },
}
);

WL.registerComponent("peer-networked-player", {
  nameTextObject: { type: WL.Type.Object }
}, {
  init: function() {
    for (let c of this.object.children) {
      if(c.name == "Head") this.head = c;
      if(c.name == "LeftHand") this.leftHand = c;
      if(c.name == "RightHand") this.rightHand = c;
    }
  },

  setName: function(name) {
    if (this.nameTextObject) this.nameTextObject.getComponent("text").text = name;
  },

  reset: function() {
    this.head.resetTranslationRotation();
    this.rightHand.resetTranslationRotation();
    this.leftHand.resetTranslationRotation();
  },

  setTransforms: function(transforms) {
    this.head.transformLocal.set(new Float32Array(transforms.head));
    this.head.setDirty();

    this.rightHand.transformLocal.set(new Float32Array(transforms.rightHand));
    this.rightHand.setDirty();

    this.leftHand.transformLocal.set(new Float32Array(transforms.leftHand));
    this.leftHand.setDirty();
  },
}
);

WL.registerComponent("peer-networked-player-spawner", {
  headMesh: { type: WL.Type.Mesh },
  headMaterial: { type: WL.Type.Material },
  leftHandMesh: { type: WL.Type.Mesh },
  leftHandMaterial: { type: WL.Type.Material },
  rightHandMesh: { type: WL.Type.Mesh },
  rightHandMaterial: { type: WL.Type.Material },
}, {
  init: function() {
    this.count = 0;
  },

  getEntity: function() {
    const player = WL.scene.addObject(1);
    const children = WL.scene.addObjects(3, player);

    children[0].name = "Head";
    children[0].addComponent("mesh", {
      mesh: this.headMesh,
      material: this.headMaterial,
    });

    children[1].name = "LeftHand";
    children[1].addComponent("mesh", {
      mesh: this.leftHandMesh,
      material: this.leftHandMaterial,
    });

    children[2].name = "RightHand";
    children[2].addComponent("mesh", {
      mesh: this.rightHandMesh,
      material: this.rightHandMaterial,
    });

    player.name = `Player ${this.count++}`;
    return player.addComponent("peer-networked-player");
  },

  returnEntity: function(player) {
    console.log("returning:", player);
    player.children.forEach((c) => { c.active = false; });
    player.active = false;
  },
});
