WL.registerComponent('peer-manager', {
    serverId: {type: WL.Type.String, default: 'THISISAWONDERLANDENGINEPLACEHOLDER'},
    networkSendFrequencyInS: {type: WL.Type.Float, default: 0.01},
    playerHead: {type: WL.Type.Object},
    playerRightHand: {type: WL.Type.Object},
    playerLeftHand: {type: WL.Type.Object},
    networkPlayerPool: {type: WL.Type.Object},
}, {
    //
    // Initialization
    //
    init: function() {
      window.pm = this;
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
        document.querySelector('body').appendChild(this.audio);

        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .then(function(stream) {
            this.localStream = stream;
          }.bind(this))
          .catch(function(err) {
            console.error("User denied audio access.")
        });
        if(!this.connectionEstablishedCallbacks) this.connectionEstablishedCallbacks = [];
        if(!this.disconnectCallbacks) this.disconnectCallbacks = [];
        if(!this.registeredNetworkCallbacks) this.registeredNetworkCallbacks = {};
    },
    start: function() {
      this.networkPlayerPoolComponent = this.networkPlayerPool.getComponent('peer-networked-player-pool');
    },
    //
    // Host functions
    //
    host: function() {
      this.peer = new Peer(this.serverId);
      this.peer.on('open', this._onHostOpen.bind(this));
      this.peer.on('connection', this._onHostConnected.bind(this));
      this.peer.on('disconnected', this._onDisconnected.bind(this));

      this.activePlayers[this.serverId] = {};

      this.peer.on('call', function(call) {
        this.calls[call.peer] = call;
        call.answer(this.localStream);
        call.on('stream', function(stream) {
            let audio = document.createElement("AUDIO");
            audio.id = "remoteAudio" + call.peer;
            document.querySelector('body').appendChild(audio);
            audio.srcObject = stream;
            audio.autoplay = true;
            this.streams[call.peer] = stream;
        }.bind(this));
      }.bind(this));
    },
    kick: function(id) {
      if(!this.currentDataPackage["disconnect"]) this.currentDataPackage["disconnect"] = [] ;
      this.currentDataPackage["disconnect"].push(id);
      this._removePlayer(id);
    },
    _onHostOpen: function(id) {
      for (let i = 0; i < this.connectionEstablishedCallbacks.length; i++) {
        this.connectionEstablishedCallbacks[i]();
      }
    },
    _onHostConnected: function(connection) {
      this._hostPlayerJoined(connection.peer);
      this.connections.push(connection);
      connection.on('open', function() {
        connection.send({joinedPlayers: Object.keys(this.activePlayers), joined: true});
      }.bind(this));
      connection.on('close', function() {
        this._onHostConnectionClose(connection);
      }.bind(this));
      connection.on('data', function(data) {
        this._onHostDataRecieved(data, connection);
      }.bind(this));
    },
    _onHostDataRecieved: function(data, connection) {
      if(data.transforms && this.activePlayers[connection.peer]) {
        this.activePlayers[connection.peer].setTransforms(data.transforms);
      }
      const dataKeys = Object.keys(data);
      for (let i = 0; i < dataKeys.length; i++) {
        const key = dataKeys[i];
        if(key == "transforms") continue;
        if(this.registeredNetworkCallbacks[key]) {
          this.registeredNetworkCallbacks[key](data[key]);
        }
      }
      this.currentDataPackage[connection.peer] = data;
    },
    _onHostConnectionClose: function(connection) {
      this._removePlayer(connection.peer);
      if(!this.currentDataPackage["disconnect"]) this.currentDataPackage["disconnect"] = [] ;
      this.currentDataPackage["disconnect"].push(connection.peer);
    },
    _hostPlayerJoined: function(id) {
      let newPlayer = this.networkPlayerPoolComponent.getEntity();
      this.activePlayers[id] = newPlayer;
      if(!this.currentDataPackage.joinedPlayers) {
        this.currentDataPackage.joinedPlayers = [];
      }
      this.currentDataPackage.joinedPlayers.push(id);
    },
    //
    // Client functions
    //
    join: function() {
      this.connect(this.serverId);
    },
    connect: function(id) {
      if(!id) return console.error("peer-manager: Connection id parameter missing");
      if(!this.peer) {
        this.peer = new Peer();
        this.peer.on('open', this._clientOnOpen.bind(this));
        this.peer.on('disconnected', this._onDisconnected.bind(this));
        this.connectionId = id;
        this.peer.on('call', function(call) {
          this.calls[call.peer] = call;
          call.answer(this.localStream);
          call.on('stream', function(stream) {
            let audio = document.createElement("AUDIO");
            audio.id = "remoteAudio" + id;
            document.querySelector('body').appendChild(audio);
            audio.srcObject = stream;
            audio.autoplay = true;
            this.streams[id] = stream;
          }.bind(this));
        }.bind(this));
      }
    },
    disconnect: function() {
      if(!this.peer) return
      this.peer.destroy();
      this.peer = null;
      this.connections = [];
      delete this.connection;
    },
    _onClientConnected: function() {
      this.call(this.serverId);
      for (let i = 0; i < this.connectionEstablishedCallbacks.length; i++) {
        this.connectionEstablishedCallbacks[i]();
      }
    },
    _onClientDataRecieved: function(data) {
      let registeredCallbacksKeys = Object.keys(this.registeredNetworkCallbacks);
      const keys = Object.keys(data);
      const joined = keys.includes('joined');
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = data[key];
        if(key == "joinedPlayers") {
          for (let j = 0; j < data.joinedPlayers.length; j++) {
            // if the join id is the same, ignore
            if(data.joinedPlayers[j] == this.peer.id || this.activePlayers[data.joinedPlayers[j]]) continue;
            if(!joined && data.joinedPlayers[j] != this.serverId) {
              let currentIndex = j;
              setTimeout(function() {
                this.call(data.joinedPlayers[currentIndex]);
              }.bind(this), Math.floor(500 * j));
            }
            let newPlayer = this.networkPlayerPoolComponent.getEntity();
            this.activePlayers[data.joinedPlayers[j]] = newPlayer;
          }
        } else {
          if(key == "call") continue;
          if(key == "disconnect") {
            for (let j = 0; j < value.length; j++) {
              this._removePlayer(value[j]);
            }
          }
          if(this.activePlayers[key]) {
            const values = Object.keys(value);
            for (let j = 0; j < values.length; j++) {
              if(values[j] == 'transforms') {
                this.activePlayers[key].setTransforms(value.transforms);
              } else {
                let includes = registeredCallbacksKeys.includes(values[j]);
                if(includes) {
                  this.registeredNetworkCallbacks[values[j]](value[values[j]]);
                }
              }
            }
          }
        }
      }
    },
    _removeAllPlayers: function() {
      const players = Object.keys(this.activePlayers)
      for (let i = 0; i < players.length; i++) {
        this._removePlayer(players[i]);
      }
    },
    _removePlayer: function(peerId){
      if(!this.activePlayers[peerId]) return;
      if(this.calls[peerId]) {
        this.calls[peerId].close();
        delete this.calls[peerId];
      }
      if(this.connections.length){
        const con = this.connections.find(function(element) {return element.peer === peerId});
        if(con) {
          con.close();
          let index = this.connections.indexOf(con);
          if (index > -1) {
            this.connections.splice(index, 1);
          }
        }
      }
      if(this.activePlayers[peerId]) {
        this.activePlayers[peerId].reset();
        this.networkPlayerPoolComponent.returnEntity(this.activePlayers[peerId]);
        delete this.activePlayers[peerId];
      }
    },
    // All functions
    _onDisconnected: function(connection) {
      this._removeAllPlayers();
      this.disconnect();
      for (let i = 0; i < this.disconnectCallbacks.length; i++) {
        this.disconnectCallbacks[i](connection.peer);
      }
    },
    call: function(id) {
      const call = this.peer.call(id, this.localStream);
      this.calls[id] = call;
      call.on('stream', function(stream) {
        let audio = document.createElement("AUDIO");
        audio.id = id;
        document.querySelector('body').appendChild(audio);
        audio.srcObject = stream;
        audio.autoplay = true;
        this.streams[id] = stream;
      }.bind(this));
    },
    _clientOnOpen: function() {
      this.connection = this.peer.connect(this.connectionId, {reliable: true});
      this.connection.on('open', this._onClientConnected.bind(this));
      this.connection.on('data', this._onClientDataRecieved.bind(this));
      this.connection.on('close', this._onClientClose.bind(this));
    },
    _onClientClose: function() {
      if(this.peer) {
        this.peer.destroy();
      }
    },
    addConnectionEstablishedCallback: function(f) {
      if(!this.connectionEstablishedCallbacks) this.connectionEstablishedCallbacks = [];
      this.connectionEstablishedCallbacks.push(f);
    },
    removeConnectionEstablishedCallback: function(f) {
      const index = this.connectionEstablishedCallbacks.indexOf(f);
      if (index > -1) {
        this.connectionEstablishedCallbacks.splice(index, 1);
      }
    },
    addDisconnectCallback: function(f) {
      if(!this.disconnectCallbacks) this.disconnectCallbacks = [];
      this.disconnectCallbacks.push(f);
    },
    removeDisconnectCallback: function(f) {
      const index = this.disconnectCallbacks.indexOf(f);
      if (index > -1) {
        this.disconnectCallbacks.splice(index, 1);
      }
    },
    addNetworkDataRecievedCallback: function(key, f) {
      if(!this.registeredNetworkCallbacks) this.registeredNetworkCallbacks = {};
      this.registeredNetworkCallbacks[key] = f;
    },
    removeNetworkDataRecievedCallback: function(key) {
      delete this.registeredNetworkCallbacks[key];
    },
    sendPackage: function(key, data) {
      this.currentDataPackage[key] = data;
    },
    toggleMute: function(){
      this.localStream.getTracks()[0].enabled = !this.localStream.getTracks()[0].enabled;
    },
    setOwnMute: function(mute) {
      this.localStream.getTracks()[0].enabled = !mute;
    },
    setOtherMute: function(id, mute) {
      if(this.streams[id])
        this.streams[id].getTracks()[0].enabled = !mute;
    },
    update: function(dt) {
      if(this.connections.length) {
        this.currentTime += dt;
        if(this.currentTime >= this.networkSendFrequencyInS) {
          this.currentTime = 0.0;
          this.headDualQuat.set(this.playerHead.transformWorld)
          this.rightHandDualQuat.set(this.playerRightHand.transformWorld)
          this.leftHandDualQuat.set(this.playerLeftHand.transformWorld)

          this.currentDataPackage[this.serverId] = {
            transforms: {
              head: this.headDualQuat,
              rightHand: this.rightHandDualQuat,
              leftHand: this.leftHandDualQuat,
            }
          };
          if(Object.keys(this.currentDataPackage).length) {
            for (let i = 0; i < this.connections.length; i++) {
              let currentConnectionId = this.connections[i].peer;
              const package = Object.fromEntries(Object.entries(this.currentDataPackage).filter(function(e) { return e[0] != currentConnectionId }))
              if(Object.keys(package).length)
                this.connections[i].send(package);
            }
            this.currentDataPackage = {};
          }
        }
      } else if(this.connection) {
        this.currentTime += dt;
        if(this.currentTime >= this.networkSendFrequencyInS) {
          this.currentTime = 0.0;

          this.headDualQuat.set(this.playerHead.transformWorld)
          this.rightHandDualQuat.set(this.playerRightHand.transformWorld)
          this.leftHandDualQuat.set(this.playerLeftHand.transformWorld)

          this.currentDataPackage.transforms = {
            head: this.headDualQuat,
            rightHand: this.rightHandDualQuat,
            leftHand: this.leftHandDualQuat,
          }
          this.connection.send(this.currentDataPackage);
          this.currentDataPackage = {};
        }
      }
    }
});

WL.registerComponent('peer-networked-player-pool', {
}, {
    init: function() {
      this.inactivePool = [];
      for (let i = 0; i < this.object.children.length; i++) {
        this.inactivePool.push(this.object.children[i].getComponent('peer-networked-player'));
      }
    },
    getEntity: function() {
      if(this.inactivePool.length)
        return this.inactivePool.shift();
      console.error("peer-networked-player-pool: No more inactive entities");
    },
    returnEntity: function(entity) {
      this.inactivePool.push(entity);
    }
});

WL.registerComponent('peer-networked-player', {
}, {
    init: function() {
      for (let i = 0; i < this.object.children.length; i++) {
        let currentChild = this.object.children[i];
        switch(currentChild.name) {
          case "Head":
            this.head = currentChild;
            break;
          case "LeftHand":
            this.leftHand = currentChild;
            break;
          case "RightHand":
            this.rightHand = currentChild;
            break;
        }
      }
    },
    reset: function(){
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
    }
});
